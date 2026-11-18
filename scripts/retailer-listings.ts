/**
 * Store listings — retailers' recall lists attached to agency cases
 * (docs/recall-retailer-notices.md, "Store listings").
 *
 *   npm run retailer:listings -- --publisher walmart                 # dry run
 *   npm run retailer:listings -- --publisher walmart --apply --confirm --expect <n>
 *   npm run retailer:listings -- confirm <native-id> --publisher walmart --case <uuid> --by <name>
 *
 * Reads: the retailer's public recall list (one request per page,
 * sequential) and source_records (SELECT only). Writes (apply only):
 * retailer_store_listings. Never recall_cases, source_records or the
 * notification ledger: a listing cannot change the feed or send an alert.
 */

import { writeFileSync } from 'node:fs';

import {
  applyCommandLine,
  dryRunClosingLine,
  resolveCountGate,
  resolveFlagValue,
  resolveRepairAuthorization,
  type MutationCommandForm,
} from '../src/server/repair-authorization';
import {
  applyListingPlan,
  liveListingFetcher,
  planListingConfirmation,
  planListingRun,
  SupabaseListingStore,
} from '../src/server/retailer/listing-run';
import { LISTING_SOURCES, type ListingPublisher } from '../src/server/retailer/store-listings';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';

const FORM: MutationCommandForm = { script: 'retailer:listings' };

const HELP = `Store listings (writes only retailer_store_listings).

  npm run retailer:listings -- --publisher <walmart|target|wholefoods|publix>   dry run
  npm run retailer:listings -- --publisher walmart --report <file>             also write a JSON report
  npm run retailer:listings -- confirm <native-id> --publisher <p> --case <agency-case-uuid> --by <name>
  ${applyCommandLine(FORM)}`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  // Authorization resolves from argv alone, before any credential or network.
  const auth = resolveRepairAuthorization(argv, FORM);
  const publisherFlag = resolveFlagValue(argv, '--publisher');
  const reportFlag = resolveFlagValue(argv, '--report');
  const caseFlag = resolveFlagValue(argv, '--case');
  const byFlag = resolveFlagValue(argv, '--by');
  const publisher = publisherFlag.value ?? '';
  const known = Object.prototype.hasOwnProperty.call(LISTING_SOURCES, publisher);
  const confirming = argv[0] === 'confirm';
  const target = confirming ? argv[1] : null;
  const refusal =
    auth.error ??
    publisherFlag.error ??
    reportFlag.error ??
    caseFlag.error ??
    byFlag.error ??
    (!known
      ? `--publisher must be one of ${Object.keys(LISTING_SOURCES).join(', ')}.\nNothing was written.`
      : confirming && (!target || target.startsWith('-') || !caseFlag.value || !byFlag.value)
        ? 'confirm needs <native-id> --case <agency-case-uuid> --by <name>.\nNothing was written.'
        : null);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }

  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may come from elsewhere.
  }
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY. Nothing was written.');
    process.exit(1);
  }
  const store = new SupabaseListingStore(createSupabaseServerClient(url, secretKey));
  const p = publisher as ListingPublisher;

  if (confirming) {
    const { row, problems } = await planListingConfirmation(
      store,
      p,
      target!,
      caseFlag.value!,
      byFlag.value!,
      () => new Date(),
    );
    console.log(`\nStore listing confirm — ${auth.apply ? 'APPLY' : 'dry run'}`);
    if (problems.length > 0 || !row) {
      for (const problem of problems) console.error(`  REFUSED: ${problem}`);
      console.error('  Nothing was written.');
      process.exit(1);
    }
    console.log(
      `  ${row.title} → case ${row.caseId} (${row.stores.map((s) => s.store).join(', ')})`,
    );
    const gate = resolveCountGate(auth, 1);
    if (gate) {
      console.error(`\n  APPLY REFUSED: ${gate.reason}. Nothing was written.`);
      process.exit(1);
    }
    if (auth.apply) {
      await store.upsertListing(row);
      console.log('  Written: 1');
    } else console.log(`\n  ${dryRunClosingLine(FORM, 1)}`);
    return;
  }

  const plan = await planListingRun(p, store, liveListingFetcher(p), () => new Date());
  const tally: Record<string, number> = {};
  for (const { row } of plan.planned) tally[row.decision] = (tally[row.decision] ?? 0) + 1;
  console.log(`\n${publisher} store listings — ${auth.apply ? 'APPLY' : 'dry run'}`);
  console.log(
    JSON.stringify(
      {
        entries: plan.entries,
        failures: plan.failures,
        decisions: tally,
        plannedWrites: plan.plannedWrites,
      },
      null,
      2,
    ),
  );
  for (const { row, change } of plan.planned) {
    const stores = row.stores
      .map((s) => `${s.store}:${s.scope === 'states' ? s.states.length + ' states' : s.scope}`)
      .join(' ');
    console.log(
      `  ${row.decision.padEnd(8)} ${change.padEnd(6)} ${String(row.listedOn ?? '').padEnd(10)} ` +
        `${row.title.slice(0, 60).padEnd(60)} ${stores} ${row.decisionReasons.join(',')}`,
    );
  }
  if (reportFlag.value) {
    writeFileSync(reportFlag.value, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`\n  Report written to ${reportFlag.value}`);
  }
  const gate = resolveCountGate(auth, plan.plannedWrites);
  if (gate) {
    console.error(
      `\n  APPLY REFUSED: ${gate.reason} (expected ${gate.expected}, planned ${gate.actual}). Nothing was written.`,
    );
    process.exit(1);
  }
  if (auth.apply) {
    console.log(`  Written: ${await applyListingPlan(store, plan)}`);
  } else {
    console.log(`\n  ${dryRunClosingLine(FORM, plan.plannedWrites)}`);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
