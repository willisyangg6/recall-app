/**
 * Historical allergen-agent correction (P2d-B) — an explicit maintenance
 * command, never scheduled and deliberately separate from production
 * ingestion.
 *
 *   npm run repair:allergens:dry              # report only, writes nothing
 *   npm run repair:allergens -- --confirm     # APPLY (requires BOTH flags)
 *   npm run repair:allergens:dry              # verify: "would update" must be 0
 *
 * Re-parses every stored FSIS/FDA notice record's archived official snapshot
 * through the canonical P2d-A extractor and corrects exactly two fields where
 * the stored value is stale: `normalized.pathogenOrAllergen` and
 * `projection.pathogenOrAllergen`. No network, no re-crawl, no snapshot
 * changes, no timeline/date/ledger changes, no notifications — see
 * src/server/allergen-repair.ts for the full safety contract.
 *
 * `--apply` alone is refused: the apply needs the second acknowledgment
 * `--confirm`, so an accidental invocation can never write. `--json <path>`
 * additionally writes the full machine-readable report (including the
 * per-record ledger) to a file.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import { writeFileSync } from 'node:fs';

import {
  repairAllergens,
  resolveRepairMode,
  type AllergenCasePlan,
} from '../src/server/allergen-repair';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

function jsonPathFromArgv(argv: string[]): string | null {
  const index = argv.indexOf('--json');
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    console.error('--json requires a file path argument.');
    process.exit(1);
  }
  return value;
}

const show = (value: string | null) => value ?? '(null)';

function describeCase(plan: AllergenCasePlan, apply: boolean): void {
  console.log(
    `    · case ${plan.recallCaseId} (${plan.sourceAgency}, ${plan.lifecycle}` +
      `${plan.multiSource ? ', multi-source' : ''})`,
  );
  for (const record of plan.records) {
    if (record.outcome === 'update') {
      console.log(
        `        record ${record.nativeId}: ${show(record.storedValue)} → ${show(record.correctedValue)}`,
      );
      if (record.evidenceExcerpt) console.log(`          evidence: "${record.evidenceExcerpt}"`);
    }
  }
  if (plan.caseWriteNeeded) {
    console.log(
      `        projection: ${show(plan.currentProjectionValue)} → ${show(plan.correctedProjectionValue)}`,
    );
  } else {
    console.log(
      `        projection unchanged at ${show(plan.currentProjectionValue)} (record-only drift)`,
    );
  }
  if (plan.preexistingProjectionDrift) {
    console.log(
      `        NOTE pre-existing drift: stored projection ${show(plan.currentProjectionValue)}` +
        ` vs recompute-from-stored-records ${show(plan.recomputedFromStored)}`,
    );
  }
  if (plan.active && plan.caseWriteNeeded) {
    const gained = plan.tokensAfter.filter((token) => !plan.tokensBefore.includes(token));
    console.log(
      `        Affects Me: tokens [${plan.tokensBefore.join(', ')}] → [${plan.tokensAfter.join(', ')}]` +
        `${gained.length > 0 ? `  (newly matchable: ${gained.join(', ')})` : ''}` +
        `, allergen-only ${plan.allergenOnlyBefore} → ${plan.allergenOnlyAfter}`,
    );
  }
  if (apply) console.log('        (written this run unless listed under CAS skips)');
}

async function main(): Promise<void> {
  loadDotEnv();
  const mode = resolveRepairMode(process.argv.slice(2));
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
  const jsonPath = jsonPathFromArgv(process.argv.slice(2));

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const store = new SupabaseStore(createSupabaseServerClient(url, secretKey));

  console.log(
    `\n${'═'.repeat(72)}\nAllergen-agent correction (P2d-B) — ` +
      `${mode.apply ? 'APPLY' : 'DRY RUN, nothing will be written'}\n${'═'.repeat(72)}\n`,
  );

  let lastPrinted = 0;
  const report = await repairAllergens(store, {
    apply: mode.apply,
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
  console.log('  Before → after (record level):');
  for (const [transition, count] of Object.entries(report.beforeAfter)) {
    console.log(`      ${count.toString().padStart(4)}  ${transition}`);
  }
  console.log('  Corrected values by family:');
  for (const [family, count] of Object.entries(report.familyCounts)) {
    console.log(`      ${count.toString().padStart(4)}  ${family}`);
  }
  console.log('');
  console.log('  REFUSED — category conflicts:   ', report.categoryConflicts.length, '(gate: 0)');
  for (const conflict of report.categoryConflicts.slice(0, 10)) {
    console.log(
      `      ✗ ${conflict.nativeId}: ${conflict.storedHazardCategory} → ${conflict.correctedHazardCategory}`,
    );
  }
  console.log(
    '  REFUSED — outside allergen cat.:',
    report.changesOutsideAllergenCategory.length,
    '(expected 0)',
  );
  for (const outside of report.changesOutsideAllergenCategory.slice(0, 10)) {
    console.log(
      `      ✗ ${outside.nativeId} (${outside.storedHazardCategory}): ` +
        `${show(outside.storedValue)} → ${show(outside.correctedValue)}`,
    );
  }
  console.log(
    '      of which pathogen records:  ',
    report.pathogenValueChanges.length,
    '(gate: 0)',
  );
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
    '      newly matchable tokens:     ',
    Object.entries(report.affectsMe.tokensGained)
      .map(([token, count]) => `${token} ×${count}`)
      .join(', ') || '—',
  );
  console.log(
    '      unidentified → identified:  ',
    report.affectsMe.unidentifiedToIdentified,
    '(these become excludable for non-matching allergen-only profiles)',
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

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`\n  Machine-readable report written to ${jsonPath}`);
  }

  if (report.notificationEvents !== 0 || report.newCases !== 0) {
    console.error('\n  SAFETY VIOLATION: this repair must never notify or create cases.');
    process.exit(1);
  }
  if (report.pathogenValueChanges.length > 0) {
    console.error(
      '\n  UNEXPECTED: a pathogen record’s agent would change. Stop and review ' +
        'before any apply — this contradicts the P2d-A recorded-corpus evidence.',
    );
    process.exit(1);
  }
  console.log(
    mode.apply
      ? '\n  ✓ Applied. Re-run the dry run to verify: "would change" must be 0.\n'
      : '\n  Dry run complete — nothing was written. Apply (once authorized) with:' +
          '\n    npm run repair:allergens -- --confirm\n',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
