/**
 * The frozen v1 consumer food-category vocabulary (Phase C5.3B).
 *
 * These eleven categories answer one question — "what aisle is this?" — and
 * nothing else. They are chosen from a full audit of the 1,899-case corpus
 * (C5.3A, docs/recall-food-categories.md), not from agency taxonomy: a
 * shopper looking for a cheese recall does not think "FDA regulated dairy",
 * and FSIS's jurisdiction over meat says what is IN a product, never what the
 * product IS (28% of active FSIS notices are correctly Prepared meals or
 * Pantry staples).
 *
 * Three properties are deliberate and load-bearing:
 *
 * 1. IDs are stable and separate from labels. The id is persisted and
 *    filtered on; the label is a display string that may be reworded without
 *    a data migration. Nothing outside this file may hard-code a label.
 *
 * 2. There is no `Other` and no `Uncategorized`. A case the source does not
 *    describe well enough carries NO category — measured at 1.5% of active
 *    cases, and they split into two groups no single label honestly covers
 *    (products that are not food at all, and food whose name the reviewed
 *    lexicon does not know). An `Other` chip would promise a coherent group
 *    and deliver a junk drawer. Such cases stay fully visible whenever no
 *    Category filter is active; All Recalls never hides them.
 *
 * 3. The model is MULTI-LABEL, capped. A recall genuinely spanning categories
 *    ("Chicken and Pork Tamales") must be findable under each — but a
 *    category may only come from a recalled PRODUCT, never from an
 *    ingredient, flavor, allergen, brand, retailer, firm or hazard.
 */

/** Stable, persisted category identifier. Never render this to a consumer. */
export type FoodCategoryId =
  | 'produce'
  | 'meat_poultry'
  | 'prepared'
  | 'pantry'
  | 'bakery'
  | 'snacks_candy'
  | 'dairy_eggs'
  | 'seafood'
  | 'supplements'
  | 'baby'
  | 'beverages';

export interface FoodCategory {
  id: FoodCategoryId;
  /** Consumer-facing label. Editable without touching persisted data. */
  label: string;
  /** Plain-language scope, as frozen by the C5.3A audit. */
  definition: string;
}

/**
 * The closed vocabulary, in DISPLAY ORDER. Every consumer surface and every
 * matcher output orders categories by this array's index, so a case's
 * categories read the same everywhere and renders never reshuffle.
 *
 * The order is by how often a shopper is likely to want the filter, which the
 * corpus counts approximate: Produce, Meat & poultry, Prepared meals and
 * Pantry staples are the four large categories; Supplements, Baby food and
 * Drinks are small but high-salience, so they sit last rather than being
 * dropped.
 */
export const FOOD_CATEGORIES: readonly FoodCategory[] = [
  {
    id: 'produce',
    label: 'Produce',
    definition:
      'Fresh, frozen, or dried fruits, vegetables, mushrooms, sprouts, and salad components.',
  },
  {
    id: 'meat_poultry',
    label: 'Meat & poultry',
    definition: 'Beef, pork, chicken, turkey, lamb, deli meats, and jerky sold as meat products.',
  },
  {
    id: 'prepared',
    label: 'Prepared meals',
    definition:
      'Entrées, pizzas, sandwiches, soups, prepared salads, tamales, and other ready-to-eat or ready-to-heat dishes.',
  },
  {
    id: 'pantry',
    label: 'Pantry staples',
    definition:
      'Flour, grains, pasta, rice, cereal, sauces, spices, oils, nuts, seeds, and similar pantry products.',
  },
  {
    id: 'bakery',
    label: 'Bakery',
    definition: 'Bread, tortillas, cakes, cookies, pastries, and dough.',
  },
  {
    id: 'snacks_candy',
    label: 'Snacks & candy',
    definition: 'Chips, popcorn, chocolate, candy, snack bars, and similar snack products.',
  },
  {
    id: 'dairy_eggs',
    label: 'Dairy & eggs',
    definition: 'Milk, cheese, yogurt, butter, ice cream, and eggs.',
  },
  {
    id: 'seafood',
    label: 'Seafood',
    definition: 'Fish, shrimp, shellfish, and other seafood products.',
  },
  {
    id: 'supplements',
    label: 'Supplements',
    definition: 'Vitamins, capsules, powders, herbal supplements, and supplement products.',
  },
  {
    id: 'baby',
    label: 'Baby food & formula',
    definition:
      'Infant formula, baby food, and products explicitly sold as infant/baby feeding products.',
  },
  {
    id: 'beverages',
    label: 'Drinks',
    definition: 'Juice, soda, coffee, tea, drink mixes, and other beverages.',
  },
] as const;

/** Category ids in display order. */
export const FOOD_CATEGORY_IDS: readonly FoodCategoryId[] = FOOD_CATEGORIES.map((c) => c.id);

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
 * Canonical output form: de-duplicated, sorted into display order, capped at
 * MAX_CATEGORIES_PER_CASE. Every producer of category lists ends here, so
 * ordering can never depend on the order matches happened to be found.
 */
export function orderFoodCategories(ids: readonly FoodCategoryId[]): FoodCategoryId[] {
  return [...new Set(ids)]
    .filter(isFoodCategoryId)
    .sort((a, b) => DISPLAY_INDEX.get(a)! - DISPLAY_INDEX.get(b)!)
    .slice(0, MAX_CATEGORIES_PER_CASE);
}
