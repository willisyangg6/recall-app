import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readStoreListingRows, storeListingRows } from './store-listings';

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

test('Tractor Wheels: three stores, one row each, each linking its own page', () => {
  const rows = storeListingRows(readStoreListingRows(ROWS), CASE);
  assert.deepEqual(rows, [
    {
      store: 'Target',
      detail: 'In stores and online',
      sourceLabel: 'Target’s recall notice',
      url: 'https://www.target.com/help/article/000233827',
    },
    {
      store: 'Walmart',
      detail: 'In stores and online',
      sourceLabel: 'Walmart’s recall list',
      url: 'https://corporate.walmart.com/recalls',
    },
    {
      store: 'Whole Foods Market',
      detail: 'In stores',
      sourceLabel: 'Whole Foods Market’s recall list',
      url: 'https://www.wholefoodsmarket.com/legal/product-recalls',
    },
  ]);
});

test("each store keeps its own states: Walmart's are never Sam's Club's", () => {
  const rows = storeListingRows(readStoreListingRows(ROWS), OTHER);
  assert.deepEqual(
    rows.map((row) => [row.store, row.detail]),
    [
      ["Sam's Club", 'Louisiana and Texas'],
      ['Walmart', 'Oklahoma and Texas'],
    ],
  );
  // Sam's Club's facts link Walmart's list, where Walmart published them.
  assert.equal(rows[0].sourceLabel, 'Walmart’s recall list');
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

test('a recall no store listed has no rows', () => {
  assert.deepEqual(
    storeListingRows(readStoreListingRows(ROWS), '99999999-2222-4333-8444-555555555555'),
    [],
  );
});
