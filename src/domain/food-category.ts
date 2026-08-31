/**
 * The closed consumer product-category vocabulary (Phase C10A).
 *
 * These twelve categories answer one question — "what KIND of product was
 * recalled?" — and nothing else. They are the frozen C10A vocabulary, refined
 * from the eleven-category v1 audited in C5.3A/C5.3B-2
 * (docs/recall-food-categories.md) by adding an explicit `other` and by
 * renaming ids and labels to consumer wording.
 *
 * ## Product category is NOT hazard category
 *
 * `CaseProjection.hazardCategory` says WHY a notice exists (allergen,
 * pathogen, foreign material). This says WHAT was recalled. They are
 * independent, and conflating them is the single most damaging error this
 * module exists to prevent: undeclared milk in a potato chip is a
 * Snacks & sweets recall, never a Dairy & eggs one. The derivation's input
 * type (`CategoryCaseInput`) structurally cannot accept a hazard, an
 * allergen, a pathogen, a recalling firm, a brand, or a retailer.
 *
 * ## Four properties are deliberate and load-bearing
 *
 * 1. IDs are stable and separate from labels. The id is persisted and
 *    filtered on; the label is a display string that may be reworded without
 *    a data migration. Nothing outside this file may hard-code a label.
 *
 * 2. `other` is a real member of the vocabulary, and the derivation is TOTAL:
 *    every case carries at least one category. C5.3B-2 deliberately emitted
 *    NO category for a product the source does not describe well enough, on
 *    the argument that an `Other` chip promises a coherent group and delivers
 *    a junk drawer. C10A reverses that, and the corpus supports the reversal:
 *    measured over all 1,914 stored cases, only 0.9% land here. At that rate
 *    `other` is a small honest remainder, not a drawer — and totality is what
 *    lets a future Category filter promise complete coverage of All Recalls.
 *
 * 3. `other` NEVER co-occurs with a real category. It means "we could not
 *    honestly name this product's aisle", which is false the moment we could.
 *
 * 4. The model is MULTI-LABEL, capped. A recall genuinely spanning categories
 *    ("Frozen Waffle and Turkey Sausage Products") must be findable under
 *    each — but a category may only come from a recalled PRODUCT, never from
 *    an ingredient, flavour, allergen, brand, retailer, firm or hazard.
 */

/** Stable, persisted category identifier. Never render this to a consumer. */
export type FoodCategoryId =
  | 'produce'
  | 'meat_poultry'
  | 'seafood'
  | 'dairy_eggs'
  | 'prepared_foods'
  | 'bakery_grains'
  | 'snacks_sweets'
  | 'beverages'
  | 'pantry_condiments'
  | 'baby_food_formula'
  | 'supplements'
  | 'other';

export interface FoodCategory {
  id: FoodCategoryId;
  /** Consumer-facing label. Editable without touching persisted data. */
  label: string;
  /** Plain-language scope, as frozen by the C5.3A audit and C10A refinement. */
  definition: string;
}

/**
 * The closed vocabulary, in DISPLAY ORDER. Every consumer surface and every
 * derivation output orders categories by this array's index, so a case's
 * categories read the same everywhere and renders never reshuffle.
 *
 * `other` sits last because it is the absence of an answer, not an aisle.
 */
export const FOOD_CATEGORIES: readonly FoodCategory[] = [
  {
    id: 'produce',
    label: 'Fruits & vegetables',
    definition:
      'Fresh, frozen, or dried fruits, vegetables, mushrooms, sprouts, and salad components.',
  },
  {
    id: 'meat_poultry',
    label: 'Meat & poultry',
    definition: 'Beef, pork, chicken, turkey, lamb, deli meats, and jerky sold as meat products.',
  },
  {
    id: 'seafood',
    label: 'Seafood',
    definition: 'Fish, shrimp, shellfish, and other seafood products.',
  },
  {
    id: 'dairy_eggs',
    label: 'Dairy & eggs',
    definition: 'Milk, cheese, yogurt, butter, ice cream, and eggs.',
  },
  {
    id: 'prepared_foods',
    label: 'Prepared foods',
    definition:
      'Entrées, pizzas, sandwiches, soups, prepared salads, tamales, and other ready-to-eat or ready-to-heat dishes.',
  },
  {
    id: 'bakery_grains',
    /**
     * Labelled "Bakery", not "Bakery & grains": the derivation files flour,
     * rice, pasta and cereal under `pantry_condiments`, and a label naming
     * grains here would send a shopper looking for a flour recall to the
     * wrong chip. The id keeps its C10A spelling — this is a label
     * clarification, not a taxonomy migration.
     */
    label: 'Bakery',
    definition: 'Bread, tortillas, cakes, cookies, pastries, and dough.',
  },
  {
    id: 'snacks_sweets',
    label: 'Snacks & sweets',
    definition: 'Chips, popcorn, chocolate, candy, snack bars, and similar snack products.',
  },
  {
    id: 'beverages',
    label: 'Beverages',
    definition: 'Juice, soda, coffee, tea, drink mixes, and other beverages.',
  },
  {
    id: 'pantry_condiments',
    /** See `bakery_grains`: grain staples live here, so the label says staples. */
    label: 'Pantry & staples',
    definition:
      'Flour, grains, pasta, rice, cereal, sauces, spices, oils, nuts, seeds, and similar pantry products.',
  },
  {
    id: 'baby_food_formula',
    label: 'Baby food & formula',
    definition:
      'Infant formula, baby food, and products explicitly sold as infant/baby feeding products.',
  },
  {
    id: 'supplements',
    label: 'Supplements',
    definition: 'Vitamins, capsules, powders, herbal supplements, and supplement products.',
  },
  {
    id: 'other',
    label: 'Other',
    definition:
      'A recalled product this app cannot honestly place in an aisle — a non-food item, or a notice whose source text never names the product. Never a guess, and never combined with a real category.',
  },
] as const;

/** Category ids in display order. */
export const FOOD_CATEGORY_IDS: readonly FoodCategoryId[] = FOOD_CATEGORIES.map((c) => c.id);

/**
 * The id every case falls back to. Exported so no caller has to spell the
 * string, and so the fallback is greppable.
 */
export const FALLBACK_CATEGORY_ID: FoodCategoryId = 'other';

const DISPLAY_INDEX = new Map<FoodCategoryId, number>(
  FOOD_CATEGORIES.map((c, index) => [c.id, index]),
);

const BY_ID = new Map<FoodCategoryId, FoodCategory>(FOOD_CATEGORIES.map((c) => [c.id, c]));

/**
 * The most categories one case may carry.
 *
 * Four is the maximum observed across the whole corpus for a genuinely
 * multi-category recall, and it is a cap rather than a target: a case that
 * would exceed it is describing a product list too heterogeneous for a
 * category filter to help with, and truncating is more honest than showing a
 * card under every chip. Enforcement keeps the highest-display-order
 * categories, which are the broad, most-likely-intended ones.
 */
export const MAX_CATEGORIES_PER_CASE = 4;

export function isFoodCategoryId(value: string): value is FoodCategoryId {
  return DISPLAY_INDEX.has(value as FoodCategoryId);
}

export function foodCategory(id: FoodCategoryId): FoodCategory | undefined {
  return BY_ID.get(id);
}

/** Consumer label for an id; the raw id if it is somehow unknown. */
export function foodCategoryLabel(id: FoodCategoryId): string {
  return BY_ID.get(id)?.label ?? id;
}

/**
 * Canonical output form, and the ONLY way a category list is allowed to be
 * built. Every producer ends here, so ordering can never depend on the order
 * matches happened to be found, and no caller can invent a shape the filter
 * has to defend against:
 *
 *   1. unknown ids are dropped (a persisted id from a future vocabulary must
 *      not crash a reader running older code);
 *   2. duplicates collapse;
 *   3. `other` is dropped whenever a real category survives — "we could not
 *      name this" is false as soon as we could;
 *   4. the result is sorted into display order and capped;
 *   5. an empty result becomes `['other']`, which is what makes the
 *      derivation TOTAL: every case carries at least one category.
 *
 * Idempotent by construction: feeding the output back in returns it
 * unchanged, which is the fixed point re-projection depends on.
 */
export function orderFoodCategories(ids: readonly FoodCategoryId[]): FoodCategoryId[] {
  const valid = [...new Set(ids)].filter(isFoodCategoryId);
  const real = valid.filter((id) => id !== FALLBACK_CATEGORY_ID);
  if (real.length === 0) return [FALLBACK_CATEGORY_ID];
  return real
    .sort((a, b) => DISPLAY_INDEX.get(a)! - DISPLAY_INDEX.get(b)!)
    .slice(0, MAX_CATEGORIES_PER_CASE);
}

/**
 * Validate a list read back from storage. Returns the canonical form, so a
 * projection persisted before this field existed (`undefined`), one written
 * by older code, or one hand-edited in the database all read as something the
 * filter can trust.
 */
export function normalizeStoredCategories(value: unknown): FoodCategoryId[] {
  if (!Array.isArray(value)) return [FALLBACK_CATEGORY_ID];
  return orderFoodCategories(
    value.filter((v): v is string => typeof v === 'string').filter(isFoodCategoryId),
  );
}
