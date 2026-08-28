/**
 * The predeclared compact seven-category diagnostic mapping (C5.3B-2).
 *
 * The mapping was declared BEFORE the final holdout was drawn and is covered
 * by the freeze manifest's hash of food-category-compact.ts. These tests pin
 * its content so a quiet edit is a loud diff in two places.
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

test('the compact vocabulary is the seven predeclared categories', () => {
  assert.deepEqual(COMPACT_CATEGORY_IDS, [
    'produce',
    'meat_seafood',
    'prepared',
    'pantry_drinks',
    'bakery_snacks',
    'dairy_eggs',
    'baby_supplements',
  ]);
  assert.equal(new Set(COMPACT_CATEGORIES.map((c) => c.label)).size, 7);
});

test('the mapping is exactly the predeclared merge', () => {
  assert.deepEqual(COMPACT_MAPPING, {
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
  });
});

test('the mapping is total: every eleven-category id maps to a compact id', () => {
  for (const id of FOOD_CATEGORY_IDS) {
    assert.ok(COMPACT_CATEGORY_IDS.includes(COMPACT_MAPPING[id]), id);
  }
});

test('merging de-duplicates, orders, and is deterministic', () => {
  assert.deepEqual(toCompactCategories(['seafood', 'meat_poultry']), ['meat_seafood']);
  assert.deepEqual(toCompactCategories(['beverages', 'produce', 'pantry']), [
    'produce',
    'pantry_drinks',
  ]);
  assert.deepEqual(
    toCompactCategories(['baby', 'bakery', 'snacks_candy']),
    toCompactCategories(['snacks_candy', 'baby', 'bakery']),
  );
  assert.deepEqual(toCompactCategories([]), []);
});
