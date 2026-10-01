/**
 * The Stores step's quick choices and search (Popular stores 2026-09-24; the
 * receipt, 2026-09-30): which six stores the receipt offers, in what order,
 * what its search sheet finds, where that sheet sits, and the one edit the
 * step's `Clear` makes.
 *
 * ## Six stores, in a curated order
 *
 * `POPULAR_RETAILER_IDS` is a product-curation choice, read top to bottom:
 * Walmart, Costco, Kroger, Aldi, Target, Trader Joe's — the founder-approved
 * receipt's six. It is deliberately NOT alphabetical and NOT a ranking: the
 * receipt calls them `Popular stores` and claims nothing about size, sales
 * or nearness. Every id is a canonical catalog id (domain/retailer-catalog.ts),
 * resolved through `retailerById`, so a row shows the catalog's own name and
 * saves the catalog's own id. There is no second retailer record, and fewer
 * quick choices is not less coverage: Sam's Club, Safeway, Publix, Ralphs
 * and every other store are one search away, in the same 77 entries the
 * Profile sheet uses. There is no inline expansion.
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
 * A leaf: tokens, the catalog and the preference type only, so Node tests
 * load it directly.
 */

import { spacing } from '@/constants/design-tokens';
import type { UserRecallPreferences } from '@/domain/preferences';
import {
  normalizeRetailerText,
  retailerById,
  searchRetailers,
  type CanonicalRetailer,
} from '@/domain/retailer-catalog';

/** The receipt's six quick choices, as canonical catalog ids, in their display order. */
export const POPULAR_RETAILER_IDS = [
  'walmart',
  'costco',
  'kroger',
  'aldi',
  'target',
  'trader-joes',
] as const;

export type PopularRetailerId = (typeof POPULAR_RETAILER_IDS)[number];

/**
 * The quick choices as their catalog records, in the curated order. Throws
 * at module load if an id ever stops resolving, so a renamed catalog id
 * fails loudly rather than dropping a row.
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
  if (fontScale >= RAISED_SHEET_AT_SCALE) return safeTop + spacing[16];
  return Math.max(safeTop + SHEET_MIN_CONTEXT, Math.round(windowHeight * 0.2));
}

/** Always left visible above the sheet at the standard sizes: the top bar's room. */
export const SHEET_MIN_CONTEXT = 72;

/** The dimmed step behind the sheet: `text/primary` at this opacity. */
export const SHEET_BACKDROP_OPACITY = 0.4;

/** The sheet's slide in and out, and the backdrop's fade with it (ms). */
export const SHEET_MOTION = { in: 280, out: 200 } as const;

/**
 * The accessibility text sizes start here (text scale 1.5, the app's shared
 * threshold): the search sheet rises to just under the status bar.
 */
export const RAISED_SHEET_AT_SCALE = 1.5;

/**
 * What `Clear` does to the saved preferences (P2B7V's rule, as
 * `clearAllergens` has it): with nothing selected it hands back THE SAME
 * object, so nothing is set, rendered or saved.
 */
export function clearRetailers(prefs: UserRecallPreferences): UserRecallPreferences {
  return prefs.retailers.length === 0 ? prefs : { ...prefs, retailers: [] };
}
