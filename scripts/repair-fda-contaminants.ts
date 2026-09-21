/**
 * Historical FDA contaminant-category correction (P3B) — an explicit
 * maintenance command, never scheduled and deliberately separate from
 * production ingestion and from the settled P2e-B hazard repair.
 *
 *   npm run repair:fda-contaminants:dry                                 # report only, writes nothing
 *   npm run repair:fda-contaminants -- --apply --confirm --expect <n>   # APPLY (all three, typed)
 *   npm run repair:fda-contaminants:dry                                 # verify: "No apply needed"
 *
 * Re-parses the archived official snapshot of every FDA announcement record
 * whose recorded reason category is `Potential Metal or Chemical
 * Contaminant`, through the corrected canonical parser, and corrects exactly
 * four fields where the stored values are wrong:
 * `normalized.hazardCategory` and `normalized.pathogenOrAllergen` on source
 * records, and the same pair inside `projection` on their cases. No network,
 * no re-crawl, no snapshot changes, no timeline/date/ledger changes, no
 * pipeline, no `detectChanges`, no notifications — see
 * src/server/fda-contaminant-repair.ts for the full safety contract.
 *
 * NO PACKAGE SCRIPT CARRIES `--apply`. It used to: `repair:fda-contaminants`
 * was `tsx scripts/repair-fda-contaminants.ts --apply`, so an operator who
 * typed only `--confirm` was applying without ever writing the word. The flag
 * is now typed by a human or the run is a dry run (P2B7T).
 *
 * THREE acknowledgments are required before a single write is reachable:
 * `--apply` (the intent), `--confirm` (the repair:* house rule), and
 * `--expect <n>` (the planned-change count from the reviewed dry run). All
 * three are resolved and refused BEFORE a write-capable database client is
 * constructed. The apply is additionally refused outright — before any row is
 * touched — by a missing snapshot, a parse failure, an unreviewed category or
 * agent transition, or a population that is not the reviewed one.
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
  TARGET_FDA_CATEGORY,
  repairFdaContaminants,
  CONTAMINANT_REPAIR_COMMAND,
  type ContaminantCasePlan,
  type ContaminantRepairReport,
} from '../src/server/fda-contaminant-repair';
import {
  applyCommandLine,
  dryRunClosingLine,
  resolveFlagValue,
  resolveRepairAuthorization,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
} from '../src/server/repair-authorization';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const HELP = `
Historical FDA contaminant-category correction (P3B)

  npm run repair:fda-contaminants:dry                           dry run; writes nothing
  npm run repair:fda-contaminants:dry -- --json <path>          …and write the ledger where you want it
  ${applyCommandLine(CONTAMINANT_REPAIR_COMMAND)}   APPLY — all three flags are required

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

function describeCase(plan: ContaminantCasePlan, apply: boolean): void {
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
    console.log('        projection unchanged (record-only drift)');
  }
  if (plan.preexistingProjectionDrift) {
    console.log(
      `        NOTE pre-existing drift: stored ${plan.storedHazardCategory}/${show(plan.storedPathogenOrAllergen)}` +
        ` vs recompute-from-stored-records ${plan.recomputedFromStored.hazardCategory}/${show(plan.recomputedFromStored.pathogenOrAllergen)}`,
    );
  }
  if (apply) console.log('        (written this run unless listed under CAS skips)');
}

/** The durable ledger: every counter and every before/after value. */
function writeLedger(report: ContaminantRepairReport, apply: boolean, jsonPath: string | null) {
  let target = jsonPath;
  if (target === null) {
    if (!apply) return; // a dry run writes one only on request
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    mkdirSync('.reports', { recursive: true });
    target = path.join('.reports', `repair-fda-contaminants-${stamp}.json`);
  }
  const parent = path.dirname(target);
  if (parent !== '' && parent !== '.') mkdirSync(parent, { recursive: true });
  writeFileSync(
    target,
    JSON.stringify(
      {
        operation: 'repair-fda-contaminants',
        mode: apply ? 'apply' : 'dry-run',
        governedCategory: TARGET_FDA_CATEGORY,
        finishedAt: new Date().toISOString(),
        counts: {
          fdaRecordsExamined: report.fdaRecordsExamined,
          inScopeRecords: report.inScopeRecords,
          casesExamined: report.casesExamined,
          plannedRecordWrites: report.recordWouldChange,
          plannedCaseWrites: report.caseWouldChange,
          appliedRecordWrites: report.sourceRecordWrites,
          appliedCaseWrites: report.caseWrites,
          conflictedWrites: report.skippedConflicts.length,
          refusedTransitions: report.refusedTransitions.length,
          refusedAgentTransitions: report.refusedAgentTransitions.length,
          missingSnapshots: report.missingSnapshots.length,
          parseFailures: report.parseFailures.length,
          failures: report.failures.length,
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
  const mode = resolveRepairAuthorization(argv, CONTAMINANT_REPAIR_COMMAND);
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
    `\n${'═'.repeat(72)}\nFDA contaminant-category correction (P3B) — ` +
      `${mode.apply ? 'APPLY' : 'DRY RUN, nothing will be written'}\n` +
      `Governed FDA reason category: "${TARGET_FDA_CATEGORY}"\n${'═'.repeat(72)}\n`,
  );

  let lastPrinted = 0;
  const report = await repairFdaContaminants(store, {
    apply: mode.apply,
    expectedUpdates: mode.expectedUpdates,
    onProgress: (done, total) => {
      if (done === total || done - lastPrinted >= 100) {
        lastPrinted = done;
        process.stdout.write(`  … ${done}/${total} FDA records examined\r`);
      }
    },
  });
  process.stdout.write('\n\n');

  console.log('  FDA announcement records examined:', report.fdaRecordsExamined);
  console.log(
    `  Snapshot coverage:                 ${report.snapshotCoverage.present}/` +
      `${report.snapshotCoverage.present + report.snapshotCoverage.missing}`,
  );
  console.log('  In the governed category:         ', report.inScopeRecords);
  console.log('  Cases planned:                    ', report.casesExamined);
  console.log('');
  console.log('  Missing usable snapshots:         ', report.missingSnapshots.length, '(gate: 0)');
  for (const missing of report.missingSnapshots.slice(0, 10)) {
    console.log(`      ✗ ${missing.nativeId} (case ${missing.recallCaseId})`);
  }
  console.log('  Snapshot parse failures:          ', report.parseFailures.length, '(gate: 0)');
  for (const failure of report.parseFailures.slice(0, 10)) {
    console.log(`      ✗ ${failure.nativeId} — ${failure.reason}`);
  }
  console.log('');
  console.log(
    `  Normalized rows that ${mode.apply ? 'change' : 'would change'}:  ${report.recordWouldChange}`,
  );
  console.log(
    `  Case projections that ${mode.apply ? 'change' : 'would change'}: ${report.caseWouldChange}`,
  );
  console.log('');
  console.log('  Category transitions (record level):');
  for (const [transition, count] of Object.entries(report.transitionCounts)) {
    console.log(`      ${count.toString().padStart(4)}  ${transition}`);
  }
  console.log('  Agent transitions (record level):');
  for (const [transition, count] of Object.entries(report.agentTransitionCounts)) {
    console.log(`      ${count.toString().padStart(4)}  ${transition}`);
  }
  console.log('');
  console.log('  REFUSED — unreviewed category transition:', report.refusedTransitions.length);
  for (const refused of report.refusedTransitions.slice(0, 10)) {
    console.log(
      `      ✗ ${refused.nativeId}: ${refused.storedHazardCategory} → ${refused.correctedHazardCategory}`,
    );
  }
  console.log('  REFUSED — unreviewed agent transition:   ', report.refusedAgentTransitions.length);
  for (const refused of report.refusedAgentTransitions.slice(0, 10)) {
    console.log(
      `      ✗ ${refused.nativeId}: agent ${show(refused.storedPathogenOrAllergen)} → ${show(refused.correctedPathogenOrAllergen)}`,
    );
  }
  console.log(
    '  Pre-existing projection drift:          ',
    report.preexistingProjectionDrift.length,
    '(stored projection vs its own stored records; informational)',
  );
  console.log('  Multi-source changed cases:             ', report.multiSourceChangedCases.length);
  console.log('  Failures:                               ', report.failures.length);
  for (const failure of report.failures.slice(0, 10)) {
    console.log(`      ✗ ${failure.recallCaseId} — ${failure.reason}`);
  }
  console.log('');
  console.log('  Affects Me (active cases):');
  console.log('      changed active cases:       ', report.affectsMe.activeCasesChanged);
  console.log(
    '      entering allergen category: ',
    report.affectsMe.activeCasesEnteringAllergen,
    '(0 by construction — this repair never writes the allergen category)',
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
    console.log('  CAS skips (changed since the plan read; rerun picks them up):');
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
  if (report.applyBlockedReason !== null) {
    console.error(
      `\n  REVIEW REQUIRED — no row was written: ${report.applyBlockedReason}` +
        `\n  P3B approved exactly ${APPROVED_RECORD_CORRECTIONS} record and ` +
        `${APPROVED_CASE_CORRECTIONS} case corrections. Review the ledger above before any apply.`,
    );
    process.exit(1);
  }
  if (report.population === 'settled') {
    console.log(
      '\n  Population: 0 record and 0 case corrections — nothing eligible remains.' +
        '\n  This is the expected result of the post-apply verification run.',
    );
  }
  console.log(
    mode.apply
      ? '\n  ✓ Applied. Re-run the dry run to verify: "No apply needed".\n'
      : dryRunClosingLine(CONTAMINANT_REPAIR_COMMAND, report.plannedChanges),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
