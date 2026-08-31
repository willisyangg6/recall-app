/**
 * The frozen C10A product-category vocabulary.
 *
 * These tests guard the contract the rest of the system depends on: the ids
 * are closed and unique, the display order is stable, nothing may exceed the
 * per-case cap, and the derivation is TOTAL — every case carries at least one
 * category, with `other` as the honest remainder.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FOOD_CATEGORIES,
  FOOD_CATEGORY_IDS,
  foodCategory,
  foodCategoryLabel,
  isFoodCategoryId,
  MAX_CATEGORIES_PER_CASE,
  orderFoodCategories,
  type FoodCategoryId,
} from './food-category';

test('vocabulary is the twelve frozen categories, in the frozen order', () => {
  assert.deepEqual(FOOD_CATEGORY_IDS, [
    'produce',
    'meat_poultry',
    'seafood',
    'dairy_eggs',
    'prepared_foods',
    'bakery_grains',
    'snacks_sweets',
    'beverages',
    'pantry_condiments',
    'baby_food_formula',
    'supplements',
    'other',
  ]);
});

test('the vocabulary is closed: no synonym of "other" is a category', () => {
  assert.equal(isFoodCategoryId('other'), true);
  for (const forbidden of ['uncategorized', 'unknown', 'misc', 'general']) {
    assert.equal(isFoodCategoryId(forbidden), false, `${forbidden} must not be a category`);
  }
});

test('the two refined labels describe what the derivation actually does', () => {
  // Grain staples derive `pantry_condiments`, so the bakery label must not
  // promise grains and the pantry label must say staples.
  assert.equal(foodCategoryLabel('bakery_grains'), 'Bakery');
  assert.equal(foodCategoryLabel('pantry_condiments'), 'Pantry & staples');
});

test('ids are unique and labels are unique', () => {
  assert.equal(new Set(FOOD_CATEGORY_IDS).size, FOOD_CATEGORIES.length);
  assert.equal(new Set(FOOD_CATEGORIES.map((c) => c.label)).size, FOOD_CATEGORIES.length);
});

test('every category carries a non-empty label and definition', () => {
  for (const category of FOOD_CATEGORIES) {
    assert.notEqual(category.label.trim(), '', `${category.id} needs a label`);
    assert.notEqual(category.definition.trim(), '', `${category.id} needs a definition`);
    assert.notEqual(category.label, category.id, `${category.id} label must not be the raw id`);
  }
});

test('labels are separable from ids — a lookup, never a formatted id', () => {
  assert.equal(foodCategoryLabel('meat_poultry'), 'Meat & poultry');
  assert.equal(foodCategoryLabel('baby_food_formula'), 'Baby food & formula');
  assert.equal(foodCategory('seafood')?.definition.startsWith('Fish'), true);
});

test('ordering is display order, not input order', () => {
  assert.deepEqual(orderFoodCategories(['beverages', 'produce', 'prepared_foods']), [
    'produce',
    'prepared_foods',
    'beverages',
  ]);
  assert.deepEqual(orderFoodCategories(['prepared_foods', 'produce']), [
    'produce',
    'prepared_foods',
  ]);
});

test('ordering de-duplicates', () => {
  assert.deepEqual(orderFoodCategories(['produce', 'produce', 'produce']), ['produce']);
});

test('ordering drops values outside the closed vocabulary', () => {
  assert.deepEqual(
    orderFoodCategories(['produce', 'not_a_category' as FoodCategoryId, 'bakery_grains']),
    ['produce', 'bakery_grains'],
  );
});

test('the derivation is total: nothing in becomes exactly ["other"]', () => {
  assert.deepEqual(orderFoodCategories([]), ['other']);
  assert.deepEqual(orderFoodCategories(['not_a_category' as FoodCategoryId]), ['other']);
});

test('"other" never co-occurs with a real category', () => {
  assert.deepEqual(orderFoodCategories(['other', 'produce']), ['produce']);
  assert.deepEqual(orderFoodCategories(['produce', 'other']), ['produce']);
  assert.deepEqual(orderFoodCategories(['other']), ['other']);
});

test('ordering is idempotent — a fixed point, which re-projection depends on', () => {
  for (const input of [
    [] as FoodCategoryId[],
    ['other'] as FoodCategoryId[],
    ['produce', 'other'] as FoodCategoryId[],
    [...FOOD_CATEGORY_IDS],
  ]) {
    const once = orderFoodCategories(input);
    assert.deepEqual(orderFoodCategories(once), once);
  }
});

test('ordering enforces the maximum of four, keeping the earliest in display order', () => {
  const all = orderFoodCategories([...FOOD_CATEGORY_IDS]);
  assert.equal(all.length, MAX_CATEGORIES_PER_CASE);
  assert.deepEqual(all, ['produce', 'meat_poultry', 'seafood', 'dairy_eggs']);
});

test('ordering is stable across repeated calls', () => {
  const input: FoodCategoryId[] = ['seafood', 'bakery_grains', 'produce'];
  assert.deepEqual(orderFoodCategories(input), orderFoodCategories([...input].reverse()));
});
