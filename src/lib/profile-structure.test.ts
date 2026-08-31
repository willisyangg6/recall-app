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

test('the filter bar offers Location, Risk and Category — and only those three', () => {
  const home = read('index.tsx');
  // C10B ships the Category chip. This pin previously asserted its ABSENCE,
  // on the reasoning that a chip could only ship once the classifier passed
  // its frozen accuracy gates. It did not pass them; the founder accepted the
  // measured 87.5% for a narrower purpose instead, with Prepared foods —
  // the weak category — hidden from the filter. The pin is therefore
  // inverted rather than deleted, so the bar's contents stay one asserted
  // fact. See docs/recall-food-categories.md.
  assert.ok(home.includes("setOpenSheet('location')"));
  assert.ok(home.includes("setOpenSheet('risk')"));
  assert.ok(home.includes("setOpenSheet('category')"));
  assert.deepEqual([...home.matchAll(/setOpenSheet\('(\w+)'\)/g)].map((m) => m[1]).sort(), [
    'category',
    'location',
    'risk',
  ]);
});

test('Home takes its category options from the launch allowlist, never a local list', () => {
  const home = read('index.tsx');
  assert.ok(home.includes("from '@/domain/food-category-launch'"));
  assert.ok(home.includes('LAUNCH_CATEGORY_OPTIONS'));
  // Every selection is sanitized before it becomes filter state, so a hidden
  // id cannot enter through the sheet or through any future caller.
  assert.ok(home.includes('sanitizeLaunchCategoryIds'));
  // No hidden id and no category LABEL may appear as a STRING LITERAL on this
  // screen: ids and labels belong to the frozen vocabulary, and a hardcoded
  // one would silently survive a rewording or an allowlist change. Prose in a
  // comment is fine and is deliberately not matched — the failure mode being
  // guarded is code that hardcodes the taxonomy, not documentation of it.
  for (const forbidden of [
    'prepared_foods',
    'supplements',
    'Prepared foods',
    'Supplements',
    'Fruits & vegetables',
    'Meat & poultry',
    'Baby food & formula',
  ]) {
    for (const quote of ["'", '"', '`']) {
      assert.ok(
        !home.includes(`${quote}${forbidden}${quote}`),
        `index.tsx must not hardcode ${quote}${forbidden}${quote}`,
      );
    }
  }
});

test('Home receives category ANSWERS, never the classifier or its evidence', () => {
  const home = read('index.tsx');
  for (const forbidden of [
    'food-category-matcher',
    'food-category-lexicon',
    'category-evaluation',
    'categoriesForCase',
    'deriveProductCategories',
    'category-gold-set',
  ]) {
    assert.ok(!home.includes(forbidden), `index.tsx must not reference ${forbidden}`);
  }
});
