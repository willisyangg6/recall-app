/**
 * Recall Detail (P2B2) — the Lotly composition of the shipped Detail screen.
 *
 * Everything on this screen is the shared presentation contract's
 * (lib/recall-presentation.ts): the screen renders the model and derives no
 * recall wording, no section decision, and no disclosure count of its own.
 * What changed in P2B2 is only how it looks — the tokens, the shared
 * primitives, and the design's composition. The section order, the
 * five-jurisdiction rule, the one-row Affected Products rule, the two-value
 * cell rule, the paired identifier/date alignment, the community block's
 * place beneath the official statement, and the save control are the
 * shipped behaviour, unchanged.
 *
 * ## Composition
 *
 * The warm page, `spacing/16` margins, content capped at `max-content-width`.
 * The product header: the risk label, the notice label for a Public Health
 * Alert, and the one activity date, with the shared save control at the
 * trailing edge; then the product name in `heading-2`, the brand, and the
 * official-source link, beside the hero tile when the recall has an image
 * (Detail removes the tile rather than reserving its space — one of the two
 * approved no-image treatments). A retracted notice and the affects-you
 * verdict render as Information Callouts. Sections follow in `heading-3`,
 * separated by hairlines, each with its reveal control on the heading row.
 * The Affected Products table is the one horizontally scrolling surface: a
 * white bordered grid whose header row and version rows share fixed column
 * widths so they stay aligned as one unit.
 *
 * ## What Figma shows that is not here
 *
 * The header's share glyph (no behaviour), `View Retailers (10)` (retailers
 * are a later milestone; the jurisdiction reveal takes its place), and the
 * informational callout above Affected Products (removed by the P2a founder
 * decision). Health Risk, absent from the frame, stays. DESIGN.md records
 * each of these.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextLayoutLine,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommunityReportsBlock } from '@/components/community-reports-section';
import { SaveRecallButton } from '@/components/save-recall-button';
import { StateMessage } from '@/components/state-message';
import { Callout } from '@/components/ui/callout';
import { IllnessNotice } from '@/components/ui/illness-notice';
import { DisclosureControl } from '@/components/ui/disclosure-control';
import { Icon } from '@/components/ui/icon';
import { MediaTile } from '@/components/ui/media-tile';
import { NoticeLabel } from '@/components/ui/notice-label';
import { OfficialImageSet } from '@/components/ui/official-image-set';
import { RiskLabel } from '@/components/ui/risk-label';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, hitSlopToMinimum, layout, spacing, typography } from '@/constants/design-tokens';
import type { UserRecallPreferences } from '@/domain/preferences';
import {
  DETAIL_ERROR_FALLBACK,
  DETAIL_ERROR_TITLE,
  DETAIL_LOADING,
  DETAIL_MISSING,
  EXTERNAL_LINK_HINT,
  retractedNotice,
} from '@/lib/detail-copy';
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
} from '@/lib/recall-presentation';
import { evaluatePersonalRelevance } from '@/lib/relevance';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; detail: CaseDetail };

/** A link's visible footprint is one caption line; hitSlop makes it 44pt. */
const LINK_HIT_SLOP = hitSlopToMinimum(typography['caption'].lineHeight);

/**
 * Whether the rendered product name had to break a single word across two
 * lines — which happens beside the 152pt hero tile at accessibility text
 * sizes, where one `heading-2` word can be wider than the column. Decided
 * from the real text layout rather than a reported font scale, which the
 * JavaScript side does not reliably receive in every runtime. A line that
 * ends mid-word is one that neither ends with whitespace nor is followed by
 * a line starting with it.
 */
function splitsAWord(lines: readonly TextLayoutLine[]): boolean {
  return lines.some(
    (line, index) =>
      index < lines.length - 1 && !/\s$/.test(line.text) && !/^\s/.test(lines[index + 1].text),
  );
}

/** The page surface, for the loaded screen and every whole-screen state alike. */
function Page({ children }: { children: React.ReactNode }) {
  return (
    <Surface background="background/page" style={styles.page}>
      {children}
    </Surface>
  );
}

/**
 * A Detail section: the `heading-3` title with an optional control opposite
 * it — where the jurisdiction and Affected Products reveals live — over the
 * section's content. The screen draws the hairline between sections, so a
 * section that does not render leaves no divider behind.
 */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text variant="heading-3" accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/**
 * The visible part of an external link: the contract's label in the action
 * colour, with the design's external-link glyph, so a link that leaves the
 * app is identifiable at a glance as well as by its spoken role.
 */
function ExternalLinkLabel({ label }: { label: string }) {
  return (
    <View style={styles.link}>
      <Text variant="caption" color="action/secondary" style={styles.linkText}>
        {label}
      </Text>
      <Icon name="external-link" size={16} color="icon/brand" />
    </View>
  );
}

/**
 * The compact Affected Products table (P2b, restructured). Column labels
 * render once as the uppermost row, then one affected version per row, in
 * source order. The whole table scrolls horizontally as one unit so header
 * and row cells stay aligned. The model supplies TWO precomputed views —
 * collapsed (the first row) and expanded — each with columns justified by
 * exactly the rows it shows, so no rendered column is ever entirely empty.
 * An empty cell stays empty: no dash, no placeholder word, no value borrowed
 * from another version. A version's image renders beside its Product value
 * only when the shared image-role allocation assigned one to that exact row
 * (P2c).
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
 *
 * Geometry (P2B2): a white `radius/8` surface with a `border/subtle` border,
 * `body-small-bold` column labels, `caption` values, hairlines between
 * columns and between rows, and one fixed column width
 * (`table-column-width`) so every row lines up under the header. The table
 * viewport is exactly the content column; only the table pans sideways.
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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableViewport}>
      <Surface radius={8} border="border/subtle" style={styles.table}>
        <View style={styles.tableRow}>
          {view.columns.map((column, index) => (
            <View key={column.key} style={[styles.tableCell, index > 0 && styles.tableCellDivided]}>
              <Text variant="body-small-bold">{column.label}</Text>
            </View>
          ))}
        </View>
        {view.rows.map((row) => (
          <View key={row.id} style={[styles.tableRow, styles.tableDataRow]}>
            {row.cells.map((cell, index) =>
              cell.key === 'product' ? (
                // The version's own image (P2c) renders left of the Product
                // value only when the shared allocator assigned one to this
                // exact row — no placeholder, no reserved space otherwise.
                <View
                  key="product"
                  style={[
                    styles.tableCell,
                    styles.productCell,
                    index > 0 && styles.tableCellDivided,
                  ]}>
                  {row.image ? (
                    <MediaTile
                      uri={row.image.url}
                      alt={row.image.accessibilityText}
                      size={layout.rowMediaSize}
                    />
                  ) : null}
                  <Text variant="caption" style={styles.productCellText}>
                    {cell.text ?? ''}
                  </Text>
                </View>
              ) : (
                // Reading order inside the cell is value then control, so a
                // screen reader hears the values before it is offered more.
                <ProductCell
                  key={cell.key}
                  cell={cell}
                  divided={index > 0}
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
          </View>
        ))}
      </Surface>
    </ScrollView>
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
  divided,
  stateId,
  open,
  onToggle,
}: {
  cell: AffectedProductsTableCell;
  /** Every column after the first carries the hairline on its leading edge. */
  divided: boolean;
  stateId: string;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const shown = (open ? cell.text : cell.collapsedText) ?? '';
  return (
    <View style={[styles.tableCell, divided && styles.tableCellDivided]}>
      {cell.pairGroup === null ? (
        <Text variant="caption">{shown}</Text>
      ) : (
        <View>
          {shown.split('\n').map((value, index) => (
            <Text key={`${cell.key}-${index}`} variant="caption" numberOfLines={1}>
              {value === '' ? '\u00A0' : value}
            </Text>
          ))}
        </View>
      )}
      {cell.disclosure ? (
        <DisclosureControl
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
  // Latched once the name's own layout shows a word broken beside the hero:
  // the header then stacks (identity at full width, tile beneath) and stays
  // stacked, so the layout can never oscillate between the two shapes.
  const [stackedHeader, setStackedHeader] = useState(false);
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
        // The cause stays in the developer console; the shopper reads one
        // sentence that says what did not load and what to try.
        if (__DEV__) console.warn('Recall detail load failed', error);
        setState({ status: 'error', message: DETAIL_ERROR_FALLBACK });
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
      <Page>
        {state.status === 'loading' ? (
          <StateMessage {...DETAIL_LOADING} tone="loading" />
        ) : state.status === 'missing' ? (
          <StateMessage {...DETAIL_MISSING} />
        ) : (
          <StateMessage title={DETAIL_ERROR_TITLE} body={state.message} tone="error" />
        )}
      </Page>
    );
  }

  const { projection } = state.detail;
  // The one deterministic mapping shared with the Feed (lib/recall-presentation):
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
  // otherwise — no heading, no container, no divider, no spacing. It never
  // inspects rows, columns, codes, or geography to decide for itself.
  const { whereSold, communityReports, healthRisk, affectedProducts } = model.sections;

  return (
    <Page>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing[24] + insets.bottom }]}>
        {/* The product header (P2a founder decision, P2B2 composition): the
            risk label upper-left with the ONE material activity date beside
            it and the shared save control opposite, then product name,
            consumer brand, and the single official-source link beside the
            hero. The "Recall · Active" metadata line and every explanatory
            risk note are gone — the label states the risk by itself. A
            Public Health Alert keeps its explicit notice label (standing
            rule). */}
        <View style={styles.header}>
          <View style={styles.statusRow}>
            <View style={styles.statusGroup}>
              {model.risk.headlineLabel ? (
                <RiskLabel
                  tier={model.risk.tier}
                  label={model.risk.headlineLabel}
                  accessibilityLabel={model.risk.accessibilityLabel}
                />
              ) : null}
              {model.noticeTypeLabel === 'Public Health Alert' ? (
                <NoticeLabel label={model.noticeTypeLabel} />
              ) : null}
              <Text variant="caption" color="text/secondary">
                {model.activity.text}
              </Text>
            </View>
            {/* P2A: the only control this screen gained. It is about THIS
                recall — the same shared control the feed card uses, so the
                two can never disagree about whether a recall is saved — and
                it sits with the recall's identity rather than in the
                navigation header, which carries only navigation. */}
            <SaveRecallButton caseId={model.id} />
          </View>

          {model.retracted ? (
            <Callout tone="information">{retractedNotice(model.agencyLabel)}</Callout>
          ) : null}

          <View style={[styles.identityRow, stackedHeader && styles.identityStacked]}>
            <View style={styles.identity}>
              <View style={styles.titleBlock}>
                <Text
                  variant="heading-2"
                  accessibilityRole="header"
                  onTextLayout={(event) => {
                    if (!stackedHeader && splitsAWord(event.nativeEvent.lines)) {
                      setStackedHeader(true);
                    }
                  }}>
                  {model.productName}
                </Text>
                <Text variant="body-small" color="text/secondary">
                  {model.brand.text}
                </Text>
              </View>
              {/* The compact illness notice (P2B7K): whether the OFFICIAL
                  notice reported illnesses, below the brand and above the
                  source link. It is about illnesses alone — injuries, adverse
                  reactions, hospitalizations and deaths stay in What Happened
                  in the source's own words — and it is informational, never a
                  control. Null renders nothing at all: a notice that never
                  established illness status gets no row, no placeholder and no
                  spacer, because silence is not a zero. The screen decides
                  none of this; the contract hands it finished copy. */}
              {model.illnessNotice ? <IllnessNotice copy={model.illnessNotice} /> : null}
              <Pressable
                accessibilityRole="link"
                accessibilityHint={EXTERNAL_LINK_HINT}
                hitSlop={LINK_HIT_SLOP}
                style={styles.linkPressable}
                onPress={() => Linking.openURL(model.officialSource.url)}>
                <ExternalLinkLabel label={model.officialSource.label} />
              </Pressable>
            </View>
            {/* The official FDA product photography renders ONCE, beside the
                title, from the shared image-role allocation (P2c) through the
                presentation contract (P2B7C): the allocator's hero — the same
                image the Feed card showed — first, then its gallery order,
                complete, and never a label render. Null renders nothing and
                the identity takes the full width; one usable image is the
                static tile Detail has always shown; several page by hand
                inside that same tile. The screen picks no image, orders none,
                and counts none. */}
            {model.productImages ? <OfficialImageSet set={model.productImages} /> : null}
          </View>
        </View>

        {model.affectsYou ? <Callout tone="warning">{model.affectsYouBanner}</Callout> : null}

        {/* The narrative is assembled by the shared presentation contract
            (P3C-1): the reason sentence and, where the source states one the
            reason did not already carry, the recall quantity arrive as ONE
            body paragraph. The screen composes and styles nothing — there is
            no separate quantity slot. The illness status is no longer a line
            here: it renders as the compact notice in the identity area above
            (P2B7K), and this narrative has had the sentence backing it removed
            — but only when that notice completely represents it, so a
            hospitalization, death, injury or adverse reaction is never dropped
            to avoid a duplicate. Only the Update line is muted. */}
        <Section title="What Happened">
          <Text variant="body-small">{model.whatHappened.text}</Text>
          {model.whatHappened.update ? (
            <Text variant="body-small" color="text/secondary">
              {model.whatHappened.update}
            </Text>
          ) : null}
        </Section>

        {/* Where it was sold: only the full state representation (P2a founder
            decision). Retailers, addresses, online routes, and channel
            evidence stay in the model for the later retailer-list milestone.
            ALWAYS rendered (P2B7E): the model's lead is never empty, so a
            recall whose distribution the notice never stated says
            "Distribution not specified" here — with the same map pin as any
            other location state — rather than losing the section. There is
            no condition left on this section to regress. */}
        <View style={styles.divider} />
        <Section
          title="Where It Was Sold"
          action={
            // Five jurisdictions or fewer render complete. Beyond that
            // the model supplies the first five and its own reveal, on
            // the heading row, and the list grows right here — no page,
            // no sheet, no reordering; nationwide / unspecified
            // distribution is untouched because the model gives those no
            // control at all.
            whereSold.statesDisclosure ? (
              <DisclosureControl
                control={whereSold.statesDisclosure}
                expanded={statesExpanded}
                onPress={() => setStatesExpanded((prior) => !prior)}
              />
            ) : null
          }>
          <View style={styles.geography}>
            <View style={styles.geographyGlyph}>
              <Icon name="map-pin" size={12} color="icon/primary" />
            </View>
            <Text variant="body-small" style={styles.geographyText}>
              {statesExpanded ? whereSold.lead : whereSold.leadCollapsed}
            </Text>
          </View>
          {/* Community shopper reports (P1D) sit UNDER the official
              statement, never beside or above it: they corroborate where the
              notice says the product went, and the model nests them here so
              an entry point can never outlive the statement it corroborates.
              The block stays silent unless the server discloses something —
              while the feature gate is off it renders nothing at all. */}
          {communityReports ? <CommunityReportsBlock section={communityReports} /> : null}
        </Section>

        {/* Health Risk (P1B): standardized, reviewed hazard education owned by
            the shared contract — the same recognized hazard renders the same
            copy on every recall, and none of it is composed from this
            notice's prose. The screen renders the model's decided section and
            interprets no hazard of its own: whether a symptom list, a
            higher-risk line, or a source link belongs here is already
            decided. Whether THIS recall reported illnesses stays in What
            Happened — the bullets below are what the hazard can cause, never
            a claim about this recall. Absent for an unmapped hazard and for a
            retracted notice. */}
        {healthRisk ? (
          <>
            <View style={styles.divider} />
            <Section title="Health Risk">
              <Text variant="body-small">{healthRisk.risk}</Text>
              {healthRisk.higherRisk ? (
                <Text variant="body-small">{healthRisk.higherRisk}</Text>
              ) : null}
              {healthRisk.symptoms ? (
                <View style={styles.symptoms}>
                  <Text variant="caption" color="text/secondary" accessibilityRole="header">
                    Common symptoms
                  </Text>
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
                        <Text variant="body-small">{'•'}</Text>
                        <Text variant="body-small" style={styles.symptomText}>
                          {symptom}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              {healthRisk.source ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => Linking.openURL(healthRisk.source!.url)}
                  accessibilityHint={EXTERNAL_LINK_HINT}
                  hitSlop={LINK_HIT_SLOP}
                  style={styles.linkPressable}>
                  <ExternalLinkLabel label={healthRisk.source.label} />
                </Pressable>
              ) : null}
            </Section>
          </>
        ) : null}

        {/* Affected Products: the gated P0A data only — no helper, coverage,
            or disclaimer prose (P2a founder decision; Figma's informational
            callout is not reinstated). The shared table model is the WHOLE
            section (P3C-2): headers once, one affected version per row, one
            row before See all (N). Every affected-product code and every
            row-applicable production date is a cell of the row it belongs to
            — inline at two values or fewer, behind that cell's own in-place
            reveal beyond that. There is no code block, production-date line,
            shared-facts card, or modal, and the screen has no path to render
            one: it receives finished rows and redistributes nothing. The
            official attachment links stay preserved in the model for a later
            source/image surface — no orphan attachment link renders here.

            The row reveal sits on the heading, opposite the title. Collapsing
            it also drops the cell state of every row about to disappear, so a
            hidden row can never return already expanded. */}
        {affectedProducts ? (
          <>
            <View style={styles.divider} />
            <Section
              title="Affected Products"
              action={
                affectedProducts.table.rowsDisclosure ? (
                  <DisclosureControl
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
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  // flex: 1 so the ScrollView takes the screen height and can actually scroll.
  // No alignItems: 'center' here — centering the cross axis would make the
  // ScrollView size to its content's intrinsic width, so long text would
  // define a canvas wider than the screen instead of wrapping.
  scroll: {
    flex: 1,
    width: '100%',
  },
  content: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    padding: spacing[16],
    gap: spacing[16],
  },
  // The product header: the status row, then identity beside the hero.
  header: {
    gap: spacing[12],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing[8],
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flexShrink: 1,
    gap: spacing[8],
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
  },
  // When a heading-2 word cannot fit beside the hero (accessibility text
  // sizes), the row becomes a column: the identity at full width, the hero
  // beneath it.
  identityStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  // flex + minWidth 0 let a long product name wrap beside the hero instead of
  // pushing it off the page; with no hero, the identity takes the whole row.
  identity: {
    flex: 1,
    minWidth: 0,
    gap: spacing[8],
  },
  titleBlock: {
    gap: spacing[4],
  },
  linkPressable: {
    alignSelf: 'flex-start',
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
  linkText: {
    flexShrink: 1,
  },
  // The hairline between sections. A zero-height view with a top border,
  // so no height is fixed anywhere on the screen.
  divider: {
    borderTopWidth: 1,
    borderTopColor: color['border/default'],
  },
  section: {
    gap: spacing[8],
  },
  // The heading row: title on the left, an optional reveal opposite it.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[8],
  },
  sectionTitle: {
    flexShrink: 1,
  },
  // The jurisdiction line: the pin centred on the first line of text,
  // whatever the reader's type size, because its box is one line tall.
  geography: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[4],
  },
  geographyGlyph: {
    height: typography['body-small'].lineHeight,
    justifyContent: 'center',
  },
  geographyText: {
    flex: 1,
  },
  // The Health Risk symptom list: a labelled group of bulleted lines in the
  // section's body type — no card, no icon, no alert treatment.
  symptoms: {
    gap: spacing[4],
  },
  symptomList: {
    gap: spacing[4],
  },
  symptomRow: {
    flexDirection: 'row',
    gap: spacing[8],
  },
  symptomText: {
    flexShrink: 1,
  },
  // The Affected Products table. The viewport is the content column; the
  // grid inside may be wider and pans on its own. Fixed column widths keep
  // the header row and every version row aligned as one unit.
  tableViewport: {
    alignSelf: 'stretch',
  },
  table: {
    padding: spacing[4],
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableDataRow: {
    borderTopWidth: 1,
    borderTopColor: color['border/subtle'],
  },
  tableCell: {
    width: layout.tableColumnWidth,
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[8],
    gap: spacing[4],
  },
  tableCellDivided: {
    borderLeftWidth: 1,
    borderLeftColor: color['border/subtle'],
  },
  // A Product cell with a matched version image: thumbnail left of the value,
  // inside the same fixed cell width so the grid stays aligned. Rows without
  // an image keep the plain text cell — nothing is reserved.
  productCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[8],
  },
  productCellText: {
    flexShrink: 1,
  },
});
