/**
 * Gold-set evaluation for food-category matching (Phase C5.3B).
 *
 * Pure and shared: the `qa:categories` command and the test suite run THIS
 * code, so a threshold can never pass in a test and fail in the report, or
 * vice versa. The gates live here too, as data, for the same reason.
 *
 * ## Why two splits
 *
 * A lexicon tuned against every case it is measured on is a lookup table with
 * extra steps, and its reported accuracy means nothing. The fixture therefore
 * carries a `development` portion, which the lexicon was written against, and
 * an `evaluation` portion, which is measured once at the end. Only the second
 * number is a claim about future notices.
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
import { categoriesForCase, type ProductTextBasis } from './food-category-matcher';
import type { SourceAgency } from './recall-types';

export type GoldSplit = 'development' | 'evaluation';

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
  /** The canonical product text this row was reviewed from. */
  productText: string;
  basis: ProductTextBasis;
  /** Reviewed truth: the categories of the recalled products. */
  expected: FoodCategoryId[];
  split: GoldSplit;
  note?: string;
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
  expected: FoodCategoryId[];
  actual: FoodCategoryId[];
  /** Predicted but not expected. */
  overClassified: FoodCategoryId[];
  /** Expected but not predicted. */
  missed: FoodCategoryId[];
  note?: string;
}

export interface PerCategoryMetric {
  category: FoodCategoryId;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** Expected occurrences — the denominator that makes a percentage honest. */
  support: number;
  precision: number | null;
  recall: number | null;
}

export interface CategoryEvaluation {
  split: GoldSplit | 'all';
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

/** Run the shipping matcher over one row. Never reads `expected`. */
export function predict(row: GoldRow): FoodCategoryId[] {
  return categoriesForCase({
    sourceAgency: row.agency,
    title: row.title,
    productDescription: row.productDescription,
    productLines: row.productLines,
  }).categories;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function evaluateRows(rows: GoldRow[], split: GoldSplit | 'all'): CategoryEvaluation {
  const perCategory = new Map<FoodCategoryId, PerCategoryMetric>(
    FOOD_CATEGORY_IDS.map((category) => [
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

  for (const row of rows) {
    const actual = predict(row);
    const expected = row.expected;

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
    total: rows.length,
    exactSetMatches,
    exactSetAccuracy: rows.length === 0 ? 0 : exactSetMatches / rows.length,
    microPrecision: predictedTotal === 0 ? 1 : truePositives / predictedTotal,
    microRecall: expectedTotal === 0 ? 1 : truePositives / expectedTotal,
    categorized,
    categorizedCoverage: rows.length === 0 ? 0 : categorized / rows.length,
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

// ── Gates ───────────────────────────────────────────────────────────────────

export const GATES = {
  exactSetAccuracy: 0.95,
  microPrecision: 0.95,
  microRecall: 0.95,
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

/**
 * Every gate the evaluation misses, as human-readable lines. Empty means the
 * matcher passed. The caller decides what to do about it; nothing here exits.
 */
export function gateFailures(
  overall: CategoryEvaluation,
  byAgency: { agency: SourceAgency; evaluation: CategoryEvaluation }[],
): string[] {
  const failures: string[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  if (overall.exactSetAccuracy < GATES.exactSetAccuracy) {
    failures.push(
      `overall exact-set accuracy ${pct(overall.exactSetAccuracy)} < ${pct(GATES.exactSetAccuracy)}`,
    );
  }
  if (overall.microPrecision < GATES.microPrecision) {
    failures.push(
      `overall micro precision ${pct(overall.microPrecision)} < ${pct(GATES.microPrecision)}`,
    );
  }
  if (overall.microRecall < GATES.microRecall) {
    failures.push(`overall micro recall ${pct(overall.microRecall)} < ${pct(GATES.microRecall)}`);
  }
  for (const { agency, evaluation } of byAgency) {
    if (evaluation.total > 0 && evaluation.exactSetAccuracy < GATES.exactSetAccuracy) {
      failures.push(
        `${agency} exact-set accuracy ${pct(evaluation.exactSetAccuracy)} < ${pct(GATES.exactSetAccuracy)}`,
      );
    }
  }
  for (const metric of overall.perCategory) {
    if (metric.support < GATES.perCategoryMinSupport) continue;
    if (metric.recall !== null && metric.recall < GATES.perCategoryRecall) {
      failures.push(
        `category ${metric.category} recall ${metric.truePositives}/${metric.support} < ${pct(GATES.perCategoryRecall)}`,
      );
    }
    const predicted = metric.truePositives + metric.falsePositives;
    if (metric.precision !== null && metric.precision < GATES.perCategoryPrecision) {
      failures.push(
        `category ${metric.category} precision ${metric.truePositives}/${predicted} < ${pct(GATES.perCategoryPrecision)}`,
      );
    }
  }
  if (overall.maxCategoriesAssigned > MAX_CATEGORIES_PER_CASE) {
    failures.push(
      `a case carried ${overall.maxCategoriesAssigned} categories, above the cap of ${MAX_CATEGORIES_PER_CASE}`,
    );
  }
  return failures;
}

// ── Fixture validation ──────────────────────────────────────────────────────

/**
 * Structural validation of the fixture. A gold set that has silently lost its
 * evaluation rows, gained a duplicate case, or acquired an unknown category id
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
    if (row.split !== 'development' && row.split !== 'evaluation') {
      problems.push(`${where}: unknown split ${String(row.split)}`);
    }
    if (typeof row.productText !== 'string' || row.productText.trim() === '') {
      problems.push(`${where}: empty productText`);
    }
    if (!Array.isArray(row.expected)) {
      problems.push(`${where}: expected must be an array`);
      continue;
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

  for (const split of ['development', 'evaluation'] as const) {
    const rows = goldSet.rows.filter((row) => row.split === split);
    if (rows.length === 0) {
      problems.push(`${split} split is empty — evaluation cannot be silently omitted`);
      continue;
    }
    for (const agency of ['FDA', 'FSIS'] as const) {
      if (!rows.some((row) => row.agency === agency)) {
        problems.push(`${split} split has no ${agency} rows`);
      }
    }
    for (const category of FOOD_CATEGORY_IDS) {
      if (!rows.some((row) => row.expected.includes(category))) {
        problems.push(`${split} split has no rows expecting ${category}`);
      }
    }
    if (!rows.some((row) => row.expected.length === 0)) {
      problems.push(`${split} split has no uncategorized rows`);
    }
    if (!rows.some((row) => row.expected.length > 1)) {
      problems.push(`${split} split has no multi-category rows`);
    }
  }
  return problems;
}
