/**
 * O3-B1 FDA detail completeness: a listing-backed record's contract includes
 * its detail page, so a transient fetch failure must never permanently mask
 * itself behind the unchanged gate.
 *
 * - An EXISTING record's changed version defers whole: nothing archived,
 *   nothing applied, retried next run even with unchanged listing bytes.
 * - A NEW listing-backed record founds from listing evidence (coverage
 *   invariant) as applied_degraded, and every later run retries the page
 *   until it lands — then archives the richer payload honestly and applies
 *   the resulting transition without duplicate cases, snapshots, or events.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryStore } from '../store/memory-store';
import { loadDetailPage, loadListingItem } from './fixtures';
import { runFdaIngest, type FdaIngestInput } from './ingest';
import { slugFromPath } from './parse';

const NOW = () => new Date('2026-08-21T12:00:00Z');
const FETCHED_AT = '2026-08-21T00:00:00Z';
const PRINCE =
  'prince-bakery-inc-issues-allergy-alert-undeclared-milk-and-sesame-prince-bakery-breads';
const BOWTIE_ORIGINAL =
  'albertsons-companies-voluntarily-recalls-select-store-made-deli-items-containing-bowtie-pasta';
const BOWTIE_UPDATE = `update-${BOWTIE_ORIGINAL}`;

function workingFetch(calls?: string[]) {
  return async (url: string): Promise<string> => {
    calls?.push(url);
    return loadDetailPage(slugFromPath(url));
  };
}

function failingFetch(calls?: string[]) {
  return async (url: string): Promise<string> => {
    calls?.push(url);
    throw new Error('HTTP 403');
  };
}

function input(items: unknown[], fetchDetail: FdaIngestInput['fetchDetail']): FdaIngestInput {
  return { listing: { items, fetchedAt: FETCHED_AT }, rss: { items: [] }, fetchDetail };
}

test('an existing record whose changed detail fetch fails is deferred whole and retried next run', async () => {
  const store = new MemoryStore();
  // Run 1: the original announcement, complete.
  await runFdaIngest(store, input([loadListingItem(BOWTIE_ORIGINAL)], workingFetch()), {
    now: NOW,
  });
  const caseBefore = structuredClone([...store.cases.values()][0]);
  const snapshotsBefore = store.snapshots.length;
  const eventsBefore = store.notifications.size;

  // Run 2: the re-published update row arrives but its page cannot be
  // fetched — the item defers whole. Nothing archived, nothing applied; the
  // previous complete version stays authoritative.
  const deferredRun = await runFdaIngest(
    store,
    input([loadListingItem(BOWTIE_UPDATE)], failingFetch()),
    { now: NOW },
  );
  assert.deepEqual(
    deferredRun.crossCheck.deferredIds.map((id) => id.includes('albertsons')),
    [true],
  );
  assert.equal(deferredRun.summary.deferred, 1);
  assert.equal(deferredRun.summary.unchanged, 0);
  assert.equal(store.snapshots.length, snapshotsBefore);
  assert.equal(store.notifications.size, eventsBefore);
  assert.deepEqual([...store.cases.values()][0], caseBefore);
  const record = [...store.sourceRecords.values()][0];
  assert.equal(record.applyState, 'applied'); // the PREVIOUS version stays applied

  // Run 3: identical listing bytes, page back up — the fetch IS retried and
  // the update applies with its material change; never a second initial.
  const calls: string[] = [];
  const retried = await runFdaIngest(
    store,
    input([loadListingItem(BOWTIE_UPDATE)], workingFetch(calls)),
    { now: NOW },
  );
  assert.equal(calls.length, 1);
  assert.equal(retried.summary.changedCases, 1);
  assert.equal(store.snapshots.length, snapshotsBefore + 1);
  const events = [...store.notifications.values()];
  assert.equal(events.filter((n) => n.kind === 'initial').length, 1);
  assert.ok(events.some((n) => n.kind === 'material_update'));
});

test('a new listing-backed record founds applied_degraded and completes when its detail page lands', async () => {
  const store = new MemoryStore();
  // Run 1: page down — coverage wins, but the record is honestly degraded.
  const first = await runFdaIngest(store, input([loadListingItem(PRINCE)], failingFetch()), {
    now: NOW,
  });
  assert.equal(first.summary.newCases, 1);
  assert.equal(first.summary.degradedFounded, 1);
  assert.deepEqual(first.crossCheck.degradedIds, [PRINCE]);
  assert.equal(store.cases.size, 1);
  const record = [...store.sourceRecords.values()][0];
  assert.equal(record.applyState, 'applied_degraded');
  // Listing-only voice — the degraded evidence is visible in the projection.
  const degradedProjection = [...store.cases.values()][0].projection;
  assert.equal(degradedProjection.title, 'Prince Bakery Inc. recalls Variety of Breads');
  const initials = [...store.notifications.values()].filter((n) => n.kind === 'initial');
  assert.equal(initials.length, 1);

  // Run 2: page still down — deferred, still degraded, still retrying.
  const stillDown: string[] = [];
  const second = await runFdaIngest(
    store,
    input([loadListingItem(PRINCE)], failingFetch(stillDown)),
    { now: NOW },
  );
  assert.equal(stillDown.length, 1); // the fetch IS retried despite unchanged bytes
  assert.equal(second.summary.deferred, 1);
  assert.equal([...store.sourceRecords.values()][0].applyState, 'applied_degraded');
  assert.equal(store.snapshots.length, 1);

  // Run 3: the page returns. The richer payload is archived honestly (same
  // content hash, second snapshot), the detail-backed projection applies,
  // and the marker completes — no duplicate case, initial, or timeline.
  const calls: string[] = [];
  const third = await runFdaIngest(store, input([loadListingItem(PRINCE)], workingFetch(calls)), {
    now: NOW,
  });
  assert.equal(calls.length, 1);
  assert.equal(store.cases.size, 1);
  assert.equal(store.snapshots.length, 2);
  const completed = [...store.sourceRecords.values()][0];
  assert.equal(completed.applyState, 'applied');
  const projection = [...store.cases.values()][0].projection;
  assert.match(projection.title, /^Prince Bakery Inc Issues Allergy Alert/);
  assert.equal([...store.notifications.values()].filter((n) => n.kind === 'initial').length, 1);
  assert.equal(third.summary.newCases, 0);
  // The raw payload provenance now carries the detail page for backfills.
  const payload = (await store.getLatestSnapshotPayload(completed.id)) as {
    detailMainHtml: string | null;
  };
  assert.notEqual(payload.detailMainHtml, null);

  // Run 4: fully applied and unchanged — no fetch, no work.
  const settledCalls: string[] = [];
  const fourth = await runFdaIngest(
    store,
    input([loadListingItem(PRINCE)], workingFetch(settledCalls)),
    { now: NOW },
  );
  assert.equal(settledCalls.length, 0);
  assert.equal(fourth.summary.unchanged, 1);
});
