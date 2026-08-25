/**
 * The canonical US geography module: deterministic state reading (every
 * explicitly named state retained, no false promotions) and the curated city
 * gazetteer that keeps places out of retailer classification.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isUsCityName,
  normalizeStateToken,
  splitAdjacentCities,
  statesInText,
} from './us-geography';

test('a postal-code list after a locality preposition keeps every state', () => {
  assert.deepEqual(
    statesInText('distributed in retail grocery stores throughout MI, MN, and ND.'),
    ['Michigan', 'Minnesota', 'North Dakota'],
  );
  assert.deepEqual(statesInText('shipped to CA and NV.'), ['California', 'Nevada']);
  assert.deepEqual(statesInText('sold in OR.'), ['Oregon']);
});

test('two-letter tokens outside geographic shapes are never states', () => {
  // A compass direction before a proper noun is not Nebraska.
  assert.deepEqual(statesInText('distributed in NE Ohio.'), ['Ohio']);
  // Product codes and initialisms never qualify.
  assert.deepEqual(statesInText('lot code MI 40213 printed on the bag'), []);
  assert.deepEqual(statesInText('the RTE product was produced by the LLC'), []);
  // The ", XX" address form still resolves.
  assert.deepEqual(statesInText('Shining Sea Fish Co. of Detroit, MI'), ['Michigan']);
});

test('state token normalization is case- and form-sensitive on purpose', () => {
  assert.equal(normalizeStateToken('MI'), 'Michigan');
  assert.equal(normalizeStateToken('Oregon'), 'Oregon');
  // Lowercase two-letter words are English, not states.
  assert.equal(normalizeStateToken('in'), null);
  assert.equal(normalizeStateToken('or'), null);
});

test('the gazetteer knows boroughs and two-word cities, and splits fused runs', () => {
  for (const city of ['Brooklyn', 'Queens', 'Bronx', 'Ann Arbor', 'West Linn', 'Corvallis']) {
    assert.ok(isUsCityName(city), city);
  }
  assert.ok(!isUsCityName('Meijer'));
  assert.ok(!isUsCityName('Market of Choice'));
  // The source's own missing comma: both tokens are cities, so the run splits.
  assert.deepEqual(splitAdjacentCities('Eugene Hillsboro'), ['Eugene', 'Hillsboro']);
  // One two-word city never splits.
  assert.equal(splitAdjacentCities('West Linn'), null);
  assert.equal(splitAdjacentCities('Whole Foods'), null);
});
