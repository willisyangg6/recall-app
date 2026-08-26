/**
 * FSIS ingestion production job. The canonical pipeline (fetchFsisRecords →
 * runFsisIngest) is exactly what `npm run ingest:fsis` has always run; this
 * module adds only the operational shell: unchanged-source skip gate,
 * implausibly-empty guard, quarantine-spike detection, and run metrics.
 *
 * The FSIS API returns its entire filtered set every call (source contract
 * §4), so "incremental" means the pipeline's per-record hash gate — and the
 * whole-feed hash gate here, which skips the ~2,500 per-record round trips
 * when the response content is byte-equal to the last successful run.
 */

import { fetchFsisRecords } from '../fsis/fetch';
import { runFsisIngest, type IngestOptions, type IngestSummary } from '../pipeline';
import {
  latestJobMetric,
  orderInsensitiveFeedHash,
  runJob,
  type JobContext,
  type JobReport,
  type JobSpec,
} from './runner';

export const FSIS_JOB: JobSpec = {
  jobName: 'fsis_ingest',
  sourceSystem: 'fsis_api',
  leaseTtlSeconds: 25 * 60, // > any healthy run; < two 30-min ticks
};

const STALE_SOURCE_ALARM_DAYS = 14;
const QUARANTINE_SPIKE_RATIO = 0.2;

export interface FsisJobOptions {
  dryRun?: boolean;
  /** Skip the unchanged-source gate (manual re-runs after a code change). */
  force?: boolean;
  fetchRecords?: typeof fetchFsisRecords;
  ingestOptions?: IngestOptions;
}

export async function runFsisJob(
  ctx: JobContext,
  options: FsisJobOptions = {},
): Promise<JobReport> {
  return runJob(FSIS_JOB, ctx, async () => {
    const fetchRecords = options.fetchRecords ?? fetchFsisRecords;

    console.log('Fetching live FSIS recall data (official API, English records)…');
    const fetched = await fetchRecords();
    console.log(`Fetched ${fetched.records.length} records at ${fetched.fetchedAt}.`);

    // SOURCE EMPTY vs SOURCE FAILED: the FSIS API returns 12+ years of
    // records every call. Zero — or under half the last successful run — is a
    // broken source, never a quiet day. Fail loudly, ingest nothing.
    if (fetched.records.length === 0) {
      throw new Error(
        'FSIS API returned zero records — treating as SOURCE FAILURE, not an empty day. Nothing ingested.',
      );
    }
    const previousSeen = await latestJobMetric(ctx.store, FSIS_JOB.jobName, 'itemsSeen');
    if (typeof previousSeen === 'number' && fetched.records.length < Math.ceil(previousSeen / 2)) {
      throw new Error(
        `FSIS feed implausibly small: ${fetched.records.length} records vs ${previousSeen} on the last successful run. ` +
          'Treating as SOURCE FAILURE; nothing ingested.',
      );
    }

    const feedHash = orderInsensitiveFeedHash(fetched.records);
    if (!options.force) {
      const previousHash = await latestJobMetric(ctx.store, FSIS_JOB.jobName, 'feedHash');
      if (previousHash === feedHash) {
        console.log('FSIS feed content unchanged since the last run — nothing to do.');
        return {
          pipelineRunId: null,
          outcome: 'succeeded',
          metrics: {
            skipped: 'source_unchanged',
            feedHash,
            itemsSeen: fetched.records.length,
          },
        };
      }
    }

    const summary = await runFsisIngest(ctx.store, fetched, {
      now: ctx.now,
      ...options.ingestOptions,
    });
    printFsisReport(summary, options.dryRun ?? false);

    const parsedPlusQuarantined = summary.itemsParsed + summary.quarantined.length;
    const quarantineRatio =
      parsedPlusQuarantined > 0 ? summary.quarantined.length / parsedPlusQuarantined : 0;
    const outcome =
      quarantineRatio > QUARANTINE_SPIKE_RATIO
        ? 'failed'
        : summary.quarantined.length > 0
          ? 'partial'
          : 'succeeded';

    return {
      pipelineRunId: summary.runId,
      outcome,
      error:
        outcome === 'failed'
          ? `parse failure spike: ${summary.quarantined.length}/${parsedPlusQuarantined} records quarantined — source shape may have drifted`
          : undefined,
      metrics: {
        feedHash,
        itemsSeen: summary.itemsSeen,
        parsed: summary.itemsParsed,
        unchanged: summary.unchanged,
        newCases: summary.newCases,
        changedCases: summary.changedCases,
        quarantined: summary.quarantined.length,
        notifications: summary.notifications,
        newestPublishedAt: summary.newestPublishedAt,
      },
    };
  });
}

/** The human report `npm run ingest:fsis` has always printed. */
export function printFsisReport(summary: IngestSummary, dryRun: boolean): void {
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
