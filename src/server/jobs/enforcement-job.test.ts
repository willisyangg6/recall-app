import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ReconcileStats } from '../fda-enforcement/reconcile';
import { MemoryStore } from '../store/memory-store';
import { runEnforcementJob, type EnforcementJobOptions } from './enforcement-job';
import type { JobContext } from './runner';

const NOW = () => new Date('2026-08-26T09:15:00Z');

function context(store: MemoryStore): JobContext {
  return { store, now: NOW, version: 'testsha', holder: 'test:1:testsha' };
}

function stats(overrides: Partial<ReconcileStats> = {}): ReconcileStats {
  return {
    enforcementRecords: 29316,
    quarantined: 1,
    casesExamined: 701,
    matched: 400,
    ambiguous: 8,
    candidate: 90,
    unmatched: 203,
    acceptedEvents: 407,
    acceptedRecords: 1747,
    conflicts: 0,
    singleClassCases: 384,
    mixedClassCases: 16,
    mixedExposedAsScalar: 0,
    assignments: 0,
    reclassifications: 0,
    notifications: { delivered: 0, suppressed: 0 },
    byMethod: {},
    classSets: {},
    tiers: {},
    classificationChanges: [],
    ...overrides,
  };
}

function options(
  overrides: Partial<EnforcementJobOptions> & {
    exportDate?: string;
    totalRecords?: number;
    downloads?: number[];
    reconciles?: { apply: boolean }[];
    reconcileStats?: ReconcileStats;
  } = {},
): EnforcementJobOptions {
  const { exportDate, totalRecords, downloads, reconciles, reconcileStats, ...rest } = overrides;
  return {
    dataStore: new MemoryStore(),
    client: null as never, // the injected reconcile stub never touches it
    fetchManifest: async () => ({
      url: 'https://example.test/export.zip',
      exportDate: exportDate ?? '2026-08-25',
      totalRecords: totalRecords ?? 29316,
    }),
    downloadCorpus: async () => {
      downloads?.push(1);
      return {
        records: [],
        exportDate: exportDate ?? '2026-08-25',
        totalRecords: totalRecords ?? 29316,
      };
    },
    reconcile: async (_client, _store, opts) => {
      reconciles?.push({ apply: opts.apply });
      return reconcileStats ?? stats();
    },
    ...rest,
  };
}

test('a changed weekly export runs the full reconciliation and records its export date', async () => {
  const store = new MemoryStore();
  const reconciles: { apply: boolean }[] = [];
  const report = await runEnforcementJob(context(store), options({ reconciles }));

  assert.equal(report.outcome, 'succeeded');
  assert.deepEqual(reconciles, [{ apply: true }]);
  assert.equal(report.metrics.completedExportDate, '2026-08-25');
  const [run] = await store.listRecentJobRuns('fda_enforcement', 1);
  assert.equal(run.metrics!.matched, 400);
});

test('an unchanged export week does no download and no reconciliation', async () => {
  const store = new MemoryStore();
  await runEnforcementJob(context(store), options());

  const downloads: number[] = [];
  const reconciles: { apply: boolean }[] = [];
  const second = await runEnforcementJob(context(store), options({ downloads, reconciles }));
  assert.equal(second.outcome, 'succeeded');
  assert.equal(second.metrics.skipped, 'source_unchanged');
  assert.equal(downloads.length, 0);
  assert.equal(reconciles.length, 0);

  // A NEW export date the following week runs again.
  const reconciles2: { apply: boolean }[] = [];
  const third = await runEnforcementJob(
    context(store),
    options({ exportDate: '2026-09-01', reconciles: reconciles2 }),
  );
  assert.equal(third.outcome, 'succeeded');
  assert.equal(reconciles2.length, 1);
});

test('a dry run never marks an export as completed', async () => {
  const store = new MemoryStore();
  const dry = await runEnforcementJob(context(store), options({ dryRun: true }));
  assert.equal(dry.metrics.checkedExportDate, '2026-08-25');
  assert.equal(dry.metrics.completedExportDate, undefined);

  // The real scheduled run afterwards still does the work.
  const reconciles: { apply: boolean }[] = [];
  const real = await runEnforcementJob(context(store), options({ reconciles }));
  assert.deepEqual(reconciles, [{ apply: true }]);
  assert.equal(real.metrics.completedExportDate, '2026-08-25');
});

test('the mixed-as-scalar hard gate fails the run and does not record completion', async () => {
  const store = new MemoryStore();
  const report = await runEnforcementJob(
    context(store),
    options({ reconcileStats: stats({ mixedExposedAsScalar: 2 }) }),
  );
  assert.equal(report.outcome, 'failed');
  assert.match(report.error!, /HARD GATE/);
  assert.equal(report.metrics.completedExportDate, undefined);
});

test('an implausibly small manifest is a source failure, not a fresh start', async () => {
  const store = new MemoryStore();
  await runEnforcementJob(context(store), options());
  const report = await runEnforcementJob(
    context(store),
    options({ exportDate: '2026-09-01', totalRecords: 900 }),
  );
  assert.equal(report.outcome, 'failed');
  assert.match(report.error!, /implausibly small/);
});
