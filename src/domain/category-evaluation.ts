/**
 * Gold-set evaluation for product-category matching (C5.3B / C5.3B-2 / C10A /
 * C10A.1).
 *
 * Pure and shared: the `qa:categories` command and the test suite run THIS
 * code, so a threshold can never pass in a test and fail in the report, or
 * vice versa. The gates live here too, as data, for the same reason.
 *
 * ## Why three splits
 *
 * A lexicon tuned against every case it is measured on is a lookup table with
 * extra steps, and its reported accuracy means nothing. The fixture therefore
 * carries a `development` portion — everything the matcher was ever tuned or
 * debugged against — and two holdouts drawn from cases no split had ever
 * touched: `c10a1_natural`, sampled to resemble the real corpus and carrying
 * the binding gate, and `c10a1_challenge`, a smaller DIAGNOSTIC set screened
 * for the sparse categories. Only the natural holdout is a claim about future
 * notices, and both are measured exactly once against the frozen matcher.
 *
 * ## A holdout is spent when it is measured
 *
 * `development` therefore also contains C5.3B-2's 317-row final holdout AND
 * C10A's own 307 holdout rows. Each measured its own matcher once; C10A.1
 * changes the classifier, so re-scoring either would report a tuning number
 * dressed as a generalization number. They keep `originSplit` so the history
 * stays legible, and C10A.1 drew its own holdout from the 870 cases that no
 * split had touched.
 *
 * ## Why exact-set accuracy leads
 *
 * Micro precision and recall can both look healthy while most individual cases
 * are subtly wrong — one extra category here, one missing there. Exact-set
 * accuracy asks the question a user actually experiences: when I filter by an
 * aisle, is this card in the right place? It is the strictest of the three and
 * it is reported first.
 */

import {
  FOOD_CATEGORY_IDS,
  isFoodCategoryId,
  MAX_CATEGORIES_PER_CASE,
  type FoodCategoryId,
} from './food-category';
import { COMPACT_CATEGORY_IDS, toCompactCategories } from './food-category-compact';
import { categoriesForCase, type ProductTextBasis } from './food-category-matcher';
import type { SourceAgency } from './recall-types';

/**
 * `development` is everything the matcher may be tuned against. It includes
 * every SPENT holdout: C5.3B-2's two final splits and C10A's `c10a_natural`
 * and `c10a_challenge`. Each measured its own frozen matcher exactly once, and
 * C10A.1 changes the matcher, so none of them can ever measure another. Each
 * such row keeps `originSplit` for provenance.
 *
 * `c10a1_natural` and `c10a1_challenge` are C10A.1's own holdouts, drawn from
 * the 870 cases NO split had ever touched, selected blind to any prediction
 * and labelled from full source evidence.
 */
export type GoldSplit = 'development' | 'c10a1_natural' | 'c10a1_challenge';

export const GOLD_SPLITS: readonly GoldSplit[] = [
  'development',
  'c10a1_natural',
  'c10a1_challenge',
];

/** One reviewed gold-set row. Mirrors the fixture schema exactly. */
export interface GoldRow {
  caseId: string;
  sourceId: string;
  agency: SourceAgency;
  lifecycle: 'active' | 'closed' | 'retracted';
  recency: 'recent' | 'older_active' | null;
  productCount: number;
  title: string;
  productDescription: string | null;
  productLines?: string[];
  /**
   * The announcement's own summary prose, verbatim.
   *
   * The classifier reads one bounded span of it (C10A.1), so the fixture has
   * to carry it: an evaluation that omits an input the shipping derivation
   * reads measures a classifier that does not ship. That is not hypothetical —
   * C10A.1's first harness run omitted this field and scored a title-only arm
   * three points below the real one. Absent or null means the announcement was
   * not recorded for this row, and the derivation then behaves exactly as it
   * did before the field existed.
   */
  announcementSummary?: string | null;
  /** The canonical product text this row was reviewed from. */
  productText: string;
  basis: ProductTextBasis;
  /** Reviewed truth: the categories of the recalled products. Never empty. */
  expected: FoodCategoryId[];
  split: GoldSplit;
  note?: string;
  /** The split this row was drawn into originally, when it has been retired. */
  originSplit?: string;
  /** Phase that revised this row's reviewed label, with the reason in `note`. */
  labelCorrectedIn?: string;
}

export interface GoldSet {
  version: number;
  recordedAt: string;
  corpusSize: number;
  description: string;
  rows: GoldRow[];
}

export interface CategoryFailure {
  caseId: string;
  sourceId: string;
  agency: SourceAgency;
  productText: string;
  expected: string[];
  actual: string[];
  /** Predicted but not expected. */
  overClassified: string[];
  /** Expected but not predicted. */
  missed: string[];
  note?: string;
}

export interface PerCategoryMetric {
  category: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** Expected occurrences — the denominator that makes a percentage honest. */
  support: number;
  precision: number | null;
  recall: number | null;
}

export interface CategoryEvaluation {
  split: string;
  total: number;
  exactSetMatches: number;
  exactSetAccuracy: number;
  microPrecision: number;
  microRecall: number;
  /** Rows the matcher gave at least one category. */
  categorized: number;
  categorizedCoverage: number;
  /** Rows whose reviewed truth is "no category". */
  expectedZero: number;
  /** Rows the matcher gave no category. */
  actualZero: number;
  expectedMulti: number;
  actualMulti: number;
  maxCategoriesAssigned: number;
  overClassifications: number;
  missedCategories: number;
  perCategory: PerCategoryMetric[];
  failures: CategoryFailure[];
}

/**
 * Run the shipping matcher over one row. Never reads `expected`, and passes
 * every input the shipping derivation takes — including the announcement, or
 * the gate would grade a classifier nobody runs.
 */
export function predict(row: GoldRow): FoodCategoryId[] {
  return categoriesForCase({
    sourceAgency: row.agency,
    title: row.title,
    productDescription: row.productDescription,
    productLines: row.productLines,
    announcementSummary: row.announcementSummary ?? null,
  }).categories;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

interface EvaluationPair {
  row: GoldRow;
  expected: string[];
  actual: string[];
}

/**
 * The metric arithmetic, shared verbatim by the twelve-category evaluation and
 * the compact diagnostic so the two can never drift apart.
 */
function evaluatePairs(
  pairs: EvaluationPair[],
  split: string,
  vocabulary: readonly string[],
): CategoryEvaluation {
  const perCategory = new Map<string, PerCategoryMetric>(
    vocabulary.map((category) => [
      category,
      {
        category,
        truePositives: 0,
        falsePositives: 0,
        falseNegatives: 0,
        support: 0,
        precision: null,
        recall: null,
      },
    ]),
  );

  const failures: CategoryFailure[] = [];
  let exactSetMatches = 0;
  let truePositives = 0;
  let predictedTotal = 0;
  let expectedTotal = 0;
  let categorized = 0;
  let expectedZero = 0;
  let actualZero = 0;
  let expectedMulti = 0;
  let actualMulti = 0;
  let maxCategoriesAssigned = 0;
  let overClassifications = 0;
  let missedCategories = 0;

  for (const { row, expected, actual } of pairs) {
    if (actual.length > 0) categorized++;
    else actualZero++;
    if (expected.length === 0) expectedZero++;
    if (expected.length > 1) expectedMulti++;
    if (actual.length > 1) actualMulti++;
    maxCategoriesAssigned = Math.max(maxCategoriesAssigned, actual.length);

    predictedTotal += actual.length;
    expectedTotal += expected.length;

    const over = actual.filter((c) => !expected.includes(c));
    const missed = expected.filter((c) => !actual.includes(c));
    overClassifications += over.length;
    missedCategories += missed.length;

    for (const category of expected) {
      perCategory.get(category)!.support++;
      if (actual.includes(category)) {
        perCategory.get(category)!.truePositives++;
        truePositives++;
      } else {
        perCategory.get(category)!.falseNegatives++;
      }
    }
    for (const category of over) perCategory.get(category)!.falsePositives++;

    if (sameSet(actual, expected)) exactSetMatches++;
    else {
      failures.push({
        caseId: row.caseId,
        sourceId: row.sourceId,
        agency: row.agency,
        productText: row.productText,
        expected,
        actual,
        overClassified: over,
        missed,
        ...(row.note ? { note: row.note } : {}),
      });
    }
  }

  for (const metric of perCategory.values()) {
    const predicted = metric.truePositives + metric.falsePositives;
    metric.precision = predicted === 0 ? null : metric.truePositives / predicted;
    metric.recall = metric.support === 0 ? null : metric.truePositives / metric.support;
  }

  return {
    split,
    total: pairs.length,
    exactSetMatches,
    exactSetAccuracy: pairs.length === 0 ? 0 : exactSetMatches / pairs.length,
    microPrecision: predictedTotal === 0 ? 1 : truePositives / predictedTotal,
    microRecall: expectedTotal === 0 ? 1 : truePositives / expectedTotal,
    categorized,
    categorizedCoverage: pairs.length === 0 ? 0 : categorized / pairs.length,
    expectedZero,
    actualZero,
    expectedMulti,
    actualMulti,
    maxCategoriesAssigned,
    overClassifications,
    missedCategories,
    perCategory: [...perCategory.values()],
    failures,
  };
}

/** Eleven-category evaluation: the matcher's own vocabulary. */
export function evaluateRows(rows: GoldRow[], split: string): CategoryEvaluation {
  return evaluatePairs(
    rows.map((row) => ({ row, expected: row.expected, actual: predict(row) })),
    split,
    FOOD_CATEGORY_IDS,
  );
}

/**
 * The compact seven-category DIAGNOSTIC: the same rows and the same
 * predictions, mechanically merged through the predeclared mapping on both
 * sides. Nothing is re-predicted and nothing is relabeled.
 */
export function evaluateCompactRows(rows: GoldRow[], split: string): CategoryEvaluation {
  return evaluatePairs(
    rows.map((row) => ({
      row,
      expected: toCompactCategories(row.expected),
      actual: toCompactCategories(predict(row)),
    })),
    split,
    COMPACT_CATEGORY_IDS,
  );
}

// ── Deterministic cross-validation ──────────────────────────────────────────

export interface CrossValidation {
  folds: CategoryEvaluation[];
  meanExactSet: number;
  minExactSet: number;
  maxExactSet: number;
  /** Population standard deviation of fold exact-set accuracy. */
  stdevExactSet: number;
  meanMicroPrecision: number;
  meanMicroRecall: number;
}

/**
 * Deterministic stratified folds over the development rows. Strata are
 * (agency, first expected category), rows are ordered by caseId inside each
 * stratum, and folds are dealt round-robin — no randomness, so every machine
 * computes the same folds.
 *
 * Because the lexicon was reviewed against ALL development rows, fold accuracy
 * is NOT a held-out estimate; the folds measure how stable the score is across
 * subsamples and which failure families recur. Only the final holdouts
 * estimate generalization.
 */
export function crossValidate(rows: GoldRow[], foldCount = 5): CrossValidation {
  const strata = new Map<string, GoldRow[]>();
  for (const row of [...rows].sort((a, b) => a.caseId.localeCompare(b.caseId))) {
    const key = `${row.agency}:${row.expected[0] ?? 'none'}`;
    const stratum = strata.get(key) ?? [];
    stratum.push(row);
    strata.set(key, stratum);
  }

  const folds: GoldRow[][] = Array.from({ length: foldCount }, () => []);
  let dealt = 0;
  for (const key of [...strata.keys()].sort()) {
    for (const row of strata.get(key)!) folds[dealt++ % foldCount].push(row);
  }

  const evaluations = folds.map((fold, index) => evaluateRows(fold, `fold ${index + 1}`));
  const exact = evaluations.map((e) => e.exactSetAccuracy);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const meanExactSet = mean(exact);
  return {
    folds: evaluations,
    meanExactSet,
    minExactSet: Math.min(...exact),
    maxExactSet: Math.max(...exact),
    stdevExactSet: Math.sqrt(mean(exact.map((v) => (v - meanExactSet) ** 2))),
    meanMicroPrecision: mean(evaluations.map((e) => e.microPrecision)),
    meanMicroRecall: mean(evaluations.map((e) => e.microRecall)),
  };
}

// ── Gates ───────────────────────────────────────────────────────────────────

export interface GateThresholds {
  exactSetAccuracy: number;
  microPrecision: number;
  microRecall: number;
  /** Per-agency exact-set floor; absent means agencies are not gated. */
  agencyExactSetAccuracy?: number;
  perCategoryMinSupport?: number;
  perCategoryRecall?: number;
  perCategoryPrecision?: number;
}

/**
 * The natural-distribution gates. Set by the milestone; never weakened after
 * results are seen.
 */
export const GATES: GateThresholds = {
  exactSetAccuracy: 0.95,
  microPrecision: 0.95,
  microRecall: 0.95,
  agencyExactSetAccuracy: 0.95,
  /**
   * A per-category floor only applies once a category has enough expected
   * occurrences for a percentage to mean anything. Below it, the brief
   * requires numerator/denominator plus manual inspection instead of a number
   * that would read as 0% or 100% off two samples.
   */
  perCategoryMinSupport: 5,
  perCategoryRecall: 0.8,
  perCategoryPrecision: 0.8,
} as const;

/** The boundary-challenge gates: deliberately hard cases, a slightly lower bar. */
export const CHALLENGE_GATES: GateThresholds = {
  exactSetAccuracy: 0.9,
  microPrecision: 0.9,
  microRecall: 0.9,
} as const;

/**
 * The ACCEPTED PRODUCT GATES for Category as an optional discovery filter.
 *
 * `GATES` above is the research bar this classifier was built against and did
 * not clear (91.5% against 95%). It is deliberately left intact and still
 * reported, because a gate weakened after seeing results is not a gate. These
 * are a SEPARATE, lower bar the founder set afterwards, on an explicit product
 * argument:
 *
 *   Category is a discovery tool, not a safety boundary. A miscategorized card
 *   is a discovery miss with the entire unfiltered feed still behind it; a
 *   missed allergen match is a missed alert. Personalization and notification
 *   eligibility therefore hold a much stricter standard, and nothing in this
 *   file may ever be reused to justify relaxing those — the two paths do not
 *   share a threshold, and `category-invariance.test.ts` proves they do not
 *   share an input either.
 *
 * These are REGRESSION gates: they say the shipped classifier still behaves
 * like the one that was measured and accepted, not that it is accurate enough
 * to decide anything that matters to someone's health.
 */
export const PRODUCT_GATES: GateThresholds = {
  exactSetAccuracy: 0.9,
  microPrecision: 0.9,
  microRecall: 0.9,
} as const;

/**
 * FROZEN HUMAN-REVIEWED BASELINE — cases in the frozen natural holdout that a
 * reviewer judged to be placed somewhere no reasonable shopper would look.
 *
 * WHAT THE AUTOMATED ASSERTION CHECKS: that the frozen manifest is intact,
 * that these case ids are still present in the natural split, that each
 * carries its recorded reasoning, and that the arithmetic still yields ≤3%.
 *
 * WHAT IT CANNOT CHECK: whether a future classifier change introduces a NEW
 * unfindable error. "Would a shopper look here?" is a human judgement and is
 * not present in the data, so no assertion can recompute it. This baseline is
 * a record of one review of one spent holdout — it does not generalize to a
 * changed classifier, and it must never be read as ongoing coverage.
 *
 * REFRESHING IT requires a LATER milestone to draw a NEW holdout from
 * untouched cases and review it; the number below cannot be carried forward
 * across a classifier change. C10A's own 4/200 was retired for exactly that
 * reason when C10A.1 changed the classifier, and these four replace it.
 *
 * The list below is C10A.1's review of the 27 failures on the c10a1_natural
 * holdout. The other twenty-three land in an adjacent aisle a shopper would
 * plausibly try — a chicken salad under Meat & poultry, a sandwich under
 * Bakery, sprouted beans under Pantry & staples. They are wrong; they are not
 * unfindable.
 */
export const REVIEWED_UNFINDABLE_CASE_IDS: readonly string[] = [
  // snacks_sweets → pantry_condiments: a chocolate candy under Pantry &
  // staples, because "almond" is the last word the lexicon knows.
  'b5323fad-008b-4871-91d9-04406aeff54d',
  // supplements → pantry_condiments: a dietary supplement under Pantry &
  // staples, on the word "seed".
  '4338cc6b-2dc4-4846-8e59-10a913b8dd49',
  // supplements → snacks_sweets: a protein powder under Snacks & sweets,
  // because a postposed flavour ("– Chocolate") outranks the product.
  'a8554a5d-b1a0-4d22-a132-3e91e3c6ae9d',
  // pantry_condiments → dairy_eggs: a chocolate-pistachio spread under
  // Dairy & eggs, because "cream" names the style, not the ingredient.
  '95c58f6c-559f-4c10-aca5-32f84bbc6b33',
];

export const UNFINDABLE_RATE_LIMIT = 0.03;

/**
 * Rows whose prediction shares at least one category with reviewed truth —
 * the discovery question, as opposed to exact-set's cataloguing question. A
 * case counted here is reachable from at least one chip a user might select.
 */
export function atLeastOneCorrect(rows: GoldRow[]): { matched: number; total: number } {
  let matched = 0;
  for (const row of rows) {
    const actual = predict(row);
    if (actual.some((category) => row.expected.includes(category))) matched += 1;
  }
  return { matched, total: rows.length };
}

/**
 * Every gate the evaluation misses, as human-readable lines. Empty means the
 * split passed its thresholds. The caller decides what to do about it;
 * nothing here exits.
 */
export function gateFailures(
  overall: CategoryEvaluation,
  byAgency: { agency: SourceAgency; evaluation: CategoryEvaluation }[],
  thresholds: GateThresholds = GATES,
): string[] {
  const failures: string[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  if (overall.exactSetAccuracy < thresholds.exactSetAccuracy) {
    failures.push(
      `overall exact-set accuracy ${pct(overall.exactSetAccuracy)} < ${pct(thresholds.exactSetAccuracy)}`,
    );
  }
  if (overall.microPrecision < thresholds.microPrecision) {
    failures.push(
      `overall micro precision ${pct(overall.microPrecision)} < ${pct(thresholds.microPrecision)}`,
    );
  }
  if (overall.microRecall < thresholds.microRecall) {
    failures.push(
      `overall micro recall ${pct(overall.microRecall)} < ${pct(thresholds.microRecall)}`,
    );
  }
  if (thresholds.agencyExactSetAccuracy !== undefined) {
    for (const { agency, evaluation } of byAgency) {
      if (evaluation.total > 0 && evaluation.exactSetAccuracy < thresholds.agencyExactSetAccuracy) {
        failures.push(
          `${agency} exact-set accuracy ${pct(evaluation.exactSetAccuracy)} < ${pct(thresholds.agencyExactSetAccuracy)}`,
        );
      }
    }
  }
  if (
    thresholds.perCategoryMinSupport !== undefined &&
    thresholds.perCategoryRecall !== undefined &&
    thresholds.perCategoryPrecision !== undefined
  ) {
    for (const metric of overall.perCategory) {
      if (metric.support < thresholds.perCategoryMinSupport) continue;
      if (metric.recall !== null && metric.recall < thresholds.perCategoryRecall) {
        failures.push(
          `category ${metric.category} recall ${metric.truePositives}/${metric.support} < ${pct(thresholds.perCategoryRecall)}`,
        );
      }
      const predicted = metric.truePositives + metric.falsePositives;
      if (metric.precision !== null && metric.precision < thresholds.perCategoryPrecision) {
        failures.push(
          `category ${metric.category} precision ${metric.truePositives}/${predicted} < ${pct(thresholds.perCategoryPrecision)}`,
        );
      }
    }
  }
  if (overall.maxCategoriesAssigned > MAX_CATEGORIES_PER_CASE) {
    failures.push(
      `a case carried ${overall.maxCategoriesAssigned} categories, above the cap of ${MAX_CATEGORIES_PER_CASE}`,
    );
  }
  return failures;
}

export type FinalVerdict = 'GREEN' | 'YELLOW' | 'NOT_PASSING';

/**
 * The decision rule of the milestone, as data: GREEN only when the
 * twelve-category matcher passes BOTH final gates (and the run is
 * deterministic with an intact freeze); YELLOW when the vocabulary fails but the
 * predeclared compact merge passes the same gates on the same predictions —
 * a founder decision, never an automatic adoption; NOT_PASSING otherwise.
 * Only GREEN maps to a zero exit.
 */
export function finalVerdict(input: {
  primaryNaturalFailures: string[];
  primaryChallengeFailures: string[];
  compactNaturalFailures: string[];
  compactChallengeFailures: string[];
  deterministic: boolean;
  freezeIntact: boolean;
}): FinalVerdict {
  const sound = input.deterministic && input.freezeIntact;
  if (
    sound &&
    input.primaryNaturalFailures.length === 0 &&
    input.primaryChallengeFailures.length === 0
  ) {
    return 'GREEN';
  }
  if (
    sound &&
    input.compactNaturalFailures.length === 0 &&
    input.compactChallengeFailures.length === 0
  ) {
    return 'YELLOW';
  }
  return 'NOT_PASSING';
}

// ── Fixture validation ──────────────────────────────────────────────────────

/**
 * Structural validation of the fixture. A gold set that has silently lost a
 * final split, gained a duplicate case, or acquired an unknown category id
 * would otherwise report a cheerful, meaningless pass.
 */
export function validateGoldSet(goldSet: GoldSet): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  if (goldSet.rows.length === 0) problems.push('gold set is empty');

  for (const row of goldSet.rows) {
    const where = row.caseId || '(missing caseId)';
    if (!row.caseId) problems.push('row is missing caseId');
    else if (seen.has(row.caseId)) problems.push(`duplicate caseId ${row.caseId}`);
    seen.add(row.caseId);

    if (row.agency !== 'FDA' && row.agency !== 'FSIS') {
      problems.push(`${where}: unknown agency ${String(row.agency)}`);
    }
    if (!GOLD_SPLITS.includes(row.split)) {
      problems.push(`${where}: unknown split ${String(row.split)}`);
    }
    if (typeof row.productText !== 'string' || row.productText.trim() === '') {
      problems.push(`${where}: empty productText`);
    }
    if (!Array.isArray(row.expected)) {
      problems.push(`${where}: expected must be an array`);
      continue;
    }
    // The C10A derivation is TOTAL, so reviewed truth must be too: a row that
    // expects nothing could never be matched by any prediction.
    if (row.expected.length === 0) {
      problems.push(`${where}: expected is empty — an unnameable product is ['other'], not []`);
    }
    if (row.expected.includes('other') && row.expected.length > 1) {
      problems.push(`${where}: 'other' cannot co-occur with a real category`);
    }
    for (const category of row.expected) {
      if (!isFoodCategoryId(category)) problems.push(`${where}: unknown category ${category}`);
    }
    if (new Set(row.expected).size !== row.expected.length) {
      problems.push(`${where}: duplicate category in expected`);
    }
    if (row.expected.length > MAX_CATEGORIES_PER_CASE) {
      problems.push(`${where}: ${row.expected.length} expected categories exceeds the cap`);
    }
    const ordered = [...row.expected].sort(
      (a, b) => FOOD_CATEGORY_IDS.indexOf(a) - FOOD_CATEGORY_IDS.indexOf(b),
    );
    if (!sameSet(row.expected, ordered)) {
      problems.push(`${where}: expected categories are not in display order`);
    }
  }

  for (const split of GOLD_SPLITS) {
    const rows = goldSet.rows.filter((row) => row.split === split);
    if (rows.length === 0) {
      problems.push(`${split} split is empty — a final evaluation cannot be silently omitted`);
      continue;
    }
    for (const agency of ['FDA', 'FSIS'] as const) {
      if (!rows.some((row) => row.agency === agency)) {
        problems.push(`${split} split has no ${agency} rows`);
      }
    }
  }

  /**
   * Categories the C10A.1 holdout provably cannot cover, and why.
   *
   * The corpus holds 20 infant-feeding cases in total and every one of them
   * was already spent by an earlier split, so no draw from untouched cases can
   * contain one; the disclosed sparse-category screen for infant-feeding words
   * returned zero eligible rows. `other` is the same story from the other
   * direction: the untouched pool held no case whose product a reviewer could
   * not name.
   *
   * `beverages` was exempt under C10A and IS NO LONGER: the C10A.1 challenge
   * screen found one, and it reviewed as a beverage. The exemption shrinks as
   * the evidence allows and never the other way round.
   *
   * This is a real limit on what the holdout measures, so it is named here
   * rather than absorbed by weakening the rule. Both categories are exercised
   * by the development split and by unit tests.
   */
  const HOLDOUT_UNCOVERABLE = new Set<string>(['baby_food_formula', 'other']);

  const development = goldSet.rows.filter((row) => row.split === 'development');
  const finalRows = goldSet.rows.filter((row) => row.split !== 'development');
  for (const [name, rows] of [
    ['development', development],
    ['final holdout', finalRows],
  ] as const) {
    for (const category of FOOD_CATEGORY_IDS) {
      if (name === 'final holdout' && HOLDOUT_UNCOVERABLE.has(category)) continue;
      if (!rows.some((row) => row.expected.includes(category))) {
        problems.push(`${name} has no rows expecting ${category}`);
      }
    }
    if (!rows.some((row) => row.expected.length > 1)) {
      problems.push(`${name} has no multi-category rows`);
    }
  }
  // The disclosure must stay true: if a later draw DOES cover one of these,
  // the exemption is stale and must be removed rather than silently kept.
  for (const category of HOLDOUT_UNCOVERABLE) {
    if (finalRows.some((row) => row.expected.includes(category as FoodCategoryId))) {
      problems.push(
        `final holdout now covers ${category}; remove it from HOLDOUT_UNCOVERABLE and its disclosure`,
      );
    }
  }
  if (!development.some((row) => row.expected.includes('other'))) {
    problems.push(`development has no 'other' rows`);
  }
  return problems;
}
