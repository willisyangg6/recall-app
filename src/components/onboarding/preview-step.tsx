/**
 * The Ready step (the preference-board Ready, 2026-09-30), where the
 * shopper first sees what their watch found. Top to bottom, matching the
 * founder-approved target
 * (assets/brand/reference/lotly-onboarding-ready-preference-board-target.png,
 * a design reference that is never bundled): Back; `You’re all set.` with no
 * line beneath it; the grocery scene across the full width, with the
 * physical preference board and the seated waving mascot; `Your recall
 * preview` and `We found N recalls for you.`; the physical deck of real
 * recall cards and its dots; the locked strip or the truthful monitoring
 * line; and the one pinned action, `See my plan`, which opens the separate
 * paywall. No progress bar, no purchase UI.
 *
 * ## Its own page, the frame's chrome
 *
 * The scene bleeds to both screen edges, so Ready draws its own page as
 * Welcome, States and Stores do, keeping the frame's top bar
 * (`OnboardingTopBar`, Back only) and its footer treatment: the page colour
 * over the real bottom inset, the hairline drawn only while content runs
 * beneath it. The page scrolls above the footer at every text size.
 *
 * ## Three approved layers and a native board
 *
 * The scene, the blank board and the foreground overlap
 * (lib/ready-presentation.ts) are drawn at one scale, the page width over
 * 934; the board's contents are NATIVE and sit between the board and the
 * overlap, inside the report's content-safe rectangle, so the mascot, bowl
 * and cloth always stand in front and no row can ever reach them. The
 * board grows upward by what its rows need, at most `BOARD_GROWTH_MAX_PX`,
 * through one slice of quiet paper and the same amount of the thin blue-wall
 * band; past that, and at every accessibility size, the scene is drawn whole
 * with its board blank and the preferences follow at full width
 * (`boardLayout`). The decision is made from a hidden measurement of the
 * board's own contents at the board's own column width, so it never depends
 * on which layout is showing.
 *
 * ## The board's rows
 *
 * `Your preferences`, then States, Allergens and Stores: each the category's
 * artwork on a pale plate, the label (Public Sans SemiBold 14pt, title
 * case, normal spacing) over the values (15pt), dashed rules between, and
 * the blue `Edit preferences` with its chevron. The values are the SAVED
 * choices in canonical order through Profile's compact rule
 * (lib/profile-hub `compactList`: two names, then `+N`, which wraps with
 * the last name rather than alone), `None` for an empty optional group. The Allergens plate shows the
 * first two chosen pictograms in canonical order (one for one, the neutral
 * dash for none); the rest are named in the text. Each row is ONE
 * accessibility element that speaks every chosen name; the plates and rules
 * are never heard.
 *
 * ## The preview
 *
 * `preview` is lib/ready-preview.ts's answer over the REAL feed and the
 * REAL matching layer. The count line, `We found 21 recalls for you.` with
 * only the number emphasised, is every real match (`previewMatchCount`),
 * not the deck's length; with no matches, or before the feed answers, there
 * is no count, no deck and no dots — one quiet card says exactly what is
 * known. The deck is components/onboarding/ready-carousel.tsx.
 */

import { useState, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
  type ImageStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingTopBar } from '@/components/onboarding/onboarding-frame';
import { ReadyDeck } from '@/components/onboarding/ready-carousel';
import { Icon } from '@/components/ui/icon';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import {
  color,
  hitSlopToMinimum,
  layout,
  radius,
  spacing,
  textStyle,
} from '@/constants/design-tokens';
import type { UserRecallPreferences } from '@/domain/preferences';
import { allergenPictogram } from '@/lib/allergen-assets';
import {
  BACK_HINT,
  BACK_LABEL,
  matchCountParts,
  PREVIEW_CHECKING_TITLE,
  PREVIEW_CTA,
  PREVIEW_CTA_HINT,
  PREVIEW_EDIT,
  PREVIEW_EDIT_HINT,
  PREVIEW_EMPTY_TITLE,
  PREVIEW_HEADLINE,
  PREVIEW_LOCKED_HINT,
  PREVIEW_LOCKED_STRIP,
  PREVIEW_MATCH_HEADING,
  PREVIEW_MONITORING_NOTE,
  PREVIEW_NONE,
  PREVIEW_SUMMARY_LABELS,
  PREVIEW_SUMMARY_TITLE,
  PREVIEW_UNAVAILABLE_TITLE,
} from '@/lib/onboarding-copy';
import { summarizePreferences } from '@/lib/profile-hub';
import {
  allergenArtwork,
  atAccessibilitySize,
  BLOCK_GAP,
  boardColumnWidth,
  boardLayout,
  boardRowLabel,
  boardValue,
  CONTENT_PX,
  CTA_MIN_HEIGHT,
  headlineType,
  OVERLAP_PX,
  PAPER_PX,
  PAPER_SLICE_PX,
  PICTOGRAM_PAIR,
  PICTOGRAM_PAIR_STEP,
  PICTOGRAM_SINGLE,
  READY_TYPE,
  ROW_WELL_GAP,
  ROW_WELL_SIZE,
  RULE_GAP,
  SCENE_PX,
  sceneScale,
  type Slice,
  sliceImagePlacement,
  WALL_BAND_PX,
  WELL_WASH_OPACITY,
  type AllergenArtwork,
} from '@/lib/ready-presentation';
import { hasLockedMatches, previewMatchCount, type ReadyPreviewState } from '@/lib/ready-preview';

/** The approved layers, cut from the target at its own pixels (asset report). */
const SCENE =
  require('@/assets/brand/production/lotly-ready-preference-board-scene.png') as ImageSourcePropType;
const PAPER =
  require('@/assets/brand/production/lotly-ready-preference-board-paper.png') as ImageSourcePropType;
const OVERLAP =
  require('@/assets/brand/production/lotly-ready-preference-board-overlap.png') as ImageSourcePropType;

/** `Edit preferences` is one 18pt line; hitSlop makes it a 44pt target. */
const EDIT_HIT_SLOP = hitSlopToMinimum(READY_TYPE.edit.lineHeight);

/** Decorative art: out of the accessibility tree and out of the way of every touch. */
const DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
  pointerEvents: 'none',
} as const;

type RowKey = keyof typeof PREVIEW_SUMMARY_LABELS;

export function PreviewStep({
  prefs,
  preview,
  onSeePlan,
  onEdit,
  onBack,
  editRef,
}: {
  prefs: UserRecallPreferences;
  /** What the watch found (lib/ready-preview.ts): real matches or the truth. */
  preview: ReadyPreviewState;
  /** The one primary action, and the locked card and strip: the paywall. */
  onSeePlan: () => void;
  onEdit: () => void;
  onBack: () => void;
  /** The visible `Edit preferences`, so focus can return to it from the editor. */
  editRef?: React.Ref<View>;
}) {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  // The page's own width: the window's on the first frame, then whatever the
  // page is actually given (the Design Preview's frames are narrower).
  const [pageWidth, setPageWidth] = useState(() => Math.min(width, layout.maxContentWidth));
  const sceneWidth = Math.min(pageWidth, layout.maxContentWidth);
  const scale = sceneScale(sceneWidth);
  // The board's own contents, measured hidden at the board's column width.
  const [measured, setMeasured] = useState<number | null>(null);
  const board = boardLayout(measured, scale, fontScale);

  const summary = summarizePreferences(prefs);
  const rows: { key: RowKey; names: readonly string[]; artwork: ReactNode }[] = [
    {
      key: 'states',
      names: summary.states,
      artwork: <Icon name="map-pin" size={20} color="icon/primary" />,
    },
    {
      key: 'allergens',
      names: summary.allergens,
      artwork: <AllergenPlate artwork={allergenArtwork(prefs.allergens)} />,
    },
    {
      key: 'retailers',
      names: summary.retailers,
      artwork: <Icon name="shopping-cart" size={20} color="icon/primary" />,
    },
  ];
  const content = (ref?: React.Ref<View>) => (
    <BoardContent rows={rows} onEdit={onEdit} editRef={ref} />
  );

  // The footer's hairline shows only while content runs beneath it.
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const overflowing = viewport > 0 && contentHeight > viewport + 1;

  const count = previewMatchCount(preview);

  return (
    <Surface background="background/page" style={styles.page}>
      <OnboardingTopBar
        back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}
        progress={null}
      />
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        onLayout={(event) => {
          setViewport(event.nativeEvent.layout.height);
          setPageWidth(event.nativeEvent.layout.width);
        }}
        onContentSizeChange={(_, height) => setContentHeight(height)}>
        <View style={styles.heading}>
          <Text variant="display" accessibilityRole="header" style={headlineType(fontScale)}>
            {PREVIEW_HEADLINE}
          </Text>
        </View>
        {/* The measurement: the board's rows at the board's column width,
            invisible, untouchable and never heard. */}
        {atAccessibilitySize(fontScale) ? null : (
          <View
            {...DECORATIVE}
            style={[styles.measure, { width: boardColumnWidth(scale) }]}
            onLayout={(event) => setMeasured(event.nativeEvent.layout.height)}>
            {content()}
          </View>
        )}
        <BoardHero width={sceneWidth} growth={board.kind === 'board' ? board.growth : 0}>
          {board.kind === 'board' ? content(editRef) : null}
        </BoardHero>
        {board.kind === 'stacked' ? (
          <View style={styles.stacked}>
            <Surface background="background/surface" radius={16} style={styles.stackedCard}>
              {content(editRef)}
            </Surface>
          </View>
        ) : null}
        <View style={styles.previewSection}>
          <View style={styles.previewHeading}>
            <Text variant="display" accessibilityRole="header" style={READY_TYPE.previewHeading}>
              {PREVIEW_MATCH_HEADING}
            </Text>
            {count !== null ? <CountLine count={count} /> : null}
          </View>
          {preview.kind === 'matches' ? (
            <>
              {preview.models.length > 0 ? (
                <ReadyDeck
                  // New content or a new text size is a new deck: it
                  // re-measures and starts from its first card.
                  key={deckKey(preview.models, preview.locked, fontScale)}
                  models={preview.models}
                  locked={preview.locked}
                  width={sceneWidth - 2 * layout.pageMargin}
                  onLockedPress={onSeePlan}
                />
              ) : null}
              {hasLockedMatches(preview) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={PREVIEW_LOCKED_STRIP}
                  accessibilityHint={PREVIEW_LOCKED_HINT}
                  onPress={onSeePlan}
                  style={({ pressed }) => [pressed && styles.pressed]}>
                  <Surface background="background/subtle" radius={12} style={styles.lockedStrip}>
                    <View {...DECORATIVE}>
                      <Icon name="lock" size={20} color="icon/primary" />
                    </View>
                    <Text variant="body-small-bold" style={styles.lockedText}>
                      {PREVIEW_LOCKED_STRIP}
                    </Text>
                  </Surface>
                </Pressable>
              ) : (
                // No more matches are known, so nothing is claimed locked.
                <Text variant="caption" color="text/secondary">
                  {PREVIEW_MONITORING_NOTE}
                </Text>
              )}
            </>
          ) : (
            <Surface background="background/subtle" radius={16} style={styles.emptyCard}>
              <Text variant="body">
                {preview.kind === 'checking'
                  ? PREVIEW_CHECKING_TITLE
                  : preview.kind === 'unavailable'
                    ? PREVIEW_UNAVAILABLE_TITLE
                    : PREVIEW_EMPTY_TITLE}
              </Text>
              <Text variant="body-small" color="text/secondary">
                {PREVIEW_MONITORING_NOTE}
              </Text>
            </Surface>
          )}
        </View>
      </ScrollView>
      <View
        style={[
          styles.footer,
          overflowing && styles.footerRule,
          { paddingBottom: insets.bottom + spacing[12] },
        ]}>
        <SeeMyPlan onPress={onSeePlan} />
      </View>
    </Surface>
  );
}

/** The deck's identity: its cards and the text size they were measured at. */
function deckKey(
  models: readonly { id: string }[],
  locked: { id: string } | null,
  fontScale: number,
): string {
  return [fontScale, ...models.map((m) => m.id), locked?.id ?? ''].join('|');
}

/**
 * `We found 21 recalls for you.`: one line of muted `body` text, heard as
 * one sentence, with only the number emphasised (Bold, primary ink) — no
 * pill, no button.
 */
function CountLine({ count }: { count: number }) {
  const parts = matchCountParts(count);
  return (
    <Text variant="body" color="text/secondary">
      {parts.before}
      <Text variant="body" style={styles.countNumber}>
        {parts.number}
      </Text>
      {parts.after}
    </Text>
  );
}

/**
 * The scene at `width`, with the board standing on the tabletop and the
 * overlap in front of it. `growth` points of extra board come from the
 * paper's slice and, by the same amount, the wall band; everything below
 * them moves down together, so the board's foot, its painted shadows and the
 * foreground never move relative to one another. `children` are the
 * board's native rows, placed in the content-safe rectangle, beneath the
 * overlap.
 */
function BoardHero({
  width,
  growth,
  children,
}: {
  width: number;
  growth: number;
  children?: ReactNode;
}) {
  const scale = sceneScale(width);
  const paperLeft = PAPER_PX.left * scale;
  const paperTop = PAPER_PX.top * scale;
  return (
    <View style={{ width, height: SCENE_PX.height * scale + growth }}>
      <View {...DECORATIVE} style={StyleSheet.absoluteFill}>
        <SlicedImage
          source={SCENE}
          width={width}
          imageRows={SCENE_PX.height}
          slice={WALL_BAND_PX}
          scale={scale}
          growth={growth}
        />
        <View style={[styles.anchored, { left: paperLeft, top: paperTop }]}>
          <SlicedImage
            source={PAPER}
            width={PAPER_PX.width * scale}
            imageRows={PAPER_PX.height}
            slice={PAPER_SLICE_PX}
            scale={scale}
            growth={growth}
          />
        </View>
      </View>
      {children ? (
        <View
          style={[
            styles.anchored,
            {
              left: paperLeft + CONTENT_PX.left * scale,
              top: paperTop + CONTENT_PX.top * scale,
              width: boardColumnWidth(scale),
            },
          ]}>
          {children}
        </View>
      ) : null}
      <View
        {...DECORATIVE}
        style={[
          styles.anchored,
          {
            left: OVERLAP_PX.left * scale,
            top: OVERLAP_PX.top * scale + growth,
            width: OVERLAP_PX.width * scale,
            height: OVERLAP_PX.height * scale,
          },
        ]}>
        <Image source={OVERLAP} style={styles.fill} />
      </View>
    </View>
  );
}

/**
 * An image drawn in three pieces: its rows above `slice` and below it 1:1,
 * and `slice` stretched by `growth` points. With no growth it is the image.
 */
function SlicedImage({
  source,
  width,
  imageRows,
  slice,
  scale,
  growth,
}: {
  source: ImageSourcePropType;
  width: number;
  imageRows: number;
  slice: Slice;
  scale: number;
  growth: number;
}) {
  const height = imageRows * scale;
  const topCap = slice.top * scale;
  const foot = (imageRows - slice.bottom) * scale;
  const whole: ImageStyle = { position: 'absolute', left: 0, width, height };
  return (
    <View style={{ width, height: height + growth }}>
      <View style={[styles.slice, { top: topCap, bottom: foot }]}>
        <Image
          source={source}
          resizeMode="stretch"
          style={[styles.sliceImage, sliceImagePlacement(slice, imageRows)]}
        />
      </View>
      <View style={[styles.slice, { top: 0, height: topCap }]}>
        <Image source={source} style={[whole, { top: 0 }]} />
      </View>
      <View style={[styles.slice, { bottom: 0, height: foot }]}>
        <Image source={source} style={[whole, { bottom: 0 }]} />
      </View>
    </View>
  );
}

/**
 * The board's contents: `Your preferences`, the three rows between dashed
 * rules, and `Edit preferences`. The same contents on the board and, at
 * full width, below the scene.
 */
function BoardContent({
  rows,
  onEdit,
  editRef,
}: {
  rows: { key: RowKey; names: readonly string[]; artwork: ReactNode }[];
  onEdit: () => void;
  editRef?: React.Ref<View>;
}) {
  return (
    <View>
      <Text variant="display" accessibilityRole="header" style={READY_TYPE.boardHeading}>
        {PREVIEW_SUMMARY_TITLE}
      </Text>
      <View style={styles.rows}>
        {rows.map((row, index) => (
          <View key={row.key}>
            {index > 0 ? <DashedRule /> : null}
            <BoardRow
              label={PREVIEW_SUMMARY_LABELS[row.key]}
              names={row.names}
              artwork={row.artwork}
            />
          </View>
        ))}
      </View>
      <Pressable
        ref={editRef}
        accessibilityRole="button"
        accessibilityLabel={PREVIEW_EDIT}
        accessibilityHint={PREVIEW_EDIT_HINT}
        hitSlop={EDIT_HIT_SLOP}
        onPress={onEdit}
        style={({ pressed }) => [styles.edit, pressed && styles.pressed]}>
        <Text variant="body-small-bold" color="action/secondary" style={READY_TYPE.edit}>
          {PREVIEW_EDIT}
        </Text>
        <Icon name="chevron-right" size={16} color="icon/brand" />
      </Pressable>
    </View>
  );
}

/** One row: its plate, the title-case label over the values, heard once. */
function BoardRow({
  label,
  names,
  artwork,
}: {
  /** The category's name, drawn and spoken as written. */
  label: string;
  names: readonly string[];
  artwork: ReactNode;
}) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={boardRowLabel(label, names, PREVIEW_NONE)}>
      <View {...DECORATIVE} style={styles.well}>
        <View style={styles.wellWash} />
        {artwork}
      </View>
      <View style={styles.rowText}>
        <Text variant="body-small-bold" color="text/secondary" style={READY_TYPE.label}>
          {label}
        </Text>
        <Text variant="body" style={READY_TYPE.value}>
          {boardValue(names, PREVIEW_NONE)}
        </Text>
      </View>
    </View>
  );
}

/** A dashed rule from the text column to the column's end. */
function DashedRule() {
  return (
    <View {...DECORATIVE} style={styles.rule}>
      <View style={styles.ruleDashes} />
    </View>
  );
}

/**
 * The Allergens plate: the chosen pictograms untinted, at most two, in
 * canonical order; the neutral dash when nothing is chosen.
 */
export function AllergenPlate({ artwork }: { artwork: AllergenArtwork }) {
  if (artwork.kind === 'none') return <View style={styles.dash} />;
  const [first, second] = artwork.tokens;
  if (second === undefined) return <Pictogram token={first} side={PICTOGRAM_SINGLE} />;
  return (
    <View style={styles.pair}>
      <View style={styles.pairFirst}>
        <Pictogram token={first} side={PICTOGRAM_PAIR} />
      </View>
      <View style={styles.pairSecond}>
        <Pictogram token={second} side={PICTOGRAM_PAIR} />
      </View>
    </View>
  );
}

function Pictogram({ token, side }: { token: string; side: number }) {
  return (
    <Image
      source={allergenPictogram(token) ?? undefined}
      resizeMode="contain"
      accessible={false}
      style={{ width: side, height: side }}
    />
  );
}

/**
 * `See my plan`: the shared Button's primary treatment (pill, fill, label
 * colour, face, pressed opacity, role) at the target's 46pt and 16pt label.
 */
function SeeMyPlan({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={PREVIEW_CTA_HINT}
      accessibilityState={{ disabled: false, busy: false }}
      onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.cta, pressed && styles.pressed]}>
          <Text variant="body-small-bold" color="text/inverse" style={styles.ctaLabel}>
            {PREVIEW_CTA}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: spacing[16],
  },
  heading: {
    paddingHorizontal: layout.pageMargin,
  },
  measure: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
  },
  anchored: {
    position: 'absolute',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  // A slice of an image: a clipped window onto the whole image.
  slice: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  sliceImage: {
    position: 'absolute',
    left: 0,
    width: '100%',
  },
  stacked: {
    paddingHorizontal: layout.pageMargin,
    marginTop: spacing[16],
  },
  stackedCard: {
    padding: spacing[16],
    borderWidth: 1,
    borderColor: color['border/subtle'],
  },
  rows: {
    marginTop: BLOCK_GAP,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ROW_WELL_GAP,
    minHeight: ROW_WELL_SIZE,
  },
  well: {
    width: ROW_WELL_SIZE,
    height: ROW_WELL_SIZE,
    borderRadius: radius[8],
    overflow: 'hidden',
    backgroundColor: color['background/subtle'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  wellWash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: color['background/surface'],
    opacity: WELL_WASH_OPACITY,
  },
  rowText: {
    flex: 1,
  },
  rule: {
    height: 1,
    overflow: 'hidden',
    marginVertical: RULE_GAP,
    marginLeft: ROW_WELL_SIZE + ROW_WELL_GAP,
  },
  ruleDashes: {
    height: 3,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color['border/default'],
  },
  edit: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[4],
    marginTop: BLOCK_GAP,
  },
  dash: {
    width: 12,
    height: 2,
    borderRadius: radius.full,
    backgroundColor: color['icon/primary'],
  },
  // The plate's own square: the two pictograms on its diagonal.
  pair: {
    width: PICTOGRAM_PAIR + PICTOGRAM_PAIR_STEP,
    height: PICTOGRAM_PAIR + PICTOGRAM_PAIR_STEP,
  },
  pairFirst: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  // Drawn after the first, so it sits over the one shared corner.
  pairSecond: {
    position: 'absolute',
    left: PICTOGRAM_PAIR_STEP,
    top: PICTOGRAM_PAIR_STEP,
  },
  // 16pt of page cream between the scene's straight bottom edge and the
  // heading (about 22pt of clear space above its capitals, the 2026-10-01
  // spacing pass); the deck gives the height back, so the dots still arrive
  // above the footer on an iPhone 17 at the default text size. The locked
  // strip or monitoring line may sit below the fold.
  previewSection: {
    paddingHorizontal: layout.pageMargin,
    marginTop: spacing[16],
    gap: spacing[8],
  },
  previewHeading: {
    gap: 2,
  },
  countNumber: {
    fontFamily: textStyle('heading-2').fontFamily,
  },
  lockedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[12],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
  },
  lockedText: {
    flex: 1,
  },
  emptyCard: {
    padding: spacing[16],
    gap: spacing[8],
  },
  // The frame's footer: the page colour, pinned over the bottom inset.
  footer: {
    width: '100%',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[12],
    borderTopWidth: 1,
    borderTopColor: 'transparent',
    backgroundColor: color['background/page'],
  },
  footerRule: {
    borderTopColor: color['border/subtle'],
  },
  // The shared Button's primary pill (components/ui/button.tsx), 46pt tall.
  cta: {
    minHeight: CTA_MIN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
    borderRadius: radius.full,
    backgroundColor: color['action/primary'],
  },
  ctaLabel: {
    ...READY_TYPE.cta,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
