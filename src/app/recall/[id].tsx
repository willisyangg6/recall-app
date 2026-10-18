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

import { useEffect, useRef, useState } from 'react';
import {
  Linking,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextLayoutLine,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommunityReportsBlock } from '@/components/community-reports-section';
import { FeedCategoryLabel } from '@/components/feed/feed-labels';
import { useSaveHeaderItems } from '@/components/save-recall-button';
import { StateMessage } from '@/components/state-message';
import { Callout } from '@/components/ui/callout';
import { IllnessNotice } from '@/components/ui/illness-notice';
import { Icon } from '@/components/ui/icon';
import { MediaTile } from '@/components/ui/media-tile';
import { NoticeLabel } from '@/components/ui/notice-label';
import { OfficialImageSet } from '@/components/ui/official-image-set';
import { RiskLabel } from '@/components/ui/risk-label';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { hitSlopToMinimum, layout, spacing } from '@/constants/design-tokens';
import {
  DETAIL_STACK_SCALE,
  detailColor,
  detailGeometry,
  detailType,
  fieldStacks,
} from '@/constants/detail-design';
import { categoryStyle } from '@/constants/feed-design';
import {
  DETAIL_ERROR_FALLBACK,
  DETAIL_ERROR_TITLE,
  DETAIL_LOADING,
  DETAIL_MISSING,
  DETAIL_TITLE_COLLAPSE_HINT,
  DETAIL_TITLE_COLLAPSE_LABEL,
  DETAIL_TITLE_EXPAND_HINT,
  DETAIL_TITLE_EXPAND_LABEL,
  DETAIL_TITLE_LINES,
  EXTERNAL_LINK_HINT,
  RETAILERS_SPOKEN_PREFIX,
  retractedNotice,
} from '@/lib/detail-copy';
import { baselineCaseDetail } from '@/lib/baseline-recalls';
import { fetchCaseDetail, type CaseDetail } from '@/lib/recall-feed';
import {
  affectedProductCards,
  buildDetailModel,
  cardGroupStateId,
  todayIso,
  visibleCellState,
  type AffectedProductCard,
  type DetailModel,
  type DisclosureControl as DisclosureControlModel,
} from '@/lib/recall-presentation';
import { symptomIcon } from '@/lib/symptom-icons';
import { usePreferences } from '@/hooks/use-preferences';
import { affectsYouVerdict } from '@/lib/relevance';

/**
 * DEVELOPMENT-ONLY gallery fixtures (components/development/detail-image-fixtures):
 * a bundled recall with a local 2-, 3-, 7-image or failing header set, for
 * native QA of states the bundled baseline cannot show. `__DEV__` is folded
 * to `false` in a production build, so this require — and the fixtures'
 * images — never reach a release bundle. Real recall ids never match.
 */
type DevelopmentDetailFixtures = typeof import('@/components/development/detail-image-fixtures');
const DEVELOPMENT_FIXTURES: DevelopmentDetailFixtures | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/components/development/detail-image-fixtures') as DevelopmentDetailFixtures)
  : null;

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; detail: CaseDetail };

/**
 * Every link and disclosure is one action line (16/22). `hitSlop` grows the
 * TARGET to the 44pt minimum without growing the mark, so controls stay
 * comfortably tappable while reading as quiet text actions.
 */
const LINK_HIT_SLOP = hitSlopToMinimum(detailType.action.lineHeight ?? 22);
const ACTION_HIT_SLOP = LINK_HIT_SLOP;

/** The chevron beside a disclosure's words and the external-link glyph. */
const DISCLOSURE_GLYPH = 18;

/** The card thumbnail's exact footprint, and its horizontal padding total. */
const CARD_THUMBNAIL = {
  width: detailGeometry.productThumbnail,
  height: detailGeometry.productThumbnail,
} as const;
const CARD_PADDING_X = detailGeometry.productCardPadding * 2 + 2;

/**
 * Two centring offsets, snapped to the device's pixel grid. Unsnapped they are
 * half points (6.5 and 1.5), off the 3× grid, and every view below them would
 * inherit a sub-pixel offset — one of the conditions behind the clipped-title
 * defect `CardTitle` corrects.
 */
const CENTRED_ON_BUBBLE = PixelRatio.roundToNearestPixel(
  (detailGeometry.symptomBubble - (detailType.body.lineHeight ?? 23)) / 2,
);
const LABEL_ON_VALUE_LINE = PixelRatio.roundToNearestPixel(
  ((detailType.body.lineHeight ?? 23) - (detailType.metadata.lineHeight ?? 20)) / 2,
);
/** A product card title's unscaled line height. */
const TITLE_LINE_HEIGHT = detailType.productCardTitle.lineHeight ?? 24;
/** The width a card title leaves for the image beside it. */
const TITLE_IMAGE_RESERVE = detailGeometry.productThumbnail + detailGeometry.fieldColumnGap;

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
        <Text
          style={[detailType.section, styles.textColor, styles.sectionTitle]}
          accessibilityRole="header">
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
      <Text style={[detailType.action, styles.linkColor, styles.linkText]}>{label}</Text>
      <Icon name="external-link" points={DISCLOSURE_GLYPH} color="icon/brand" />
    </View>
  );
}

/**
 * A Detail disclosure (Recall Detail kit, 2026-10-07): the control's own words
 * in the action type and the link colour, with a down chevron while collapsed
 * and an up chevron while expanded. The words carry the state, so it survives
 * greyscale; the chevron is decorative. The spoken label is the model's, with
 * the complete count and what it reveals.
 */
function DetailDisclosure({
  control,
  expanded,
  onPress,
}: {
  control: DisclosureControlModel;
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
      hitSlop={ACTION_HIT_SLOP}
      style={styles.disclosure}
      onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.disclosureInner, pressed ? styles.pressedControl : null]}>
          <Text style={[detailType.action, styles.linkColor]}>
            {expanded ? control.collapseLabel : control.expandLabel}
          </Text>
          <Icon
            name={expanded ? 'chevron-up' : 'chevron-down'}
            points={DISCLOSURE_GLYPH}
            color="icon/brand"
          />
        </View>
      )}
    </Pressable>
  );
}

/**
 * A product card's name, never missing a line. React Native can lay a text
 * frame out up to one device pixel shorter than its text (Yoga rounds the
 * frame's edges onto the pixel grid; React Native issue #57920), and iOS then
 * draws one line fewer — on device the second Mellace card showed "Wegmans
 * Deluxe Mixed Nuts U…". Whether it happens depends only on where the title
 * lands on the grid, so it can strike a name of any length.
 *
 * The title therefore checks the lines iOS actually drew against its own
 * frame. The loss is at most a pixel, so at most ONE line drops, and the
 * signature is exact: a frame taller than the drawn lines by more than half
 * a line but no more than a line and a pixel, which no minimum height of
 * ours explains, drawn at the CURRENT text size. Text and frame events
 * arrive separately, so a pair from two different layouts (a Dynamic Type
 * change mid-screen) fails the line-height or the window test and is
 * ignored. On a real drop the title takes that frame plus 1pt as its
 * minimum height, so the next layout draws every line. A title that drew
 * every line is never touched, and the correction is keyed to the window
 * and text size, so a Dynamic Type change measures afresh.
 */
function CardTitle({ name, besideImage }: { name: string; besideImage: boolean }) {
  const { width, fontScale } = useWindowDimensions();
  const layoutKey = `${width}|${fontScale}`;
  const [correction, setCorrection] = useState<{ key: string; minHeight: number } | null>(null);
  const frameHeight = useRef(0);
  const drawn = useRef<{ total: number; perLine: number } | null>(null);
  const repairMinHeight = correction?.key === layoutKey ? correction.minHeight : 0;
  const ownMinHeight = Math.max(besideImage ? detailGeometry.productThumbnail : 0, repairMinHeight);

  const checkForDroppedLine = () => {
    const lines = drawn.current;
    const frame = frameHeight.current;
    if (lines === null || frame === 0) return;
    if (Math.abs(frame - ownMinHeight) < 0.01) return;
    // Drawn at the current text size, or this is a stale text layout.
    if (Math.abs(lines.perLine - TITLE_LINE_HEIGHT * fontScale) > 1) return;
    const excess = frame - lines.total;
    if (excess <= lines.perLine / 2 || excess > lines.perLine + 1) return;
    setCorrection({ key: layoutKey, minHeight: PixelRatio.roundToNearestPixel(frame) + 1 });
  };

  return (
    <Text
      style={[
        detailType.productCardTitle,
        styles.textColor,
        besideImage ? styles.cardTitleBesideImage : null,
        repairMinHeight > 0 ? { minHeight: repairMinHeight } : null,
      ]}
      accessibilityRole="header"
      onLayout={(event) => {
        frameHeight.current = event.nativeEvent.layout.height;
        checkForDroppedLine();
      }}
      onTextLayout={(event) => {
        const { lines } = event.nativeEvent;
        drawn.current =
          lines.length === 0
            ? null
            : {
                total: lines.reduce((sum, line) => sum + line.height, 0),
                perLine: lines[0].height,
              };
        checkForDroppedLine();
      }}>
      {name}
    </Text>
  );
}

/**
 * One affected product as a vertical card (Recall Detail kit, 2026-10-07):
 * the product name, the strictly allocated row image top-right when there is
 * one (no reserved space otherwise), then each field group in the closed
 * column order. A group shows its first two lines and its OWN Show more; a
 * verified pair group shows its first two whole pair entries, each a labelled
 * code over its own labelled date, and reveals the rest whole.
 * At large text sizes, or when the value column would be too narrow, the
 * labels stack above their values and the image sits above the name, so no
 * word is broken to fit beside anything.
 */
function AffectedProductCardView({
  card,
  openGroups,
  onToggleGroup,
  fontScale,
}: {
  card: AffectedProductCard;
  openGroups: ReadonlySet<string>;
  onToggleGroup: (id: string) => void;
  fontScale: number;
}) {
  const [contentWidth, setContentWidth] = useState(0);
  const stacked = fieldStacks(contentWidth, fontScale);
  const imageAbove = fontScale >= DETAIL_STACK_SCALE;
  const image = card.image ? (
    <MediaTile
      uri={card.image.url}
      alt={card.image.accessibilityText}
      size={CARD_THUMBNAIL}
      cornerRadius={detailGeometry.headerPhotoRadius}
    />
  ) : null;
  return (
    <View
      style={styles.card}
      onLayout={(event) => setContentWidth(event.nativeEvent.layout.width - CARD_PADDING_X)}>
      {imageAbove && image ? <View style={styles.cardImageAbove}>{image}</View> : null}
      {card.name !== null || (image && !imageAbove) ? (
        <View style={!imageAbove && image ? styles.cardHeaderWithImage : null}>
          {card.name !== null ? (
            <CardTitle name={card.name} besideImage={!imageAbove && image !== null} />
          ) : null}
          {!imageAbove && image ? <View style={styles.cardImage}>{image}</View> : null}
        </View>
      ) : null}
      {card.groups.map((group, groupIndex) => {
        const stateId = cardGroupStateId(card.id, group.id);
        const open = openGroups.has(stateId);
        const lines = open ? group.lines : group.collapsedLines;
        const disclosure = group.disclosure ? (
          <DetailDisclosure
            control={group.disclosure}
            expanded={open}
            onPress={() => onToggleGroup(stateId)}
          />
        ) : null;
        if (group.pairs !== null) {
          // A verified pair group (founder Granola review, 2026-10-08): no
          // outer label; each entry is a compact block — its codes under the
          // codes' own label, one per line, then the date they share under the
          // source's date type, shown once (2026-10-18) — read by VoiceOver
          // as one element, with clear space between blocks.
          const entries = (open ? group.pairs : group.collapsedPairs) ?? [];
          return (
            <View key={group.id}>
              {entries.map((entry, index) => (
                <View
                  key={`${group.id}-${index}`}
                  style={styles.pairEntry}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={lines[index]}>
                  <FieldRow
                    label={entry.codes.label}
                    value={entry.codes.values.join('\n')}
                    stacked={stacked}
                  />
                  {entry.date ? (
                    <FieldRow label={entry.date.label} value={entry.date.value} stacked={stacked} />
                  ) : null}
                </View>
              ))}
              {disclosure ? (
                <View style={stacked ? styles.pairDisclosure : styles.pairDisclosureInValueColumn}>
                  {disclosure}
                </View>
              ) : null}
            </View>
          );
        }
        // A field directly after a pair group keeps the pairs' own spacing,
        // so it never reads as part of the last pair.
        const afterPairs = groupIndex > 0 && card.groups[groupIndex - 1].pairs !== null;
        return (
          <View
            key={group.id}
            style={[
              stacked ? styles.fieldStacked : styles.field,
              afterPairs ? styles.fieldAfterPairs : null,
            ]}>
            <Text
              style={[detailType.metadata, styles.secondaryColor, !stacked && styles.fieldLabel]}>
              {group.label}
            </Text>
            <View style={styles.fieldValues}>
              {lines.map((line, index) => (
                <Text key={`${group.id}-${index}`} style={[detailType.body, styles.textColor]}>
                  {line}
                </Text>
              ))}
              {disclosure}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** One labelled line of a pair entry: the label column and its value. */
function FieldRow({ label, value, stacked }: { label: string; value: string; stacked: boolean }) {
  return (
    <View style={stacked ? styles.pairRowStacked : styles.pairRow}>
      <Text style={[detailType.metadata, styles.secondaryColor, !stacked && styles.fieldLabel]}>
        {label}
      </Text>
      <Text style={[detailType.body, styles.textColor, styles.fieldValues]}>{value}</Text>
    </View>
  );
}

/**
 * One reviewed symptom (Recall Detail kit, 2026-10-07): a 36pt pale-blue disc
 * holding a 22pt decorative glyph, 12pt from the symptom's exact reviewed
 * wording. The disc is a native View and the glyph is decoration — the row is
 * ONE accessible node labelled with the symptom alone. Multi-line text keeps
 * the disc beside its first line.
 */
function SymptomRow({ symptom, divided }: { symptom: string; divided: boolean }) {
  return (
    <View
      style={[styles.symptomRow, divided ? styles.symptomRowDivided : null]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={symptom}>
      <View style={styles.symptomBubble}>
        <Icon
          name={symptomIcon(symptom)}
          points={detailGeometry.symptomGlyph}
          color="icon/primary"
        />
      </View>
      <Text style={[detailType.body, styles.textColor, styles.symptomText]}>{symptom}</Text>
    </View>
  );
}

/** A guide's symptom list: rows with light dividers BETWEEN them only. */
function SymptomList({ symptoms, label }: { symptoms: readonly string[]; label?: string }) {
  return (
    <View accessibilityRole="list" accessibilityLabel={label}>
      {symptoms.map((symptom, index) => (
        <SymptomRow key={symptom} symptom={symptom} divided={index > 0} />
      ))}
    </View>
  );
}

export default function RecallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // The in-place disclosures this screen owns. All start collapsed, all are
  // independent, and none of them navigates anywhere.
  //
  //   statesExpanded — the Where-it-was-sold jurisdiction list.
  //   tableExpanded  — Affected Products rows (cards).
  //   openGroups     — per (card, field group) Show more, so collapsing the
  //                    rows can drop the state of cards that disappear.
  const [statesExpanded, setStatesExpanded] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);
  // The Detail title's two-line disclosure. `titleOverflows` is MEASURED —
  // see the probe in the header — so a title that fits never gets a control.
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [titleOverflows, setTitleOverflows] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const prefs = usePreferences();
  // Latched once the name's own layout shows a word broken beside the photo:
  // the header then stacks (identity at full width, photo beneath) and stays
  // stacked, so the layout can never oscillate between the two shapes.
  const [stackedHeader, setStackedHeader] = useState(false);
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  // Save, in the navigation bar, for the recall this screen shows — and only
  // once it has loaded. Called before any early return (rules of hooks).
  const saveItems = useSaveHeaderItems(state.status === 'ready' ? state.detail.id : null);

  // Every per-recall disclosure resets when the route points at a DIFFERENT
  // recall, so a title left expanded, a jurisdiction list left open or a
  // card list left grown can never carry over to the next one (P2B7V).
  //
  // Done DURING RENDER — React's documented way to adjust state when a prop
  // changes — rather than in an effect, so no frame of the previous recall's
  // expanded state paints first.
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) {
    setShownId(id);
    setTitleExpanded(false);
    setTitleOverflows(false);
    setStatesExpanded(false);
    setTableExpanded(false);
    setOpenGroups(new Set());
    setStackedHeader(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A recall shown from the bundled baseline (lib/baseline-recalls.ts,
      // 2026-10-04) always opens: when the live row cannot be fetched, or no
      // longer exists, its bundled detail is rendered instead.
      const fixture = DEVELOPMENT_FIXTURES?.developmentDetailFixture(id) ?? null;
      if (fixture) {
        setState({ status: 'ready', detail: fixture.detail });
        return;
      }
      const bundled = baselineCaseDetail(id);
      try {
        const detail = (await fetchCaseDetail(id)) ?? bundled;
        if (cancelled) return;
        setState(detail ? { status: 'ready', detail } : { status: 'missing' });
      } catch (error) {
        if (cancelled) return;
        if (bundled) {
          setState({ status: 'ready', detail: bundled });
          return;
        }
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
  const affectsYou = affectsYouVerdict(
    {
      geography: projection.geography,
      pathogenOrAllergen: projection.pathogenOrAllergen,
      retailerNames: projection.retailerNames ?? [],
      hazardCategory: projection.hazardCategory,
      reasonText: projection.reasonText,
    },
    prefs,
  );
  const model: DetailModel = buildDetailModel(state.detail, { today: todayIso(), affectsYou });
  // Optional sections are DECIDED by the shared contract (P3A). The screen
  // renders a section when the model gives it one and renders nothing at all
  // otherwise — no heading, no container, no divider, no spacing. It never
  // inspects rows, columns, codes, or geography to decide for itself.
  const { whereSold, communityReports, healthRisk, affectedProducts } = model.sections;

  // At accessibility text sizes the header always stacks: the photo sits
  // beneath the identity, so the title never breaks a word to fit beside it.
  const largeText = fontScale >= DETAIL_STACK_SCALE;
  const headerStacked = stackedHeader || largeText;
  // At accessibility sizes the complete title is shown, with no control.
  const titleClamped = !largeText && !titleExpanded;
  const category = model.category ? categoryStyle(model.category.id) : null;
  // The header's and cards' images: the model's, unless a development
  // fixture supplies local images for this route (never in a release build).
  const productImages =
    DEVELOPMENT_FIXTURES?.developmentDetailFixture(id)?.images ?? model.productImages;
  const fixtureCardImage = DEVELOPMENT_FIXTURES?.developmentDetailFixture(id)?.cardImage ?? null;
  const cards = affectedProducts
    ? affectedProductCards(
        tableExpanded ? affectedProducts.table.expanded : affectedProducts.table.collapsed,
      ).map((card) =>
        fixtureCardImage && !card.image ? { ...card, image: fixtureCardImage } : card,
      )
    : [];

  return (
    <Page>
      {/* Save sits in the navigation bar, opposite Back (Recall Detail kit,
          2026-10-07; P2A had placed it with the identity). It is the SAME
          shared save contract the Feed card's control uses — one saved
          state, one spoken action label, one selected state — as a native
          bar item (see `useSaveHeaderItems`), registered by this screen
          alone, so no other pushed screen gains a header button. */}
      <Stack.Screen options={{ unstable_headerRightItems: () => saveItems }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing[24] + insets.bottom }]}>
        {/* The product header: the risk label with the ONE material activity
            date and the shared save control opposite; then the product name
            (two lines until the reader asks for the rest), the consumer
            brand, the category label the Feed card shows, the compact illness
            notice, and the single official-source link — beside the official
            photo when the recall has one. A Public Health Alert keeps its
            explicit notice label (standing rule). Risk and illness keep the
            integrated application palette and wording. */}
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
              <Text style={[detailType.metadata, styles.secondaryColor]}>
                {model.activity.text}
              </Text>
            </View>
          </View>

          {model.retracted ? (
            <Callout tone="information">{retractedNotice(model.agencyLabel)}</Callout>
          ) : null}

          <View style={[styles.identityRow, headerStacked && styles.identityStacked]}>
            <View style={styles.identity}>
              <View style={styles.titleBlock}>
                {/* The visible title, clamped to two lines until the reader
                    asks for the rest. It carries the FULL name as its
                    accessibility label, so a clamp a sighted reader sees is
                    never a clamp a screen reader hears. */}
                <Text
                  style={[detailType.productTitle, styles.textColor]}
                  accessibilityRole="header"
                  accessibilityLabel={model.productName}
                  numberOfLines={titleClamped ? DETAIL_TITLE_LINES : undefined}>
                  {model.productName}
                </Text>
                {/* The measuring copy: the same string, type and width with no
                    clamp, absolutely positioned and hidden from assistive
                    technology. Its real layout decides BOTH whether the name
                    overflows two lines (so whether the control exists) and
                    whether a word had to break beside the photo (which stacks
                    the header). Measured, never counted: a character
                    heuristic cannot know the reader's text size or the
                    column's width. It stays mounted, so a Dynamic Type change
                    re-measures. */}
                <Text
                  style={[detailType.productTitle, styles.titleProbe]}
                  accessible={false}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  onTextLayout={(event) => {
                    const { lines } = event.nativeEvent;
                    if (!stackedHeader && splitsAWord(lines)) setStackedHeader(true);
                    const overflows = lines.length > DETAIL_TITLE_LINES;
                    setTitleOverflows((prior) => (prior === overflows ? prior : overflows));
                  }}>
                  {model.productName}
                </Text>
                {titleOverflows && !largeText ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: titleExpanded }}
                    accessibilityHint={
                      titleExpanded ? DETAIL_TITLE_COLLAPSE_HINT : DETAIL_TITLE_EXPAND_HINT
                    }
                    hitSlop={ACTION_HIT_SLOP}
                    style={styles.disclosure}
                    onPress={() => setTitleExpanded((prior) => !prior)}>
                    {({ pressed }) => (
                      <View
                        style={[styles.disclosureInner, pressed ? styles.pressedControl : null]}>
                        <Text style={[detailType.action, styles.linkColor]}>
                          {titleExpanded ? DETAIL_TITLE_COLLAPSE_LABEL : DETAIL_TITLE_EXPAND_LABEL}
                        </Text>
                        <Icon
                          name={titleExpanded ? 'chevron-up' : 'chevron-down'}
                          points={DISCLOSURE_GLYPH}
                          color="icon/brand"
                        />
                      </View>
                    )}
                  </Pressable>
                ) : null}
                <Text style={[detailType.body, styles.secondaryColor]}>{model.brand.text}</Text>
              </View>
              {/* The product category — the integrated Feed label (its tint,
                  border, ink and glyph), for the SAME category the card
                  shows. Null renders nothing. */}
              {model.category && category ? (
                <FeedCategoryLabel label={model.category.label} style={category} />
              ) : null}
              {/* The compact illness notice (P2B7K): whether the OFFICIAL
                  notice reported illnesses. Null renders nothing at all:
                  silence is not a zero. */}
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
            {/* The official FDA product photography, from the shared
                image-role allocation (P2c) through the presentation contract
                (P2B7C). Null renders nothing and the identity takes the full
                width — no tile, placeholder, gutter or reserved column. */}
            {productImages ? <OfficialImageSet set={productImages} /> : null}
          </View>
        </View>

        {model.affectsYou ? <Callout tone="warning">{model.affectsYouBanner}</Callout> : null}

        {/* What Happened: the shared contract's paragraphs, verbatim — the
            cause, and the recall's extent as its OWN paragraph when the
            source states one. The screen composes no sentence. */}
        <View style={styles.divider} />
        <Section title="What Happened">
          <Text style={[detailType.body, styles.textColor]}>{model.whatHappened.text}</Text>
          {model.whatHappened.scope ? (
            <Text style={[detailType.body, styles.textColor]}>{model.whatHappened.scope}</Text>
          ) : null}
        </Section>

        {/* Where It Was Sold, ALWAYS rendered (P2B7E): the map pin then the
            location itself, and the store glyph then the retailer names the
            notice stated — no visible "States" or "Retailers" prefix. The
            retailer row still SPEAKS its prefix. Five jurisdictions or fewer
            render complete; beyond that the model's own reveal sits on the
            heading row ("Show all (N)" / "Show less"). */}
        <View style={styles.divider} />
        <Section
          title="Where It Was Sold"
          action={
            whereSold.statesDisclosure ? (
              <DetailDisclosure
                control={whereSold.statesDisclosure}
                expanded={statesExpanded}
                onPress={() => setStatesExpanded((prior) => !prior)}
              />
            ) : null
          }>
          <View style={styles.distributionRow}>
            <View style={styles.distributionGlyph}>
              <Icon name="map-pin" points={detailGeometry.interfaceGlyph} color="icon/primary" />
            </View>
            <Text style={[detailType.body, styles.textColor, styles.distributionText]}>
              {statesExpanded ? whereSold.lead : whereSold.leadCollapsed}
            </Text>
          </View>
          {whereSold.retailersNamed ? (
            <View
              style={styles.distributionRow}
              accessible
              accessibilityLabel={`${RETAILERS_SPOKEN_PREFIX} ${whereSold.retailersNamed}`}>
              <View style={styles.distributionGlyph}>
                <Icon name="store" points={detailGeometry.interfaceGlyph} color="icon/primary" />
              </View>
              <Text style={[detailType.body, styles.textColor, styles.distributionText]}>
                {whereSold.retailersNamed}
              </Text>
            </View>
          ) : null}
          {/* Community shopper reports (P1D) sit UNDER the official
              statement; silent while the server gate is off. */}
          {communityReports ? <CommunityReportsBlock section={communityReports} /> : null}
        </Section>

        {/* Health Risk (P1B): standardized, reviewed hazard education. The
            risk paragraph, then ONE "Common symptoms" subheading (18/24, no
            divider between them), each symptom in its exact reviewed words
            beside a decorative glyph. Several supported hazards (decision E):
            still one heading and one subheading — each guide's explanation
            and source link, then its own symptom group, beneath a small
            organism label, never merged. Absent for an unmapped hazard and
            for a retracted notice. */}
        {healthRisk ? (
          <>
            <View style={styles.divider} />
            <Section title="Health Risk">
              {healthRisk.hazards ? (
                <>
                  {healthRisk.hazards.map((hazard) => (
                    <View key={hazard.organism} style={styles.hazardGroup}>
                      <Text
                        style={[detailType.metadataStrong, styles.textColor]}
                        accessibilityRole="header">
                        {hazard.organism}
                      </Text>
                      <Text style={[detailType.body, styles.textColor]}>{hazard.risk}</Text>
                      {hazard.higherRisk ? (
                        <Text style={[detailType.body, styles.textColor]}>{hazard.higherRisk}</Text>
                      ) : null}
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={`${hazard.source.label} about ${hazard.organism}`}
                        onPress={() => Linking.openURL(hazard.source.url)}
                        accessibilityHint={EXTERNAL_LINK_HINT}
                        hitSlop={LINK_HIT_SLOP}
                        style={styles.linkPressable}>
                        <ExternalLinkLabel label={hazard.source.label} />
                      </Pressable>
                    </View>
                  ))}
                  {healthRisk.hazards.some((hazard) => hazard.symptoms) ? (
                    <View style={styles.symptoms}>
                      <Text
                        style={[detailType.symptomSubheading, styles.textColor]}
                        accessibilityRole="header">
                        Common symptoms
                      </Text>
                      {healthRisk.hazards.map((hazard) =>
                        hazard.symptoms ? (
                          <View key={hazard.organism} style={styles.symptomGroup}>
                            <Text style={[detailType.metadataStrong, styles.textColor]}>
                              {hazard.organism}
                            </Text>
                            <SymptomList
                              symptoms={hazard.symptoms}
                              label={`${hazard.organism} symptoms`}
                            />
                          </View>
                        ) : null,
                      )}
                    </View>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={[detailType.body, styles.textColor]}>{healthRisk.risk}</Text>
                  {healthRisk.higherRisk ? (
                    <Text style={[detailType.body, styles.textColor]}>{healthRisk.higherRisk}</Text>
                  ) : null}
                  {healthRisk.symptoms ? (
                    <View style={styles.symptoms}>
                      <Text
                        style={[detailType.symptomSubheading, styles.textColor]}
                        accessibilityRole="header">
                        Common symptoms
                      </Text>
                      <SymptomList symptoms={healthRisk.symptoms} />
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
                </>
              )}
            </Section>
          </>
        ) : null}

        {/* Affected Products: one vertical card per existing row, in source
            order, the first card before See all (N) — the shared table
            model's rows re-presented, nothing regrouped, split or merged.
            Collapsing the rows also drops the Show more state of every card
            about to disappear, so a hidden card never returns expanded. */}
        {affectedProducts ? (
          <>
            <View style={styles.divider} />
            <Section
              title="Affected Products"
              action={
                affectedProducts.table.rowsDisclosure ? (
                  <DetailDisclosure
                    control={affectedProducts.table.rowsDisclosure}
                    expanded={tableExpanded}
                    onPress={() => {
                      if (tableExpanded) {
                        setOpenGroups((groups) =>
                          visibleCellState(
                            groups,
                            affectedProducts.table.collapsed.rows.map((row) => row.id),
                          ),
                        );
                      }
                      setTableExpanded(!tableExpanded);
                    }}
                  />
                ) : null
              }>
              <View style={styles.cards}>
                {cards.map((card) => (
                  <AffectedProductCardView
                    key={card.id}
                    card={card}
                    openGroups={openGroups}
                    fontScale={fontScale}
                    onToggleGroup={(group) =>
                      setOpenGroups((prior) => {
                        const next = new Set(prior);
                        if (!next.delete(group)) next.add(group);
                        return next;
                      })
                    }
                  />
                ))}
              </View>
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
  // The kit's 20pt page gutter, content capped for tablets and the web.
  content: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: detailGeometry.pageGutter,
    paddingTop: spacing[16],
    gap: detailGeometry.bodyGap,
  },
  textColor: {
    color: detailColor.text,
  },
  secondaryColor: {
    color: detailColor.secondary,
  },
  linkColor: {
    color: detailColor.link,
  },
  // The product header: the status row, then identity beside the photo.
  header: {
    gap: detailGeometry.bodyGap,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: detailGeometry.inlineGap,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flexShrink: 1,
    gap: detailGeometry.inlineGap,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: detailGeometry.fieldColumnGap,
  },
  // At accessibility text sizes, or once a title word would break beside the
  // photo, the row becomes a column: identity at full width, photo beneath.
  identityStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  // flex + minWidth 0 let a long product name wrap beside the photo instead of
  // pushing it off the page; with no photo, the identity takes the whole row.
  identity: {
    flex: 1,
    minWidth: 0,
    gap: detailGeometry.bodyGap,
    alignItems: 'flex-start',
  },
  titleBlock: {
    alignSelf: 'stretch',
    gap: spacing[4],
  },
  // The measuring copy of the title. Absolutely positioned and transparent:
  // it spans the identity column's real width, so it wraps exactly as the
  // visible title does, while contributing no height and catching no touch.
  titleProbe: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
    zIndex: -1,
  },
  // A text action (disclosure or title control): its words then a chevron.
  disclosure: {
    alignSelf: 'flex-start',
  },
  disclosureInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
  pressedControl: {
    opacity: 0.6,
  },
  linkPressable: {
    alignSelf: 'flex-start',
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: detailGeometry.inlineGap,
  },
  linkText: {
    flexShrink: 1,
  },
  // The full-width thin divider between major sections, 20pt each side.
  divider: {
    borderTopWidth: detailGeometry.dividerWidth,
    borderTopColor: detailColor.divider,
    marginVertical: detailGeometry.sectionDividerMargin - detailGeometry.bodyGap,
  },
  section: {
    gap: detailGeometry.bodyGap,
  },
  // The heading row: title on the left, an optional reveal opposite it. It
  // wraps, so at large text sizes the reveal moves beneath the heading.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: detailGeometry.inlineGap,
  },
  sectionTitle: {
    flexShrink: 1,
  },
  // A distribution line: the 24pt glyph centred on the FIRST line of text at
  // any type size (its box is one body line tall), the text wrapping in its
  // own column, never back under the glyph.
  distributionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: detailGeometry.fieldColumnGap,
  },
  distributionGlyph: {
    height: detailType.body.lineHeight,
    justifyContent: 'center',
  },
  distributionText: {
    flex: 1,
  },
  // Health Risk: the Common symptoms subheading follows the risk paragraph
  // with no divider; symptom rows carry light dividers between them only.
  symptoms: {
    marginTop: spacing[4],
    gap: spacing[4],
  },
  symptomRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: detailGeometry.fieldColumnGap,
    paddingVertical: detailGeometry.inlineGap,
  },
  symptomRowDivided: {
    borderTopWidth: detailGeometry.dividerWidth,
    borderTopColor: detailColor.divider,
  },
  symptomBubble: {
    width: detailGeometry.symptomBubble,
    height: detailGeometry.symptomBubble,
    borderRadius: detailGeometry.symptomBubble / 2,
    backgroundColor: detailColor.symptomBubble,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Centred on the bubble while the symptom is one line; a longer one wraps
  // beneath with the bubble beside its first line.
  symptomText: {
    flex: 1,
    paddingTop: CENTRED_ON_BUBBLE,
  },
  // One reviewed guide inside a multi-hazard Health Risk section, and one
  // guide's symptoms under the shared Common symptoms subheading.
  hazardGroup: {
    gap: spacing[4],
  },
  symptomGroup: {
    marginTop: spacing[4],
  },
  // Affected products: one white bordered card per row.
  cards: {
    gap: detailGeometry.bodyGap,
  },
  card: {
    backgroundColor: detailColor.surface,
    borderWidth: 1,
    borderColor: detailColor.border,
    borderRadius: detailGeometry.productCardRadius,
    padding: detailGeometry.productCardPadding,
  },
  // The image sits top-right, pinned; the title takes the card's width minus
  // the image and its gap.
  cardHeaderWithImage: {
    minHeight: detailGeometry.productThumbnail,
    paddingRight: TITLE_IMAGE_RESERVE,
  },
  // A title beside the image is at least as tall as the image — the header
  // already is, so nothing moves. The slack means a one- or two-line name
  // can never lose a line to the pixel rounding `CardTitle` corrects, so the
  // common case never needs that correction at all.
  cardTitleBesideImage: {
    minHeight: detailGeometry.productThumbnail,
  },
  cardImage: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  cardImageAbove: {
    marginBottom: detailGeometry.fieldGap,
  },
  // A field: the 104pt label column, 12pt, then the values taking the rest.
  field: {
    flexDirection: 'row',
    gap: detailGeometry.fieldColumnGap,
    marginTop: detailGeometry.fieldGap,
  },
  // Stacked at large text sizes or a narrow card: label above values.
  fieldStacked: {
    gap: spacing[4],
    marginTop: detailGeometry.fieldGap,
  },
  fieldLabel: {
    width: detailGeometry.fieldLabelWidth,
    paddingTop: LABEL_ON_VALUE_LINE,
  },
  fieldValues: {
    flex: 1,
    minWidth: 0,
  },
  // A pair entry: its code and date rows 4pt apart, so they read as one
  // unit, and 16pt above each entry — clearly more than the 10pt between
  // ordinary fields — so neighbouring pairs never run together.
  pairEntry: {
    marginTop: spacing[16],
    gap: spacing[4],
  },
  fieldAfterPairs: {
    marginTop: spacing[16],
  },
  pairRow: {
    flexDirection: 'row',
    gap: detailGeometry.fieldColumnGap,
  },
  pairRowStacked: {
    gap: spacing[4],
  },
  // The pair group's Show more / Show less sits where every field's does: in
  // the value column, beneath the last entry shown.
  pairDisclosureInValueColumn: {
    marginTop: spacing[4],
    marginLeft: detailGeometry.fieldLabelWidth + detailGeometry.fieldColumnGap,
  },
  pairDisclosure: {
    marginTop: spacing[4],
  },
});
