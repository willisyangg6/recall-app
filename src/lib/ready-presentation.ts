/**
 * The Ready step's presentation rules (the approved Option 2 composition,
 * 2026-09-26): how the trust-peek mascot is sized and seated on the summary
 * card, what artwork each summary row carries, and what each row says to
 * VoiceOver. Numbers and tokens only, so all of it is testable under Node;
 * `components/onboarding/preview-step.tsx` maps them onto React Native. A
 * leaf.
 *
 * ## The trust-peek mascot on the summary card
 *
 * The artwork (assets/brand/production/lotly-mascot-ready-trust-peek-1024.png)
 * is the Lotly circular arrow cut flat along the bottom, with its left paw
 * hanging just below that cut and its right paw holding a shield that hangs
 * well below it, drawn to hang over a ledge. Measured on its 1024 canvas: the
 * flat cut's last solid row is y = 703 (so the seat is 704), the left paw
 * ends at y = 742, the shield at y = 972 and starts at x = 580, and the
 * drawing spans x = 108–968 from y = 129. The screen seats the cut on the
 * summary card's top border, so the arrow body reads as standing behind the
 * card, the left paw rests over its edge, and the shield and right paw hang
 * in front of it. No legs are drawn, so nothing else reaches the card.
 *
 * The mascot sits at the card's trailing edge, the drawing's right side on
 * the card's inner padding, so the shield hangs above the rows' completion
 * checks and never over a value. The card's heading keeps clear of the
 * shield (`shieldReach`), and the first row starts below it
 * (`summaryHeaderMinHeight`). The block reserves the drawing's full height
 * above the card (`readyMascotLift`), so the arrow never reaches the body
 * paragraph above it.
 *
 * ## Size
 *
 * 0.195 of the window's height on the 4pt grid, between 140pt (the
 * iPhone SE) and 180pt; from the accessibility text sizes (text scale 1.5,
 * the app's shared threshold) always the smallest, 140pt, so the heading and
 * rows keep the width. (The 2026-09-26 polish pass raised the bounds from
 * 120–152pt: about 17–19% more visible drawing, which is 0.84 of the box's
 * width and 0.82 of its height.) It is never hidden and never replaced. From the same
 * threshold the card stacks (`summaryStacked`): the heading drops below the
 * shield and each row's text takes the full width under its artwork.
 *
 * ## The row artwork
 *
 * Every row leads with the same 40pt white rounded-square well (the founder's
 * 2026-09-26 decision). States and Stores carry navy Lucide glyphs in it
 * (`map-pin`, `shopping-cart`); Allergens carries the approved allergen
 * pictograms themselves, UNTINTED: tinted navy, tree nuts and egg lose their
 * interiors and stop reading (the founder reviewed the evidence and kept
 * full colour, which lib/allergen-assets.ts already requires). What the
 * Allergens well shows is `allergenArtwork`: nothing chosen, a neutral navy
 * dash (the project has no generic allergen glyph, and a specific pictogram
 * would claim a choice that was not made); one, its pictogram at 32pt;
 * two, both at 28pt on a diagonal; three or more, the first two in canonical
 * order and a `+N` for the rest. Canonical order is CONSUMER_ALLERGENS's,
 * never tap order. The artwork is decoration: each row speaks its complete
 * selection (`summaryRowLabel`).
 *
 * ## Glyph provenance
 *
 * `shopping-cart` is Lucide's `shopping-cart` (ISC), byte-identical to the
 * file at the allergen set's pinned commit (lib/allergen-icons.ts,
 * `f06ac67e…`, release 1.47.0), vendored in assets/icon-sources/lucide/ on
 * 2026-09-26 and rasterised by scripts/render-onboarding-assets.mjs on the
 * set's box and stroke. Unlike the older Lucide rasters it is rendered
 * natively at each scale (the script's `native`), so its 2x and 3x files are
 * as crisp as the Figma-exported `map-pin` beside it; allergen-icons.test.ts
 * pins the source and the three files by hash.
 */

import { CONSUMER_ALLERGENS } from '@/domain/preferences';
import { listNames } from '@/lib/personalization-screen';

// ── The glyph this step adds to the icon set ────────────────────────────────

/** The Stores row's glyph, and its vendored Lucide source (see the header). */
export const READY_ICON_SOURCES = [{ icon: 'shopping-cart', lucideName: 'shopping-cart' }] as const;
export const READY_ICONS_VENDORED_ON = '2026-09-26';

// ── The mascot's seat ───────────────────────────────────────────────────────

/** The flat cut the body sits on, as a fraction of the canvas height. */
export const TRUST_PEEK_EDGE = 704 / 1024;
/** Where the drawing starts, as a fraction of the canvas height. */
export const TRUST_PEEK_ART_TOP = 129 / 1024;
/** Where the left paw ends, below the cut. */
export const TRUST_PEEK_PAW_BOTTOM = 743 / 1024;
/** Where the shield ends, below the cut. */
export const TRUST_PEEK_SHIELD_BOTTOM = 973 / 1024;
/** The shield's leading edge, as a fraction of the canvas width. */
export const TRUST_PEEK_SHIELD_LEFT = 580 / 1024;
/** The drawing's trailing edge, as a fraction of the canvas width. */
export const TRUST_PEEK_ART_RIGHT = 969 / 1024;

export const READY_MASCOT_MIN = 140;
export const READY_MASCOT_MAX = 180;
/** From this text scale the mascot takes its smallest size. */
export const READY_MASCOT_COMPACT_AT_SCALE = 1.5;

/** The summary card's inner padding. */
export const SUMMARY_PADDING = 16;
/** The room kept between the shield and the heading or the first row. */
export const SHIELD_CLEARANCE = 8;
/** The card's gap between the heading and the first row, and between rows. */
export const SUMMARY_ROW_GAP = 16;

/** The mascot's square, in points. */
export function readyMascotSize(windowHeight: number, fontScale: number): number {
  if (fontScale >= READY_MASCOT_COMPACT_AT_SCALE) return READY_MASCOT_MIN;
  const scaled = Math.round((windowHeight * 0.195) / 4) * 4;
  return Math.min(READY_MASCOT_MAX, Math.max(READY_MASCOT_MIN, scaled));
}

/** How far above the card's top border the mascot's box starts. */
export function readyMascotOffset(size: number): number {
  return Math.round(size * TRUST_PEEK_EDGE);
}

/** How much of the drawing stands above the card: the room the block reserves. */
export function readyMascotLift(size: number): number {
  return Math.ceil(size * (TRUST_PEEK_EDGE - TRUST_PEEK_ART_TOP));
}

/** The box's distance from the card's trailing edge: the drawing ends on the padding. */
export function readyMascotRight(size: number): number {
  return Math.round(SUMMARY_PADDING - size * (1 - TRUST_PEEK_ART_RIGHT));
}

/** How far the shield hangs into the card, from its top border. */
export function shieldDepth(size: number): number {
  return Math.ceil(size * (TRUST_PEEK_SHIELD_BOTTOM - TRUST_PEEK_EDGE));
}

/** How far the paw rests into the card, from its top border. */
export function pawDepth(size: number): number {
  return Math.ceil(size * (TRUST_PEEK_PAW_BOTTOM - TRUST_PEEK_EDGE));
}

/** How far in from the card's trailing edge the shield reaches. */
export function shieldReach(size: number): number {
  return Math.ceil(SUMMARY_PADDING + size * (TRUST_PEEK_ART_RIGHT - TRUST_PEEK_SHIELD_LEFT));
}

/** The heading's trailing inset: the shield's reach and the clearance. */
export function summaryHeadingInset(size: number): number {
  return shieldReach(size) - SUMMARY_PADDING + SHIELD_CLEARANCE;
}

/**
 * The heading block's least height, below the card's top padding: with the
 * row gap after it, the first row starts under the shield and its
 * clearance, however short the heading is.
 */
export function summaryHeaderMinHeight(size: number): number {
  return Math.max(0, shieldDepth(size) + SHIELD_CLEARANCE - SUMMARY_PADDING - SUMMARY_ROW_GAP);
}

/** How far the heading itself drops, when it moves beneath the shield. */
export function summaryHeadingDrop(size: number): number {
  return shieldDepth(size) + SHIELD_CLEARANCE - SUMMARY_PADDING;
}

/**
 * Whether the card takes its accessibility-size layout: the heading moves
 * below the shield to the card's full width, and each row stacks its artwork
 * and check on a top line over the full-width text. Beside the shield, or
 * between a 40pt well and the check, a word like `preferences`, `California`
 * or `Wholesale` no longer fits its line at the largest sizes and would break
 * inside itself (measured on an iPhone 17 at AX5).
 */
export function summaryStacked(fontScale: number): boolean {
  return fontScale >= READY_MASCOT_COMPACT_AT_SCALE;
}

/** Where the heading sits: beside the shield, or beneath it at full width. */
export function summaryHeadingLayout(
  size: number,
  fontScale: number,
): { paddingTop: number; paddingRight: number; minHeight: number } {
  return summaryStacked(fontScale)
    ? { paddingTop: summaryHeadingDrop(size), paddingRight: 0, minHeight: 0 }
    : {
        paddingTop: 0,
        paddingRight: summaryHeadingInset(size),
        minHeight: summaryHeaderMinHeight(size),
      };
}

// ── The rows ────────────────────────────────────────────────────────────────

/** The white well every row's artwork sits in. */
export const ROW_WELL_SIZE = 40;
/**
 * The widest any pictogram's drawing reaches, as a fraction of its canvas:
 * measured on the nine files, soy and fish are widest at 715/1024.
 */
export const PICTOGRAM_INK = 715 / 1024;
/** One allergen's pictogram box: at most 22.3pt of drawing, the map pin's 22.7. */
export const PICTOGRAM_SINGLE = 32;
/** Each of two pictograms' boxes: at most 19.6pt of drawing each. */
export const PICTOGRAM_PAIR = 28;
/**
 * The second pictogram's box starts this far right of AND below the first's,
 * so the two sit on the well's diagonal and fill it exactly: the drawings
 * meet only at one corner, and the well's top trailing corner is left free
 * for the `+N`.
 */
export const PICTOGRAM_PAIR_STEP = 12;
/** The completion check's circle. */
export const CHECK_CIRCLE_SIZE = 24;

export type AllergenArtwork =
  /** Nothing chosen: a neutral dash, never a specific pictogram. */
  | { kind: 'none' }
  /** One or two pictograms, in canonical order, and how many more there are. */
  | { kind: 'pictograms'; tokens: readonly string[]; more: number };

/**
 * What the Allergens well shows for the saved tokens: canonical
 * CONSUMER_ALLERGENS order whatever order they were chosen in, at most two
 * pictograms, and the rest as a count. A token outside the vocabulary has no
 * pictogram and is not counted.
 */
export function allergenArtwork(selected: readonly string[]): AllergenArtwork {
  const chosen = new Set(selected);
  const tokens = CONSUMER_ALLERGENS.filter((option) => chosen.has(option.token)).map(
    (option) => option.token,
  );
  if (tokens.length === 0) return { kind: 'none' };
  return { kind: 'pictograms', tokens: tokens.slice(0, 2), more: Math.max(0, tokens.length - 2) };
}

/** The decorative count beside the first two pictograms. */
export function moreLabel(more: number): string {
  return `+${more}`;
}

/**
 * A row's one spoken name: the category, the complete selection (or `None`),
 * and that it is done. The artwork and the check are never heard.
 */
export function summaryRowLabel(
  label: string,
  names: readonly string[],
  none: string,
  completed: string,
): string {
  return `${label}: ${names.length === 0 ? none : listNames(names)}, ${completed}`;
}
