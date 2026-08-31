/**
 * The client-safe stored-category reader, and its EQUIVALENCE to the
 * server-side one (C10B).
 *
 * Two functions read `projection.productCategories`: `readProductCategories`
 * in `domain/projection.ts` (server: backfill, QA, store) and
 * `readStoredProductCategories` here (universal: the feed loader). They exist
 * separately so the app does not bundle the classifier — see the module
 * comment — and duplication that nothing checks is how two truths start.
 *
 * So the equivalence is checked, exhaustively, over every shape the column can
 * hold: the same pattern the freeze manifest already uses for `predict` vs
 * `deriveProductCategories`. If someone changes one reader, this fails.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FOOD_CATEGORY_IDS, MAX_CATEGORIES_PER_CASE } from './food-category';
import { readProductCategories } from './projection';
import type { CaseProjection } from './recall-types';
import { readStoredProductCategories } from './product-categories-stored';

/** Every shape a jsonb column can actually present. */
const CASES: unknown[] = [
  undefined,
  null,
  [],
  {},
  0,
  '',
  'produce',
  true,
  ['produce'],
  ['other'],
  ['other', 'produce'],
  ['produce', 'other'],
  ['seafood', 'produce'],
  ['produce', 'produce'],
  ['baby_food_formula', 'produce', 'seafood'],
  ['not_a_category'],
  ['not_a_category', 'seafood'],
  [null, 'seafood'],
  [17, {}, [], 'dairy_eggs'],
  [['produce']],
  [...FOOD_CATEGORY_IDS],
  [...FOOD_CATEGORY_IDS].reverse(),
  Array.from({ length: MAX_CATEGORIES_PER_CASE + 3 }, () => 'produce'),
  FOOD_CATEGORY_IDS.slice(0, MAX_CATEGORIES_PER_CASE + 2),
];

test('the two readers agree on every shape the column can hold', () => {
  for (const value of CASES) {
    const viaProjection = readProductCategories({
      productCategories: value,
    } as unknown as CaseProjection);
    const viaLeaf = readStoredProductCategories(value);
    assert.deepEqual(viaLeaf, viaProjection, `disagreement on ${JSON.stringify(value)}`);
  }
});

test('the equivalence is not vacuous — the cases cover null, other, and repair', () => {
  // Guards against a future edit that quietly empties CASES or makes every
  // input return null.
  const results = CASES.map(readStoredProductCategories);
  assert.ok(
    results.some((r) => r === null),
    'no null case',
  );
  assert.ok(
    results.some((r) => r?.join() === 'other'),
    'no other-only case',
  );
  assert.ok(
    results.some((r) => (r?.length ?? 0) > 1),
    'no multi-category case',
  );
  assert.ok(
    results.some((r, i) => r !== null && JSON.stringify(r) !== JSON.stringify(CASES[i])),
    'no case where the reader actually repaired the value',
  );
});

// ── The behaviours the filter depends on, stated directly ───────────────────

test('nothing stored reads as null, in all four of its forms', () => {
  assert.equal(readStoredProductCategories(undefined), null);
  assert.equal(readStoredProductCategories(null), null);
  assert.equal(readStoredProductCategories([]), null);
  assert.equal(readStoredProductCategories(['nope', 'also_nope']), null);
});

test('null is never Other, and Other is never null', () => {
  assert.equal(readStoredProductCategories(undefined), null);
  assert.deepEqual(readStoredProductCategories(['other']), ['other']);
});

test('a valid list is repaired into canonical form', () => {
  assert.deepEqual(readStoredProductCategories(['seafood', 'produce']), ['produce', 'seafood']);
  assert.deepEqual(readStoredProductCategories(['produce', 'produce']), ['produce']);
  assert.deepEqual(readStoredProductCategories(['other', 'produce']), ['produce']);
  assert.deepEqual(readStoredProductCategories(['produce', 'frozen_foods_v2']), ['produce']);
});

test('the result is capped and idempotent', () => {
  const long = readStoredProductCategories([...FOOD_CATEGORY_IDS])!;
  assert.ok(long.length <= MAX_CATEGORIES_PER_CASE);
  assert.deepEqual(readStoredProductCategories(long), long);
});

test('the module is a leaf — it cannot drag the classifier into the app bundle', async () => {
  // The bundling guarantee as a unit test, so a future import is caught here
  // rather than in an export scan someone forgot to run. `food-category.ts`
  // has no imports of its own, so this module's whole graph is the vocabulary.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./product-categories-stored.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports, ['./food-category']);
});
