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

/**
 * Freshness on its own axis, so a delay can be reported without being called a
 * failure. `warning` maps onto the existing `degraded` status — no new status
 * value, and `degraded` has never gated the exit code.
 */
export type FreshnessState = 'fresh' | 'warning' | 'stale' | 'never';

/**
 * Two-stage freshness for a job whose schedule can be delivered late.
 *
 * ── WHY TWO STAGES (derived 2026-09-09, do not tune without redoing this) ───
 * GitHub Actions drops and delays `schedule` events; they are not queued. The
 * daily-maintenance runs observed on 2026-09-08/09 were delivered 3.5–7.8h
 * after their cron minute, and `daily-maintenance #16` itself landed at 13:43Z
 * for a 09:15Z cron — a 4.5h delay that then succeeded.
 *
 * For a 24h schedule that means a perfectly healthy gap between two successes
 * can reach 24h + 7.8h ≈ 31.8h. The single 30h threshold therefore fired
 * UNHEALTHY on a working pipeline, and an operator who learns to ignore it
 * stops reading the signal at all.
 *
 *   warnAfterHours   30h = 24h period + ~6h delay. Past here the run is late
 *                    enough to look at, so say so — as `degraded`, which does
 *                    not gate automation.
 *   staleAfterHours  36h = 24h period + the 7.8h worst delivery delay observed
 *                    + ~4h headroom. Past here no delivery delay on record
 *                    explains it, so a daily job has genuinely missed.
 *
 * 36h keeps every case that matters: the real 39.1h stall stays UNHEALTHY with
 * 3h to spare, and a fully missed day (≥48h) can never pass. Sub-hourly jobs
 * keep a single threshold — their cadence leaves no delay to absorb.
 */
export interface FreshnessThresholds {
  /** No success within this window ⇒ UNHEALTHY. */
  staleAfterHours: number;
  /** No success within this window ⇒ degraded warning. Omit for one stage. */
  warnAfterHours?: number;
}

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
  /** Hours since the last success; null when there has never been one. */
  hoursSinceSuccess: number | null;
  /** Freshness alone, independent of a failed or partial latest attempt. */
  freshness: FreshnessState;
  /** The thresholds actually applied, so the report can name them. */
  thresholds: FreshnessThresholds;
}

/**
 * The enforcement export lines, extracted here so the wording is testable —
 * `ops:health` is presentation and I/O.
 *
 * ── WHAT THESE DATES ARE, PRECISELY (the 2026-09-09 correction) ─────────────
 * `completedExportDate` is written ONLY by a reconciliation that actually
 * applied, so it names the export WE have reconciled into the database. It is
 * NOT openFDA's current export date: `ops:health` is database-only and never
 * queries the source. The previous label, "source export date", read as though
 * upstream had been checked, which it had not.
 *
 * `checkedExportDate` is the weaker sibling, written by a dry run or a failed
 * apply: the export was seen but not applied. Keeping the two apart is what
 * stops an unapplied export from looking reconciled.
 */
export interface EnforcementExportReport {
  notes: string[];
  /** Our last applied export is older than the threshold. */
  staleExport: boolean;
  lastAppliedExport: string | null;
  /** An export seen but not applied, when newer than the applied one. */
  seenNotApplied: string | null;
}

export function describeEnforcementExport(
  runs: HealthRun[],
  exportStaleDays: number,
  nowMs: number,
): EnforcementExportReport {
  const pick = (key: string): string | null =>
    runs
      .map((run) => run.metrics?.[key])
      .find((value): value is string => typeof value === 'string') ?? null;
  const completed = pick('completedExportDate');
  const checked = pick('checkedExportDate');
  const notes: string[] = [];

  if (!completed) {
    notes.push(
      checked
        ? `no applied reconciliation recorded yet; most recent run checked export ${checked} ` +
            'without applying it'
        : 'no applied reconciliation recorded yet',
    );
    return { notes, staleExport: false, lastAppliedExport: null, seenNotApplied: checked };
  }

  const ageDays = (nowMs - Date.parse(completed)) / 86_400_000;
  notes.push(
    `last applied enforcement export: ${completed} (${ageDays.toFixed(0)}d ago) — ` +
      'our reconciled database state; openFDA was not queried',
  );
  const seenNotApplied = checked && checked > completed ? checked : null;
  if (seenNotApplied) {
    notes.push(
      `a later export (${seenNotApplied}) has been seen but NOT applied — ` +
        'the most recent reconciliation was a dry run or did not complete',
    );
  }
  const staleExport = ageDays > exportStaleDays;
  if (staleExport) {
    notes.push(
      `last applied export older than ${exportStaleDays}d — a weekly refresh was ` +
        'missed or has not been applied (stored state; upstream freshness unverified here)',
    );
  }
  return { notes, staleExport, lastAppliedExport: completed, seenNotApplied };
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
  thresholds: number | FreshnessThresholds,
  nowMs: number,
): JobRunsSummary {
  const limits: FreshnessThresholds =
    typeof thresholds === 'number' ? { staleAfterHours: thresholds } : thresholds;
  const { staleAfterHours } = limits;
  // A warning threshold at or above the stale one would never fire; ignoring it
  // keeps a misconfiguration from silently weakening the unhealthy boundary.
  const warnAfterHours =
    limits.warnAfterHours !== undefined && limits.warnAfterHours < staleAfterHours
      ? limits.warnAfterHours
      : undefined;
  const lastAttempt = runs[0] ?? null;
  const lastSuccess = runs.find(isSuccess) ?? null;
  const sinceSuccess = lastSuccess
    ? runs.filter((run) => run.startedAt > lastSuccess.startedAt)
    : runs;
  const leaseSkipsSinceSuccess = sinceSuccess.filter(isLeaseSkip).length;
  const schedulerSilent = sinceSuccess.length === 0;

  const notes: string[] = [];
  let status: JobHealthStatus = 'healthy';

  // ── Freshness: warning before failure ─────────────────────────────────────
  let freshness: FreshnessState = 'fresh';
  let hoursSinceSuccess: number | null = null;
  if (!lastSuccess) {
    status = 'UNHEALTHY';
    freshness = 'never';
    notes.push(lastAttempt ? 'no successful run recorded' : 'never ran');
  } else {
    const hours = (nowMs - Date.parse(lastSuccess.startedAt)) / 3_600_000;
    hoursSinceSuccess = hours;
    if (hours > staleAfterHours) {
      status = 'UNHEALTHY';
      freshness = 'stale';
      notes.push(`no success in ${hours.toFixed(1)}h (threshold ${staleAfterHours}h)`);
    } else if (warnAfterHours !== undefined && hours > warnAfterHours) {
      // Late enough to look at, not late enough to be a fault: no GitHub
      // schedule-delivery delay on record exceeds the gap to staleAfterHours.
      status = 'degraded';
      freshness = 'warning';
      notes.push(
        `no success in ${hours.toFixed(1)}h — past the ${warnAfterHours}h warning ` +
          `threshold but within the ${staleAfterHours}h unhealthy threshold; ` +
          'consistent with a delayed GitHub Actions schedule delivery, not yet a missed run',
      );
    }
  }
  // Reported unconditionally: a failed latest attempt is the most actionable
  // fact there is, and must not be swallowed by a freshness verdict that
  // already moved the status off `healthy`. Only the escalation is conditional.
  if (lastAttempt?.outcome === 'failed') {
    if (status === 'healthy') status = 'degraded';
    notes.push(`latest run FAILED: ${lastAttempt.error ?? 'no error recorded'}`);
  }
  if (lastAttempt?.outcome === 'partial') {
    if (status === 'healthy') status = 'degraded';
    notes.push('latest run partial (item-level failures — see run metrics)');
  }

  // ── Why it is late: silence or contention ─────────────────────────────────
  // Gated on freshness, not status: a failed latest attempt over a fresh
  // success is degraded but not late, and must not collect these notes.
  if ((freshness === 'stale' || freshness === 'warning') && lastAttempt) {
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
    hoursSinceSuccess,
    freshness,
    thresholds: { staleAfterHours, ...(warnAfterHours !== undefined ? { warnAfterHours } : {}) },
  };
}
