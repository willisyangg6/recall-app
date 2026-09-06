/**
 * O3-B2 applied-state health classification: every state the ops:health
 * section must distinguish, against the derived thresholds (30-min cadence,
 * 40-min watchdog window, pinned 90-min pending alarm, 26-h degraded sweep).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEGRADED_WARN_HOURS,
  PENDING_OVERDUE_MINUTES,
  PENDING_WARN_MINUTES,
  summarizeAppliedState,
  type ActionableApplyRow,
  type AppliedStateCounts,
} from './applied-state-health';

const NOW = Date.parse('2026-09-06T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function counts(partial: Partial<AppliedStateCounts>): AppliedStateCounts {
  return {
    totalRecords: 100,
    legacyUnverified: 0,
    pending: 0,
    applied: 100,
    appliedDegraded: 0,
    ...partial,
  };
}

const pendingRow = (ageMinutes: number, nativeId = 'P-1'): ActionableApplyRow => ({
  sourceSystem: 'fsis_api',
  nativeId,
  applyState: 'pending',
  latestFetchedAt: minutesAgo(ageMinutes),
  appliedAt: null,
});

const degradedRow = (ageHours: number, nativeId = 'D-1'): ActionableApplyRow => ({
  sourceSystem: 'fda_announcement',
  nativeId,
  applyState: 'applied_degraded',
  latestFetchedAt: minutesAgo(ageHours * 60),
  appliedAt: minutesAgo(ageHours * 60),
});

test('missing view is an explicit contract-not-installed state, never healthy', () => {
  const summary = summarizeAppliedState(null, [], NOW);
  assert.equal(summary.status, 'not installed');
  assert.equal(summary.unhealthy, false);
  assert.match(summary.notes[0], /not installed/);
  assert.equal(summary.reconciled, false);
});

test('a fully applied, reconciled population is healthy', () => {
  const summary = summarizeAppliedState(counts({}), [], NOW);
  assert.equal(summary.status, 'healthy');
  assert.equal(summary.reconciled, true);
  assert.ok(summary.notes.some((n) => /reconciliation complete/.test(n)));
});

test('a FRESH pending version is informational — expected to converge next tick', () => {
  const summary = summarizeAppliedState(counts({ pending: 1, applied: 99 }), [pendingRow(10)], NOW);
  assert.equal(summary.status, 'healthy');
  assert.ok(summary.notes.some((n) => /inside the first retry window/.test(n)));
  assert.deepEqual(summary.pendingBySystem, { fsis_api: 1 });
});

test('pending past one watchdog window degrades; several missed ticks is UNHEALTHY', () => {
  const warn = summarizeAppliedState(
    counts({ pending: 1, applied: 99 }),
    [pendingRow(PENDING_WARN_MINUTES + 5)],
    NOW,
  );
  assert.equal(warn.status, 'degraded');
  assert.equal(warn.unhealthy, false);

  const overdue = summarizeAppliedState(
    counts({ pending: 1, applied: 99 }),
    [pendingRow(PENDING_OVERDUE_MINUTES + 5, 'P-OVERDUE')],
    NOW,
  );
  assert.equal(overdue.status, 'UNHEALTHY');
  assert.equal(overdue.unhealthy, true);
  // Bounded identifiers for the actionable records, never payloads.
  assert.ok(overdue.notes.some((n) => n.includes('fsis_api/P-OVERDUE')));
  assert.equal(Math.round(overdue.oldestPendingMinutes!), PENDING_OVERDUE_MINUTES + 5);
});

test('a degraded FDA record stays visible and age-tracked; persistent degradation warns', () => {
  const fresh = summarizeAppliedState(
    counts({ appliedDegraded: 1, applied: 99 }),
    [degradedRow(2)],
    NOW,
  );
  assert.equal(fresh.status, 'healthy');
  assert.ok(fresh.notes.some((n) => /applied_degraded/.test(n)));

  const stale = summarizeAppliedState(
    counts({ appliedDegraded: 1, applied: 99 }),
    [degradedRow(DEGRADED_WARN_HOURS + 1, 'D-STALE')],
    NOW,
  );
  assert.equal(stale.status, 'degraded');
  assert.equal(stale.unhealthy, false); // listing coverage exists — warn, not fail
  assert.ok(stale.notes.some((n) => n.includes('fda_announcement/D-STALE')));
  assert.ok(stale.oldestDegradedHours! > DEGRADED_WARN_HOURS);
});

test('legacy-unverified is visible, blocks "settled", and is NOT an ingest failure', () => {
  const summary = summarizeAppliedState(
    counts({ legacyUnverified: 1900, applied: 0, totalRecords: 1900 }),
    [],
    NOW,
  );
  assert.equal(summary.status, 'healthy'); // migration-era state, not a fault
  assert.equal(summary.reconciled, false);
  assert.ok(summary.notes.some((n) => /NOT an ingest failure/.test(n)));
  assert.ok(summary.notes.some((n) => /not fully settled/.test(n)));
});

test('overdue pending outranks everything and the identifier list is bounded', () => {
  const rows = Array.from({ length: 15 }, (_, i) =>
    pendingRow(PENDING_OVERDUE_MINUTES + 10, `P-${i}`),
  );
  const summary = summarizeAppliedState(
    counts({ pending: 15, applied: 85, legacyUnverified: 3 }),
    rows,
    NOW,
  );
  assert.equal(summary.status, 'UNHEALTHY');
  const note = summary.notes.find((n) => /overdue/.test(n))!;
  assert.match(note, /\+5 more/); // 15 rows, 10 listed
});
