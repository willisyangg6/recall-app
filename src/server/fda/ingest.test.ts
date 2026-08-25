import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryStore } from '../store/memory-store';
import { parseFdaRssItems, type FdaRssItem } from './fetch';
import { loadDetailPage, loadFoodRss, loadListingItem, loadListingItems } from './fixtures';
import { runFdaIngest, type FdaIngestInput } from './ingest';
import { slugFromPath } from './parse';

// Recorded real data throughout; the clock is pinned to the recording date so
// "recent vs backfill" behavior is deterministic.
const NOW = () => new Date('2026-08-21T12:00:00Z');
const FETCHED_AT = '2026-08-21T00:00:00Z';

const PRINCE =
  'prince-bakery-inc-issues-allergy-alert-undeclared-milk-and-sesame-prince-bakery-breads';
const BOWTIE_ORIGINAL =
  'albertsons-companies-voluntarily-recalls-select-store-made-deli-items-containing-bowtie-pasta';
const BOWTIE_UPDATE = `update-${BOWTIE_ORIGINAL}`;

function fetchDetailFromFixtures(calls?: string[]) {
  return async (url: string): Promise<string> => {
    calls?.push(url);
    return loadDetailPage(slugFromPath(url));
  };
}

function input(overrides: Partial<FdaIngestInput> = {}): FdaIngestInput {
  return {
    listing: { items: loadListingItems(), fetchedAt: FETCHED_AT },
    rss: { items: parseFdaRssItems(loadFoodRss()).filter(hasFixturePage) },
    fetchDetail: fetchDetailFromFixtures(),
    ...overrides,
  };
}

/** Only RSS items whose pages are recorded (the live feed has more). */
function hasFixturePage(item: FdaRssItem): boolean {
  return item.link.endsWith(PRINCE) || item.link.endsWith('outshine-fruit-bars-due-possible');
}

test('fresh FDA ingest: food-only cases, one identity per announcement, backfill suppression', async () => {
  const store = new MemoryStore();
  const result = await runFdaIngest(store, input(), { now: NOW });

  // 31 recorded listing rows: 27 food, 1 pet food (deferred), 3 non-food.
  assert.equal(result.crossCheck.foodItems, 27);
  assert.equal(result.crossCheck.excludedAnimal, 1);
  assert.equal(result.crossCheck.excludedNonfood, 3);

  // The two churn pairs (original + re-published update row) collapse to one
  // source record and one case each: 27 rows → 25 identities.
  assert.equal(store.sourceRecords.size, 25);
  assert.equal(store.cases.size, 25);
  assert.equal(result.summary.newCases, 25);
  assert.equal(result.summary.quarantined.length, 0);

  // Excluded rows never became cases.
  for (const record of store.sourceRecords.values()) {
    assert.doesNotMatch(record.nativeId, /omas-pride|kiriko|stryker/);
    assert.equal(record.normalized.sourceAgency, 'FDA');
  }

  // Exactly one initial notification per case; recent ones (≤30 days before
  // the pinned clock) deliverable, history suppressed as backfill.
  const initials = [...store.notifications.values()].filter((n) => n.kind === 'initial');
  assert.equal(initials.length, 25);
  assert.equal(result.summary.notifications.initial, 9);
  assert.equal(result.summary.notifications.suppressed, 16);
  const prince = [...store.sourceRecords.values()].find((r) => r.nativeId === PRINCE)!;
  const princeInitial = initials.find((n) => n.recallCaseId === prince.recallCaseId)!;
  assert.equal(princeInitial.suppressed, null); // published 2026-08-19: real news
});

test('repeat identical ingestion is fully idempotent and fetches no detail pages', async () => {
  const store = new MemoryStore();
  await runFdaIngest(store, input(), { now: NOW });
  const snapshotsAfterFirst = store.snapshots.length;

  const calls: string[] = [];
  const second = await runFdaIngest(store, input({ fetchDetail: fetchDetailFromFixtures(calls) }), {
    now: NOW,
  });
  assert.equal(calls.length, 0); // unchanged content ⇒ no page fetches at all
  assert.equal(second.summary.newCases, 0);
  assert.equal(second.summary.changedCases, 0);
  assert.equal(second.summary.unchanged, 25);
  assert.equal(store.snapshots.length, snapshotsAfterFirst);
  assert.equal(second.summary.notifications.initial, 0);
  assert.equal(second.summary.notifications.materialUpdate, 0);
});

test('the same announcement via listing JSON and RSS is one case, one initial event', async () => {
  const store = new MemoryStore();
  const princeItem = loadListingItem(PRINCE);
  const rss = parseFdaRssItems(loadFoodRss()).filter((i) => i.link.endsWith(PRINCE));
  assert.equal(rss.length, 1);
  const result = await runFdaIngest(
    store,
    input({ listing: { items: [princeItem], fetchedAt: FETCHED_AT }, rss: { items: rss } }),
    { now: NOW },
  );
  assert.equal(store.cases.size, 1);
  assert.equal(store.sourceRecords.size, 1);
  assert.equal(result.crossCheck.rssOnlyIds.length, 0);
  assert.equal([...store.notifications.values()].filter((n) => n.kind === 'initial').length, 1);
});

test('an update re-publish (changed row) creates a snapshot and a material change, never a second initial', async () => {
  const store = new MemoryStore();
  // Run 1 sees only the original bowtie-pasta announcement…
  await runFdaIngest(
    store,
    input({
      listing: { items: [loadListingItem(BOWTIE_ORIGINAL)], fetchedAt: FETCHED_AT },
      rss: { items: [] },
    }),
    { now: NOW },
  );
  assert.equal(store.cases.size, 1);
  const caseId = [...store.cases.keys()][0];

  // …run 2 sees the re-published "update-…" row (same identity, more products).
  const second = await runFdaIngest(
    store,
    input({
      listing: { items: [loadListingItem(BOWTIE_UPDATE)], fetchedAt: FETCHED_AT },
      rss: { items: [] },
    }),
    { now: NOW },
  );
  assert.equal(store.cases.size, 1); // same case — no duplicate from URL churn
  assert.equal(second.summary.newCases, 0);
  assert.equal(second.summary.changedCases, 1);
  assert.equal(store.snapshots.length, 2);

  const events = [...store.notifications.values()].filter((n) => n.recallCaseId === caseId);
  assert.equal(events.filter((n) => n.kind === 'initial').length, 1);
  const updates = events.filter((n) => n.kind === 'material_update');
  assert.ok(updates.length >= 1, 'expansion should be ledgered as a material update');
  // A 2025 announcement discovered in 2026 is history: ledgered, suppressed.
  assert.ok(updates.every((n) => n.suppressed === 'backfill'));

  // Run 3 with the same update row: nothing new.
  const third = await runFdaIngest(
    store,
    input({
      listing: { items: [loadListingItem(BOWTIE_UPDATE)], fetchedAt: FETCHED_AT },
      rss: { items: [] },
    }),
    { now: NOW },
  );
  assert.equal(third.summary.unchanged, 1);
  assert.equal(store.snapshots.length, 2);
});

test('seconds-level jitter in the listing `changed` timestamp is not a content change', async () => {
  // Verified live: back-to-back listing generations render `changed` with a
  // few seconds of drift; a real edit is anything at minute precision or above.
  const store = new MemoryStore();
  const item = loadListingItem(PRINCE);
  await runFdaIngest(
    store,
    input({ listing: { items: [item], fetchedAt: FETCHED_AT }, rss: { items: [] } }),
    { now: NOW },
  );
  const jittered = {
    ...item,
    changed: item.changed.replace(/:(\d{2})"/, (_, s: string) => `:${s === '59' ? '58' : '59'}"`),
  };
  const calls: string[] = [];
  const second = await runFdaIngest(
    store,
    input({
      listing: { items: [jittered], fetchedAt: FETCHED_AT },
      rss: { items: [] },
      fetchDetail: fetchDetailFromFixtures(calls),
    }),
    { now: NOW },
  );
  assert.equal(calls.length, 0);
  assert.equal(second.summary.unchanged, 1);
  assert.equal(store.snapshots.length, 1);
});

test('an RSS item missing from the listing is warned about and ingested from its official page', async () => {
  const store = new MemoryStore();
  const rss = parseFdaRssItems(loadFoodRss()).filter((i) => i.link.endsWith(PRINCE));
  const result = await runFdaIngest(
    store,
    input({ listing: { items: [], fetchedAt: FETCHED_AT }, rss: { items: rss } }),
    { now: NOW },
  );
  assert.deepEqual(result.crossCheck.rssOnlyIds, [PRINCE]);
  assert.ok(result.crossCheck.warnings.some((w) => /missing from the primary listing/.test(w)));
  assert.equal(store.cases.size, 1);
  const record = [...store.sourceRecords.values()][0];
  // Normalized from the official page: real title and full consumer fields.
  assert.match(record.normalized.title, /^Prince Bakery Inc Issues Allergy Alert/);
  assert.equal(record.normalized.publishedAt, '2026-08-19');
});

test('detail-fetch failure degrades to listing-only data — the case still exists', async () => {
  const store = new MemoryStore();
  const result = await runFdaIngest(
    store,
    input({
      listing: { items: [loadListingItem(PRINCE)], fetchedAt: FETCHED_AT },
      rss: { items: [] },
      fetchDetail: async () => {
        throw new Error('HTTP 403');
      },
    }),
    { now: NOW },
  );
  assert.equal(result.crossCheck.detailFetchFailures.length, 1);
  assert.equal(store.cases.size, 1); // coverage invariant
  const projection = [...store.cases.values()][0].projection;
  assert.equal(projection.title, 'Prince Bakery Inc. recalls Variety of Breads');
  assert.equal(projection.geography.scope, 'unknown'); // honest, not invented
});

test('a stale primary listing (RSS fresher) raises an operational warning', async () => {
  const store = new MemoryStore();
  const oldItem = loadListingItem(
    'snapchill-llc-recalls-canned-coffee-products-due-potential-clostridium-botulinum',
  );
  const rss = parseFdaRssItems(loadFoodRss()).filter((i) => i.link.endsWith(PRINCE));
  const result = await runFdaIngest(
    store,
    input({ listing: { items: [oldItem], fetchedAt: FETCHED_AT }, rss: { items: rss } }),
    { now: NOW },
  );
  assert.ok(
    result.crossCheck.warnings.some((w) => /RSS is fresher than the primary listing/.test(w)),
  );
});

test('unparseable listing rows are counted as shape drift, not silently dropped', async () => {
  const store = new MemoryStore();
  const result = await runFdaIngest(
    store,
    input({
      listing: {
        items: [{ bogus: true }, 42, loadListingItem(PRINCE)],
        fetchedAt: FETCHED_AT,
      },
      rss: { items: [] },
    }),
    { now: NOW },
  );
  assert.equal(result.crossCheck.invalidListingItems, 2);
  assert.ok(result.crossCheck.warnings.some((w) => /unexpected shape/.test(w)));
  assert.equal(store.cases.size, 1);
});
