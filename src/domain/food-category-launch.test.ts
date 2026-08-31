/**
 * The launch-visible Category allowlist (C10B).
 *
 * These tests are the product decision, written down where it cannot drift:
 * WHICH aisles the filter offers, in WHAT order, and — the part that actually
 * protects a user — that the three hidden ids stay fully valid internally
 * while being unreachable from any selection path.
 *
 * The distinction matters because hiding and deleting look the same from the
 * chip row and are opposites in the data. A deleted id would strand every case
 * carrying it; a hidden one keeps its cases stored, backfilled, QA'd and
 * reachable through the unfiltered feed, and can be offered later by removing
 * one line.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FOOD_CATEGORY_IDS,
  foodCategoryLabel,
  isFoodCategoryId,
  orderFoodCategories,
  type FoodCategoryId,
} from './food-category';
import {
  HIDDEN_LAUNCH_CATEGORY_IDS,
  isLaunchCategoryId,
  LAUNCH_CATEGORY_IDS,
  LAUNCH_CATEGORY_OPTIONS,
  sanitizeLaunchCategoryIds,
} from './food-category-launch';

// ── The allowlist itself ────────────────────────────────────────────────────

test('exactly nine categories are launch-visible', () => {
  assert.equal(LAUNCH_CATEGORY_IDS.length, 9);
});

test('the launch allowlist is pinned, ids and order', () => {
  // Canonical display order (domain/food-category.ts), minus the hidden three.
  assert.deepEqual(
    [...LAUNCH_CATEGORY_IDS],
    [
      'produce',
      'meat_poultry',
      'seafood',
      'dairy_eggs',
      'bakery_grains',
      'snacks_sweets',
      'beverages',
      'pantry_condiments',
      'baby_food_formula',
    ],
  );
});

test('the sheet options are pinned, labels and order', () => {
  assert.deepEqual(
    LAUNCH_CATEGORY_OPTIONS.map((option) => [option.value, option.label]),
    [
      ['produce', 'Fruits & vegetables'],
      ['meat_poultry', 'Meat & poultry'],
      ['seafood', 'Seafood'],
      ['dairy_eggs', 'Dairy & eggs'],
      ['bakery_grains', 'Bakery'],
      ['snacks_sweets', 'Snacks & sweets'],
      ['beverages', 'Beverages'],
      ['pantry_condiments', 'Pantry & staples'],
      ['baby_food_formula', 'Baby food & formula'],
    ],
  );
});

test('labels are the vocabulary’s own — no launch-only wording', () => {
  for (const option of LAUNCH_CATEGORY_OPTIONS) {
    assert.equal(option.label, foodCategoryLabel(option.value as FoodCategoryId));
  }
});

test('the launch order is the canonical display order, not a second sequence', () => {
  const canonical = FOOD_CATEGORY_IDS.filter((id) => LAUNCH_CATEGORY_IDS.includes(id));
  assert.deepEqual([...LAUNCH_CATEGORY_IDS], canonical);
});

// ── The hidden three ────────────────────────────────────────────────────────

test('Prepared foods, Supplements and Other are hidden from the filter', () => {
  assert.deepEqual([...HIDDEN_LAUNCH_CATEGORY_IDS], ['prepared_foods', 'supplements', 'other']);
  for (const id of HIDDEN_LAUNCH_CATEGORY_IDS) {
    assert.equal(LAUNCH_CATEGORY_IDS.includes(id), false, id);
    assert.equal(isLaunchCategoryId(id), false, id);
  }
});

test('hidden ids remain fully valid internal categories', () => {
  // Hidden ≠ deleted: a stored projection carrying one still reads, still
  // orders, and still keeps its label.
  for (const id of HIDDEN_LAUNCH_CATEGORY_IDS) {
    assert.equal(isFoodCategoryId(id), true, id);
    assert.equal(FOOD_CATEGORY_IDS.includes(id), true, id);
    assert.notEqual(foodCategoryLabel(id), id, id);
  }
  assert.deepEqual(orderFoodCategories(['prepared_foods']), ['prepared_foods']);
  assert.deepEqual(orderFoodCategories(['supplements']), ['supplements']);
  assert.deepEqual(orderFoodCategories([]), ['other']);
});

test('every vocabulary id is either offered or explicitly hidden — never neither', () => {
  for (const id of FOOD_CATEGORY_IDS) {
    const offered = LAUNCH_CATEGORY_IDS.includes(id);
    const hidden = HIDDEN_LAUNCH_CATEGORY_IDS.includes(id);
    assert.equal(offered !== hidden, true, `${id} is ${offered ? 'both' : 'neither'}`);
  }
  assert.equal(LAUNCH_CATEGORY_IDS.length + HIDDEN_LAUNCH_CATEGORY_IDS.length, 12);
});

// ── The sanitizer: the one door into filter state ───────────────────────────

test('a hidden id cannot be selected through any path', () => {
  assert.deepEqual(sanitizeLaunchCategoryIds(['prepared_foods']), []);
  assert.deepEqual(sanitizeLaunchCategoryIds(['supplements', 'other']), []);
  // …and it cannot ride along beside a legitimate one.
  assert.deepEqual(sanitizeLaunchCategoryIds(['seafood', 'other', 'prepared_foods']), ['seafood']);
});

test('unknown, removed and malformed ids are discarded', () => {
  assert.deepEqual(sanitizeLaunchCategoryIds(['not_a_category']), []);
  assert.deepEqual(sanitizeLaunchCategoryIds(['frozen_foods_v2', 'seafood']), ['seafood']);
  assert.deepEqual(sanitizeLaunchCategoryIds([null, 42, {}, [], undefined, 'produce']), [
    'produce',
  ]);
  assert.deepEqual(sanitizeLaunchCategoryIds(['PRODUCE', ' produce ']), []);
});

test('a non-array is no selection at all, never a crash', () => {
  for (const value of [undefined, null, 'produce', 7, {}, { categoryIds: ['produce'] }]) {
    assert.deepEqual(sanitizeLaunchCategoryIds(value), []);
  }
});

test('duplicates collapse and the result is in canonical display order', () => {
  assert.deepEqual(sanitizeLaunchCategoryIds(['seafood', 'seafood', 'seafood']), ['seafood']);
  assert.deepEqual(sanitizeLaunchCategoryIds(['baby_food_formula', 'produce', 'seafood']), [
    'produce',
    'seafood',
    'baby_food_formula',
  ]);
  assert.deepEqual(sanitizeLaunchCategoryIds(['pantry_condiments', 'beverages']), [
    'beverages',
    'pantry_condiments',
  ]);
});

test('an empty selection stays empty — it is never turned into Other', () => {
  // The contrast that matters: `orderFoodCategories` maps [] to ['other']
  // because every stored CASE must carry a category. An empty SELECTION means
  // "no category restriction", and inventing a filter here would silently hide
  // most of the feed.
  assert.deepEqual(sanitizeLaunchCategoryIds([]), []);
  assert.deepEqual(orderFoodCategories([]), ['other']);
});

test('sanitizing is idempotent', () => {
  const once = sanitizeLaunchCategoryIds(['snacks_sweets', 'produce', 'other', 'produce']);
  assert.deepEqual(sanitizeLaunchCategoryIds(once), once);
});

test('every offered id survives its own sanitization', () => {
  assert.deepEqual(sanitizeLaunchCategoryIds([...LAUNCH_CATEGORY_IDS]), [...LAUNCH_CATEGORY_IDS]);
});
