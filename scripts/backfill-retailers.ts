/**
 * Historical retailer-evidence repair — an explicit maintenance command,
 * never scheduled and deliberately separate from production ingestion.
 *
 *   npm run backfill:retailers:dry                                 # report only, writes nothing
 *   npm run backfill:retailers -- --apply --confirm --expect <n>   # APPLY (all three, typed)
 *
 * NO PACKAGE SCRIPT CARRIES `--apply`. It used to: `backfill:retailers` was
 * `tsx scripts/backfill-retailers.ts --apply`, so the apply was a command an
 * operator could run without typing a single acknowledgment. All three flags
 * are now typed by a human, resolved and refused BEFORE a write-capable
 * database client is constructed, and the whole corpus is planned before the
 * first write (P2B7T).
 *
 * This repair is DONE. It remains executable, and gated, rather than deleted
 * so the derivation stays verifiable by dry run.
 *
 * Re-derives `projection.retailerNames` for every stored case using the same
 * canonical derivation `projectCase` now owns, from text already persisted
 * with the case. No network, no re-crawl, no re-parse of source payloads.
 *
 * It writes exactly one field. It never creates a case, never writes a
 * notification event, never runs material-change detection, and never
 * re-dates or re-links anything. Re-running is safe and expected: the dry run
 * is the verification report, and after a successful apply it should report
 * "would update: 0".
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import { backfillRetailerNames } from '../src/server/retailer-backfill';
import { canonicalRetailerIds, retailerById } from '../src/domain/retailer-catalog';
import {
  applyCommandLine,
  dryRunClosingLine,
  resolveRepairAuthorization,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
  type MutationCommandForm,
} from '../src/server/repair-authorization';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const COMMAND: MutationCommandForm = { script: 'backfill:retailers' };

const HELP = `
Historical retailer-evidence repair (already applied)

  npm run backfill:retailers:dry                       dry run; writes nothing
  ${applyCommandLine(COMMAND)}   APPLY — all three flags are required

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

function describe(names: string[]): string {
  const ids = canonicalRetailerIds(names);
  const matched = ids.map((id) => retailerById(id)?.name ?? id).join(', ');
  return `${JSON.stringify(names)}${matched ? `  → ${matched}` : '  → (no catalog match)'}`;
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
  const mode = resolveRepairAuthorization(argv, COMMAND);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
  const apply = mode.apply;
  // Two thirds of the contract is still a dry run, and says so — an operator
  // must never believe they applied because they typed part of it.
  if (!apply && (argv.includes('--confirm') || mode.expectedUpdates !== null)) {
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
    `\n${'═'.repeat(72)}\nRetailer evidence backfill — ${apply ? 'APPLY' : 'DRY RUN, nothing will be written'}\n${'═'.repeat(72)}\n`,
  );

  let lastPrinted = 0;
  const report = await backfillRetailerNames(store, {
    apply,
    expectedUpdates: mode.expectedUpdates,
    onProgress: (done, total) => {
      if (done === total || done - lastPrinted >= 250) {
        lastPrinted = done;
        process.stdout.write(`  … ${done}/${total} cases examined\r`);
      }
    },
  });
  process.stdout.write('\n\n');

  console.log('  Cases examined:                 ', report.casesExamined);
  console.log(`      active / inactive:           ${report.active} / ${report.inactive}`);
  console.log(`      FDA / FSIS:                  ${report.fda} / ${report.fsis}`);
  console.log('');
  console.log('  Currently retailer-bearing:     ', report.currentlyBearing);
  console.log(
    `  Retailer-bearing after apply:    ${report.safelyDerivable} (active ${report.activeSafelyDerivable})`,
  );
  console.log('');
  console.log(`  ${apply ? 'Updated' : 'Would update'}:                   `, report.wouldUpdate);
  console.log(
    '      of those, already had names:',
    report.updatesOverExisting,
    '(the rest gain their first)',
  );
  console.log('  Unchanged (already correct):    ', report.unchanged);
  console.log('  No retailer evidence in source: ', report.noEvidence);
  console.log('  Conflicts (left untouched):     ', report.conflicts.length);
  console.log(
    '  Changed by ingest mid-run:      ',
    report.concurrentlyModified.length,
    '(newer data kept; rerun picks them up)',
  );
  console.log('  Failures:                       ', report.failures.length);
  for (const failure of report.failures.slice(0, 10)) {
    console.log(`      ✗ ${failure.recallCaseId} — ${failure.reason}`);
  }
  console.log('');
  console.log('  Active cases gaining retailers: ', report.activeGainingRetailers);
  console.log('');
  console.log('  Distinct retailer strings:      ', report.distinctRetailerStrings);
  console.log('      resolved via catalog:        ', report.resolvedThroughCatalog);
  console.log('      intentionally unresolved:    ', report.intentionallyUnresolved);
  console.log('');
  console.log(
    `  Catalog-matchable cases: ${report.catalogMatchableBefore} → ${report.catalogMatchableAfter}` +
      ` (active ${report.activeCatalogMatchableBefore} → ${report.activeCatalogMatchableAfter})`,
  );
  console.log('');
  console.log('  Network requests:               ', report.networkRequests, '(stored data only)');
  console.log(`  DB writes ${apply ? 'performed' : 'that WOULD occur'}:`);
  console.log(
    '      recall_cases (retailerNames):',
    apply ? report.caseWrites : report.wouldUpdate,
  );
  console.log('      NotificationEvents:           ', report.notificationEvents);
  console.log('      new RecallCases:              ', report.newCases);

  if (report.conflicts.length > 0) {
    console.log('\n  Conflicts — stored evidence the contract rejects, left for review:');
    for (const conflict of report.conflicts.slice(0, 20)) {
      console.log(
        `    · ${conflict.recallCaseId} (${conflict.sourceAgency}, ${conflict.lifecycle})`,
      );
      console.log(`      stored:   ${JSON.stringify(conflict.current)}`);
      console.log(`      rejected: ${JSON.stringify(conflict.rejectedCarried)}`);
    }
  }

  if (report.examples.length > 0) {
    console.log(`\n  Examples${apply ? '' : ' of the updates that would be written'}:`);
    for (const example of report.examples) {
      console.log(`    · ${example.recallCaseId} (${example.sourceAgency}, ${example.lifecycle})`);
      console.log(`      ${describe(example.next)}`);
    }
  }

  if (report.notificationEvents !== 0 || report.newCases !== 0) {
    console.error('\n  SAFETY VIOLATION: a backfill must never notify or create cases.');
    process.exit(1);
  }
  if (report.aborted) {
    console.log(
      `\n  ✗ ABORTED — ${report.aborted.reason}.` +
        `\n    authorized ${report.aborted.expected}, live plan ${report.aborted.actual}.` +
        '\n    Nothing was written. Re-run the dry run, review the difference, and' +
        '\n    re-authorize with the new count.\n',
    );
    process.exit(1);
  }

  console.log(
    apply
      ? '\n  ✓ Applied. Re-run at any time — the operation is idempotent.\n'
      : dryRunClosingLine(COMMAND, report.plannedChanges),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
