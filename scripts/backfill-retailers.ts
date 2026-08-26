/**
 * Historical retailer-evidence repair — an explicit maintenance command,
 * never scheduled and deliberately separate from production ingestion.
 *
 *   npm run backfill:retailers:dry    # report only, writes nothing
 *   npm run backfill:retailers        # apply the retailer writes
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
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const apply = process.argv.includes('--apply');

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
  console.log(
    apply
      ? '\n  ✓ Applied. Re-run at any time — the operation is idempotent.\n'
      : '\n  Dry run complete — nothing was written. Apply with: npm run backfill:retailers\n',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
