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

import { DocumentBlockView } from '@/components/document/document-blocks';
import { DocumentSectionView, DocumentView } from '@/components/document/document-view';
import { ResetPanel } from '@/components/installation-reset-section';
import { DevelopmentEntry } from '@/components/profile/development-entry';
import { NavigationRow } from '@/components/profile/navigation-row';
import { PersonalizationCard } from '@/components/profile/personalization-card';
import { ProfileSection } from '@/components/profile/profile-section';
import { ValueRow } from '@/components/profile/value-row';
import { RecallCard } from '@/components/recall-card';
import { NotificationsPanel } from '@/components/settings/notifications-panel';
import {
  PersonalizationForm,
  PreferencesNotReady,
  StateSection,
  StateSelectorContent,
  StoreSection,
  StoreSelectorContent,
} from '@/components/settings/personalization-form';
import {
  OutcomeStep,
  PausedStep,
  QuestionStep,
  ReviewStep,
} from '@/components/report-questionnaire';
import { StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Callout } from '@/components/ui/callout';
import { Chip } from '@/components/ui/chip';
import { DisclosureControl } from '@/components/ui/disclosure-control';
import { Icon, ICON_NAMES } from '@/components/ui/icon';
import { RelevanceLabel } from '@/components/ui/relevance-label';
import { RiskLabel } from '@/components/ui/risk-label';
import { SearchBar } from '@/components/ui/search-bar';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import {
  CUSTOM_FONTS_INSTALLED,
  fontFamily,
  spacing,
  typography,
  type TypographyVariant,
} from '@/constants/design-tokens';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { documentBySlug, TRUST_DOCUMENTS } from '@/content';
import type { DocumentBlock, TrustDocument } from '@/content/document-model';
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
  type PreviewScenarioGroup,
  type ScreenedCandidate,
} from '@/lib/design-preview';
import { DETAIL_ERROR_TITLE, DETAIL_LOADING, DETAIL_MISSING } from '@/lib/detail-copy';
import {
  RESET_CONFIRM_BODY,
  RESET_CONFIRM_CANCEL,
  RESET_CONFIRM_DELETE,
  RESET_CONFIRM_TITLE,
} from '@/lib/installation-reset';
import { GENERIC_FAILURE, type NotificationsView } from '@/lib/notifications-screen';
import { storeCountLabel } from '@/lib/personalization-screen';
import {
  APP_VERSION_LABEL,
  DOCUMENT_HINT,
  summarizePreferences,
  versionLine,
  type PreferenceSummaryState,
} from '@/lib/profile-hub';
import {
  EMPTY_PREFERENCES,
  SUPPORTED_STATE_CODES,
  type UserRecallPreferences,
} from '@/domain/preferences';
import type { Classification, OfficialClass } from '@/domain/recall-types';
import type { ConsumerRiskTier } from '@/domain/risk-tier';
import {
  FEED_EMPTY_SEARCH,
  FEED_ERROR_TITLE,
  FEED_LOADING,
  FEED_STALE_NOTICE,
  PERSONALIZE_CTA,
} from '@/lib/feed-copy';
import { RISK_FILTER_TIERS } from '@/lib/feed-filters';
import {
  SAVED_EMPTY,
  SAVED_ERROR_TITLE,
  SAVED_LOADING,
  savedMissingNotice,
} from '@/lib/saved-recalls';
import { selectHazardGuidance } from '@/lib/recall-display';
import { fetchCaseDetail, type FeedItem } from '@/lib/recall-feed';
import {
  buildDetailModel,
  buildHomeCardModel,
  disclosureControl,
  todayIso,
  type HomeCardModel,
} from '@/lib/recall-presentation';
import { interpretReason } from '@/lib/recall-reason';
import { riskView } from '@/lib/risk-display';
import {
  EMPTY_ANSWERS,
  questionnaireOutcome,
  questionnaireSteps,
  REMOVE_FAILURE,
  REPORT_UNAVAILABLE,
  RETAILER_NOT_SURE,
  SUBMIT_FAILURE,
  SUCCESS_BODY,
  SUCCESS_TITLE,
  type QuestionKey,
  type QuestionnaireAnswers,
  type QuestionnaireChoices,
} from '@/lib/shopper-report-presentation';

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
const DETAIL_PROBE_LIMIT = 60;

/** How many feed rows each P2B2 hint bucket contributes to the probes. */
const HINTS_PER_BUCKET = 3;

/**
 * Feed-row HINTS for the reviewed hazard guides — where a recall carrying
 * each guide is likely to be found, so a probe is spent on it. Hints only:
 * the requirement itself is decided by the real Detail model's guide
 * selection, never by these patterns.
 */
const GUIDE_HINTS: readonly RegExp[] = [
  /botul/i,
  /listeria/i,
  /e\.?\s?coli|stec|shiga/i,
  /salmonella/i,
  /hepatitis/i,
  /cyclospora/i,
];

const REQUIREMENT_LABELS: Record<PreviewCaseRequirement, string> = {
  reportable_with_retailers: 'Eligible recall naming at least one retailer',
  reportable_without_retailers: 'Eligible recall naming no retailer',
  not_reportable: 'Ineligible recall (unusable geography)',
  // P2B3
  reportable_single_state: 'Eligible recall naming exactly one state',
  reportable_multi_state: 'Eligible recall naming several states',
  reportable_nationwide: 'Eligible recall distributed nationwide',
  jurisdictions_few: 'Recall naming five jurisdictions or fewer',
  jurisdictions_many: 'Recall naming more than five jurisdictions',
  products_one: 'Recall with exactly one affected-product row',
  products_many: 'Recall with several affected-product rows',
  cell_two_values: 'Recall with an unpaired cell holding exactly two values',
  cell_many_values: 'Recall with an unpaired cell holding more than two values',
  pairs_two: 'Recall stating exactly two code/date pairs',
  pairs_many: 'Recall stating more than two code/date pairs',
  // P2B2
  nationwide: 'Recall distributed nationwide',
  risk_critical: 'Recall at the CRITICAL tier',
  risk_very_high: 'Recall at the VERY HIGH tier',
  risk_high: 'Recall at the HIGH tier',
  risk_moderate: 'Recall at the MODERATE tier',
  risk_low: 'Recall at the LOW tier',
  risk_pending: 'Recall at the PENDING tier',
  risk_unknown: 'Notice at the UNKNOWN tier',
  image: 'Recall whose Detail model resolved a hero image',
  no_image: 'Recall whose Detail model resolved no hero image',
  name_short: 'Recall with a short product name',
  name_long: 'Recall with a long product name',
  guide_botulism: 'Recall the pipeline matches to the botulism guide',
  guide_listeria: 'Recall the pipeline matches to the Listeria guide',
  guide_stec: 'Recall the pipeline matches to the E. coli (STEC) guide',
  guide_undeclared_allergen: 'Recall the pipeline matches to the undeclared-allergen guide',
  guide_salmonella: 'Recall the pipeline matches to the Salmonella guide',
  guide_hepatitis_a: 'Recall the pipeline matches to the hepatitis A guide',
  guide_cyclospora: 'Recall the pipeline matches to the Cyclospora guide',
  health_risk_fallback: 'Recall with a Health Risk section but no reviewed guide',
  health_risk_absent: 'Recall with no Health Risk section',
  pairs_complete: 'Recall whose code/date group is complete',
  pairs_incomplete: 'Recall whose code/date group has an undated code',
};

const GROUP_LABELS: Record<PreviewScenarioGroup, string> = {
  community: 'Community shopper reports',
  questionnaire: 'Questionnaire',
  disclosure: 'Where It Was Sold and Affected Products',
  header: 'Product header',
  health: 'Health Risk',
  risk: 'Risk labels on Detail',
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
  // The foundation gallery's one interactive sample.
  const [sampleExpanded, setSampleExpanded] = useState(false);

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
      // The same derivation the Detail model makes from the same stored
      // classification, so the risk scenarios land on the tier they name.
      riskTier: riskView(item.classification, item.sourceAgency).tier,
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
    const items = feed.state.status === 'ready' ? feed.state.items : [];
    const byProductLines = [...candidates].sort((a, b) => b.productLineCount - a.productLineCount);
    const singleLine = candidates.filter((item) => item.productLineCount === 1);
    const byStates = [...candidates].sort(
      (a, b) =>
        (b.geography.scope === 'states' ? b.geography.states.length : 0) -
        (a.geography.scope === 'states' ? a.geography.states.length : 0),
    );
    // P2B2 hints, from the feed row's own fields: a few rows per reviewed
    // hazard guide, a few whose hazard has no guide, rows with and without
    // a hero, and the shortest and longest titles. Every one is confirmed
    // against the real Detail model before a scenario can use it.
    const hazardText = (item: FeedItem) =>
      `${item.pathogenOrAllergen ?? ''} ${item.reasonText ?? ''}`;
    const guideHinted = GUIDE_HINTS.flatMap((pattern) =>
      items.filter((item) => pattern.test(hazardText(item))).slice(0, HINTS_PER_BUCKET),
    );
    const allergen = items.filter((item) => item.hazardCategory === 'allergen');
    const otherHazards = items.filter((item) =>
      [
        'foreign_material',
        'product_integrity',
        'other_regulatory',
        'chemical_contamination',
      ].includes(item.hazardCategory),
    );
    const withHero = items.filter((item) => item.heroImageUrl !== null);
    const withoutHero = items.filter((item) => item.heroImageUrl === null);
    const byTitleLength = [...items].sort((a, b) => a.title.length - b.title.length);
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
      ...guideHinted,
      ...allergen.slice(0, HINTS_PER_BUCKET),
      ...otherHazards.slice(0, HINTS_PER_BUCKET + 1),
      ...withHero.slice(0, HINTS_PER_BUCKET),
      ...withoutHero.slice(0, HINTS_PER_BUCKET),
      ...byTitleLength.slice(0, 2),
      ...byTitleLength.slice(-2),
    ]) {
      if (!picked.includes(item.id) && picked.length < DETAIL_PROBE_LIMIT) picked.push(item.id);
    }
    return picked;
  }, [candidates, feed.state]);

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
            // A pair group is incomplete when either half carries an empty
            // line — an undated code, which the screen keeps as a blank.
            const pairCompleteness = (sections.affectedProducts?.table.expanded.rows ?? []).flatMap(
              (row) => {
                const groups = new Map<string, boolean>();
                for (const cell of row.cells) {
                  if (cell.pairGroup === null) continue;
                  const blank = cell.values.includes('');
                  groups.set(cell.pairGroup, (groups.get(cell.pairGroup) ?? false) || blank);
                }
                return [...groups.values()];
              },
            );
            // The guide the REAL pipeline selects for this notice — the same
            // call, on the same projection, that `buildDetailModel` makes.
            const { projection } = detail;
            const guide = selectHazardGuidance(
              interpretReason({
                reasonText: projection.reasonText,
                hazardCategory: projection.hazardCategory,
                pathogenOrAllergen: projection.pathogenOrAllergen,
                summaryText: projection.summaryText,
                title: projection.title,
              }),
              {
                pathogenOrAllergen: projection.pathogenOrAllergen,
                reasonText: projection.reasonText,
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
                  hasHeroImage: model.heroImageUrl !== null,
                  productNameLength: model.productName.length,
                  healthRisk: sections.healthRisk !== null,
                  healthGuideKey: sections.healthRisk !== null && guide !== null ? guide.key : null,
                  hasCompletePairGroup: pairCompleteness.includes(false),
                  hasIncompletePairGroup: pairCompleteness.includes(true),
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

        {/* P2B0 design foundation: the shared primitives rendered from the
            tokens, so the founder can inspect them in a simulator before any
            product screen is restyled. Development-only, like this whole hub. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          DESIGN FOUNDATION
        </ThemedText>
        <Surface
          background="background/page"
          radius={16}
          border="border/subtle"
          style={styles.card}>
          <Text variant="caption" color="text/secondary">
            {CUSTOM_FONTS_INSTALLED
              ? `Type scale in ${fontFamily.sans} and ${fontFamily.mono}.`
              : `Type scale at the approved sizes and weights. ${fontFamily.sans} and ${fontFamily.mono} are not installed yet, so the platform face stands in.`}
          </Text>
          {(Object.keys(typography) as TypographyVariant[]).map((variant) => (
            <Text key={variant} variant={variant}>
              {variant === 'label' || variant === 'label-strong'
                ? variant.toUpperCase()
                : `${variant} · ${typography[variant].fontSize}/${typography[variant].fontWeight}`}
            </Text>
          ))}
        </Surface>
        <View style={styles.badges}>
          <Surface radius={16} border="border/subtle" elevation="card" style={styles.swatch}>
            <Text variant="body-small">Card surface · elevated</Text>
          </Surface>
          <Surface background="background/subtle" radius={8} style={styles.swatch}>
            <Text variant="body-small">Information callout surface</Text>
          </Surface>
          <Surface background="background/media-placeholder" radius={8} style={styles.swatch}>
            <Text variant="body-small" color="text/secondary">
              Media placeholder
            </Text>
          </Surface>
        </View>
        <Surface radius={16} border="border/subtle" style={styles.card}>
          <Text variant="body-small" color="text/secondary">
            The shared disclosure control, collapsed and expanded. Its words come from the real
            presentation contract; tap it to toggle.
          </Text>
          <DisclosureControl
            control={disclosureControl(22, 'lot codes')}
            expanded={sampleExpanded}
            onPress={() => setSampleExpanded((prior) => !prior)}
          />
        </Surface>

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          RISK LABELS
        </ThemedText>
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            All seven consumer labels, rendered by the product’s own Risk Label through the real
            riskView pipeline — the same words, casing and spoken labels a live recall gets.
          </ThemedText>
          <View style={styles.badges}>
            {RISK_FILTER_TIERS.map((tier) => {
              const risk = riskView(TIER_SAMPLE[tier], 'FDA');
              return (
                <RiskLabel
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

        {/* P2B1: the Feed's card, controls and states, rendered by the
            production components over REAL recalls from the live feed
            session. What is simulated is named on the gallery itself. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          FEED CARD MATRIX
        </ThemedText>
        <FeedCardGallery items={feed.state.status === 'ready' ? feed.state.items : []} />

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          FEED CONTROLS AND STATES
        </ThemedText>
        <FeedControlsGallery />

        {/* P2B2: Recall Detail's whole-screen states with their real copy,
            and the two Information Callout tones. Everything else on Detail
            is inspected on the real screen through the scenarios below. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          DETAIL STATES AND CALLOUTS
        </ThemedText>
        <DetailStatesGallery />

        {/* P2B3: the questionnaire's steps and states, rendered by the real
            step components over choices a real eligible recall allows. The
            flows themselves — submit, edit, remove, refuse, pause — are
            walked on the real screen through the scenarios below. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          QUESTIONNAIRE STEPS AND STATES
        </ThemedText>
        <QuestionnaireGallery source={selectionFor('reportable_with_retailers')} />

        {/* P2B4: the Saved tab's whole-screen states with their real copy,
            and its list — the same shared card the Feed draws — over real
            recalls chosen for the shapes a saved list has to survive. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          SAVED STATES AND LIST
        </ThemedText>
        <SavedGallery items={feed.state.status === 'ready' ? feed.state.items : []} />

        {/* P2B5: the live Profile's own components — the featured
            Personalization card in every answer the store can give, a grouped
            section with the chevron rows and the value row, and the
            development entry — imported from production, never copied. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          PROFILE COMPONENTS AND STATES
        </ThemedText>
        <ProfileGallery />

        {/* P2B6A: the Personalization screen's own sections and the
            Notifications screen's own panel — imported from production,
            never copied — in every state each screen can reach. Each
            sample holds its state in memory here: nothing below reads or
            writes a preference, registers a token, or asks the operating
            system for permission. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          PERSONALIZATION STATES
        </ThemedText>
        <PersonalizationGallery />

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          NOTIFICATION STATES
        </ThemedText>
        <NotificationsGallery />

        {/* P2B6B: the trust documents' shared renderer and content blocks —
            imported from production, never copied — over the registry's own
            real content, plus the reset panel in every state with its press
            wired to nothing: nothing below can start a deletion, and no
            document is rewritten here. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          DOCUMENT RENDERER AND STATES
        </ThemedText>
        <DocumentGallery />

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
        {DESIGN_PREVIEW_SCENARIOS.map((scenario, index) => {
          const selection = selectionFor(scenario.requirement);
          const firstOfGroup =
            index === 0 || DESIGN_PREVIEW_SCENARIOS[index - 1].group !== scenario.group;
          return (
            <Pressable
              key={scenario.id}
              accessibilityRole="button"
              accessibilityLabel={scenario.title}
              accessibilityState={{ disabled: selection === null }}
              disabled={selection === null}
              onPress={() => open(scenario)}>
              {firstOfGroup ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.groupLabel}>
                  {GROUP_LABELS[scenario.group]}
                </ThemedText>
              ) : null}
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

/**
 * The Recall Card's four states and its long-content and geography cases,
 * each on a REAL current recall chosen from the live feed for the shape it
 * has. Two values, and only two, are simulated, and the gallery says so on
 * screen: the Affects-you flag (so the relevance state can be inspected
 * without a matching personalization), and — only if every live recall
 * happens to carry an image — the missing image on the "no image" cards.
 * Tapping a card opens the real Recall Detail; Save writes this device's
 * own bookmark list and nothing else.
 */
function FeedCardGallery({ items }: { items: FeedItem[] }) {
  const today = todayIso();
  const models = useMemo(
    () => items.map((item) => buildHomeCardModel(item, { today, affectsYou: false })),
    [items, today],
  );
  if (models.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No live recalls loaded yet, so no card can be shown.
      </ThemedText>
    );
  }

  const withImage = models.find((model) => model.heroImageUrl !== null) ?? models[0];
  const liveWithoutImage = models.find((model) => model.heroImageUrl === null) ?? null;
  const withoutImage = liveWithoutImage ?? { ...withImage, heroImageUrl: null };
  const longest = (pick: (model: HomeCardModel) => string | null) =>
    models.reduce(
      (best, model) => ((pick(model)?.length ?? 0) > (pick(best)?.length ?? 0) ? model : best),
      models[0],
    );
  const longTitle = longest((model) => model.productName);
  const longSummary = longest((model) => model.reasonLine);
  const nationwide = models.find((model) => model.locationSummary === 'Nationwide') ?? null;
  const multiState = models.find((model) => model.locationSummary.includes('+')) ?? null;
  const alert = models.find((model) => model.noticeLabel !== null) ?? null;

  const cases: { caption: string; model: HomeCardModel }[] = [
    {
      caption: 'Affects you · image (relevance simulated)',
      model: { ...withImage, affectsYou: true },
    },
    {
      caption: `Affects you · no image (relevance simulated${liveWithoutImage ? '' : '; image removed'})`,
      model: { ...withoutImage, affectsYou: true },
    },
    { caption: 'Does not affect you · image', model: withImage },
    {
      caption: `Does not affect you · no image${liveWithoutImage ? '' : ' (image removed)'}`,
      model: withoutImage,
    },
    { caption: 'Longest product name in the live feed', model: longTitle },
    { caption: 'Longest summary in the live feed', model: longSummary },
    ...(nationwide ? [{ caption: 'Nationwide distribution', model: nationwide }] : []),
    ...(multiState
      ? [{ caption: 'Multi-state distribution (two codes, then +N)', model: multiState }]
      : []),
    ...(alert ? [{ caption: 'Public Health Alert notice label', model: alert }] : []),
  ];

  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        Real recalls from the live feed, drawn by the product’s own Recall Card on the page colour.
        Only the values each caption names are simulated. Tapping a card opens the real Recall
        Detail; Save writes only this device’s bookmark list, so the saved and unsaved states can be
        inspected by tapping it.
      </Text>
      {cases.map(({ caption, model }, index) => (
        <View key={`${index}-${model.id}`} style={styles.feedCase}>
          <Text variant="caption" color="text/secondary">
            {caption}
          </Text>
          <RecallCard model={model} />
        </View>
      ))}
    </Surface>
  );
}

/**
 * The Saved tab (P2B4): its whole-screen states with their real copy, its
 * two information notices, and its list — drawn by the SAME shared
 * `RecallCard` the Feed uses, at the same rhythm, over real current recalls
 * chosen from the live feed for the shapes a saved list has to survive (one
 * item, several, a long product name, no image, nationwide, multi-state, a
 * Public Health Alert, and one card per risk label the live corpus holds).
 *
 * Nothing here reads or writes the device's saved list: the gallery composes
 * cards from feed items directly, so no state below is this device's real
 * bookmark state, and no card here is missing because it was not saved. The
 * cards are live, so a card's own Save control writes this device's bookmark
 * list exactly as it does on the Feed — the gallery itself never toggles it.
 *
 * The missing-from-feed notice is shown on a simulated count, because it
 * appears only once a saved recall leaves the active corpus; the caption
 * says so.
 */
function SavedGallery({ items }: { items: FeedItem[] }) {
  const today = todayIso();
  const models = useMemo(
    () => items.map((item) => buildHomeCardModel(item, { today, affectsYou: false })),
    [items, today],
  );

  const longest = (pick: (model: HomeCardModel) => string | null) =>
    models.reduce(
      (best, model) => ((pick(model)?.length ?? 0) > (pick(best)?.length ?? 0) ? model : best),
      models[0],
    );
  const withImage = models.find((model) => model.heroImageUrl !== null) ?? models[0];
  const liveWithoutImage = models.find((model) => model.heroImageUrl === null) ?? null;
  const nationwide = models.find((model) => model.locationSummary === 'Nationwide') ?? null;
  const multiState = models.find((model) => model.locationSummary.includes('+')) ?? null;
  const alert = models.find((model) => model.noticeLabel !== null) ?? null;
  const byTier = RISK_FILTER_TIERS.map((tier) => ({
    tier,
    model: models.find((model) => model.risk.tier === tier) ?? null,
  }));
  const absentTiers = byTier.filter((entry) => entry.model === null).map((entry) => entry.tier);

  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        Saved’s whole-screen states with their real copy from lib/saved-recalls, then its list drawn
        by the product’s own Recall Card at the Feed’s rhythm over real recalls from the live feed.
        The gallery neither reads nor writes this device’s saved list, so nothing below reflects
        what is actually saved; tapping a card opens the real Recall Detail, and its Save control
        writes this device’s bookmark list exactly as it does on the Feed.
      </Text>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...SAVED_LOADING} />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...SAVED_EMPTY} icon="bookmark" />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage
          title={SAVED_ERROR_TITLE}
          body="The feed session’s own error message renders here. Nothing saved on this device is removed by a failed read."
        />
      </Surface>
      <Text variant="caption" color="text/secondary">
        The two notices: a refresh that failed over a feed already on screen, and — on a simulated
        count of two, because it appears only once a saved recall leaves the active corpus — saved
        recalls the active feed no longer carries.
      </Text>
      <Callout tone="information">{FEED_STALE_NOTICE}</Callout>
      <Callout tone="information">{savedMissingNotice(2) ?? ''}</Callout>
      {models.length === 0 ? (
        <Text variant="caption" color="text/secondary">
          No live recalls loaded yet, so no saved list can be shown.
        </Text>
      ) : (
        <>
          <View style={styles.feedCase}>
            <Text variant="caption" color="text/secondary">
              One saved recall
            </Text>
            <RecallCard model={models[0]} />
          </View>
          <View style={styles.feedCase}>
            <Text variant="caption" color="text/secondary">
              Several saved recalls, newest save first, 16px apart
            </Text>
            {models.slice(0, 3).map((model) => (
              <RecallCard key={model.id} model={model} />
            ))}
          </View>
          <View style={styles.feedCase}>
            <Text variant="caption" color="text/secondary">
              Longest product name in the live feed
            </Text>
            <RecallCard model={longest((model) => model.productName)} />
          </View>
          <View style={styles.feedCase}>
            <Text variant="caption" color="text/secondary">
              {liveWithoutImage ? 'No image' : 'No image (image removed from a live recall)'}
            </Text>
            <RecallCard model={liveWithoutImage ?? { ...withImage, heroImageUrl: null }} />
          </View>
          {nationwide ? (
            <View style={styles.feedCase}>
              <Text variant="caption" color="text/secondary">
                Nationwide distribution
              </Text>
              <RecallCard model={nationwide} />
            </View>
          ) : null}
          {multiState ? (
            <View style={styles.feedCase}>
              <Text variant="caption" color="text/secondary">
                Multi-state distribution (two codes, then +N)
              </Text>
              <RecallCard model={multiState} />
            </View>
          ) : null}
          {alert ? (
            <View style={styles.feedCase}>
              <Text variant="caption" color="text/secondary">
                Public Health Alert notice label
              </Text>
              <RecallCard model={alert} />
            </View>
          ) : null}
          {byTier.map(({ tier, model }) =>
            model === null ? null : (
              <View key={tier} style={styles.feedCase}>
                <Text variant="caption" color="text/secondary">
                  Risk label · {tier}
                </Text>
                <RecallCard model={model} />
              </View>
            ),
          )}
          {absentTiers.length > 0 ? (
            <Text variant="caption" color="text/secondary">
              No current recall in the live feed carries: {absentTiers.join(', ')}. Every risk label
              is rendered on its own in the RISK LABELS gallery above.
            </Text>
          ) : null}
        </>
      )}
    </Surface>
  );
}

/**
 * The live Profile's components in the states the shipped screen can reach,
 * each handed a SIMULATED answer its caption names — the gallery reads no
 * store and writes none, so nothing here reflects this device's real
 * preferences. Every card and row is live: a card opens the real
 * Personalization screen, a row the real document.
 */
function ProfileGallery() {
  const ready = (prefs: Parameters<typeof summarizePreferences>[0]): PreferenceSummaryState => ({
    status: 'ready',
    summary: summarizePreferences(prefs),
  });
  const states: [caption: string, state: PreferenceSummaryState][] = [
    ['Loading — simulated: a read that has not answered', { status: 'loading' }],
    [
      'Empty preferences — simulated: the store answered with nothing chosen',
      ready(EMPTY_PREFERENCES),
    ],
    [
      'Populated — simulated: California, Peanuts and Milk, Costco and Trader Joe’s',
      ready({ state: 'CA', allergens: ['peanut', 'milk'], retailers: ['costco', 'trader-joes'] }),
    ],
    [
      'Long — simulated: District of Columbia, four allergens and three stores, summarized to two names and +N',
      ready({
        state: 'DC',
        allergens: ['peanut', 'tree nuts', 'milk', 'egg'],
        retailers: ['walmart', 'target', 'costco'],
      }),
    ],
    ['Read failure — simulated: the store could not be read', { status: 'unavailable' }],
  ];
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The Profile tab’s own components (components/profile), imported from production. Each
        Personalization card below is handed the simulated answer its caption names — this gallery
        neither reads nor writes this device’s preferences — and opens the real Personalization
        screen; the rows open the real documents.
      </Text>
      {states.map(([caption, state]) => (
        <GallerySample key={caption} caption={caption}>
          <PersonalizationCard
            label="Personalization"
            href="/settings/personalization"
            state={state}
          />
        </GallerySample>
      ))}
      <GallerySample caption="A grouped section: chevron rows, a value row, and a footnote caption">
        <ProfileSection title="App" footnote="A quiet caption associated with the group.">
          <NavigationRow
            label="Sources & Methodology"
            href={{ pathname: '/document/[slug]', params: { slug: 'sources-methodology' } }}
            hint={DOCUMENT_HINT}
          />
          <NavigationRow
            label="Privacy & Data Controls"
            summary="A row with its supporting line."
            href={{ pathname: '/document/[slug]', params: { slug: 'privacy-data-controls' } }}
            hint={DOCUMENT_HINT}
          />
          <ValueRow label={APP_VERSION_LABEL} value={versionLine(null, null)} />
        </ProfileSection>
      </GallerySample>
      <GallerySample caption="The development entry (renders only in a development build)">
        <DevelopmentEntry
          label="Design Preview"
          summary="Local tooling for screenshotting shopper-report states. Not part of the product."
          href="/design-preview"
        />
      </GallerySample>
    </Surface>
  );
}

/**
 * The Feed's controls and whole-screen states: the search bar, the chips in
 * both states, the relevance label, the icon set, and the state message with
 * the Feed's real copy. The controls here are live but wired to nothing —
 * they narrow no feed and open no sheet.
 */
function FeedControlsGallery() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'all' | 'affects_me'>('all');
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        Live controls wired to nothing: the search bar, the feed-mode pair, a filter chip in both
        states, the relevance label and the icon set. Below them, the Feed’s state messages with
        their real copy — the loading sample does not announce itself here.
      </Text>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search product, company, brand, or code"
        accessibilityLabel="Sample search"
      />
      <View style={styles.badges}>
        <Chip label="All" selected={mode === 'all'} onPress={() => setMode('all')} />
        <Chip
          label="Affects me"
          selected={mode === 'affects_me'}
          onPress={() => setMode('affects_me')}
        />
        <Chip label="Location" selected={false} trailingIcon="chevron-down" onPress={() => {}} />
        <Chip label="Location · 2" selected trailingIcon="chevron-down" onPress={() => {}} />
      </View>
      <RelevanceLabel />
      <View style={styles.badges}>
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} size={24} />
        ))}
      </View>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...FEED_LOADING} />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...FEED_EMPTY_SEARCH} />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage
          title={FEED_ERROR_TITLE}
          body="The feed session’s own error message renders here."
        />
      </Surface>
      <Surface background="background/subtle" radius={12} style={styles.feedCase}>
        <Text variant="heading-3">{PERSONALIZE_CTA.title}</Text>
        <Text variant="body-small">{PERSONALIZE_CTA.body}</Text>
      </Surface>
    </Surface>
  );
}

/**
 * Recall Detail's loading, not-found and load-failure messages with the real
 * copy from lib/detail-copy.ts (the loading sample does not announce itself
 * here), and the Information Callout in both tones on sample sentences —
 * the real affects-you and retracted-notice sentences are the presentation
 * contract's and render only on a real Detail.
 */
function DetailStatesGallery() {
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        Recall Detail’s whole-screen states with their real copy, and the Information Callout in its
        warning and information tones on sample sentences. The loading sample does not announce
        itself here.
      </Text>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...DETAIL_LOADING} />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...DETAIL_MISSING} />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage
          title={DETAIL_ERROR_TITLE}
          body="The load failure’s own error message renders here."
        />
      </Surface>
      <Callout tone="warning">Sample warning callout — the affects-you treatment.</Callout>
      <Callout tone="information">
        Sample information callout — the retracted-notice treatment.
      </Callout>
    </Surface>
  );
}

/**
 * The questionnaire's steps and states, one under another, drawn by the
 * real step components (components/report-questionnaire) so a screenshot is
 * of the product's own composition. The choices are a real eligible recall's
 * own — its jurisdictions and the retailers its notice names — narrowed or
 * widened only to give each step the shape it demonstrates: one state for
 * the confirm, the supported-jurisdiction registry for the searchable list.
 * Every caption names which. Rows here are live so the chosen state can be
 * inspected; Next, Back, Submit and Done are wired to nothing, and nothing
 * here reads or writes shopper-report state.
 *
 * A recall with no official geography is ineligible for reports, so it has
 * no questionnaire at all: the gallery shows the screen's own unavailable
 * state for it rather than a form that could never be submitted.
 */
function QuestionnaireGallery({ source }: { source: ScreenedCandidate | null }) {
  const states = source?.allowedStateCodes ?? [];
  const retailers = source?.retailerChoices ?? [];
  const singleState: QuestionnaireChoices = {
    allowedStateCodes: states.length > 0 ? [states[0]] : SUPPORTED_STATE_CODES.slice(0, 1),
    retailerChoices: [],
  };
  const multiState: QuestionnaireChoices = {
    allowedStateCodes: states.length > 1 ? states : SUPPORTED_STATE_CODES.slice(0, 4),
    retailerChoices: retailers,
  };
  const nationwide: QuestionnaireChoices = {
    allowedStateCodes: SUPPORTED_STATE_CODES,
    retailerChoices: retailers,
  };
  const withRetailers: QuestionnaireChoices = {
    allowedStateCodes: multiState.allowedStateCodes,
    retailerChoices: retailers,
  };
  // A complete set of answers from the section's own first choices, for the
  // review samples. Never a state or store the section does not offer.
  const complete: QuestionnaireAnswers = {
    declined: false,
    stateCode: withRetailers.allowedStateCodes[0],
    retailer: retailers[0] ?? RETAILER_NOT_SURE,
    purchaseWindow: 'past_month',
  };
  const noop = () => {};
  const origin =
    source === null ? 'the supported-jurisdiction registry' : 'a real recall’s own choices';

  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The questionnaire’s steps and states, drawn by the real step components. Choices come from{' '}
        {origin}; each caption says which. Rows are live; Next, Back, Submit and Done are wired to
        nothing, and no shopper-report state is read or written here. A recall with no official
        geography is ineligible for reports altogether, so it has no questionnaire to show — the
        screen’s own unavailable state stands for it.
      </Text>
      <GallerySample caption="Single-state confirmation — the notice’s first state alone">
        <LiveQuestion section={singleState} stepKey="state" />
      </GallerySample>
      <GallerySample
        caption={`Multi-state picker — ${
          states.length > 1 ? 'the notice’s own states' : 'four registry states, unsearched'
        }`}>
        <LiveQuestion section={multiState} stepKey="state" />
      </GallerySample>
      <GallerySample caption="Nationwide — every supported jurisdiction behind the search field">
        <LiveQuestion section={nationwide} stepKey="state" />
      </GallerySample>
      <GallerySample caption="Unknown geography — ineligible: the questionnaire is never reached, and a deep link lands here">
        <StateMessage {...REPORT_UNAVAILABLE} />
      </GallerySample>
      {retailers.length > 0 ? (
        <GallerySample caption="Retailer choices — the notice’s own canonical stores, plus not sure">
          <LiveQuestion section={withRetailers} stepKey="retailer" />
        </GallerySample>
      ) : (
        <Text variant="body-small" color="text/secondary">
          No eligible recall in the live feed names a retailer, so the store question cannot be
          shown here.
        </Text>
      )}
      <GallerySample caption="Purchase timeframe — the five closed buckets, one chosen">
        <LiveQuestion
          section={withRetailers}
          stepKey="window"
          initial={{ ...EMPTY_ANSWERS, purchaseWindow: 'past_month' }}
        />
      </GallerySample>
      <GallerySample caption="Review and disclosure — a first submission">
        <ReviewStep
          section={withRetailers}
          answers={complete}
          canSubmit
          busy={null}
          failure={null}
          onSubmit={noop}
          onBack={noop}
          onOpenPrivacy={noop}
          mode="submit"
        />
      </GallerySample>
      <GallerySample caption="Review while editing — the update action and the removal control">
        <ReviewStep
          section={withRetailers}
          answers={complete}
          canSubmit
          busy={null}
          failure={null}
          onSubmit={noop}
          onBack={noop}
          onOpenPrivacy={noop}
          mode="update"
          onRemove={noop}
        />
      </GallerySample>
      <GallerySample caption="Recoverable error — the submission was refused; answers stay">
        <ReviewStep
          section={withRetailers}
          answers={complete}
          canSubmit
          busy={null}
          failure={SUBMIT_FAILURE}
          onSubmit={noop}
          onBack={noop}
          onOpenPrivacy={noop}
          mode="submit"
        />
      </GallerySample>
      <GallerySample caption="Success">
        <OutcomeStep title={SUCCESS_TITLE} body={SUCCESS_BODY} onDone={noop} />
      </GallerySample>
      <GallerySample caption="Reporting paused with an existing report — removal only">
        <PausedStep busy={false} failure={null} onRemove={noop} />
      </GallerySample>
      <GallerySample caption="Reporting paused — a refused removal">
        <PausedStep busy={false} failure={REMOVE_FAILURE} onRemove={noop} />
      </GallerySample>
    </Surface>
  );
}

/** Preferences held in this gallery's memory alone, so the sections can be worked. */
function LivePreferences({ initial }: { initial: UserRecallPreferences }) {
  const [prefs, setPrefs] = useState<UserRecallPreferences>(initial);
  return (
    <View style={styles.formSample}>
      <PersonalizationForm prefs={prefs} onChange={setPrefs} />
    </View>
  );
}

/** The state row alone, its choice held here; the trigger opens the real sheet. */
function LiveState({ initial }: { initial: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return <StateSection value={value} onChange={setValue} />;
}

/** The state selector's contents inline: the sheet's search, Clear and radio rows. */
function LiveStateContent({
  initial,
  initialQuery = '',
}: {
  initial: string | null;
  initialQuery?: string;
}) {
  const [value, setValue] = useState<string | null>(initial);
  const noop = () => {};
  return (
    <StateSelectorContent
      value={value}
      onChange={setValue}
      onDone={noop}
      initialQuery={initialQuery}
    />
  );
}

/** The store row alone, its list held here; the trigger opens the real sheet. */
function LiveStores({ initial }: { initial: string[] }) {
  const [selected, setSelected] = useState<string[]>(initial);
  const toggle = (id: string) =>
    setSelected((prior) => (prior.includes(id) ? prior.filter((r) => r !== id) : [...prior, id]));
  return <StoreSection selected={selected} onToggle={toggle} />;
}

/** The store selector's contents inline, with the sheet's count line above. */
function LiveStoreContent({
  initial,
  initialQuery = '',
}: {
  initial: string[];
  initialQuery?: string;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const toggle = (id: string) =>
    setSelected((prior) => (prior.includes(id) ? prior.filter((r) => r !== id) : [...prior, id]));
  return (
    <View style={styles.formSample}>
      <Text variant="body-small" color="text/secondary" accessibilityLiveRegion="polite">
        {storeCountLabel(selected.length)}
      </Text>
      <StoreSelectorContent selected={selected} onToggle={toggle} initialQuery={initialQuery} />
    </View>
  );
}

/**
 * The Personalization screen's sections and selectors in every state the
 * screen can reach. Each sample's preferences live in this gallery's memory:
 * choosing here changes the sample and nothing else — no store is imported,
 * so nothing can be saved or synced, and no sample contacts a backend.
 */
function PersonalizationGallery() {
  const populated: UserRecallPreferences = {
    state: 'CA',
    allergens: ['peanut', 'milk'],
    retailers: ['costco', 'trader-joes'],
  };
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The Personalization screen’s own sections and selectors (components/settings), imported from
        production. Every sample below is simulated in this gallery’s memory: it neither reads nor
        writes this device’s preferences, and choosing here saves nothing. A row opens its real
        sheet over this gallery; the selector samples show the sheet’s contents inline.
      </Text>
      <GallerySample caption="Loading — simulated: a read that has not answered">
        <PreferencesNotReady status="loading" />
      </GallerySample>
      <GallerySample caption="Empty selections — simulated: the store answered with nothing chosen">
        <LivePreferences initial={EMPTY_PREFERENCES} />
      </GallerySample>
      <GallerySample caption="Populated — simulated: California, Peanuts and Milk, Costco and Trader Joe’s">
        <LivePreferences initial={populated} />
      </GallerySample>
      <GallerySample caption="Read failure — simulated: the store could not be read">
        <PreferencesNotReady status="failed" />
      </GallerySample>

      <GallerySample caption="State row, no selection — simulated: nothing chosen; the row opens the real sheet">
        <LiveState initial={null} />
      </GallerySample>
      <GallerySample caption="State row, existing selection — simulated: California">
        <LiveState initial="CA" />
      </GallerySample>
      <GallerySample caption="State selector, search — simulated: “new” typed, four rows match">
        <LiveStateContent initial={null} initialQuery="new" />
      </GallerySample>
      <GallerySample caption="State selector, clear while open — simulated: California checked; Clear selection empties it and the list stays">
        <LiveStateContent initial="CA" />
      </GallerySample>
      <GallerySample caption="State selector, replace — simulated: Nevada checked; choosing another row replaces it (on the sheet, that also closes it)">
        <LiveStateContent initial="NV" />
      </GallerySample>

      <GallerySample caption="Store row, none selected — simulated: the row reads No stores selected and offers Add stores">
        <LiveStores initial={[]} />
      </GallerySample>
      <GallerySample caption="Store row, several selected — simulated: Costco, Trader Joe’s and Walmart, with Edit stores">
        <LiveStores initial={['costco', 'trader-joes', 'walmart']} />
      </GallerySample>
      <GallerySample caption="Store row, long names — simulated: five long catalog names wrapping in the row">
        <LiveStores initial={['whole-foods', 'sprouts', 'giant-food', 'tops', 'pcc']} />
      </GallerySample>
      <GallerySample caption="Store selector, no query — simulated: nothing chosen, the whole catalog in order">
        <LiveStoreContent initial={[]} />
      </GallerySample>
      <GallerySample caption="Store selector, filtered — simulated: “co” typed">
        <LiveStoreContent initial={[]} initialQuery="co" />
      </GallerySample>
      <GallerySample caption="Store selector, several checked in place — simulated: Albertsons, Costco and Kroger checked; checking more never moves a row">
        <LiveStoreContent initial={['albertsons', 'costco', 'kroger']} />
      </GallerySample>
      <GallerySample caption="Store selector, no results — simulated: a search no store matches">
        <LiveStoreContent initial={[]} initialQuery="zzzz" />
      </GallerySample>
    </Surface>
  );
}

/**
 * The Notifications screen's panel in every permission state. The views
 * are handed in; the three callbacks do nothing, so no sample can request
 * permission, register a token, or open system settings.
 */
function NotificationsGallery() {
  const noop = () => {};
  const ready = (
    alerts: 'not_enabled' | 'enabled' | 'denied',
    error: string | null = null,
  ): NotificationsView => ({ status: 'ready', alerts, busy: false, error });
  const views: [caption: string, view: NotificationsView][] = [
    ['Loading — simulated: the status read has not answered', { status: 'loading' }],
    [
      'Not determined — simulated: never asked, so not enabled here; the action is the explicit enable',
      ready('not_enabled'),
    ],
    ['Enabled — simulated: permission granted and this device registered', ready('enabled')],
    [
      'Denied but askable — simulated: the OS reported a denial it can ask again about, which the status model shows as not enabled (the same screen)',
      ready('not_enabled'),
    ],
    [
      'System settings required — simulated: denied and cannot be asked again; the action opens system settings',
      ready('denied'),
    ],
    ['Unavailable / unsupported — simulated: the web', { status: 'unsupported' }],
    [
      'Operation failure — simulated: the enable was attempted and threw; the message reads beneath the action',
      ready('not_enabled', GENERIC_FAILURE),
    ],
  ];
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The Notifications screen’s own panel (components/settings), imported from production. Every
        view below is simulated: nothing here reads the permission, and the actions are wired to
        nothing — no prompt, no registration, no system settings.
      </Text>
      {views.map(([caption, view]) => (
        <GallerySample key={caption} caption={caption}>
          <NotificationsPanel view={view} onEnable={noop} onDisable={noop} onOpenSettings={noop} />
        </GallerySample>
      ))}
    </Surface>
  );
}

function GallerySample({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <View style={styles.feedCase}>
      <Text variant="caption" color="text/secondary">
        {caption}
      </Text>
      {children}
    </View>
  );
}

/** The first block of a kind in a registered document — real content, never a sample sentence. */
function documentBlock(slug: string, kind: DocumentBlock['kind']): DocumentBlock | null {
  const doc = documentBySlug(slug);
  if (!doc) return null;
  for (const section of doc.sections) {
    const block = section.blocks.find((candidate) => candidate.kind === kind);
    if (block) return block;
  }
  return null;
}

function documentSection(slug: string, title: string): TrustDocument['sections'][number] | null {
  return documentBySlug(slug)?.sections.find((section) => section.title === title) ?? null;
}

/**
 * The trust documents' renderer (components/document) and the reset panel
 * (components/installation-reset-section), imported from production, over
 * the registry's own content. Every document sample is REAL content — the
 * shortest and the longest registered document in full, and one real block
 * of each kind — because a rendered sample sentence would prove nothing
 * about the documents. The reset panel's states are simulated: each is the
 * panel with its state handed in and its press wired to nothing, so no
 * sample can open the dialog or start a run; the confirming state is the
 * dialog's own words as text, because the dialog itself is the platform's.
 */
function DocumentGallery() {
  const noop = () => {};
  const byLength = [...TRUST_DOCUMENTS].sort((a, b) => documentLength(a) - documentLength(b));
  const shortest = byLength[0];
  const longest = byLength[byLength.length - 1];
  const prose = documentSection('how-affects-me-works', 'How allergen matching works');
  const bulletsBlock = documentBlock('privacy-data-controls', 'bullets');
  const internalLink = documentBlock('how-affects-me-works', 'document-link');
  const externalLink = documentBlock('sources-methodology', 'link');
  const noteBlock = documentBlock('safety-disclaimer', 'note');
  const riskDoc = documentBySlug('risk-levels');
  const riskBlocks = (riskDoc?.sections ?? [])
    .flatMap((section) => section.blocks)
    .filter((block) => block.kind === 'risk-levels');
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The trust documents’ shared renderer and blocks (components/document), imported from
        production, over the registry’s own real content. Nothing here is rewritten or invented. The
        reset panel below is the production panel with each state handed in and its press wired to
        nothing: no sample can open the confirmation or start a deletion.
      </Text>
      <GallerySample
        caption={`Short document — real: ${shortest.title}, the shortest registered document, in full`}>
        <DocumentView doc={shortest} />
      </GallerySample>
      <GallerySample
        caption={`Long document — real: ${longest.title}, the longest registered document, in full`}>
        <DocumentView doc={longest} />
      </GallerySample>
      {prose ? (
        <GallerySample caption="Paragraphs and a section heading — real: one section of How Affects Me Works">
          <DocumentSectionView section={prose} />
        </GallerySample>
      ) : null}
      {bulletsBlock ? (
        <GallerySample caption="Bulleted list — real: the first list in Privacy & Data Controls (no document holds a numbered list, so the model has none)">
          <DocumentBlockView block={bulletsBlock} />
        </GallerySample>
      ) : null}
      {internalLink ? (
        <GallerySample caption="Internal link — real: How Affects Me Works’ link to Privacy & Data Controls; tapping opens the real document">
          <DocumentBlockView block={internalLink} />
        </GallerySample>
      ) : null}
      {externalLink ? (
        <GallerySample caption="External link — real: Sources & Methodology’s first official-source link; tapping opens its exact URL in the browser">
          <DocumentBlockView block={externalLink} />
        </GallerySample>
      ) : null}
      {noteBlock ? (
        <GallerySample caption="Information callout — real: the Safety Disclaimer’s medical-advice note (a note block)">
          <DocumentBlockView block={noteBlock} />
        </GallerySample>
      ) : null}
      <GallerySample caption="Warning callout — simulated: the primitive on a labelled sample sentence, for comparison; no document block uses the lime tone, which is personal relevance only">
        <Callout tone="warning">
          Sample warning callout: the lime tone is for personal relevance.
        </Callout>
      </GallerySample>
      {riskBlocks.length > 0 ? (
        <GallerySample caption="Risk-label explanation — real: Risk Levels Explained’s label rows, the five levels and the two states, drawn by the production Risk Label">
          <View style={styles.formSample}>
            {riskBlocks.map((block, index) => (
              <DocumentBlockView key={index} block={block} />
            ))}
          </View>
        </GallerySample>
      ) : null}
      <GallerySample caption="Dense comparison — real: the same label rows are the registry’s only comparison; there is no table block, and nothing on a document scrolls sideways">
        {riskBlocks[0] ? <DocumentBlockView block={riskBlocks[0]} /> : null}
      </GallerySample>
      <GallerySample caption="Reset section, idle — simulated: the panel before a tap; the press is wired to nothing">
        <ResetPanel state="idle" onPress={noop} />
      </GallerySample>
      <GallerySample caption="Reset section, confirming — simulated: the platform dialog’s own words, as text; the dialog opens only from the real screen">
        <Surface radius={12} border="border/strong" style={styles.feedCase}>
          <Text variant="heading-3" accessibilityRole="header">
            {RESET_CONFIRM_TITLE}
          </Text>
          <Text variant="body-small">{RESET_CONFIRM_BODY}</Text>
          <Text variant="body-small-bold" color="action/secondary">
            {`${RESET_CONFIRM_CANCEL} · ${RESET_CONFIRM_DELETE}`}
          </Text>
        </Surface>
      </GallerySample>
      <GallerySample caption="Reset section, busy — simulated: a run in flight; the button is inert and reads Deleting…">
        <ResetPanel state="running" onPress={noop} />
      </GallerySample>
      <GallerySample caption="Reset section, success — simulated: the run finished and the data was deleted">
        <ResetPanel state="deleted" onPress={noop} />
      </GallerySample>
      <GallerySample caption="Reset section, failure — simulated: the server deletion failed, so nothing on the device changed">
        <ResetPanel state="failed" onPress={noop} />
      </GallerySample>
      <Text variant="caption" color="text/secondary">
        Accessibility-large text is a device setting the gallery cannot simulate: set the
        simulator’s text size and inspect the samples and the real documents.
      </Text>
    </Surface>
  );
}

function documentLength(doc: TrustDocument): number {
  return doc.sections.reduce((total, section) => total + section.blocks.length, 0);
}

/** One question step holding its own answers, so a row can be chosen and inspected. */
function LiveQuestion({
  section,
  stepKey,
  initial = EMPTY_ANSWERS,
}: {
  section: QuestionnaireChoices;
  stepKey: QuestionKey;
  initial?: QuestionnaireAnswers;
}) {
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(initial);
  const steps = questionnaireSteps(section);
  const outcome = questionnaireOutcome(answers, section);
  return (
    <QuestionStep
      section={section}
      stepKey={stepKey}
      stepIndex={Math.max(0, steps.indexOf(stepKey))}
      stepCount={steps.length}
      answers={answers}
      canAdvance={outcome.kind !== 'incomplete' || outcome.next !== stepKey}
      onAnswer={(patch) => setAnswers((prior) => ({ ...prior, ...patch }))}
      onBack={steps.indexOf(stepKey) > 0 ? () => {} : null}
      onNext={() => {}}
    />
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
    parts.push(sections.facts.hasHeroImage ? 'hero image' : 'no hero image');
    parts.push(`name ${sections.facts.productNameLength} chars`);
    parts.push(`guide ${sections.facts.healthGuideKey ?? 'none'}`);
  }
  parts.push(`tier ${screened.candidate.riskTier}`);
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
  groupLabel: {
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
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
  swatch: {
    padding: Spacing.three,
  },
  option: {
    padding: Spacing.two,
    borderRadius: Radii.small,
    marginTop: Spacing.one,
    gap: Spacing.half,
  },
  // The Feed galleries sit on the page colour with the Feed's own rhythm.
  feedGallery: {
    padding: spacing[16],
    gap: spacing[16],
  },
  feedCase: {
    gap: spacing[8],
    padding: spacing[12],
  },
  // The Personalization sections at the screen's own rhythm.
  formSample: {
    gap: spacing[24],
  },
});
