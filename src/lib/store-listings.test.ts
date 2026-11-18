import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listedStoreNames, readStoreListingRows } from './store-listings';

const CASE = '38c00154-1d2e-4f5a-9b8c-7d6e5f4a3b2c';
const OTHER = '11111111-2222-4333-8444-555555555555';

const ROWS = [
  {
    case_id: CASE,
    publisher: 'walmart',
    store: 'Walmart',
    scope: 'unspecified',
    states: [],
    channels: ['stores', 'online'],
    listing_url: 'https://corporate.walmart.com/recalls',
    listed_on: '2026-10-30',
  },
  {
    case_id: CASE,
    publisher: 'target',
    store: 'Target',
    scope: 'unspecified',
    states: [],
    channels: ['stores', 'online'],
    listing_url: 'https://www.target.com/help/article/000233827',
    listed_on: '2026-10-30',
  },
  {
    case_id: CASE,
    publisher: 'wholefoods',
    store: 'Whole Foods Market',
    scope: 'unspecified',
    states: [],
    channels: ['stores'],
    listing_url: 'https://www.wholefoodsmarket.com/legal/product-recalls',
    listed_on: '2026-11-02',
  },
  {
    case_id: OTHER,
    publisher: 'walmart',
    store: "Sam's Club",
    scope: 'states',
    states: ['Louisiana', 'Texas'],
    channels: ['stores'],
    listing_url: 'https://corporate.walmart.com/recalls',
    listed_on: '2026-10-02',
  },
  {
    case_id: OTHER,
    publisher: 'walmart',
    store: 'Walmart',
    scope: 'states',
    states: ['Oklahoma', 'Texas'],
    channels: ['stores'],
    listing_url: 'https://corporate.walmart.com/recalls',
    listed_on: '2026-10-02',
  },
];

test('Tractor Wheels: three verified store names, each once, in name order', () => {
  assert.deepEqual(listedStoreNames(readStoreListingRows([...ROWS, ...ROWS]), CASE), [
    'Target',
    'Walmart',
    'Whole Foods Market',
  ]);
});

test("each store keeps its own states in the data: Walmart's are never Sam's Club's", () => {
  const listings = readStoreListingRows(ROWS).filter((listing) => listing.caseId === OTHER);
  assert.deepEqual(
    listings.map((listing) => [listing.store, listing.states]),
    [
      ["Sam's Club", ['Louisiana', 'Texas']],
      ['Walmart', ['Oklahoma', 'Texas']],
    ],
  );
  // Only the names reach the screen.
  assert.deepEqual(listedStoreNames(listings, OTHER), ["Sam's Club", 'Walmart']);
});

test('a row whose publisher, store or page disagree is dropped whole', () => {
  const [walmart] = ROWS;
  for (const bad of [
    { ...walmart, store: 'Target' },
    { ...walmart, publisher: 'kroger' },
    { ...walmart, listing_url: 'https://www.walmart.com.example.com/recalls' },
    { ...walmart, listing_url: 'http://corporate.walmart.com/recalls' },
    { ...walmart, scope: 'states', states: [] },
    { ...walmart, scope: 'unspecified', states: ['Texas'] },
    { ...walmart, channels: ['drive-thru'] },
    { ...walmart, case_id: 'not-a-uuid' },
  ]) {
    assert.deepEqual(readStoreListingRows([bad]), [], JSON.stringify(bad).slice(0, 90));
  }
  assert.equal(readStoreListingRows([walmart, walmart]).length, 1);
  assert.deepEqual(readStoreListingRows(null), []);
});

test('a recall no store listed adds no name', () => {
  assert.deepEqual(
    listedStoreNames(readStoreListingRows(ROWS), '99999999-2222-4333-8444-555555555555'),
    [],
  );
});
