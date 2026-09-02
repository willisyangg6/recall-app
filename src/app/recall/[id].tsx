import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhotoThumbnail } from '@/components/photo-gallery';
import { RiskBadge } from '@/components/risk-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import type { UserRecallPreferences } from '@/domain/preferences';
import type { LotCodeSet } from '@/lib/consumer-projection';
import { loadPreferences, preferencesAvailable } from '@/lib/preferences-store';
import { fetchCaseDetail, type CaseDetail } from '@/lib/recall-feed';
import {
  buildDetailModel,
  todayIso,
  type AffectedProductsTable,
  type DetailModel,
  type WhereSoldModel,
} from '@/lib/recall-presentation';
import { evaluatePersonalRelevance } from '@/lib/relevance';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; detail: CaseDetail };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="small" themeColor="textSecondary">
        {title.toUpperCase()}
      </ThemedText>
      {children}
    </View>
  );
}

/**
 * A collapsed set of printed codes. Large sets stay behind their own step —
 * useful, never a wall of codes — and when the source paired each code with a
 * calendar date, both are shown: the date is what a person can read, the code
 * is what is actually stamped on their package.
 */
function CodeSet({
  codes,
  expanded,
  onToggle,
}: {
  codes: LotCodeSet | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!codes) return null;
  return (
    <View style={styles.step}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle}>
        <ThemedText themeColor="link" type="small">
          {expanded
            ? `Hide ${codes.label.toLowerCase()}s`
            : `${codes.label}s · ${codes.count} affected — view`}
        </ThemedText>
      </Pressable>
      {expanded ? (
        <ThemedView type="backgroundElement" style={styles.identifierRow}>
          {codes.pairs.length > 0 ? (
            codes.pairs.map((pair) => (
              <ThemedText key={pair.code} type="small">
                {pair.code} · {pair.date}
              </ThemedText>
            ))
          ) : (
            <ThemedText type="small">{codes.codes.join(', ')}</ThemedText>
          )}
        </ThemedView>
      ) : null}
    </View>
  );
}

/**
 * Where a recall reached (P2a founder decision): ONLY the full state
 * representation renders at this stage — full state names, "Nationwide", or
 * the honest unspecified line, with no trailing period. Named retailers,
 * store addresses, online routes, and channel evidence stay preserved in the
 * model for the later collapsed retailer-list milestone; no channel nouns and
 * no dead retailer control render here.
 */
function WhereItWasSold({ model }: { model: WhereSoldModel }) {
  return model.lead ? <ThemedText>{model.lead}</ThemedText> : null;
}

/**
 * The compact Affected Products table (P2b): column labels render once as the
 * uppermost row, then one affected version per row, in source order. The
 * whole table scrolls horizontally as one unit so header and row cells stay
 * aligned. An empty cell stays empty — no dash, no "unknown", no value
 * borrowed from another version. At most three rows render initially; the
 * model's `See all (N)` control reveals the rest inline and collapses again.
 * No version image or placeholder renders here (P2c owns image roles).
 */
function AffectedProductsTableView({
  table,
  expanded,
  onToggleExpanded,
}: {
  table: AffectedProductsTable;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const rows = expanded ? table.rows : table.rows.slice(0, table.initialRows);
  return (
    <View style={styles.step}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.tableRow}>
            {table.columns.map((column) => (
              <ThemedText
                key={column.key}
                type="small"
                themeColor="textSecondary"
                style={styles.tableCell}>
                {column.label.toUpperCase()}
              </ThemedText>
            ))}
          </View>
          {rows.map((row) => (
            <ThemedView key={row.id} type="backgroundElement" style={styles.tableRow}>
              {row.cells.map((cell, index) => (
                <ThemedText key={table.columns[index].key} type="small" style={styles.tableCell}>
                  {cell ?? ''}
                </ThemedText>
              ))}
            </ThemedView>
          ))}
        </View>
      </ScrollView>
      {table.seeAllLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={onToggleExpanded}>
          <ThemedText themeColor="link" type="small">
            {expanded ? 'Show fewer' : table.seeAllLabel}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function RecallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Nested disclosure: large code sets stay collapsed inside their cards,
  // keyed by the item they belong to so each opens independently.
  const [openCodeSets, setOpenCodeSets] = useState<Set<string>>(new Set());
  // Whether the Affected Products table shows every row or the initial three.
  const [tableExpanded, setTableExpanded] = useState(false);
  const [prefs, setPrefs] = useState<UserRecallPreferences | null>(null);
  const toggleCodeSet = (key: string) =>
    setOpenCodeSets((prior) => {
      const next = new Set(prior);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await fetchCaseDetail(id);
        if (cancelled) return;
        setState(detail ? { status: 'ready', detail } : { status: 'missing' });
      } catch (error) {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load this recall.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      // Read-only preference load for the affects-you banner; never prompts
      // for anything. On focus (not just mount) so a detail screen beneath
      // the stack cannot keep stale personalization after a Settings edit or
      // a C7.1 data reset.
      if (preferencesAvailable()) void loadPreferences().then(setPrefs);
    }, []),
  );

  if (state.status !== 'ready') {
    return (
      <ThemedView style={styles.messageContainer}>
        <ThemedText themeColor="textSecondary" style={styles.centeredText}>
          {state.status === 'loading'
            ? 'Loading…'
            : state.status === 'missing'
              ? 'This recall could not be found.'
              : state.message}
        </ThemedText>
      </ThemedView>
    );
  }

  const { projection } = state.detail;
  // The one deterministic mapping shared with Home (lib/recall-presentation):
  // the screen renders the model and derives no recall wording of its own.
  // Same predicate as Affects me membership — matching logic unchanged.
  const affectsYou =
    prefs !== null &&
    evaluatePersonalRelevance(
      {
        geography: projection.geography,
        pathogenOrAllergen: projection.pathogenOrAllergen,
        retailerNames: projection.retailerNames ?? [],
        hazardCategory: projection.hazardCategory,
        reasonText: projection.reasonText,
      },
      prefs,
    ).affectsMe;
  const model: DetailModel = buildDetailModel(state.detail, { today: todayIso(), affectsYou });
  const products = model.affectedProducts;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}>
        {/* Header (P2a founder decision): the risk badge upper-left with the
            ONE material activity date beside it, then product name, consumer
            brand, and the single official-source link. The "Recall · Active"
            metadata line and every explanatory risk note are gone — the badge
            states the risk by itself. A Public Health Alert keeps its
            explicit notice label (standing rule). */}
        <View style={styles.badgeRow}>
          {model.risk.headlineLabel ? (
            <RiskBadge
              tier={model.risk.tier}
              label={model.risk.headlineLabel}
              accessibilityLabel={model.risk.accessibilityLabel}
              size="large"
            />
          ) : null}
          {model.noticeTypeLabel === 'Public Health Alert' ? (
            <ThemedText type="small" themeColor="textSecondary">
              {model.noticeTypeLabel}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {model.activity.text}
          </ThemedText>
        </View>

        {model.retracted ? (
          <ThemedView type="backgroundSelected" style={styles.callout}>
            <ThemedText>{model.agencyLabel} has retracted this notice.</ThemedText>
          </ThemedView>
        ) : null}

        <ThemedText type="title">{model.productName}</ThemedText>
        <ThemedText themeColor="textSecondary">{model.brand.text}</ThemedText>
        <ThemedText
          themeColor="link"
          accessibilityRole="link"
          onPress={() => Linking.openURL(model.officialSource.url)}>
          {model.officialSource.label}
        </ThemedText>

        {/* The primary hero renders ONCE, near the title; no image repeats
            lower on the page (P2c owns full image-role allocation). */}
        {model.heroImageUrl ? (
          <PhotoThumbnail uri={model.heroImageUrl} alt={model.productName} size={160} />
        ) : null}

        {model.affectsYou ? (
          <ThemedView type="backgroundSelected" style={styles.callout}>
            <ThemedText>{model.affectsYouBanner}</ThemedText>
          </ThemedView>
        ) : null}

        <Section title="What happened">
          <ThemedText>{model.whatHappened.text}</ThemedText>
          {model.whatHappened.update ? (
            <ThemedText type="small" themeColor="textSecondary">
              {model.whatHappened.update}
            </ThemedText>
          ) : null}
          {model.illnessLine ? <ThemedText>{model.illnessLine}</ThemedText> : null}
          {model.quantityLine ? (
            <ThemedText type="small" themeColor="textSecondary">
              {model.quantityLine}
            </ThemedText>
          ) : null}
        </Section>

        {/* Where it was sold: only the full state representation (P2a founder
            decision). Retailers, addresses, online routes, and channel
            evidence stay in the model for the later retailer-list milestone. */}
        <Section title="Where it was sold">
          <WhereItWasSold model={model.whereSold} />
        </Section>

        {/* Affected Products: the gated P0A data only — no helper, coverage,
            or disclaimer prose (P2a founder decision). P2b renders the shared
            table model: headers once, one affected version per row, at most
            three rows before See all (N). The table has NO shared-facts
            section (founder decision): a fact proven to apply to every
            version arrives repeated inside each row's cells. The official
            attachment links stay preserved in the model for a later
            source/image surface — no orphan attachment link renders here. */}
        <Section title="Affected Products">
          {model.affectedProductsTable ? (
            <AffectedProductsTableView
              table={model.affectedProductsTable}
              expanded={tableExpanded}
              onToggleExpanded={() => setTableExpanded((prior) => !prior)}
            />
          ) : null}
          {/* A version's OWN collapsed code set stays attributed to that
              version: its disclosure renders beneath the table under the
              row's product name. */}
          {(model.affectedProductsTable?.rows ?? [])
            .slice(0, tableExpanded ? undefined : model.affectedProductsTable?.initialRows)
            .filter((row) => row.codes !== null)
            .map((row) => (
              <View key={`codes-${row.id}`} style={styles.step}>
                {row.name ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {row.name}
                  </ThemedText>
                ) : null}
                <CodeSet
                  codes={row.codes}
                  expanded={openCodeSets.has(`row-${row.id}`)}
                  onToggle={() => toggleCodeSet(`row-${row.id}`)}
                />
              </View>
            ))}
          {/* Production codes are opaque, so the calendar dates they stand
              for lead and the codes follow behind a tap. */}
          {products.productionDates ? (
            <ThemedText type="small">
              Affected production dates: {products.productionDates}
            </ThemedText>
          ) : null}
          <CodeSet
            codes={products.productionCodes}
            expanded={openCodeSets.has('production')}
            onToggle={() => toggleCodeSet('production')}
          />
          <CodeSet
            codes={products.caseCodes}
            expanded={openCodeSets.has('lot')}
            onToggle={() => toggleCodeSet('lot')}
          />
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  // No alignItems: 'center' here — centering the cross axis made the
  // ScrollView size to its content's intrinsic width, so long text defined a
  // canvas wider than the screen instead of wrapping. Width is constrained by
  // the content container.
  container: {
    flex: 1,
  },
  // flex: 1 so the ScrollView takes the screen height and can actually scroll.
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
  messageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  centeredText: {
    textAlign: 'center',
  },
  section: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  callout: {
    padding: Spacing.three,
    borderRadius: Radii.medium,
    marginTop: Spacing.two,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  step: {
    gap: Spacing.half,
    marginTop: Spacing.one,
  },
  identifierRow: {
    padding: Spacing.two,
    borderRadius: Radii.small,
  },
  // The Affected Products table: fixed-width cells keep the header row and
  // every data row aligned, and the whole grid scrolls horizontally as one
  // unit inside its ScrollView. Final dimensions/polish deferred to the
  // design-system pass.
  tableRow: {
    flexDirection: 'row',
    borderRadius: Radii.small,
    marginBottom: Spacing.half,
  },
  tableCell: {
    width: 148,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.one,
  },
});
