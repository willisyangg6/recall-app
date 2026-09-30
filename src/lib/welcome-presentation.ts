/**
 * Welcome's presentation rules (the receipt Welcome, 2026-09-29): how the
 * approved composition's two images and its native text are sized and
 * placed. Numbers only, so all of it is testable under Node; the component
 * maps them onto React Native. A leaf.
 *
 * ## Measured from the approved target
 *
 * The founder-approved full-screen composition
 * (assets/brand/reference/lotly-onboarding-welcome-receipt-target.png,
 * 852×1846) is an iPhone 17 screen at 852/393 px per point, with no system
 * chrome. Both production images are crops of it at its own pixels, so both
 * scale by `width / 852`: at 393pt the wordmark is 182×92pt and the hero
 * 393×424pt, exactly as the target draws them. Every position below is in
 * those reference pixels unless it says points.
 *
 * ## The native text
 *
 * The founder approved Welcome-only sizes matching the target (fidelity
 * pass, 2026-09-29): the headline in Public Sans Bold 36pt and the body in
 * Public Sans Regular 18pt, at the target's own leading (its headline
 * baselines are 79px = 36.4pt apart, its body's 49px = 22.6pt), and
 * `Get started` at least 51pt tall with an 18pt label. They are Welcome's
 * alone: the shared type scale and Button are unchanged.
 *
 * The target sets the headline and body in a column narrower than the page:
 * its headline breaks after `at` and its body after `just`. At 36/18pt one
 * measure reproduces both breaks: wider than `A closer look at` (263.6pt by
 * the font's advances) and narrower than `Food recalls personalized just
 * for` (277.3pt). The measure grows with the reader's text size, so the
 * same words share a line at every size until the column reaches the page
 * width; from there the text simply wraps. It is a width, never a line
 * break, and never caps the type. At accessibility sizes the column also
 * gives up the composition's wider inset for the page margin, because there
 * the inset only splits words that the page width would hold.
 *
 * ## The example caption
 *
 * `Illustrative example, not a live recall.` is printed, in the target, in
 * the quiet counter below the receipt, centred on row 823.5 of the hero. The
 * production hero had that caption removed from its pixels, so the app draws
 * it as native text at that row, over the approved fade (never a fade drawn
 * in code). The quiet band is the counter the caption may occupy: below the
 * receipt's lowest tip (row 784), inside the fade (which ends at row 919),
 * and clear of the apple, which ends by column 120 in those rows (170 at its
 * widest, higher up); only the apple's soft cast shadow, to column ~203,
 * reaches into the band's left edge. The caption overlays the art only while
 * one line of it fits that band; at a larger text size, or on a narrower
 * screen, it moves into the flow directly below the hero and the page
 * scrolls. Its placement is decided from the width and text scale alone, so
 * the first frame is the final one.
 */

/** The approved target's width, in pixels: both images are crops of it at 1:1. */
export const REFERENCE_WIDTH = 852;

/** The production wordmark, lotly-wordmark-welcome-receipt.png (target x232 y113). */
export const WORDMARK_PX = { width: 395, height: 200 } as const;

/** The production hero, lotly-welcome-receipt-scene.png (target x0 y664, full width). */
export const HERO_PX = { width: 852, height: 920 } as const;

/** The example caption's centre row in the target, measured inside the hero. */
export const CAPTION_CENTRE_PX = 823.5;

/**
 * The counter the caption may cover, in hero pixels. Symmetric about the
 * centre (the caption is centred), so the apple-side limit sets both sides:
 * 60px clear of the apple in these rows.
 */
export const QUIET_BAND_PX = { left: 180, right: 672, top: 790, bottom: 900 } as const;

/** Welcome's own text sizes and leading, in points (see "The native text"). */
export const WELCOME_TYPE = {
  headline: { fontSize: 36, lineHeight: 36 },
  body: { fontSize: 18, lineHeight: 23 },
  /** The shared Button's `body-small-bold` face and 1.4 ratio, at 18pt. */
  cta: { fontSize: 18, lineHeight: 25 },
} as const;

/** `Get started`'s minimum height, in points: the target's pill (51.2pt). */
export const CTA_MIN_HEIGHT = 51;

/**
 * The headline and body column at the default text size, in points (see
 * "The native text"), inside the 263.6–277.3pt window both reference breaks
 * share. iOS lays these glyphs out slightly wider than the font's advances
 * (a 244pt column broke a 241.7pt line at the old sizes), so the measure
 * sits well clear of both edges.
 */
export const TEXT_MEASURE = 270;

/**
 * From this text scale (the accessibility sizes, as elsewhere in onboarding)
 * the headline and body take the page margin instead of Welcome's wider
 * composition inset.
 */
export const TEXT_FULL_WIDTH_AT_SCALE = 1.5;

/**
 * One line of the caption in `caption` type (Public Sans Medium 12pt) at the
 * default text size: 203.8pt, measured from the font's own advances. Tied to
 * WELCOME_EXAMPLE_CAPTION; re-measure it if that sentence changes.
 */
export const CAPTION_LINE_WIDTH = 204;

/** `caption`'s line height at the default text size, in points. */
export const CAPTION_LINE_HEIGHT = 16;

/** Points per reference pixel for a page `width` points wide. */
export function artScale(width: number): number {
  return width / REFERENCE_WIDTH;
}

/** The hero's height, in points, for a page `width` points wide (it spans the width). */
export function heroHeight(width: number): number {
  return HERO_PX.height * artScale(width);
}

/** The headline and body column, in points, at the reader's text scale. */
export function textMeasure(fontScale: number): number {
  return TEXT_MEASURE * fontScale;
}

/** Whether the headline and body use the page margin rather than Welcome's inset. */
export function textFullWidth(fontScale: number): boolean {
  return fontScale >= TEXT_FULL_WIDTH_AT_SCALE;
}

/** Half the band's height: as far as the quiet counter reaches on the nearer side. */
const BAND_HALF_PX = Math.min(
  CAPTION_CENTRE_PX - QUIET_BAND_PX.top,
  QUIET_BAND_PX.bottom - CAPTION_CENTRE_PX,
);

/**
 * The band the overlaid caption is centred in, as percentages of the hero's
 * height (so it scales with the image at any width): centred on the target's
 * caption row, as tall as the quiet counter allows around it.
 */
export function captionBand(): { top: number; height: number } {
  return {
    top: ((CAPTION_CENTRE_PX - BAND_HALF_PX) / HERO_PX.height) * 100,
    height: ((BAND_HALF_PX * 2) / HERO_PX.height) * 100,
  };
}

/**
 * Where the caption goes: over the art while one line of it fits the quiet
 * band, otherwise in the flow below the hero.
 */
export function captionPlacement(width: number, fontScale: number): 'overlay' | 'below' {
  const scale = artScale(width);
  const fitsAcross =
    CAPTION_LINE_WIDTH * fontScale <= (QUIET_BAND_PX.right - QUIET_BAND_PX.left) * scale;
  const fitsDown = CAPTION_LINE_HEIGHT * fontScale <= BAND_HALF_PX * 2 * scale;
  return fitsAcross && fitsDown ? 'overlay' : 'below';
}
