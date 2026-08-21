/**
 * Live FSIS ingestion — explicitly invoked, never scheduled or run by tests.
 *
 *   npm run ingest:fsis            # fetch live FSIS data, persist to Supabase
 *   npm run ingest:fsis:dry        # fetch live FSIS data, run the full
 *                                  # pipeline in memory, persist nothing
 *
 * The persistent mode needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env
 * (server-only secrets — never EXPO_PUBLIC_*, never committed).
 */

import { fetchFsisRecords } from '../src/server/fsis/fetch';
import { runFsisIngest, type IngestSummary } from '../src/server/pipeline';
import { MemoryStore } from '../src/server/store/memory-store';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';
import type { RecallStore } from '../src/server/store/types';

const STALE_SOURCE_ALARM_DAYS = 14;

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file — environment variables may be set another way.
  }
}

function buildStore(dryRun: boolean): RecallStore {
  if (dryRun) return new MemoryStore();
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error(
      'Missing SUPABASE_URL and/or SUPABASE_SECRET_KEY.\n' +
        'Copy .env.example to .env and fill in your Supabase project values,\n' +
        'or run with --dry-run to test the pipeline without a database.',
    );
    process.exit(1);
  }
  return new SupabaseStore(createSupabaseServerClient(url, secretKey));
}

function report(summary: IngestSummary, dryRun: boolean): void {
  console.log(`\nIngest run ${summary.runId}${dryRun ? ' (dry run — nothing persisted)' : ''}`);
  console.log(`  records seen:        ${summary.itemsSeen}`);
  console.log(`  parsed:              ${summary.itemsParsed}`);
  console.log(`  unchanged:           ${summary.unchanged}`);
  console.log(`  new cases:           ${summary.newCases}`);
  console.log(`  changed cases:       ${summary.changedCases}`);
  console.log(
    `  notifications:       ${summary.notifications.initial} initial, ` +
      `${summary.notifications.materialUpdate} material updates, ` +
      `${summary.notifications.suppressed} suppressed (backfill/coalesced)`,
  );
  if (summary.quarantined.length > 0) {
    console.log(`  QUARANTINED:         ${summary.quarantined.length} record(s) failed to parse:`);
    for (const q of summary.quarantined) {
      console.log(`    - ${JSON.stringify(q.rawNativeId)}: ${q.reason}`);
    }
    console.log('  Quarantined raw payloads are preserved in the ingest run record.');
  }

  // Stale-source alarm (architecture Part 8.3): FSIS publishes ~1–2 recalls a
  // week, so a silent feed is more likely a broken feed than a quiet month.
  if (summary.newestPublishedAt) {
    const ageDays = Math.floor(
      (Date.now() - new Date(summary.newestPublishedAt).getTime()) / 86_400_000,
    );
    console.log(`  newest source item:  ${summary.newestPublishedAt} (${ageDays} days ago)`);
    if (ageDays > STALE_SOURCE_ALARM_DAYS) {
      console.warn(
        `  ⚠ STALE SOURCE: newest FSIS record is ${ageDays} days old ` +
          `(alarm threshold ${STALE_SOURCE_ALARM_DAYS}d). The feed may have silently broken.`,
      );
    }
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const store = buildStore(dryRun);

  console.log('Fetching live FSIS recall data (official API, English records)…');
  const fetched = await fetchFsisRecords();
  console.log(`Fetched ${fetched.records.length} records at ${fetched.fetchedAt}.`);

  const summary = await runFsisIngest(store, fetched);
  report(summary, dryRun);
}

main().catch((error) => {
  console.error('Ingest failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
