/**
 * Watchdog health classification and report loading. The states here are the
 * whole point of the watchdog's observability: each layer's silence must map
 * to a DIFFERENT reading, and pre-activation must never alarm.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  summarizeWatchdog,
  WATCHDOG_FAILURE_UNHEALTHY_COUNT,
  type WatchdogHealthInput,
} from './health';
import { formatWatchdogSection, loadWatchdogReport } from './report';

const NOW = Date.parse('2026-08-28T18:00:00Z');

function minutesBefore(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

function input(overrides: Partial<WatchdogHealthInput> = {}): WatchdogHealthInput {
  return {
    installed: true,
    config: {
      enabled: true,
      installedAt: minutesBefore(60 * 24),
      githubTokenExpiresAt: minutesBefore(-90 * 24 * 60),
    },
    lastHeartbeatAt: minutesBefore(3),
    lastDecision: 'fresh',
    lastErrorClass: null,
    lastAccepted: null,
    lastFailure: null,
    consecutiveFailures: 0,
    acceptedGraceMinutes: 20,
    ...overrides,
  };
}

// ── Pre-activation states never alarm ────────────────────────────────────────

test('not installed is an explicit pre-activation state, not a failure', () => {
  const summary = summarizeWatchdog(input({ installed: false, config: null }), NOW);
  assert.equal(summary.status, 'not installed');
  assert.equal(summary.unhealthy, false);
});

test('a freshly installed watchdog awaiting its first cron invocation is calm', () => {
  const summary = summarizeWatchdog(
    input({
      lastHeartbeatAt: null,
      lastDecision: null,
      config: { enabled: true, installedAt: minutesBefore(4), githubTokenExpiresAt: null },
    }),
    NOW,
  );
  assert.equal(summary.status, 'awaiting first invocation');
  assert.equal(summary.unhealthy, false);
});

test('disabled (rollback) reads as disabled, never unhealthy', () => {
  const summary = summarizeWatchdog(
    input({
      config: { enabled: false, installedAt: minutesBefore(600), githubTokenExpiresAt: null },
    }),
    NOW,
  );
  assert.equal(summary.status, 'disabled');
  assert.equal(summary.unhealthy, false);
});

test('a deleted config row is loud', () => {
  const summary = summarizeWatchdog(input({ config: null }), NOW);
  assert.equal(summary.status, 'UNHEALTHY');
  assert.equal(summary.unhealthy, true);
});

// ── Heartbeat: is Supabase Cron invoking at all? ─────────────────────────────

test('an installed watchdog that cron NEVER invoked goes unhealthy after 15 minutes', () => {
  const summary = summarizeWatchdog(
    input({
      lastHeartbeatAt: null,
      lastDecision: null,
      config: { enabled: true, installedAt: minutesBefore(45), githubTokenExpiresAt: null },
    }),
    NOW,
  );
  assert.equal(summary.status, 'UNHEALTHY');
  assert.equal(summary.unhealthy, true);
  assert.match(summary.notes.join(' '), /Cron is not\s+invoking/);
});

test('a heartbeat within 10 minutes is healthy', () => {
  const summary = summarizeWatchdog(input({ lastHeartbeatAt: minutesBefore(6) }), NOW);
  assert.equal(summary.status, 'healthy');
  assert.equal(summary.unhealthy, false);
});

test('a heartbeat between 10 and 15 minutes is degraded, not yet an alarm', () => {
  const summary = summarizeWatchdog(input({ lastHeartbeatAt: minutesBefore(12) }), NOW);
  assert.equal(summary.status, 'degraded');
  assert.equal(summary.unhealthy, false);
});

test('no heartbeat for over 15 minutes means cron stopped — unhealthy', () => {
  const summary = summarizeWatchdog(input({ lastHeartbeatAt: minutesBefore(40) }), NOW);
  assert.equal(summary.status, 'UNHEALTHY');
  assert.match(summary.notes.join(' '), /stopped invoking/);
});

// ── Decisions and dispatch outcomes ──────────────────────────────────────────

test('a latest configuration_error decision is unhealthy with its class named', () => {
  const summary = summarizeWatchdog(
    input({ lastDecision: 'configuration_error', lastErrorClass: 'missing_github_token' }),
    NOW,
  );
  assert.equal(summary.status, 'UNHEALTHY');
  assert.match(summary.notes.join(' '), /missing_github_token/);
});

test('one failed dispatch is degraded (retryable), repeated failures are unhealthy', () => {
  const one = summarizeWatchdog(
    input({
      consecutiveFailures: 1,
      lastFailure: { finalizedAt: minutesBefore(7), errorClass: 'network_timeout' },
    }),
    NOW,
  );
  assert.equal(one.status, 'degraded');
  assert.equal(one.unhealthy, false);

  const repeated = summarizeWatchdog(
    input({
      consecutiveFailures: WATCHDOG_FAILURE_UNHEALTHY_COUNT,
      lastFailure: { finalizedAt: minutesBefore(3), errorClass: 'github_unauthorized' },
    }),
    NOW,
  );
  assert.equal(repeated.status, 'UNHEALTHY');
  assert.equal(repeated.unhealthy, true);
  assert.match(repeated.notes.join(' '), /github_unauthorized/);
});

test('an accepted dispatch awaiting the workflow within grace stays healthy, never failed', () => {
  const summary = summarizeWatchdog(
    input({
      lastDecision: 'dispatch_claimed',
      lastAccepted: { claimedAt: minutesBefore(5), githubRunId: 4242 },
    }),
    NOW,
  );
  assert.equal(summary.status, 'healthy');
  assert.match(summary.notes.join(' '), /accepted dispatch 5m ago \(run 4242\)/);
});

// ── GitHub token lifecycle ───────────────────────────────────────────────────

test('a token expiring within 30 days warns; an expired token is unhealthy', () => {
  const soon = summarizeWatchdog(
    input({
      config: {
        enabled: true,
        installedAt: minutesBefore(600),
        githubTokenExpiresAt: minutesBefore(-10 * 24 * 60),
      },
    }),
    NOW,
  );
  assert.equal(soon.status, 'degraded');
  assert.match(soon.notes.join(' '), /expires in 10d/);

  const expired = summarizeWatchdog(
    input({
      config: {
        enabled: true,
        installedAt: minutesBefore(600),
        githubTokenExpiresAt: minutesBefore(60),
      },
    }),
    NOW,
  );
  assert.equal(expired.status, 'UNHEALTHY');
  assert.match(expired.notes.join(' '), /EXPIRED/);
});

test('an unrecorded token expiry is noted without changing status', () => {
  const summary = summarizeWatchdog(
    input({
      config: { enabled: true, installedAt: minutesBefore(600), githubTokenExpiresAt: null },
    }),
    NOW,
  );
  assert.equal(summary.status, 'healthy');
  assert.match(summary.notes.join(' '), /not recorded/);
});

// ── Report loading (fake PostgREST client) ───────────────────────────────────

interface FakeTables {
  watchdog_config?: { rows: unknown[] } | { missing: true };
  watchdog_invocations?: { rows: unknown[] };
  watchdog_dispatches?: { rows: unknown[] };
}

function fakeClient(
  tables: FakeTables,
  log: { probeFiltered: boolean } = { probeFiltered: false },
) {
  return {
    from(table: string) {
      const spec = tables[table as keyof FakeTables];
      const result = async () => {
        if (spec && 'missing' in spec) {
          return { data: null, error: { message: `relation "public.${table}" does not exist` } };
        }
        return { data: (spec?.rows ?? []) as unknown[], error: null };
      };
      const limited = { limit: (_n: number) => result() };
      const ordered = { order: (_c: string, _o: { ascending: boolean }) => limited };
      return {
        select: (_columns: string) => ({
          limit: (_n: number) => result(),
          eq: (column: string, value: unknown) => {
            if (column === 'probe' && value === false) log.probeFiltered = true;
            return ordered;
          },
          order: (_c: string, _o: { ascending: boolean }) => limited,
        }),
      };
    },
  };
}

const CONFIG_ROW = {
  enabled: true,
  installed_at: minutesBefore(600),
  github_token_expires_at: null,
  cooldown_minutes: 20,
};

test('missing watchdog tables load as the pre-activation report', async () => {
  const report = await loadWatchdogReport(fakeClient({ watchdog_config: { missing: true } }), NOW);
  assert.equal(report, null);
  assert.match(
    formatWatchdogSection(report).join('\n'),
    /not installed \(scheduler_watchdog migration pending\)/,
  );
});

test('heartbeats exclude probes, so a manual probe cannot mask a dead cron', async () => {
  const log = { probeFiltered: false };
  await loadWatchdogReport(
    fakeClient(
      {
        watchdog_config: { rows: [CONFIG_ROW] },
        watchdog_invocations: { rows: [] },
        watchdog_dispatches: { rows: [] },
      },
      log,
    ),
    NOW,
  );
  assert.equal(log.probeFiltered, true);
});

test('consecutive failures count newest-first, stop at an acceptance, and skip in-flight claims', async () => {
  const report = await loadWatchdogReport(
    fakeClient({
      watchdog_config: { rows: [CONFIG_ROW] },
      watchdog_invocations: {
        rows: [
          {
            invoked_at: minutesBefore(2),
            decision: 'dispatch_claimed',
            stale_sources: ['fda_announcements'],
            error_class: null,
          },
        ],
      },
      watchdog_dispatches: {
        rows: [
          {
            claimed_at: minutesBefore(2),
            status: 'claimed',
            github_run_id: null,
            error_class: null,
            finalized_at: null,
          },
          {
            claimed_at: minutesBefore(12),
            status: 'failed',
            github_run_id: null,
            error_class: 'network_timeout',
            finalized_at: minutesBefore(12),
          },
          {
            claimed_at: minutesBefore(22),
            status: 'failed',
            github_run_id: null,
            error_class: 'github_server_error',
            finalized_at: minutesBefore(22),
          },
          {
            claimed_at: minutesBefore(90),
            status: 'accepted',
            github_run_id: 99,
            error_class: null,
            finalized_at: minutesBefore(90),
          },
          {
            claimed_at: minutesBefore(200),
            status: 'failed',
            github_run_id: null,
            error_class: 'network_error',
            finalized_at: minutesBefore(200),
          },
        ],
      },
    }),
    NOW,
  );
  assert.ok(report);
  assert.equal(report.input.consecutiveFailures, 2);
  assert.equal(report.input.lastAccepted?.githubRunId, 99);
  assert.equal(report.input.lastFailure?.errorClass, 'network_timeout');
});

test('the formatted section carries every field the founder needs', async () => {
  const report = await loadWatchdogReport(
    fakeClient({
      watchdog_config: { rows: [CONFIG_ROW] },
      watchdog_invocations: {
        rows: [
          { invoked_at: minutesBefore(3), decision: 'fresh', stale_sources: [], error_class: null },
        ],
      },
      watchdog_dispatches: { rows: [] },
    }),
    NOW,
  );
  const text = formatWatchdogSection(report).join('\n');
  for (const label of [
    'status:',
    'last heartbeat:',
    'last decision:',
    'last accepted dispatch:',
    'last dispatch failure:',
    'consecutive failures:',
    'token expiration:',
  ]) {
    assert.ok(text.includes(label), `missing "${label}"`);
  }
  assert.match(text, /healthy/);
});
