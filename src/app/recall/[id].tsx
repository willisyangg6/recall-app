import { useCallback, useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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

/** The one code set a row's in-cell control has opened, for the modal. */
interface OpenRowCodes {
  rowId: string;
  /** The row's product identity, shown as the modal's context. */
  name: string | null;
  codes: LotCodeSet;
}

/**
 * The modal a row's "View N codes" control opens: exactly that row's codes
 * and its source-supported code/date pairs, titled by the row's product
 * identity, with an explicit Close control. A plain accessible React Native
 * modal — no dependency, no navigation route; closing returns to the same
 * table position because the table never moved.
 */
function RowCodesModal({ open, onClose }: { open: OpenRowCodes | null; onClose: () => void }) {
  return (
    <Modal
      visible={open !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal>
      <View style={styles.modalBackdrop}>
        <ThemedView type="background" style={styles.modalCard}>
          {open ? (
            <>
              {open.name ? <ThemedText type="subtitle">{open.name}</ThemedText> : null}
              <ThemedText type="small" themeColor="textSecondary">
                {`${open.codes.label.toUpperCase()}S · ${open.codes.count} AFFECTED`}
              </ThemedText>
              <ScrollView style={styles.modalScroll}>
                {open.codes.pairs.length > 0 ? (
                  open.codes.pairs.map((pair) => (
                    <ThemedText key={pair.code} type="small">
                      {pair.code} · {pair.date}
                    </ThemedText>
                  ))
                ) : (
                  <ThemedText type="small">{open.codes.codes.join(', ')}</ThemedText>
                )}
              </ScrollView>
              <Pressable accessibilityRole="button" onPress={onClose}>
                <ThemedText themeColor="link">Close</ThemedText>
              </Pressable>
            </>
          ) : null}
        </ThemedView>
      </View>
    </Modal>
  );
}

/**
 * The compact Affected Products table (P2b, restructured): column labels
 * render once as the uppermost row, then one affected version per row, in
 * source order. The whole table scrolls horizontally as one unit so header
 * and row cells stay aligned. The model supplies TWO precomputed views —
 * collapsed (first three rows) and expanded — each with columns justified by
 * exactly the rows it shows, so no rendered column is ever entirely empty.
 * An empty cell stays empty — no dash, no "unknown", no value borrowed from
 * another version. A version's image renders beside its Product value only
 * when the shared image-role allocation assigned one to that exact row
 * (P2c). A row's collapsed code set renders as that row's own in-cell
 * "View N codes" control opening the row-keyed modal — the table is the only
 * affected-product presentation, and no code list renders beneath it.
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
  const [openCodes, setOpenCodes] = useState<OpenRowCodes | null>(null);
  const view = expanded ? table.expanded : table.collapsed;
  return (
    <View style={styles.step}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.tableRow}>
            {view.columns.map((column) => (
              <ThemedText
                key={column.key}
                type="small"
                themeColor="textSecondary"
                style={styles.tableCell}>
                {column.label.toUpperCase()}
              </ThemedText>
            ))}
          </View>
          {view.rows.map((row) => (
            <ThemedView key={row.id} type="backgroundElement" style={styles.tableRow}>
              {row.cells.map((cell, index) =>
                view.columns[index].key === 'product' ? (
                  // The version's own image (P2c) renders left of the Product
                  // value only when the shared allocator assigned one to this
                  // exact row — no placeholder, no reserved space otherwise.
                  <View key="product" style={[styles.tableCell, styles.productCell]}>
                    {row.image ? (
                      <PhotoThumbnail
                        uri={row.image.url}
                        alt={row.image.accessibilityText}
                        size={40}
                      />
                    ) : null}
                    <ThemedText type="small" style={styles.productCellText}>
                      {cell.text ?? ''}
                    </ThemedText>
                  </View>
                ) : cell.codes ? (
                  // This row's own collapsed code set: the in-cell control
                  // opens the modal with exactly this row's codes.
                  <View key={view.columns[index].key} style={styles.tableCell}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        setOpenCodes({ rowId: row.id, name: row.name, codes: cell.codes! })
                      }>
                      <ThemedText themeColor="link" type="small">
                        {cell.codesLabel}
                      </ThemedText>
                    </Pressable>
                  </View>
                ) : (
                  <ThemedText key={view.columns[index].key} type="small" style={styles.tableCell}>
                    {cell.text ?? ''}
                  </ThemedText>
                ),
              )}
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
      <RowCodesModal open={openCodes} onClose={() => setOpenCodes(null)} />
    </View>
  );
}

export default function RecallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Whether the Affected Products table shows every row or the initial three.
  // The only expansion state the screen holds: the retired below-table code
  // disclosures had their own, and there is nothing beneath the table now.
  const [tableExpanded, setTableExpanded] = useState(false);
  const [prefs, setPrefs] = useState<UserRecallPreferences | null>(null);
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
  // Optional sections are DECIDED by the shared contract (P3A). The screen
  // renders a section when the model gives it one and renders nothing at all
  // otherwise — no heading, no container, no spacing. It never inspects rows,
  // columns, codes, or geography to decide for itself.
  const { whereSold, affectedProducts } = model.sections;

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

        {/* The hero renders ONCE, near the title, from the shared image-role
            allocation (P2c): the same underlying asset can never also appear
            as a row image or gallery entry. Null renders nothing. */}
        {model.heroImageUrl ? (
          <PhotoThumbnail uri={model.heroImageUrl} alt={model.productName} size={160} />
        ) : null}

        {model.affectsYou ? (
          <ThemedView type="backgroundSelected" style={styles.callout}>
            <ThemedText>{model.affectsYouBanner}</ThemedText>
          </ThemedView>
        ) : null}

        {/* The narrative is assembled by the shared presentation contract
            (P3C-1): the reason sentence and, where the source states one the
            reason did not already carry, the recall quantity arrive as ONE
            body paragraph. The screen composes and styles nothing — there is
            no separate quantity slot, and the illness status follows the
            narrative in the same body type. */}
        <Section title="What happened">
          <ThemedText>{model.whatHappened.text}</ThemedText>
          {model.whatHappened.update ? (
            <ThemedText type="small" themeColor="textSecondary">
              {model.whatHappened.update}
            </ThemedText>
          ) : null}
          {model.illnessLine ? <ThemedText>{model.illnessLine}</ThemedText> : null}
        </Section>

        {/* Where it was sold: only the full state representation (P2a founder
            decision). Retailers, addresses, online routes, and channel
            evidence stay in the model for the later retailer-list milestone.
            Absent when the canonical geography supports no representation. */}
        {whereSold ? (
          <Section title="Where it was sold">
            <ThemedText>{whereSold.lead}</ThemedText>
          </Section>
        ) : null}

        {/* Affected Products: the gated P0A data only — no helper, coverage,
            or disclaimer prose (P2a founder decision). The shared table model
            is the WHOLE section (P3C-2): headers once, one affected version
            per row, at most three rows before See all (N). Every
            affected-product code and every row-applicable production date is
            a cell of the row it belongs to — inline when the set is small,
            behind that row's own "View N codes" control when it is not. There
            is no code block, production-date line, or shared-facts card
            beneath the table, and the screen has no path to render one: it
            receives finished rows and redistributes nothing. The official
            attachment links stay preserved in the model for a later
            source/image surface — no orphan attachment link renders here. */}
        {affectedProducts ? (
          <Section title="Affected Products">
            <AffectedProductsTableView
              table={affectedProducts.table}
              expanded={tableExpanded}
              onToggleExpanded={() => setTableExpanded((prior) => !prior)}
            />
          </Section>
        ) : null}
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
  // A Product cell with a matched version image: thumbnail left of the value,
  // inside the same fixed cell width so the grid stays aligned. Rows without
  // an image keep the plain text cell — nothing is reserved.
  productCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  productCellText: {
    flexShrink: 1,
  },
  // The row-codes modal: a centered card over a dimmed backdrop; the code
  // list scrolls inside the card so a long set never pushes Close off-screen.
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '75%',
    borderRadius: Radii.small,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  modalScroll: {
    flexGrow: 0,
  },
});
