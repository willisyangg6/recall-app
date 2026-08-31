/**
 * Reading `projection.productCategories` back out of storage — the CLIENT-SAFE
 * half of the category contract (C10B).
 *
 * ## Why this is not just `readProductCategories` from `projection.ts`
 *
 * It is the same logic, and a test pins that it stays the same logic
 * (`product-categories-stored.test.ts`). It lives in its own leaf module for a
 * bundling reason that is not cosmetic:
 *
 *   `domain/projection.ts` hosts BOTH the reader and `deriveProductCategories`,
 *   and the derivation imports the classifier — matcher, lexicon, non-food
 *   terms, the whole grammar — plus `deriveGeography` and `deriveRetailerNames`.
 *   Importing that module from `lib/recall-feed.ts` put every one of those into
 *   the shipped iOS and web bundles. Measured, not assumed: an `expo export`
 *   before this split found `categoriesForCase`, `categoryProductText` and
 *   `NON_FOOD_TERMS` in both entry bundles.
 *
 * That matters beyond bundle size. The app is supposed to receive the ANSWER
 * and never the evidence: shipping the classifier invites a future screen to
 * re-derive a category on-device from whatever text it happens to hold, which
 * is how a second, weaker, unmeasured classifier gets born. The seam is easier
 * to hold than the discipline.
 *
 * So: derivation is server-side, reading is universal, and this file is the
 * reading half. It imports the frozen VOCABULARY (ids, order, labels) and
 * nothing else — `food-category.ts` has no imports of its own, so this module
 * is a leaf.
 *
 * ## Missing is not Other
 *
 * The one behaviour every caller depends on: `null` means "no categories are
 * stored for this case", which is NOT `['other']` ("stored, and the source
 * never named the product well enough to place it"). Collapsing the two would
 * let an un-enriched case appear under a chip it was never assigned, which is
 * the single way this filter could state something false about a recall.
 */

import { isFoodCategoryId, orderFoodCategories, type FoodCategoryId } from './food-category';

/**
 * Normalize a raw stored value into a list the filter can trust, or `null`.
 *
 * `null` for: an absent key (every projection written before C10A), an
 * explicit null, a value that is not an array, and an array with nothing valid
 * left in it. All four mean the same thing — this case carries no answer — and
 * collapsing them to one representation means no caller has to enumerate them.
 *
 * Otherwise the canonical form, via `orderFoodCategories`: unknown ids
 * dropped (a value written by a future vocabulary must not crash an older
 * build), duplicates collapsed, `other` removed wherever a real category
 * survives, sorted into display order, capped. Idempotent.
 *
 * The parameter is `unknown` on purpose. This reads a jsonb column; nothing in
 * Postgres constrains its shape, and a signature that claimed otherwise would
 * move the lie one layer up rather than removing it.
 */
export function readStoredProductCategories(value: unknown): FoodCategoryId[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return null;
  const valid = value.filter(
    (id): id is FoodCategoryId => typeof id === 'string' && isFoodCategoryId(id),
  );
  return valid.length === 0 ? null : orderFoodCategories(valid);
}
