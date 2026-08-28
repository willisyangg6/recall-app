/**
 * Food-category matcher QA (Phase C5.3B-2).
 *
 *   npm run qa:categories
 *
 * Measures the FROZEN deterministic matcher against the reviewed gold set.
 * Offline and read-only: the fixture is committed, so this needs no database,
 * no network and no credentials, and it produces the same numbers on any
 * machine.
 *
 * Report structure:
 *   1. freeze integrity — the classifier files must still hash to the values
 *      recorded BEFORE the final holdout was selected, and the final labels
 *      must still hash to the value frozen before the matcher's single run
 *   2. development cross-validation — stability only, never a claim
 *   3. final natural holdout, eleven categories — THE accuracy (95% gates)
 *   4. final challenge holdout, eleven categories (90% gates)
 *   5. compact seven-category diagnostic on the same frozen predictions
 *
 * Exit code: 0 only when the ELEVEN-category matcher passes both final gates
 * (GREEN). A compact-only pass remains a product-decision YELLOW and exits 1.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
  for (const [file, expected] of Object.entries(
    manifest.classifierFiles as Record<string, string>,
  )) {
    const actual = createHash('sha256')
      .update(readFileSync(path.join(ROOT, file)))
      .digest('hex');
    if (actual !== expected) {
      problems.push(
        `${file} no longer matches its frozen hash — the classifier changed after the freeze`,
      );
    }
  }
  const goldSet: GoldSet = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const finalLabels = goldSet.rows
    .filter((row) => row.split === 'final_natural' || row.split === 'final_challenge')
    .map((row) => `${row.caseId}:${row.expected.join('+')}`)
    .sort()
    .join('\n');
  const labelHash = createHash('sha256').update(finalLabels).digest('hex');
  if (labelHash !== manifest.finalLabelsSha256) {
    problems.push('final-split expected labels no longer match the frozen label hash');
  }
  return problems;
}

function main(): void {
  const goldSet: GoldSet = JSON.parse(readFileSync(FIXTURE, 'utf8'));

  console.log(
    `Food-category matcher QA — gold set v${goldSet.version}, recorded ${goldSet.recordedAt}`,
  );
  console.log(
    `Vocabulary (${FOOD_CATEGORIES.length}): ${FOOD_CATEGORIES.map((c) => foodCategoryLabel(c.id)).join(' · ')}`,
  );

  const freezeProblems = verifyFreeze();
  console.log(`\n── FREEZE INTEGRITY ──────────────────────────────────────────`);
  if (freezeProblems.length === 0) {
    console.log(`  classifier hashes and final-label hash match the freeze manifest`);
  } else {
    for (const problem of freezeProblems) console.log(`  · ${problem}`);
  }

  const problems = validateGoldSet(goldSet);
  if (problems.length > 0) {
    console.log(`\nFIXTURE INVALID:`);
    for (const problem of problems) console.log(`  · ${problem}`);
    process.exitCode = 1;
    return;
  }

  const development = goldSet.rows.filter((row) => row.split === 'development');
  const natural = goldSet.rows.filter((row) => row.split === 'final_natural');
  const challenge = goldSet.rows.filter((row) => row.split === 'final_challenge');

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

  const naturalEval = evaluateRows(natural, 'final_natural');
  printEvaluation('FINAL NATURAL HOLDOUT — eleven categories (THE accuracy)', naturalEval, natural);

  const challengeEval = evaluateRows(challenge, 'final_challenge');
  printEvaluation('FINAL CHALLENGE HOLDOUT — eleven categories', challengeEval, challenge);

  // Compact diagnostic: same frozen predictions and labels, merged 11 → 7.
  const naturalCompact = evaluateCompactRows(natural, 'final_natural compact');
  const challengeCompact = evaluateCompactRows(challenge, 'final_challenge compact');
  console.log(`\n── COMPACT 7-CATEGORY DIAGNOSTIC (predeclared merge; no re-prediction) ──`);
  for (const [name, e] of [
    ['natural  ', naturalCompact],
    ['challenge', challengeCompact],
  ] as const) {
    console.log(
      `  ${name} exact ${pct(e.exactSetAccuracy)} (${e.exactSetMatches}/${e.total})  P ${pct(e.microPrecision)}  R ${pct(e.microRecall)}`,
    );
  }
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
  const challengeFailures = gateFailures(challengeEval, [], CHALLENGE_GATES);
  const compactNaturalFailures = gateFailures(naturalCompact, compactByAgency(natural), GATES);
  const compactChallengeFailures = gateFailures(challengeCompact, [], CHALLENGE_GATES);

  console.log(`\n── GATES ─────────────────────────────────────────────────────`);
  console.log(
    `  determinism: ${nondeterministic === 0 ? 'stable across repeated runs' : `UNSTABLE (${nondeterministic} rows)`}`,
  );
  const report = (name: string, failures: string[]) => {
    if (failures.length === 0) console.log(`  ${name}: PASS`);
    else {
      console.log(`  ${name}: FAIL`);
      for (const failure of failures) console.log(`    · ${failure}`);
    }
  };
  report('eleven-category natural (95%)', naturalFailures);
  report('eleven-category challenge (90%)', challengeFailures);
  report('compact natural diagnostic (95%)', compactNaturalFailures);
  report('compact challenge diagnostic (90%)', compactChallengeFailures);

  const verdict = finalVerdict({
    elevenNaturalFailures: naturalFailures,
    elevenChallengeFailures: challengeFailures,
    compactNaturalFailures,
    compactChallengeFailures,
    deterministic: nondeterministic === 0,
    freezeIntact: freezeProblems.length === 0,
  });

  console.log(`\n── VERDICT ───────────────────────────────────────────────────`);
  if (verdict === 'GREEN') {
    console.log(`  GREEN — the eleven-category matcher passed every final gate.`);
  } else if (verdict === 'YELLOW') {
    console.log(
      `  YELLOW — eleven categories failed, but the predeclared compact mapping passes on the same frozen predictions. Adopting seven categories is a founder decision; nothing is integrated.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `  NOT PASSING — neither the eleven-category vocabulary nor the compact diagnostic clears its gates. The matcher stays unintegrated.`,
    );
    process.exitCode = 1;
  }
}

main();
