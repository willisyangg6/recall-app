/**
 * FDA announcements production job. The canonical pipeline (fetch → runFdaIngest)
 * is exactly what `npm run ingest:fda` has always run; this module adds only
 * the operational shell: unchanged-source skip gate, implausibly-empty guard,
 * quarantine-spike detection, and run metrics.
 *
 * SOURCE EMPTY vs SOURCE FAILED: a listing with zero items — or one that
 * shrank to under half the last successful run — is treated as a broken
 * source, not a quiet day. The run fails loudly and ingests nothing; existing
 * consumer data is untouched (the pipeline only ever adds).
 */

import { fetchFdaDetailPage, fetchFdaFoodRss, fetchFdaListing } from '../fda/fetch';
import { runFdaIngest, type FdaIngestInput, type FdaIngestResult } from '../fda/ingest';
import type { IngestOptions } from '../pipeline';
import {
  latestJobMetric,
  orderInsensitiveFeedHash,
  runJob,
  type JobContext,
  type JobReport,
  type JobSpec,
} from './runner';

export const FDA_JOB: JobSpec = {
  jobName: 'fda_announcements',
  sourceSystem: 'fda_announcement',
  leaseTtlSeconds: 25 * 60, // > any healthy run (~5 min); < two 30-min ticks
};

const STALE_SOURCE_ALARM_DAYS = 14;
const DETAIL_DELAY_MS = 200;
/**
 * More than this fraction of records failing (parse quarantine or isolated
 * item failure) means the source shape or the store broke — the run fails
 * loudly instead of posing as a routine partial.
 */
const QUARANTINE_SPIKE_RATIO = 0.2;

export interface FdaJobOptions {
  dryRun?: boolean;
  /** Skip the unchanged-source gate (manual re-runs after a code change). */
  force?: boolean;
  fetchListing?: typeof fetchFdaListing;
  fetchRss?: typeof fetchFdaFoodRss;
  fetchDetail?: (url: string) => Promise<string>;
  detailDelayMs?: number;
  ingestOptions?: IngestOptions;
}

export async function runFdaJob(ctx: JobContext, options: FdaJobOptions = {}): Promise<JobReport> {
  return runJob(FDA_JOB, ctx, async () => {
    const fetchListing = options.fetchListing ?? fetchFdaListing;
    const fetchRss = options.fetchRss ?? fetchFdaFoodRss;

    console.log('Fetching FDA announcement listing (official listing backend)…');
    const listing = await fetchListing();
    console.log(`Fetched ${listing.items.length} listing items at ${listing.fetchedAt}.`);

    if (!Array.isArray(listing.items) || listing.items.length === 0) {
      throw new Error(
        'FDA listing returned no items — treating as SOURCE FAILURE, not an empty day. Nothing ingested.',
      );
    }
    const previousSeen = await latestJobMetric(ctx.store, FDA_JOB.jobName, 'itemsSeen');
    if (typeof previousSeen === 'number' && listing.items.length < Math.ceil(previousSeen / 2)) {
      throw new Error(
        `FDA listing implausibly empty: ${listing.items.length} items vs ${previousSeen} on the last successful run. ` +
          'Treating as SOURCE FAILURE; nothing ingested.',
      );
    }

    let rss: FdaIngestInput['rss'] = null;
    try {
      const rssResult = await fetchRss();
      rss = { items: rssResult.items };
      console.log(`Fetched ${rssResult.items.length} food RSS items (cross-check).`);
    } catch (error) {
      console.warn(
        `Food RSS fetch failed (${error instanceof Error ? error.message : error}) — continuing without cross-check.`,
      );
    }

    // Unchanged-source gate: identical listing + RSS content means the
    // per-record hash gate would skip every item anyway — spare the ~3,000
    // per-record round trips. Gate only when BOTH channels were fetched, so a
    // new RSS-only announcement can never be delayed by an unchanged listing.
    //
    // The gate compares against `completedFeedHash`, recorded ONLY by a run
    // that left nothing deferred, degraded, pending, or failed (O3-B1 —
    // mirroring the enforcement job's completedExportDate): an incomplete
    // run must not stop the next tick's per-record pass from retrying the
    // unfinished work even when the feed bytes are identical.
    const feedHash = rss
      ? orderInsensitiveFeedHash([
          ...listing.items,
          ...rss.items.map((item) => ({ rssItem: item })),
        ])
      : null;
    if (!options.force && feedHash) {
      const previousHash = await latestJobMetric(ctx.store, FDA_JOB.jobName, 'completedFeedHash');
      if (previousHash === feedHash) {
        console.log('FDA listing and RSS content unchanged since the last run — nothing to do.');
        return {
          pipelineRunId: null,
          outcome: 'succeeded',
          metrics: {
            skipped: 'source_unchanged',
            feedHash,
            completedFeedHash: feedHash,
            itemsSeen: listing.items.length,
            rssItems: rss!.items.length,
          },
        };
      }
    }

    const result = await runFdaIngest(
      ctx.store,
      {
        listing: { items: listing.items, fetchedAt: listing.fetchedAt },
        rss,
        fetchDetail: options.fetchDetail ?? ((url) => fetchFdaDetailPage(url)),
        detailDelayMs: options.detailDelayMs ?? DETAIL_DELAY_MS,
      },
      { now: ctx.now, ...options.ingestOptions },
    );
    printFdaReport(result, options.dryRun ?? false);

    const { summary, crossCheck } = result;
    const failedItems = summary.quarantined.length + summary.itemFailures.length;
    const attempted = summary.itemsParsed + summary.quarantined.length;
    const failureRatio = attempted > 0 ? failedItems / attempted : 0;
    // Anything the run left unfinished: deferred whole items, degraded
    // foundings still owed their detail page, stale-worker skips, exhausted
    // case-CAS retries, isolated item failures, and detail-fetch failures.
    // Quarantines are NOT in this set: a parse failure is deterministic on
    // identical bytes, so skipping it via the feed gate loses nothing.
    const incomplete =
      summary.deferred +
      summary.degradedFounded +
      summary.staleSkipped +
      summary.conflictsExhausted +
      summary.itemFailures.length +
      crossCheck.detailFetchFailures.length;
    const outcome =
      failureRatio > QUARANTINE_SPIKE_RATIO
        ? 'failed'
        : summary.quarantined.length > 0 || incomplete > 0
          ? 'partial'
          : 'succeeded';

    return {
      pipelineRunId: summary.runId,
      outcome,
      error:
        outcome === 'failed'
          ? `item failure spike: ${failedItems}/${attempted} records failed ` +
            `(${summary.quarantined.length} quarantined, ${summary.itemFailures.length} errored` +
            `${summary.itemFailures[0] ? `; first error: ${summary.itemFailures[0].reason}` : ''})`
          : undefined,
      metrics: {
        feedHash,
        // The gate token: only a COMPLETE run may arm the whole-feed skip.
        completedFeedHash: incomplete === 0 ? feedHash : null,
        itemsSeen: listing.items.length,
        foodItems: crossCheck.foodItems,
        parsed: summary.itemsParsed,
        unchanged: summary.unchanged,
        newCases: summary.newCases,
        changedCases: summary.changedCases,
        quarantined: summary.quarantined.length,
        deferred: summary.deferred,
        degradedFounded: summary.degradedFounded,
        staleSkipped: summary.staleSkipped,
        conflictsExhausted: summary.conflictsExhausted,
        pendingCompleted: summary.pendingCompleted,
        itemFailures: summary.itemFailures.length,
        notifications: summary.notifications,
        newestPublishedAt: summary.newestPublishedAt,
        detailPagesFetched: crossCheck.detailPagesFetched,
        detailFetchFailures: crossCheck.detailFetchFailures.length,
        rssItems: crossCheck.rssItems,
        rssOnly: crossCheck.rssOnlyIds.length,
        warnings: crossCheck.warnings,
      },
    };
  });
}

/** The human report `npm run ingest:fda` has always printed. */
export function printFdaReport(result: FdaIngestResult, dryRun: boolean): void {
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
        `(existing records deferred whole; new records founded listing-only as applied_degraded):`,
    );
    for (const f of crossCheck.detailFetchFailures) {
      console.log(`    - ${f.nativeId}: ${f.reason}`);
    }
  }
  if (crossCheck.deferredIds.length > 0) {
    console.log(
      `  deferred (retry next run): ${crossCheck.deferredIds.length} — ${crossCheck.deferredIds.join(', ')}`,
    );
  }
  if (crossCheck.degradedIds.length > 0) {
    console.log(
      `  degraded foundings (detail retried each run): ${crossCheck.degradedIds.length} — ${crossCheck.degradedIds.join(', ')}`,
    );
  }
  if (summary.itemFailures.length > 0) {
    console.log(`  ITEM FAILURES: ${summary.itemFailures.length} (isolated; run downgraded):`);
    for (const f of summary.itemFailures) {
      console.log(`    - ${JSON.stringify(f.nativeId)}: ${f.reason}`);
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
