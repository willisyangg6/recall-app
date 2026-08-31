/**
 * Product categories inside the canonical projection (C10A).
 *
 * These tests guard the INTEGRATION, not the classifier's accuracy — that is
 * measured once against the frozen holdout by `npm run qa:categories`. What
 * matters here is that categories are derived by exactly one function, that
 * they reach the projection, that they are inert everywhere a consumer's
 * safety depends on the answer, and that a projection written before the
 * field existed still reads.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FOOD_CATEGORY_IDS, MAX_CATEGORIES_PER_CASE, type FoodCategoryId } from './food-category';
import { deriveProductCategories, projectCase, readProductCategories } from './projection';
import { detectChanges } from './material-change';
import type { CaseProjection, NoticeType, SourceAgency } from './recall-types';
import type { NormalizedSourceRecord } from './source-record';

function record(overrides: Partial<NormalizedSourceRecord> = {}): NormalizedSourceRecord {
  return {
    sourceSystem: 'fda_announcement',
    sourceAgency: 'FDA' as SourceAgency,
    noticeType: 'recall' as NoticeType,
    nativeId: 'example-recall',
    rawNativeId: 'example-recall',
    officialUrl: 'https://www.fda.gov/example-recall',
    title: 'Example Firm Recalls Chocolate Chip Cookies',
    summaryText: 'Example Firm is recalling cookies.',
    summaryHtml: null,
    reasonText: 'Undeclared shellfish',
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'shellfish',
    firmDisplayName: 'Example Firm',
    firmRawVariants: ['Example Firm'],
    brands: [],
    productDescription: 'Chocolate Chip Cookies',
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'unknown', states: [], confidence: 'stated', sourceText: null },
    productLines: [],
    quantityText: null,
    illnessStatement: null,
    consumerAction: null,
    contactText: null,
    lifecycle: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    publishedAt: '2026-08-01',
    lastModifiedAt: '2026-08-01',
    isRetractionNotice: false,
    ...overrides,
  } as NormalizedSourceRecord;
}

// ── The projection carries categories ───────────────────────────────────────

test('projectCase derives product categories into the projection', () => {
  const projection = projectCase([record()]);
  assert.deepEqual(projection.productCategories, ['bakery_grains']);
});

test('re-projecting the same records is a fixed point', () => {
  const once = projectCase([record()]);
  const twice = projectCase([record()]);
  assert.deepEqual(once.productCategories, twice.productCategories);
  // And re-deriving from the finished projection agrees with projectCase.
  assert.deepEqual(
    deriveProductCategories({
      sourceAgency: once.sourceAgency,
      title: once.title,
      productDescription: once.productDescription,
      affectedProducts: once.affectedProducts,
    }),
    once.productCategories,
  );
});

test('FDA and FSIS agree when the product text is the same', () => {
  const fda = projectCase([record({ productDescription: 'Ground Beef Products' })]);
  const fsis = projectCase([
    record({
      sourceSystem: 'fsis_api',
      sourceAgency: 'FSIS',
      productDescription: null,
      title: 'A Firm Recalls Ground Beef Products Due to Possible Contamination',
    }),
  ]);
  assert.deepEqual(fda.productCategories, fsis.productCategories);
  assert.deepEqual(fda.productCategories, ['meat_poultry']);
});

test('every projected case carries at least one category, and it is canonical', () => {
  for (const description of [
    'Chocolate Chip Cookies',
    'Metal Cookware Items',
    '',
    'Cucumbers and salads with kit',
  ]) {
    const projection = projectCase([record({ productDescription: description || null })]);
    const categories = projection.productCategories!;
    assert.ok(categories.length >= 1, description);
    assert.ok(categories.length <= MAX_CATEGORIES_PER_CASE, description);
    assert.equal(new Set(categories).size, categories.length, description);
    for (const id of categories) assert.ok(FOOD_CATEGORY_IDS.includes(id), id);
    const ordered = [...categories].sort(
      (a, b) => FOOD_CATEGORY_IDS.indexOf(a) - FOOD_CATEGORY_IDS.indexOf(b),
    );
    assert.deepEqual(categories, ordered, description);
    if (categories.includes('other')) assert.equal(categories.length, 1, description);
  }
});

// ── The derivation cannot see why the recall happened ───────────────────────

test('the hazard, allergen, firm and retailer never change the category', () => {
  const base = record({ productDescription: 'Potato Chips' });
  const plain = projectCase([base]);
  const loaded = projectCase([
    record({
      productDescription: 'Potato Chips',
      title: 'Dairy Barn Issues Allergy Alert on Undeclared MILK in Potato Chips',
      reasonText: 'Undeclared milk',
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'milk',
      firmDisplayName: 'Dairy Barn Creamery',
      firmRawVariants: ['Dairy Barn Creamery'],
      retailerNames: ['Dairy Barn'],
    }),
  ]);
  assert.deepEqual(plain.productCategories, ['snacks_sweets']);
  assert.deepEqual(loaded.productCategories, ['snacks_sweets']);
});

test('undeclared wheat does not make a product Bakery', () => {
  const projection = projectCase([
    record({
      productDescription: 'Soy Sauce',
      title: 'A Firm Issues Allergy Alert on Undeclared WHEAT in Soy Sauce',
      reasonText: 'Undeclared wheat',
      pathogenOrAllergen: 'wheat',
    }),
  ]);
  assert.deepEqual(projection.productCategories, ['pantry_condiments']);
});

test('a pathogen name never becomes a category', () => {
  const projection = projectCase([
    record({
      productDescription: 'Cucumbers',
      title: 'A Firm Recalls Cucumbers Due to Possible Salmonella Contamination',
      reasonText: 'Salmonella',
      hazardCategory: 'microbial_contamination',
      pathogenOrAllergen: 'salmonella',
    }),
  ]);
  assert.deepEqual(projection.productCategories, ['produce']);
});

test('a structured product name beats a misleading title', () => {
  const projection = projectCase([
    record({
      title: 'Ocean Fish Company Recalls Products Due to Undeclared Milk',
      productDescription: 'Chocolate Chip Cookies',
    }),
  ]);
  assert.deepEqual(projection.productCategories, ['bakery_grains']);
});

// ── Backward compatibility ──────────────────────────────────────────────────

test('a projection written before the field existed still reads', () => {
  const projection = projectCase([record()]);
  const legacy = { ...projection };
  delete (legacy as { productCategories?: unknown }).productCategories;
  assert.equal(readProductCategories(legacy as CaseProjection), null);
  // And it is still a perfectly usable projection.
  assert.equal(legacy.title, projection.title);
});

test('"not derived" is distinguishable from "derived as Other"', () => {
  const notDerived = { ...projectCase([record()]) };
  delete (notDerived as { productCategories?: unknown }).productCategories;
  const derivedOther = projectCase([record({ productDescription: 'Metal Cookware Items' })]);
  assert.equal(readProductCategories(notDerived as CaseProjection), null);
  assert.deepEqual(readProductCategories(derivedOther), ['other']);
});

test('a malformed stored value is normalized, never trusted', () => {
  const projection = projectCase([record()]);
  const cases: [unknown, FoodCategoryId[] | null][] = [
    [['bakery_grains', 'bakery_grains'], ['bakery_grains']],
    [['not_a_category'], null],
    [
      ['pantry_condiments', 'produce'],
      ['produce', 'pantry_condiments'],
    ],
    [[], null],
    ['bakery_grains', null],
    [null, null],
  ];
  for (const [stored, expected] of cases) {
    const row = { ...projection, productCategories: stored } as unknown as CaseProjection;
    assert.deepEqual(readProductCategories(row), expected, JSON.stringify(stored));
  }
});

// ── Category enrichment is NOT material ─────────────────────────────────────

test('a category-only change is not material and writes no timeline entry', () => {
  const before = projectCase([record()]);
  const after: CaseProjection = { ...before, productCategories: ['seafood'] };
  const result = detectChanges(before, after);
  assert.deepEqual(result.material, []);
  assert.deepEqual(result.nonMaterial, []);
});

test('gaining categories from nothing is not material', () => {
  const derived = projectCase([record()]);
  const legacy = { ...derived };
  delete (legacy as { productCategories?: unknown }).productCategories;
  const result = detectChanges(legacy as CaseProjection, derived);
  assert.deepEqual(result.material, []);
  assert.deepEqual(result.nonMaterial, []);
});

test('losing categories is not material either', () => {
  const derived = projectCase([record()]);
  const stripped = { ...derived };
  delete (stripped as { productCategories?: unknown }).productCategories;
  const result = detectChanges(derived, stripped as CaseProjection);
  assert.deepEqual(result.material, []);
  assert.deepEqual(result.nonMaterial, []);
});

test('a genuine product change is STILL material alongside a category change', () => {
  const before = projectCase([record()]);
  const after: CaseProjection = {
    ...before,
    productCategories: ['seafood'],
    affectedProducts: [
      {
        sourceNativeId: 'example-recall',
        name: 'Newly named product',
        rawText: 'Newly named product',
        extractionConfidence: 'stated',
      },
    ],
  };
  const result = detectChanges(before, after);
  // The product-list rule fires; the category difference adds nothing of its
  // own, so exactly one material change is reported.
  assert.equal(result.material.length, 1);
  assert.equal(result.material[0].ruleId, 'correction_broadened');
});

test('the material-change fingerprint of a real change ignores categories', () => {
  const before = projectCase([record()]);
  const widened: CaseProjection = {
    ...before,
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
  };
  const withCategories: CaseProjection = { ...widened, productCategories: ['seafood'] };
  const a = detectChanges(before, widened).material;
  const b = detectChanges(before, withCategories).material;
  assert.deepEqual(
    a.map((m) => m.fingerprint),
    b.map((m) => m.fingerprint),
  );
});
