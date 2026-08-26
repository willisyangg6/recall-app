import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadDetailPage, loadFoodRss, loadListingItems } from '../fda/fixtures';
import { parseFdaRssItems, type FdaRssItem } from '../fda/fetch';
import { slugFromPath } from '../fda/parse';
import { MemoryStore } from '../store/memory-store';
import { runFdaJob, type FdaJobOptions } from './fda-job';
import type { JobContext } from './runner';

// Recorded real data; the clock is pinned to the recording date so
// recent-vs-backfill behavior is deterministic (mirrors fda/ingest.test.ts).
const NOW = () => new Date('2026-08-21T12:00:00Z');

function context(store: MemoryStore): JobContext {
  return { store, now: NOW, version: 'testsha', holder: 'test:1:testsha' };
}

/** Only RSS items whose pages are recorded (the live feed has more). */
function fixtureRss(): FdaRssItem[] {
  return parseFdaRssItems(loadFoodRss()).filter(
    (item) =>
      item.link.endsWith(
        'prince-bakery-inc-issues-allergy-alert-undeclared-milk-and-sesame-prince-bakery-breads',
      ) || item.link.endsWith('outshine-fruit-bars-due-possible'),
  );
}

function options(overrides: Partial<FdaJobOptions> = {}, detailCalls?: string[]): FdaJobOptions {
  return {
    fetchListing: async () => ({
      items: loadListingItems(),
      fetchedAt: '2026-08-21T00:00:00Z',
      sourceUrl: 'fixture',
    }),
    fetchRss: async () => ({
      items: fixtureRss(),
      fetchedAt: '2026-08-21T00:00:00Z',
      sourceUrl: 'fixture',
    }),
    fetchDetail: async (url: string) => {
      detailCalls?.push(url);
      return loadDetailPage(slugFromPath(url));
    },
    detailDelayMs: 0,
    ...overrides,
  };
}

test('a scheduled FDA run ingests through the canonical pipeline and annotates its run', async () => {
  const store = new MemoryStore();
  const report = await runFdaJob(context(store), options());

  assert.equal(report.outcome, 'succeeded');
  assert.equal(store.cases.size, 25);
  assert.equal(report.metrics.newCases, 25);
  const initials = [...store.notifications.values()].filter((n) => n.kind === 'initial');
  assert.equal(initials.length, 25);

  const [run] = await store.listRecentJobRuns('fda_announcements', 1);
  assert.equal(run.jobName, 'fda_announcements');
  assert.equal(run.outcome, 'succeeded');
  assert.equal(run.version, 'testsha');
  assert.equal(typeof run.metrics!.feedHash, 'string');
  assert.equal(run.metrics!.newCases, 25);
});

test('an unchanged source skips per-record work and creates zero events', async () => {
  const store = new MemoryStore();
  await runFdaJob(context(store), options());
  const eventsAfterFirst = store.notifications.size;
  const snapshotsAfterFirst = store.snapshots.length;

  const detailCalls: string[] = [];
  const second = await runFdaJob(context(store), options({}, detailCalls));
  assert.equal(second.outcome, 'succeeded');
  assert.equal(second.metrics.skipped, 'source_unchanged');
  assert.equal(detailCalls.length, 0);
  assert.equal(store.notifications.size, eventsAfterFirst);
  assert.equal(store.snapshots.length, snapshotsAfterFirst);
  // The skip is itself an auditable run.
  const runs = await store.listRecentJobRuns('fda_announcements', 5);
  assert.equal(runs.length, 2);
});

test('a scheduler retry that bypasses the gate is still fully idempotent', async () => {
  const store = new MemoryStore();
  await runFdaJob(context(store), options());
  const eventsAfterFirst = store.notifications.size;

  const retry = await runFdaJob(context(store), options({ force: true }));
  assert.equal(retry.outcome, 'succeeded');
  assert.equal(retry.metrics.unchanged, 25);
  assert.equal(retry.metrics.newCases, 0);
  assert.equal(store.notifications.size, eventsAfterFirst); // zero duplicate events
});

test('a listing HTTP failure fails the run loudly and ingests nothing', async () => {
  const store = new MemoryStore();
  const report = await runFdaJob(
    context(store),
    options({
      fetchListing: async () => {
        throw new Error('FDA fetch failed after 3 attempts: HTTP 503');
      },
    }),
  );
  assert.equal(report.outcome, 'failed');
  assert.match(report.error!, /HTTP 503/);
  assert.equal(store.cases.size, 0);
  const [run] = await store.listRecentJobRuns('fda_announcements', 1);
  assert.equal(run.outcome, 'failed');
});

test('SOURCE EMPTY is SOURCE FAILED: zero items never reads as a quiet day', async () => {
  const store = new MemoryStore();
  const report = await runFdaJob(
    context(store),
    options({
      fetchListing: async () => ({ items: [], fetchedAt: 'x', sourceUrl: 'fixture' }),
    }),
  );
  assert.equal(report.outcome, 'failed');
  assert.match(report.error!, /SOURCE FAILURE/);
});

test('an implausibly shrunken listing fails instead of silently succeeding', async () => {
  const store = new MemoryStore();
  await runFdaJob(context(store), options()); // records itemsSeen = 31

  const report = await runFdaJob(
    context(store),
    options({
      fetchListing: async () => ({
        items: loadListingItems().slice(0, 3),
        fetchedAt: 'x',
        sourceUrl: 'fixture',
      }),
    }),
  );
  assert.equal(report.outcome, 'failed');
  assert.match(report.error!, /implausibly empty/);
  // Existing consumer data is untouched by the failure.
  assert.equal(store.cases.size, 25);
});

test('an RSS outage degrades gracefully: full run, no skip gate, no failure', async () => {
  const store = new MemoryStore();
  const report = await runFdaJob(
    context(store),
    options({
      fetchRss: async () => {
        throw new Error('rss down');
      },
    }),
  );
  assert.equal(report.outcome, 'succeeded');
  assert.equal(report.metrics.feedHash, null); // gate disabled without the cross-check
  assert.equal(store.cases.size, 25);
});

test('a database failure mid-run surfaces as a failed job', async () => {
  const store = new MemoryStore();
  store.insertCase = async () => {
    throw new Error('SupabaseStore.insertCase failed: connection reset');
  };
  const report = await runFdaJob(context(store), options());
  assert.equal(report.outcome, 'failed');
  assert.match(report.error!, /connection reset/);
});
