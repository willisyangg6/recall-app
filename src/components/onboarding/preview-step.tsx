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
 * ## Two illustrated boards and a native block
 *
 * The compact board's scene, blank board and foreground overlap
 * (lib/ready-presentation.ts) are drawn at one scale, the page width over
 * 934; the board's contents are NATIVE and sit between the board and the
 * overlap, inside the report's content-safe rectangle, so the mascot, bowl
 * and cloth always stand in front and no row can ever reach them. It grows
 * upward by what its rows need, at most `BOARD_GROWTH_MAX_PX`, through one
 * slice of quiet paper and the same amount of the thin blue-wall band.
 *
 * Content that does not fit the compact board within that cap with every
 * word whole takes the WIDE board (`boardTemplate`): broader paper whose
 * native block sits above the mascot and groceries, which overlap only a
 * blank bottom margin, and which grows as far as the block needs through
 * quilted extension plates and feathers (`WideBoardHero`). Every preference
 * and `Edit preferences` are always on illustrated paper; there is no
 * separate preferences card. The choice comes from a hidden measurement of
 * this content at this width and text size, and the page is not shown until
 * it first answers, so arrival never shows one board and then the other.
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

import { useRef, useState, type ReactNode } from 'react';
import {
  Image,
  PixelRatio,
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
  BLOCK_GAP,
  boardColumnWidth,
  boardRowLabel,
  boardTemplate,
  boardValue,
  brokenWordCount,
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
  WIDE_GROWTH,
  WIDE_OVERLAP_PX,
  WIDE_PAPER_PX,
  WIDE_SCENE_PX,
  WIDE_TEXT_PX,
  wideHeadingWidth,
  wideTextWidth,
  plateCopies,
  type AllergenArtwork,
  type BlockMeasure,
  type BlockRect,
  type BoardMeasurement,
  type BoardTemplate,
} from '@/lib/ready-presentation';
import { hasLockedMatches, previewMatchCount, type ReadyPreviewState } from '@/lib/ready-preview';

/** The approved layers, cut from the target at its own pixels (asset report). */
const SCENE =
  require('@/assets/brand/production/lotly-ready-preference-board-scene.png') as ImageSourcePropType;
const PAPER =
  require('@/assets/brand/production/lotly-ready-preference-board-paper.png') as ImageSourcePropType;
const OVERLAP =
  require('@/assets/brand/production/lotly-ready-preference-board-overlap.png') as ImageSourcePropType;

/** The wide board's prepared layers (wide-board asset report, 2026-10-02). */
const WIDE = {
  scene:
    require('@/assets/brand/production/lotly-ready-wide-board-scene.png') as ImageSourcePropType,
  paper:
    require('@/assets/brand/production/lotly-ready-wide-board-paper.png') as ImageSourcePropType,
  overlap:
    require('@/assets/brand/production/lotly-ready-wide-board-overlap.png') as ImageSourcePropType,
  paperPlate:
    require('@/assets/brand/production/lotly-ready-wide-board-paper-extension.png') as ImageSourcePropType,
  wallPlate:
    require('@/assets/brand/production/lotly-ready-wide-board-wall-extension.png') as ImageSourcePropType,
  paperFeather:
    require('@/assets/brand/production/lotly-ready-wide-board-paper-feather.png') as ImageSourcePropType,
  wallFeather:
    require('@/assets/brand/production/lotly-ready-wide-board-wall-feather.png') as ImageSourcePropType,
} as const;

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
  const summary = summarizePreferences(prefs);
  const rows: BoardRowModel[] = [
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

  // The board's own block, measured hidden three ways (compact; wide with
  // the plates beside and above the words) for exactly this content, width
  // and text size. Until the first answer the page is laid out but not
  // shown, so arrival never shows one board and then the other.
  const contentKey = [sceneWidth, fontScale, ...rows.map((row) => row.names.join(','))].join('|');
  const [measures, setMeasures] = useState<Readonly<Record<string, number>>>({});
  const record = (key: string, value: number) =>
    setMeasures((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  // Where each drawn piece of the wide block sits (the wide board grows by
  // what the foreground beneath each piece needs).
  const [pieces, setPieces] = useState<Readonly<Record<string, readonly BlockRect[]>>>({});
  const recordPieces = (key: string, rects: readonly BlockRect[]) =>
    setPieces((prev) => (sameRects(prev[key], rects) ? prev : { ...prev, [key]: rects }));
  const wideRoot = useRef<View>(null);
  const wideStackedRoot = useRef<View>(null);
  const measurement = boardMeasurement(measures, pieces, contentKey);
  const resolved = measurement ? boardTemplate(measurement, scale) : null;
  // The last answer stays while new content is measured (after an edit).
  const [settled, setSettled] = useState<BoardTemplate | null>(null);
  if (resolved && !sameTemplate(resolved, settled)) setSettled(resolved);
  const template = resolved ?? settled;
  // The chosen board's own artwork: the page is revealed, board and text
  // together, once every one of its images has loaded (or failed), never on
  // a timer. The compact board is drawn from the first frame (as it always
  // was); the wide one once chosen. Each counts its own loads.
  const [artLoads, setArtLoads] = useState<Readonly<Record<BoardTemplate['kind'], number>>>({
    compact: 0,
    wide: 0,
  });
  const onArt = (kind: BoardTemplate['kind']) => () =>
    setArtLoads((prev) => ({ ...prev, [kind]: prev[kind] + 1 }));
  const [revealed, setRevealed] = useState(false);
  if (!revealed && template && artLoads[template.kind] >= heroImageCount(template, scale))
    setRevealed(true);
  const measureVariant = (variant: MeasureVariant) => {
    const root = variant === 'wide' ? wideRoot : variant === 'wideStacked' ? wideStackedRoot : null;
    return (
      <View
        style={{ width: variant === 'compact' ? boardColumnWidth(scale) : wideTextWidth(scale) }}
        onLayout={(event) => record(`${contentKey}|${variant}:h`, event.nativeEvent.layout.height)}>
        <BoardContent
          rows={rows}
          onEdit={onEdit}
          stacked={variant === 'wideStacked'}
          headingWidth={variant === 'compact' ? undefined : wideHeadingWidth(scale)}
          onBroken={(part, broken) => record(`${contentKey}|${variant}:b:${part}`, broken)}
          geometry={
            root
              ? {
                  root,
                  report: (part, rects) => recordPieces(`${contentKey}|${variant}:${part}`, rects),
                }
              : undefined
          }
        />
      </View>
    );
  };

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
        {/* The measurement: the board's block three ways, invisible,
            untouchable and never heard. */}
        <View {...DECORATIVE} style={styles.measure}>
          {measureVariant('compact')}
          {measureVariant('wide')}
          {measureVariant('wideStacked')}
        </View>
        <View style={revealed ? null : styles.unsettled}>
          <View style={styles.heading}>
            <Text variant="display" accessibilityRole="header" style={headlineType(fontScale)}>
              {PREVIEW_HEADLINE}
            </Text>
          </View>
          {template?.kind === 'wide' ? (
            <WideBoardHero width={sceneWidth} growth={template.growth} onArt={onArt('wide')}>
              <BoardContent
                rows={rows}
                onEdit={onEdit}
                editRef={editRef}
                stacked={template.stacked}
                headingWidth={wideHeadingWidth(scale)}
              />
            </WideBoardHero>
          ) : (
            <BoardHero width={sceneWidth} growth={template?.growth ?? 0} onArt={onArt('compact')}>
              <BoardContent rows={rows} onEdit={onEdit} editRef={editRef} stacked={false} />
            </BoardHero>
          )}
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
  onArt,
}: {
  width: number;
  growth: number;
  children?: ReactNode;
  /** Each image's load (or failure), so the page reveals with its art. */
  onArt?: () => void;
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
          onArt={onArt}
        />
        <View style={[styles.anchored, { left: paperLeft, top: paperTop }]}>
          <SlicedImage
            source={PAPER}
            width={PAPER_PX.width * scale}
            imageRows={PAPER_PX.height}
            slice={PAPER_SLICE_PX}
            scale={scale}
            growth={growth}
            onArt={onArt}
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
        <Image source={OVERLAP} style={styles.fill} onLoadEnd={onArt} />
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
  onArt,
}: {
  source: ImageSourcePropType;
  width: number;
  imageRows: number;
  slice: Slice;
  scale: number;
  growth: number;
  onArt?: () => void;
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
          onLoadEnd={onArt}
        />
      </View>
      <View style={[styles.slice, { top: 0, height: topCap }]}>
        <Image source={source} style={[whole, { top: 0 }]} onLoadEnd={onArt} />
      </View>
      <View style={[styles.slice, { bottom: 0, height: foot }]}>
        <Image source={source} style={[whole, { bottom: 0 }]} onLoadEnd={onArt} />
      </View>
    </View>
  );
}

type BoardRowModel = { key: RowKey; names: readonly string[]; artwork: ReactNode };

/** The three hidden measurements of the board's block. */
type MeasureVariant = keyof BoardMeasurement;
const MEASURE_VARIANTS: readonly MeasureVariant[] = ['compact', 'wide', 'wideStacked'];
/** Each text in the block reports its broken words under one of these names. */
const MEASURE_PARTS = [
  'heading',
  ...[0, 1, 2].flatMap((row) => [`${row}.label`, `${row}.value`]),
  'edit',
] as const;

/** The wide block's drawn pieces, each reported where it sits in the block. */
const GEOMETRY_PARTS = [
  'heading',
  ...[0, 1, 2].flatMap((row) => [
    ...(row > 0 ? [`${row}.rule`] : []),
    `${row}.plate`,
    `${row}.label`,
    `${row}.value`,
  ]),
  'edit',
] as const;

/** The measurement for `contentKey`, once every reading has arrived. */
function boardMeasurement(
  measures: Readonly<Record<string, number>>,
  pieces: Readonly<Record<string, readonly BlockRect[]>>,
  contentKey: string,
): BoardMeasurement | null {
  const read = (variant: MeasureVariant): BlockMeasure | null => {
    const height = measures[`${contentKey}|${variant}:h`];
    if (height === undefined) return null;
    let broken = 0;
    for (const part of MEASURE_PARTS) {
      const value = measures[`${contentKey}|${variant}:b:${part}`];
      if (value === undefined) return null;
      broken += value;
    }
    if (variant === 'compact') return { height, broken };
    const rects: BlockRect[] = [];
    for (const part of GEOMETRY_PARTS) {
      const found = pieces[`${contentKey}|${variant}:${part}`];
      if (found === undefined) return null;
      rects.push(...found);
    }
    return { height, broken, rects };
  };
  const [compact, wide, wideStacked] = MEASURE_VARIANTS.map(read);
  return compact && wide && wideStacked ? { compact, wide, wideStacked } : null;
}

function sameRects(a: readonly BlockRect[] | undefined, b: readonly BlockRect[]): boolean {
  return (
    a !== undefined &&
    a.length === b.length &&
    a.every(
      (r, i) =>
        r.x === b[i].x && r.y === b[i].y && r.width === b[i].width && r.height === b[i].height,
    )
  );
}

/** Where the hidden measurement reports the wide block's drawn pieces. */
type Geometry = {
  root: React.RefObject<View | null>;
  report: (part: string, rects: readonly BlockRect[]) => void;
};

/** A View that reports its own rectangle in the block (the hidden measurement only). */
function Piece({
  geometry,
  part,
  style,
  children,
  decorative,
}: {
  geometry?: Geometry;
  part: string;
  style?: React.ComponentProps<typeof View>['style'];
  children?: ReactNode;
  decorative?: boolean;
}) {
  const self = useRef<View>(null);
  return (
    <View
      ref={self}
      {...(decorative ? DECORATIVE : null)}
      style={style}
      onLayout={
        geometry
          ? () => {
              const root = geometry.root.current;
              if (root && self.current)
                self.current.measureLayout(root, (x, y, width, height) =>
                  geometry.report(part, [{ x, y, width, height }]),
                );
            }
          : undefined
      }>
      {children}
    </View>
  );
}

/**
 * A board text that reports, in the hidden measurement, its broken words and
 * where each of its lines sits in the block.
 */
function PieceText({
  geometry,
  part,
  text,
  onBroken,
  ...props
}: React.ComponentProps<typeof Text> & {
  geometry?: Geometry;
  part: string;
  text: string;
  onBroken?: (broken: number) => void;
}) {
  const self = useRef<View>(null);
  const seen = useRef<{ lines?: readonly BlockRect[]; offset?: { x: number; y: number } }>({});
  const flush = () => {
    const { lines, offset } = seen.current;
    if (geometry && lines && offset)
      geometry.report(
        part,
        lines.map((line) => ({ ...line, x: line.x + offset.x, y: line.y + offset.y })),
      );
  };
  if (!geometry) {
    // On the board itself the text is exactly the approved one: no wrapper.
    return (
      <Text
        {...props}
        onTextLayout={
          onBroken
            ? (event) =>
                onBroken(
                  brokenWordCount(
                    text,
                    event.nativeEvent.lines.map((line) => line.text),
                  ),
                )
            : undefined
        }>
        {text}
      </Text>
    );
  }
  return (
    <View
      ref={self}
      onLayout={() => {
        const root = geometry.root.current;
        if (root && self.current)
          self.current.measureLayout(root, (x, y) => {
            seen.current.offset = { x, y };
            flush();
          });
      }}>
      <Text
        {...props}
        onTextLayout={
          onBroken || geometry
            ? (event) => {
                const lines = event.nativeEvent.lines;
                onBroken?.(
                  brokenWordCount(
                    text,
                    lines.map((line) => line.text),
                  ),
                );
                seen.current.lines = lines.map(({ x, y, width, height }) => ({
                  x,
                  y,
                  width,
                  height,
                }));
                flush();
              }
            : undefined
        }>
        {text}
      </Text>
    </View>
  );
}

function sameTemplate(a: BoardTemplate, b: BoardTemplate | null): boolean {
  if (b === null || a.kind !== b.kind || a.growth !== b.growth) return false;
  return a.kind === 'compact' || (b.kind === 'wide' && a.stacked === b.stacked);
}

/** How many images a grown wide layer draws (`GrownLayer`). */
function grownLayerImageCount(growth: number, scale: number): number {
  if (growth <= 0) return 1;
  return 3 + plateCopies((growth + WIDE_GROWTH.featherRows * scale) / scale);
}

/** How many images the chosen board draws: the page reveals once each has loaded. */
function heroImageCount(template: BoardTemplate, scale: number): number {
  if (template.kind === 'compact') return 3 + 3 + 1;
  return 2 * grownLayerImageCount(template.growth, scale) + 1;
}

/**
 * The wide board at `width`: scene, broad paper, the native block, then the
 * mascot and groceries in front. `growth` points of extra board come from
 * the extension plates (scene and paper alike) inserted at the growth row,
 * each ending under its feather; everything below the row, the foreground
 * included, moves down together. The block sits in the measured text region,
 * which the foreground never reaches.
 */
function WideBoardHero({
  width,
  growth,
  children,
  onArt,
}: {
  width: number;
  growth: number;
  children: ReactNode;
  /** Each image's load (or failure), so the page reveals with its art. */
  onArt?: () => void;
}) {
  const scale = sceneScale(width);
  const paperLeft = WIDE_PAPER_PX.left * scale;
  const paperTop = WIDE_PAPER_PX.top * scale;
  return (
    <View style={{ width, height: WIDE_SCENE_PX.height * scale + growth }}>
      <View {...DECORATIVE} style={StyleSheet.absoluteFill}>
        <GrownLayer
          source={WIDE.scene}
          plate={WIDE.wallPlate}
          feather={WIDE.wallFeather}
          imageRows={WIDE_SCENE_PX.height}
          imageWidth={WIDE_SCENE_PX.width}
          insertRow={WIDE_GROWTH.sceneRow}
          scale={scale}
          growth={growth}
          onArt={onArt}
        />
        <View style={[styles.anchored, { left: paperLeft, top: paperTop }]}>
          <GrownLayer
            source={WIDE.paper}
            plate={WIDE.paperPlate}
            feather={WIDE.paperFeather}
            imageRows={WIDE_PAPER_PX.height}
            imageWidth={WIDE_PAPER_PX.width}
            insertRow={WIDE_GROWTH.paperRow}
            scale={scale}
            growth={growth}
            onArt={onArt}
          />
        </View>
      </View>
      <View
        style={[
          styles.anchored,
          {
            left: paperLeft + WIDE_TEXT_PX.left * scale,
            top: paperTop + WIDE_TEXT_PX.top * scale,
            width: wideTextWidth(scale),
          },
        ]}>
        {children}
      </View>
      <View
        {...DECORATIVE}
        style={[
          styles.anchored,
          {
            left: WIDE_OVERLAP_PX.left * scale,
            top: WIDE_OVERLAP_PX.top * scale + growth,
            width: WIDE_OVERLAP_PX.width * scale,
            height: WIDE_OVERLAP_PX.height * scale,
          },
        ]}>
        <Image source={WIDE.overlap} style={styles.fill} onLoadEnd={onArt} />
      </View>
    </View>
  );
}

/**
 * One wide layer grown by `growth` points: its rows above `insertRow`; the
 * extension plate for the growth plus the feather's rows (repeated mirrored
 * past its own height); the feather (the rows below the insertion fading
 * in); then the rest of the layer. With no growth, the layer whole. Pieces
 * meet on device pixels and the plate starts one pixel early, so no hairline
 * of what is behind shows between them.
 */
function GrownLayer({
  source,
  plate,
  feather,
  imageRows,
  imageWidth,
  insertRow,
  scale,
  growth,
  onArt,
}: {
  source: ImageSourcePropType;
  plate: ImageSourcePropType;
  feather: ImageSourcePropType;
  imageRows: number;
  imageWidth: number;
  insertRow: number;
  scale: number;
  growth: number;
  onArt?: () => void;
}) {
  const width = imageWidth * scale;
  const height = imageRows * scale;
  const whole: ImageStyle = { position: 'absolute', left: 0, width, height };
  if (growth <= 0) {
    return (
      <View style={{ width, height }}>
        <Image source={source} style={[whole, { top: 0 }]} onLoadEnd={onArt} />
      </View>
    );
  }
  const snap = PixelRatio.roundToNearestPixel;
  const pixel = 1 / PixelRatio.get();
  const insert = snap(insertRow * scale);
  const featherHeight = WIDE_GROWTH.featherRows * scale;
  const plateHeight = WIDE_GROWTH.plateRows * scale;
  const plateSpan = growth + featherHeight;
  // (`grownLayerImageCount` counts the images drawn here.)
  const below = snap(insert + featherHeight + growth);
  return (
    <View style={{ width, height: height + growth }}>
      <View style={[styles.slice, { top: 0, height: insert }]}>
        <Image source={source} style={[whole, { top: 0 }]} onLoadEnd={onArt} />
      </View>
      {Array.from({ length: plateCopies(plateSpan / scale) }, (_, index) => (
        <View
          key={index}
          style={[
            styles.slice,
            {
              top: insert - pixel + index * plateHeight,
              height: Math.min(plateHeight, plateSpan - index * plateHeight) + pixel,
            },
          ]}>
          <View style={[{ width, height: plateHeight }, index % 2 === 1 && styles.mirrored]}>
            <Image source={plate} style={styles.fill} onLoadEnd={onArt} />
          </View>
        </View>
      ))}
      <View style={[styles.slice, { top: insert + growth, height: featherHeight }]}>
        <Image source={feather} style={styles.fill} onLoadEnd={onArt} />
      </View>
      <View style={[styles.slice, { top: below, bottom: 0 }]}>
        <Image
          source={source}
          style={[whole, { top: -(insertRow + WIDE_GROWTH.featherRows) * scale }]}
          onLoadEnd={onArt}
        />
      </View>
    </View>
  );
}

/**
 * The board's contents: `Your preferences`, the three rows between dashed
 * rules, and `Edit preferences`. The same contents on either board and in the
 * hidden measurement. `stacked` puts each row's plate above its words, so
 * the words have the block's whole width; `headingWidth` keeps the wide
 * heading clear of the lime ribbon; `onBroken` (the measurement only)
 * reports each text's broken words.
 */
function BoardContent({
  rows,
  onEdit,
  editRef,
  stacked,
  headingWidth,
  onBroken,
  geometry,
}: {
  rows: readonly BoardRowModel[];
  onEdit: () => void;
  editRef?: React.Ref<View>;
  stacked: boolean;
  headingWidth?: number;
  onBroken?: (part: string, broken: number) => void;
  /** The hidden wide measurement: report every drawn piece's place in the block. */
  geometry?: Geometry;
}) {
  const edit = (
    <Pressable
      ref={editRef}
      accessibilityRole="button"
      accessibilityLabel={PREVIEW_EDIT}
      accessibilityHint={PREVIEW_EDIT_HINT}
      hitSlop={EDIT_HIT_SLOP}
      onPress={onEdit}
      style={({ pressed }) => [styles.edit, pressed && styles.pressed]}>
      <Text
        variant="body-small-bold"
        color="action/secondary"
        style={[READY_TYPE.edit, styles.editText]}
        onTextLayout={
          onBroken
            ? (event) =>
                onBroken(
                  'edit',
                  brokenWordCount(
                    PREVIEW_EDIT,
                    event.nativeEvent.lines.map((line) => line.text),
                  ),
                )
            : undefined
        }>
        {PREVIEW_EDIT}
      </Text>
      <Icon name="chevron-right" size={16} color="icon/brand" />
    </Pressable>
  );
  return (
    <View ref={geometry?.root}>
      <PieceText
        geometry={geometry}
        part="heading"
        text={PREVIEW_SUMMARY_TITLE}
        variant="display"
        accessibilityRole="header"
        style={[READY_TYPE.boardHeading, headingWidth ? { maxWidth: headingWidth } : null]}
        onBroken={onBroken && ((n) => onBroken('heading', n))}
      />
      <View style={styles.rows}>
        {rows.map((row, index) => (
          <View key={row.key}>
            {index > 0 ? (
              <DashedRule stacked={stacked} geometry={geometry} part={`${index}.rule`} />
            ) : null}
            <BoardRow
              label={PREVIEW_SUMMARY_LABELS[row.key]}
              names={row.names}
              artwork={row.artwork}
              stacked={stacked}
              onBroken={onBroken && ((part, n) => onBroken(`${index}.${part}`, n))}
              geometry={geometry}
              part={`${index}`}
            />
          </View>
        ))}
      </View>
      {geometry ? (
        <Piece geometry={geometry} part="edit" style={styles.editPiece}>
          {edit}
        </Piece>
      ) : (
        edit
      )}
    </View>
  );
}

/** One row: its plate, the title-case label over the values, heard once. */
function BoardRow({
  label,
  names,
  artwork,
  stacked,
  onBroken,
  geometry,
  part,
}: {
  /** The category's name, drawn and spoken as written. */
  label: string;
  names: readonly string[];
  artwork: ReactNode;
  /** The plate above the words rather than beside them. */
  stacked: boolean;
  onBroken?: (part: 'label' | 'value', broken: number) => void;
  geometry?: Geometry;
  part: string;
}) {
  const value = boardValue(names, PREVIEW_NONE);
  return (
    <View
      style={[styles.row, stacked && styles.rowStacked]}
      accessible
      accessibilityLabel={boardRowLabel(label, names, PREVIEW_NONE)}>
      <Piece geometry={geometry} part={`${part}.plate`} style={styles.well} decorative>
        <View style={styles.wellWash} />
        {artwork}
      </Piece>
      <View style={stacked ? null : styles.rowText}>
        <PieceText
          geometry={geometry}
          part={`${part}.label`}
          text={label}
          variant="body-small-bold"
          color="text/secondary"
          style={READY_TYPE.label}
          onBroken={onBroken && ((n) => onBroken('label', n))}
        />
        <PieceText
          geometry={geometry}
          part={`${part}.value`}
          text={value}
          variant="body"
          style={READY_TYPE.value}
          onBroken={onBroken && ((n) => onBroken('value', n))}
        />
      </View>
    </View>
  );
}

/** A dashed rule from the text column (the row's start when stacked) to the block's end. */
function DashedRule({
  stacked,
  geometry,
  part,
}: {
  stacked: boolean;
  geometry?: Geometry;
  part: string;
}) {
  return (
    <Piece
      geometry={geometry}
      part={part}
      decorative
      style={[styles.rule, stacked && styles.ruleStacked]}>
      <View style={styles.ruleDashes} />
    </Piece>
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
  // Laid out but not shown until the board's measurement first answers.
  unsettled: {
    opacity: 0,
  },
  // A repeated extension plate's every other copy, upside down.
  mirrored: {
    transform: [{ scaleY: -1 }],
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
  // The plate on its own line, the words beneath at the block's full width.
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing[8],
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
  ruleStacked: {
    marginLeft: 0,
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
  // The action's own box, hugging the action (as the Pressable alone did).
  editPiece: {
    alignSelf: 'flex-start',
  },
  // Wraps beside its chevron at the largest sizes rather than overflowing.
  editText: {
    flexShrink: 1,
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
