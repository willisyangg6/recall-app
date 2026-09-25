/**
 * The Allergens step's grid (P2B7Z): how many columns the nine allergen
 * tiles take, the tile geometry that decision rests on, and the one edit
 * the step's `Clear selection` makes.
 *
 * ## Two columns only where a label still fits
 *
 * A tile lays out, left to right: its padding, the allergen's pictogram, a
 * gap, the label, a gap, the checkbox, its padding (`TILE_CHROME`). Whatever
 * the column leaves after that chrome is the label's line. A label may wrap
 * between words — `Crustacean shellfish` takes two lines in a narrow
 * column, and that is fine — but a single word that does not fit its line
 * is broken mid-word by iOS (`Crustacea` / `n`), which is the cramped case
 * this rule exists to prevent. So the grid is two columns exactly when the
 * widest word of any label, at the reader's text size, fits the label line
 * of a half-width tile; otherwise it is one column, full width, where every
 * label has room.
 *
 * The widths are MEASURED, not counted: `ALLERGEN_WORD_WIDTHS` is every
 * word of every consumer allergen label set in `body` (Public Sans Regular,
 * 16pt) at text scale 1, measured from the bundled font file with
 * @napi-rs/canvas, rounded up to 0.1pt. React Native scales type linearly by
 * the window's `fontScale`, so a word's width at any size is its 1× width
 * times that scale. `allergen-grid.test.ts` re-measures the table from the
 * font, and fails if a label gains a word the table does not hold.
 *
 * Past one column there is one more step: where even a full-width tile's
 * label line is narrower than the widest word (the largest accessibility
 * sizes on a narrow phone), the tile stacks — pictogram and checkbox on a
 * top line, the label beneath at the tile's full width (`allergenTileStacked`).
 *
 * Independently of width, the accessibility text sizes (a text scale of 1.5
 * and up, the app's shared threshold — the paywall footer and the settings
 * selector row switch there too) are always one column: a tall half-width
 * tile is harder to scan than a full-width row even when its words fit.
 *
 * Deterministic: the answer is a function of the window's width and text
 * scale alone, known on the first frame, with no measuring pass to flicker.
 *
 * A leaf: tokens and the vocabulary only, so Node tests load it directly.
 */

import { hitTarget, iconSize, layout, spacing } from '@/constants/design-tokens';
import { CONSUMER_ALLERGENS, type UserRecallPreferences } from '@/domain/preferences';

/** The space between tiles, across and down. */
export const GRID_GAP = spacing[8];

/**
 * The tile's inner geometry. The component draws from these, so the rule and
 * the drawing cannot drift.
 *
 * The pictogram (lib/allergen-assets.ts) is drawn whole in a fixed 44pt box,
 * where its art is about 31pt: every file carries at least 6.5pt of
 * transparent margin on each side at that size. The box's sides overhang the
 * tile's padding and the gap beside it by `pictogramOverhang` — less than
 * that margin, so only transparent pixels overhang, the art never enters the
 * padding, and the box's edge meets the label's without overlapping it. The
 * padding and gaps were tightened from 12 and 8 so the row's chrome stays
 * exactly what the 20pt glyph's was: every column and stacking breakpoint is
 * unchanged by the larger art.
 */
export const TILE = {
  paddingHorizontal: spacing[8],
  paddingVertical: spacing[16],
  gap: spacing[4],
  pictogram: 44,
  pictogramOverhang: spacing[4],
  check: iconSize[20],
  minHeight: hitTarget.minimum,
} as const;

/** Everything on a tile's row that is not the label. */
export const TILE_CHROME =
  TILE.paddingHorizontal * 2 +
  (TILE.pictogram - TILE.pictogramOverhang * 2) +
  TILE.gap * 2 +
  TILE.check;

/** A sub-point allowance for the platform's line layout rounding. */
export const LINE_ALLOWANCE = 1;

/** The accessibility text sizes start here: always one column. */
export const ONE_COLUMN_AT_SCALE = 1.5;

/**
 * Every word of every consumer allergen label, in `body` at text scale 1
 * (Public Sans Regular 16pt, `PublicSans_400Regular.ttf`), in points.
 */
export const ALLERGEN_WORD_WIDTHS: Readonly<Record<string, number>> = {
  Peanuts: 60.7,
  Tree: 33.3,
  nuts: 32.9,
  Milk: 32,
  Egg: 29.5,
  Wheat: 48.2,
  Soy: 28.3,
  Sesame: 59.6,
  Fish: 30.8,
  Crustacean: 85.2,
  shellfish: 62.9,
};

/** The widest label word at text scale 1. */
export const WIDEST_LABEL_WORD = Math.max(
  ...CONSUMER_ALLERGENS.flatMap((option) =>
    option.label.split(' ').map((word) => ALLERGEN_WORD_WIDTHS[word] ?? Infinity),
  ),
);

/** The frame's content column for a window: capped, less the page margins. */
export function contentWidthFor(windowWidth: number): number {
  return Math.min(windowWidth, layout.maxContentWidth) - layout.pageMargin * 2;
}

/** The label line a tile leaves in a column of `columns` across `contentWidth`. */
export function labelWidth(contentWidth: number, columns: 1 | 2): number {
  const tile = (contentWidth - GRID_GAP * (columns - 1)) / columns;
  return tile - TILE_CHROME;
}

export function allergenGridColumns(windowWidth: number, fontScale: number): 1 | 2 {
  if (fontScale >= ONE_COLUMN_AT_SCALE) return 1;
  const needed = WIDEST_LABEL_WORD * fontScale + LINE_ALLOWANCE;
  return labelWidth(contentWidthFor(windowWidth), 2) >= needed ? 2 : 1;
}

/**
 * Whether a tile stacks: its pictogram and checkbox on one line, the label
 * beneath at the tile's full inner width. Only where even a full-width
 * tile's label line cannot hold the widest word — the largest accessibility
 * sizes on a narrow phone (AX4 and AX5 on a 375pt iPhone SE) — so the
 * word still wraps between words rather than breaking mid-word. A stacked
 * tile is always in one column: two could never fit where one does not.
 */
export function allergenTileStacked(windowWidth: number, fontScale: number): boolean {
  const needed = WIDEST_LABEL_WORD * fontScale + LINE_ALLOWANCE;
  return labelWidth(contentWidthFor(windowWidth), 1) < needed;
}

/** The label line of a stacked tile: its full inner width. */
export function stackedLabelWidth(contentWidth: number): number {
  return contentWidth - TILE.paddingHorizontal * 2;
}

/**
 * The allergens in their canonical order, cut into rows of `columns`. A
 * short last row keeps its tiles at column width (the caller pads it), so
 * reading order is always left to right, then down.
 */
export function allergenGridRows<T>(items: readonly T[], columns: 1 | 2): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return rows;
}

/**
 * What `Clear selection` does to the saved preferences (P2B7V's rule, as
 * `clearStateDraft` has it for the state draft): with nothing selected it
 * hands back THE SAME object, so nothing is set, rendered or saved.
 */
export function clearAllergens(prefs: UserRecallPreferences): UserRecallPreferences {
  return prefs.allergens.length === 0 ? prefs : { ...prefs, allergens: [] };
}
