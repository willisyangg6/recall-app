/**
 * Historical hazard-category correction (P2e-B) — an explicit maintenance
 * command, never scheduled and deliberately separate from production
 * ingestion.
 *
 *   npm run repair:hazards:dry                                   # report only, writes nothing
 *   npm run repair:hazards -- --apply --confirm --expect <n>     # APPLY (all three, typed)
 *   npm run repair:hazards:dry                                   # verify: "No apply needed"
 *
 * Re-parses every stored FSIS/FDA notice record's archived official snapshot
 * through the corrected canonical parser and corrects exactly four fields
 * where the stored values are wrong: `normalized.hazardCategory` and
 * `normalized.pathogenOrAllergen` on source records, and the same pair inside
 * `projection` on their cases. No network, no re-crawl, no snapshot changes,
 * no timeline/date/ledger changes, no notifications — see
 * src/server/hazard-repair.ts for the full safety contract.
 *
 * NO PACKAGE SCRIPT CARRIES `--apply`. It used to: `repair:hazards` was
 * `tsx scripts/repair-hazards.ts --apply`, so an operator who typed only
 * `--confirm` was applying without ever writing the word. The flag is now
 * typed by a human or the run is a dry run (P2B7T).
 *
 * THREE acknowledgments are required before a single write is reachable:
 * `--apply` (the intent), `--confirm` (the repair:* house rule), and
 * `--expect <n>` (the planned-change count from the reviewed dry run). All
 * three are resolved and refused BEFORE a write-capable database client is
 * constructed. The whole corpus is planned before the first write, so a corpus
 * that drifted since the review aborts having written nothing.
 *
 * DURABLE LEDGER: an apply always leaves a complete machine-readable report
 * behind rather than trusting terminal scrollback. `--json <path>` writes it
 * where you ask; with no `--json`, an apply writes a timestamped report to
 * ./.reports/ (git-ignored) and prints the path. A dry run writes one only
 * when `--json` is given.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  APPROVED_CASE_CORRECTIONS,
  APPROVED_RECORD_CORRECTIONS,
  classifyPopulation,
  repairHazards,
  HAZARD_REPAIR_COMMAND,
  type HazardCasePlan,
  type HazardRepairReport,
} from '../src/server/hazard-repair';
import {
  applyCommandLine,
  dryRunClosingLine,
  resolveFlagValue,
  resolveRepairAuthorization,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
} from '../src/server/repair-authorization';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const HELP = `
Historical hazard-category correction (P2e-B)

  npm run repair:hazards:dry                                   dry run; writes nothing
  npm run repair:hazards:dry -- --json <path>                  …and write the ledger where you want it
  ${applyCommandLine(HAZARD_REPAIR_COMMAND)}     APPLY — all three flags are required

A production write needs every one of:
  --apply          the intent, typed by a human; no package script supplies it
  --confirm        the repair:* house rule
  --expect <n>     the planned-change count from the dry run you actually read

Omit any one and the command exits nonzero before opening a database
connection. A count that no longer matches the live corpus aborts the run with
zero writes.
`;

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

const show = (value: string | null) => value ?? '(null)';

function describeCase(plan: HazardCasePlan, apply: boolean): void {
  console.log(
    `    · case ${plan.recallCaseId} (${plan.sourceAgency}, ${plan.lifecycle}` +
      `${plan.multiSource ? ', multi-source' : ''})`,
  );
  for (const record of plan.records) {
    if (record.outcome !== 'update') continue;
    console.log(
      `        record ${record.nativeId}: ${record.storedHazardCategory} → ${record.correctedHazardCategory}` +
        `, agent ${show(record.storedPathogenOrAllergen)} → ${show(record.correctedPathogenOrAllergen)}`,
    );
    if (record.evidenceExcerpt) console.log(`          evidence: "${record.evidenceExcerpt}"`);
  }
  if (plan.caseWriteNeeded) {
    console.log(
      `        projection: ${plan.storedHazardCategory} → ${plan.correctedHazardCategory}` +
        `, agent ${show(plan.storedPathogenOrAllergen)} → ${show(plan.correctedPathogenOrAllergen)}`,
    );
  } else {
    console.log(`        projection unchanged (record-only drift)`);
  }
  if (plan.preexistingProjectionDrift) {
    console.log(
      `        NOTE pre-existing drift: stored ${plan.storedHazardCategory}/${show(plan.storedPathogenOrAllergen)}` +
        ` vs recompute-from-stored-records ${plan.recomputedFromStored.hazardCategory}/${show(plan.recomputedFromStored.pathogenOrAllergen)}`,
    );
  }
  if (plan.active && plan.caseWriteNeeded && plan.correctedHazardCategory === 'allergen') {
    console.log('        Affects Me: becomes allergen-category — allergen preferences now apply');
  }
  if (apply) console.log('        (written this run unless listed under CAS skips)');
}

/** The durable ledger: every counter and every before/after value. */
function writeLedger(report: HazardRepairReport, apply: boolean, jsonPath: string | null): void {
  let target = jsonPath;
  if (target === null) {
    if (!apply) return; // a dry run writes one only on request
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    mkdirSync('.reports', { recursive: true });
    target = path.join('.reports', `repair-hazards-${stamp}.json`);
  }
  const parent = path.dirname(target);
  if (parent !== '' && parent !== '.') mkdirSync(parent, { recursive: true });
  writeFileSync(
    target,
    JSON.stringify(
      {
        operation: 'repair-hazards',
        mode: apply ? 'apply' : 'dry-run',
        finishedAt: new Date().toISOString(),
        counts: {
          casesExamined: report.casesExamined,
          recordsExamined: report.recordsExamined,
          plannedRecordWrites: report.recordWouldChange,
          plannedCaseWrites: report.caseWouldChange,
          appliedRecordWrites: report.sourceRecordWrites,
          appliedCaseWrites: report.caseWrites,
          conflictedWrites: report.skippedConflicts.length,
          refusedTransitions: report.refusedTransitions.length,
          refusedAgentOnly: report.refusedAgentOnly.length,
          missingSnapshots: report.missingSnapshots.length,
          parseFailures: report.parseFailures.length,
          failures: report.failures.length,
          unchangedRecords:
            report.recordsExamined -
            report.recordWouldChange -
            report.refusedTransitions.length -
            report.refusedAgentOnly.length -
            report.missingSnapshots.length -
            report.parseFailures.length,
          notificationEvents: report.notificationEvents,
          newCases: report.newCases,
          networkRequests: report.networkRequests,
        },
        report,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\n  Durable ledger written to ${target}`);
}

async function main(): Promise<void> {
  loadDotEnv();
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  // ── The authorization contract is resolved FIRST, and nothing below runs
  // until it passes. A refusal here has opened no database connection, so a
  // missing --apply, --confirm or --expect cannot reach a write-capable
  // client at all — proved structurally by mutation-cli.test.ts.
  const mode = resolveRepairAuthorization(argv, HAZARD_REPAIR_COMMAND);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
  const json = resolveFlagValue(argv, '--json');
  if (json.error) {
    console.error(json.error);
    process.exit(1);
  }
  const jsonPath = json.value;
  // Two thirds of the contract is still a dry run, and says so — an operator
  // must never believe they applied because they typed part of it.
  if (!mode.apply && (argv.includes('--confirm') || mode.expectedUpdates !== null)) {
    console.log(DRY_RUN_DESPITE_ACKNOWLEDGMENTS);
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const store = new SupabaseStore(createSupabaseServerClient(url, secretKey));

  console.log(
    `\n${'═'.repeat(72)}\nHazard-category correction (P2e-B) — ` +
      `${mode.apply ? 'APPLY' : 'DRY RUN, nothing will be written'}\n${'═'.repeat(72)}\n`,
  );

  let lastPrinted = 0;
  const report = await repairHazards(store, {
    apply: mode.apply,
    expectedUpdates: mode.expectedUpdates,
    onProgress: (done, total) => {
      if (done === total || done - lastPrinted >= 250) {
        lastPrinted = done;
        process.stdout.write(`  … ${done}/${total} cases examined\r`);
      }
    },
  });
  process.stdout.write('\n\n');

  const coverage = report.snapshotCoverage;
  console.log('  Cases examined:                 ', report.casesExamined);
  console.log(
    `  Notice records examined:         ${report.recordsExamined}` +
      ` (FSIS ${report.fsisRecords}, FDA ${report.fdaRecords};` +
      ` ${report.enforcementRecords} enforcement rows pass through untouched)`,
  );
  console.log(
    `  Snapshot coverage:               FSIS ${coverage.fsis.present}/${coverage.fsis.present + coverage.fsis.missing},` +
      ` FDA ${coverage.fda.present}/${coverage.fda.present + coverage.fda.missing}`,
  );
  console.log('  Missing usable snapshots:       ', report.missingSnapshots.length);
  for (const missing of report.missingSnapshots.slice(0, 10)) {
    console.log(
      `      ✗ ${missing.sourceSystem} ${missing.nativeId} (case ${missing.recallCaseId})`,
    );
  }
  console.log('  Snapshot parse failures:        ', report.parseFailures.length);
  for (const failure of report.parseFailures.slice(0, 10)) {
    console.log(`      ✗ ${failure.sourceSystem} ${failure.nativeId} — ${failure.reason}`);
  }
  console.log('');
  console.log(
    `  Normalized rows that ${mode.apply ? 'change' : 'would change'}:   ${report.recordWouldChange}` +
      ` (FSIS ${report.changesByAgency.fsis.records}, FDA ${report.changesByAgency.fda.records})`,
  );
  console.log(
    `  Case projections that ${mode.apply ? 'change' : 'would change'}:  ${report.caseWouldChange}` +
      ` (FSIS ${report.changesByAgency.fsis.cases}, FDA ${report.changesByAgency.fda.cases})`,
  );
  console.log('');
  console.log('  Category transitions (record level):');
  for (const [transition, count] of Object.entries(report.transitionCounts)) {
    console.log(`      ${count.toString().padStart(4)}  ${transition}`);
  }
  console.log('');
  console.log('  REFUSED — unreviewed transition:', report.refusedTransitions.length, '(gate: 0)');
  for (const refused of report.refusedTransitions.slice(0, 10)) {
    console.log(
      `      ✗ ${refused.nativeId}: ${refused.storedHazardCategory} → ${refused.correctedHazardCategory}`,
    );
  }
  console.log(
    '  REFUSED — agent-only difference: ',
    report.refusedAgentOnly.length,
    '(083-2016 lives here; its category is correct and its stored agent is preserved)',
  );
  for (const refused of report.refusedAgentOnly.slice(0, 10)) {
    console.log(
      `      ✗ ${refused.nativeId} (${refused.storedHazardCategory}): ` +
        `${show(refused.storedPathogenOrAllergen)} vs re-derived ${show(refused.correctedPathogenOrAllergen)} — left untouched`,
    );
  }
  console.log(
    '  Pre-existing projection drift:  ',
    report.preexistingProjectionDrift.length,
    '(stored projection vs its own stored records; informational)',
  );
  console.log('  Multi-source changed cases:     ', report.multiSourceChangedCases.length);
  console.log('  Failures:                       ', report.failures.length);
  for (const failure of report.failures.slice(0, 10)) {
    console.log(`      ✗ ${failure.recallCaseId} — ${failure.reason}`);
  }
  console.log('');
  console.log('  Affects Me (active cases):');
  console.log('      changed active cases:       ', report.affectsMe.activeCasesChanged);
  console.log(
    '      entering allergen category: ',
    report.affectsMe.activeCasesEnteringAllergen,
    '(allergen preferences begin to apply to these)',
  );
  console.log('');
  console.log(
    '  Network requests:               ',
    report.networkRequests,
    '(archived snapshots only)',
  );
  console.log(`  DB writes ${mode.apply ? 'performed' : 'that WOULD occur'}:`);
  console.log(
    '      source_records (normalized): ',
    mode.apply ? report.sourceRecordWrites : report.recordWouldChange,
  );
  console.log(
    '      recall_cases (projection):   ',
    mode.apply ? report.caseWrites : report.caseWouldChange,
  );
  console.log('      raw snapshots touched:        0');
  console.log('      timeline entries touched:     0');
  console.log('      NotificationEvents:          ', report.notificationEvents);
  console.log('      new RecallCases:             ', report.newCases);
  console.log('      notifications sent:           0');
  if (mode.apply && report.skippedConflicts.length > 0) {
    console.log('  CAS skips (changed since dry-run read; rerun picks them up):');
    for (const skip of report.skippedConflicts) {
      console.log(`      · ${skip.kind} ${skip.nativeId ?? skip.id}`);
    }
  }

  if (report.ledger.length > 0) {
    console.log(
      `\n  Proposed corrections — full per-record ledger (${report.ledger.length} cases):`,
    );
    for (const plan of report.ledger) describeCase(plan, mode.apply);
  }

  writeLedger(report, mode.apply, jsonPath);

  if (report.aborted) {
    console.log(
      `\n  ✗ ABORTED — ${report.aborted.reason}.` +
        `\n    authorized ${report.aborted.expected}, live plan ${report.aborted.actual}.` +
        '\n    Nothing was written. Re-run the dry run, review the difference, and' +
        '\n    re-authorize with the new count.\n',
    );
    process.exit(1);
  }

  if (report.notificationEvents !== 0 || report.newCases !== 0) {
    console.error('\n  SAFETY VIOLATION: this repair must never notify or create cases.');
    process.exit(1);
  }
  if (report.refusedTransitions.length > 0) {
    console.error(
      '\n  UNEXPECTED: a category would move along a transition nobody reviewed. ' +
        'Stop and review the ledger before any apply.',
    );
    process.exit(1);
  }
  const planned = mode.apply ? report.sourceRecordWrites : report.recordWouldChange;
  const plannedCases = mode.apply ? report.caseWrites : report.caseWouldChange;
  const verdict = classifyPopulation(planned, plannedCases);
  if (verdict === 'needs-review') {
    console.error(
      `\n  REVIEW REQUIRED: P2e-A approved exactly ${APPROVED_RECORD_CORRECTIONS} record and ` +
        `${APPROVED_CASE_CORRECTIONS} case corrections; this run reports ${planned} and ${plannedCases}. ` +
        'A larger, smaller, or different set must be source-reviewed before apply.',
    );
    process.exit(1);
  }
  if (verdict === 'settled') {
    console.log(
      '\n  Population: 0 record and 0 case corrections — nothing eligible remains.' +
        '\n  This is the expected result of the post-apply verification run.',
    );
  }
  console.log(
    mode.apply
      ? '\n  ✓ Applied. Re-run the dry run to verify: "No apply needed".\n'
      : dryRunClosingLine(HAZARD_REPAIR_COMMAND, report.plannedChanges),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
