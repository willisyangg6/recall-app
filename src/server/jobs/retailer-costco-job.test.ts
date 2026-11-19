import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fixtureAgencyCases,
  fixtureExtract,
  fixtureIndexHtml,
  fixtureSource,
  FIXTURE_IDS,
} from '../retailer/fixtures/costco-fixtures';
import { MemoryRetailerNoticeStore } from '../retailer/store';
import { MemoryStore } from '../store/memory-store';
import { RETAILER_MIN_INTERVAL_MINUTES, runRetailerCostcoJob } from './retailer-costco-job';
import type { JobContext } from './runner';

const agencyCases = fixtureAgencyCases();

function context(store: MemoryStore, at = '2026-11-14T22:23:00Z'): JobContext {
  return {
    store,
    now: () => new Date(at),
    version: 'abc123def456',
    holder: 'runner:1:abc123def456',
  };
}

test('a scheduled run records one run row with the new notices and the review queue', async () => {
  const ops = new MemoryStore();
  const notices = new MemoryRetailerNoticeStore(agencyCases);
  const report = await runRetailerCostcoJob(context(ops), {
    dryRun: false,
    store: notices,
    source: fixtureSource(),
    extract: fixtureExtract,
  });
  assert.equal(report.outcome, 'succeeded');
  assert.equal(notices.notices.size, 21);
  assert.equal(notices.documents.length, 21);

  const [run] = await ops.listRecentJobRuns('retailer_costco', 10);
  assert.equal(run.outcome, 'succeeded');
  assert.equal(run.version, 'abc123def456');
  const metrics = run.metrics!;
  assert.equal(metrics.written, 42);
  assert.equal((metrics.newOrChanged as unknown[]).length, 21);
  assert.deepEqual(
    (metrics.reviewQueue as { nativeId: string }[]).map((item) => item.nativeId).sort(),
    [
      FIXTURE_IDS.meatloaf,
      FIXTURE_IDS.punahele,
      FIXTURE_IDS.shoyuRamen,
      FIXTURE_IDS.yakitori,
    ].sort(),
  );
  assert.equal(ops.leases.has('retailer_costco'), false, 'the lease is released');
});

test('a repeat run reports nothing new and archives no document', async () => {
  const ops = new MemoryStore();
  const notices = new MemoryRetailerNoticeStore(agencyCases);
  const options = { dryRun: false, store: notices, extract: fixtureExtract };
  await runRetailerCostcoJob(context(ops), { ...options, source: fixtureSource() });
  await runRetailerCostcoJob(context(ops, '2026-11-15T00:23:00Z'), {
    ...options,
    source: fixtureSource(),
  });

  const [latest] = await ops.listRecentJobRuns('retailer_costco', 10);
  assert.deepEqual(latest.metrics!.newOrChanged, []);
  assert.deepEqual(latest.metrics!.changes, { touch: 21 });
  assert.equal(latest.metrics!.documentsArchived, 0);
  assert.equal(notices.notices.size, 21);
  assert.equal(notices.documents.length, 21);
});

test('a letter that cannot be fetched makes the run partial, never silent', async () => {
  const ops = new MemoryStore();
  const notices = new MemoryRetailerNoticeStore(agencyCases);
  const report = await runRetailerCostcoJob(context(ops), {
    dryRun: false,
    store: notices,
    source: fixtureSource({ failIds: [FIXTURE_IDS.whippedCream] }),
    extract: fixtureExtract,
  });
  assert.equal(report.outcome, 'partial');
  assert.match(report.error ?? '', /1 Costco letter/);
  assert.equal(notices.notices.size, 20);
  const [run] = await ops.listRecentJobRuns('retailer_costco', 10);
  assert.equal(run.outcome, 'partial');
});

test('an unreadable index fails the run and writes no notice', async () => {
  const ops = new MemoryStore();
  const notices = new MemoryRetailerNoticeStore(agencyCases);
  const report = await runRetailerCostcoJob(context(ops), {
    dryRun: false,
    store: notices,
    source: {
      fetchIndexHtml: async () => '<html></html>',
      fetchDocument: async () => {
        throw new Error('not reached');
      },
    },
    extract: fixtureExtract,
  });
  assert.equal(report.outcome, 'failed');
  assert.equal(notices.notices.size, 0);
  const [run] = await ops.listRecentJobRuns('retailer_costco', 10);
  assert.equal(run.outcome, 'failed');
  assert.ok(fixtureIndexHtml().length > 0);
});

test('a dry run writes no notice and no document', async () => {
  const notices = new MemoryRetailerNoticeStore(agencyCases);
  const report = await runRetailerCostcoJob(context(new MemoryStore()), {
    dryRun: true,
    store: notices,
    source: fixtureSource(),
    extract: fixtureExtract,
  });
  assert.equal(report.outcome, 'succeeded');
  assert.equal(report.metrics.written, null);
  assert.equal(notices.notices.size, 0);
  assert.equal(notices.documents.length, 0);
});

// ── Due gate (alert timing, 2026-11-19) ─────────────────────────────────────
// The monitors also ride the ~45-minute agency tick, so the job itself keeps
// the two-hour cadence: a run within RETAILER_MIN_INTERVAL_MINUTES of the last
// success stands down before fetching anything.

const minutesAfter = (iso: string, minutes: number) =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
const T0 = '2026-11-19T10:07:00.000Z';

test('a tick inside the minimum interval stands down: no fetch, no run row, lease released', async () => {
  const ops = new MemoryStore();
  const notices = new MemoryRetailerNoticeStore(agencyCases);
  const options = { dryRun: false, store: notices, extract: fixtureExtract };
  await runRetailerCostcoJob(context(ops, T0), { ...options, source: fixtureSource() });

  const source = fixtureSource();
  const tick = minutesAfter(T0, RETAILER_MIN_INTERVAL_MINUTES - 1);
  const report = await runRetailerCostcoJob(context(ops, tick), { ...options, source });
  assert.equal(report.outcome, 'skipped_not_due');
  assert.deepEqual(source.requests, [], 'nothing is fetched');
  assert.equal((await ops.listRecentJobRuns('retailer_costco', 10)).length, 1);
  assert.equal(ops.leases.has('retailer_costco'), false, 'the lease is released');
});

test('the first tick at or after the interval runs, and --force runs inside it', async () => {
  const ops = new MemoryStore();
  const notices = new MemoryRetailerNoticeStore(agencyCases);
  const options = { dryRun: false, store: notices, extract: fixtureExtract };
  await runRetailerCostcoJob(context(ops, T0), { ...options, source: fixtureSource() });

  const due = await runRetailerCostcoJob(
    context(ops, minutesAfter(T0, RETAILER_MIN_INTERVAL_MINUTES)),
    { ...options, source: fixtureSource() },
  );
  assert.equal(due.outcome, 'succeeded');

  const forced = await runRetailerCostcoJob(
    context(ops, minutesAfter(T0, RETAILER_MIN_INTERVAL_MINUTES + 5)),
    { ...options, source: fixtureSource(), force: true },
  );
  assert.equal(forced.outcome, 'succeeded');
  assert.equal((await ops.listRecentJobRuns('retailer_costco', 10)).length, 3);
});

test('a failed run never counts as recent: the next tick retries at once', async () => {
  const ops = new MemoryStore();
  const notices = new MemoryRetailerNoticeStore(agencyCases);
  const failing = {
    fetchIndexHtml: async () => '<html></html>',
    fetchDocument: async () => {
      throw new Error('not reached');
    },
  };
  const failed = await runRetailerCostcoJob(context(ops, T0), {
    dryRun: false,
    store: notices,
    source: failing,
    extract: fixtureExtract,
  });
  assert.equal(failed.outcome, 'failed');
  const retry = await runRetailerCostcoJob(context(ops, minutesAfter(T0, 45)), {
    dryRun: false,
    store: notices,
    source: fixtureSource(),
    extract: fixtureExtract,
  });
  assert.equal(retry.outcome, 'succeeded');
});

test('two triggers at once (agency tick + retailer cron) process the index exactly once', async () => {
  const ops = new MemoryStore();
  const notices = new MemoryRetailerNoticeStore(agencyCases);
  const [a, b] = [fixtureSource(), fixtureSource()];
  const run = (source: ReturnType<typeof fixtureSource>, holder: string) =>
    runRetailerCostcoJob(
      { ...context(ops, T0), holder },
      { dryRun: false, store: notices, source, extract: fixtureExtract },
    );
  const reports = await Promise.all([run(a, 'tick:1'), run(b, 'cron:2')]);
  assert.deepEqual(reports.map((report) => report.outcome).sort(), ['skipped_lease', 'succeeded']);
  assert.equal([a, b].filter((source) => source.requests.length > 0).length, 1, 'one fetch');
  // And a third trigger moments later finds the fresh success and stands down.
  const later = await runRetailerCostcoJob(
    { ...context(ops, minutesAfter(T0, 3)), holder: 'tick:3' },
    { dryRun: false, store: notices, source: fixtureSource(), extract: fixtureExtract },
  );
  assert.equal(later.outcome, 'skipped_not_due');
  assert.equal(notices.documents.length, 21, 'no document archived twice');
});
