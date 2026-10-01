/**
 * The Stores step's presentation rules (the receipt Stores, 2026-09-30): how
 * the approved composition's three layers are placed, how the receipt grows
 * to hold real 44pt rows, and how its native text is sized. Numbers and pure
 * functions only, so all of it is testable under Node; the component maps
 * them onto React Native. A leaf.
 *
 * ## Three layers, one scale
 *
 * The founder-approved composition
 * (assets/brand/reference/lotly-onboarding-stores-receipt-target.png, 934px
 * wide, no system chrome) was decomposed into a scene, a blank receipt paper
 * and a small foreground overlap (the glove and two lime rays, with the
 * shadows they cast on the paper). All three are cut at the target's own
 * pixels and scale by ONE factor, `width / 934`: the scene spans the page,
 * and the mascot and food are never stretched. The offsets below are the
 * asset report's
 * (assets/brand/reference/stores-receipt/lotly-stores-receipt-asset-report.json)
 * and `stores-receipt-assets.test.ts` pins them to it. Positions are in
 * those reference pixels unless they say points.
 *
 * ## The receipt grows upward, and only upward
 *
 * The receipt flares wider toward its foot, and the scene is transparent
 * exactly where the receipt covers it (nothing hidden behind it was
 * invented). So the paper's BOTTOM stays where the scene expects it — the
 * teeth, the table shadows and the glove's grip never move — and any extra
 * height is taken by stretching one slice of quiet paper (`PAPER_SLICE_PX`)
 * vertically, which lifts everything above it. A paper never draws shorter
 * than its exported height, so the scene's hole is always covered. The
 * founder approved the top rising above the blue backdrop onto the page.
 *
 * How much it grows is not a constant: the receipt's native content lays out
 * at its real size (44pt rows, the reader's text size) and the paper takes
 * whatever height that needs. The illustration reserves that height in the
 * page's flow — the scene moves down rather than the receipt rising into the
 * headline — so the receipt can never overlap the text above it.
 *
 * ## The native text
 *
 * Measured against the target at 393pt with the bundled Public Sans: the
 * headline `Your regulars.` is Public Sans Bold 44pt (292pt of ink; 293.7pt
 * of advance). The body is 18pt at a 23pt pitch, in the States measure
 * (290pt): wider than `Choose the stores where your` (247.7pt) and narrower
 * than the same line with `household` (338.6pt), so it breaks where the
 * target does. `Continue` is the onboarding's 51pt pill with an 18pt label.
 *
 * The target's receipt type is small (names 13pt, the count and `Clear`
 * 11pt, `Search all stores` 12pt, the heading 21pt) because its rows are
 * only 38pt apart. The native rows are 44pt, so the receipt type is set for
 * reading at that pitch: names 16pt, the count and `Clear` 14pt, the search
 * action 16pt, the heading 22pt. The target's rows are too close together
 * for 44pt touch targets, which is exactly why the paper grows.
 *
 * ## At the accessibility text sizes, stacked
 *
 * From text scale 1.5 (the app's shared threshold: iOS's accessibility
 * sizes) the receipt's narrow column cannot hold a name word, so the step
 * stacks: the illustration is drawn whole at the width (all three layers,
 * the receipt blank and unstretched, because the scene cannot render
 * alone), and the interactive receipt follows it as the paper alone at the
 * page's width, with the wider insets `STACKED_INSET_PX`. The headline and
 * the receipt heading take smaller bases there, still multiplied by the
 * reader's setting: adaptive bases, never caps.
 */

import { hitTarget, iconSize, layout, spacing, typography } from '@/constants/design-tokens';

/** The approved target's width, in pixels: every layer is cut from it at 1:1. */
export const REFERENCE_WIDTH = 934;

/** The scene, lotly-stores-receipt-scene.png: target rows 407–1438, full width. */
export const SCENE_PX = { width: 934, height: 1032 } as const;

/**
 * The paper, lotly-stores-receipt-paper.png, and where it sits in the scene:
 * `left` from the scene's left edge, `bottomGap` from its bottom edge to the
 * scene's (the anchor), `top` from the scene's top at its exported height.
 */
export const PAPER_PX = { width: 579, height: 863, left: 266, top: 67, bottomGap: 102 } as const;

/**
 * The overlap, lotly-stores-receipt-overlap.png, placed against the PAPER'S
 * bottom-left corner (the paper's bottom never moves, so this is also fixed
 * against the scene): `left` from the paper's left, `bottom` from its bottom.
 */
export const OVERLAP_PX = { width: 113, height: 483, left: 28, bottom: 302 } as const;

/**
 * The paper's one stretchable slice, rows [top, bottom) of the paper image:
 * below the tear and its crease, above the glove. Rows above it are drawn
 * 1:1 (the torn top), rows below it 1:1 (the flared foot and teeth).
 */
export const PAPER_SLICE_PX = { top: 32, bottom: 356 } as const;

/**
 * The stacked receipt's slice: the whole quiet body between the torn top and
 * the teeth. That receipt stands alone on the page (no scene behind it to
 * keep covered, no glove on it), so it can spread its growth over the whole
 * body instead of one slice: at the largest text size that keeps the paper's
 * texture within about 2.5× of its own grain, where one slice would pull it
 * more than 6× and streak it.
 */
export const STACKED_SLICE_PX = { top: 32, bottom: 830 } as const;

export type PaperSlice = { readonly top: number; readonly bottom: number };

/**
 * Where the receipt's native content sits inside the paper, in paper pixels:
 * the target's column (its dotted rules run x 358–777) and its first line
 * and last row. `bottom` leaves the 44pt search row just clear of the teeth.
 */
export const CONTENT_INSET_PX = { left: 92, right: 68, top: 70, bottom: 16 } as const;

/**
 * The same, for the stacked layout's wider receipt: a wider column within
 * the paper's own edges (its left edge flares from x 39 to 0, its right from
 * 550 to 579), so a name word still fits at the largest text size.
 */
export const STACKED_INSET_PX = { left: 64, right: 48, top: 70, bottom: 16 } as const;

/** The Stores step's own text sizes and leading, in points (see "The native text"). */
export const STORES_TYPE = {
  headline: { fontSize: 44, lineHeight: 50 },
  body: { fontSize: 18, lineHeight: 23 },
  heading: { fontSize: 22, lineHeight: 27 },
  count: { fontSize: 14, lineHeight: 19 },
  name: { fontSize: 16, lineHeight: 21 },
  search: { fontSize: 16, lineHeight: 21 },
  /** The shared Button's `body-small-bold` face and 1.4 ratio, at 18pt. */
  cta: { fontSize: 18, lineHeight: 25 },
} as const;

/** `Continue`'s minimum height, in points: the onboarding's 51pt pill. */
export const CTA_MIN_HEIGHT = 51;

/** The body's measure at the default text size, in points (see "The native text"). */
export const BODY_MEASURE = 290;

/** Every row on the receipt, and the search action, is at least this tall: never less. */
export const ROW_MIN_HEIGHT = hitTarget.minimum;

/** The drawn checkbox (the shared CheckIndicator) and the gap before it. */
export const ROW_CHROME = { check: iconSize[20], gap: spacing[12], padding: 2 } as const;

/**
 * The gap between the count row and the first rule. `Clear` is one 19pt
 * line whose target reaches 44pt by hitSlop, 13pt above and below; this gap
 * is larger, so that target never overlaps the first store's.
 */
export const COUNT_GAP = 14;

/** A dotted rule's height, in points. */
export const RULE_HEIGHT = 1;

/** The page's vertical gaps, in points: above the heading, inside it, and above the illustration. */
export const GAPS = { top: spacing[8], heading: spacing[8], scene: spacing[8] } as const;

/**
 * The least room between the body and the receipt's torn top once the
 * receipt has risen above the scene: the illustration's top padding, on top
 * of its `GAPS.scene` margin.
 */
export const PAPER_CLEARANCE = spacing[8];

/** From this text scale the step switches to its accessibility layout (see above). */
export const ACCESSIBILITY_SCALE = 1.5;

export function atAccessibilitySize(fontScale: number): boolean {
  return fontScale >= ACCESSIBILITY_SCALE;
}

/** The receipt beside the mascot, or the illustration above a full-width receipt. */
export type ReceiptLayout = 'scene' | 'stacked';

export function receiptLayout(fontScale: number): ReceiptLayout {
  return atAccessibilitySize(fontScale) ? 'stacked' : 'scene';
}

/** The headline's base size and leading, before the reader's text scale. */
export function headlineType(fontScale: number): { fontSize: number; lineHeight: number } {
  const token = typography['heading-2'];
  return atAccessibilitySize(fontScale)
    ? { fontSize: token.fontSize, lineHeight: token.lineHeight }
    : STORES_TYPE.headline;
}

/** The receipt heading's base size and leading, before the reader's text scale. */
export function receiptHeadingType(fontScale: number): { fontSize: number; lineHeight: number } {
  const token = typography['heading-3'];
  return atAccessibilitySize(fontScale)
    ? { fontSize: token.fontSize, lineHeight: token.lineHeight }
    : STORES_TYPE.heading;
}

/** The body's measure, in points, at the reader's text scale. */
export function bodyMeasure(fontScale: number): number {
  return BODY_MEASURE * fontScale;
}

/** The illustration's width, in points, for a window `windowWidth` wide: the page, capped. */
export function illustrationWidth(windowWidth: number): number {
  return Math.min(windowWidth, layout.maxContentWidth);
}

/** Points per reference pixel when a layer spans `widthPt` of the page. */
export function sceneScale(widthPt: number): number {
  return widthPt / REFERENCE_WIDTH;
}

/**
 * The stacked receipt's scale: the paper drawn at the page's content width
 * (the window, capped, less the page margins).
 */
export function stackedPaperScale(windowWidth: number): number {
  return (illustrationWidth(windowWidth) - layout.pageMargin * 2) / PAPER_PX.width;
}

/** The receipt's content column, in points, for a paper drawn at `scale`. */
export function receiptColumn(scale: number, inset: { left: number; right: number }): number {
  return (PAPER_PX.width - inset.left - inset.right) * scale;
}

/**
 * The middle slice's image placement, as percentages of the slice's own box:
 * the whole paper image stretched so that its rows [top, bottom) fill the
 * box exactly. Declarative, so the first frame is already right at any
 * height (no measuring pass, no flicker).
 */
export function sliceImagePlacement(slice: PaperSlice = PAPER_SLICE_PX): {
  top: `${number}%`;
  height: `${number}%`;
} {
  const rows = slice.bottom - slice.top;
  return {
    top: `${(-slice.top / rows) * 100}%`,
    height: `${(PAPER_PX.height / rows) * 100}%`,
  };
}

/**
 * How far the receipt grows above its exported height, in points, when its
 * native content needs `contentHeightPt` at `scale` (for tests and review:
 * the layout itself lets flexbox do this).
 */
export function paperGrowth(contentHeightPt: number, scale: number): number {
  const inset = (CONTENT_INSET_PX.top + CONTENT_INSET_PX.bottom) * scale;
  return Math.max(0, contentHeightPt + inset - PAPER_PX.height * scale);
}

/**
 * The receipt content's height at a text scale, in points, when every line
 * is one line: the heading, the count row, seven rules, six store rows and
 * the search action, each row at least 44pt.
 */
export function receiptContentHeight(fontScale: number): number {
  const line = (type: { lineHeight: number }) => type.lineHeight * fontScale;
  const row = (type: { lineHeight: number }) => Math.max(ROW_MIN_HEIGHT, line(type));
  return (
    line(receiptHeadingType(fontScale)) +
    spacing[4] +
    line(STORES_TYPE.count) +
    COUNT_GAP +
    7 * RULE_HEIGHT +
    6 * row(STORES_TYPE.name) +
    row(STORES_TYPE.search)
  );
}
