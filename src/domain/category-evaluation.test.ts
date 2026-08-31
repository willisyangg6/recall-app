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
  crossValidate,
  FINAL_SPLIT,
  evaluateCompactRows,
  evaluateRows,
  finalVerdict,
  gateFailures,
  GATES,
  PRODUCT_GATES,
  predict,
  UNFINDABLE_RATE_LIMIT,
  unfindableBaseline,
  validateGoldSet,
  type CategoryEvaluation,
  type GoldRow,
  type GoldSet,
  type ReviewedUnfindable,
} from './category-evaluation';
import { categoryProductText } from './food-category-matcher';
import { deriveProductCategories } from './projection';
import { FOOD_CATEGORY_IDS, MAX_CATEGORIES_PER_CASE } from './food-category';

const FIXTURE = path.join(__dirname, 'fixtures', 'category-gold-set.json');
const MANIFEST = path.join(__dirname, 'fixtures', 'category-freeze-manifest.json');
const goldSet: GoldSet = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const development = goldSet.rows.filter((row) => row.split === 'development');
const natural = goldSet.rows.filter((row) => row.split === FINAL_SPLIT);

/**
 * Categories the FINAL holdout provably cannot contain, taken from the freeze
 * manifest rather than hardcoded: the disclosure is a datum produced by the
 * draw, and the harness is frozen before the draw happens.
 */
const uncoverable: string[] = manifest.holdout?.uncoverableCategories ?? [];

// ── Fixture schema ──────────────────────────────────────────────────────────

test('the committed gold set is structurally valid', () => {
  // The disclosure comes from the manifest, not from this file: which
  // categories a draw cannot cover is a datum the draw produces, and the
  // harness is frozen before the draw happens.
  assert.deepEqual(validateGoldSet(goldSet, uncoverable), []);
});

test('an undisclosed missing category is still caught', () => {
  // The exemption is data, so this is what stops it from being a blanket
  // waiver: drop the disclosure and the gap is reported.
  const problems = validateGoldSet(goldSet, []);
  assert.ok(
    problems.some((problem) => problem.includes('final holdout has no rows expecting seafood')),
    problems.join('; '),
  );
});

test('the gold set is large enough to measure anything', () => {
  assert.ok(development.length >= 400, `only ${development.length} development rows`);
  // The natural split carries the binding gate and its size is fixed by the
  // frozen selection procedure. C10A.2 drew no challenge split: C10A.1's was
  // diagnostic, carried no gate, and another would have spent 52 more
  // untouched cases on a number nothing depends on.
  assert.ok(natural.length >= 200, `only ${natural.length} natural rows`);
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

// ── Harness equivalence: the gate grades the derivation that ships ──────────
//
// `predict` is the harness's entry point and `deriveProductCategories` is the
// one `projectCase`, the historical backfill and live QA all call. If those
// two ever diverge, every number this file produces describes a classifier
// nobody runs — which is not hypothetical: C10A.1's first harness execution
// omitted the announcement and reported a title-only arm three points below
// the real one. These tests are the standing proof that they have not
// diverged, and the synthetic row below is the proof that they COULD.

/** The row, as the canonical projection derivation would receive it. */
const asProjectionInput = (row: GoldRow) => ({
  sourceAgency: row.agency,
  title: row.title,
  productDescription: row.productDescription,
  affectedProducts: (row.productLines ?? []).map((name) => ({ name })),
  summaryText: row.announcementSummary ?? null,
});

test('predict and the canonical projection derivation agree on every fixture row', () => {
  for (const row of goldSet.rows) {
    assert.deepEqual(predict(row), deriveProductCategories(asProjectionInput(row)), row.caseId);
  }
});

test('equivalence is a real constraint, not one that holds vacuously', () => {
  // A harness that dropped the announcement would pass the row-by-row check
  // above only if no row depended on it. This proves the dependency exists:
  // withholding the summary from ONE path changes that path's answer, so the
  // equivalence assertion would fail rather than pass quietly.
  const viaSummary = goldSet.rows.filter((row) => row.basis === 'summary_grammar');
  assert.ok(viaSummary.length > 0, 'no row derives from the announcement');
  const divergent = viaSummary.filter(
    (row) =>
      JSON.stringify(predict(row)) !==
      JSON.stringify(deriveProductCategories({ ...asProjectionInput(row), summaryText: null })),
  );
  assert.ok(
    divergent.length > 0,
    'withholding the announcement changed nothing — the harness cannot detect the C10A.1 defect',
  );
});

test('a summary-dependent row fails equivalence the moment either path drops it', () => {
  // Synthetic, so it holds even if the corpus one day carries no such row.
  const row: GoldRow = {
    caseId: 'synthetic-summary-dependent',
    sourceId: 'synthetic',
    agency: 'FSIS',
    lifecycle: 'active',
    recency: 'recent',
    productCount: 0,
    title: 'A Firm Recalls Poultry Products Due to Misbranding',
    productDescription: null,
    announcementSummary:
      'A firm is recalling poultry products.\nThe frozen chicken tamale items were produced today.',
    productText: 'frozen chicken tamale items',
    basis: 'summary_grammar',
    expected: ['prepared_foods'],
    split: 'development',
  };
  // Both paths, given the same inputs, agree — and agree on the ANSWER THE
  // ANNOUNCEMENT PRODUCES, not on the title's answer.
  assert.deepEqual(predict(row), ['prepared_foods']);
  assert.deepEqual(deriveProductCategories(asProjectionInput(row)), ['prepared_foods']);
  // Withhold the announcement from either side and equivalence breaks loudly.
  assert.deepEqual(predict({ ...row, announcementSummary: null }), ['meat_poultry']);
  assert.deepEqual(deriveProductCategories({ ...asProjectionInput(row), summaryText: null }), [
    'meat_poultry',
  ]);
  assert.notDeepEqual(predict(row), predict({ ...row, announcementSummary: null }));
});

test('the harness reads every field the projection input carries, and no other', () => {
  // `predict` may not quietly gain an input the projection wrapper cannot
  // supply, and the wrapper may not quietly gain one the classifier refuses.
  const row = goldSet.rows[0];
  assert.deepEqual(Object.keys(asProjectionInput(row)).sort(), [
    'affectedProducts',
    'productDescription',
    'sourceAgency',
    'summaryText',
    'title',
  ]);
});

test('no gold row expects more categories than the cap', () => {
  for (const row of goldSet.rows) {
    assert.ok(row.expected.length <= MAX_CATEGORIES_PER_CASE, row.caseId);
  }
});

test('every split covers both agencies; the holdout covers every coverable category', () => {
  for (const rows of [development, natural]) {
    assert.ok(rows.some((row) => row.agency === 'FDA'));
    assert.ok(rows.some((row) => row.agency === 'FSIS'));
  }
  for (const category of FOOD_CATEGORY_IDS) {
    if (uncoverable.includes(category)) continue;
    assert.ok(
      natural.some((row) => row.expected.includes(category)),
      `final holdout missing ${category}`,
    );
  }
  assert.ok(natural.some((row) => row.expected.length > 1));
});

test('a disclosed uncoverable category the holdout DOES cover is a stale disclosure', () => {
  // The exemption may only ever shrink. This is the direction that matters:
  // a disclosure kept after the evidence stopped supporting it understates
  // what the holdout measured.
  for (const category of uncoverable) {
    assert.equal(
      natural.some((row) => row.expected.includes(category as never)),
      false,
      `${category} is disclosed uncoverable but the holdout covers it`,
    );
  }
});

test('the development split covers every category, the uncoverable ones included', () => {
  for (const category of FOOD_CATEGORY_IDS) {
    assert.ok(
      development.some((row) => row.expected.includes(category)),
      `development missing ${category}`,
    );
  }
});

test('the final split is disjoint from the development split', () => {
  const developmentIds = new Set(development.map((row) => row.caseId));
  for (const row of natural) assert.equal(developmentIds.has(row.caseId), false, row.caseId);
});

test('every spent holdout was retired into development with its provenance', () => {
  // A spent split that quietly kept its old name could be re-scored and
  // reported as generalization. Retiring it into `development` is what makes
  // that impossible; `originSplit` is what keeps the history legible.
  const retired = development.filter((row) => row.originSplit !== undefined);
  assert.ok(retired.length > 0);
  for (const name of [
    'final_natural',
    'final_challenge',
    'c10a_natural',
    'c10a_challenge',
    'c10a1_natural',
    'c10a1_challenge',
  ]) {
    assert.ok(
      retired.some((row) => row.originSplit === name),
      `no rows retired from ${name}`,
    );
  }
});

// ── Freeze integrity: selection order and label freezing are enforceable ────

const sha256Of = (file: string): string =>
  createHash('sha256')
    .update(readFileSync(path.join(__dirname, '..', '..', file)))
    .digest('hex');

test('the classifier files still hash to the values frozen BEFORE final selection', () => {
  for (const [file, expected] of Object.entries(
    manifest.classifierFiles as Record<string, string>,
  )) {
    assert.equal(sha256Of(file), expected, `${file} changed after the freeze`);
  }
});

test('the EVALUATION HARNESS still hashes to the value frozen before selection', () => {
  // C10A.1's headline number moved three points because of a harness defect,
  // not a classifier one, so the harness is frozen the same way. This is also
  // why the reviewed-unfindable records and the uncoverable disclosure live in
  // the manifest as data: both are produced AFTER the run, and neither may
  // require editing a frozen file.
  const harnessFiles = manifest.harnessFiles as Record<string, string> | undefined;
  assert.ok(harnessFiles && Object.keys(harnessFiles).length > 0, 'no harness files are frozen');
  for (const [file, expected] of Object.entries(harnessFiles)) {
    assert.equal(sha256Of(file), expected, `${file} changed after the freeze`);
  }
});

test('the final expected labels still hash to the value frozen before the single run', () => {
  const finalLabels = goldSet.rows
    .filter((row) => row.split === FINAL_SPLIT)
    .map((row) => `${row.caseId}:${row.expected.join('+')}`)
    .sort()
    .join('\n');
  const hash = createHash('sha256').update(finalLabels).digest('hex');
  assert.equal(hash, manifest.finalLabelsSha256);
});

test('the reviewed-unfindable baseline is a record of THIS holdout, with reasons', () => {
  const reviewed = (manifest.finalReview?.unfindable ?? []) as ReviewedUnfindable[];
  const baseline = unfindableBaseline(reviewed, natural);
  assert.deepEqual(baseline.problems, []);
  assert.ok(baseline.rate <= UNFINDABLE_RATE_LIMIT, `${baseline.matched}/${baseline.total}`);
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
  const problems = validateGoldSet(
    mutate((rows) => rows.filter((row) => row.split !== FINAL_SPLIT)),
    uncoverable,
  );
  assert.ok(
    problems.some((problem) => problem.includes(`${FINAL_SPLIT} split is empty`)),
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
    split: FINAL_SPLIT,
  };
}

test('metrics count exact sets, over-classification and misses separately', () => {
  const result = evaluateRows(
    [rowOf(['bakery_grains'], 'Cookies'), rowOf(['seafood'], 'Cookies')],
    FINAL_SPLIT,
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
  const result = evaluateRows([rowOf(['beverages'], 'Instant coffee')], FINAL_SPLIT);
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
    split: FINAL_SPLIT,
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

test('the blocking product gates carry a per-category floor at support 20', () => {
  // The overall number can clear 90% while one large category collapses:
  // C10A.1's prepared-foods recall was 71.7% behind an 86.5% headline. This
  // is the gate that makes that visible, and the support floor is what keeps
  // a thin category from being reported as a percentage.
  assert.equal(PRODUCT_GATES.perCategoryMinSupport, 20);
  assert.equal(PRODUCT_GATES.perCategoryRecall, 0.8);
  assert.equal(PRODUCT_GATES.perCategoryPrecision, 0.8);

  const collapsed = {
    category: 'prepared_foods',
    truePositives: 43,
    falsePositives: 1,
    falseNegatives: 17,
    support: 60,
    precision: 43 / 44,
    recall: 43 / 60,
  };
  const thin = {
    category: 'beverages',
    truePositives: 1,
    falsePositives: 1,
    falseNegatives: 18,
    support: 19,
    precision: 0.5,
    recall: 1 / 19,
  };
  const failures = gateFailures(
    evaluationWith({
      exactSetAccuracy: 0.95,
      microPrecision: 0.95,
      microRecall: 0.95,
      perCategory: [collapsed, thin],
    }),
    [],
    PRODUCT_GATES,
  );
  assert.ok(
    failures.some((failure) => failure.includes('prepared_foods recall')),
    failures.join('; '),
  );
  assert.equal(
    failures.some((failure) => failure.includes('beverages')),
    false,
    'a support-19 category must not be gated on a percentage',
  );
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

test('GREEN requires the twelve-category matcher to pass the final natural gate', () => {
  assert.equal(
    finalVerdict({
      primaryNaturalFailures: pass,
      compactNaturalFailures: fail,
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
      compactNaturalFailures: pass,
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
      compactNaturalFailures: fail,
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
        compactNaturalFailures: pass,
        ...broken,
      }),
      'NOT_PASSING',
    );
  }
});
