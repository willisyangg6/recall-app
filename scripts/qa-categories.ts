/**
 * Food-category matcher QA (Phases C5.3B-2 … C10A.2).
 *
 *   npm run qa:categories
 *
 * Measures the FROZEN deterministic matcher against the reviewed gold set.
 * Offline and read-only: the fixture is committed, so this needs no database,
 * no network and no credentials, and it produces the same numbers on any
 * machine.
 *
 * Report structure:
 *   1. freeze integrity — the classifier AND HARNESS files must still hash to
 *      the values recorded BEFORE the final holdout was selected, and the
 *      final labels must still hash to the value frozen before the single run
 *   2. development cross-validation — stability only, never a claim
 *   3. the natural holdout, twelve categories — THE accuracy
 *   4. compact seven-category diagnostic on the same frozen predictions
 *
 * Exit code: 0 only when the twelve-category matcher passes the blocking
 * product gates (GREEN). A compact-only pass remains a product-decision
 * YELLOW and exits 1.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  atLeastOneCorrect,
  crossValidate,
  evaluateCompactRows,
  evaluateRows,
  FINAL_SPLIT,
  finalVerdict,
  gateFailures,
  GATES,
  PRODUCT_GATES,
  UNFINDABLE_RATE_LIMIT,
  unfindableBaseline,
  predict,
  validateGoldSet,
  type CategoryEvaluation,
  type GoldRow,
  type GoldSet,
  type ReviewedUnfindable,
} from '../src/domain/category-evaluation';
import { foodCategoryLabel, FOOD_CATEGORIES } from '../src/domain/food-category';
import type { SourceAgency } from '../src/domain/recall-types';

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(ROOT, 'src', 'domain', 'fixtures', 'category-gold-set.json');
const MANIFEST = path.join(ROOT, 'src', 'domain', 'fixtures', 'category-freeze-manifest.json');

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

function printEvaluation(title: string, evaluation: CategoryEvaluation, rows: GoldRow[]): void {
  console.log(`\n── ${title} (${evaluation.total} cases) ─────────────────────────────`);
  console.log(
    `  exact category-set accuracy  ${pct(evaluation.exactSetAccuracy)}  (${evaluation.exactSetMatches}/${evaluation.total})`,
  );
  console.log(`  micro precision              ${pct(evaluation.microPrecision)}`);
  console.log(`  micro recall                 ${pct(evaluation.microRecall)}`);
  console.log(
    `  categorized coverage         ${pct(evaluation.categorizedCoverage)}  (${evaluation.categorized}/${evaluation.total})`,
  );
  console.log(
    `  zero-category   expected ${evaluation.expectedZero}  ·  assigned ${evaluation.actualZero}`,
  );
  console.log(
    `  multi-category  expected ${evaluation.expectedMulti}  ·  assigned ${evaluation.actualMulti}  ·  max assigned ${evaluation.maxCategoriesAssigned}`,
  );
  console.log(
    `  over-classifications ${evaluation.overClassifications}  ·  missed categories ${evaluation.missedCategories}`,
  );

  for (const agency of ['FDA', 'FSIS'] as SourceAgency[]) {
    const subset = rows.filter((row) => row.agency === agency);
    if (subset.length === 0) continue;
    const agencyEval = evaluateRows(subset, evaluation.split);
    console.log(
      `  ${agency.padEnd(5)} exact-set ${pct(agencyEval.exactSetAccuracy)} (${agencyEval.exactSetMatches}/${agencyEval.total})  precision ${pct(agencyEval.microPrecision)}  recall ${pct(agencyEval.microRecall)}`,
    );
  }

  console.log(`\n  per category (support = reviewed occurrences):`);
  for (const metric of evaluation.perCategory) {
    const predicted = metric.truePositives + metric.falsePositives;
    const minSupport = GATES.perCategoryMinSupport ?? 5;
    const thin = metric.support < minSupport ? ' ‹thin sample›' : '';
    console.log(
      `    ${metric.category.padEnd(15)} ${String(metric.support).padStart(4)}  ` +
        `precision ${metric.precision === null ? '     —' : pct(metric.precision).padStart(6)} ${`(${metric.truePositives}/${predicted})`.padEnd(9)} ` +
        `recall ${metric.recall === null ? '     —' : pct(metric.recall).padStart(6)} (${metric.truePositives}/${metric.support})${thin}`,
    );
  }

  if (evaluation.failures.length > 0) {
    console.log(`\n  failures (${evaluation.failures.length}):`);
    for (const failure of evaluation.failures) {
      const label = (ids: string[]) => (ids.length === 0 ? '‹none›' : ids.join('+'));
      console.log(
        `    ${failure.caseId.slice(0, 8)} [${failure.agency}] ${failure.productText.replace(/\s+/g, ' ').slice(0, 74)}`,
      );
      console.log(
        `      expected ${label(failure.expected).padEnd(34)} actual ${label(failure.actual)}`,
      );
      if (failure.note) console.log(`      note: ${failure.note}`);
    }
  }
}

function verifyFreeze(): string[] {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const problems: string[] = [];
  const hashed = (files: Record<string, string> | undefined, kind: string) => {
    for (const [file, expected] of Object.entries(files ?? {})) {
      const actual = createHash('sha256')
        .update(readFileSync(path.join(ROOT, file)))
        .digest('hex');
      if (actual !== expected) {
        problems.push(
          `${file} no longer matches its frozen hash — the ${kind} changed after the freeze`,
        );
      }
    }
  };
  hashed(manifest.classifierFiles, 'classifier');
  // C10A.1's headline number moved three points because of a HARNESS defect,
  // not a classifier one. The harness is therefore frozen the same way.
  hashed(manifest.harnessFiles, 'evaluation harness');

  const goldSet: GoldSet = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const labelHash = createHash('sha256').update(finalLabelText(goldSet)).digest('hex');
  if (labelHash !== manifest.finalLabelsSha256) {
    problems.push('final-split expected labels no longer match the frozen label hash');
  }
  return problems;
}

/** The exact bytes `finalLabelsSha256` is taken over. */
export function finalLabelText(goldSet: GoldSet): string {
  return goldSet.rows
    .filter((row) => row.split === FINAL_SPLIT)
    .map((row) => `${row.caseId}:${row.expected.join('+')}`)
    .sort()
    .join('\n');
}

function main(): void {
  const goldSet: GoldSet = JSON.parse(readFileSync(FIXTURE, 'utf8'));

  console.log(
    `Food-category matcher QA — gold set v${goldSet.version}, recorded ${goldSet.recordedAt}`,
  );
  console.log(
    `Vocabulary (${FOOD_CATEGORIES.length}): ${FOOD_CATEGORIES.map((c) => foodCategoryLabel(c.id)).join(' · ')}`,
  );

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const freezeProblems = verifyFreeze();
  console.log(`\n── FREEZE INTEGRITY ──────────────────────────────────────────`);
  if (freezeProblems.length === 0) {
    console.log(`  classifier hashes, harness hashes and the final-label hash match the manifest`);
  } else {
    for (const problem of freezeProblems) console.log(`  · ${problem}`);
  }

  const problems = validateGoldSet(goldSet, manifest.holdout?.uncoverableCategories ?? []);
  if (problems.length > 0) {
    console.log(`\nFIXTURE INVALID:`);
    for (const problem of problems) console.log(`  · ${problem}`);
    process.exitCode = 1;
    return;
  }

  const development = goldSet.rows.filter((row) => row.split === 'development');
  const natural = goldSet.rows.filter((row) => row.split === FINAL_SPLIT);

  // Development: cross-validation stability, never a claim.
  const cv = crossValidate(development, 5);
  console.log(
    `\n── DEVELOPMENT 5-FOLD CV (tuned on all ${development.length} rows — stability, not a claim) ──`,
  );
  for (const fold of cv.folds) {
    console.log(
      `  ${fold.split}: n=${fold.total}  exact ${pct(fold.exactSetAccuracy)} (${fold.exactSetMatches}/${fold.total})  P ${pct(fold.microPrecision)}  R ${pct(fold.microRecall)}`,
    );
  }
  console.log(
    `  mean ${pct(cv.meanExactSet)} · min ${pct(cv.minExactSet)} · max ${pct(cv.maxExactSet)} · stdev ${(cv.stdevExactSet * 100).toFixed(2)}pp`,
  );

  const naturalEval = evaluateRows(natural, FINAL_SPLIT);
  printEvaluation('FINAL NATURAL HOLDOUT — twelve categories (THE accuracy)', naturalEval, natural);

  // Compact diagnostic: same frozen predictions and labels, merged 12 → 7.
  const naturalCompact = evaluateCompactRows(natural, 'final natural compact');
  console.log(`\n── COMPACT 7-CATEGORY DIAGNOSTIC (predeclared merge; no re-prediction) ──`);
  console.log(
    `  natural   exact ${pct(naturalCompact.exactSetAccuracy)} (${naturalCompact.exactSetMatches}/${naturalCompact.total})  P ${pct(naturalCompact.microPrecision)}  R ${pct(naturalCompact.microRecall)}`,
  );
  const compactByAgency = (rows: GoldRow[]) =>
    (['FDA', 'FSIS'] as SourceAgency[]).map((agency) => ({
      agency,
      evaluation: evaluateCompactRows(
        rows.filter((row) => row.agency === agency),
        'compact',
      ),
    }));
  for (const { agency, evaluation } of compactByAgency(natural)) {
    console.log(
      `  natural ${agency.padEnd(5)} exact ${pct(evaluation.exactSetAccuracy)} (${evaluation.exactSetMatches}/${evaluation.total})`,
    );
  }

  // Determinism: the same rows must produce byte-identical output twice.
  const once = goldSet.rows.map((row) => predict(row).join('+'));
  const twice = goldSet.rows.map((row) => predict(row).join('+'));
  const nondeterministic = once.filter((value, index) => value !== twice[index]).length;

  const byAgency = (rows: GoldRow[]) =>
    (['FDA', 'FSIS'] as SourceAgency[]).map((agency) => ({
      agency,
      evaluation: evaluateRows(
        rows.filter((row) => row.agency === agency),
        'final',
      ),
    }));

  const naturalFailures = gateFailures(naturalEval, byAgency(natural), GATES);
  const compactNaturalFailures = gateFailures(naturalCompact, compactByAgency(natural), GATES);

  console.log(`\n── PRODUCT REGRESSION GATES (blocking) ───────────────────────`);
  console.log(`  These decide PASS/FAIL and the exit code. They are the bar the founder`);
  console.log(`  accepted for Category as an OPTIONAL DISCOVERY filter, and they are`);
  console.log(`  deliberately lower than the personalization/notification bar — Category`);
  console.log(`  never decides an alert. They check that the shipped classifier still`);
  console.log(`  behaves like the one that was measured; they are NOT a claim of accuracy`);
  console.log(`  sufficient for anything a consumer's health depends on.\n`);

  const productNatural = gateFailures(naturalEval, byAgency(natural), PRODUCT_GATES);
  const discovery = atLeastOneCorrect(natural);
  const discoveryRate = discovery.total === 0 ? 0 : discovery.matched / discovery.total;
  const reviewed: ReviewedUnfindable[] = manifest.finalReview?.unfindable ?? [];
  const unfindable = unfindableBaseline(reviewed, natural);

  const productFailures = [...productNatural];
  if (discoveryRate < 0.9) {
    productFailures.push(`at-least-one-correct ${(discoveryRate * 100).toFixed(1)}% < 90.0%`);
  }
  if (unfindable.rate > UNFINDABLE_RATE_LIMIT) {
    productFailures.push(
      `frozen human-reviewed unfindable baseline ${(unfindable.rate * 100).toFixed(1)}% > ${(UNFINDABLE_RATE_LIMIT * 100).toFixed(1)}%`,
    );
  }
  productFailures.push(...unfindable.problems);

  console.log(`  natural exact-set        ${pct(naturalEval.exactSetAccuracy)}  (gate ≥90.0%)`);
  console.log(
    `  at-least-one-correct     ${pct(discoveryRate)}  (gate ≥90.0%)  ${discovery.matched}/${discovery.total}`,
  );
  console.log(
    `  micro precision / recall ${pct(naturalEval.microPrecision)} / ${pct(naturalEval.microRecall)}  (gate ≥90.0%)`,
  );
  console.log(
    `  determinism              ${nondeterministic === 0 ? 'stable across repeated runs' : `UNSTABLE (${nondeterministic} rows)`}`,
  );
  console.log(
    `  per-category floor       precision and recall ≥80.0% for every category with support ≥${PRODUCT_GATES.perCategoryMinSupport}`,
  );
  for (const metric of naturalEval.perCategory) {
    if (metric.support < (PRODUCT_GATES.perCategoryMinSupport ?? 20)) continue;
    const predicted = metric.truePositives + metric.falsePositives;
    console.log(
      `    ${metric.category.padEnd(17)} support ${String(metric.support).padStart(3)}  ` +
        `precision ${pct(metric.precision ?? 0)} (${metric.truePositives}/${predicted})  ` +
        `recall ${pct(metric.recall ?? 0)} (${metric.truePositives}/${metric.support})`,
    );
  }

  console.log(`\n  Frozen human-reviewed unfindable baseline`);
  console.log(
    `    ${pct(unfindable.rate)}  (gate ≤${(UNFINDABLE_RATE_LIMIT * 100).toFixed(1)}%)  ${unfindable.matched}/${unfindable.total} cases placed where no reasonable shopper would look`,
  );
  console.log(`    This assertion verifies the frozen manifest, the recorded case ids, their`);
  console.log(`    reasoning records and the arithmetic. It CANNOT detect a NEW unfindable`);
  console.log(`    error introduced by a future classifier change — "would a shopper look`);
  console.log(`    here?" is a human judgement that is not present in the data. Refreshing`);
  console.log(`    this measurement requires a LATER milestone to review a NEWLY DRAWN`);
  console.log(`    holdout, and this corpus has no untouched 200 left to draw one from.`);
  for (const record of reviewed) {
    console.log(`      · ${record.caseId.slice(0, 8)} ${record.reason}`);
  }

  const report = (name: string, failures: string[]) => {
    if (failures.length === 0) console.log(`\n  ${name}: PASS`);
    else {
      console.log(`\n  ${name}: FAIL`);
      for (const failure of failures) console.log(`    · ${failure}`);
    }
  };
  report('PRODUCT REGRESSION GATES', productFailures);

  // ── Informational only, never PASS/FAIL ─────────────────────────────────
  //
  // The 95% research threshold is the bar this classifier was built against
  // and did not clear. Every number is preserved, but it is not rendered as a
  // failure: a non-blocking benchmark printed as FAIL beside a zero exit code
  // is operationally confusing, and the honest record is the number itself,
  // not the word.
  const informational = (name: string, shortfalls: string[]) => {
    console.log(`  ${name}`);
    if (shortfalls.length === 0) console.log(`    · threshold met`);
    for (const shortfall of shortfalls) console.log(`    · ${shortfall}`);
  };

  console.log(`\n── LEGACY RESEARCH BENCHMARK: NOT MET (informational) ────────`);
  console.log(`  The original 95% research threshold, retained for comparison and never`);
  console.log(`  weakened. It does not gate anything and does not affect the exit code.\n`);
  informational('natural (95%)', naturalFailures);
  informational('compact natural diagnostic (95%)', compactNaturalFailures);

  const researchVerdict = finalVerdict({
    primaryNaturalFailures: naturalFailures,
    compactNaturalFailures,
    deterministic: nondeterministic === 0,
    freezeIntact: freezeProblems.length === 0,
  });
  console.log(
    `\n  Legacy research verdict (informational): ${researchVerdict} — ${pct(naturalEval.exactSetAccuracy)} natural exact-set against a 95% bar.`,
  );

  console.log(`\n── VERDICT ───────────────────────────────────────────────────`);
  const sound = nondeterministic === 0 && freezeProblems.length === 0;
  if (productFailures.length === 0 && sound) {
    console.log(`  PASS — the measured classifier still behaves as accepted.`);
    console.log(
      `  Category is integrated as an optional discovery filter only. See docs/recall-food-categories.md.`,
    );
  } else {
    console.log(
      `  FAIL — the classifier no longer matches the accepted measurement, or the freeze broke.`,
    );
    process.exitCode = 1;
  }
}

main();
