/**
 * FDA hero-image backfill — an explicit maintenance command, never scheduled
 * and deliberately separate from production ingestion.
 *
 *   npm run backfill:fda-images:dry    # report only, writes nothing
 *   npm run backfill:fda-images        # apply the image writes
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
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const apply = process.argv.includes('--apply');

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function main(): Promise<void> {
  loadDotEnv();
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
  console.log(
    apply
      ? '\n  ✓ Applied. Re-run at any time — the operation is idempotent.\n'
      : '\n  Dry run complete — nothing was written. Apply with: npm run backfill:fda-images\n',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
