/**
 * The States step's presentation rules (the grocery-atlas States,
 * 2026-09-30): how the approved composition's one image and its native text
 * are sized, and how the chooser's search finds a jurisdiction. Numbers and
 * pure functions only, so all of it is testable under Node; the components
 * map them onto React Native. A leaf.
 *
 * ## Measured from the approved target
 *
 * The founder-approved full-screen composition
 * (assets/brand/reference/lotly-onboarding-states-grocery-atlas-target.png,
 * 853×1844) is a 393pt-wide screen at 853/393 px per point, with no system
 * chrome. The production scene is a crop of it at its own pixels (0,597 to
 * 853,1328), so it scales by `width / 853` and spans the page: 393×337pt at
 * 393pt. The scene is static and identical for every household; nothing
 * about the shopper's selection is ever drawn on it.
 *
 * ## The native text
 *
 * The target's headline `Make it local.` is 308pt of ink across; Public
 * Sans Bold (the heaviest loaded face) matches that at 50pt (316.8pt of
 * advance, one line on a 343pt SE column). The body is the target's 18pt at
 * its 23pt line pitch, in a measure that reproduces its break after `or`:
 * wider than `Choose every state where you or` (270.5pt by the font's
 * advances) and narrower than the same line with `your` (312pt). The measure
 * grows with the reader's text size and is never a line break or a cap.
 * `Continue` is the target's 51pt pill with an 18pt label, drawn locally
 * because the shared Button has no size override. The helper is 14pt. All
 * of these are the States step's alone: the shared type scale and Button are
 * unchanged.
 *
 * ## At the accessibility text sizes (founder decision, 2026-09-30)
 *
 * From text scale 1.5 (the app's shared threshold: iOS's accessibility
 * sizes) the headline takes the standard `display` base, 33pt, instead of the
 * target's 50pt, and is still multiplied by the reader's setting like every
 * other text: an adaptive base, never a cap. At 50pt × AX5 single words
 * outgrew the column and broke inside themselves; at 33pt the longest word
 * fits at every size. A chosen state becomes a full-width row there: its
 * name wraps in the width left beside a separate 44pt remove button.
 *
 * ## Compact height
 *
 * On a screen shorter than `COMPACT_HEIGHT` (an iPhone SE) the step's
 * vertical gaps tighten so the whole search entry is above the footer on
 * arrival at the default text size. The scene keeps its full width and
 * aspect ratio and the type keeps its size; only the gaps give.
 */

import { spacing, typography } from '@/constants/design-tokens';
import { filterStateChoices, stateChoices, type StateChoice } from '@/lib/personalization-screen';

/** The approved target's width, in pixels: the scene is a crop of it at 1:1. */
export const REFERENCE_WIDTH = 853;

/** The production scene, lotly-states-grocery-atlas-scene.png (target x0 y597, full width). */
export const SCENE_PX = { width: 853, height: 731 } as const;

/** The States step's own text sizes and leading, in points (see "The native text"). */
export const STATES_TYPE = {
  headline: { fontSize: 50, lineHeight: 56 },
  body: { fontSize: 18, lineHeight: 23 },
  placeholder: { fontSize: 16, lineHeight: 22 },
  chip: { fontSize: 16, lineHeight: 20 },
  helper: { fontSize: 14, lineHeight: 19 },
  /** The shared Button's `body-small-bold` face and 1.4 ratio, at 18pt. */
  cta: { fontSize: 18, lineHeight: 25 },
} as const;

/** `Continue`'s and the search entry's minimum height, in points: the target's 51pt. */
export const CONTROL_MIN_HEIGHT = 51;

/** The body's measure at the default text size, in points (see "The native text"). */
export const BODY_MEASURE = 290;

/**
 * A chosen state's pill: the target's ~33pt, drawn at 34pt so that half the
 * difference to the 44pt minimum (5pt) above and below reaches the touch
 * target by hitSlop, and the rows' 10pt gap keeps neighbouring targets from
 * overlapping.
 */
export const CHIP = { minHeight: 34, hitSlop: 5, rowGap: spacing[8] + 2 } as const;

/** From this text scale the step switches to its accessibility layout (see above). */
export const ACCESSIBILITY_SCALE = 1.5;

export function atAccessibilitySize(fontScale: number): boolean {
  return fontScale >= ACCESSIBILITY_SCALE;
}

/** The headline's base size and leading, before the reader's text scale. */
export function headlineType(fontScale: number): { fontSize: number; lineHeight: number } {
  return atAccessibilitySize(fontScale)
    ? { fontSize: typography.display.fontSize, lineHeight: typography.display.lineHeight }
    : STATES_TYPE.headline;
}

/** Chosen states as pills beside each other, or as full-width rows with their own remove button. */
export function chipLayout(fontScale: number): 'pill' | 'row' {
  return atAccessibilitySize(fontScale) ? 'row' : 'pill';
}

/** Below this window height, in points, the step's vertical gaps tighten. */
export const COMPACT_HEIGHT = 700;

/** The step's vertical gaps, in points: above the heading, inside it, and above the scene. */
export function verticalGaps(windowHeight: number): {
  top: number;
  heading: number;
  scene: number;
} {
  return windowHeight < COMPACT_HEIGHT
    ? { top: spacing[4], heading: spacing[8], scene: spacing[4] }
    : { top: spacing[8], heading: spacing[12], scene: spacing[16] };
}

/** The scene's height, in points, for a page `width` points wide (it spans the width). */
export function sceneHeight(width: number): number {
  return (SCENE_PX.height * width) / REFERENCE_WIDTH;
}

/** The body's measure, in points, at the reader's text scale. */
export function bodyMeasure(fontScale: number): number {
  return BODY_MEASURE * fontScale;
}

/**
 * The chooser's top edge: just under the status bar. The chooser owns the
 * viewport while the shopper searches (the scene is covered, not shrunk),
 * and a small SE keeps as many result rows above the keyboard as it can.
 */
export function chooserTop(safeTop: number): number {
  return safeTop + spacing[16];
}

/** Other names a shopper types for a jurisdiction, beyond its full name and postal code. */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  DC: ['washington dc'],
};

/** Lower case, punctuation removed, spaces collapsed: `D.C.` and `dc` are one query. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The chooser's matches: every jurisdiction whose full name contains the
 * query (the shared filter), plus the one whose postal code IS the query
 * (`ny`, `DC`, `pr`), plus an alias that begins with it (`Washington DC`
 * finds the District of Columbia). All 52 for a blank query. Always in the
 * catalog's alphabetical order, each at most once.
 */
export function searchStateChoices(query: string): StateChoice[] {
  const choices = stateChoices();
  const needle = normalize(query);
  if (needle === '') return choices;
  const byName = new Set(filterStateChoices(choices, query).map((choice) => choice.code));
  return choices.filter(
    (choice) =>
      byName.has(choice.code) ||
      normalize(choice.name).includes(needle) ||
      choice.code.toLowerCase() === needle ||
      (ALIASES[choice.code] ?? []).some((alias) => alias.startsWith(needle)),
  );
}
