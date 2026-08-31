/**
 * The predeclared compact diagnostic mapping (C5.3B-2, extended in C10A).
 *
 * The mapping was declared BEFORE the C5.3B-2 final holdout was drawn and is
 * covered by the freeze manifest's hash of food-category-compact.ts. These
 * tests pin its content so a quiet edit is a loud diff in two places.
 *
 * C10A renamed the source ids and added `other`, so the seven compact buckets
 * became eight. Compact ids are their own namespace: compact `prepared` is
 * not the product-category id `prepared_foods`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FOOD_CATEGORY_IDS } from './food-category';
import {
  COMPACT_CATEGORIES,
  COMPACT_CATEGORY_IDS,
  COMPACT_MAPPING,
  toCompactCategories,
} from './food-category-compact';

test('the compact vocabulary is the predeclared seven plus C10A other', () => {
  assert.deepEqual(COMPACT_CATEGORY_IDS, [
    'produce',
    'meat_seafood',
    'prepared',
    'pantry_drinks',
    'bakery_snacks',
    'dairy_eggs',
    'baby_supplements',
    'other',
  ]);
  assert.equal(new Set(COMPACT_CATEGORIES.map((c) => c.label)).size, 8);
});

test('the mapping is exactly the predeclared merge', () => {
  assert.deepEqual(COMPACT_MAPPING, {
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
  });
});

test('the mapping is total: every product-category id maps to a compact id', () => {
  for (const id of FOOD_CATEGORY_IDS) {
    assert.ok(COMPACT_CATEGORY_IDS.includes(COMPACT_MAPPING[id]), id);
  }
});

test('merging de-duplicates, orders, and is deterministic', () => {
  assert.deepEqual(toCompactCategories(['seafood', 'meat_poultry']), ['meat_seafood']);
  assert.deepEqual(toCompactCategories(['beverages', 'produce', 'pantry_condiments']), [
    'produce',
    'pantry_drinks',
  ]);
  assert.deepEqual(
    toCompactCategories(['baby_food_formula', 'bakery_grains', 'snacks_sweets']),
    toCompactCategories(['snacks_sweets', 'baby_food_formula', 'bakery_grains']),
  );
  assert.deepEqual(toCompactCategories([]), []);
  assert.deepEqual(toCompactCategories(['other']), ['other']);
});
