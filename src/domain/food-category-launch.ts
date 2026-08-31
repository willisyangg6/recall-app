/**
 * The LAUNCH-VISIBLE category allowlist (Phase C10B).
 *
 * `food-category.ts` holds the complete internal vocabulary — twelve ids that
 * every stored projection may legitimately carry. This file holds a strictly
 * smaller, separate thing: the subset the consumer Category filter OFFERS.
 *
 * Two lists rather than one, on purpose:
 *
 *   · The vocabulary is FROZEN (its hash is recorded in
 *     `category-freeze-manifest.json`) and is a property of the data. Hiding a
 *     chip is a product decision about the UI, and a product decision must not
 *     require touching a frozen classifier file or migrating persisted rows.
 *   · A hidden id stays completely VALID: cases keep carrying it, the backfill
 *     keeps writing it, QA keeps reporting it, and a later milestone can
 *     un-hide it by deleting one line here. Nothing is deleted or renamed, so
 *     no stored value ever becomes unreadable.
 *
 * ## Why these three are hidden
 *
 * `prepared_foods` — the classifier's known recall weakness. C10A.2 measured
 * 64.8% recall (35/54) against 94.6% precision on the final holdout: roughly a
 * third of genuinely prepared-food recalls are filed elsewhere, almost always
 * under Meat & poultry. A chip that silently omits a third of its aisle is
 * worse than no chip, because the omission is invisible. Precision being high
 * means the id is still RIGHT when assigned, which is why cases keep carrying
 * it and Meat & poultry — whose recall is 97.8% — stays offered.
 *
 * `supplements` — insufficient and repeatedly weak validation. The final
 * holdout contains zero supplement rows (see the manifest's
 * `reviewedDistribution`), so there is no evidence at all about how the
 * shipped classifier places them, and earlier phases' reviewed-unfindable
 * records include a supplement filed under Pantry & staples. Offering a chip
 * this app cannot say anything measured about is a claim it has not earned.
 *
 * `other` — an internal fallback, not an aisle. It means "the source text
 * never named the product well enough to place it", which is honest as stored
 * data and useless as a filter: a shopper does not browse for Other. It exists
 * so the derivation can be TOTAL, and totality is a data property, not a chip.
 *
 * ## What this file is NOT
 *
 * It is not a completeness boundary. Every recall — including every hidden-id
 * case — remains reachable through the unfiltered All Recalls feed, search,
 * Affects Me, risk, and notifications. Category narrows a view; it never
 * decides what exists.
 */

import {
  FOOD_CATEGORY_IDS,
  foodCategoryLabel,
  isFoodCategoryId,
  type FoodCategoryId,
} from './food-category';

/**
 * Ids that are valid internally but are NOT offered as a launch filter chip.
 * See the rationale above; each entry is a product decision with measured
 * evidence behind it, not a taxonomy change.
 */
export const HIDDEN_LAUNCH_CATEGORY_IDS: readonly FoodCategoryId[] = [
  'prepared_foods',
  'supplements',
  'other',
] as const;

const HIDDEN = new Set<FoodCategoryId>(HIDDEN_LAUNCH_CATEGORY_IDS);

/**
 * The nine launch-visible ids, DERIVED from the frozen vocabulary rather than
 * re-listed. Two consequences that a hand-written list would not give:
 *
 *   1. the order is the canonical display order by construction, so a filter
 *      chip row, a selected-id array normalized by `orderFoodCategories`, and
 *      a stored projection can never disagree about sequence;
 *   2. a vocabulary id that is neither offered nor explicitly hidden is
 *      impossible — every id lands in exactly one of the two lists, and the
 *      test suite pins the partition.
 */
export const LAUNCH_CATEGORY_IDS: readonly FoodCategoryId[] = FOOD_CATEGORY_IDS.filter(
  (id) => !HIDDEN.has(id),
);

const LAUNCH_INDEX = new Map<FoodCategoryId, number>(
  LAUNCH_CATEGORY_IDS.map((id, index) => [id, index]),
);

/** Is this id offered by the launch Category filter? */
export function isLaunchCategoryId(value: unknown): value is FoodCategoryId {
  return typeof value === 'string' && isFoodCategoryId(value) && !HIDDEN.has(value);
}

/**
 * The Category sheet's options, in canonical display order. Labels come from
 * the frozen vocabulary — nothing outside `food-category.ts` may spell one, so
 * a reworded label reaches the sheet without a change here.
 */
export const LAUNCH_CATEGORY_OPTIONS: readonly { value: string; label: string }[] =
  LAUNCH_CATEGORY_IDS.map((id) => ({ value: id, label: foodCategoryLabel(id) }));

/**
 * THE boundary every category selection crosses before it becomes filter
 * state. Accepts anything — a restored session, a hand-edited store, a value
 * written by a future build — and returns a list the filter can trust:
 *
 *   1. non-strings and unknown ids are dropped (a future vocabulary id must
 *      not crash or leak into an older build's chip row);
 *   2. HIDDEN ids are dropped, so `prepared_foods`, `supplements` and `other`
 *      cannot be selected through any path — including one that bypasses the
 *      UI entirely;
 *   3. duplicates collapse;
 *   4. the result is sorted into canonical display order.
 *
 * Deliberately NOT `orderFoodCategories`: that function is the canonical
 * reader for STORED data and maps an empty list to `['other']`, because every
 * case must carry a category. An empty SELECTION means the opposite — no
 * category restriction at all — so mapping it to anything would invent a
 * filter the user did not choose.
 *
 * Idempotent: feeding the output back in returns it unchanged.
 */
export function sanitizeLaunchCategoryIds(value: unknown): FoodCategoryId[] {
  if (!Array.isArray(value)) return [];
  const valid = value.filter(isLaunchCategoryId);
  return [...new Set(valid)].sort((a, b) => LAUNCH_INDEX.get(a)! - LAUNCH_INDEX.get(b)!);
}
