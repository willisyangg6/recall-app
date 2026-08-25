/**
 * Live FDA announcement ingestion — explicitly invoked, never scheduled.
 *
 *   npm run ingest:fda            # fetch live FDA data, persist to Supabase
 *   npm run ingest:fda:dry        # fetch live FDA data, run the full
 *                                 # pipeline in memory, persist nothing
 *
 * Discovery: the FDA listing JSON backend (primary) + the official food RSS
 * as an independent cross-check. Detail pages are fetched only for new or
 * changed announcements. The persistent mode needs SUPABASE_URL and
 * SUPABASE_SECRET_KEY in .env (server-only secrets — never EXPO_PUBLIC_*).
 */

import { fetchFdaDetailPage, fetchFdaFoodRss, fetchFdaListing } from '../src/server/fda/fetch';
import { runFdaIngest, type FdaIngestResult } from '../src/server/fda/ingest';
import { MemoryStore } from '../src/server/store/memory-store';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';
import type { RecallStore } from '../src/server/store/types';

const STALE_SOURCE_ALARM_DAYS = 14;
const DETAIL_DELAY_MS = 200;

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

function report(result: FdaIngestResult, dryRun: boolean): void {
  const { summary, crossCheck } = result;
  console.log(`\nIngest run ${summary.runId}${dryRun ? ' (dry run — nothing persisted)' : ''}`);
  console.log(`  listing items seen:  ${crossCheck.itemsInListing}`);
  console.log(
    `  food-scoped:         ${crossCheck.foodItems} ` +
      `(excluded: ${crossCheck.excludedNonfood} non-food, ${crossCheck.excludedAnimal} pet/veterinary — deferred scope)`,
  );
  console.log(`  parsed:              ${summary.itemsParsed}`);
  console.log(`  detail pages fetched:${String(crossCheck.detailPagesFetched).padStart(5)}`);
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
  }
  if (crossCheck.detailFetchFailures.length > 0) {
    console.log(
      `  DETAIL FETCH FAILURES: ${crossCheck.detailFetchFailures.length} ` +
        `(records fell back to listing-only data):`,
    );
    for (const f of crossCheck.detailFetchFailures) {
      console.log(`    - ${f.nativeId}: ${f.reason}`);
    }
  }

  console.log(
    `  RSS cross-check:     ${crossCheck.rssItems} items` +
      (crossCheck.rssOnlyIds.length > 0
        ? `, ${crossCheck.rssOnlyIds.length} MISSING from primary listing`
        : ', all present in primary listing'),
  );
  if (summary.newestPublishedAt) {
    const ageDays = Math.floor(
      (Date.now() - new Date(summary.newestPublishedAt).getTime()) / 86_400_000,
    );
    console.log(`  newest source item:  ${summary.newestPublishedAt} (${ageDays} days ago)`);
    // FDA food announcements run ~4–6/week; two silent weeks means a broken
    // feed is likelier than a quiet fortnight (architecture Part 8.3).
    if (ageDays > STALE_SOURCE_ALARM_DAYS) {
      console.warn(
        `  ⚠ STALE SOURCE: newest FDA announcement is ${ageDays} days old ` +
          `(alarm threshold ${STALE_SOURCE_ALARM_DAYS}d). The feed may have silently broken.`,
      );
    }
  }
  for (const warning of crossCheck.warnings) {
    console.warn(`  ⚠ ${warning}`);
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const store = buildStore(dryRun);

  console.log('Fetching FDA announcement listing (official listing backend)…');
  const listing = await fetchFdaListing();
  console.log(`Fetched ${listing.items.length} listing items at ${listing.fetchedAt}.`);

  let rss: { items: Awaited<ReturnType<typeof fetchFdaFoodRss>>['items'] } | null = null;
  try {
    const rssResult = await fetchFdaFoodRss();
    rss = { items: rssResult.items };
    console.log(`Fetched ${rssResult.items.length} food RSS items (cross-check).`);
  } catch (error) {
    console.warn(
      `Food RSS fetch failed (${error instanceof Error ? error.message : error}) — continuing without cross-check.`,
    );
  }

  const result = await runFdaIngest(store, {
    listing: { items: listing.items, fetchedAt: listing.fetchedAt },
    rss,
    fetchDetail: (url) => fetchFdaDetailPage(url),
    detailDelayMs: DETAIL_DELAY_MS,
  });
  report(result, dryRun);
}

main().catch((error) => {
  console.error('Ingest failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
