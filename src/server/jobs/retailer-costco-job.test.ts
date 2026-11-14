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
import { runRetailerCostcoJob } from './retailer-costco-job';
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
