/**
 * Welcome's presentation rules: how the M01 "peek" mascot is sized and
 * seated on the example card, and the one entrance the screen plays.
 * Numbers only, so all of it is testable under Node; the component maps them
 * onto React Native's `Image` and `Animated`. A leaf.
 *
 * ## M01 on the card
 *
 * The welcome-peek artwork (assets/brand/production/
 * lotly-mascot-welcome-peek-1024.png) is a character cut flat along the
 * bottom with two paws hanging below that cut, drawn to sit on a ledge.
 * Measured on its 1024 canvas: the flat cut is at y = 808, the paws end at
 * y = 860, and the drawing starts at y = 185. The screen seats the cut on
 * the example card's top border, so the body reads as peeking over the card
 * and the paws rest on it.
 *
 * The paws reach PAW_DEPTH of the mascot's size into the card. The card's
 * padding is 12pt, so the size is capped where the paws still end above the
 * card's first row (its CRITICAL and AFFECTS YOU badges): 208pt reaches
 * 10.6pt in.
 *
 * ## The entrance
 *
 * Played once when Welcome first appears, and the only animation of Lotly's
 * own. The heading rises in; then the mascot rises from behind the card as it
 * fades in; then the card, its label and the source note follow with a
 * smaller rise, so the mascot and the card land as one moment. Nothing loops
 * and nothing moves after it settles. Under Reduce Motion there is no motion
 * at all: everything is shown in its final state at once (DESIGN.md,
 * "Reduced motion").
 */

/** The flat cut the body sits on, as a fraction of the canvas height. */
export const MASCOT_EDGE = 808 / 1024;
/** Where the drawing starts, as a fraction of the canvas height. */
export const MASCOT_ART_TOP = 185 / 1024;
/** How far the paws hang below the cut, as a fraction of the canvas height. */
export const PAW_DEPTH = (860 - 808) / 1024;

export const MASCOT_MIN = 176;
export const MASCOT_MAX = 208;

/** The example card's inner padding, which the paws must stay inside. */
export const CARD_PADDING = 12;

/**
 * The room the example block leaves above the card for the caption label
 * (one `caption` line and the 8pt gap under it); the mascot rises beside it.
 */
export const LABEL_ALLOWANCE = 24;

/** The mascot's square, in points: a quarter of the window, on the 4pt grid. */
export function mascotSize(windowHeight: number): number {
  const scaled = Math.round((windowHeight * 0.24) / 4) * 4;
  return Math.min(MASCOT_MAX, Math.max(MASCOT_MIN, scaled));
}

/** How far above the card's top border the mascot's box starts. */
export function mascotOffset(size: number): number {
  return Math.round(size * MASCOT_EDGE);
}

/** How much of the drawing stands above the card's top border. */
export function mascotLift(size: number): number {
  return Math.ceil(size * (MASCOT_EDGE - MASCOT_ART_TOP));
}

/**
 * The space the example block reserves above its label so the standing
 * mascot never reaches the text above it.
 */
export function peekReserve(size: number): number {
  return Math.max(0, mascotLift(size) - LABEL_ALLOWANCE);
}

export interface EntranceStep {
  /** Milliseconds after the screen appears. */
  delay: number;
  duration: number;
}

export const WELCOME_ENTRANCE = {
  /** The headline and body: fade in and rise HEADING_RISE points. */
  heading: { delay: 0, duration: 360 },
  /** The mascot's opacity, 0 → 1. */
  mascotFade: { delay: 160, duration: 300 },
  /** The mascot rises MASCOT_RISE points, eased with a small overshoot. */
  mascotRise: { delay: 160, duration: 480 },
  /** The label, the card and the source note: fade in, rise CARD_RISE. */
  card: { delay: 300, duration: 420 },
} as const satisfies Record<string, EntranceStep>;

export const HEADING_RISE = 14;
export const MASCOT_RISE = 24;
export const CARD_RISE = 8;

/** When the last element comes to rest. */
export function entranceEndMs(): number {
  return Math.max(...Object.values(WELCOME_ENTRANCE).map((step) => step.delay + step.duration));
}

/**
 * What to play. Reduce Motion (or not knowing whether it is on) means the
 * final state immediately: no fade, no scale, no rise.
 */
export function welcomeEntrance(reduceMotion: boolean): 'animate' | 'show' {
  return reduceMotion ? 'show' : 'animate';
}
