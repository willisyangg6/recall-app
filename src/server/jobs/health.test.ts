import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attemptKind, describeEnforcementExport, summarizeJobRuns, type HealthRun } from './health';
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

// ── Two-stage freshness (2026-09-09) ────────────────────────────────────────
//
// A single 30h threshold on a 24h schedule fired UNHEALTHY on a working
// pipeline, because GitHub Actions delivers `schedule` events 3.5–7.8h late.
// Warning at 30h, unhealthy at 36h. These tests pin both boundaries and the
// two real incidents that motivated them.

const DAILY = { staleAfterHours: 36, warnAfterHours: 30 };
const hoursAgoRun = (hours: number): HealthRun => ({
  startedAt: new Date(Date.parse('2026-09-09T12:00:00Z') - hours * 3_600_000).toISOString(),
  outcome: 'succeeded',
  metrics: null,
  error: null,
});
const DAILY_NOW = Date.parse('2026-09-09T12:00:00Z');

test('a daily job inside the warning threshold is healthy and reports its thresholds', () => {
  const summary = summarizeJobRuns([hoursAgoRun(29.9)], DAILY, DAILY_NOW);
  assert.equal(summary.status, 'healthy');
  assert.equal(summary.freshness, 'fresh');
  assert.deepEqual(summary.notes, []);
  assert.deepEqual(summary.thresholds, { staleAfterHours: 36, warnAfterHours: 30 });
  assert.ok(Math.abs((summary.hoursSinceSuccess ?? 0) - 29.9) < 0.01);
});

test('the warning boundary is exclusive at 30h and open just past it', () => {
  assert.equal(summarizeJobRuns([hoursAgoRun(30)], DAILY, DAILY_NOW).freshness, 'fresh');
  assert.equal(summarizeJobRuns([hoursAgoRun(30.01)], DAILY, DAILY_NOW).freshness, 'warning');
});

test('a delayed-but-successful daily run warns without failing — the false-UNHEALTHY fix', () => {
  // 24h period + the 7.8h worst observed GitHub delivery delay.
  const summary = summarizeJobRuns([hoursAgoRun(31.8)], DAILY, DAILY_NOW);
  assert.equal(summary.status, 'degraded');
  assert.equal(summary.freshness, 'warning');
  assert.notEqual(summary.status, 'UNHEALTHY');
  const notes = summary.notes.join(' ');
  assert.match(notes, /no success in 31\.8h/);
  assert.match(notes, /warning threshold/);
  assert.match(notes, /delayed GitHub Actions schedule delivery, not yet a missed run/);
  // Under the old single 30h threshold this exact case was UNHEALTHY.
  assert.equal(summarizeJobRuns([hoursAgoRun(31.8)], 30, DAILY_NOW).status, 'UNHEALTHY');
});

test('the unhealthy boundary is exclusive at 36h and open just past it', () => {
  assert.equal(summarizeJobRuns([hoursAgoRun(36)], DAILY, DAILY_NOW).status, 'degraded');
  assert.equal(summarizeJobRuns([hoursAgoRun(36.01)], DAILY, DAILY_NOW).status, 'UNHEALTHY');
  assert.equal(summarizeJobRuns([hoursAgoRun(36.01)], DAILY, DAILY_NOW).freshness, 'stale');
});

test('the real 39.1h enforcement stall is still UNHEALTHY under the new thresholds', () => {
  const summary = summarizeJobRuns([hoursAgoRun(39.1)], DAILY, DAILY_NOW);
  assert.equal(summary.status, 'UNHEALTHY');
  assert.equal(summary.freshness, 'stale');
  assert.match(summary.notes.join(' '), /no success in 39\.1h \(threshold 36h\)/);
});

test('a fully missed day can never pass, however late the delivery', () => {
  for (const hours of [48, 56, 72]) {
    assert.equal(summarizeJobRuns([hoursAgoRun(hours)], DAILY, DAILY_NOW).status, 'UNHEALTHY');
  }
});

test('a warning still explains scheduler silence versus lease contention', () => {
  const summary = summarizeJobRuns([hoursAgoRun(32)], DAILY, DAILY_NOW);
  assert.match(summary.notes.join(' '), /the workflow never started/);
  assert.equal(summary.schedulerSilent, true);
});

test('a failed latest attempt is reported even when freshness already warns', () => {
  const summary = summarizeJobRuns(
    [
      { startedAt: '2026-09-09T11:00:00Z', outcome: 'failed', metrics: null, error: 'boom' },
      hoursAgoRun(32),
    ],
    DAILY,
    DAILY_NOW,
  );
  assert.equal(summary.freshness, 'warning');
  // Both facts survive: the delay AND the failure.
  assert.match(summary.notes.join(' '), /no success in 32\.0h/);
  assert.match(summary.notes.join(' '), /latest run FAILED: boom/);
});

test('a warning threshold at or above the stale one is ignored, never weakening it', () => {
  const summary = summarizeJobRuns(
    [hoursAgoRun(37)],
    { staleAfterHours: 36, warnAfterHours: 40 },
    DAILY_NOW,
  );
  assert.equal(summary.status, 'UNHEALTHY');
  assert.equal(summary.thresholds.warnAfterHours, undefined);
});

test('sub-hourly jobs keep one threshold and behave exactly as before', () => {
  const summary = summarizeJobRuns([hoursAgoRun(5.9)], { staleAfterHours: 3 }, DAILY_NOW);
  assert.equal(summary.status, 'UNHEALTHY');
  assert.equal(summary.freshness, 'stale');
  assert.equal(summary.thresholds.warnAfterHours, undefined);
  assert.match(summary.notes.join(' '), /no success in 5\.9h \(threshold 3h\)/);
  // A bare number and the equivalent object are interchangeable.
  assert.deepEqual(summarizeJobRuns([hoursAgoRun(5.9)], 3, DAILY_NOW).notes, summary.notes);
});

// ── Enforcement export wording (2026-09-09) ─────────────────────────────────
//
// `ops:health` printed "source export date: 2026-08-27", which read as though
// openFDA had been queried. It had not been — that value is OUR
// completedExportDate. These tests pin the corrected labels and the four states
// that must stay distinguishable.

const exportRun = (metrics: Record<string, unknown>, startedAt = '2026-09-09T09:00:00Z') =>
  ({ startedAt, outcome: 'succeeded', metrics, error: null }) as HealthRun;
const EXPORT_NOW = Date.parse('2026-09-09T12:00:00Z');

test('the applied export is labelled as our stored state, not an upstream check', () => {
  const report = describeEnforcementExport(
    [exportRun({ completedExportDate: '2026-09-08' })],
    10,
    EXPORT_NOW,
  );
  const text = report.notes.join(' ');
  // 2026-09-08T00:00Z to 2026-09-09T12:00Z is 1.5d, rendered as 2d — the same
  // line production printed after daily-maintenance #16 applied that export.
  assert.match(text, /last applied enforcement export: 2026-09-08 \(2d ago\)/);
  assert.match(text, /our reconciled database state; openFDA was not queried/);
  // The misleading label is gone for good.
  assert.doesNotMatch(text, /source export date/);
  assert.equal(report.lastAppliedExport, '2026-09-08');
  assert.equal(report.staleExport, false);
});

test('a stale applied export says stored state, not that upstream refreshed late', () => {
  const report = describeEnforcementExport(
    [exportRun({ completedExportDate: '2026-08-27' })],
    10,
    EXPORT_NOW,
  );
  assert.equal(report.staleExport, true);
  const text = report.notes.join(' ');
  assert.match(text, /last applied export older than 10d/);
  assert.match(text, /missed or has not been applied/);
  assert.match(text, /upstream freshness unverified here/);
  // Never claims the source was checked.
  assert.doesNotMatch(text, /weekly source refresh missed/);
});

test('an export seen but not applied is reported separately from one applied', () => {
  const report = describeEnforcementExport(
    [
      exportRun({ checkedExportDate: '2026-09-08' }, '2026-09-09T10:00:00Z'),
      exportRun({ completedExportDate: '2026-09-01' }, '2026-09-02T09:00:00Z'),
    ],
    10,
    EXPORT_NOW,
  );
  assert.equal(report.lastAppliedExport, '2026-09-01');
  assert.equal(report.seenNotApplied, '2026-09-08');
  const text = report.notes.join(' ');
  assert.match(text, /last applied enforcement export: 2026-09-01/);
  assert.match(text, /a later export \(2026-09-08\) has been seen but NOT applied/);
  assert.match(text, /dry run or did not complete/);
});

test('a dry run alone never looks like a reconciled export', () => {
  const report = describeEnforcementExport(
    [exportRun({ checkedExportDate: '2026-09-08' })],
    10,
    EXPORT_NOW,
  );
  assert.equal(report.lastAppliedExport, null);
  assert.equal(report.staleExport, false);
  assert.match(
    report.notes.join(' '),
    /no applied reconciliation recorded yet; most recent run checked export 2026-09-08 without applying it/,
  );
});

test('no enforcement history at all is stated plainly', () => {
  const report = describeEnforcementExport([], 10, EXPORT_NOW);
  assert.deepEqual(report.notes, ['no applied reconciliation recorded yet']);
  assert.equal(report.lastAppliedExport, null);
  assert.equal(report.seenNotApplied, null);
});

test('a checked export older than the applied one does not displace it', () => {
  const report = describeEnforcementExport(
    [
      exportRun({ checkedExportDate: '2026-08-20' }, '2026-09-09T10:00:00Z'),
      exportRun({ completedExportDate: '2026-09-08' }, '2026-09-08T09:00:00Z'),
    ],
    10,
    EXPORT_NOW,
  );
  assert.equal(report.seenNotApplied, null);
  assert.doesNotMatch(report.notes.join(' '), /seen but NOT applied/);
});
