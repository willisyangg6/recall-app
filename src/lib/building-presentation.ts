/**
 * The Building step's approved composition (2026-10-02): every number the
 * screen draws, measured on the founder-approved five-stop reference and
 * recorded in
 * assets/brand/reference/building-grocery-search/lotly-building-grocery-search-asset-report.json.
 * A leaf: no React, no I/O, so the whole layout is provable under Node.
 *
 * ## One scale
 *
 * The reference is 934 px wide (app content, no OS chrome). Everything is
 * drawn at one uniform scale, `ptPerPx(width)` = page width / 934: the hero,
 * its three bag-tag glyphs, the rail, and the vertical rhythm. Groceries and
 * the mascot are never stretched.
 *
 * ## What is native
 *
 * The hero (lotly-building-grocery-search-scene.png) is decorative art with
 * the three printed tag glyphs removed; the glyphs are drawn back on top
 * natively (`TAG_GLYPHS`, fitted to the printed ink with the set's own
 * rasterisation). The headline, the five-stop rail, its connectors, the
 * active rays, the completed badge and the caption are native too.
 *
 * ## Colours
 *
 * The stop circles alternate blue, lime, blue, lime, blue as DECORATION: the
 * colour never means active or done. Lime is the shared `background/accent`.
 * The blue is the mockup's own lighter circle blue, kept local to this
 * screen (founder decision, 2026-10-02) so the shared `background/subtle`
 * token stays what every other screen draws.
 *
 * ## Glyph sources
 *
 * The rail and the tags draw the same five rasters from
 * assets/onboarding/building/, rendered by scripts/render-onboarding-assets.mjs
 * at the set's 2.4-unit stroke on a 40pt box: Lucide `map-pin`,
 * `octagon-alert`, `shopping-cart` and `file-search-corner` (lucide-icons/lucide
 * f06ac67e33d645c40b8ce19a0419c85c5d7dd751, vendored under
 * assets/icon-sources/lucide/), and `stacked-cards`, the one Lotly-authored
 * source (assets/icon-sources/lotly/), drawn on the Lucide grid to match the
 * mockup's Feed stop.
 */

import { typography } from '@/constants/design-tokens';
import type { BuildingStopId } from '@/lib/building-watch';

/** The approved reference's width, in pixels. */
export const REFERENCE_WIDTH = 934;

/** Points per reference pixel for a page `width` points wide. */
export function ptPerPx(width: number): number {
  return width / REFERENCE_WIDTH;
}

/**
 * The production hero: reference rows 100–1072 (end-exclusive), full width.
 * The 100 rows above it are page cream, drawn as the hero's top offset.
 */
export const HERO_PX = { top: 100, width: 934, height: 972 } as const;

/**
 * The Lucide sources this step vendored (lucide-icons/lucide
 * f06ac67e33d645c40b8ce19a0419c85c5d7dd751, retrieved 2026-10-02, byte-identical
 * to the commit). The step also draws `shopping-cart` (vendored for Ready) and
 * `file-search-corner` (vendored for the paywall), and the Lotly-authored
 * `stacked-cards` from assets/icon-sources/lotly/.
 */
export const BUILDING_ICON_SOURCES = [
  { icon: 'building-area', lucideName: 'map-pin' },
  { icon: 'building-allergens', lucideName: 'octagon-alert' },
] as const;
export const BUILDING_ICONS_VENDORED_ON = '2026-10-02';

/** Every raster the step draws, by stop. */
export const STOP_GLYPHS: Record<BuildingStopId, string> = {
  area: 'building-area',
  allergens: 'building-allergens',
  stores: 'building-stores',
  matches: 'building-matches',
  feed: 'building-feed',
};

/**
 * The three bag-tag glyphs, in HERO pixels (the reference minus 100 rows):
 * a box of `box` px (the 24-unit grid's box, not the ink bounds) centred at
 * `centre`, turned `rotate` degrees clockwise about its own centre. Fitted
 * to the printed ink at the set's 2.4 stroke (asset report,
 * tagOverlayCalibration).
 */
export const TAG_GLYPHS: readonly {
  stop: 'area' | 'allergens' | 'stores';
  centre: readonly [number, number];
  box: number;
  rotate: number;
}[] = [
  { stop: 'area', centre: [507.05, 476.8], box: 75.86, rotate: 14.34 },
  { stop: 'allergens', centre: [625.99, 520.51], box: 92.53, rotate: 10.25 },
  { stop: 'stores', centre: [774.59, 495.59], box: 72.42, rotate: -10.52 },
];

/** A tag glyph's one emphasis when its stop becomes active (peak scale). */
export const TAG_EMPHASIS_SCALE = 1.1;

/**
 * The rail, in reference pixels: five equal circles at an even pitch,
 * centred on the page (measured centres 122, 294.5, 468.5, 640, 812.5).
 */
export const RAIL_PX = {
  diameter: 118,
  pitch: 172.6,
  /** Short thin rounded bars centred between neighbouring circles. */
  connector: { length: 34, thickness: 5 },
  /** The rail block starts at the top of the active rays. */
  raysAboveCircle: 37,
} as const;

/**
 * Each stop's glyph box, in reference pixels, centred in its circle: the
 * approved mockup draws the five at their own optical sizes (fitted boxes:
 * pin 64.5, octagon 79.2, cart 65.1, document 72.9, stacked cards 78.4).
 */
export const STOP_GLYPH_PX: Record<BuildingStopId, number> = {
  area: 64.5,
  allergens: 79,
  stores: 65,
  matches: 73,
  feed: 78.5,
};

/**
 * The two attention rays above the ACTIVE stop, relative to its circle's
 * centre (reference px): each a round-capped bar of `length` × `thickness`
 * centred at `offset`, its long axis at `angle` degrees (screen coordinates,
 * y down). Measured on the reference's Allergens stop.
 */
export const RAYS_PX: readonly {
  offset: readonly [number, number];
  angle: number;
  length: number;
  thickness: number;
}[] = [
  { offset: [18.6, -83.2], angle: -76.5, length: 29.9, thickness: 11.9 },
  { offset: [46.0, -70.9], angle: -41.6, length: 26.6, thickness: 10.6 },
];

/**
 * The completed badge: a navy disc with a white check over the stop's lower
 * right, its centre `offset` from the circle's centre (reference px).
 */
export const BADGE_PX = { offset: [33, 38.4] as const, diameter: 43 } as const;

/** Building-only colours (measured on the approved mockup). */
export const BUILDING_COLOURS = {
  /** The blue stop circles: the mockup's lighter blue, not `background/subtle`. */
  stopBlue: '#D4EBFE',
  /** The connectors between stops (mockup ~ (193,226,253)). */
  connector: '#C1E2FD',
} as const;

/** Which circles are blue and which lime: fixed decoration, never state. */
export const STOP_FILLS: readonly ('blue' | 'lime')[] = ['blue', 'lime', 'blue', 'lime', 'blue'];

/** The screen's own type: Public Sans 700 (`display`'s face), in points. */
export const BUILDING_TYPE = {
  headline: { fontSize: 36, lineHeight: 36 },
  caption: { fontSize: 18, lineHeight: 23 },
} as const;

/** From this text scale (iOS's accessibility sizes, the app's shared threshold). */
export const ACCESSIBILITY_SCALE = 1.5;

/**
 * The headline's and caption's base sizes before the reader's text scale. At
 * the accessibility sizes the bases step down — adaptive bases, never caps,
 * as Stores' — so no word ever breaks across lines. React Native's AX5 scale
 * is 3.571× (AX4 3.143×). Measured with Public Sans 700 on an SE's 343pt
 * page at AX5: `Getting` at 36pt would be 477pt and broke mid-word; at
 * `heading-2`'s 23pt it is 305pt.
 */
export function headlineType(fontScale: number): { fontSize: number; lineHeight: number } {
  if (fontScale < ACCESSIBILITY_SCALE) return BUILDING_TYPE.headline;
  const token = typography['heading-2'];
  return { fontSize: token.fontSize, lineHeight: token.lineHeight };
}

/**
 * The widest word any caption can show, `personalized`, in ems of Public
 * Sans 700 (CoreText advances; the next is `allergens…` at 5.361em).
 */
export const WIDEST_CAPTION_WORD_EM = 6.118;

/**
 * The caption's type for a text scale and the caption's column width (pt).
 * At the accessibility sizes: `body`'s 16pt while the widest word fits the
 * column with 5% to spare, else `body-small`'s 13pt — at AX5 `personalized`
 * at 16pt is 350pt, wider than an SE's 343pt column (it broke as
 * `personalize|d`), and 284pt at 13pt; an iPhone 17's 370pt column keeps 16pt.
 */
export function captionType(
  fontScale: number,
  column: number,
): { fontSize: number; lineHeight: number } {
  if (fontScale < ACCESSIBILITY_SCALE) return BUILDING_TYPE.caption;
  const fits = (size: number) => WIDEST_CAPTION_WORD_EM * size * fontScale <= column * 0.95;
  const fontSize = fits(typography.body.fontSize)
    ? typography.body.fontSize
    : typography['body-small'].fontSize;
  // A screen-local 1.25 leading: at AX5 on an SE the five-line error message
  // then fits above the Try again / Continue footer (`body`'s 1.5 did not).
  return { fontSize, lineHeight: Math.round(fontSize * CAPTION_LEADING_AT_ACCESSIBILITY) };
}

/** The caption's leading at the accessibility sizes, as a multiple of its size. */
export const CAPTION_LEADING_AT_ACCESSIBILITY = 1.25;

/**
 * The headline column at the default text size, in points: wider than
 * `watch ready.` (216.8pt measured from the font's advances) and narrower
 * than `Getting your watch` (325.4pt), so it breaks where the mockup does,
 * with room for iOS's slightly wider layout. Scales with the text size.
 */
export const HEADLINE_MEASURE = 270;

/** Public Sans' vertical metrics (hhea, 2000 units per em). */
const ASCENT = 0.95;
const DESCENT = 0.225;

/**
 * A baseline's distance below the top of a `lineHeight` line box. Measured
 * on the Simulator (2026-10-02): a line box SHORTER than the font's natural
 * 1.175em keeps the descent and gives up ascent, so the baseline sits one
 * descent above the box's bottom (the 36/36 headline: 27.9pt, not the
 * centred 31.05 that put it 3pt high); a taller one centres the run.
 */
export function baselineInLine(fontSize: number, lineHeight: number): number {
  const natural = fontSize * (ASCENT + DESCENT);
  if (lineHeight < natural) return lineHeight - fontSize * DESCENT;
  return (lineHeight - natural) / 2 + fontSize * ASCENT;
}

/**
 * The vertical rhythm, in reference pixels, measured on the reference:
 * hero bottom (1072) → headline first baseline (1148); headline last
 * baseline (1233) → rays top (1270); circle bottom (1426) → caption
 * baseline (1511).
 */
export const RHYTHM_PX = {
  heroToHeadlineBaseline: 76,
  headlineBaselineToRail: 37,
  circleBottomToCaptionBaseline: 85,
} as const;

/** One stop's centre x (points) on a page `width` points wide. */
export function stopCentreX(width: number, index: number): number {
  return width / 2 + (index - 2) * RAIL_PX.pitch * ptPerPx(width);
}

/**
 * The top offset above the hero, in points. On a short screen (an iPhone SE
 * at the default size) the page cream above the art is the nonessential gap
 * that gives way first, never the art itself.
 */
export function heroTopGap(width: number, viewportHeight: number): number {
  const full = HERO_PX.top * ptPerPx(width);
  return viewportHeight < COMPACT_BELOW_HEIGHT ? Math.round(full * COMPACT_TOP_FACTOR) : full;
}

/** Below this content height (points) the top gap compresses. */
export const COMPACT_BELOW_HEIGHT = 700;
/** How much of the top gap a compact screen keeps. */
export const COMPACT_TOP_FACTOR = 0.35;
