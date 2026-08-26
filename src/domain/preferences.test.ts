import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONSUMER_ALLERGENS,
  EMPTY_PREFERENCES,
  hasAnyPreference,
  isSupportedStateCode,
  sanitizePreferences,
  stateNameForCode,
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
    state: 'CA',
    allergens: ['sesame', 'gluten', 'nonsense', 42, 'sesame'],
    retailers: ['costco', 'not-a-chain', 'costco', null],
  });
  assert.deepEqual(cleaned, { state: 'CA', allergens: ['sesame'], retailers: ['costco'] });
  assert.deepEqual(sanitizePreferences({ state: 'XX' }).state, null);
  assert.deepEqual(sanitizePreferences(null), EMPTY_PREFERENCES);
  assert.deepEqual(sanitizePreferences('garbage'), EMPTY_PREFERENCES);
});

test('hasAnyPreference reflects any dimension', () => {
  assert.equal(hasAnyPreference(EMPTY_PREFERENCES), false);
  assert.equal(hasAnyPreference({ state: 'CA', allergens: [], retailers: [] }), true);
  assert.equal(hasAnyPreference({ state: null, allergens: ['milk'], retailers: [] }), true);
  assert.equal(hasAnyPreference({ state: null, allergens: [], retailers: ['aldi'] }), true);
});
