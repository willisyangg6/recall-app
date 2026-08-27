/**
 * Production job runner: the one orchestration layer both scheduled and
 * manual execution go through. It owns the operational concerns the domain
 * pipelines deliberately don't:
 *
 *   lease → body (canonical pipeline) → run bookkeeping → release
 *
 * - Mutual exclusion via a Postgres lease row (RecallStore.acquireJobLease):
 *   only one instance of a logical job runs at a time, whether started by the
 *   scheduler, a retry, or a human. A crashed holder's lease expires (TTL),
 *   so a stuck job can never block ingestion permanently.
 * - Every execution ends as exactly one ingest_runs row carrying job_name,
 *   compact metrics, and the code version — the substrate for ops:health.
 *   That includes an execution that acquired no lease and did nothing: it
 *   records an outcome-less row marked `skippedLease`, because "the scheduler
 *   never started us" and "we started and stood down" are different
 *   operational facts and an absent row cannot tell them apart. Diagnosing the
 *   2026-08-27 ingestion stall depended on that difference.
 * - Failure is loud: a thrown body records a failed run and the CLI exits
 *   non-zero. Failure never deletes or closes existing consumer data — the
 *   pipelines only ever add.
 */

import { canonicalJson, contentHash } from '../pipeline';
import type { IngestRunSource, JobRunOutcome, RecallStore } from '../store/types';

export type JobName =
  'fda_announcements' | 'fsis_ingest' | 'fsis_labels' | 'fda_enforcement' | 'push_delivery';

export interface JobSpec {
  jobName: JobName;
  /** source_system recorded when the runner (not the pipeline) creates the run row. */
  sourceSystem: IngestRunSource;
  /**
   * Lease TTL. Longer than any healthy run, shorter than two scheduler
   * intervals, so a crashed run recovers within one missed tick.
   */
  leaseTtlSeconds: number;
}

export interface JobContext {
  /** Bookkeeping store (leases + run rows). Dry runs pass a MemoryStore. */
  store: RecallStore;
  now: () => Date;
  /** Git SHA (or 'local') recorded on every run for code correlation. */
  version: string;
  /** Lease holder identity (host:pid:version) — auditable in job_leases. */
  holder: string;
}

/** What a job body reports back to the runner. */
export interface JobBodyResult {
  /**
   * The ingest run the canonical pipeline already recorded (FDA/FSIS ingest),
   * to be annotated in place — or null when the runner should create the run
   * row itself (skip runs, enforcement, labels).
   */
  pipelineRunId: string | null;
  outcome: 'succeeded' | 'partial' | 'failed';
  /** Compact operational facts. Persisted as ingest_runs.metrics. */
  metrics: Record<string, unknown>;
  error?: string;
}

export interface JobReport {
  jobName: JobName;
  outcome: JobRunOutcome | 'skipped_lease';
  metrics: Record<string, unknown>;
  error: string | null;
}

/**
 * Metrics key marking an ingest_runs row as "this runner started and stood
 * down without doing any work". The row carries no outcome at all — it is not
 * `succeeded` (nothing was ingested), not `failed` (nothing went wrong), and
 * not `partial` (no work was attempted).
 */
export const SKIPPED_LEASE_METRIC = 'skippedLease';

/** True when a run row records a lease skip rather than an execution. */
export function isLeaseSkip(run: { metrics: Record<string, unknown> | null }): boolean {
  return run.metrics?.[SKIPPED_LEASE_METRIC] === true;
}

export async function runJob(
  spec: JobSpec,
  ctx: JobContext,
  body: () => Promise<JobBodyResult>,
): Promise<JobReport> {
  const acquired = await ctx.store.acquireJobLease(spec.jobName, ctx.holder, spec.leaseTtlSeconds);
  if (!acquired) {
    console.log(
      `[${spec.jobName}] another run holds the job lease — skipping (this is normal on overlap).`,
    );
    const metrics = { [SKIPPED_LEASE_METRIC]: true, holder: ctx.holder };
    try {
      await recordLeaseSkip(spec, ctx, metrics);
    } catch (error) {
      // Evidence is best-effort: losing the bookkeeping write must not turn a
      // benign overlap into a failed job. The lease holder is still working.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${spec.jobName}] could not record the lease skip: ${message}`);
    }
    // The lease belongs to someone else — deliberately not released here.
    return { jobName: spec.jobName, outcome: 'skipped_lease', metrics, error: null };
  }

  const startedAt = ctx.now().toISOString();
  try {
    const result = await body();
    await recordRun(spec, ctx, startedAt, result);
    return {
      jobName: spec.jobName,
      outcome: result.outcome,
      metrics: result.metrics,
      error: result.error ?? null,
    };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    try {
      await recordRun(spec, ctx, startedAt, {
        pipelineRunId: null,
        outcome: 'failed',
        metrics: {},
        error: message,
      });
    } catch {
      // Recording the failure must never mask the failure itself.
    }
    console.error(`[${spec.jobName}] FAILED: ${message}`);
    return { jobName: spec.jobName, outcome: 'failed', metrics: {}, error: message };
  } finally {
    try {
      await ctx.store.releaseJobLease(spec.jobName, ctx.holder);
    } catch {
      // The lease expires on its own; a failed release is not a job failure.
    }
  }
}

/**
 * Durable evidence that this runner started but did no work. Deliberately
 * outcome-less: `succeeded` would conceal the skip and reset freshness,
 * `failed` would page an operator over a healthy overlap, and `partial`
 * claims work that was never attempted. `finished_at` IS set, which is what
 * separates a skip from a genuinely in-flight or crashed run.
 */
async function recordLeaseSkip(
  spec: JobSpec,
  ctx: JobContext,
  metrics: Record<string, unknown>,
): Promise<void> {
  const startedAt = ctx.now().toISOString();
  const runId = await ctx.store.createIngestRun(spec.sourceSystem, startedAt);
  await ctx.store.finishIngestRun(runId, {
    finishedAt: ctx.now().toISOString(),
    outcome: null,
    itemsSeen: 0,
    itemsChanged: 0,
    quarantined: [],
    error: null,
  });
  await ctx.store.annotateIngestRun(runId, {
    jobName: spec.jobName,
    metrics,
    version: ctx.version,
    // No outcome override: the row stays outcome-less on purpose.
  });
}

async function recordRun(
  spec: JobSpec,
  ctx: JobContext,
  startedAt: string,
  result: JobBodyResult,
): Promise<void> {
  const annotation = {
    jobName: spec.jobName,
    metrics: result.metrics,
    version: ctx.version,
    // The pipeline records 'succeeded'/'failed'; the job may know better
    // (e.g. detail-fetch failures downgrade a run to 'partial').
    outcome: result.outcome === 'succeeded' ? undefined : result.outcome,
  };
  if (result.pipelineRunId) {
    await ctx.store.annotateIngestRun(result.pipelineRunId, annotation);
    return;
  }
  const runId = await ctx.store.createIngestRun(spec.sourceSystem, startedAt);
  const itemsSeen = typeof result.metrics.itemsSeen === 'number' ? result.metrics.itemsSeen : 0;
  await ctx.store.finishIngestRun(runId, {
    finishedAt: ctx.now().toISOString(),
    outcome: result.outcome === 'failed' ? 'failed' : 'succeeded',
    itemsSeen,
    itemsChanged: 0,
    quarantined: [],
    error: result.error ?? null,
  });
  await ctx.store.annotateIngestRun(runId, annotation);
}

/**
 * The newest value of one metric across recent non-failed runs of a job —
 * how skip gates find "the last feed hash" / "the last completed export".
 */
export async function latestJobMetric(
  store: RecallStore,
  jobName: JobName,
  key: string,
): Promise<unknown> {
  const runs = await store.listRecentJobRuns(jobName, 25);
  for (const run of runs) {
    if (run.outcome !== 'succeeded' && run.outcome !== 'partial') continue;
    const value = run.metrics?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

/**
 * Content hash of a source feed, insensitive to item order (the FDA listing
 * is documented as not date-sorted, and order flapping must not defeat the
 * unchanged-source gate). Equal bytes ⇒ equal hash; the gate can only ever
 * skip work that the per-record snapshot hash gate would also have skipped.
 */
export function orderInsensitiveFeedHash(items: unknown[]): string {
  return contentHash(items.map((item) => canonicalJson(item)).sort());
}
