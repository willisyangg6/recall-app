/**
 * Gold-set schema, final-holdout integrity, and accuracy gates (C5.3B-2).
 *
 * These tests guard the MEASUREMENT, not the score. They must keep passing
 * while the matcher is below its gates — the point is that a below-gate result
 * is reported loudly and cannot be lost by a fixture that quietly dropped a
 * final split, a classifier edited after its freeze, or labels rewritten
 * after the matcher's single run.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  CHALLENGE_GATES,
  crossValidate,
  evaluateCompactRows,
  evaluateRows,
  finalVerdict,
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
const MANIFEST = path.join(__dirname, 'fixtures', 'category-freeze-manifest.json');
const goldSet: GoldSet = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const development = goldSet.rows.filter((row) => row.split === 'development');
const natural = goldSet.rows.filter((row) => row.split === 'c10a1_natural');
const challenge = goldSet.rows.filter((row) => row.split === 'c10a1_challenge');

// ── Fixture schema ──────────────────────────────────────────────────────────

test('the committed gold set is structurally valid', () => {
  assert.deepEqual(validateGoldSet(goldSet), []);
});

test('the gold set is large enough to measure anything', () => {
  assert.ok(development.length >= 400, `only ${development.length} development rows`);
  // The natural split carries the binding gate and its size is fixed by the
  // frozen selection procedure. The challenge split is DIAGNOSTIC and its size
  // is whatever the frozen screens yield: C10A.1's six screens returned 52
  // because three of them were exhausted below their cap (supplements 10,
  // beverages 6, infant-feeding 0). The floor is a sanity check on the
  // fixture, not a gate on the classifier.
  assert.ok(natural.length >= 200, `only ${natural.length} natural rows`);
  assert.ok(challenge.length >= 50, `only ${challenge.length} challenge rows`);
});

/**
 * The fixture's recorded basis must be what the SHIPPING extraction produces
 * from the row's own stored inputs — the announcement included. This test is
 * why C10A.1's harness defect surfaced at all: the first run omitted
 * `announcementSummary` from `predict`, and the stored basis stopped matching.
 */
test('stored product text is exactly what extraction produces from the stored inputs', () => {
  for (const row of goldSet.rows) {
    const derived = categoryProductText({
      sourceAgency: row.agency,
      title: row.title,
      productDescription: row.productDescription,
      productLines: row.productLines,
      announcementSummary: row.announcementSummary ?? null,
    });
    assert.equal(derived.text, row.productText, row.caseId);
    assert.equal(derived.basis, row.basis, row.caseId);
  }
});

test('the gold set carries every input the shipping derivation reads', () => {
  // A fixture missing an input grades a classifier nobody runs.
  for (const row of goldSet.rows) {
    assert.equal(typeof row.announcementSummary, 'string', row.caseId);
  }
  // And `predict` must actually pass it: a row whose basis is the announcement
  // has to derive differently once the announcement is withheld.
  const viaSummary = goldSet.rows.find((row) => row.basis === 'summary_grammar');
  assert.ok(viaSummary, 'no row derives from the announcement');
  assert.notDeepEqual(
    predict(viaSummary),
    predict({ ...viaSummary, announcementSummary: null }),
    viaSummary.caseId,
  );
});

test('no gold row expects more categories than the cap', () => {
  for (const row of goldSet.rows) {
    assert.ok(row.expected.length <= MAX_CATEGORIES_PER_CASE, row.caseId);
  }
});

/**
 * `beverages`, `baby_food_formula` and `other` are DISCLOSED as uncoverable by
 * any fresh holdout: the corpus holds 13 beverage and 20 infant-feeding cases
 * in total and the C5.3B-2 development set already contains all of them, and
 * the untouched pool held no case whose product a reviewer could not name.
 * The exemption is pinned here so it cannot silently widen.
 */
const HOLDOUT_UNCOVERABLE = ['beverages', 'baby_food_formula', 'other'];

test('every split covers both agencies; the holdout covers every coverable category', () => {
  for (const rows of [development, natural, challenge]) {
    assert.ok(rows.some((row) => row.agency === 'FDA'));
    assert.ok(rows.some((row) => row.agency === 'FSIS'));
  }
  const finalRows = [...natural, ...challenge];
  for (const category of FOOD_CATEGORY_IDS) {
    if (HOLDOUT_UNCOVERABLE.includes(category)) continue;
    assert.ok(
      finalRows.some((row) => row.expected.includes(category)),
      `final holdout missing ${category}`,
    );
  }
  assert.ok(finalRows.some((row) => row.expected.length > 1));
});

test('the development split covers every category, including the uncoverable three', () => {
  for (const category of FOOD_CATEGORY_IDS) {
    assert.ok(
      development.some((row) => row.expected.includes(category)),
      `development missing ${category}`,
    );
  }
});

test('the final splits are disjoint from the development split and each other', () => {
  const developmentIds = new Set(development.map((row) => row.caseId));
  const naturalIds = new Set(natural.map((row) => row.caseId));
  for (const row of natural) assert.equal(developmentIds.has(row.caseId), false, row.caseId);
  for (const row of challenge) {
    assert.equal(developmentIds.has(row.caseId), false, row.caseId);
    assert.equal(naturalIds.has(row.caseId), false, row.caseId);
  }
});

// ── Freeze integrity: selection order and label freezing are enforceable ────

test('the classifier files still hash to the values frozen BEFORE final selection', () => {
  for (const [file, expected] of Object.entries(
    manifest.classifierFiles as Record<string, string>,
  )) {
    const actual = createHash('sha256')
      .update(readFileSync(path.join(__dirname, '..', '..', file)))
      .digest('hex');
    assert.equal(actual, expected, `${file} changed after the freeze`);
  }
});

test('the final expected labels still hash to the value frozen before the single run', () => {
  const finalLabels = goldSet.rows
    .filter((row) => row.split === 'c10a1_natural' || row.split === 'c10a1_challenge')
    .map((row) => `${row.caseId}:${row.expected.join('+')}`)
    .sort()
    .join('\n');
  const hash = createHash('sha256').update(finalLabels).digest('hex');
  assert.equal(hash, manifest.finalLabelsSha256);
});

test('the manifest records the required ordering: freeze, then selection, then labels, then one run', () => {
  assert.ok(Array.isArray(manifest.ordering) && manifest.ordering.length === 4);
  assert.match(manifest.ordering[0], /frozen and hashed/i);
  assert.match(manifest.ordering[1], /WITHOUT running the matcher/i);
  assert.match(manifest.ordering[3], /exactly once/i);
});

test('prediction never reads the expected labels', () => {
  const honest = rowOf(['bakery_grains'], 'Cookies');
  const lying = { ...honest, expected: ['seafood' as const] };
  assert.deepEqual(predict(honest), predict(lying));
});

// ── Validation catches the ways a fixture can go quietly wrong ───────────────

function mutate(change: (rows: GoldRow[]) => GoldRow[]): GoldSet {
  return { ...goldSet, rows: change(goldSet.rows.map((row) => ({ ...row }))) };
}

test('an omitted final split is caught, not silently skipped', () => {
  for (const split of ['c10a1_natural', 'c10a1_challenge'] as const) {
    const problems = validateGoldSet(mutate((rows) => rows.filter((row) => row.split !== split)));
    assert.ok(
      problems.some((problem) => problem.includes(`${split} split is empty`)),
      problems.join('; '),
    );
  }
});

test('a duplicated case is caught', () => {
  const problems = validateGoldSet(mutate((rows) => [...rows, { ...rows[0] }]));
  assert.ok(problems.some((problem) => problem.startsWith('duplicate caseId')));
});

test('an unknown category id is caught', () => {
  const problems = validateGoldSet(
    mutate((rows) => {
      rows[0] = { ...rows[0], expected: ['not_a_category' as never] };
      return rows;
    }),
  );
  assert.ok(problems.some((problem) => problem.includes('unknown category not_a_category')));
});

test('expected categories out of display order are caught', () => {
  const problems = validateGoldSet(
    mutate((rows) => {
      rows[0] = { ...rows[0], expected: ['prepared_foods', 'produce'] };
      return rows;
    }),
  );
  assert.ok(problems.some((problem) => problem.includes('not in display order')));
});

test('a final holdout missing a category is caught', () => {
  const problems = validateGoldSet(
    mutate((rows) =>
      rows.filter((row) => row.split === 'development' || !row.expected.includes('seafood')),
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes('final holdout has no rows expecting seafood')),
  );
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
    split: 'c10a1_natural',
  };
}

test('metrics count exact sets, over-classification and misses separately', () => {
  const result = evaluateRows(
    [rowOf(['bakery_grains'], 'Cookies'), rowOf(['seafood'], 'Cookies')],
    'c10a1_natural',
  );
  assert.equal(result.total, 2);
  assert.equal(result.exactSetMatches, 1);
  assert.equal(result.overClassifications, 1);
  assert.equal(result.missedCategories, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].actual.join(), 'bakery_grains');
  assert.equal(result.failures[0].missed.join(), 'seafood');
});

test('per-category support is the reviewed denominator, so thin samples stay visible', () => {
  const result = evaluateRows([rowOf(['beverages'], 'Instant coffee')], 'c10a1_natural');
  const beverages = result.perCategory.find((metric) => metric.category === 'beverages')!;
  assert.equal(beverages.support, 1);
  assert.ok(beverages.support < (GATES.perCategoryMinSupport ?? 5));
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

// ── Cross-validation ────────────────────────────────────────────────────────

test('cross-validation folds are deterministic, cover every row once, and report spread', () => {
  const first = crossValidate(development, 5);
  const second = crossValidate(development, 5);
  assert.deepEqual(
    first.folds.map((fold) => fold.total),
    second.folds.map((fold) => fold.total),
  );
  assert.equal(
    first.folds.reduce((sum, fold) => sum + fold.total, 0),
    development.length,
  );
  assert.equal(first.meanExactSet, second.meanExactSet);
  assert.ok(first.minExactSet <= first.meanExactSet && first.meanExactSet <= first.maxExactSet);
  assert.ok(first.stdevExactSet >= 0);
});

// ── Compact diagnostic ──────────────────────────────────────────────────────

test('the compact evaluation merges BOTH sides mechanically and is deterministic', () => {
  const rows = [rowOf(['meat_poultry'], 'Salmon fillets'), rowOf(['bakery_grains'], 'Cookies')];
  const once = evaluateCompactRows(rows, 'compact');
  const twice = evaluateCompactRows(rows, 'compact');
  // Salmon predicts seafood; expected meat_poultry — DIFFERENT in eleven,
  // the SAME compact meat_seafood. The merge must apply to both sides.
  assert.equal(evaluateRows(rows, 'x').exactSetMatches, 1);
  assert.equal(once.exactSetMatches, 2);
  assert.deepEqual(once, twice);
});

// ── Gates ───────────────────────────────────────────────────────────────────

function evaluationWith(overrides: Partial<CategoryEvaluation>): CategoryEvaluation {
  return {
    split: 'c10a1_natural',
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

test('challenge gates are the 90% thresholds and do not gate agencies or categories', () => {
  assert.equal(CHALLENGE_GATES.exactSetAccuracy, 0.9);
  assert.equal(CHALLENGE_GATES.microPrecision, 0.9);
  assert.equal(CHALLENGE_GATES.microRecall, 0.9);
  const failures = gateFailures(
    evaluationWith({ exactSetAccuracy: 0.91, microPrecision: 0.91, microRecall: 0.91 }),
    [{ agency: 'FSIS', evaluation: evaluationWith({ exactSetAccuracy: 0.5 }) }],
    CHALLENGE_GATES,
  );
  assert.deepEqual(failures, []);
});

test('the natural gates are the values the milestone specified', () => {
  assert.equal(GATES.exactSetAccuracy, 0.95);
  assert.equal(GATES.microPrecision, 0.95);
  assert.equal(GATES.microRecall, 0.95);
  assert.equal(GATES.agencyExactSetAccuracy, 0.95);
});

// ── Verdict: the QA exit contract ───────────────────────────────────────────

const pass: string[] = [];
const fail = ['overall exact-set accuracy 89.5% < 95.0%'];

test('GREEN requires the eleven-category matcher to pass BOTH final gates', () => {
  assert.equal(
    finalVerdict({
      primaryNaturalFailures: pass,
      primaryChallengeFailures: pass,
      compactNaturalFailures: fail,
      compactChallengeFailures: fail,
      deterministic: true,
      freezeIntact: true,
    }),
    'GREEN',
  );
});

test('a compact-only pass is YELLOW, never GREEN', () => {
  assert.equal(
    finalVerdict({
      primaryNaturalFailures: fail,
      primaryChallengeFailures: pass,
      compactNaturalFailures: pass,
      compactChallengeFailures: pass,
      deterministic: true,
      freezeIntact: true,
    }),
    'YELLOW',
  );
});

test('neither passing is NOT_PASSING', () => {
  assert.equal(
    finalVerdict({
      primaryNaturalFailures: fail,
      primaryChallengeFailures: pass,
      compactNaturalFailures: fail,
      compactChallengeFailures: pass,
      deterministic: true,
      freezeIntact: true,
    }),
    'NOT_PASSING',
  );
});

test('nondeterminism or a broken freeze can never be GREEN or YELLOW', () => {
  for (const broken of [
    { deterministic: false, freezeIntact: true },
    { deterministic: true, freezeIntact: false },
  ]) {
    assert.equal(
      finalVerdict({
        primaryNaturalFailures: pass,
        primaryChallengeFailures: pass,
        compactNaturalFailures: pass,
        compactChallengeFailures: pass,
        ...broken,
      }),
      'NOT_PASSING',
    );
  }
});
