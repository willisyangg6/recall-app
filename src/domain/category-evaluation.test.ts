/**
 * Gold-set schema and accuracy gates (C5.3B).
 *
 * These tests guard the MEASUREMENT, not the score. They must keep passing
 * while the matcher is below its gates — the point is that a below-gate result
 * is reported loudly and cannot be lost by a fixture that quietly dropped its
 * evaluation split.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  evaluateRows,
  gateFailures,
  GATES,
  predict,
  validateGoldSet,
  type CategoryEvaluation,
  type GoldRow,
  type GoldSet,
} from './category-evaluation';
import { categoryProductText } from './food-category-matcher';
import { FOOD_CATEGORY_IDS, MAX_CATEGORIES_PER_CASE } from './food-category';

const FIXTURE = path.join(__dirname, 'fixtures', 'category-gold-set.json');
const goldSet: GoldSet = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const development = goldSet.rows.filter((row) => row.split === 'development');
const evaluation = goldSet.rows.filter((row) => row.split === 'evaluation');

// ── Fixture schema ──────────────────────────────────────────────────────────

test('the committed gold set is structurally valid', () => {
  assert.deepEqual(validateGoldSet(goldSet), []);
});

test('the gold set is large enough to measure anything', () => {
  assert.ok(goldSet.rows.length >= 300, `only ${goldSet.rows.length} rows`);
  assert.ok(evaluation.length >= 100, `only ${evaluation.length} evaluation rows`);
});

test('stored product text is exactly what extraction produces from the stored inputs', () => {
  for (const row of goldSet.rows) {
    const derived = categoryProductText({
      sourceAgency: row.agency,
      title: row.title,
      productDescription: row.productDescription,
      productLines: row.productLines,
    });
    assert.equal(derived.text, row.productText, row.caseId);
    assert.equal(derived.basis, row.basis, row.caseId);
  }
});

test('no gold row expects more categories than the cap', () => {
  for (const row of goldSet.rows) {
    assert.ok(row.expected.length <= MAX_CATEGORIES_PER_CASE, row.caseId);
  }
});

test('both splits cover both agencies, every category, and both boundaries', () => {
  for (const rows of [development, evaluation]) {
    assert.ok(rows.some((row) => row.agency === 'FDA'));
    assert.ok(rows.some((row) => row.agency === 'FSIS'));
    assert.ok(rows.some((row) => row.expected.length === 0));
    assert.ok(rows.some((row) => row.expected.length > 1));
    for (const category of FOOD_CATEGORY_IDS) {
      assert.ok(
        rows.some((row) => row.expected.includes(category)),
        `missing ${category}`,
      );
    }
  }
});

test('the two splits are disjoint', () => {
  const developmentIds = new Set(development.map((row) => row.caseId));
  for (const row of evaluation) assert.equal(developmentIds.has(row.caseId), false, row.caseId);
});

// ── Validation catches the ways a fixture can go quietly wrong ───────────────

function mutate(change: (rows: GoldRow[]) => GoldRow[]): GoldSet {
  return { ...goldSet, rows: change(goldSet.rows.map((row) => ({ ...row }))) };
}

test('an omitted evaluation split is caught, not silently skipped', () => {
  const problems = validateGoldSet(
    mutate((rows) => rows.filter((row) => row.split !== 'evaluation')),
  );
  assert.ok(
    problems.some((problem) => problem.includes('evaluation split is empty')),
    problems.join('; '),
  );
});

test('a duplicated case is caught', () => {
  const problems = validateGoldSet(mutate((rows) => [...rows, { ...rows[0] }]));
  assert.ok(problems.some((problem) => problem.startsWith('duplicate caseId')));
});

test('an unknown category id is caught', () => {
  const problems = validateGoldSet(
    mutate((rows) => {
      rows[0] = { ...rows[0], expected: ['other' as never] };
      return rows;
    }),
  );
  assert.ok(problems.some((problem) => problem.includes('unknown category other')));
});

test('expected categories out of display order are caught', () => {
  const problems = validateGoldSet(
    mutate((rows) => {
      rows[0] = { ...rows[0], expected: ['prepared', 'produce'] };
      return rows;
    }),
  );
  assert.ok(problems.some((problem) => problem.includes('not in display order')));
});

test('an evaluation split missing a category is caught', () => {
  const problems = validateGoldSet(
    mutate((rows) =>
      rows.filter((row) => !(row.split === 'evaluation' && row.expected.includes('seafood'))),
    ),
  );
  assert.ok(problems.some((problem) => problem.includes('no rows expecting seafood')));
});

// ── Metrics ─────────────────────────────────────────────────────────────────

function rowOf(expected: GoldRow['expected'], productText: string): GoldRow {
  return {
    caseId: `case-${productText}`,
    sourceId: 'x',
    agency: 'FDA',
    lifecycle: 'active',
    recency: 'recent',
    productCount: 0,
    title: 't',
    productDescription: productText,
    productText,
    basis: 'product_description',
    expected,
    split: 'evaluation',
  };
}

test('metrics count exact sets, over-classification and misses separately', () => {
  const result = evaluateRows(
    [rowOf(['bakery'], 'Cookies'), rowOf(['seafood'], 'Cookies')],
    'evaluation',
  );
  assert.equal(result.total, 2);
  assert.equal(result.exactSetMatches, 1);
  assert.equal(result.overClassifications, 1);
  assert.equal(result.missedCategories, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].actual.join(), 'bakery');
  assert.equal(result.failures[0].missed.join(), 'seafood');
});

test('per-category support is the reviewed denominator, so thin samples stay visible', () => {
  const result = evaluateRows([rowOf(['beverages'], 'Instant coffee')], 'evaluation');
  const beverages = result.perCategory.find((metric) => metric.category === 'beverages')!;
  assert.equal(beverages.support, 1);
  assert.ok(beverages.support < GATES.perCategoryMinSupport);
});

test('prediction never reads the expected labels', () => {
  const honest = rowOf(['bakery'], 'Cookies');
  const lying = { ...honest, expected: ['seafood' as const] };
  assert.deepEqual(predict(honest), predict(lying));
});

test('the matcher is deterministic over the whole gold set', () => {
  const once = goldSet.rows.map((row) => predict(row).join('+'));
  const twice = goldSet.rows.map((row) => predict(row).join('+'));
  assert.deepEqual(once, twice);
});

test('no gold-set row is ever assigned more than the cap', () => {
  for (const row of goldSet.rows) {
    assert.ok(predict(row).length <= MAX_CATEGORIES_PER_CASE, row.caseId);
  }
});

// ── Gates ───────────────────────────────────────────────────────────────────

function evaluationWith(overrides: Partial<CategoryEvaluation>): CategoryEvaluation {
  return {
    split: 'evaluation',
    total: 100,
    exactSetMatches: 100,
    exactSetAccuracy: 1,
    microPrecision: 1,
    microRecall: 1,
    categorized: 100,
    categorizedCoverage: 1,
    expectedZero: 0,
    actualZero: 0,
    expectedMulti: 0,
    actualMulti: 0,
    maxCategoriesAssigned: 2,
    overClassifications: 0,
    missedCategories: 0,
    perCategory: FOOD_CATEGORY_IDS.map((category) => ({
      category,
      truePositives: 10,
      falsePositives: 0,
      falseNegatives: 0,
      support: 10,
      precision: 1,
      recall: 1,
    })),
    failures: [],
    ...overrides,
  };
}

test('a perfect evaluation reports no gate failures', () => {
  assert.deepEqual(gateFailures(evaluationWith({}), []), []);
});

test('each overall threshold has its own gate', () => {
  for (const [field, label] of [
    ['exactSetAccuracy', 'exact-set accuracy'],
    ['microPrecision', 'micro precision'],
    ['microRecall', 'micro recall'],
  ] as const) {
    const failures = gateFailures(evaluationWith({ [field]: 0.94 }), []);
    assert.ok(
      failures.some((failure) => failure.includes(label)),
      `${label} gate missing`,
    );
  }
});

test('an agency below the threshold fails even when the overall number passes', () => {
  const failures = gateFailures(evaluationWith({}), [
    { agency: 'FSIS', evaluation: evaluationWith({ exactSetAccuracy: 0.9 }) },
  ]);
  assert.ok(failures.some((failure) => failure.startsWith('FSIS exact-set accuracy')));
});

test('a category failure hidden by healthy aggregates is still caught', () => {
  const perCategory = evaluationWith({}).perCategory.map((metric) =>
    metric.category === 'seafood'
      ? { ...metric, truePositives: 5, falseNegatives: 5, recall: 0.5 }
      : metric,
  );
  const failures = gateFailures(evaluationWith({ perCategory }), []);
  assert.ok(failures.some((failure) => failure.includes('category seafood recall 5/10')));
});

test('a thin per-category sample reports numbers instead of failing on a percentage', () => {
  const perCategory = evaluationWith({}).perCategory.map((metric) =>
    metric.category === 'beverages'
      ? { ...metric, support: 2, truePositives: 1, falseNegatives: 1, recall: 0.5 }
      : metric,
  );
  const failures = gateFailures(evaluationWith({ perCategory }), []);
  assert.equal(
    failures.some((failure) => failure.includes('beverages')),
    false,
    'a 1/2 sample must not be gated on a percentage',
  );
});

test('exceeding the category cap is a gate failure', () => {
  const failures = gateFailures(evaluationWith({ maxCategoriesAssigned: 5 }), []);
  assert.ok(failures.some((failure) => failure.includes('above the cap')));
});

test('the gates are the values the milestone specified', () => {
  assert.equal(GATES.exactSetAccuracy, 0.95);
  assert.equal(GATES.microPrecision, 0.95);
  assert.equal(GATES.microRecall, 0.95);
});
