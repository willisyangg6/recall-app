/**
 * The frozen v1 food-category vocabulary (C5.3B).
 *
 * These tests guard the contract the rest of the system depends on: the ids
 * are closed and unique, the display order is stable, and nothing may exceed
 * the per-case cap.
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

test('vocabulary is the eleven frozen categories, in the frozen order', () => {
  assert.deepEqual(FOOD_CATEGORY_IDS, [
    'produce',
    'meat_poultry',
    'prepared',
    'pantry',
    'bakery',
    'snacks_candy',
    'dairy_eggs',
    'seafood',
    'supplements',
    'baby',
    'beverages',
  ]);
});

test('there is no Other and no Uncategorized category', () => {
  for (const forbidden of ['other', 'uncategorized', 'unknown', 'misc']) {
    assert.equal(isFoodCategoryId(forbidden), false, `${forbidden} must not be a category`);
  }
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
  assert.equal(foodCategoryLabel('baby'), 'Baby food & formula');
  assert.equal(foodCategory('seafood')?.definition.startsWith('Fish'), true);
});

test('ordering is display order, not input order', () => {
  assert.deepEqual(orderFoodCategories(['beverages', 'produce', 'prepared']), [
    'produce',
    'prepared',
    'beverages',
  ]);
  assert.deepEqual(orderFoodCategories(['prepared', 'produce']), ['produce', 'prepared']);
});

test('ordering de-duplicates', () => {
  assert.deepEqual(orderFoodCategories(['produce', 'produce', 'produce']), ['produce']);
});

test('ordering drops values outside the closed vocabulary', () => {
  assert.deepEqual(orderFoodCategories(['produce', 'other' as FoodCategoryId, 'bakery']), [
    'produce',
    'bakery',
  ]);
});

test('ordering enforces the maximum of four, keeping the earliest in display order', () => {
  const all = orderFoodCategories([...FOOD_CATEGORY_IDS]);
  assert.equal(all.length, MAX_CATEGORIES_PER_CASE);
  assert.deepEqual(all, ['produce', 'meat_poultry', 'prepared', 'pantry']);
});

test('ordering is stable across repeated calls', () => {
  const input: FoodCategoryId[] = ['seafood', 'bakery', 'produce'];
  assert.deepEqual(orderFoodCategories(input), orderFoodCategories([...input].reverse()));
});
