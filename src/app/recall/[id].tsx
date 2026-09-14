import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommunityReportsBlock } from '@/components/community-reports-section';
import { PhotoThumbnail } from '@/components/photo-gallery';
import { RiskBadge } from '@/components/risk-badge';
import { SaveRecallButton } from '@/components/save-recall-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import type { UserRecallPreferences } from '@/domain/preferences';
import { loadPreferences, preferencesAvailable } from '@/lib/preferences-store';
import { fetchCaseDetail, type CaseDetail } from '@/lib/recall-feed';
import {
  buildDetailModel,
  todayIso,
  cellStateId,
  visibleCellState,
  type AffectedProductsTable,
  type AffectedProductsTableCell,
  type DetailModel,
  type DisclosureControl,
} from '@/lib/recall-presentation';
import { evaluatePersonalRelevance } from '@/lib/relevance';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; detail: CaseDetail };

function Section({
  title,
  action,
  children,
}: {
  title: string;
  /** An optional control rendered on the heading row, opposite the title —
   * where the Affected Products row reveal belongs. Omitted sections render
   * exactly as they always have. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <ThemedText type="small" themeColor="textSecondary">
          {title.toUpperCase()}
        </ThemedText>
        {action}
      </View>
      {children}
    </View>
  );
}

/**
 * Small text controls in a dense table need a bigger tappable area than their
 * glyphs occupy; hitSlop grows the target without moving anything on screen.
 */
const DISCLOSURE_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/**
 * Every in-place reveal on this screen — the jurisdiction list, the product
 * rows, and each multi-value cell — renders through this one control.
 *
 * It is a real button with a real expanded state, so VoiceOver announces
 * "See all 22 lot codes, button, collapsed" rather than a bare link, and the
 * state is never carried by colour: the visible word itself flips between
 * "See all (22)" and "Show less". Nothing animates — the list simply grows.
 */
function DisclosureButton({
  control,
  expanded,
  onPress,
}: {
  control: DisclosureControl;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        expanded ? control.collapseAccessibilityLabel : control.expandAccessibilityLabel
      }
      accessibilityState={{ expanded }}
      hitSlop={DISCLOSURE_HIT_SLOP}
      onPress={onPress}>
      <ThemedText themeColor="link" type="small">
        {expanded ? control.collapseLabel : control.expandLabel}
      </ThemedText>
    </Pressable>
  );
}

/**
 * The compact Affected Products table (P2b, restructured). Column labels
 * render once as the uppermost row, then one affected version per row, in
 * source order. The whole table scrolls horizontally as one unit so header
 * and row cells stay aligned. The model supplies TWO precomputed views —
 * collapsed (the first row) and expanded — each with columns justified by
 * exactly the rows it shows, so no rendered column is ever entirely empty.
 * An empty cell stays empty: no dash, no "unknown", no value borrowed from
 * another version. A version's image renders beside its Product value only
 * when the shared image-role allocation assigned one to that exact row (P2c).
 *
 * TWO INDEPENDENT DISCLOSURES live here, and neither knows about the other:
 *
 *   ROWS — owned by the screen (the control sits on the section heading) and
 *   passed in, because a single-product recall must render with no control at
 *   all.
 *
 *   CELLS — owned here, one per (row, column). A field holding more than two
 *   values shows its first two and reveals the rest in place. The retired
 *   "View N codes" modal is gone; nothing leaves the table.
 *
 * Collapsing the rows drops the cell state of rows that are about to
 * disappear, so a hidden row can never come back already expanded. Cells in
 * the row that stays visible keep theirs.
 */
function AffectedProductsTableView({
  table,
  expanded,
  openCells,
  onToggleCell,
}: {
  table: AffectedProductsTable;
  expanded: boolean;
  /** Which (row, column) cells are expanded, owned by the screen so
   * collapsing the rows can prune the ones that disappear. */
  openCells: ReadonlySet<string>;
  onToggleCell: (cellId: string) => void;
}) {
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
              {row.cells.map((cell) =>
                cell.key === 'product' ? (
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
                ) : (
                  // Reading order inside the cell is value then control, so a
                  // screen reader hears the values before it is offered more.
                  <ProductCell
                    key={cell.key}
                    cell={cell}
                    // A PAIRED cell's expansion belongs to its GROUP, not its
                    // column: both halves read and write the one entry, so it
                    // is not merely discouraged but impossible for one paired
                    // column to expand while its partner stays collapsed.
                    stateId={cellStateId(row.id, cell)}
                    open={openCells.has(cellStateId(row.id, cell))}
                    onToggle={onToggleCell}
                  />
                ),
              )}
            </ThemedView>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * One non-product cell.
 *
 * An ordinary field renders as one wrapping run of comma-joined text, exactly
 * as it always has. A cell belonging to an identifier PAIR group renders one
 * value per line instead, each capped to a single line, so line _n_ of the
 * codes column sits level with line _n_ of its date column and the two read
 * as the pairs the source actually stated. Those values are never
 * comma-joined: a date like "September 30, 2027" carries its own comma.
 *
 * An undated code's empty partner renders as a non-breaking space rather than
 * nothing, so the blank keeps its line and the rows below it stay aligned —
 * an empty line that collapsed to zero height would shift every later pair
 * against the wrong code, which is the exact defect this grouping exists to
 * prevent.
 */
function ProductCell({
  cell,
  stateId,
  open,
  onToggle,
}: {
  cell: AffectedProductsTableCell;
  stateId: string;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const shown = (open ? cell.text : cell.collapsedText) ?? '';
  return (
    <View style={styles.tableCell}>
      {cell.pairGroup === null ? (
        <ThemedText type="small">{shown}</ThemedText>
      ) : (
        shown.split('\n').map((value, index) => (
          <ThemedText key={`${cell.key}-${index}`} type="small" numberOfLines={1}>
            {value === '' ? '\u00A0' : value}
          </ThemedText>
        ))
      )}
      {cell.disclosure ? (
        <DisclosureButton
          control={cell.disclosure}
          expanded={open}
          onPress={() => onToggle(stateId)}
        />
      ) : null}
    </View>
  );
}

export default function RecallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // The three in-place disclosures this screen owns. All start collapsed, all
  // are independent, and none of them navigates anywhere.
  //
  //   statesExpanded — the Where-it-was-sold jurisdiction list.
  //   tableExpanded  — Affected Products rows.
  //   openCells      — per (row, column) multi-value cells, so collapsing the
  //                    rows can drop the state of rows that disappear.
  const [statesExpanded, setStatesExpanded] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);
  const [openCells, setOpenCells] = useState<ReadonlySet<string>>(() => new Set());
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
  const { whereSold, communityReports, healthRisk, affectedProducts } = model.sections;

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

        {/* P2A: the only control this screen gained. It is about THIS recall
            — the same shared control the feed card uses, so the two can never
            disagree about whether a recall is saved — and it sits with the
            recall's identity rather than in the header, which carries only
            navigation. */}
        <View style={styles.saveRow}>
          <SaveRecallButton caseId={model.id} />
        </View>

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
            {/* Five jurisdictions or fewer render complete. Beyond that the
                model supplies the first five and its own reveal, and the list
                grows right here — no page, no sheet, no reordering, and
                nationwide / unspecified distribution is untouched because the
                model gives those no control at all. */}
            <ThemedText>{statesExpanded ? whereSold.lead : whereSold.leadCollapsed}</ThemedText>
            {whereSold.statesDisclosure ? (
              <DisclosureButton
                control={whereSold.statesDisclosure}
                expanded={statesExpanded}
                onPress={() => setStatesExpanded((prior) => !prior)}
              />
            ) : null}
            {/* Community shopper reports (P1D) sit UNDER the official
                statement, never beside or above it: they corroborate where
                the notice says the product went, and the model nests them
                here so an entry point can never outlive the statement it
                corroborates. The block stays silent unless the server
                discloses something — while the feature gate is off it
                renders nothing at all. */}
            {communityReports ? <CommunityReportsBlock section={communityReports} /> : null}
          </Section>
        ) : null}

        {/* Health Risk (P1B): standardized, reviewed hazard education owned by
            the shared contract — the same recognized hazard renders the same
            copy on every recall, and none of it is composed from this
            notice's prose. The screen renders the model's decided section and
            interprets no hazard of its own: whether a symptom list, a
            higher-risk line, or a source link belongs here is already
            decided. Whether THIS recall reported illnesses stays in What
            happened — the bullets below are what the hazard can cause, never
            a claim about this recall. Absent for an unmapped hazard and for a
            retracted notice. */}
        {healthRisk ? (
          <Section title="Health Risk">
            <ThemedText>{healthRisk.risk}</ThemedText>
            {healthRisk.higherRisk ? <ThemedText>{healthRisk.higherRisk}</ThemedText> : null}
            {healthRisk.symptoms ? (
              <View style={styles.symptoms}>
                <ThemedText type="small" themeColor="textSecondary">
                  COMMON SYMPTOMS
                </ThemedText>
                <View accessibilityRole="list" style={styles.symptomList}>
                  {healthRisk.symptoms.map((symptom) => (
                    // One accessible node per symptom, labelled with the
                    // symptom alone so the bullet glyph is never announced.
                    <View
                      key={symptom}
                      style={styles.symptomRow}
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel={symptom}>
                      <ThemedText>{'•'}</ThemedText>
                      <ThemedText style={styles.symptomText}>{symptom}</ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {healthRisk.source ? (
              <ThemedText
                themeColor="link"
                accessibilityRole="link"
                onPress={() => Linking.openURL(healthRisk.source!.url)}>
                {healthRisk.source.label}
              </ThemedText>
            ) : null}
          </Section>
        ) : null}

        {/* Affected Products: the gated P0A data only — no helper, coverage,
            or disclaimer prose (P2a founder decision). The shared table model
            is the WHOLE section (P3C-2): headers once, one affected version
            per row, at most three rows before See all (N). Every
            affected-product code and every row-applicable production date is
            a cell of the row it belongs to — inline at two values or fewer,
            behind that cell's own in-place reveal beyond that. There is no
            code block, production-date line, shared-facts card, or modal, and
            the screen has no path to render one: it receives finished rows
            and redistributes nothing. The official attachment links stay
            preserved in the model for a later source/image surface — no
            orphan attachment link renders here.

            The row reveal sits on the heading, opposite the title. Collapsing
            it also drops the cell state of every row about to disappear, so a
            hidden row can never return already expanded. */}
        {affectedProducts ? (
          <Section
            title="Affected Products"
            action={
              affectedProducts.table.rowsDisclosure ? (
                <DisclosureButton
                  control={affectedProducts.table.rowsDisclosure}
                  expanded={tableExpanded}
                  onPress={() => {
                    if (tableExpanded) {
                      setOpenCells((cells) =>
                        visibleCellState(
                          cells,
                          affectedProducts.table.collapsed.rows.map((row) => row.id),
                        ),
                      );
                    }
                    setTableExpanded(!tableExpanded);
                  }}
                />
              ) : null
            }>
            <AffectedProductsTableView
              table={affectedProducts.table}
              expanded={tableExpanded}
              openCells={openCells}
              onToggleCell={(cell) =>
                setOpenCells((prior) => {
                  const next = new Set(prior);
                  if (!next.delete(cell)) next.add(cell);
                  return next;
                })
              }
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
  // Left-aligned so the control keeps the reading column's edge rather than
  // stretching; provisional, like every other value here.
  saveRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
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
  // The heading row: title on the left, an optional disclosure opposite it.
  // With no action the title sits exactly where it always did.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
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
  // The Health Risk symptom list: a labelled group of bulleted lines in the
  // section's existing body type — no card, no icon, no alert treatment.
  // Final styling belongs to the design-system pass.
  symptoms: {
    gap: Spacing.half,
    marginTop: Spacing.one,
  },
  symptomList: {
    gap: Spacing.half,
  },
  symptomRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  symptomText: {
    flexShrink: 1,
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
});
