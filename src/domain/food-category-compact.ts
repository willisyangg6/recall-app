/**
 * The compact seven-category DIAGNOSTIC mapping (Phase C5.3B-2).
 *
 * PREDECLARED before the final holdout was drawn, as the milestone requires:
 * if the eleven-category matcher fails its gates, the SAME frozen predictions
 * and the SAME frozen labels are mechanically merged through this mapping and
 * re-scored. Nothing may be relabeled or re-predicted after results are seen —
 * the mapping is pure arithmetic over category ids.
 *
 * This is the C5.3A compact alternative. It is a diagnostic, not the product
 * vocabulary: adopting it would be a founder decision, and until then the
 * frozen eleven-category vocabulary in food-category.ts stands.
 */

import type { FoodCategoryId } from './food-category';

export type CompactCategoryId =
  | 'produce'
  | 'meat_seafood'
  | 'dairy_eggs'
  | 'bakery_snacks'
  | 'prepared'
  | 'pantry_drinks'
  | 'baby_supplements';

export interface CompactCategory {
  id: CompactCategoryId;
  label: string;
}

/** The seven compact categories, in display order. */
export const COMPACT_CATEGORIES: readonly CompactCategory[] = [
  { id: 'produce', label: 'Produce' },
  { id: 'meat_seafood', label: 'Meat & seafood' },
  { id: 'prepared', label: 'Prepared meals' },
  { id: 'pantry_drinks', label: 'Pantry & drinks' },
  { id: 'bakery_snacks', label: 'Bakery & snacks' },
  { id: 'dairy_eggs', label: 'Dairy & eggs' },
  { id: 'baby_supplements', label: 'Baby food & supplements' },
] as const;

export const COMPACT_CATEGORY_IDS: readonly CompactCategoryId[] = COMPACT_CATEGORIES.map(
  (c) => c.id,
);

/**
 * The mechanical 11 → 7 merge. Total: every eleven-category id maps to exactly
 * one compact id, so no prediction and no label can be lost or reinterpreted.
 */
export const COMPACT_MAPPING: Readonly<Record<FoodCategoryId, CompactCategoryId>> = {
  produce: 'produce',
  meat_poultry: 'meat_seafood',
  seafood: 'meat_seafood',
  prepared: 'prepared',
  pantry: 'pantry_drinks',
  beverages: 'pantry_drinks',
  bakery: 'bakery_snacks',
  snacks_candy: 'bakery_snacks',
  dairy_eggs: 'dairy_eggs',
  supplements: 'baby_supplements',
  baby: 'baby_supplements',
} as const;

const COMPACT_INDEX = new Map<CompactCategoryId, number>(
  COMPACT_CATEGORIES.map((c, index) => [c.id, index]),
);

/**
 * Merge an eleven-category set into the compact vocabulary: map every id,
 * de-duplicate, and sort into compact display order. Deterministic and
 * argument-order independent.
 */
export function toCompactCategories(ids: readonly FoodCategoryId[]): CompactCategoryId[] {
  return [...new Set(ids.map((id) => COMPACT_MAPPING[id]))].sort(
    (a, b) => COMPACT_INDEX.get(a)! - COMPACT_INDEX.get(b)!,
  );
}
