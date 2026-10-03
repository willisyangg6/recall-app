/**
 * The Ready step's presentation rules (the preference-board Ready,
 * 2026-09-30): where the approved layers sit, how the physical board grows
 * to hold its native rows, when the page uses the wide board instead, what
 * each board row shows and says, and the physical recall
 * deck's poses and gesture rules. Numbers and pure functions only, so all
 * of it is testable under Node; `components/onboarding/preview-step.tsx` and
 * `ready-carousel.tsx` map them onto React Native. A leaf.
 *
 * ## Three layers, one scale
 *
 * The founder-approved target
 * (assets/brand/reference/lotly-onboarding-ready-preference-board-target.png,
 * 934px wide, no system chrome) was decomposed into a scene (blue wall,
 * pear, raspberry bowl, cloth, tabletop and the seated waving mascot, with
 * the board's footprint cleared), a BLANK board (every printed label,
 * value, icon plate, rule and action removed) and a foreground overlap (the
 * mascot, bowl and cloth exactly where they stand in front of the board).
 * All three are cut at the target's own pixels and scale by ONE factor,
 * `width / 934`; the offsets below are the asset report's
 * (assets/brand/reference/ready-preference-board/lotly-ready-preference-board-asset-report.json),
 * and `ready-board-assets.test.ts` pins them to it. Positions are in those
 * reference pixels unless they say points.
 *
 * ## The board grows upward, by a bounded amount
 *
 * The board stands on the tabletop, so its foot never moves: the crevice
 * shadow, the cast shadows painted on it and the bowl, cloth and mascot in
 * front of it stay exactly where the scene expects them. Extra height comes
 * from ONE quiet slice of blank paper (`PAPER_SLICE_PX`, below the lime
 * corner band, above the mascot's shadow) and, by the same amount, from one
 * thin band of out-of-focus blue wall (`WALL_BAND_PX`), so the wavy top
 * keeps its approved distance above the board. Nothing else is stretched:
 * not the mascot, the food, the cloth or the tabletop.
 *
 * Growth is capped at `BOARD_GROWTH_MAX_PX` (80 source pixels, the founder's
 * cap): beyond about 2.5x the slice's crackle visibly streaks.
 *
 * ## Two boards, chosen by fit (2026-10-02)
 *
 * The founder rejected any separate preferences card: every preference and
 * `Edit preferences` are always on illustrated paper. Content that fits the
 * compact board (above) within its cap, with no word broken, keeps the
 * compact board. Anything else takes the WIDE board
 * (assets/brand/reference/ready-wide-board/lotly-ready-wide-board-asset-report.json):
 * broader paper whose native block sits above the mascot and groceries, which
 * overlap only a blank bottom margin, and which grows without limit by
 * quilted extension plates rather than by stretching (`wideTemplate`).
 *
 * ## Native content inside the measured safe rectangle
 *
 * The board's native rows live inside `CONTENT_PX`, the report's
 * content-safe rectangle: 14px from the board's edges and 8px from the
 * foreground overlap and the lime band at default height. It never meets
 * the mascot, the bowl or the cloth, and it gains exactly the board's growth
 * because the slice lies inside it.
 *
 * ## Glyph provenance
 *
 * `shopping-cart` is Lucide's `shopping-cart` (ISC), byte-identical to the
 * file at the allergen set's pinned commit (lib/allergen-icons.ts,
 * `f06ac67e…`, release 1.47.0), vendored in assets/icon-sources/lucide/ on
 * 2026-09-26 and rasterised by scripts/render-onboarding-assets.mjs on the
 * set's box and stroke; allergen-icons.test.ts pins the source and the three
 * files by hash. `lock` marks the locked final card and strip.
 */

import { typography } from '@/constants/design-tokens';
import { CONSUMER_ALLERGENS } from '@/domain/preferences';
import { listNames } from '@/lib/personalization-screen';
import { compactList } from '@/lib/profile-hub';

// ── The glyphs this step adds to the icon set ───────────────────────────────

/**
 * The Ready step's glyphs and their vendored Lucide sources: `shopping-cart`
 * for the Stores row (2026-09-26) and `lock` for the locked card and strip
 * (2026-09-28).
 */
export const READY_ICON_SOURCES = [
  { icon: 'shopping-cart', lucideName: 'shopping-cart' },
  { icon: 'lock', lucideName: 'lock' },
] as const;
export const READY_ICONS_VENDORED_ON = '2026-09-26';

// ── The layers (asset report) ───────────────────────────────────────────────

/** The approved target's width, in pixels: every layer is cut from it at 1:1. */
export const REFERENCE_WIDTH = 934;

/** The scene, lotly-ready-preference-board-scene.png: target rows 187–789, full width. */
export const SCENE_PX = { width: 934, height: 603 } as const;

/** The blank board, lotly-ready-preference-board-paper.png, and where it sits in the scene. */
export const PAPER_PX = { width: 519, height: 458, left: 125, top: 62 } as const;

/** The foreground overlap, lotly-ready-preference-board-overlap.png, fixed to the scene. */
export const OVERLAP_PX = { width: 516, height: 311, left: 128, top: 209 } as const;

/** One stretchable slice, rows [top, bottom) of an image. */
export type Slice = { readonly top: number; readonly bottom: number };

/** The board's one stretchable slice of quiet paper (target rows 346–399). */
export const PAPER_SLICE_PX: Slice = { top: 97, bottom: 151 };

/** The scene's thin band of blue wall that grows with the board (target rows 244–247). */
export const WALL_BAND_PX: Slice = { top: 57, bottom: 61 };

/** The most the board may grow, in source pixels (the founder's cap). */
export const BOARD_GROWTH_MAX_PX = 80;

/**
 * The content-safe rectangle, as insets from the board image's edges
 * (target x 173–534, y 264–679 at default height).
 */
export const CONTENT_PX = { left: 48, right: 110, top: 15, bottom: 28 } as const;

/** Points per reference pixel when the scene spans `widthPt`. */
export function sceneScale(widthPt: number): number {
  return widthPt / REFERENCE_WIDTH;
}

/** The board's native column width, in points, at `scale`. */
export function boardColumnWidth(scale: number): number {
  return (PAPER_PX.width - CONTENT_PX.left - CONTENT_PX.right) * scale;
}

/** The content height the board holds without growing, in points, at `scale`. */
export function boardCapacity(scale: number): number {
  return (PAPER_PX.height - CONTENT_PX.top - CONTENT_PX.bottom) * scale;
}

/** The most the board may grow, in points, at `scale`. */
export function boardGrowthMax(scale: number): number {
  return BOARD_GROWTH_MAX_PX * scale;
}

/** iOS's accessibility text sizes start at this text scale. */
export const ACCESSIBILITY_SCALE = 1.5;

export function atAccessibilitySize(fontScale: number): boolean {
  return fontScale >= ACCESSIBILITY_SCALE;
}

// ── The wide board (asset report, 2026-10-02) ───────────────────────────────

/** The wide scene, lotly-ready-wide-board-scene.png: target rows 190–960, full width. */
export const WIDE_SCENE_PX = { width: 934, height: 771 } as const;
/** The wide blank paper and where it sits in the wide scene. */
export const WIDE_PAPER_PX = { width: 782, height: 597, left: 85, top: 60 } as const;
/** The wide foreground overlap, fixed below the insertion row. */
export const WIDE_OVERLAP_PX = { width: 786, height: 267, left: 83, top: 392 } as const;
/**
 * Growth: new rows go between target rows 469 and 470, which are paper row
 * 220 and scene row 280. Each layer draws its rows above the insertion, then
 * its extension plate (`plateRows` tall, repeated mirrored past that), then
 * its `featherRows` (the original rows below the insertion with a 0→1 alpha
 * ramp) over the plate's end, then the rest of the layer.
 */
export const WIDE_GROWTH = {
  paperRow: 220,
  sceneRow: 280,
  plateRows: 1200,
  featherRows: 24,
} as const;
/**
 * The native block's region on the wide paper, in paper pixels: 48px inside
 * the board's left edge and 14px inside its top, `width` wide (14px inside
 * the right edge). `headingWidth` keeps the heading 8px clear of the lime
 * ribbon, which it sits beside; every row starts below the ribbon's reach.
 * How far down the block may run is not a rectangle: see `wideGrowth`.
 */
export const WIDE_TEXT_PX = { left: 49, top: 15, width: 719, headingWidth: 648 } as const;

/** The wide native block's width, in points, at `scale`. */
export function wideTextWidth(scale: number): number {
  return WIDE_TEXT_PX.width * scale;
}

/** The wide heading's width, in points, at `scale`. */
export function wideHeadingWidth(scale: number): number {
  return WIDE_TEXT_PX.headingWidth * scale;
}

/**
 * The top of the wide foreground (the pear, bowl and mascot, with the
 * overlap's 3px exact-pixel apron) in each 8px column of the wide paper, as
 * a paper row at default height; 0 where nothing stands in front of the
 * board. Measured from lotly-ready-wide-board-overlap.png
 * (`ready-wide-board-assets.test.ts` re-derives it).
 */
export const WIDE_FOREGROUND_COLUMN_PX = 8;
export const WIDE_FOREGROUND_TOP_PX: readonly number[] = [
  332, 366, 380, 392, 407, 445, 477, 495, 499, 502, 510, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 551, 534, 520, 507, 499, 476, 468, 460, 453, 447, 443, 438, 435,
  432, 430, 429, 428, 428, 428, 429, 430, 406, 383, 377, 376, 377, 383, 416, 407, 404,
];
/**
 * Clearance from the foreground's apron, in source pixels: 5 to the side
 * (the report's 8px from the art) and 13 below (16px from the art, a
 * deliberate, comfortable margin).
 */
export const WIDE_CLEARANCE_PX = { side: 5, below: 13 } as const;
/** The lowest paper row native content may reach where nothing stands in front: 14px above the foot. */
export const WIDE_PAPER_FLOOR_PX = 582;

/** One drawn piece of the native block (a line of text, a plate, a rule, the action), in points from its top-left. */
export interface BlockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How far the wide board grows for a block whose drawn pieces are `rects`:
 * just enough that every piece clears the foreground directly beneath it
 * (and the board's foot) by `WIDE_CLEARANCE_PX`. Growth moves the
 * foreground and the foot down 1:1 while the block stays, so a long last
 * line under the mascot's rays needs more than a short `Edit preferences`
 * above the empty middle of the board.
 */
export function wideGrowth(rects: readonly BlockRect[], scale: number): number {
  let need = 0;
  const columns = WIDE_FOREGROUND_TOP_PX.length;
  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    const x0 = WIDE_TEXT_PX.left + r.x / scale - WIDE_CLEARANCE_PX.side;
    const x1 = WIDE_TEXT_PX.left + (r.x + r.width) / scale + WIDE_CLEARANCE_PX.side;
    const bottom = WIDE_TEXT_PX.top + (r.y + r.height) / scale;
    let limit = WIDE_PAPER_FLOOR_PX;
    const first = Math.max(0, Math.floor(x0 / WIDE_FOREGROUND_COLUMN_PX));
    const last = Math.min(columns - 1, Math.floor(x1 / WIDE_FOREGROUND_COLUMN_PX));
    for (let c = first; c <= last; c += 1) {
      const top = WIDE_FOREGROUND_TOP_PX[c];
      if (top > 0) limit = Math.min(limit, top - WIDE_CLEARANCE_PX.below);
    }
    need = Math.max(need, bottom - limit);
  }
  return need * scale;
}

// ── Choosing the board ──────────────────────────────────────────────────────

/** One hidden measurement of the board's native block: its height, its broken words and (wide) its drawn pieces. */
export interface BlockMeasure {
  height: number;
  broken: number;
  rects?: readonly BlockRect[];
}

/**
 * The block measured three ways: on the compact board (plates beside the
 * words), and on the wide board with the plates beside and above the words.
 */
export interface BoardMeasurement {
  compact: BlockMeasure;
  wide: BlockMeasure;
  wideStacked: BlockMeasure;
}

export type BoardTemplate =
  { kind: 'compact'; growth: number } | { kind: 'wide'; growth: number; stacked: boolean };

/**
 * The board for this content: the compact board when its block fits the
 * compact column within the approved +80px growth with no word broken;
 * otherwise the wide board, plates beside the words unless that breaks more
 * words than putting them above, grown by what its drawn pieces need
 * (`wideGrowth`). Text is never shrunk, capped or truncated:
 * the wide board grows instead.
 */
export function boardTemplate(m: BoardMeasurement, scale: number): BoardTemplate {
  const need = m.compact.height - boardCapacity(scale);
  if (m.compact.broken === 0 && need <= boardGrowthMax(scale) + MEASURE_TOLERANCE) {
    return { kind: 'compact', growth: Math.max(0, need) };
  }
  const stacked = m.wideStacked.broken < m.wide.broken;
  const block = stacked ? m.wideStacked : m.wide;
  return { kind: 'wide', growth: wideGrowth(block.rects ?? [], scale), stacked };
}

/**
 * How many words of `text` broke across the lines iOS laid it out in: a line
 * that ends inside a word (no ordinary space or hyphen at the break; a split
 * inside the no-break `+N` glue counts). Lines are matched back into the
 * text, so a trailing space kept or dropped on a wrapped line does not
 * matter.
 */
export function brokenWordCount(text: string, lines: readonly string[]): number {
  let broken = 0;
  let at = 0;
  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i].replace(/[ \t\n]+$/, '');
    const start = text.indexOf(line, at);
    if (start < 0) return broken;
    const end = start + line.length;
    if (end >= text.length) return broken;
    if (!/[ \t\n]/.test(text[end]) && !/[ \t\n\-\u2010-\u2014]/.test(text[end - 1])) broken += 1;
    at = end;
  }
  return broken;
}

/**
 * How many copies of the wide board's extension plate cover `rows` of it
 * (the growth plus the feather beneath), in source pixels: the plate as
 * drawn, then mirrored copies, alternately, only past its own height.
 */
export function plateCopies(rows: number): number {
  return Math.max(1, Math.ceil(rows / WIDE_GROWTH.plateRows));
}

/**
 * A slice's image placement, as percentages of the slice's own box: the
 * whole image stretched so that its rows [top, bottom) fill the box exactly.
 */
export function sliceImagePlacement(
  slice: Slice,
  imageHeight: number,
): { top: `${number}%`; height: `${number}%` } {
  const rows = slice.bottom - slice.top;
  return {
    top: `${(-slice.top / rows) * 100}%`,
    height: `${(imageHeight / rows) * 100}%`,
  };
}

// ── Type and the board's rows (measured against the target at 393pt) ────────

/**
 * Ready's own text sizes and leading, in points, before the reader's text
 * scale. Measured on the target with the bundled Public Sans: the headline
 * `You’re all set.` is Bold 34pt; the board heading Bold 17pt;
 * `Your recall preview` Bold 25pt; `See my plan` 15.5pt on a 46pt pill.
 * The board's rows are larger than the target's (the 2026-10-01
 * refinement): labels SemiBold 14pt in title case, values Regular 15pt —
 * the largest value size the capped board holds at the default text size
 * on iPhone 17 (16pt measured 245pt of content against the 213pt the board
 * holds at its +80px cap). The shared type scale and Button are unchanged.
 */
export const READY_TYPE = {
  headline: { fontSize: 34, lineHeight: 40 },
  boardHeading: { fontSize: 17, lineHeight: 22 },
  label: { fontSize: 14, lineHeight: 17 },
  value: { fontSize: 15, lineHeight: 20 },
  edit: { fontSize: 13, lineHeight: 18 },
  previewHeading: { fontSize: 25, lineHeight: 30 },
  cta: { fontSize: 16, lineHeight: 22 },
} as const;

/** `See my plan`'s pill height, in points (the target's 46pt; never under 44). */
export const CTA_MIN_HEIGHT = 46;

/** The headline's base size and leading: the shared `heading-2` base at the accessibility sizes. */
export function headlineType(fontScale: number): { fontSize: number; lineHeight: number } {
  const token = typography['heading-2'];
  return atAccessibilitySize(fontScale)
    ? { fontSize: token.fontSize, lineHeight: token.lineHeight }
    : READY_TYPE.headline;
}

/** The icon plate every row leads with (the target's 80px plate at 393pt). */
export const ROW_WELL_SIZE = 34;
/** Between the plate and the label/value column. */
export const ROW_WELL_GAP = 11;
/** Above and below each dashed rule (4 before the 2026-10-01 refinement). */
export const RULE_GAP = 6;
/** Between the heading and the first row, and the last row and Edit preferences. */
export const BLOCK_GAP = 6;
/** The white wash over the soft blue that gives the plates the target's paler blue. */
export const WELL_WASH_OPACITY = 0.45;

/**
 * The widest any pictogram's drawing reaches, as a fraction of its canvas:
 * measured on the nine files, soy and fish are widest at 715/1024.
 */
export const PICTOGRAM_INK = 715 / 1024;
/** One allergen's pictogram box in the plate: about 19pt of drawing. */
export const PICTOGRAM_SINGLE = 27;
/** Each of two pictograms' boxes. */
export const PICTOGRAM_PAIR = 24;
/**
 * The second pictogram's box starts this far right of AND below the first's,
 * so the pair sits on the plate's diagonal and fills it exactly.
 */
export const PICTOGRAM_PAIR_STEP = 10;

export type AllergenArtwork =
  /** Nothing chosen: the neutral dash, never a specific pictogram. */
  | { kind: 'none' }
  /** One or two pictograms, in canonical order, and how many more there are. */
  | { kind: 'pictograms'; tokens: readonly string[]; more: number };

/**
 * What the Allergens plate shows for a selection: canonical
 * CONSUMER_ALLERGENS order whatever order they were chosen in, at most two
 * pictograms (the rest are named in the text), the dash for none. A token
 * outside the vocabulary has no pictogram and is not counted.
 */
export function allergenArtwork(selected: readonly string[]): AllergenArtwork {
  const chosen = new Set(selected);
  const tokens = CONSUMER_ALLERGENS.filter((option) => chosen.has(option.token)).map(
    (option) => option.token,
  );
  if (tokens.length === 0) return { kind: 'none' };
  return { kind: 'pictograms', tokens: tokens.slice(0, 2), more: Math.max(0, tokens.length - 2) };
}

/**
 * A board row's VISIBLE value: Profile's compact rule (lib/profile-hub
 * `compactList`: the first two names, then `+N`), or `none` for an empty
 * optional group. The board is narrow; the row still speaks every name.
 */
export function boardValue(names: readonly string[], none: string): string {
  if (names.length === 0) return none;
  // `+N` travels with the last name it summarises, never alone on a line.
  return compactList(names).visible.replace(/ (\+\d+)$/, '\u00A0$1');
}

/** A board row's one spoken name: the category and the complete selection. */
export function boardRowLabel(label: string, names: readonly string[], none: string): string {
  return `${label}: ${names.length === 0 ? none : listNames(names)}`;
}

// ── The physical deck (2026-10-01 refinement) ─────────────────────────────
//
// The preview is a physical stack of the REAL cards. The active card is on
// top; the next genuine cards are mounted directly beneath it in the same
// stack, each smaller than the one in front and pushed right, so at rest
// only a narrow clean white strip of each one's right edge shows — inside
// its own padding, so nothing of it (or of the locked card) leaks. A forward
// swipe carries the top card left, rigidly, and off the deck; the card
// beneath is uncovered where it already sits and comes forward into the
// active position by ONE uniform scale-and-move. Backward is the exact
// reverse: the previous card returns from the left over the stack, and the
// active card settles back into the first rear place.
//
// Every card's pose is a function of its DEPTH, `index - position`, where
// `position` is the deck's one continuous progress (the committed index
// while at rest; fractional during a drag or a settle): `deckPoseRanges`
// is the one table both the animation and the tests read.

/** How much more of each rear card shows on the right than the one in front. */
export const DECK_REAR_PEEK = 8;
/** The most cards visible behind the front one. */
export const DECK_REAR_LAYERS = 2;
/** Each rear card's uniform size relative to the front card, by depth (1, 2). */
export const DECK_REAR_SCALE = [0.94, 0.88] as const;
/** The card surface's own padding (RecallCardSurface): the rear strips must stay inside it. */
export const DECK_CARD_PADDING = 12;
/** Beyond the screen edge, so a departed card's shadow is gone too. */
export const DECK_EXIT_CLEARANCE = 24;

/** The front card's width: the deck's, less the strip the rear cards peek into. */
export function deckFrontWidth(deckWidth: number): number {
  return deckWidth - DECK_REAR_LAYERS * DECK_REAR_PEEK;
}

/**
 * How far the top card travels left to leave the deck: its own width, the
 * page margin to the screen edge and the shadow's clearance.
 */
export function deckExitDistance(frontWidth: number, pageMargin: number): number {
  return frontWidth + pageMargin + DECK_EXIT_CLEARANCE;
}

/** Where a rear card at `depth` (1 or 2) sits: scaled about its centre, its right edge peeking. */
function rearTranslateX(depth: 1 | 2, frontWidth: number): number {
  const scale = DECK_REAR_SCALE[depth - 1];
  return (frontWidth * (1 - scale)) / 2 + depth * DECK_REAR_PEEK;
}

export interface DeckPoseRanges {
  /** Depths: departed, front, first rear, second rear, hidden beneath. */
  inputRange: number[];
  translateX: number[];
  scale: number[];
  opacity: number[];
}

/**
 * The deck's one pose table, by depth (clamped at both ends):
 *
 * - `-1`: departed — moved left by the exit distance, UNSCALED (the
 *   outgoing card is a rigid rectangle the whole way).
 * - `0`: the front card, upright and full size.
 * - `1`, `2`: the rear cards, each uniformly smaller and peeking further.
 * - `3`: beneath the second, unseen; it fades in as it rises to `2`.
 */
export function deckPoseRanges(frontWidth: number, exit: number): DeckPoseRanges {
  const second = rearTranslateX(2, frontWidth);
  return {
    inputRange: [-1, 0, 1, 2, 3],
    translateX: [-exit, 0, rearTranslateX(1, frontWidth), second, second],
    scale: [1, 1, DECK_REAR_SCALE[0], DECK_REAR_SCALE[1], DECK_REAR_SCALE[1]],
    opacity: [1, 1, 1, 1, 0],
  };
}

export interface DeckPose {
  translateX: number;
  scale: number;
  opacity: number;
}

/** A card's pose at `depth`, read from the same table (piecewise linear, clamped). */
export function deckPose(depth: number, frontWidth: number, exit: number): DeckPose {
  const ranges = deckPoseRanges(frontWidth, exit);
  const at = (values: number[]) => {
    const input = ranges.inputRange;
    if (depth <= input[0]) return values[0];
    for (let i = 1; i < input.length; i += 1) {
      if (depth <= input[i]) {
        const t = (depth - input[i - 1]) / (input[i] - input[i - 1]);
        return values[i - 1] + t * (values[i] - values[i - 1]);
      }
    }
    return values[values.length - 1];
  };
  return {
    translateX: at(ranges.translateX),
    scale: at(ranges.scale),
    opacity: at(ranges.opacity),
  };
}

/** A drag commits past this fraction of the exit distance… */
export const DECK_COMMIT_FRACTION = 0.25;
/** …or with a flick at least this fast (points per millisecond), in the drag's direction. */
export const DECK_FLICK_VELOCITY = 0.3;
/** Past the first or last card the deck follows the finger at this fraction, then returns. */
export const DECK_EDGE_RESISTANCE = 0.25;

/**
 * The deck's position while a finger drags it `dx` points (negative is
 * forward, to the left) from `from`: one card per exit distance, resisting
 * past either end so the stack can never be pulled beyond its cards.
 */
export function deckDragPosition(from: number, count: number, dx: number, exit: number): number {
  const raw = from - dx / exit;
  const last = Math.max(count - 1, 0);
  if (raw < 0) return raw * DECK_EDGE_RESISTANCE;
  if (raw > last) return last + (raw - last) * DECK_EDGE_RESISTANCE;
  return raw;
}

/**
 * Where a released drag settles, from the committed `active` card and the
 * gesture alone: one card forward or back when it travelled far enough or
 * was flicked that way, otherwise back where it started (a cancelled swipe
 * restores the stack). Never past either end.
 */
export function deckReleaseTarget(
  active: number,
  count: number,
  dx: number,
  vx: number,
  exit: number,
): number {
  const travelled = -dx / exit;
  const forward = travelled > DECK_COMMIT_FRACTION || (travelled > 0 && vx < -DECK_FLICK_VELOCITY);
  const back = travelled < -DECK_COMMIT_FRACTION || (travelled < 0 && vx > DECK_FLICK_VELOCITY);
  const target = forward ? active + 1 : back ? active - 1 : active;
  return Math.min(Math.max(target, 0), Math.max(count - 1, 0));
}

/** The settle after a release or an accessibility move, in milliseconds. */
export const DECK_SETTLE_MS = 260;

/**
 * The pagination dots: one per navigable page — the readable cards and,
 * when it exists, the locked final page — and none for a single page (a
 * lone dot says nothing). The active dot is the committed card itself.
 */
export function deckDotCount(pageCount: number): number {
  return pageCount >= 2 ? pageCount : 0;
}

// ── The uniform preview card ────────────────────────────────────────────────
//
// Every deck card shares one outer size at a given width and text-size
// class, so a swipe never changes the deck's height. The card's CONTENT is
// grouped exactly as the Feed groups it — the brand directly beneath the
// product name, the category chip under the brand only when the shared
// launch rule shows one, then the reason — and no slot is padded. The deck
// raises every card to its tallest one (`cardMinHeight`), and that spare
// height goes BELOW the identity column, above the location, never between
// the title, brand and reason (the 2026-10-01 Moringa correction). The
// title, brand and reason are line-limited (the full text still reaches the
// accessibility element); from the accessibility text sizes the limits come
// off — an accessible responsive card, never capped type.

export const PREVIEW_TITLE_LINES = 2;
/** One brand line, so a long multi-brand line cannot make the whole deck taller. */
export const PREVIEW_BRAND_LINES = 1;
export const PREVIEW_REASON_LINES = 2;
/** From this text scale the uniform rules yield to unrestricted wrapping. */
export const PREVIEW_UNIFORM_UNTIL_SCALE = 1.5;

export function previewCardUniform(fontScale: number): boolean {
  return fontScale < PREVIEW_UNIFORM_UNTIL_SCALE;
}

/** A compact label chip's height: one `label` line, 4pt paddings, 1px borders. */
function chipHeight(fontScale: number): number {
  return Math.round(typography.label.lineHeight * fontScale) + 2 * 4 + 2;
}

/**
 * The deck's uniform rules at this text size — or null from the
 * accessibility sizes, where nothing is reserved or limited.
 */
export interface PreviewCardLayout {
  /**
   * The status row: one chip row reserved by rule; the deck raises it to
   * the tallest row any of ITS cards measured (a PHA label or a long date
   * can wrap), so every card's title starts on the same line without an
   * empty band on decks whose rows all fit on one line.
   */
  statusMinHeight: number;
  /** The deck's measurement hook for the status row; absent means none. */
  onStatusLayout?: (height: number) => void;
}

export function previewCardLayout(fontScale: number): PreviewCardLayout | null {
  if (!previewCardUniform(fontScale)) return null;
  return { statusMinHeight: chipHeight(fontScale) };
}

/**
 * Layout's floating-point noise: at some text sizes a box laid out at
 * exactly N points reports N + 0.00006.
 */
export const MEASURE_TOLERANCE = 0.01;

/**
 * A measured height in whole points, rounded up past layout's noise. A
 * reservation applied at this height measures back as the SAME whole
 * number, so raising a box to its own measurement can never creep upward
 * (a plain `Math.ceil` turned 285.00006 into 286, which measured 286.00006,
 * and so on — the 2026-10-01 XL deck grew to 1,023pt).
 */
export function wholePoints(height: number): number {
  return Math.ceil(height - MEASURE_TOLERANCE);
}

/**
 * The deck's shared status-row reservation: the rule's one chip row, or the
 * tallest row any card measured — monotonic, so a measurement taken WITH
 * the reservation applied can only confirm it, never oscillate.
 */
export function deckStatusHeight(rule: number, measured: readonly number[]): number {
  return Math.max(rule, ...measured.map(wholePoints));
}

/**
 * The deck's shared card height: the tallest card measured, in whole points
 * — monotonic, so a measurement taken with it applied only confirms it.
 */
export function deckCardHeight(measured: readonly number[]): number {
  return measured.length === 0 ? 0 : Math.max(...measured.map(wholePoints));
}
