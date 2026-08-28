/**
 * Structural contract of the C6 Profile + navigation changes, asserted
 * against the route sources as text (same approach as the workflow-schedule
 * pins): these are one-line facts whose silent drift would duplicate
 * preference state, break the Alerts deep link, or grow household data.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { EMPTY_PREFERENCES } from '@/domain/preferences';
import { ALLERGEN_SECTION_HELPER, ALLERGEN_SECTION_LABEL } from './personalization-copy';

const APP = join(__dirname, '..', 'app');
const read = (name: string): string => readFileSync(join(APP, name), 'utf8');

test('Profile owns no preference or notification state — it links to the one Settings screen', () => {
  const profile = read('profile.tsx');
  assert.ok(profile.includes('href="/settings"'), 'Profile must link to /settings');
  // The existing store stays the ONLY preference implementation: Profile may
  // not import it, duplicate it, or add another persistence layer.
  for (const forbidden of [
    'preferences-store',
    'savePreferences',
    'loadPreferences',
    'push-registration',
    'SecureStore',
    'AsyncStorage',
    'useState',
  ]) {
    assert.ok(!profile.includes(forbidden), `profile.tsx references ${forbidden}`);
  }
});

test('the Settings screen keeps the preference store and the exact allergen copy', () => {
  const settings = read('settings.tsx');
  assert.ok(settings.includes("from '@/lib/preferences-store'"));
  assert.ok(settings.includes('savePreferences'));
  assert.ok(settings.includes('ALLERGEN_SECTION_LABEL'));
  assert.equal(ALLERGEN_SECTION_LABEL, 'Allergens to watch');
  assert.equal(
    ALLERGEN_SECTION_HELPER,
    'Select any allergens relevant to you or anyone you shop or cook for.',
  );
});

test('the /settings route and the recall detail route survive; /profile joins them', () => {
  const layout = read('_layout.tsx');
  assert.ok(layout.includes('name="settings"'), 'settings route removed');
  assert.ok(layout.includes('name="recall/[id]"'), 'detail route removed');
  assert.ok(layout.includes('name="profile"'), 'profile route missing');
  assert.ok(layout.includes('href="/profile"'), 'header entry should open Profile');
});

test('no household or profile identity fields exist — preferences keep their three dimensions', () => {
  assert.deepEqual(Object.keys(EMPTY_PREFERENCES).sort(), ['allergens', 'retailers', 'state']);
  const profile = read('profile.tsx');
  for (const forbidden of ['avatar', 'household', 'displayName', 'account']) {
    assert.ok(!profile.toLowerCase().includes(forbidden.toLowerCase()));
  }
});

test('Home switches modes without any write path to preferences', () => {
  const home = read('index.tsx');
  assert.ok(!home.includes('savePreferences'), 'Home must never write preferences');
  // Browsing filters are session state: no persistence import anywhere on Home.
  for (const forbidden of ['SecureStore', 'AsyncStorage']) {
    assert.ok(!home.includes(forbidden));
  }
});

test('the Category filter is deliberately absent from the temporary filter bar', () => {
  const home = read('index.tsx');
  // The bar offers Location and Risk sheets only — a Category chip may ship
  // solely through a future milestone that passes the frozen accuracy gates
  // (docs/recall-food-categories.md).
  assert.ok(home.includes("setOpenSheet('location')"));
  assert.ok(home.includes("setOpenSheet('risk')"));
  assert.ok(!/setOpenSheet\('category'\)/.test(home));
});
