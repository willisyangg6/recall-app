/**
 * Job health classification — the logic behind `npm run ops:health`, kept pure
 * and injectable so the states it must distinguish can be tested directly.
 *
 * The distinction that matters operationally, and that an absent run row
 * cannot make:
 *
 *   scheduler silence   no attempt at all since the last success. GitHub never
 *                       created or started the workflow. Look at Actions.
 *   lease contention    attempts ARE arriving and standing down because
 *                       another worker holds the lease. The scheduler is fine;
 *                       a worker is not releasing (or is legitimately busy).
 *
 * Both present as "no success in Nh", and before the 2026-08-27 stall they
 * were indistinguishable from the outside. A lease skip is never a source
 * failure — a healthy overlap must not page anyone — but it is also never a
 * success, so it can never reset freshness.
 */

import { isLeaseSkip } from './runner';

/** The minimum a run row must expose to be classified. */
export interface HealthRun {
  startedAt: string;
  outcome: string | null;
  metrics: Record<string, unknown> | null;
  error: string | null;
}

/**
 * What one attempt did. `running` covers an outcome-less row that is not a
 * lease skip: in flight, or a process that died before recording anything.
 */
export type AttemptKind = 'succeeded' | 'partial' | 'failed' | 'skipped_lease' | 'running';

export type JobHealthStatus = 'healthy' | 'degraded' | 'UNHEALTHY';

export interface JobRunsSummary {
  status: JobHealthStatus;
  notes: string[];
  /** Most recent attempt of any kind, including a lease skip. */
  lastAttempt: HealthRun | null;
  lastAttemptKind: AttemptKind | null;
  /** Most recent attempt that actually ingested — `succeeded` or `partial`. */
  lastSuccess: HealthRun | null;
  /** Attempts newer than the last success. */
  attemptsSinceSuccess: number;
  leaseSkipsSinceSuccess: number;
  /** Nothing has even tried since the last success — the scheduler is quiet. */
  schedulerSilent: boolean;
}

export function attemptKind(run: HealthRun): AttemptKind {
  // Checked before `outcome`, because a lease skip is outcome-less by design.
  if (isLeaseSkip(run)) return 'skipped_lease';
  if (run.outcome === 'succeeded' || run.outcome === 'partial' || run.outcome === 'failed') {
    return run.outcome;
  }
  return 'running';
}

/** Only these two count as an ingest actually happening. */
function isSuccess(run: HealthRun): boolean {
  return run.outcome === 'succeeded' || run.outcome === 'partial';
}

/**
 * @param runs newest-first, as every store returns them.
 */
export function summarizeJobRuns(
  runs: HealthRun[],
  staleAfterHours: number,
  nowMs: number,
): JobRunsSummary {
  const lastAttempt = runs[0] ?? null;
  const lastSuccess = runs.find(isSuccess) ?? null;
  const sinceSuccess = lastSuccess
    ? runs.filter((run) => run.startedAt > lastSuccess.startedAt)
    : runs;
  const leaseSkipsSinceSuccess = sinceSuccess.filter(isLeaseSkip).length;
  const schedulerSilent = sinceSuccess.length === 0;

  const notes: string[] = [];
  let status: JobHealthStatus = 'healthy';

  // ── Freshness, unchanged from the original health contract ────────────────
  if (!lastSuccess) {
    status = 'UNHEALTHY';
    notes.push(lastAttempt ? 'no successful run recorded' : 'never ran');
  } else {
    const hours = (nowMs - Date.parse(lastSuccess.startedAt)) / 3_600_000;
    if (hours > staleAfterHours) {
      status = 'UNHEALTHY';
      notes.push(`no success in ${hours.toFixed(1)}h (threshold ${staleAfterHours}h)`);
    }
  }
  if (lastAttempt?.outcome === 'failed' && status === 'healthy') {
    status = 'degraded';
    notes.push(`latest run FAILED: ${lastAttempt.error ?? 'no error recorded'}`);
  }
  if (lastAttempt?.outcome === 'partial' && status === 'healthy') {
    status = 'degraded';
    notes.push('latest run partial (item-level failures — see run metrics)');
  }

  // ── Why it is stale: silence or contention ────────────────────────────────
  if (status === 'UNHEALTHY' && lastAttempt) {
    if (schedulerSilent) {
      notes.push(
        'no attempt recorded since the last success — the workflow never started ' +
          '(scheduler silence); check GitHub Actions, not the lease',
      );
    } else if (leaseSkipsSinceSuccess === sinceSuccess.length) {
      notes.push(
        `all ${leaseSkipsSinceSuccess} attempt(s) since the last success skipped on a held ` +
          'lease — the scheduler IS running; a worker is holding the lease',
      );
    } else if (leaseSkipsSinceSuccess > 0) {
      notes.push(
        `${leaseSkipsSinceSuccess} of ${sinceSuccess.length} attempt(s) since the last ` +
          'success skipped on a held lease',
      );
    }
  }

  // A healthy overlap is worth showing, but it is not a fault.
  if (status === 'healthy' && lastAttempt && isLeaseSkip(lastAttempt)) {
    notes.push('most recent attempt skipped on a held lease — normal overlap, not a fault');
  }

  return {
    status,
    notes,
    lastAttempt,
    lastAttemptKind: lastAttempt ? attemptKind(lastAttempt) : null,
    lastSuccess,
    attemptsSinceSuccess: sinceSuccess.length,
    leaseSkipsSinceSuccess,
    schedulerSilent,
  };
}
