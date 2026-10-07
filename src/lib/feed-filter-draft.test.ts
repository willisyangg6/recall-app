/**
 * The Filters sheet's draft (2026-10-06): Apply commits, leaving discards,
 * Clear all empties the draft only, "All" is the empty selection, every
 * dimension stays multi-select, and nothing here can touch preferences.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { LAUNCH_CATEGORY_OPTIONS } from '@/domain/food-category-launch';
import type { FoodCategoryId } from '@/domain/food-category';
import {
  activeGroupCount,
  ALL_LOCATIONS,
  clearDraft,
  committedFilters,
  filtersButtonAccessibilityLabel,
  filtersButtonLabel,
  isAllSelected,
  locationNote,
  locationSummary,
  selectAllInDimension,
  toggleDraftOption,
} from './feed-filter-draft';
import {
  EMPTY_FEED_FILTERS,
  RISK_FILTER_TIERS,
  sameFeedFilters,
  type FeedFilterState,
} from './feed-filters';

const applied: FeedFilterState = {
  stateCodes: ['CA'],
  riskTiers: ['critical'],
  categoryIds: ['produce'],
};

test('toggling edits a copy: the applied filters are never mutated by the draft', () => {
  const frozen = structuredClone(applied);
  const draft = toggleDraftOption(applied, 'riskTiers', 'high');
  assert.deepEqual(draft.riskTiers, ['critical', 'high']);
  assert.deepEqual(applied, frozen, 'the applied filters changed before Apply');
  // Toggling again removes; every dimension is multi-select (OR within).
  assert.deepEqual(toggleDraftOption(draft, 'riskTiers', 'critical').riskTiers, ['high']);
  const states = toggleDraftOption(
    toggleDraftOption(EMPTY_FEED_FILTERS, 'stateCodes', 'TX'),
    'stateCodes',
    'NY',
  );
  assert.deepEqual(states.stateCodes, ['TX', 'NY']);
});

test('dismissing discards: a draft that is never committed changes nothing', () => {
  // The sheet holds the draft in its own state and only `onApply` hands it
  // over; a draft that is thrown away leaves the applied value as it was.
  let draft = applied;
  draft = toggleDraftOption(draft, 'stateCodes', 'TX');
  draft = clearDraft();
  assert.equal(sameFeedFilters(applied, { ...applied }), true);
  assert.notDeepEqual(draft, applied);
  const sheet = readFileSync(
    join(__dirname, '..', 'components', 'feed', 'filters-sheet.tsx'),
    'utf8',
  );
  // Apply is the only place the draft leaves the sheet; Close only closes.
  assert.equal((sheet.match(/onApply\(/g) ?? []).length, 1);
  assert.ok(sheet.includes('onApply(committedFilters(draft))'));
  assert.ok(sheet.includes('label="Close filters"'));
  // The draft restarts from the applied filters on every opening.
  assert.ok(sheet.includes('setDraft(applied);'));
});

test('"All" is the empty selection, so it and a specific option are never both chosen', () => {
  assert.equal(isAllSelected(EMPTY_FEED_FILTERS, 'riskTiers'), true);
  const one = toggleDraftOption(EMPTY_FEED_FILTERS, 'riskTiers', 'pending');
  assert.equal(isAllSelected(one, 'riskTiers'), false);
  const back = selectAllInDimension(one, 'riskTiers');
  assert.equal(isAllSelected(back, 'riskTiers'), true);
  assert.deepEqual(back.riskTiers, []);
  // "All" in one dimension leaves the others alone.
  const mixed = selectAllInDimension(applied, 'categoryIds');
  assert.deepEqual(mixed.categoryIds, []);
  assert.deepEqual(mixed.stateCodes, ['CA']);
  assert.deepEqual(mixed.riskTiers, ['critical']);
});

test('Clear all empties every dimension of the draft and nothing else', () => {
  assert.deepEqual(clearDraft(), EMPTY_FEED_FILTERS);
  assert.equal(activeGroupCount(clearDraft()), 0);
  // A fresh object each time, so the sheet can never alias shared state.
  assert.notEqual(clearDraft(), clearDraft());
});

test('commit sanitizes categories through the launch allowlist', () => {
  const draft: FeedFilterState = {
    stateCodes: ['CA'],
    riskTiers: [],
    categoryIds: [
      'produce',
      'prepared_foods',
      'supplements',
      'other',
      'nonsense' as FoodCategoryId,
    ],
  };
  assert.deepEqual(committedFilters(draft).categoryIds, ['produce']);
  // Baby Food & Formula is a launch option and survives.
  const baby = committedFilters({ ...draft, categoryIds: ['baby_food_formula'] });
  assert.deepEqual(baby.categoryIds, ['baby_food_formula']);
});

test('the sheet offers every risk tier and all nine launch categories', () => {
  assert.deepEqual(RISK_FILTER_TIERS, [
    'critical',
    'very_high',
    'high',
    'moderate',
    'low',
    'pending',
    'unknown',
  ]);
  assert.equal(LAUNCH_CATEGORY_OPTIONS.length, 9);
  assert.ok(LAUNCH_CATEGORY_OPTIONS.some((option) => option.value === 'baby_food_formula'));
});

test('the Filters button counts active GROUPS, not options or results', () => {
  assert.equal(filtersButtonLabel(EMPTY_FEED_FILTERS), 'Filters');
  assert.equal(filtersButtonAccessibilityLabel(EMPTY_FEED_FILTERS), 'Filters');
  const two: FeedFilterState = {
    stateCodes: ['CA', 'TX', 'NY'],
    riskTiers: ['low'],
    categoryIds: [],
  };
  assert.equal(activeGroupCount(two), 2);
  assert.equal(filtersButtonLabel(two), 'Filters · 2');
  assert.equal(filtersButtonAccessibilityLabel(two), 'Filters, 2 groups active');
  assert.equal(
    filtersButtonAccessibilityLabel({ ...EMPTY_FEED_FILTERS, riskTiers: ['low'] }),
    'Filters, 1 group active',
  );
});

test('the location row summarises the draft and says nationwide only when it applies', () => {
  assert.equal(locationSummary([]), ALL_LOCATIONS);
  assert.equal(locationNote([]), null);
  assert.equal(locationSummary(['CA']), 'California');
  assert.equal(locationSummary(['TX', 'CA']), 'California, Texas');
  assert.equal(locationSummary(['TX', 'CA', 'NY']), 'California, New York +1');
  // The matcher admits nationwide recalls for any chosen state.
  assert.equal(locationNote(['CA']), 'Includes nationwide recalls');
});

test('the draft module reads no preferences and no storage', () => {
  const source = readFileSync(join(__dirname, 'feed-filter-draft.ts'), 'utf8');
  for (const forbidden of [
    'preferences-store',
    'savePreferences',
    'loadPreferences',
    'SecureStore',
    'AsyncStorage',
    'UserRecallPreferences',
  ]) {
    assert.ok(!source.includes(forbidden), `the draft reaches ${forbidden}`);
  }
});

test('the Location page searches with the Profile chooser’s matcher, and the search never changes the choice', () => {
  const sheet = readFileSync(
    join(__dirname, '..', 'components', 'feed', 'filters-sheet.tsx'),
    'utf8',
  );
  assert.ok(sheet.includes('filterStateChoices(LOCATION_CHOICES, locationQuery)'));
  assert.ok(sheet.includes('placeholder={STATE_SEARCH_PLACEHOLDER}'));
  assert.ok(sheet.includes('{STATE_SEARCH_NO_MATCH}'));
  // Rows stay tappable while the keyboard is up.
  assert.ok(sheet.includes('keyboardShouldPersistTaps="handled"'));
  // Results stay above the keyboard: a full-height page whose list insets
  // itself for the keyboard (found natively, 2026-10-06).
  assert.ok(sheet.includes("page === 'location' ? { height: maxHeight } : { maxHeight }"));
  assert.ok(sheet.includes('automaticallyAdjustKeyboardInsets'));
  // The query is never written into the draft: only a row's tick is.
  assert.ok(!/setDraft\([^)]*locationQuery/.test(sheet));
});
