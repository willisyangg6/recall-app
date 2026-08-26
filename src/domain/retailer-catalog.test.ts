import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalRetailerIds,
  canonicalRetailerIdsForEvidence,
  normalizeRetailerText,
  RETAILER_CATALOG,
  retailerById,
  searchRetailers,
} from './retailer-catalog';

test('catalog ids are unique, stable slugs', () => {
  const ids = RETAILER_CATALOG.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9][a-z0-9-]{0,39}$/);
});

test('alias fragmentation resolves to one identity', () => {
  // The census's observed variant spellings, one chain each.
  assert.deepEqual(canonicalRetailerIdsForEvidence('Walmart'), ['walmart']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Wal-Mart'), ['walmart']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Costco'), ['costco']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Costco Wholesale'), ['costco']);
  assert.deepEqual(canonicalRetailerIdsForEvidence("Trader Joe's"), ['trader-joes']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Trader Joes'), ['trader-joes']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Trader Joe'), ['trader-joes']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('H-E-B'), ['heb']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('HEB'), ['heb']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('H.E.B.'), ['heb']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Publix Super Markets'), ['publix']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Stop&Shop'), ['stop-and-shop']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Stop and Shop'), ['stop-and-shop']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Sam’s Club'), ['sams-club']);
});

test('trailing venue words strip only when the remainder is a known alias', () => {
  assert.deepEqual(canonicalRetailerIdsForEvidence('Target stores'), ['target']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Fred Meyer Stores'), ['fred-meyer']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Whole Foods Markets'), ['whole-foods']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Dollar Tree Stores'), ['dollar-tree']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('QFC stores'), ['qfc']);
  // "Central Market" must never decay to a bare word that happens to exist.
  assert.deepEqual(canonicalRetailerIdsForEvidence('Central Market'), []);
});

test('compound evidence splits conservatively', () => {
  assert.deepEqual(canonicalRetailerIdsForEvidence('Albertsons, Randalls, Tom Thumb'), [
    'albertsons',
    'randalls',
    'tom-thumb',
  ]);
  assert.deepEqual(canonicalRetailerIdsForEvidence("Costco and Sam's Club"), [
    'costco',
    'sams-club',
  ]);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Kroger and Walmart'), ['kroger', 'walmart']);
  // A chain whose NAME contains "and" resolves whole and never fragments.
  assert.deepEqual(canonicalRetailerIdsForEvidence('Stop and Shop and Hannaford'), [
    'stop-and-shop',
    'hannaford',
  ]);
});

test('ambiguity stays unresolved and prose never matches', () => {
  // Giant Food (DC/MD/VA) vs The GIANT Company (PA): a bare "Giant" is
  // ambiguous and matches neither; the specific forms match their own chain.
  assert.deepEqual(canonicalRetailerIdsForEvidence('Giant'), []);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Giant Food'), ['giant-food']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Giant Food Stores'), ['giant-company']);
  // Real census noise: none of it may resolve.
  assert.deepEqual(canonicalRetailerIdsForEvidence('Michigan only through'), []);
  assert.deepEqual(canonicalRetailerIdsForEvidence('123 stores in DE, MD, NJ, PA and VA'), []);
  assert.deepEqual(canonicalRetailerIdsForEvidence('best by date'), []);
  assert.deepEqual(canonicalRetailerIdsForEvidence('kroger mid-atlantic'), []);
  assert.deepEqual(canonicalRetailerIdsForEvidence(''), []);
});

test('distinct banners of one parent stay distinct', () => {
  assert.deepEqual(canonicalRetailerIdsForEvidence('Fred Meyer'), ['fred-meyer']);
  assert.notDeepEqual(canonicalRetailerIdsForEvidence('Fred Meyer'), ['kroger']);
  assert.deepEqual(canonicalRetailerIdsForEvidence('Safeway'), ['safeway']);
  assert.notDeepEqual(canonicalRetailerIdsForEvidence('Safeway'), ['albertsons']);
});

test('canonicalRetailerIds dedupes across evidence strings', () => {
  assert.deepEqual(canonicalRetailerIds(['Costco', 'Costco Wholesale', 'Walmart']), [
    'costco',
    'walmart',
  ]);
});

test('normalization handles punctuation without erasing hyphenated identity', () => {
  assert.equal(normalizeRetailerText('BJ’s Wholesale Club'), 'bjs wholesale club');
  assert.equal(normalizeRetailerText('Winn-Dixie'), 'winn-dixie');
  assert.equal(normalizeRetailerText('Smart & Final'), 'smart and final');
});

test('search matches names and aliases; empty query lists the whole catalog', () => {
  assert.equal(searchRetailers('').length, RETAILER_CATALOG.length);
  assert.ok(searchRetailers('kwik star').some((r) => r.id === 'kwik-trip'));
  assert.ok(searchRetailers('joe').some((r) => r.id === 'trader-joes'));
  assert.equal(searchRetailers('zzzz-no-such-chain').length, 0);
});

test('retailerById round-trips and rejects unknown ids', () => {
  assert.equal(retailerById('costco')?.name, 'Costco');
  assert.equal(retailerById('not-a-chain'), null);
});
