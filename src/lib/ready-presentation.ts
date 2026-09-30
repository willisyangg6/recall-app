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
 * (`summaryHeaderMinHeight`).
 *
 * The block reserves LESS than the drawing's full height above the card
 * (`readyMascotReserve`, the 2026-09-27 polish): at ordinary text sizes the
 * mascot's crest rises `READY_MASCOT_OVERLAP` (48pt) into the body
 * paragraph's vertical band, which is safe because the mascot is
 * right-aligned and the paragraph's lines end well left of it at those
 * sizes. From text scale 1.2 the paragraph wraps far enough right that the
 * two could meet, so the overlap is 0 and the full lift is reserved. The
 * seat itself never changes: the flat cut stays exactly on the card's top
 * border, the paw on its edge and the shield in front.
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
 * ## The carousel (2026-09-28)
 *
 * The personalized preview is a HORIZONTAL deck: one active card, a visible
 * slice of the next (`CAROUSEL_PEEK`), snapping one card at a time. The
 * geometry is here so the component and its tests agree: a card takes the
 * usable content width less the peek, the snap interval is the card plus
 * its gap, and the layered look comes from the peek alone — no arrows, no
 * instruction copy, no auto-advance, no loop.
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

import { typography } from '@/constants/design-tokens';
import { CONSUMER_ALLERGENS } from '@/domain/preferences';
import { moreStoresLabel } from '@/lib/onboarding-copy';
import { listNames } from '@/lib/personalization-screen';

// ── The glyph this step adds to the icon set ────────────────────────────────

/**
 * The Ready step's glyphs and their vendored Lucide sources (see the
 * header): `shopping-cart` for the Stores row (2026-09-26), and `lock` for
 * the locked-matches strip and sentinel (2026-09-28).
 */
export const READY_ICON_SOURCES = [
  { icon: 'shopping-cart', lucideName: 'shopping-cart' },
  { icon: 'lock', lucideName: 'lock' },
] as const;
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

/** How much of the drawing stands above the card. */
export function readyMascotLift(size: number): number {
  return Math.ceil(size * (TRUST_PEEK_EDGE - TRUST_PEEK_ART_TOP));
}

/**
 * How far the mascot's crest may rise into the body paragraph's vertical
 * band (see the header): the mascot is right-aligned, and at ordinary sizes
 * the paragraph's lines end well left of it.
 */
export const READY_MASCOT_OVERLAP = 48;
/** From this text scale the paragraph can reach the mascot, so no overlap. */
export const OVERLAP_UNTIL_SCALE = 1.2;

export function readyMascotOverlap(fontScale: number): number {
  return fontScale < OVERLAP_UNTIL_SCALE ? READY_MASCOT_OVERLAP : 0;
}

/** The room the block reserves above the card: the lift, less the overlap. */
export function readyMascotReserve(size: number, fontScale: number): number {
  return Math.max(0, readyMascotLift(size) - readyMascotOverlap(fontScale));
}

/**
 * How much trailing width the heading block gives up so the body wraps into
 * the approved "cliff" LEFT of the rising crest (the carousel target's
 * two-line body) instead of running under it. The 2026-09-27 body happened
 * to wrap clear; the 2026-09-28 body is shorter and needs the constraint
 * explicit. Only while the crest actually rises — from text scale 1.2 the
 * full lift is reserved, the mascot sits wholly below the paragraph, and
 * squeezing large text would cost lines for nothing.
 */
export const READY_BODY_ASIDE_FRACTION = 0.82;

export function readyBodyAside(size: number, fontScale: number): number {
  if (readyMascotOverlap(fontScale) === 0) return 0;
  return Math.round(size * READY_BODY_ASIDE_FRACTION);
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

/** Up to this many stores, the Stores row shows every name. */
export const STORE_SUMMARY_LIMIT = 3;
/** Past the limit, it shows this many names and counts the rest. */
export const STORE_SUMMARY_SHOWN = 2;

/**
 * The Stores row's VISIBLE value (2026-09-27), so a long selection cannot
 * make the summary card dominate the screen now that the plans follow it:
 * up to three stores in full (`Aldi, Costco, Kroger`); four or more as the
 * first two and a count (`Aldi, Costco +4 more`). The names keep the
 * summary's own order — the order they were chosen in, which is the order
 * Profile shows them in (lib/profile-hub.ts) — so the two never disagree
 * about which come first. The row's spoken name is not compacted: it names
 * every store (`summaryRowLabel`). States and allergens are never
 * compacted.
 */
export function storeSummaryText(names: readonly string[]): string {
  if (names.length <= STORE_SUMMARY_LIMIT) return names.join(', ');
  const shown = names.slice(0, STORE_SUMMARY_SHOWN).join(', ');
  return `${shown} ${moreStoresLabel(names.length - STORE_SUMMARY_SHOWN)}`;
}

// ── The carousel ────────────────────────────────────────────────────────────

/** How much of the NEXT card stays visible beside the active one. */
export const CAROUSEL_PEEK = 32;
/** The gap between cards; part of the snap interval. */
export const CAROUSEL_GAP = 12;

/**
 * A card's width: the usable content width less the peek, never less than
 * a readable floor. `usableWidth` is the window (or content cap) minus the
 * page margins.
 */
export function carouselCardWidth(usableWidth: number): number {
  return Math.max(200, usableWidth - CAROUSEL_PEEK);
}

/** The paging stride: one card and its gap. */
export function carouselSnapInterval(usableWidth: number): number {
  return carouselCardWidth(usableWidth) + CAROUSEL_GAP;
}

// ── The deck's depth (polish pass) ──────────────────────────────────────────
//
// The preview must read as a swipeable DECK, not a flat list: the next card
// tucks slightly behind the active card's trailing edge at a reduced scale,
// so depth — not an arrow or a sentence — says more cards follow. The
// transforms are visual only (they change no layout), the active card's
// static z-order keeps it on top, and everything animates on the scroll
// position alone: no loop, no auto-advance, no timer.

/** The next card's scale while it waits behind the active one. */
export const DECK_NEXT_SCALE = 0.93;
/** How far the next card tucks toward (behind) the active card, in points. */
export const DECK_TUCK = 16;

// ── The uniform preview card ────────────────────────────────────────────────
//
// Every deck card shares one outer size at a given width and text-size
// class, so swiping never changes the deck's height and no card looks less
// finished than its neighbours. The rules: every slot is RESERVED (an empty
// optional field keeps its space) and the wrapping slots are line-limited
// (the full text still reaches the accessibility element). From the
// accessibility text sizes the limits and reservations come off — an
// accessible responsive card, never capped type.

export const PREVIEW_TITLE_LINES = 2;
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
 * The reserved slot heights, from the type scale at this text size — or
 * null from the accessibility sizes, where nothing is reserved or limited.
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
  /** Exactly the title's line limit, reserved even for short names. */
  titleMinHeight: number;
  /** The category chip's row, reserved even when the case has none. */
  categoryHeight: number;
  /** The reason's line limit, reserved even when there is no reason line. */
  reasonMinHeight: number;
}

export function previewCardLayout(fontScale: number): PreviewCardLayout | null {
  if (!previewCardUniform(fontScale)) return null;
  return {
    statusMinHeight: chipHeight(fontScale),
    titleMinHeight:
      Math.round(typography['heading-3'].lineHeight * fontScale) * PREVIEW_TITLE_LINES,
    categoryHeight: Math.round(typography.caption.lineHeight * fontScale) + 2 * 4 + 2,
    reasonMinHeight:
      Math.round(typography['body-small'].lineHeight * fontScale) * PREVIEW_REASON_LINES,
  };
}

/**
 * The deck's shared status-row reservation: the rule's one chip row, or the
 * tallest row any card measured — monotonic, so a measurement taken WITH
 * the reservation applied can only confirm it, never oscillate.
 */
export function deckStatusHeight(rule: number, measured: readonly number[]): number {
  return Math.max(rule, ...measured.map((h) => Math.ceil(h)));
}

/** Which card the deck has settled on, from the scroll offset. */
export function carouselActiveIndex(
  offsetX: number,
  usableWidth: number,
  itemCount: number,
): number {
  const interval = carouselSnapInterval(usableWidth);
  const index = Math.round(offsetX / interval);
  return Math.min(Math.max(index, 0), Math.max(itemCount - 1, 0));
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
