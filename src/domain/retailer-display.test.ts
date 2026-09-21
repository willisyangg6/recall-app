import assert from 'node:assert/strict';
import { test } from 'node:test';

import { displayableRetailerNames, isDisplayableRetailerName } from './retailer-display';

test('genuine store names pass, catalog chain or not', () => {
  // 81 of the 151 distinct stored strings on the live consumer-visible
  // corpus resolve to a canonical catalog chain and 70 do not. The 70 are
  // real local grocers the notices named, so catalog membership is NOT the
  // test — rejecting them would delete true information to satisfy a list.
  for (const name of [
    'Walmart',
    'Costco Wholesale',
    'H-E-B',
    "BJ's Wholesale Club",
    'Trader Joe’s',
    'Stop and Shop',
    'Stop&Shop',
    'Food 4 Less',
    'Food City',
    'Food Lion',
    'El Super',
    'Big Y',
    // Local, uncatalogued, and entirely real.
    'Bedner’s Farm Fresh Markets',
    'Caraluzzi’s Markets',
    'Boa Vista Orchards',
    'Face Rock Flagship',
    'Bernat’s Deli',
    'Adam’s Markets',
    // Source-merged runs stay as the source wrote them.
    'Kroger and King Soopers',
    'Costco and Sam’s Club',
    'H-E-B and Joe V’s Smart Shop',
    'ALDI and BJ’s',
  ]) {
    assert.equal(isDisplayableRetailerName(name), true, `rejected a real store: ${name}`);
  }
});

test('a string whose segments name a PLACE is never printed as a store', () => {
  // The one live defect: two truncated California city names that reached
  // the hardened field because the extractor tested the WHOLE string, and
  // neither half is the whole string. The rule here is the extractor's own
  // "one entity has one role", read per segment.
  assert.equal(isDisplayableRetailerName('Roseville and Sacr'), false);
  // The same shape, other places, other separators — this is a rule about
  // geography, not a memorized string.
  for (const name of [
    'Roseville',
    'California',
    'Texas and Oklahoma',
    'Brooklyn, Queens',
    'Ann Arbor and Ypsilanti',
  ]) {
    assert.equal(isDisplayableRetailerName(name), false, `printed a place as a store: ${name}`);
  }
});

test('an empty or blank string names nothing', () => {
  assert.equal(isDisplayableRetailerName(''), false);
  assert.equal(isDisplayableRetailerName('   '), false);
  // Deliberately not asserted: punctuation soup like " , & and ". This gate
  // rejects PLACES and makes no claim to be a junk filter — the extractor's
  // name contract (domain/retailer.ts) is what keeps non-names out of the
  // field in the first place, and widening this rule to second-guess it
  // would give one decision two owners.
});

test('filtering preserves source order and removes only what it must', () => {
  assert.deepEqual(
    displayableRetailerNames(['Walmart', 'Roseville and Sacr', 'Costco', 'California']),
    ['Walmart', 'Costco'],
  );
  // A case whose ONLY evidence is a place is left with no stores at all,
  // which is the correct answer for it.
  assert.deepEqual(displayableRetailerNames(['Roseville and Sacr']), []);
  // And a clean list is returned intact.
  const clean = ['Kroger', 'Publix', 'Safeway'];
  assert.deepEqual(displayableRetailerNames(clean), clean);
});

test('the gate rejects places, and nothing else — it is not a name-quality filter', () => {
  // A store with a number, an ampersand, a possessive, a long name, or an
  // unfamiliar word is still a store. Only geography is barred.
  for (const name of [
    '7-Eleven',
    'A&P',
    'Piggly Wiggly',
    'Yakima Fruit Markets',
    'Good Food Markets Santoni’s',
    'Zylthorp Provisions Grocery',
  ]) {
    assert.equal(isDisplayableRetailerName(name), true, `over-filtered: ${name}`);
  }
});
