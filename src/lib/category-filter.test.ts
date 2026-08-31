/**
 * Category-filter semantics and feed invariance (C10A).
 *
 * The filter UI is NOT wired in this milestone; these tests pin the semantics
 * C10B will wire, and — more importantly — pin the guarantee that a category
 * dimension which nobody has selected is a strict no-op on All Recalls.
 *
 * The product decision these encode: Category is an OPTIONAL DISCOVERY tool.
 * It is allowed to be less accurate than personalization because a
 * miscategorized card is a discovery miss with the whole unfiltered feed
 * behind it, whereas a missed allergen match is a missed alert. So the tests
 * that matter most here are the ones proving Category cannot reach relevance,
 * Affects Me, ranking, risk, or notification eligibility.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FoodCategoryId } from '@/domain/food-category';
import type { Classification, Geography } from '@/domain/recall-types';
import {
  activeFilterCount,
  applyFeedFilters,
  EMPTY_FEED_FILTERS,
  hasActiveFilters,
  matchesCategoryFilter,
  type FeedFilterState,
  type FilterableRecall,
} from './feed-filters';

const NATIONWIDE: Geography = {
  scope: 'nationwide',
  states: [],
  confidence: 'stated',
  sourceText: null,
};
const CALIFORNIA: Geography = {
  scope: 'states',
  states: ['California'],
  confidence: 'stated',
  sourceText: null,
};
const CLASS_I: Classification = {
  value: 'class_I',
  sourceText: null,
  officialClasses: ['class_I'],
};
const CLASS_III: Classification = {
  value: 'class_III',
  sourceText: null,
  officialClasses: ['class_III'],
};

interface Row extends FilterableRecall {
  id: string;
}

const row = (
  id: string,
  productCategories: FoodCategoryId[] | undefined,
  geography: Geography = NATIONWIDE,
  classification: Classification = CLASS_I,
): Row => ({ id, productCategories, geography, classification });

const filters = (overrides: Partial<FeedFilterState> = {}): FeedFilterState => ({
  ...EMPTY_FEED_FILTERS,
  ...overrides,
});

const ids = (rows: readonly Row[]): string[] => rows.map((r) => r.id);

// ── OR within the dimension ─────────────────────────────────────────────────

test('multiple selected categories are OR, not AND', () => {
  const rows = [
    row('seafood', ['seafood']),
    row('beverages', ['beverages']),
    row('bakery', ['bakery_grains']),
  ];
  assert.deepEqual(
    ids(applyFeedFilters(rows, filters({ categoryIds: ['seafood', 'beverages'] }))),
    ['seafood', 'beverages'],
  );
});

test('a multi-category case is findable under EACH of its categories', () => {
  const waffles = row('waffles', ['meat_poultry', 'bakery_grains']);
  const rows = [waffles];
  assert.deepEqual(ids(applyFeedFilters(rows, filters({ categoryIds: ['meat_poultry'] }))), [
    'waffles',
  ]);
  assert.deepEqual(ids(applyFeedFilters(rows, filters({ categoryIds: ['bakery_grains'] }))), [
    'waffles',
  ]);
  // And it appears exactly once when both are selected.
  assert.deepEqual(
    ids(applyFeedFilters(rows, filters({ categoryIds: ['meat_poultry', 'bakery_grains'] }))),
    ['waffles'],
  );
});

test('selecting Other returns only cases the source did not let us name', () => {
  const rows = [row('unnamed', ['other']), row('cookies', ['bakery_grains'])];
  assert.deepEqual(ids(applyFeedFilters(rows, filters({ categoryIds: ['other'] }))), ['unnamed']);
});

// ── AND across dimensions ───────────────────────────────────────────────────

test('category composes with location and risk as AND', () => {
  const rows = [
    row('match', ['seafood'], CALIFORNIA, CLASS_I),
    row('wrong-category', ['bakery_grains'], CALIFORNIA, CLASS_I),
    row('wrong-location', ['seafood'], { ...CALIFORNIA, states: ['Texas'] }, CLASS_I),
    row('wrong-risk', ['seafood'], CALIFORNIA, CLASS_III),
  ];
  const selected = filters({
    categoryIds: ['seafood'],
    stateCodes: ['CA'],
    riskTiers: ['critical'],
  });
  assert.deepEqual(ids(applyFeedFilters(rows, selected)), ['match']);
});

// ── Inactive is a strict no-op ──────────────────────────────────────────────

test('no category selection returns the SAME array instance', () => {
  const rows = [row('a', ['seafood']), row('b', undefined)];
  assert.equal(applyFeedFilters(rows, EMPTY_FEED_FILTERS), rows);
  assert.equal(hasActiveFilters(EMPTY_FEED_FILTERS), false);
  assert.equal(activeFilterCount(EMPTY_FEED_FILTERS), 0);
});

test('an un-enriched corpus is completely unaffected while no category is selected', () => {
  // Every case still lacks the field before the historical backfill runs.
  const rows = Array.from({ length: 25 }, (_, i) => row(`case-${i}`, undefined));
  assert.equal(applyFeedFilters(rows, EMPTY_FEED_FILTERS), rows);
  assert.deepEqual(
    ids(applyFeedFilters(rows, filters({ stateCodes: ['CA'] }))),
    ids(rows.filter((r) => r.geography.scope === 'nationwide')),
  );
});

test('a category selection never removes a case from the UNFILTERED feed', () => {
  const rows = [row('a', ['seafood']), row('b', undefined), row('c', ['other'])];
  // Filtering derives a view; the corpus is untouched and clearing restores it.
  const filtered = applyFeedFilters(rows, filters({ categoryIds: ['seafood'] }));
  assert.deepEqual(ids(filtered), ['a']);
  assert.deepEqual(ids(applyFeedFilters(rows, EMPTY_FEED_FILTERS)), ['a', 'b', 'c']);
  assert.equal(rows.length, 3);
});

// ── Not-derived is silence, never a guess ───────────────────────────────────

test('a case with no derived categories matches no active selection', () => {
  assert.equal(matchesCategoryFilter(undefined, ['seafood']), false);
  assert.equal(matchesCategoryFilter([], ['seafood']), false);
  // …but it matches when the filter is inactive, so it is never hidden.
  assert.equal(matchesCategoryFilter(undefined, []), true);
  assert.equal(matchesCategoryFilter([], []), true);
});

test('an un-enriched case is not swept into Other', () => {
  const rows = [row('legacy', undefined), row('unnamed', ['other'])];
  assert.deepEqual(ids(applyFeedFilters(rows, filters({ categoryIds: ['other'] }))), ['unnamed']);
});

// ── Filtering changes the SET; the existing comparator orders it ────────────

test('filtering selects members and leaves ordering to the existing comparator', () => {
  const rows = [
    row('c', ['seafood']),
    row('a', ['seafood']),
    row('b', ['bakery_grains']),
    row('d', ['seafood']),
  ];
  // Input order is preserved exactly; the filter reorders nothing.
  assert.deepEqual(ids(applyFeedFilters(rows, filters({ categoryIds: ['seafood'] }))), [
    'c',
    'a',
    'd',
  ]);
});

// ── The counts the chip badges read ─────────────────────────────────────────

test('active filter accounting includes the category dimension', () => {
  const selected = filters({ categoryIds: ['seafood', 'produce'], stateCodes: ['CA'] });
  assert.equal(hasActiveFilters(selected), true);
  assert.equal(activeFilterCount(selected), 3);
  assert.equal(hasActiveFilters(filters({ categoryIds: ['seafood'] })), true);
});
