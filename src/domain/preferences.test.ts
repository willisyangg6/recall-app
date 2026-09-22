import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONSUMER_ALLERGENS,
  EMPTY_PREFERENCES,
  hasAnyPreference,
  isSupportedStateCode,
  orderStateCodes,
  sanitizePreferences,
  STATE_CODES_IN_ORDER,
  stateNameForCode,
  stateNamesForCodes,
  SUPPORTED_STATE_CODES,
} from './preferences';

test('the state set is exactly the geography layer’s 52 jurisdictions', () => {
  assert.equal(SUPPORTED_STATE_CODES.length, 52);
  assert.ok(isSupportedStateCode('CA'));
  assert.ok(isSupportedStateCode('DC'));
  assert.ok(isSupportedStateCode('PR'));
  assert.ok(!isSupportedStateCode('XX'));
  assert.ok(!isSupportedStateCode('ca'));
  assert.equal(stateNameForCode('CA'), 'California');
  assert.equal(stateNameForCode(null), null);
});

test('the allergen taxonomy is the closed nine-major set', () => {
  assert.deepEqual(CONSUMER_ALLERGENS.map((a) => a.token).sort(), [
    'egg',
    'fish',
    'milk',
    'peanut',
    'sesame',
    'shellfish',
    'soy',
    'tree nuts',
    'wheat',
  ]);
  // Non-major tokens the hazard layer can produce are NOT selectable.
  assert.ok(!CONSUMER_ALLERGENS.some((a) => a.token === 'gluten'));
  assert.ok(!CONSUMER_ALLERGENS.some((a) => a.token === 'sulfites'));
});

test('sanitizePreferences drops anything outside the closed vocabularies', () => {
  const cleaned = sanitizePreferences({
    states: ['CA'],
    allergens: ['sesame', 'gluten', 'nonsense', 42, 'sesame'],
    retailers: ['costco', 'not-a-chain', 'costco', null],
  });
  assert.deepEqual(cleaned, { states: ['CA'], allergens: ['sesame'], retailers: ['costco'] });
  assert.deepEqual(sanitizePreferences({ states: ['XX'] }).states, []);
  assert.deepEqual(sanitizePreferences(null), EMPTY_PREFERENCES);
  assert.deepEqual(sanitizePreferences('garbage'), EMPTY_PREFERENCES);
});

// ── The canonical order ─────────────────────────────────────────────────────

test('the canonical order is by full name, so DC and PR are not stranded at the end', () => {
  assert.equal(STATE_CODES_IN_ORDER.length, 52);
  assert.deepEqual([...STATE_CODES_IN_ORDER].sort(), [...SUPPORTED_STATE_CODES].sort());
  const names = STATE_CODES_IN_ORDER.map((code) => stateNameForCode(code) as string);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
  assert.equal(names[0], 'Alabama');
  assert.equal(names[names.length - 1], 'Wyoming');
  // The postal map's own key order puts both of these last; by name they are
  // in the middle, which is where a shopper scanning the list expects them.
  assert.ok(STATE_CODES_IN_ORDER.indexOf('DC') < STATE_CODES_IN_ORDER.indexOf('WY'));
  assert.ok(STATE_CODES_IN_ORDER.indexOf('PR') < STATE_CODES_IN_ORDER.indexOf('WY'));
  assert.equal(SUPPORTED_STATE_CODES[SUPPORTED_STATE_CODES.length - 1], 'PR');
});

test('orderStateCodes de-duplicates, drops the unsupported, and never mutates its input', () => {
  assert.deepEqual(orderStateCodes(['NY', 'CA', 'NY', 'DC']), ['CA', 'DC', 'NY']);
  assert.deepEqual(orderStateCodes(['ZZ', 'ca', '', 'CA']), ['CA']);
  assert.deepEqual(orderStateCodes([]), []);
  const input = ['NY', 'CA'];
  orderStateCodes(input);
  assert.deepEqual(input, ['NY', 'CA']);
  assert.deepEqual(stateNamesForCodes(['NY', 'DC', 'CA']), [
    'California',
    'District of Columbia',
    'New York',
  ]);
  assert.deepEqual(stateNamesForCodes([]), []);
});

// ── The one migration: singular `state` becomes a one-item `states` ─────────

test('a pre-P2B7U singular state migrates losslessly into a one-item list', () => {
  const legacy = { state: 'CA', allergens: ['sesame'], retailers: ['costco'] };
  const migrated = sanitizePreferences(legacy);
  assert.deepEqual(migrated, { states: ['CA'], allergens: ['sesame'], retailers: ['costco'] });
  // Nothing else about the profile moved.
  assert.deepEqual(migrated.allergens, legacy.allergens);
  assert.deepEqual(migrated.retailers, legacy.retailers);
  // The territories a shopper could already choose are not special-cased
  // away by the migration.
  assert.deepEqual(sanitizePreferences({ state: 'DC' }).states, ['DC']);
  assert.deepEqual(sanitizePreferences({ state: 'PR' }).states, ['PR']);
  // A legacy profile that had chosen no state becomes the empty list, which
  // is the same answer it always gave: no location preference.
  assert.deepEqual(sanitizePreferences({ state: null }).states, []);
  assert.equal(hasAnyPreference(sanitizePreferences({ state: null })), false);
});

test('the migration is idempotent, and leaves no singular field to grow a second authority from', () => {
  const once = sanitizePreferences({ state: 'CA', allergens: [], retailers: [] });
  const twice = sanitizePreferences(once);
  const thrice = sanitizePreferences(JSON.parse(JSON.stringify(twice)));
  assert.deepEqual(once, twice);
  assert.deepEqual(twice, thrice);
  // The output carries `states` and nothing singular, so re-reading it can
  // never resurrect the old key.
  assert.deepEqual(Object.keys(once).sort(), ['allergens', 'retailers', 'states']);
  assert.ok(!('state' in once));
  // A migrated multi-state profile round-trips through storage unchanged.
  const many = sanitizePreferences({ states: ['NY', 'CA', 'MT'] });
  assert.deepEqual(many.states, ['CA', 'MT', 'NY']);
  assert.deepEqual(sanitizePreferences(JSON.parse(JSON.stringify(many))).states, [
    'CA',
    'MT',
    'NY',
  ]);
});

test('a blob holding both shapes keeps both, and invalid codes cannot corrupt the valid ones', () => {
  // Nothing a stored value asserts is discarded: the union is taken, so a
  // half-migrated blob written by two versions loses neither claim.
  assert.deepEqual(sanitizePreferences({ state: 'NY', states: ['CA'] }).states, ['CA', 'NY']);
  assert.deepEqual(sanitizePreferences({ state: 'CA', states: ['CA'] }).states, ['CA']);
  // Invalid entries are dropped one by one; the valid selections survive.
  assert.deepEqual(sanitizePreferences({ states: ['CA', 'ZZ', 'NY', 7, null] }).states, [
    'CA',
    'NY',
  ]);
  assert.deepEqual(sanitizePreferences({ state: 'XX', states: ['CA'] }).states, ['CA']);
  // A `states` that is not a list at all is simply no claim.
  assert.deepEqual(sanitizePreferences({ states: 'CA' }).states, []);
  assert.deepEqual(sanitizePreferences({ states: null, state: 'CA' }).states, ['CA']);
});

test('hasAnyPreference reflects any dimension', () => {
  assert.equal(hasAnyPreference(EMPTY_PREFERENCES), false);
  assert.deepEqual(EMPTY_PREFERENCES.states, []);
  assert.equal(hasAnyPreference({ states: ['CA', 'NY'], allergens: [], retailers: [] }), true);
  assert.equal(hasAnyPreference({ states: ['CA'], allergens: [], retailers: [] }), true);
  assert.equal(hasAnyPreference({ states: [], allergens: ['milk'], retailers: [] }), true);
  assert.equal(hasAnyPreference({ states: [], allergens: [], retailers: ['aldi'] }), true);
});
