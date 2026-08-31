/**
 * Category launch gate (Phase C10B).
 *
 *   npm run qa:categories
 *
 * ## Why this file exists instead of an edit to scripts/qa-categories.ts
 *
 * `scripts/qa-categories.ts` is a FROZEN harness file: its sha256 is recorded
 * in `category-freeze-manifest.json` alongside the classifier's, because
 * C10A.1 proved a harness edited after a run can move a headline number by
 * three points as easily as a classifier can. Editing it to change what it
 * prints or what it exits with would break the very hash the freeze exists to
 * protect, and "the freeze broke because we relabelled a section" is
 * indistinguishable, months later, from "the freeze broke because someone
 * tuned the classifier".
 *
 * So the frozen report is not rewritten — it is RUN, verbatim, and reprinted
 * below in full. Every measured number a reader sees is the frozen harness's
 * own output, byte for byte. This file adds three things around it and changes
 * none of them:
 *
 *   1. the founder-accepted launch baseline, stated plainly;
 *   2. the former ≥90% / ≥95% thresholds explicitly relabelled as research
 *      benchmarks that were NOT met, and that gate nothing;
 *   3. a launch gate that CAN pass — and that fails loudly for the things
 *      that would actually make the shipped filter unsafe.
 *
 * ## What the launch gate checks, and why those five
 *
 * The accepted product decision (docs/recall-food-categories.md) is that
 * Category is an optional discovery filter over All Recalls: it never decides
 * an alert, never changes what exists, and every recall stays reachable with
 * it cleared. Under that framing the question "is 87.5% enough?" was answered
 * once, by a human, with the evidence in front of them. It is not re-litigated
 * on every run, and re-asserting a 90% bar the classifier does not meet would
 * make this command permanently red while telling nobody anything new.
 *
 * What CAN change without anyone noticing, and therefore what is gated:
 *
 *   · the classifier or harness quietly drifting from what was measured
 *     (freeze hashes);
 *   · the derivation becoming non-deterministic (same rows, twice);
 *   · the reviewed "placed where no shopper would look" rate exceeding the
 *     ≤3% ceiling that was frozen BEFORE the run;
 *   · Category leaking into relevance, ranking, risk, Affects Me, push or
 *     material-change detection (the production invariance suites);
 *   · the launch-visible allowlist changing without a product decision.
 *
 * A regression in any of those is a NEW fact. The accuracy number is not.
 *
 * ## What this command must never do
 *
 * It must never restate 87.5% as ≥90%, merge a compact vocabulary to flatter
 * the number, re-score a spent holdout, or claim accuracy sufficient for
 * anything a consumer's health depends on. The measured figures are printed
 * unchanged and the shortfall against both research bars is printed with them.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  atLeastOneCorrect,
  evaluateRows,
  FINAL_SPLIT,
  predict,
  UNFINDABLE_RATE_LIMIT,
  unfindableBaseline,
  type GoldSet,
  type ReviewedUnfindable,
} from '../src/domain/category-evaluation';
import { foodCategoryLabel } from '../src/domain/food-category';
import {
  HIDDEN_LAUNCH_CATEGORY_IDS,
  LAUNCH_CATEGORY_IDS,
} from '../src/domain/food-category-launch';

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(ROOT, 'src', 'domain', 'fixtures', 'category-gold-set.json');
const MANIFEST = path.join(ROOT, 'src', 'domain', 'fixtures', 'category-freeze-manifest.json');
const FROZEN_REPORT = path.join(ROOT, 'scripts', 'qa-categories.ts');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const rule = (title: string) => `\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`;

/**
 * The launch-visible allowlist, pinned here as literal text.
 *
 * Deliberately duplicated rather than imported-and-compared-to-itself: an
 * assertion that reads the same array it is checking cannot fail. This is the
 * founder-approved list, and a change to it must show up as a QA failure that
 * a human then either accepts (by editing this line, with a reason) or fixes.
 */
const APPROVED_LAUNCH_LIST =
  'produce=Fruits & vegetables | meat_poultry=Meat & poultry | seafood=Seafood | ' +
  'dairy_eggs=Dairy & eggs | bakery_grains=Bakery | snacks_sweets=Snacks & sweets | ' +
  'beverages=Beverages | pantry_condiments=Pantry & staples | ' +
  'baby_food_formula=Baby food & formula';

const APPROVED_HIDDEN_LIST = 'prepared_foods | supplements | other';

/** The production invariance suites, run as themselves rather than restated. */
const INVARIANCE_SUITES = [
  'src/lib/category-invariance.test.ts',
  'src/lib/category-filter.test.ts',
  'src/domain/food-category-launch.test.ts',
  'src/domain/product-categories-projection.test.ts',
  'src/domain/category-evaluation.test.ts',
];

function verifyFreeze(manifest: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const hashed = (files: Record<string, string> | undefined, kind: string) => {
    for (const [file, expected] of Object.entries(files ?? {})) {
      const actual = createHash('sha256')
        .update(readFileSync(path.join(ROOT, file)))
        .digest('hex');
      if (actual !== expected) {
        problems.push(`${file} no longer matches its frozen hash — the ${kind} changed`);
      }
    }
  };
  hashed(manifest.classifierFiles as Record<string, string>, 'classifier');
  hashed(manifest.harnessFiles as Record<string, string>, 'evaluation harness');

  const goldSet: GoldSet = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const labelText = goldSet.rows
    .filter((row) => row.split === FINAL_SPLIT)
    .map((row) => `${row.caseId}:${row.expected.join('+')}`)
    .sort()
    .join('\n');
  const labelHash = createHash('sha256').update(labelText).digest('hex');
  if (labelHash !== manifest.finalLabelsSha256) {
    problems.push('final-split expected labels no longer match the frozen label hash');
  }
  return problems;
}

function main(): void {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const goldSet: GoldSet = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const natural = goldSet.rows.filter((row) => row.split === FINAL_SPLIT);

  console.log(`${'═'.repeat(72)}`);
  console.log(`Category launch gate (C10B) — frozen classifier ${manifest.phase}`);
  console.log(`${'═'.repeat(72)}`);

  // ── 1. The frozen report, verbatim ────────────────────────────────────────
  console.log(rule('FROZEN MEASUREMENT REPORT (scripts/qa-categories.ts, unmodified)'));
  console.log(`  Reproduced below exactly as the frozen harness prints it. Its own exit`);
  console.log(`  code is informational here: it encodes the RESEARCH gates, which were`);
  console.log(`  not met and which no longer gate release. Nothing below is re-derived,`);
  console.log(`  re-scored, re-labelled, or merged.\n`);

  const frozen = spawnSync(TSX, [FROZEN_REPORT], { encoding: 'utf8', cwd: ROOT });
  if (frozen.error || frozen.stdout === null) {
    console.log(`  COULD NOT RUN THE FROZEN REPORT: ${frozen.error?.message ?? 'no output'}`);
    console.log(`\n  FAIL — the measurement of record could not be reproduced.\n`);
    process.exitCode = 1;
    return;
  }
  console.log(
    frozen.stdout
      .trimEnd()
      .split('\n')
      .map((line) => `  │ ${line}`)
      .join('\n'),
  );
  if (frozen.stderr.trim() !== '') console.log(`  │ [stderr] ${frozen.stderr.trim()}`);
  console.log(`  └─ frozen harness exit code: ${frozen.status} (informational — see above)`);

  // ── 2. The numbers, recomputed from the same frozen arithmetic ────────────
  const evaluation = evaluateRows(natural, FINAL_SPLIT);
  const discovery = atLeastOneCorrect(natural);
  const discoveryRate = discovery.total === 0 ? 0 : discovery.matched / discovery.total;
  const reviewed: ReviewedUnfindable[] = manifest.finalReview?.unfindable ?? [];
  const unfindable = unfindableBaseline(reviewed, natural);

  console.log(rule('FOUNDER-ACCEPTED FROZEN LAUNCH BASELINE'));
  console.log(`  The C10A.2 classifier is FINAL for launch. It is shipped as an optional`);
  console.log(`  discovery filter, on an explicit product decision recorded in`);
  console.log(`  docs/recall-food-categories.md, with these measured numbers and no others:\n`);
  console.log(
    `    exact category-set accuracy   ${pct(evaluation.exactSetAccuracy)}  (${evaluation.exactSetMatches}/${evaluation.total})`,
  );
  console.log(
    `    at-least-one-correct          ${pct(discoveryRate)}  (${discovery.matched}/${discovery.total})`,
  );
  console.log(
    `    micro precision / recall      ${pct(evaluation.microPrecision)} / ${pct(evaluation.microRecall)}`,
  );
  console.log(
    `    human-reviewed unreasonable   ${pct(unfindable.rate)}  (${unfindable.matched}/${unfindable.total})  ← the one that decided it`,
  );
  console.log(`\n  Why high-80s was accepted for THIS purpose:`);
  console.log(`    · a miscategorized card is a discovery MISS, with the entire unfiltered`);
  console.log(`      feed, search, Affects Me, risk and notifications still behind it;`);
  console.log(`    · only 1.0% of the final holdout was placed somewhere a reasonable`);
  console.log(`      shopper would never look — the rest of the error is a near-miss`);
  console.log(`      between two adjacent aisles;`);
  console.log(`    · the dominant failure is one boundary, Prepared foods vs Meat &`);
  console.log(`      poultry, and Prepared foods is HIDDEN from the launch filter for`);
  console.log(`      exactly that reason;`);
  console.log(`    · Category is not a completeness or safety boundary, and`);
  console.log(`      category-invariance.test.ts proves it structurally cannot become one.`);
  console.log(`\n  What this baseline does NOT license:`);
  console.log(`    · no future accuracy claim without NEW independent evidence — a newly`);
  console.log(`      drawn holdout, labelled blind. This corpus has no untouched 200 left,`);
  console.log(`      so such a claim requires corpus growth, not re-scoring;`);
  console.log(`    · no relaxation of the personalization or notification bars, which are`);
  console.log(`      separate, stricter, and share no threshold with this one;`);
  console.log(`    · no rewriting of an old label to make an old number better.`);

  // ── 3. The research benchmarks, explicitly not met, explicitly not gates ──
  console.log(rule('RESEARCH BENCHMARKS — NOT MET, AND NOT RELEASE GATES'));
  console.log(`  Retained verbatim for comparison and never weakened. A benchmark that was`);
  console.log(`  missed stays missed; it is recorded as history, not converted into a pass.\n`);
  for (const [name, bar] of [
    ['original research bar', 0.95],
    ['C10A.2 milestone bar', 0.9],
  ] as const) {
    const verdict = evaluation.exactSetAccuracy >= bar ? 'met' : 'NOT MET';
    console.log(
      `    ${name.padEnd(24)} ≥${pct(bar)} exact-set   →  ${verdict}  (measured ${pct(evaluation.exactSetAccuracy)})`,
    );
  }
  console.log(`\n  The full per-gate shortfall against both bars is printed in the frozen`);
  console.log(`  report above and is not restated here in a friendlier form.`);

  // ── 4. The launch gate ────────────────────────────────────────────────────
  const failures: string[] = [];

  const freezeProblems = verifyFreeze(manifest);
  failures.push(...freezeProblems);

  const once = goldSet.rows.map((row) => predict(row).join('+'));
  const twice = goldSet.rows.map((row) => predict(row).join('+'));
  const nondeterministic = once.filter((value, index) => value !== twice[index]).length;
  if (nondeterministic > 0) {
    failures.push(`${nondeterministic} row(s) predicted differently on a repeated run`);
  }

  if (unfindable.rate > UNFINDABLE_RATE_LIMIT) {
    failures.push(
      `reviewed unreasonable-placement baseline ${pct(unfindable.rate)} > ${pct(UNFINDABLE_RATE_LIMIT)}`,
    );
  }
  failures.push(...unfindable.problems);

  const launchList = LAUNCH_CATEGORY_IDS.map((id) => `${id}=${foodCategoryLabel(id)}`).join(' | ');
  const hiddenList = HIDDEN_LAUNCH_CATEGORY_IDS.join(' | ');
  if (launchList !== APPROVED_LAUNCH_LIST) {
    failures.push(
      `launch-visible allowlist changed:\n        was ${APPROVED_LAUNCH_LIST}\n        now ${launchList}`,
    );
  }
  if (hiddenList !== APPROVED_HIDDEN_LIST) {
    failures.push(
      `hidden category list changed: was "${APPROVED_HIDDEN_LIST}", now "${hiddenList}"`,
    );
  }

  const invariance = spawnSync(TSX, ['--test', ...INVARIANCE_SUITES], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  const invariancePassed = invariance.status === 0;
  if (!invariancePassed) {
    failures.push(`production invariance suites failed (exit ${invariance.status})`);
  }

  console.log(rule('LAUNCH GATE (blocking — this decides the exit code)'));
  const line = (ok: boolean, label: string, detail: string) =>
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(44)} ${detail}`);
  line(
    freezeProblems.length === 0,
    'frozen classifier / harness / label hashes',
    freezeProblems.length === 0 ? 'match the manifest' : `${freezeProblems.length} mismatch(es)`,
  );
  line(
    nondeterministic === 0,
    'deterministic output',
    nondeterministic === 0 ? 'stable across repeated runs' : `${nondeterministic} unstable row(s)`,
  );
  line(
    unfindable.rate <= UNFINDABLE_RATE_LIMIT && unfindable.problems.length === 0,
    'reviewed unreasonable placement',
    `${pct(unfindable.rate)} (gate ≤${pct(UNFINDABLE_RATE_LIMIT)})`,
  );
  line(
    invariancePassed,
    'production invariance suites',
    `${INVARIANCE_SUITES.length} suite(s), exit ${invariance.status}`,
  );
  line(
    launchList === APPROVED_LAUNCH_LIST && hiddenList === APPROVED_HIDDEN_LIST,
    'launch-visible allowlist unchanged',
    `${LAUNCH_CATEGORY_IDS.length} visible, ${HIDDEN_LAUNCH_CATEGORY_IDS.length} hidden`,
  );

  if (!invariancePassed) {
    console.log(`\n  invariance output:\n${invariance.stdout?.trimEnd() ?? ''}`);
  }

  console.log(rule('VERDICT'));
  if (failures.length === 0) {
    console.log(`  PASS — the shipped classifier is the one that was measured and accepted,`);
    console.log(`  it is deterministic, it cannot reach anything a consumer's safety depends`);
    console.log(`  on, and the launch filter offers exactly the approved nine aisles.`);
    console.log(
      `\n  This is NOT a claim that categorization is ≥90% accurate. It is ${pct(evaluation.exactSetAccuracy)},`,
    );
    console.log(`  the research bars were not met, and Category is shipped anyway as an`);
    console.log(`  optional discovery aid over a feed that stays complete without it.\n`);
  } else {
    console.log(`  FAIL — ${failures.length} launch condition(s) breached:`);
    for (const failure of failures) console.log(`    · ${failure}`);
    console.log('');
    process.exitCode = 1;
  }
}

main();
