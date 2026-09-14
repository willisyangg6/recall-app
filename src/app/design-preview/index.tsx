/**
 * The Design Preview hub — LOCAL DEVELOPMENT TOOLING, not a product screen.
 *
 * It exists so the founder can reach every shopper-report state in a
 * simulator and screenshot it for the designer while the production feature
 * gate stays off. It renders no product UI of its own: each row arms a
 * simulated session (lib/design-preview.ts) and then pushes the REAL Detail
 * or the REAL questionnaire, which render the production components against
 * the live read-only feed. There is deliberately no preview copy of Detail,
 * the community block, or the questionnaire anywhere in this file — a
 * screenshot of a copy would prove nothing about the product.
 *
 * This screen carries the only "development" labelling in the harness. The
 * screens it opens carry none, so the captures are of the product exactly as
 * it is built.
 *
 * Every recall shown here is a real, current recall chosen from the app's
 * normal feed session — no extra feed request, no invented case. The only
 * simulated values are the four the hub names in its own banner.
 *
 * Release builds: the entry point into this route does not exist (Profile's
 * row is behind `__DEV__`, which Metro eliminates), and the screen refuses to
 * arm anything anyway, so a deep link reaches an inert page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RiskBadge } from '@/components/risk-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { useFeed } from '@/hooks/use-feed';
import {
  activeDesignPreview,
  candidateScore,
  DESIGN_PREVIEW_SCENARIOS,
  enterDesignPreview,
  exitDesignPreview,
  isDevelopmentBuild,
  rankCandidates,
  resetDesignPreview,
  type DesignPreviewSession,
  type PreviewCaseRequirement,
  type PreviewDetailFacts,
  type PreviewScenario,
  type ScreenedCandidate,
} from '@/lib/design-preview';
import type { Classification, OfficialClass } from '@/domain/recall-types';
import type { ConsumerRiskTier } from '@/domain/risk-tier';
import { RISK_FILTER_TIERS } from '@/lib/feed-filters';
import { fetchCaseDetail } from '@/lib/recall-feed';
import { buildDetailModel, todayIso } from '@/lib/recall-presentation';
import { riskView } from '@/lib/risk-display';

/** How many candidates per requirement the hub offers as alternatives. */
const CANDIDATES_SHOWN = 6;
/** How many of the primary bucket are confirmed against the real detail model. */
const CANDIDATES_CONFIRMED = 5;
/**
 * How many recalls the hub reads a real Detail model for on open. The
 * presentation scenarios (jurisdiction, row and cell disclosure) can only be
 * decided from that model, and a feed row cannot answer "does any cell in
 * this notice hold more than two values". These are the same read-only detail
 * requests the Detail screen itself makes.
 */
const DETAIL_PROBE_LIMIT = 30;

const REQUIREMENT_LABELS: Record<PreviewCaseRequirement, string> = {
  reportable_with_retailers: 'Eligible recall naming at least one retailer',
  reportable_without_retailers: 'Eligible recall naming no retailer',
  not_reportable: 'Ineligible recall (unusable geography)',
  jurisdictions_few: 'Recall naming five jurisdictions or fewer',
  jurisdictions_many: 'Recall naming more than five jurisdictions',
  products_one: 'Recall with exactly one affected-product row',
  products_many: 'Recall with several affected-product rows',
  cell_two_values: 'Recall with an unpaired cell holding exactly two values',
  cell_many_values: 'Recall with an unpaired cell holding more than two values',
  pairs_two: 'Recall stating exactly two code/date pairs',
  pairs_many: 'Recall stating more than two code/date pairs',
};

/**
 * One classification per consumer tier, so the label gallery renders through
 * the REAL pipeline — `riskView` derives the word, the casing and the spoken
 * label from these exactly as it does for a live recall. Nothing here is
 * recall content: it is the official classification vocabulary, and a wrong
 * mapping would show up as the wrong badge.
 */
const TIER_SAMPLE: Record<ConsumerRiskTier, Classification> = {
  critical: classificationOf(['class_I']),
  very_high: classificationOf(['class_I', 'class_II']),
  high: classificationOf(['class_II']),
  moderate: classificationOf(['class_II', 'class_III']),
  low: classificationOf(['class_III']),
  pending: { value: 'not_yet_classified', sourceText: null, officialClasses: [] },
  unknown: { value: 'not_applicable_pha', sourceText: null, officialClasses: [] },
};

function classificationOf(classes: OfficialClass[]): Classification {
  return {
    value: classes.length === 1 ? classes[0] : 'multiple_classes',
    sourceText: null,
    officialClasses: classes,
  };
}

/** What the real detail model actually produced for a case. */
interface ConfirmedSections {
  healthRisk: boolean;
  affectedProducts: boolean;
  community: boolean;
  facts: PreviewDetailFacts;
}

export default function DesignPreviewScreen() {
  const insets = useSafeAreaInsets();
  const feed = useFeed();
  const [chosen, setChosen] = useState<Partial<Record<PreviewCaseRequirement, string>>>({});
  const [confirmed, setConfirmed] = useState<Record<string, ConfirmedSections>>({});
  const [session, setSession] = useState<DesignPreviewSession | null>(null);
  const [expanded, setExpanded] = useState<PreviewCaseRequirement | null>(null);

  // Returning from a simulated submission or removal should show the current
  // simulated state, not the one this screen last rendered.
  useFocusEffect(
    useCallback(() => {
      setSession(activeDesignPreview());
    }, []),
  );

  const candidates = useMemo(() => {
    const items = feed.state.status === 'ready' ? feed.state.items : [];
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      state: item.state,
      geography: item.geography,
      retailerNames: item.retailerNames,
      productLineCount: item.productNames.length,
      lastPublicActivityAt: item.lastPublicActivityAt,
    }));
  }, [feed.state]);

  const buckets = useMemo(() => {
    const factsFor = (id: string) => confirmed[id]?.facts ?? null;
    const forRequirement = (requirement: PreviewCaseRequirement) =>
      rankCandidates(candidates, requirement, factsFor);
    return Object.fromEntries(
      (Object.keys(REQUIREMENT_LABELS) as PreviewCaseRequirement[]).map((requirement) => [
        requirement,
        forRequirement(requirement),
      ]),
    ) as Record<PreviewCaseRequirement, ScreenedCandidate[]>;
  }, [candidates, confirmed]);

  /**
   * The recalls the hub reads a REAL Detail model for, chosen to span the
   * shapes the presentation scenarios need: the longest product tables (long
   * cells live there), single-line notices, and the widest jurisdiction
   * lists. Derived from the feed alone, never from the confirmed results, so
   * confirming can never feed back into what gets confirmed.
   */
  const probeIds = useMemo(() => {
    const byProductLines = [...candidates].sort((a, b) => b.productLineCount - a.productLineCount);
    const singleLine = candidates.filter((item) => item.productLineCount === 1);
    const byStates = [...candidates].sort(
      (a, b) =>
        (b.geography.scope === 'states' ? b.geography.states.length : 0) -
        (a.geography.scope === 'states' ? a.geography.states.length : 0),
    );
    const picked: string[] = [];
    for (const item of [
      // Weighted toward long product tables: a notice that prints a code
      // beside its own date is a notice with a per-product table, and those
      // are the rows the pair scenarios need. A narrow sample simply reports
      // "no suitable current recall" rather than substituting a wrong one, so
      // breadth here is the difference between a scenario being offered and
      // being honestly unavailable.
      ...byProductLines.slice(0, 20),
      ...singleLine.slice(0, 5),
      ...byStates.slice(0, 5),
    ]) {
      if (!picked.includes(item.id) && picked.length < DETAIL_PROBE_LIMIT) picked.push(item.id);
    }
    return picked;
  }, [candidates]);

  // Read each probe's real Detail model: which sections it produced, and the
  // disclosure shape of its jurisdiction list, product rows and cells. These
  // are the same read-only detail requests the Detail screen itself makes.
  useEffect(() => {
    if (probeIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        probeIds.map(async (id) => {
          try {
            const detail = await fetchCaseDetail(id);
            if (detail === null) return null;
            const model = buildDetailModel(detail, { today: todayIso(), affectsYou: false });
            const { sections } = model;
            const cells = (sections.affectedProducts?.table.expanded.rows ?? []).flatMap(
              (row) => row.cells,
            );
            // Independent fields and coordinated pair groups are measured
            // separately: a paired cell's line count belongs to its group, not
            // to a field, and one must never satisfy the other's scenario.
            const valueCounts = cells
              .filter((cell) => cell.pairGroup === null)
              .map((cell) => cell.values.length);
            const pairLines = (sections.affectedProducts?.table.expanded.rows ?? []).flatMap(
              (row) => {
                const groups = new Map<string, number>();
                for (const cell of row.cells) {
                  if (cell.pairGroup !== null) groups.set(cell.pairGroup, cell.values.length);
                }
                return [...groups.values()];
              },
            );
            return [
              id,
              {
                healthRisk: sections.healthRisk !== null,
                affectedProducts: sections.affectedProducts !== null,
                community: sections.communityReports !== null,
                facts: {
                  jurisdictionCount: sections.whereSold?.states.length ?? 0,
                  productRowCount: sections.affectedProducts?.table.expanded.rows.length ?? 0,
                  maxCellValues: valueCounts.length > 0 ? Math.max(...valueCounts) : 0,
                  hasTwoValueCell: valueCounts.includes(2),
                  maxPairLines: pairLines.length > 0 ? Math.max(...pairLines) : 0,
                  hasTwoLinePairGroup: pairLines.includes(2),
                },
              },
            ] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, ConfirmedSections> = {};
      for (const result of results) if (result !== null) next[result[0]] = result[1];
      setConfirmed(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [probeIds]);

  /**
   * The recall a requirement will use: the founder's explicit pick, else the
   * best-confirmed primary candidate, else the top-ranked one.
   */
  const selectionFor = (requirement: PreviewCaseRequirement): ScreenedCandidate | null => {
    const bucket = buckets[requirement];
    const picked = chosen[requirement];
    if (picked !== undefined) {
      const match = bucket.find((screened) => screened.candidate.id === picked);
      if (match) return match;
    }
    if (requirement === 'reportable_with_retailers') {
      const best = bucket
        .slice(0, CANDIDATES_CONFIRMED)
        .find((screened) => isFullyFeatured(confirmed[screened.candidate.id]));
      if (best) return best;
    }
    // A presentation requirement is only ever satisfied by a confirmed case,
    // so the bucket already holds nothing but real matches.
    return bucket[0] ?? null;
  };

  const open = (scenario: PreviewScenario) => {
    const selection = selectionFor(scenario.requirement);
    if (selection === null) return;
    const entered = enterDesignPreview({
      scenarioId: scenario.id,
      caseId: selection.candidate.id,
      caseTitle: selection.candidate.title,
      allowedStateCodes: selection.allowedStateCodes,
      retailerChoices: selection.retailerChoices,
      now: new Date().toISOString(),
    });
    if (entered === null) return;
    setSession(entered);
    router.push(
      scenario.destination === 'detail'
        ? { pathname: '/recall/[id]', params: { id: selection.candidate.id } }
        : { pathname: '/report/[id]', params: { id: selection.candidate.id } },
    );
  };

  // A release build can neither arm a session nor offer a control that would.
  if (!isDevelopmentBuild()) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: 'Design Preview' }} />
        <View style={styles.content}>
          <ThemedText themeColor="textSecondary">
            Design Preview is a development-only tool and is not available in this build.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Design Preview' }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.five + insets.bottom }]}>
        <ThemedView type="backgroundSelected" style={styles.banner}>
          <ThemedText type="subtitle">Local development tooling</ThemedText>
          <ThemedText type="small">
            Not part of the product. The recall content below is real and read-only. Only four
            values are simulated: the public report count, whether this device has a report, that
            report’s answers, and whether the feature is available inside this session. Simulated
            reports stay in memory on this device — nothing is written to Supabase, and the
            production feature gate is untouched and still off.
          </ThemedText>
        </ThemedView>

        {feed.state.status === 'loading' ? (
          <ThemedText themeColor="textSecondary">Loading the live feed…</ThemedText>
        ) : null}
        {feed.state.status === 'error' ? (
          <ThemedText themeColor="textSecondary">
            The live feed could not load, so no real recall can be offered: {feed.state.message}
          </ThemedText>
        ) : null}

        {session ? (
          <ThemedView type="backgroundElement" style={styles.sessionBox}>
            <ThemedText type="small" themeColor="textSecondary">
              ACTIVE SIMULATED SESSION
            </ThemedText>
            <ThemedText>{session.scenarioId}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {session.caseTitle}
            </ThemedText>
            <ThemedText type="small">
              {session.simulated === null
                ? 'Not simulated — this case reads the real server.'
                : `Simulated: ${summaryText(session)} · ${
                    session.simulated.report === null
                      ? 'no report from this device'
                      : 'this device has a report'
                  }`}
            </ThemedText>
            <View style={styles.sessionActions}>
              <Action
                label="Reset simulated state"
                onPress={() => {
                  resetDesignPreview();
                  setSession(activeDesignPreview());
                }}
              />
              <Action
                label="Leave preview"
                onPress={() => {
                  exitDesignPreview();
                  setSession(null);
                }}
              />
            </View>
          </ThemedView>
        ) : null}

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          RISK LABELS
        </ThemedText>
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            All seven consumer labels, rendered by the product’s own badge through the real riskView
            pipeline — the same words, casing and spoken labels a live recall gets.
          </ThemedText>
          <View style={styles.badges}>
            {RISK_FILTER_TIERS.map((tier) => {
              const risk = riskView(TIER_SAMPLE[tier], 'FDA');
              return (
                <RiskBadge
                  key={tier}
                  tier={risk.tier}
                  label={risk.badgeLabel ?? ''}
                  accessibilityLabel={risk.accessibilityLabel}
                />
              );
            })}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {RISK_FILTER_TIERS.map(
              (tier) => riskView(TIER_SAMPLE[tier], 'FDA').accessibilityLabel,
            ).join(' · ')}
          </ThemedText>
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          RECALLS IN USE
        </ThemedText>
        {(Object.keys(REQUIREMENT_LABELS) as PreviewCaseRequirement[]).map((requirement) => {
          const selection = selectionFor(requirement);
          const bucket = buckets[requirement];
          return (
            <ThemedView key={requirement} type="backgroundElement" style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">
                {REQUIREMENT_LABELS[requirement]}
              </ThemedText>
              {selection === null ? (
                <ThemedText type="small">
                  {feed.state.status === 'ready'
                    ? 'No current recall in the live feed fits this scenario.'
                    : '—'}
                </ThemedText>
              ) : (
                <>
                  <ThemedText>{selection.candidate.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {candidateFacts(selection, confirmed[selection.candidate.id])}
                  </ThemedText>
                  {bucket.length > 1 ? (
                    <Action
                      label={expanded === requirement ? 'Hide other recalls' : 'Choose another'}
                      onPress={() => setExpanded(expanded === requirement ? null : requirement)}
                    />
                  ) : null}
                </>
              )}
              {expanded === requirement
                ? bucket.slice(0, CANDIDATES_SHOWN).map((option) => (
                    <Pressable
                      key={option.candidate.id}
                      accessibilityRole="button"
                      onPress={() => {
                        setChosen((prior) => ({ ...prior, [requirement]: option.candidate.id }));
                        setExpanded(null);
                      }}>
                      <ThemedView type="backgroundSelected" style={styles.option}>
                        <ThemedText type="small">{option.candidate.title}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {candidateFacts(option, confirmed[option.candidate.id])}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  ))
                : null}
            </ThemedView>
          );
        })}

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          SCENARIOS
        </ThemedText>
        {DESIGN_PREVIEW_SCENARIOS.map((scenario) => {
          const selection = selectionFor(scenario.requirement);
          return (
            <Pressable
              key={scenario.id}
              accessibilityRole="button"
              accessibilityLabel={scenario.title}
              accessibilityState={{ disabled: selection === null }}
              disabled={selection === null}
              onPress={() => open(scenario)}>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText>{scenario.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {scenario.expectation}
                </ThemedText>
                <ThemedText type="small" themeColor={selection === null ? 'textSecondary' : 'link'}>
                  {selection === null
                    ? 'No suitable current recall — unavailable'
                    : `Open ${scenario.destination === 'detail' ? 'Recall Detail' : 'the questionnaire'} →`}
                </ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </ScrollView>
    </ThemedView>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <ThemedText type="small" themeColor="link">
        {label}
      </ThemedText>
    </Pressable>
  );
}

function isFullyFeatured(sections: ConfirmedSections | undefined): boolean {
  return (
    sections !== undefined && sections.healthRisk && sections.affectedProducts && sections.community
  );
}

/** The case's own real attributes — every one of them read, never invented. */
function candidateFacts(
  screened: ScreenedCandidate,
  sections: ConfirmedSections | undefined,
): string {
  const geography =
    screened.candidate.geography.scope === 'nationwide'
      ? 'Nationwide'
      : screened.candidate.geography.scope === 'states'
        ? `${screened.candidate.geography.states.length} state(s)`
        : 'Unknown geography';
  const parts = [
    geography,
    `${screened.retailerChoices.length} retailer(s)`,
    `${screened.candidate.productLineCount} product line(s)`,
  ];
  if (sections !== undefined) {
    parts.push(`Health Risk: ${sections.healthRisk ? 'yes' : 'no'}`);
    parts.push(`Affected Products: ${sections.affectedProducts ? 'yes' : 'no'}`);
    // The disclosure shape, read from the real Detail model.
    parts.push(`${sections.facts.jurisdictionCount} jurisdiction(s)`);
    parts.push(`${sections.facts.productRowCount} product row(s)`);
    parts.push(`longest unpaired cell ${sections.facts.maxCellValues} value(s)`);
    parts.push(`longest pair group ${sections.facts.maxPairLines} line(s)`);
  }
  parts.push(`fit ${candidateScore(screened)}`);
  return parts.join(' · ');
}

function summaryText(session: DesignPreviewSession): string {
  if (session.simulated === null) return 'not simulated';
  const { summary } = session.simulated;
  if (summary.status === 'reported') return `public count ${summary.count}`;
  if (summary.status === 'below_threshold') return 'public count withheld (below threshold)';
  return 'unavailable';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  content: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  banner: {
    padding: Spacing.three,
    borderRadius: Radii.medium,
    gap: Spacing.one,
  },
  sessionBox: {
    padding: Spacing.three,
    borderRadius: Radii.medium,
    gap: Spacing.half,
  },
  sessionActions: {
    flexDirection: 'row',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
  sectionLabel: {
    marginTop: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Radii.medium,
    gap: Spacing.half,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginVertical: Spacing.one,
  },
  option: {
    padding: Spacing.two,
    borderRadius: Radii.small,
    marginTop: Spacing.one,
    gap: Spacing.half,
  },
});
