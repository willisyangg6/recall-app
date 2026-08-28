/**
 * Scheduler-watchdog health classification — the pure logic behind the
 * "Scheduler watchdog" section of `npm run ops:health` and the whole of
 * `npm run scheduler:status`, kept injectable so every state the founder must
 * distinguish is directly testable.
 *
 * The watchdog exists because GitHub's scheduler fails SILENTLY, so this
 * classification's one job is making every layer's silence loud. Once
 * activated, the states separate cleanly:
 *
 *   cron stopped invoking      → no heartbeat (missing/stale heartbeat states)
 *   function chose not to act  → heartbeat fresh, decision fresh/cooldown/…
 *   GitHub rejected dispatch   → dispatch failures (class says why)
 *   GitHub accepted, no run    → accepted dispatch + FDA/FSIS still stale in
 *                                the existing source-health section
 *   ingest ran and failed      → existing source-health section (failed run)
 *   ingest succeeded           → decision returns to fresh
 *
 * Pre-activation is a first-class state, never an alarm: an uninstalled or
 * never-invoked watchdog reports itself plainly and does not gate the exit
 * code. Probe invocations are excluded from heartbeat freshness upstream, so
 * a manual probe can never mask a dead cron.
 */

export const WATCHDOG_HEARTBEAT_HEALTHY_MINUTES = 10;
export const WATCHDOG_HEARTBEAT_UNHEALTHY_MINUTES = 15;
export const WATCHDOG_TOKEN_WARNING_DAYS = 30;
/** Repeated-failure bar: two consecutive failed dispatches is a pattern. */
export const WATCHDOG_FAILURE_UNHEALTHY_COUNT = 2;

export interface WatchdogHealthInput {
  /** False when the watchdog tables do not exist (migration pending). */
  installed: boolean;
  config: {
    enabled: boolean;
    installedAt: string;
    githubTokenExpiresAt: string | null;
  } | null;
  /** Latest NON-probe invocation. */
  lastHeartbeatAt: string | null;
  lastDecision: string | null;
  lastErrorClass: string | null;
  lastAccepted: { claimedAt: string; githubRunId: number | null } | null;
  lastFailure: { finalizedAt: string; errorClass: string | null } | null;
  /** Failed dispatches newer than the last accepted one. */
  consecutiveFailures: number;
  /** Accepted-dispatch grace: how long a started workflow may need to land. */
  acceptedGraceMinutes: number;
}

export type WatchdogStatus =
  'not installed' | 'disabled' | 'awaiting first invocation' | 'healthy' | 'degraded' | 'UNHEALTHY';

export interface WatchdogSummary {
  status: WatchdogStatus;
  /** Only an activated watchdog may gate the ops:health exit code. */
  unhealthy: boolean;
  notes: string[];
}

function minutesAgo(iso: string, nowMs: number): number {
  return (nowMs - Date.parse(iso)) / 60_000;
}

export function summarizeWatchdog(input: WatchdogHealthInput, nowMs: number): WatchdogSummary {
  if (!input.installed) {
    return {
      status: 'not installed',
      unhealthy: false,
      notes: ['pre-activation: scheduler_watchdog migration not applied'],
    };
  }
  if (!input.config) {
    // The migration creates the row; its absence means someone deleted it.
    return {
      status: 'UNHEALTHY',
      unhealthy: true,
      notes: ['watchdog_config row missing — every tick decides configuration_error'],
    };
  }
  if (!input.config.enabled) {
    return {
      status: 'disabled',
      unhealthy: false,
      notes: ['watchdog_config.enabled is false (rollback state) — native schedule is on its own'],
    };
  }

  const notes: string[] = [];
  let status: WatchdogStatus = 'healthy';
  let unhealthy = false;

  // ── Heartbeat: is Supabase Cron invoking the function at all? ─────────────
  if (!input.lastHeartbeatAt) {
    const installedMinutes = minutesAgo(input.config.installedAt, nowMs);
    if (installedMinutes < WATCHDOG_HEARTBEAT_UNHEALTHY_MINUTES) {
      return {
        status: 'awaiting first invocation',
        unhealthy: false,
        notes: ['installed; first cron invocation expected within 5 minutes'],
      };
    }
    return {
      status: 'UNHEALTHY',
      unhealthy: true,
      notes: [
        `no invocation ${installedMinutes.toFixed(0)}m after install — Supabase Cron is not ` +
          'invoking the function (cron job, Vault secrets, or function deployment)',
      ],
    };
  }
  const heartbeatMinutes = minutesAgo(input.lastHeartbeatAt, nowMs);
  if (heartbeatMinutes > WATCHDOG_HEARTBEAT_UNHEALTHY_MINUTES) {
    status = 'UNHEALTHY';
    unhealthy = true;
    notes.push(
      `no heartbeat in ${heartbeatMinutes.toFixed(0)}m (threshold ` +
        `${WATCHDOG_HEARTBEAT_UNHEALTHY_MINUTES}m) — Supabase Cron stopped invoking the function`,
    );
  } else if (heartbeatMinutes > WATCHDOG_HEARTBEAT_HEALTHY_MINUTES) {
    status = 'degraded';
    notes.push(`heartbeat late (${heartbeatMinutes.toFixed(0)}m; expected every 5m)`);
  }

  // ── Latest decision ───────────────────────────────────────────────────────
  if (input.lastDecision === 'configuration_error') {
    status = 'UNHEALTHY';
    unhealthy = true;
    notes.push(
      `latest invocation reported configuration_error` +
        `${input.lastErrorClass ? ` (${input.lastErrorClass})` : ''} — the watchdog cannot dispatch`,
    );
  }

  // ── Dispatch outcomes ─────────────────────────────────────────────────────
  if (input.consecutiveFailures >= WATCHDOG_FAILURE_UNHEALTHY_COUNT) {
    status = 'UNHEALTHY';
    unhealthy = true;
    notes.push(
      `${input.consecutiveFailures} consecutive dispatch failures` +
        `${input.lastFailure?.errorClass ? ` (latest: ${input.lastFailure.errorClass})` : ''}`,
    );
  } else if (input.consecutiveFailures === 1 && status === 'healthy') {
    status = 'degraded';
    notes.push(
      `latest dispatch failed${input.lastFailure?.errorClass ? ` (${input.lastFailure.errorClass})` : ''} — retryable after backoff`,
    );
  }
  if (input.lastAccepted) {
    const acceptedMinutes = minutesAgo(input.lastAccepted.claimedAt, nowMs);
    if (acceptedMinutes <= input.acceptedGraceMinutes) {
      // Accepted and awaiting the workflow: NOT a failure. Source freshness
      // in the main health section says whether the run actually landed.
      notes.push(
        `accepted dispatch ${acceptedMinutes.toFixed(0)}m ago` +
          `${input.lastAccepted.githubRunId ? ` (run ${input.lastAccepted.githubRunId})` : ''} — ` +
          'workflow start within grace window',
      );
    }
  }

  // ── GitHub token lifecycle ────────────────────────────────────────────────
  if (input.config.githubTokenExpiresAt) {
    const daysLeft = -minutesAgo(input.config.githubTokenExpiresAt, nowMs) / (60 * 24);
    if (daysLeft <= 0) {
      status = 'UNHEALTHY';
      unhealthy = true;
      notes.push('GitHub token EXPIRED — dispatches will fail with github_unauthorized');
    } else if (daysLeft <= WATCHDOG_TOKEN_WARNING_DAYS) {
      if (status === 'healthy') status = 'degraded';
      notes.push(`GitHub token expires in ${daysLeft.toFixed(0)}d — rotate soon`);
    }
  } else {
    notes.push('token expiration not recorded (set watchdog_config.github_token_expires_at)');
  }

  return { status, unhealthy, notes };
}
