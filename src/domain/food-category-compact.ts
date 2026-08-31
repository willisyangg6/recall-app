/**
 * The compact DIAGNOSTIC mapping (Phase C5.3B-2) — a CLOSED experiment.
 *
 * PREDECLARED before the C5.3B-2 final holdout was drawn: if the fine-grained
 * matcher failed its gates, the SAME frozen predictions and the SAME frozen
 * labels were mechanically merged through this mapping and re-scored, so a
 * coarser vocabulary could not be proposed after seeing which errors it would
 * have forgiven. It was measured and it answered its question — the merge
 * bought +0.5pp in C5.3B-2 and +1.0pp on C10A's challenge split, because the
 * dominant confusion (Prepared vs Meat & poultry) does not merge away. A
 * coarser vocabulary was therefore NOT recommended, and C10A froze the full
 * twelve-category vocabulary instead.
 *
 * It is kept as the record of that experiment and as regression coverage for
 * the merge arithmetic. Two things changed mechanically in C10A and neither
 * touches the recorded result: the source ids were renamed, and `other`
 * joined the vocabulary, so the seven compact buckets became eight. The
 * compact ids are their OWN namespace — compact `prepared` is not the
 * product-category id `prepared_foods`.
 */

import type { FoodCategoryId } from './food-category';

export type CompactCategoryId =
  | 'produce'
  | 'meat_seafood'
  | 'dairy_eggs'
  | 'bakery_snacks'
  | 'prepared'
  | 'pantry_drinks'
  | 'baby_supplements'
  | 'other';

export interface CompactCategory {
  id: CompactCategoryId;
  label: string;
}

/** The compact categories, in display order. `other` is the C10A addition. */
export const COMPACT_CATEGORIES: readonly CompactCategory[] = [
  { id: 'produce', label: 'Produce' },
  { id: 'meat_seafood', label: 'Meat & seafood' },
  { id: 'prepared', label: 'Prepared meals' },
  { id: 'pantry_drinks', label: 'Pantry & drinks' },
  { id: 'bakery_snacks', label: 'Bakery & snacks' },
  { id: 'dairy_eggs', label: 'Dairy & eggs' },
  { id: 'baby_supplements', label: 'Baby food & supplements' },
  { id: 'other', label: 'Other' },
] as const;

export const COMPACT_CATEGORY_IDS: readonly CompactCategoryId[] = COMPACT_CATEGORIES.map(
  (c) => c.id,
);

/**
 * The mechanical 12 → 8 merge. Total: every product-category id maps to
 * exactly one compact id, so no prediction and no label can be lost or
 * reinterpreted. `other` merges to itself — a product the source never named
 * does not become nameable by coarsening the vocabulary.
 */
export const COMPACT_MAPPING: Readonly<Record<FoodCategoryId, CompactCategoryId>> = {
  produce: 'produce',
  meat_poultry: 'meat_seafood',
  seafood: 'meat_seafood',
  prepared_foods: 'prepared',
  pantry_condiments: 'pantry_drinks',
  beverages: 'pantry_drinks',
  bakery_grains: 'bakery_snacks',
  snacks_sweets: 'bakery_snacks',
  dairy_eggs: 'dairy_eggs',
  supplements: 'baby_supplements',
  baby_food_formula: 'baby_supplements',
  other: 'other',
} as const;

const COMPACT_INDEX = new Map<CompactCategoryId, number>(
  COMPACT_CATEGORIES.map((c, index) => [c.id, index]),
);

/**
 * Merge a product-category set into the compact vocabulary: map every id,
 * de-duplicate, and sort into compact display order. Deterministic and
 * argument-order independent.
 */
export function toCompactCategories(ids: readonly FoodCategoryId[]): CompactCategoryId[] {
  return [...new Set(ids.map((id) => COMPACT_MAPPING[id]))].sort(
    (a, b) => COMPACT_INDEX.get(a)! - COMPACT_INDEX.get(b)!,
  );
}
