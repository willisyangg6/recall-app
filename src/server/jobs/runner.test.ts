import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryStore } from '../store/memory-store';
import {
  latestJobMetric,
  orderInsensitiveFeedHash,
  runJob,
  type JobContext,
  type JobSpec,
} from './runner';

const SPEC: JobSpec = { jobName: 'fsis_ingest', sourceSystem: 'fsis_api', leaseTtlSeconds: 1500 };

function context(store: MemoryStore, holder = 'test-host:1:local'): JobContext {
  return { store, now: () => new Date('2026-08-26T12:00:00Z'), version: 'abc123def456', holder };
}

test('a concurrent attempt at the same job is skipped, not failed', async () => {
  const store = new MemoryStore();
  // Another holder is mid-run.
  assert.equal(await store.acquireJobLease('fsis_ingest', 'other-host:9:local', 1500), true);

  const report = await runJob(SPEC, context(store), async () => {
    throw new Error('body must not run while the lease is held elsewhere');
  });
  assert.equal(report.outcome, 'skipped_lease');
  // A skip records nothing and leaves the original lease in place.
  assert.equal(store.ingestRuns.size, 0);
  assert.equal(store.leases.get('fsis_ingest')!.holder, 'other-host:9:local');
});

test('a stale (expired) lease from a crashed run is recovered', async () => {
  const store = new MemoryStore();
  let clock = Date.parse('2026-08-26T12:00:00Z');
  store.nowMs = () => clock;
  assert.equal(await store.acquireJobLease('fsis_ingest', 'crashed-host:7:old', 1500), true);

  // Within the TTL the job stays locked; after it, the next run takes over.
  assert.equal(await store.acquireJobLease('fsis_ingest', 'new-host:2:local', 1500), false);
  clock += 1501 * 1000;
  const report = await runJob(SPEC, context(store, 'new-host:2:local'), async () => ({
    pipelineRunId: null,
    outcome: 'succeeded',
    metrics: { itemsSeen: 1 },
  }));
  assert.equal(report.outcome, 'succeeded');
});

test('the lease is released after success AND after failure', async () => {
  const store = new MemoryStore();
  await runJob(SPEC, context(store), async () => ({
    pipelineRunId: null,
    outcome: 'succeeded',
    metrics: {},
  }));
  assert.equal(store.leases.has('fsis_ingest'), false);

  await runJob(SPEC, context(store), async () => {
    throw new Error('boom');
  });
  assert.equal(store.leases.has('fsis_ingest'), false);
});

test('every execution ends as one annotated run row; failures are recorded loudly', async () => {
  const store = new MemoryStore();
  const ok = await runJob(SPEC, context(store), async () => ({
    pipelineRunId: null,
    outcome: 'succeeded',
    metrics: { itemsSeen: 42, feedHash: 'aa' },
  }));
  assert.equal(ok.outcome, 'succeeded');

  const failed = await runJob(SPEC, context(store), async () => {
    throw new Error('source exploded');
  });
  assert.equal(failed.outcome, 'failed');
  assert.match(failed.error!, /source exploded/);

  const runs = await store.listRecentJobRuns('fsis_ingest', 10);
  assert.equal(runs.length, 2);
  for (const run of runs) {
    assert.equal(run.jobName, 'fsis_ingest');
    assert.equal(run.version, 'abc123def456');
  }
  const failedRun = runs.find((run) => run.outcome === 'failed')!;
  assert.match(failedRun.error!, /source exploded/);
  const okRun = runs.find((run) => run.outcome === 'succeeded')!;
  assert.equal(okRun.metrics!.itemsSeen, 42);
});

test('a partial body outcome overrides the run outcome', async () => {
  const store = new MemoryStore();
  // Simulate the FDA/FSIS shape: the pipeline already created its run row.
  const runId = await store.createIngestRun('fda_announcement', '2026-08-26T12:00:00Z');
  await store.finishIngestRun(runId, {
    finishedAt: '2026-08-26T12:01:00Z',
    outcome: 'succeeded',
    itemsSeen: 10,
    itemsChanged: 1,
    quarantined: [],
    error: null,
  });
  const report = await runJob(
    { jobName: 'fda_announcements', sourceSystem: 'fda_announcement', leaseTtlSeconds: 60 },
    context(store),
    async () => ({
      pipelineRunId: runId,
      outcome: 'partial',
      metrics: { detailFetchFailures: 2 },
    }),
  );
  assert.equal(report.outcome, 'partial');
  const [run] = await store.listRecentJobRuns('fda_announcements', 1);
  assert.equal(run.id, runId); // annotated in place, no second row
  assert.equal(run.outcome, 'partial');
});

test('latestJobMetric reads the newest non-failed run and skips failures', async () => {
  const store = new MemoryStore();
  const ctx = context(store);
  await runJob(SPEC, ctx, async () => ({
    pipelineRunId: null,
    outcome: 'succeeded',
    metrics: { feedHash: 'old-hash', itemsSeen: 100 },
  }));
  await runJob(SPEC, { ...ctx, now: () => new Date('2026-08-26T13:00:00Z') }, async () => {
    throw new Error('transient');
  });
  assert.equal(await latestJobMetric(store, 'fsis_ingest', 'feedHash'), 'old-hash');
  assert.equal(await latestJobMetric(store, 'fsis_ingest', 'missing-key'), null);
});

test('the feed hash ignores item order but not item content', () => {
  const a = { id: 1, title: 'x' };
  const b = { id: 2, title: 'y' };
  assert.equal(orderInsensitiveFeedHash([a, b]), orderInsensitiveFeedHash([b, a]));
  assert.notEqual(
    orderInsensitiveFeedHash([a, b]),
    orderInsensitiveFeedHash([a, { ...b, title: 'changed' }]),
  );
});
