import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFixture } from '../fsis/fixtures';
import type { FsisRawRecord } from '../fsis/parse';
import { MemoryStore } from '../store/memory-store';
import { runFsisJob } from './fsis-job';
import type { JobContext } from './runner';

const NOW = () => new Date('2026-08-21T12:00:00Z');

function context(store: MemoryStore): JobContext {
  return { store, now: NOW, version: 'testsha', holder: 'test:1:testsha' };
}

function feed(records: FsisRawRecord[]) {
  return async () => ({
    records,
    fetchedAt: '2026-08-21T00:00:00Z',
    sourceUrl: 'fixture',
  });
}

const RECALL = loadFixture('recall-active-nationwide-017-2026');

test('a scheduled FSIS run ingests one new recall with exactly one initial event', async () => {
  const store = new MemoryStore();
  const report = await runFsisJob(context(store), { fetchRecords: feed([RECALL]) });

  assert.equal(report.outcome, 'succeeded');
  assert.equal(store.cases.size, 1);
  const initials = [...store.notifications.values()].filter((n) => n.kind === 'initial');
  assert.equal(initials.length, 1);
  const [run] = await store.listRecentJobRuns('fsis_ingest', 1);
  assert.equal(run.jobName, 'fsis_ingest');
  assert.equal(typeof run.metrics!.feedHash, 'string');
});

test('an unchanged feed skips; a forced retry is idempotent; a changed record re-projects once', async () => {
  const store = new MemoryStore();
  await runFsisJob(context(store), { fetchRecords: feed([RECALL]) });
  const eventsAfterFirst = store.notifications.size;

  // Unchanged content → the whole-feed gate skips per-record work.
  const skip = await runFsisJob(context(store), { fetchRecords: feed([RECALL]) });
  assert.equal(skip.metrics.skipped, 'source_unchanged');
  assert.equal(store.notifications.size, eventsAfterFirst);

  // Scheduler retry with the gate bypassed: per-record hash gate holds.
  const retry = await runFsisJob(context(store), { fetchRecords: feed([RECALL]), force: true });
  assert.equal(retry.metrics.unchanged, 1);
  assert.equal(store.notifications.size, eventsAfterFirst);

  // A changed record: new snapshot, one changed case, still no duplicate initial.
  const changed = { ...RECALL, field_title: `${RECALL.field_title} (updated)` };
  const changedRun = await runFsisJob(context(store), { fetchRecords: feed([changed]) });
  assert.equal(changedRun.metrics.changedCases, 1);
  assert.equal([...store.notifications.values()].filter((n) => n.kind === 'initial').length, 1);
});

test('SOURCE EMPTY is SOURCE FAILED: zero records fails; a halved feed fails', async () => {
  const store = new MemoryStore();
  const empty = await runFsisJob(context(store), { fetchRecords: feed([]) });
  assert.equal(empty.outcome, 'failed');
  assert.match(empty.error!, /SOURCE FAILURE/);

  // Establish a five-record baseline, then shrink to one.
  const five = [
    RECALL,
    ...[1, 2, 3, 4].map((n) => ({ ...RECALL, field_recall_number: `0${n}9-2026` })),
  ];
  await runFsisJob(context(store), { fetchRecords: feed(five) });
  const shrunk = await runFsisJob(context(store), { fetchRecords: feed([RECALL]) });
  assert.equal(shrunk.outcome, 'failed');
  assert.match(shrunk.error!, /implausibly small/);
  // Nothing was deleted or closed by the failure.
  assert.equal(store.cases.size, 5);
});

test('a parse-failure spike fails the run; isolated quarantine is partial', async () => {
  const store = new MemoryStore();
  const garbage = (id: string) =>
    ({ field_recall_number: id, langcode: 'English' }) as unknown as FsisRawRecord;

  // 3 garbage / 4 records = 75% quarantined → shape drift, failed.
  const spiked = await runFsisJob(context(store), {
    fetchRecords: feed([RECALL, garbage('X1'), garbage('X2'), garbage('X3')]),
  });
  assert.equal(spiked.outcome, 'failed');
  assert.match(spiked.error!, /item failure spike/);
  // The good record still ingested (fail-safe: report, never discard).
  assert.equal(store.cases.size, 1);

  // 1 garbage / 13 records → partial, visible but not fatal.
  const store2 = new MemoryStore();
  const many = [
    RECALL,
    ...Array.from({ length: 11 }, (_, i) => ({
      ...RECALL,
      field_recall_number: `${100 + i}-2026`,
    })),
    garbage('X1'),
  ];
  const mild = await runFsisJob(context(store2), { fetchRecords: feed(many) });
  assert.equal(mild.outcome, 'partial');
  assert.equal(mild.metrics.quarantined, 1);
});
