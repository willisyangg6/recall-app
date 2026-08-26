/**
 * Push job through the C1 runner: same lease, same run bookkeeping, same
 * failure semantics as every other production job.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryPushStore } from '../push/memory-push-store';
import type { PushMessage, PushReceipt, PushTicket, PushTransport } from '../push/types';
import { MemoryStore } from '../../server/store/memory-store';
import { PUSH_JOB, runPushJob } from './push-job';
import type { JobContext } from './runner';

class NullTransport implements PushTransport {
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    return messages.map((_, i) => ({ status: 'ok', id: `t${i}` }));
  }
  async getReceipts(): Promise<Record<string, PushReceipt>> {
    return {};
  }
}

function makeCtx(store = new MemoryStore()): { ctx: JobContext; store: MemoryStore } {
  return {
    store,
    ctx: {
      store,
      now: () => new Date('2026-09-01T12:00:00.000Z'),
      version: 'testsha',
      holder: 'test-host:1:testsha',
    },
  };
}

test('every push job execution ends as exactly one annotated run row', async () => {
  const { ctx, store } = makeCtx();
  const report = await runPushJob(ctx, {
    pushStore: new MemoryPushStore(),
    transport: new NullTransport(),
    dryRun: false,
  });
  assert.equal(report.outcome, 'succeeded');
  assert.equal(report.metrics.activation, 'not_activated');
  const runs = await store.listRecentJobRuns('push_delivery', 10);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, 'succeeded');
  assert.equal(runs[0].version, 'testsha');
  assert.equal(runs[0].metrics?.activation, 'not_activated');
  assert.equal(store.leases.size, 0); // released
});

test('a held lease skips the run safely; a stale lease is recovered', async () => {
  const { ctx, store } = makeCtx();
  store.nowMs = () => Date.parse('2026-09-01T12:00:00.000Z');
  await store.acquireJobLease(PUSH_JOB.jobName, 'other-host:2:sha', PUSH_JOB.leaseTtlSeconds);

  const skipped = await runPushJob(ctx, {
    pushStore: new MemoryPushStore(),
    transport: new NullTransport(),
    dryRun: false,
  });
  assert.equal(skipped.outcome, 'skipped_lease');
  assert.equal((await store.listRecentJobRuns('push_delivery', 10)).length, 0);
  assert.equal(store.leases.get('push_delivery')?.holder, 'other-host:2:sha');

  // The other holder crashed: after the TTL the lease is free again.
  store.nowMs = () =>
    Date.parse('2026-09-01T12:00:00.000Z') + (PUSH_JOB.leaseTtlSeconds + 1) * 1000;
  const recovered = await runPushJob(ctx, {
    pushStore: new MemoryPushStore(),
    transport: new NullTransport(),
    dryRun: false,
  });
  assert.equal(recovered.outcome, 'succeeded');
});

test('a throwing push store records a loud failed run', async () => {
  const { ctx, store } = makeCtx();
  const broken = new MemoryPushStore();
  broken.getPushEnabledAt = async () => {
    throw new Error('database unreachable');
  };
  const report = await runPushJob(ctx, {
    pushStore: broken,
    transport: new NullTransport(),
    dryRun: false,
  });
  assert.equal(report.outcome, 'failed');
  assert.match(report.error ?? '', /database unreachable/);
  const runs = await store.listRecentJobRuns('push_delivery', 10);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, 'failed');
  assert.equal(store.leases.size, 0); // released even on failure
});
