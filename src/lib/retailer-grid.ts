/**
 * The Retailers step's Popular stores (2026-09-24): which ten stores it offers
 * first, in what order, what its search sheet finds, how many columns the
 * tiles take, and the one edit the step's `Clear` makes.
 *
 * ## Ten stores, in a curated order
 *
 * `POPULAR_RETAILER_IDS` is a product-curation choice, read row by row, left
 * to right: Walmart, Costco, Kroger, Aldi, Target, Trader Joe's, Sam's Club,
 * Safeway, Publix, Ralphs. It is deliberately NOT alphabetical and NOT a
 * ranking: the screen calls them `Popular stores` and claims nothing about
 * size, sales or nearness. Every id is a canonical catalog id
 * (domain/retailer-catalog.ts), resolved through `retailerById`, so a tile
 * shows the catalog's own name and saves the catalog's own id. There is no
 * second retailer record: the search sheet opened below the ten looks through the
 * same 77 entries the Profile sheet uses.
 *
 * ## The search
 *
 * `retailerSearchResults` is the catalog's own `searchRetailers` — the same
 * case-, punctuation- and whitespace-insensitive match on each store's name
 * and aliases, results in name order — with one difference: a query with
 * nothing to match (empty, spaces, punctuation) is no search at all, so it
 * returns `null` and the sheet shows its instruction, never the whole
 * catalog. The query itself is never saved anywhere.
 *
 * ## Two columns only where a name still fits
 *
 * The Allergens grid's rule (lib/allergen-grid.ts), with this tile's
 * geometry: two columns while the widest word of any popular name, at the
 * reader's text size, fits the label line a half-width tile leaves; one
 * full-width column otherwise, and always from the accessibility sizes
 * (text scale 1.5, the app's shared threshold). A name may wrap between
 * words (`Trader` / `Joe's`), never inside one. The widths are MEASURED from
 * the bundled Public Sans in `body` at text scale 1, and
 * `retailer-grid.test.ts` re-measures them from the font file.
 *
 * With no pictogram the tile's chrome is small enough that a full-width
 * tile holds the widest word even at AX5 on a 375pt iPhone SE, so, unlike
 * the allergen tile, this one never needs to stack.
 *
 * Deterministic: a function of the window's width and text scale alone,
 * known on the first frame, with no measuring pass to flicker.
 *
 * A leaf: tokens, the catalog and the preference type only, so Node tests
 * load it directly.
 */

import { hitTarget, iconSize, layout, spacing } from '@/constants/design-tokens';
import type { UserRecallPreferences } from '@/domain/preferences';
import {
  normalizeRetailerText,
  retailerById,
  searchRetailers,
  type CanonicalRetailer,
} from '@/domain/retailer-catalog';

/** The curated Popular stores, as canonical catalog ids, in their display order. */
export const POPULAR_RETAILER_IDS = [
  'walmart',
  'costco',
  'kroger',
  'aldi',
  'target',
  'trader-joes',
  'sams-club',
  'safeway',
  'publix',
  'ralphs',
] as const;

export type PopularRetailerId = (typeof POPULAR_RETAILER_IDS)[number];

/**
 * The popular stores as their catalog records, in the curated order. Throws
 * at module load if an id ever stops resolving, so a renamed catalog id
 * fails loudly rather than dropping a tile.
 */
export const POPULAR_RETAILERS: readonly CanonicalRetailer[] = POPULAR_RETAILER_IDS.map((id) => {
  const retailer = retailerById(id);
  if (retailer === null) throw new Error(`popular retailer "${id}" is not in the catalog`);
  return retailer;
});

/**
 * The stores a search finds, in name order: `null` while there is nothing to
 * search for (no results section at all), an empty list when nothing
 * matches (`No stores found.`).
 */
export function retailerSearchResults(query: string): CanonicalRetailer[] | null {
  if (normalizeRetailerText(query) === '') return null;
  return searchRetailers(query);
}

/**
 * The search sheet's top edge, in points from the top of the window. It is
 * fixed for a given window and text size — never moved by the query, the
 * results or the keyboard — so the sheet's frame is stable while the shopper
 * types. A fifth of the window is left above it at the standard sizes, so
 * the dimmed step behind (the top bar and the heading) still says where the
 * search belongs; from the accessibility sizes it rises to just under the
 * status bar, because the larger title and field need the height.
 */
export function searchSheetTop(windowHeight: number, safeTop: number, fontScale: number): number {
  if (fontScale >= ONE_COLUMN_AT_SCALE) return safeTop + spacing[16];
  return Math.max(safeTop + SHEET_MIN_CONTEXT, Math.round(windowHeight * 0.2));
}

/** Always left visible above the sheet at the standard sizes: the top bar's room. */
export const SHEET_MIN_CONTEXT = 72;

/** The dimmed step behind the sheet: `text/primary` at this opacity. */
export const SHEET_BACKDROP_OPACITY = 0.4;

/** The sheet's slide in and out, and the backdrop's fade with it (ms). */
export const SHEET_MOTION = { in: 280, out: 200 } as const;

/** The space between tiles, across and down. */
export const GRID_GAP = spacing[8];

/**
 * The tile's inner geometry. The component draws from these, so the rule and
 * the drawing cannot drift.
 */
export const TILE = {
  paddingHorizontal: spacing[16],
  paddingVertical: spacing[16],
  gap: spacing[12],
  check: iconSize[20],
  minHeight: hitTarget.minimum,
} as const;

/** Everything on a tile's row that is not the name: padding, gap, checkbox. */
export const TILE_CHROME = TILE.paddingHorizontal * 2 + TILE.gap + TILE.check;

/** A sub-point allowance for the platform's line layout rounding. */
export const LINE_ALLOWANCE = 1;

/**
 * The accessibility text sizes start here: always one column, and the
 * mascot yields its room to the heading.
 */
export const ONE_COLUMN_AT_SCALE = 1.5;

/**
 * Every word of every popular name, in `body` at text scale 1 (Public Sans
 * Regular 16pt, `PublicSans_400Regular.ttf`), in points.
 */
export const POPULAR_WORD_WIDTHS: Readonly<Record<string, number>> = {
  Walmart: 63.1,
  Costco: 51.6,
  Kroger: 51.1,
  Aldi: 29.5,
  Target: 48.1,
  Trader: 48.7,
  "Joe's": 34.1,
  "Sam's": 43.4,
  Club: 34.6,
  Safeway: 63.9,
  Publix: 46.9,
  Ralphs: 51.1,
};

/** The widest popular-name word at text scale 1. */
export const WIDEST_NAME_WORD = Math.max(
  ...POPULAR_RETAILERS.flatMap((retailer) =>
    retailer.name.split(' ').map((word) => POPULAR_WORD_WIDTHS[word] ?? Infinity),
  ),
);

/** The frame's content column for a window: capped, less the page margins. */
export function contentWidthFor(windowWidth: number): number {
  return Math.min(windowWidth, layout.maxContentWidth) - layout.pageMargin * 2;
}

/** The name line a tile leaves in a column of `columns` across `contentWidth`. */
export function nameWidth(contentWidth: number, columns: 1 | 2): number {
  const tile = (contentWidth - GRID_GAP * (columns - 1)) / columns;
  return tile - TILE_CHROME;
}

export function retailerGridColumns(windowWidth: number, fontScale: number): 1 | 2 {
  if (fontScale >= ONE_COLUMN_AT_SCALE) return 1;
  const needed = WIDEST_NAME_WORD * fontScale + LINE_ALLOWANCE;
  return nameWidth(contentWidthFor(windowWidth), 2) >= needed ? 2 : 1;
}

/** The tiles cut into rows of `columns`, so reading order is left to right, then down. */
export function retailerGridRows<T>(items: readonly T[], columns: 1 | 2): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return rows;
}

/**
 * M03, the ready pose with the grocery bag, beside the heading: its square in
 * points, drawn whole with `contain`. From the accessibility sizes it is not
 * drawn, so the heading and body take the full width.
 */
export const READY_MASCOT_SIZE = 120;

export function showReadyMascot(fontScale: number): boolean {
  return fontScale < ONE_COLUMN_AT_SCALE;
}

/**
 * What `Clear` does to the saved preferences (P2B7V's rule, as
 * `clearAllergens` has it): with nothing selected it hands back THE SAME
 * object, so nothing is set, rendered or saved.
 */
export function clearRetailers(prefs: UserRecallPreferences): UserRecallPreferences {
  return prefs.retailers.length === 0 ? prefs : { ...prefs, retailers: [] };
}
