/**
 * Food-category matcher QA (Phase C5.3B).
 *
 *   npm run qa:categories
 *
 * Measures the deterministic matcher against the reviewed gold set. Offline
 * and read-only: the fixture is committed, so this needs no database, no
 * network and no credentials, and it produces the same numbers on any machine.
 *
 * Development and locked-evaluation results are printed SEPARATELY and never
 * summed. The development split is what the lexicon was written against, so
 * its accuracy is a debugging aid, not a claim. Only the evaluation split
 * gates, and only the evaluation split may be quoted as the matcher's accuracy.
 *
 * Exits non-zero when any required threshold is missed, when the fixture fails
 * structural validation, or when the matcher is not deterministic.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  evaluateRows,
  gateFailures,
  GATES,
  predict,
  validateGoldSet,
  type CategoryEvaluation,
  type GoldRow,
  type GoldSet,
} from '../src/domain/category-evaluation';
import { foodCategoryLabel, FOOD_CATEGORIES } from '../src/domain/food-category';
import type { SourceAgency } from '../src/domain/recall-types';

const FIXTURE = path.join(__dirname, '..', 'src', 'domain', 'fixtures', 'category-gold-set.json');

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
    const agencyEval = evaluateRows(subset, evaluation.split as never);
    console.log(
      `  ${agency.padEnd(5)} exact-set ${pct(agencyEval.exactSetAccuracy)} (${agencyEval.exactSetMatches}/${agencyEval.total})  precision ${pct(agencyEval.microPrecision)}  recall ${pct(agencyEval.microRecall)}`,
    );
  }

  console.log(`\n  per category (support = reviewed occurrences):`);
  console.log(
    `    ${'category'.padEnd(14)} ${'support'.padStart(7)} ${'TP'.padStart(4)} ${'FP'.padStart(4)} ${'FN'.padStart(4)}  precision      recall`,
  );
  for (const metric of evaluation.perCategory) {
    const predicted = metric.truePositives + metric.falsePositives;
    const thin = metric.support < GATES.perCategoryMinSupport ? ' ‹thin sample›' : '';
    console.log(
      `    ${metric.category.padEnd(14)} ${String(metric.support).padStart(7)} ${String(metric.truePositives).padStart(4)} ${String(metric.falsePositives).padStart(4)} ${String(metric.falseNegatives).padStart(4)}  ` +
        `${metric.precision === null ? '     —' : pct(metric.precision).padStart(6)} ${`(${metric.truePositives}/${predicted})`.padEnd(9)} ` +
        `${metric.recall === null ? '     —' : pct(metric.recall).padStart(6)} (${metric.truePositives}/${metric.support})${thin}`,
    );
  }

  if (evaluation.failures.length > 0) {
    console.log(`\n  failures (${evaluation.failures.length}):`);
    for (const failure of evaluation.failures) {
      const label = (ids: string[]) => (ids.length === 0 ? '‹none›' : ids.join('+'));
      console.log(
        `    ${failure.caseId.slice(0, 8)} [${failure.agency}] ${failure.sourceId.slice(0, 22).padEnd(22)} ${failure.productText.replace(/\s+/g, ' ').slice(0, 62)}`,
      );
      console.log(
        `      expected ${label(failure.expected).padEnd(34)} actual ${label(failure.actual)}` +
          (failure.overClassified.length > 0
            ? `  · over: ${failure.overClassified.join('+')}`
            : '') +
          (failure.missed.length > 0 ? `  · missed: ${failure.missed.join('+')}` : ''),
      );
      if (failure.note) console.log(`      note: ${failure.note}`);
    }
  }
}

function main(): void {
  const goldSet: GoldSet = JSON.parse(readFileSync(FIXTURE, 'utf8'));

  console.log(
    `Food-category matcher QA — gold set v${goldSet.version}, recorded ${goldSet.recordedAt}`,
  );
  console.log(
    `Vocabulary (${FOOD_CATEGORIES.length}): ${FOOD_CATEGORIES.map((c) => foodCategoryLabel(c.id)).join(' · ')}`,
  );

  const problems = validateGoldSet(goldSet);
  if (problems.length > 0) {
    console.log(`\nFIXTURE INVALID:`);
    for (const problem of problems) console.log(`  · ${problem}`);
    process.exitCode = 1;
    return;
  }

  const development = goldSet.rows.filter((row) => row.split === 'development');
  const evaluation = goldSet.rows.filter((row) => row.split === 'evaluation');

  printEvaluation(
    'DEVELOPMENT (lexicon was written against these — not a claim)',
    evaluateRows(development, 'development'),
    development,
  );

  const locked = evaluateRows(evaluation, 'evaluation');
  printEvaluation("LOCKED EVALUATION (the matcher's accuracy)", locked, evaluation);

  // Determinism: the same rows must produce byte-identical output twice.
  const once = goldSet.rows.map((row) => predict(row).join('+'));
  const twice = goldSet.rows.map((row) => predict(row).join('+'));
  const nondeterministic = once.filter((value, index) => value !== twice[index]).length;

  const byAgency = (['FDA', 'FSIS'] as SourceAgency[]).map((agency) => ({
    agency,
    evaluation: evaluateRows(
      evaluation.filter((row) => row.agency === agency),
      'evaluation',
    ),
  }));
  const failures = gateFailures(locked, byAgency);
  if (nondeterministic > 0)
    failures.push(`${nondeterministic} rows produced different output on a repeat run`);

  console.log(`\n── GATES (locked evaluation) ─────────────────────────────────`);
  console.log(
    `  determinism: ${nondeterministic === 0 ? 'stable across repeated runs' : 'UNSTABLE'}`,
  );
  if (failures.length === 0) {
    console.log(`  PASS — every required threshold met.`);
  } else {
    console.log(`  FAIL:`);
    for (const failure of failures) console.log(`    · ${failure}`);
    process.exitCode = 1;
  }
}

main();
