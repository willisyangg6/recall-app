/**
 * Welcome's presentation rules (onboarding brand pass 1): how large the
 * mascot is drawn, and the one entrance the screen plays. Numbers only, so
 * both are testable under Node; the component maps them onto React Native's
 * `Image` and `Animated`. A leaf.
 *
 * ## The mascot's size
 *
 * A quarter of the window's height, on the 4pt grid, held between
 * MASCOT_MIN and MASCOT_MAX: a small phone keeps room for the example card,
 * a large one gives the character its presence. It does not grow with the
 * reader's text size; the text around it does.
 *
 * ## The entrance
 *
 * Played once when Welcome first appears, and the only animation of Lotly's
 * own. The mascot fades in and settles from slightly small; the headline
 * block, then the example card, rise a short distance as they fade in.
 * Nothing loops and nothing moves after it settles. Under Reduce Motion
 * there is no motion at all: everything is shown in its final state at once
 * (DESIGN.md, "Reduced motion").
 */

export const MASCOT_MIN = 172;
export const MASCOT_MAX = 220;

/**
 * The approved asset's canvas is clear for about 16% of its height above
 * and below the drawing. This fraction of the canvas is tucked under the
 * neighbouring space (a negative vertical margin) so the character sits by
 * its name and the headline; the whole image is still drawn and nothing
 * overlaps the art.
 */
export const MASCOT_CLEAR_MARGIN = 0.12;

/** The mascot's square, in points. */
export function mascotSize(windowHeight: number): number {
  const scaled = Math.round((windowHeight * 0.24) / 4) * 4;
  return Math.min(MASCOT_MAX, Math.max(MASCOT_MIN, scaled));
}

export interface EntranceStep {
  /** Milliseconds after the screen appears. */
  delay: number;
  duration: number;
}

export const WELCOME_ENTRANCE = {
  /** Opacity 0 → 1. */
  mascotFade: { delay: 0, duration: 320 },
  /** Scale MASCOT_START_SCALE → 1, eased with a small overshoot so it settles. */
  mascotSettle: { delay: 0, duration: 600 },
  /** The headline and body: fade in and rise RISE_DISTANCE points. */
  heading: { delay: 260, duration: 380 },
  /** The example card and the source note, after the heading. */
  card: { delay: 420, duration: 440 },
} as const satisfies Record<string, EntranceStep>;

export const MASCOT_START_SCALE = 0.9;
export const RISE_DISTANCE = 14;

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
