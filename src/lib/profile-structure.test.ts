/**
 * Structural contract of the Profile + navigation changes, asserted
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
const read = (...parts: string[]): string => readFileSync(join(APP, ...parts), 'utf8');

/**
 * The Feed screen AND the card it renders through (P2A extracted the card so
 * Saved lists recalls through the same component). Joining them keeps every
 * "Home must not …" guard covering the card too, rather than letting the
 * extraction quietly move something out from under a pin.
 */
const home = (): string =>
  read('(tabs)', 'index.tsx') +
  '\n' +
  readFileSync(join(__dirname, '..', 'components', 'recall-card.tsx'), 'utf8');

test('Profile owns no preference or notification state — it links to the settings screens', () => {
  const profile = read('(tabs)', 'profile.tsx');
  // P2A: the one combined screen became two, so Profile links to both rather
  // than sending two rows to the same place.
  assert.ok(
    profile.includes('href="/settings/personalization"'),
    'Profile must link to Personalization',
  );
  assert.ok(
    profile.includes('href="/settings/notifications"'),
    'Profile must link to Notifications',
  );
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

test('the Personalization screen keeps the preference store and the exact allergen copy', () => {
  const settings = read('settings', 'personalization.tsx');
  assert.ok(settings.includes("from '@/lib/preferences-store'"));
  assert.ok(settings.includes('savePreferences'));
  assert.ok(settings.includes('ALLERGEN_SECTION_LABEL'));
  assert.equal(ALLERGEN_SECTION_LABEL, 'Allergens to watch');
  assert.equal(
    ALLERGEN_SECTION_HELPER,
    'Select any allergens relevant to you or anyone you shop or cook for.',
  );
});

test('the settings routes and the recall detail route survive; Profile is a tab', () => {
  const layout = read('_layout.tsx');
  assert.ok(layout.includes('name="settings/index"'), '/settings compatibility route removed');
  assert.ok(layout.includes('name="settings/personalization"'), 'personalization route removed');
  assert.ok(layout.includes('name="settings/notifications"'), 'notifications route removed');
  assert.ok(layout.includes('name="recall/[id]"'), 'detail route removed');
  // P2A: Profile moved from a header link into the tab group, so the root
  // stack registers the group and the bar owns the entry point.
  assert.ok(layout.includes('name="(tabs)"'), 'tab group missing from the root stack');
  assert.ok(
    !layout.includes('href="/profile"'),
    'the retired header entry duplicates the Profile tab',
  );
  // The legacy /settings deep link still resolves — as a redirect, not a
  // dead screen.
  assert.match(read('settings', 'index.tsx'), /<Redirect href="\/settings\/notifications" \/>/);
});

test('no household or profile identity fields exist — preferences keep their three dimensions', () => {
  assert.deepEqual(Object.keys(EMPTY_PREFERENCES).sort(), ['allergens', 'retailers', 'state']);
  const profile = read('(tabs)', 'profile.tsx');
  for (const forbidden of ['avatar', 'household', 'displayName', 'account']) {
    assert.ok(!profile.toLowerCase().includes(forbidden.toLowerCase()));
  }
});

test('Feed switches modes without any write path to preferences', () => {
  const source = home();
  assert.ok(!source.includes('savePreferences'), 'Feed must never write preferences');
  // Browsing filters are session state: no persistence import anywhere on Feed.
  for (const forbidden of ['SecureStore', 'AsyncStorage']) {
    assert.ok(!source.includes(forbidden));
  }
});

test('the filter bar offers Location, Risk and Category — and only those three', () => {
  const home = read('(tabs)', 'index.tsx');
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
  const home = read('(tabs)', 'index.tsx');
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
  const home = read('(tabs)', 'index.tsx');
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
