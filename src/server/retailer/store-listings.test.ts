/**
 * Store listings against the real retailer pages recorded on 2026-11-16
 * (fixtures/listings/). Each store keeps its own facts; only an exact agency
 * link to one Lotly case links a listing; everything else is review.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  applyListingPlan,
  MemoryListingStore,
  planListingConfirmation,
  planListingRun,
  type ListingFetcher,
} from './listing-run';
import {
  decideListing,
  LISTING_SOURCES,
  normalizeUrl,
  parsePublixListings,
  parseTargetArticle,
  parseTargetIndex,
  parseWalmartListings,
  parseWholeFoodsListings,
  walmartStores,
  type ListingEntry,
} from './store-listings';

const DIR = join(__dirname, 'fixtures', 'listings');
const page = (name: string) => readFileSync(join(DIR, name), 'utf8');
const TRACTOR_FDA =
  'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/once-upon-farm-recalls-all-lots-and-varieties-tractor-wheels-organic-toddler-soft-baked-bars-due';
const TRACTOR_CASE = '38c00154-0000-4000-8000-000000000000';

test('Walmart: every food entry, each store with its own states and channels', () => {
  const entries = parseWalmartListings(page('walmart-2026-11-16.html'));
  assert.equal(entries.length, 11);
  assert.ok(entries.every((entry) => !entry.unparsed));

  const flowers = entries.find((entry) => entry.title.includes("Nature's Own Hawaiian Bread"))!;
  // "OK, TX (Walmart); LA, TX (Sam's Club)": never one list for both.
  assert.deepEqual(
    flowers.stores.map((store) => [store.store, store.states]),
    [
      ['Walmart', ['Oklahoma', 'Texas']],
      ["Sam's Club", ['Louisiana', 'Texas']],
    ],
  );
  const kayem = entries.find((entry) => entry.title.startsWith('Kayem'))!;
  // The Proofpoint-wrapped link is unwrapped to FSIS's own page.
  assert.match(kayem.agencyUrls[0], /^https:\/\/www\.fsis\.usda\.gov\/recalls-alerts\/kayem-foods/);
  assert.deepEqual(kayem.stores[0].states.length, 8);

  const outshine = entries.find((entry) => entry.title.includes('Outshine'))!;
  assert.deepEqual(outshine.stores, [
    { store: 'Walmart', scope: 'nationwide', states: [], channels: ['stores', 'online'] },
  ]);
  const tractor = entries.find((entry) => entry.title.includes('Tractor Wheels'))!;
  assert.deepEqual(tractor.stores, [
    { store: 'Walmart', scope: 'unspecified', states: [], channels: ['stores', 'online'] },
  ]);
});

test('a sold-at line with anything unreadable is never guessed', () => {
  assert.equal(walmartStores('Sold at select Walmart stores in the Gulf region').unparsed, true);
  assert.equal(walmartStores('Sold at select Walmart stores in CT, XX').unparsed, true);
  assert.deepEqual(walmartStores("Sold at Walmart stores and Sam's Club in Puerto Rico").stores, [
    { store: 'Walmart', scope: 'states', states: ['Puerto Rico'], channels: ['stores'] },
    { store: "Sam's Club", scope: 'states', states: ['Puerto Rico'], channels: ['stores'] },
  ]);
});

test('Target: the Grocery/OTC articles, each read for where Target sold it', () => {
  const refs = parseTargetIndex(page('target-index-2026-11-16.html'));
  assert.deepEqual(
    refs.map((ref) => ref.title),
    [
      'Once Upon a Farm Tractor Wheels',
      'Natures Own Hawaiian Bread',
      'So Delicious',
      'Donutful Chocolate Dipped Vanilla Cake Donuts',
      'Outshine Fruit Bars',
    ],
  );
  const article = parseTargetArticle(page('target-article-000233827-2026-11-16.html'), refs[0]);
  assert.equal(article.listedOn, '2026-10-30');
  assert.equal(article.soldAtText, 'Target Stores & Target.com');
  assert.deepEqual(article.agencyUrls, [TRACTOR_FDA]);
  assert.deepEqual(article.stores, [
    { store: 'Target', scope: 'unspecified', states: [], channels: ['stores', 'online'] },
  ]);
});

test('Whole Foods: US agency links are listings; Canadian notices are excluded', () => {
  const entries = parseWholeFoodsListings(page('wholefoods-2026-11-16.html'));
  assert.equal(entries.length, 108);
  const canadian = entries.filter((entry) => entry.foreign);
  assert.equal(canadian.length, 17);
  for (const entry of canadian) {
    assert.equal(decideListing(entry, new Map()).decision, 'excluded');
  }
  const tractor = entries.find((entry) => entry.title.startsWith('Once Upon a Farm Tractor'))!;
  assert.deepEqual(tractor.agencyUrls, [TRACTOR_FDA]);
});

test('Publix: the verified empty list is an empty run; any other shape stops for a person', () => {
  assert.deepEqual(parsePublixListings(page('publix-2026-11-16.html')), []);
  const listed = page('publix-2026-11-16.html')
    .replace(':item-list="null"', ':item-list="[{&quot;title&quot;:&quot;x&quot;}]"')
    .replace('There are no Publix recalls at this time.', '');
  assert.throws(() => parsePublixListings(listed), /not yet verified/);
});

test('Publix historical sample: a past Publix recall links by its FDA notice', () => {
  // Publix Rich & Creamy Vanilla Ice Cream (October 2025), as FDA published
  // it. The decision path only: Publix's list shape is not yet verified.
  const url =
    'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/publix-rich-creamy-vanilla-ice-cream-voluntarily-recalled-select-areas';
  const entry: ListingEntry = {
    publisher: 'publix',
    nativeId: normalizeUrl(url),
    title: 'Publix Rich & Creamy Vanilla Ice Cream',
    listedOn: '2025-10-01',
    listingUrl: LISTING_SOURCES.publix.indexUrl,
    agencyUrls: [url],
    soldAtText: null,
    stores: [{ store: 'Publix', scope: 'unspecified', states: [], channels: ['stores'] }],
    unparsed: false,
    foreign: false,
  };
  const decided = decideListing(entry, new Map([[normalizeUrl(url), ['case-publix']]]));
  assert.deepEqual(decided, {
    decision: 'linked',
    reasons: ['agency_url_match'],
    caseId: 'case-publix',
  });
});

test('only an exact agency link to ONE case links; everything else is review', () => {
  const [tractor] = parseWholeFoodsListings(page('wholefoods-2026-11-16.html')).filter((entry) =>
    entry.title.startsWith('Once Upon a Farm Tractor'),
  );
  const key = normalizeUrl(TRACTOR_FDA);
  assert.equal(decideListing(tractor, new Map([[key, [TRACTOR_CASE]]])).decision, 'linked');
  assert.deepEqual(decideListing(tractor, new Map()).reasons, ['agency_link_not_in_lotly']);
  assert.deepEqual(decideListing(tractor, new Map([[key, ['a', 'b']]])).reasons, [
    'agency_link_matches_several_cases',
  ]);
});

test('Tractor Wheels: Target and Whole Foods link by URL; Walmart waits for a reviewer, then stays linked', async () => {
  const pages: Record<string, string> = {
    [LISTING_SOURCES.walmart.indexUrl]: page('walmart-2026-11-16.html'),
    [LISTING_SOURCES.wholefoods.indexUrl]: page('wholefoods-2026-11-16.html'),
    [LISTING_SOURCES.target.indexUrl]: page('target-index-2026-11-16.html'),
    'https://www.target.com/help/article/000233827': page(
      'target-article-000233827-2026-11-16.html',
    ),
  };
  const fetcher: ListingFetcher = {
    fetchHtml: async (url) => {
      if (!(url in pages)) throw new Error('not recorded');
      return pages[url];
    },
  };
  const store = new MemoryListingStore(
    new Map([[normalizeUrl(TRACTOR_FDA), [TRACTOR_CASE]]]),
    new Set([TRACTOR_CASE]),
  );
  const at = () => new Date('2026-11-16T23:00:00Z');
  for (const publisher of ['walmart', 'target', 'wholefoods'] as const) {
    await applyListingPlan(store, await planListingRun(publisher, store, fetcher, at));
  }
  const rows = [...store.rows.values()];
  const linked = rows.filter((row) => row.caseId === TRACTOR_CASE);
  assert.deepEqual(linked.map((row) => row.publisher).sort(), ['target', 'wholefoods']);

  // Walmart links FDA's advisory page, not the recall notice Lotly holds.
  const walmart = rows.find((row) => row.publisher === 'walmart' && row.title.includes('Tractor'))!;
  assert.equal(walmart.decision, 'review');
  assert.deepEqual(walmart.decisionReasons, ['agency_link_not_in_lotly']);
  const confirmed = await planListingConfirmation(
    store,
    'walmart',
    walmart.nativeId,
    TRACTOR_CASE,
    'reviewer',
    at,
  );
  assert.deepEqual(confirmed.problems, []);
  await store.upsertListing(confirmed.row!);

  // The next run keeps the reviewer's link while Walmart's agency link is unchanged.
  await applyListingPlan(store, await planListingRun('walmart', store, fetcher, at));
  const again = [...store.rows.values()].find((row) => row.nativeId === walmart.nativeId)!;
  assert.equal(again.decision, 'linked');
  assert.equal(again.matchMethod, 'reviewer');
  const stores = [...store.rows.values()]
    .filter((row) => row.caseId === TRACTOR_CASE)
    .flatMap((row) => row.stores.map((fact) => fact.store))
    .sort();
  assert.deepEqual(stores, ['Target', 'Walmart', 'Whole Foods Market']);
});

test('a reviewer cannot link a listing whose sold-at line was not read', async () => {
  const store = new MemoryListingStore(new Map(), new Set([TRACTOR_CASE]));
  await store.upsertListing({
    publisher: 'walmart',
    nativeId: 'x',
    indexUrl: '',
    listingUrl: '',
    title: 'x',
    listedOn: null,
    agencyUrls: [],
    soldAtText: 'Sold at select Walmart stores in the Gulf region',
    stores: [],
    decision: 'review',
    decisionReasons: ['sold_at_unparsed'],
    caseId: null,
    matchMethod: null,
    confirmedBy: null,
    confirmedAt: null,
    firstSeenAt: '2026-11-16T00:00:00Z',
    lastSeenAt: '2026-11-16T00:00:00Z',
    parserVersion: 'walmart-list/1',
  });
  const result = await planListingConfirmation(
    store,
    'walmart',
    'x',
    TRACTOR_CASE,
    'r',
    () => new Date(),
  );
  assert.equal(result.row, null);
  assert.match(result.problems.join(' '), /not read completely/);
});
