/**
 * FDA hero-image backfill — an explicit maintenance command, never scheduled
 * and deliberately separate from production ingestion.
 *
 *   npm run backfill:fda-images:dry                                 # report only, writes nothing
 *   npm run backfill:fda-images -- --apply --confirm --expect <n>   # APPLY (all three, typed)
 *
 * NO PACKAGE SCRIPT CARRIES `--apply`. It used to: `backfill:fda-images` was
 * `tsx scripts/backfill-fda-images.ts --apply`, so the apply was a command an
 * operator could run without typing a single acknowledgment. All three flags
 * are now typed by a human, resolved and refused BEFORE a write-capable
 * database client is constructed, and the whole corpus is planned before the
 * first write (P2B7T).
 *
 * `heroImageUrl` is derived when a record is PARSED, and incremental
 * ingestion re-parses only records whose source page changed — so records
 * ingested before the parser learned to extract product photos stay
 * imageless forever under normal operation. This command re-derives them
 * from the preserved snapshots (no network, no re-crawl) using the same
 * canonical parser ingestion uses, and writes exactly two things: the image
 * fields on a source record's normalized payload, and `heroImageUrl` on its
 * case's projection.
 *
 * It never creates a case, never writes a notification event, never runs
 * material-change detection, never re-dates or re-links anything, and never
 * touches FSIS. Re-running is safe: every decision is made from current
 * state, so an interrupted run resumes and a completed run is a no-op.
 *
 * The dry run is also the VERIFICATION report: because it recomputes
 * coverage from live state, running it after an apply shows the remaining
 * gap (expected: eligible 0) alongside total cases, cases with imagery, and
 * cases whose source genuinely publishes no photo.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import { backfillFdaHeroImages } from '../src/server/fda/image-backfill';
import {
  applyCommandLine,
  dryRunClosingLine,
  resolveRepairAuthorization,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
  type MutationCommandForm,
} from '../src/server/repair-authorization';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const COMMAND: MutationCommandForm = { script: 'backfill:fda-images' };

const HELP = `
FDA hero-image backfill

  npm run backfill:fda-images:dry                       dry run; writes nothing
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
    `\n${'═'.repeat(72)}\nFDA hero-image backfill — ${apply ? 'APPLY' : 'DRY RUN, nothing will be written'}\n${'═'.repeat(72)}\n`,
  );

  let lastPrinted = 0;
  const report = await backfillFdaHeroImages(store, {
    apply,
    expectedUpdates: mode.expectedUpdates,
    onProgress: (done, total) => {
      if (done === total || done - lastPrinted >= 100) {
        lastPrinted = done;
        process.stdout.write(`  … ${done}/${total} cases examined\r`);
      }
    },
  });
  process.stdout.write('\n\n');

  // Cases that HAVE usable imagery — the only honest coverage denominator.
  const covered = report.alreadyPopulated + report.eligible;
  const coverageBase = covered + report.casesUndetermined;

  console.log('  Cases examined:                 ', report.casesExamined);
  console.log('  Source records examined:        ', report.recordsExamined);
  console.log('  Already correct (skipped):      ', report.alreadyPopulated);
  console.log('  Eligible for backfill:          ', report.eligible);
  console.log('');
  console.log('  Records with source imagery:    ', report.recordsWithSourceImage);
  console.log('  Records with no source imagery: ', report.recordsWithoutSourceImage);
  console.log('  Records missing snapshot HTML:  ', report.recordsMissingSnapshotHtml);
  console.log('  Parse failures:                 ', report.parseFailures.length);
  for (const failure of report.parseFailures.slice(0, 10)) {
    console.log(`      ✗ ${failure.nativeId.slice(0, 60)} — ${failure.reason}`);
  }
  console.log('');
  console.log('  Network requests:               ', report.networkRequests, '(snapshots only)');
  console.log('  Fetch failures:                  0 (no fetches performed)');
  console.log('');
  console.log(`  DB writes ${apply ? 'performed' : 'that WOULD occur'}:`);
  console.log('      source_records (image fields):', report.sourceRecordWrites);
  console.log('      recall_cases (heroImageUrl):  ', report.caseWrites);
  console.log('      NotificationEvents:           ', report.notificationEvents);
  console.log('      new RecallCases:              ', report.newCases);
  console.log('');
  // Success is coverage among cases that HAVE usable imagery — never
  // total/total, because many announcements genuinely publish no photo.
  console.log(
    `  Coverage among cases with usable imagery: ${covered}/${coverageBase}` +
      (coverageBase > 0 ? ` (${Math.round((covered / coverageBase) * 100)}%)` : ''),
  );
  console.log('  Cases whose source publishes no photo:   ', report.casesWithoutSourceImage);
  console.log('  Cases whose source could not be checked: ', report.casesUndetermined);

  if (report.examples.length > 0) {
    console.log(`\n  Examples${apply ? '' : ' of the updates that would be written'}:`);
    for (const example of report.examples) {
      console.log(`    · ${example.nativeId.slice(0, 60)}`);
      console.log(`      ${example.heroImageUrl}`);
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
