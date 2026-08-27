import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attemptKind, summarizeJobRuns, type HealthRun } from './health';
import { SKIPPED_LEASE_METRIC } from './runner';

const NOW = Date.parse('2026-08-27T20:30:00Z');
const STALE_AFTER_HOURS = 3;

function run(startedAt: string, outcome: string | null, extra: Partial<HealthRun> = {}): HealthRun {
  return { startedAt, outcome, metrics: null, error: null, ...extra };
}

function skip(startedAt: string): HealthRun {
  return run(startedAt, null, { metrics: { [SKIPPED_LEASE_METRIC]: true, holder: 'host:1:sha' } });
}

const summarize = (runs: HealthRun[]) => summarizeJobRuns(runs, STALE_AFTER_HOURS, NOW);

test('attemptKind names every state an operator has to tell apart', () => {
  assert.equal(attemptKind(run('2026-08-27T20:00:00Z', 'succeeded')), 'succeeded');
  assert.equal(attemptKind(run('2026-08-27T20:00:00Z', 'partial')), 'partial');
  assert.equal(attemptKind(run('2026-08-27T20:00:00Z', 'failed')), 'failed');
  assert.equal(attemptKind(skip('2026-08-27T20:00:00Z')), 'skipped_lease');
  // Outcome-less and not a skip: in flight, or died before recording.
  assert.equal(attemptKind(run('2026-08-27T20:00:00Z', null)), 'running');
});

test('never ran', () => {
  const summary = summarize([]);
  assert.equal(summary.status, 'UNHEALTHY');
  assert.equal(summary.lastAttempt, null);
  assert.equal(summary.lastAttemptKind, null);
  assert.equal(summary.lastSuccess, null);
  assert.deepEqual(summary.notes, ['never ran']);
});

test('a recent success is healthy and reports both attempt and success', () => {
  const summary = summarize([run('2026-08-27T20:07:00Z', 'succeeded')]);
  assert.equal(summary.status, 'healthy');
  assert.equal(summary.lastAttemptKind, 'succeeded');
  assert.equal(summary.lastSuccess!.startedAt, '2026-08-27T20:07:00Z');
  assert.deepEqual(summary.notes, []);
});

test('partial still counts as a success for freshness but degrades status', () => {
  const summary = summarize([run('2026-08-27T20:07:00Z', 'partial')]);
  assert.equal(summary.status, 'degraded');
  assert.equal(summary.lastAttemptKind, 'partial');
  assert.equal(summary.lastSuccess!.startedAt, '2026-08-27T20:07:00Z');
  assert.match(summary.notes.join(' '), /item-level failures/);
});

test('a failed latest attempt over a fresh success is degraded, not unhealthy', () => {
  const summary = summarize([
    run('2026-08-27T20:07:00Z', 'failed', { error: 'source exploded' }),
    run('2026-08-27T19:37:00Z', 'succeeded'),
  ]);
  assert.equal(summary.status, 'degraded');
  assert.equal(summary.lastAttemptKind, 'failed');
  assert.match(summary.notes.join(' '), /latest run FAILED: source exploded/);
});

test('scheduler silence: stale with no attempt at all since the last success', () => {
  // The 2026-08-27 stall. GitHub never started the workflow.
  const summary = summarize([run('2026-08-27T14:34:00Z', 'succeeded')]);
  assert.equal(summary.status, 'UNHEALTHY');
  assert.equal(summary.schedulerSilent, true);
  assert.equal(summary.attemptsSinceSuccess, 0);
  assert.equal(summary.leaseSkipsSinceSuccess, 0);
  const notes = summary.notes.join(' ');
  assert.match(notes, /no success in 5\.9h \(threshold 3h\)/);
  assert.match(notes, /never started/);
  assert.match(notes, /check GitHub Actions, not the lease/);
});

test('lease contention: stale, but attempts ARE arriving and standing down', () => {
  const summary = summarize([
    skip('2026-08-27T20:07:00Z'),
    skip('2026-08-27T19:37:00Z'),
    skip('2026-08-27T19:07:00Z'),
    run('2026-08-27T14:34:00Z', 'succeeded'),
  ]);
  assert.equal(summary.status, 'UNHEALTHY');
  // Same "no success in 5.9h" symptom as scheduler silence — different cause,
  // and the whole point of recording skips is that these now read differently.
  assert.equal(summary.schedulerSilent, false);
  assert.equal(summary.attemptsSinceSuccess, 3);
  assert.equal(summary.leaseSkipsSinceSuccess, 3);
  assert.equal(summary.lastAttemptKind, 'skipped_lease');
  const notes = summary.notes.join(' ');
  assert.match(notes, /all 3 attempt\(s\) since the last success skipped on a held lease/);
  assert.match(notes, /the scheduler IS running/);
  assert.doesNotMatch(notes, /never started/);
});

test('a lease skip over a fresh success is never presented as a failure', () => {
  const summary = summarize([
    skip('2026-08-27T20:07:00Z'),
    run('2026-08-27T19:37:00Z', 'succeeded'),
  ]);
  // A healthy worker overlapping a manual run must not page anyone.
  assert.equal(summary.status, 'healthy');
  assert.equal(summary.lastAttemptKind, 'skipped_lease');
  assert.match(summary.notes.join(' '), /normal overlap, not a fault/);
  assert.doesNotMatch(summary.notes.join(' '), /FAILED/);
});

test('a lease skip can never satisfy freshness on its own', () => {
  const summary = summarize([skip('2026-08-27T20:29:00Z')]);
  // Newest possible skip, yet there is still no successful ingest.
  assert.equal(summary.status, 'UNHEALTHY');
  assert.equal(summary.lastSuccess, null);
  assert.match(summary.notes.join(' '), /no successful run recorded/);
});

test('mixed attempts since the last success are counted, not collapsed', () => {
  const summary = summarize([
    run('2026-08-27T20:07:00Z', 'failed', { error: 'boom' }),
    skip('2026-08-27T19:37:00Z'),
    run('2026-08-27T14:34:00Z', 'succeeded'),
  ]);
  assert.equal(summary.status, 'UNHEALTHY');
  assert.equal(summary.attemptsSinceSuccess, 2);
  assert.equal(summary.leaseSkipsSinceSuccess, 1);
  assert.match(summary.notes.join(' '), /1 of 2 attempt\(s\)/);
});
