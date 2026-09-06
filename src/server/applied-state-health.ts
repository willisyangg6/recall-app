/**
 * Applied-version state health (O3-B2) — the pure classification behind the
 * `ops:health` applied-state section, kept injectable like
 * src/server/jobs/health.ts so every state it must distinguish is tested
 * directly.
 *
 * Four stored populations, four very different operational meanings:
 *
 *   legacy_unverified  expected migration-era state: the row predates the O3
 *                      marker and awaits GOVERNED reconciliation (O3-B2 plan
 *                      + reviewed apply). Informational — it prevents O3 from
 *                      being called settled, but it is NOT an ingest failure.
 *   pending            a current archived version awaiting its retry tick.
 *                      Fresh pending is normal (a crash mid-tick converges on
 *                      the next run); OVERDUE pending means retries are not
 *                      converging and consumer state is stale — operational
 *                      fault.
 *   applied_degraded   usable FDA listing-only coverage still owed its detail
 *                      page. Visible and age-tracked; the consumer is covered,
 *                      so persistent degradation warns rather than fails.
 *   applied            fully completed current version.
 *
 * Thresholds are DERIVED from the real contracts, never invented:
 *  - ingest cadence is 30 minutes (scheduled-ingest.yml, twice hourly);
 *  - the watchdog declares sources stale after 40 minutes
 *    (watchdog_config.stale_after_minutes — one dropped tick of grace);
 *  - the O3 contract promises convergence on the NEXT tick, and the O3-B0/B1
 *    design pinned a 90-minute pending alarm (three cadence intervals, still
 *    inside the 3-hour job-freshness threshold).
 *
 * So: pending older than one watchdog window (40 min) has missed at least one
 * retry opportunity → degraded; pending older than 90 min has missed several
 * → UNHEALTHY. A degraded FDA record is retried every tick and swept daily
 * (daily-maintenance.yml), so one full daily cycle plus slack (26 h) without
 * its detail page → degraded status.
 */

/** One watchdog staleness window: a pending version has missed ≥1 retry tick. */
export const PENDING_WARN_MINUTES = 40;
/** The O3-B0/B1 pinned pending alarm: several missed retry ticks. */
export const PENDING_OVERDUE_MINUTES = 90;
/** One daily maintenance cycle + slack without the owed FDA detail page. */
export const DEGRADED_WARN_HOURS = 26;
/** Bounded identifier detail in notes — never a full population dump. */
const MAX_LISTED_RECORDS = 10;

export interface AppliedStateCounts {
  totalRecords: number;
  legacyUnverified: number;
  pending: number;
  applied: number;
  appliedDegraded: number;
}

/** One actionable (pending/applied_degraded) row from the health view. */
export interface ActionableApplyRow {
  sourceSystem: string;
  nativeId: string;
  applyState: 'pending' | 'applied_degraded';
  /** The awaiting version's archive time (view: latest_fetched_at). */
  latestFetchedAt: string | null;
  /** When the degraded founding applied (view: applied_at). */
  appliedAt: string | null;
}

export type AppliedStateStatus = 'not installed' | 'healthy' | 'degraded' | 'UNHEALTHY';

export interface AppliedStateSummary {
  status: AppliedStateStatus;
  /** True only for UNHEALTHY — what ops:health's exit code counts. */
  unhealthy: boolean;
  notes: string[];
  counts: AppliedStateCounts | null;
  pendingBySystem: Record<string, number>;
  degradedBySystem: Record<string, number>;
  oldestPendingMinutes: number | null;
  oldestDegradedHours: number | null;
  /** legacy_unverified reached zero — the governed reconciliation completed. */
  reconciled: boolean;
}

function ageMinutes(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (nowMs - t) / 60_000;
}

/**
 * @param counts null when the health view/schema is not installed (the
 *   applied-version migration has not been applied) — a first-class
 *   contract-not-installed state, never a misleading "healthy".
 */
export function summarizeAppliedState(
  counts: AppliedStateCounts | null,
  actionable: ActionableApplyRow[],
  nowMs: number,
): AppliedStateSummary {
  if (counts === null) {
    return {
      status: 'not installed',
      unhealthy: false,
      notes: [
        'applied-version contract not installed (applied_version_contract migration pending) — apply it before trusting ingest crash-safety',
      ],
      counts: null,
      pendingBySystem: {},
      degradedBySystem: {},
      oldestPendingMinutes: null,
      oldestDegradedHours: null,
      reconciled: false,
    };
  }

  const notes: string[] = [];
  let status: AppliedStateStatus = 'healthy';
  const pendingBySystem: Record<string, number> = {};
  const degradedBySystem: Record<string, number> = {};
  let oldestPendingMinutes: number | null = null;
  let oldestDegradedHours: number | null = null;
  const overduePending: ActionableApplyRow[] = [];
  const warnPending: ActionableApplyRow[] = [];
  const staleDegraded: ActionableApplyRow[] = [];

  for (const row of actionable) {
    if (row.applyState === 'pending') {
      pendingBySystem[row.sourceSystem] = (pendingBySystem[row.sourceSystem] ?? 0) + 1;
      const age = ageMinutes(row.latestFetchedAt, nowMs);
      if (age !== null) {
        oldestPendingMinutes = Math.max(oldestPendingMinutes ?? 0, age);
        if (age >= PENDING_OVERDUE_MINUTES) overduePending.push(row);
        else if (age >= PENDING_WARN_MINUTES) warnPending.push(row);
      }
    } else {
      degradedBySystem[row.sourceSystem] = (degradedBySystem[row.sourceSystem] ?? 0) + 1;
      const age = ageMinutes(row.appliedAt ?? row.latestFetchedAt, nowMs);
      if (age !== null) {
        const hours = age / 60;
        oldestDegradedHours = Math.max(oldestDegradedHours ?? 0, hours);
        if (hours >= DEGRADED_WARN_HOURS) staleDegraded.push(row);
      }
    }
  }

  const list = (rows: ActionableApplyRow[]) =>
    rows
      .slice(0, MAX_LISTED_RECORDS)
      .map((r) => `${r.sourceSystem}/${r.nativeId}`)
      .join(', ') +
    (rows.length > MAX_LISTED_RECORDS ? `, +${rows.length - MAX_LISTED_RECORDS} more` : '');

  if (overduePending.length > 0) {
    status = 'UNHEALTHY';
    notes.push(
      `${overduePending.length} pending version(s) overdue (>${PENDING_OVERDUE_MINUTES} min — several missed retry ticks): ${list(overduePending)}`,
    );
  } else if (warnPending.length > 0) {
    status = 'degraded';
    notes.push(
      `${warnPending.length} pending version(s) past one watchdog window (>${PENDING_WARN_MINUTES} min): ${list(warnPending)}`,
    );
  } else if (counts.pending > 0) {
    notes.push(
      `${counts.pending} pending version(s) inside the first retry window — expected to converge next tick`,
    );
  }

  if (staleDegraded.length > 0) {
    if (status === 'healthy') status = 'degraded';
    notes.push(
      `${staleDegraded.length} FDA degraded record(s) still owed a detail page after ${DEGRADED_WARN_HOURS}h: ${list(staleDegraded)}`,
    );
  } else if (counts.appliedDegraded > 0) {
    notes.push(
      `${counts.appliedDegraded} applied_degraded record(s) (listing coverage; detail retried every tick)`,
    );
  }

  const reconciled = counts.legacyUnverified === 0;
  if (!reconciled) {
    notes.push(
      `${counts.legacyUnverified} legacy-unverified record(s) await governed reconciliation (O3-B2) — expected migration-era state, NOT an ingest failure; O3 is not fully settled until 0`,
    );
  } else {
    notes.push('reconciliation complete: zero legacy-unverified records');
  }

  return {
    status,
    unhealthy: status === 'UNHEALTHY',
    notes,
    counts,
    pendingBySystem,
    degradedBySystem,
    oldestPendingMinutes,
    oldestDegradedHours,
    reconciled,
  };
}
