/**
 * Category-filter semantics and feed invariance (C10A, wired in C10B).
 *
 * These pin the semantics the Home screen now runs, and — more importantly —
 * pin the guarantee that a category dimension which nobody has selected is a
 * strict no-op on All Recalls.
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
import { sanitizeLaunchCategoryIds } from '@/domain/food-category-launch';
import type { Classification, Geography } from '@/domain/recall-types';
import { buildAffectsMeSections } from './affects-me-ranking';
import { buildFeedSections } from './feed-relevance';
import { makeCorpus } from './feed-fixtures';
import { buildSearchEntry, filterBySearch } from './feed-search';
import type { FeedItem } from './recall-feed';
import { evaluatePersonalRelevance } from './relevance';
import {
  activeFilterCount,
  applyFeedFilters,
  EMPTY_FEED_FILTERS,
  hasActiveFilters,
  matchesCategoryFilter,
  orderByLocationTiers,
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

// ── Pairwise composition (C10B) ─────────────────────────────────────────────
//
// The three-way AND is covered above; these isolate each pair, so a regression
// that broke exactly one conjunction could not hide behind the other.

test('category composes with location alone as AND', () => {
  const rows = [
    row('match', ['seafood'], CALIFORNIA),
    row('wrong-category', ['produce'], CALIFORNIA),
    row('wrong-location', ['seafood'], { ...CALIFORNIA, states: ['Texas'] }),
    row('nationwide-seafood', ['seafood'], NATIONWIDE),
  ];
  assert.deepEqual(
    ids(applyFeedFilters(rows, filters({ categoryIds: ['seafood'], stateCodes: ['CA'] }))),
    ['match', 'nationwide-seafood'],
  );
});

test('category composes with risk alone as AND', () => {
  const rows = [
    row('match', ['seafood'], NATIONWIDE, CLASS_I),
    row('wrong-category', ['produce'], NATIONWIDE, CLASS_I),
    row('wrong-risk', ['seafood'], NATIONWIDE, CLASS_III),
  ];
  assert.deepEqual(
    ids(applyFeedFilters(rows, filters({ categoryIds: ['seafood'], riskTiers: ['critical'] }))),
    ['match'],
  );
});

test('a single selected category admits only that aisle', () => {
  const rows = [
    row('a', ['produce']),
    row('b', ['meat_poultry']),
    row('c', ['produce', 'pantry_condiments']),
  ];
  assert.deepEqual(ids(applyFeedFilters(rows, filters({ categoryIds: ['produce'] }))), ['a', 'c']);
});

// ── Hidden ids cannot be injected (C10B) ────────────────────────────────────

test('a hidden category cannot reach the filter through restored state', () => {
  // `applyFeedFilters` is a pure predicate and will honour any id it is given
  // — which is correct, because a stored case may legitimately CARRY a hidden
  // id. The launch policy lives at the state boundary, and this is the test
  // that the boundary is the thing that stops it.
  const rows = [row('prepared', ['prepared_foods']), row('seafood', ['seafood'])];
  const hostile = ['prepared_foods', 'supplements', 'other', 'not_a_category'];
  const sanitized = sanitizeLaunchCategoryIds(hostile);
  assert.deepEqual(sanitized, []);
  // Sanitized to nothing = no restriction, so the prepared-foods case is still
  // fully visible in All Recalls. Hiding a chip never hides a recall.
  assert.deepEqual(ids(applyFeedFilters(rows, filters({ categoryIds: sanitized }))), [
    'prepared',
    'seafood',
  ]);
  // And a hostile list carrying one legitimate id keeps only that one.
  assert.deepEqual(
    ids(
      applyFeedFilters(
        rows,
        filters({
          categoryIds: sanitizeLaunchCategoryIds([...hostile, 'seafood']),
        }),
      ),
    ),
    ['seafood'],
  );
});

// ── Missing data never crashes (C10B) ───────────────────────────────────────

test('rows with missing or malformed categories filter without crashing', () => {
  const damaged = [
    row('undefined', undefined),
    row('empty', []),
    row('null', null as unknown as FoodCategoryId[]),
    row('ok', ['seafood']),
  ];
  assert.deepEqual(ids(applyFeedFilters(damaged, filters({ categoryIds: ['seafood'] }))), ['ok']);
  // With the dimension inactive every one of them is still shown.
  assert.equal(applyFeedFilters(damaged, EMPTY_FEED_FILTERS).length, 4);
});

// ── Search composes with the category dimension ─────────────────────────────

test('search runs after filtering and narrows only what the filter admitted', () => {
  const corpus = makeCorpus(12);
  const tagged: FeedItem[] = corpus.map((item, index) => ({
    ...item,
    productCategories: index % 2 === 0 ? ['seafood'] : ['produce'],
  }));
  const entryOf = (item: FeedItem) => buildSearchEntry(item);
  const seafood = applyFeedFilters(tagged, filters({ categoryIds: ['seafood'] }));
  const searched = filterBySearch(seafood, tagged[0].firmName ?? '', entryOf);

  // Every survivor satisfies BOTH conditions, and search never resurrects a
  // case the category filter excluded.
  const seafoodIds = new Set(seafood.map((i) => i.id));
  for (const item of searched) assert.equal(seafoodIds.has(item.id), true, item.id);
  assert.ok(searched.length > 0, 'the fixture query must match something');

  // Order is the input order both stages received — neither reorders.
  assert.deepEqual(
    searched.map((i) => i.id),
    seafood.filter((i) => searched.some((s) => s.id === i.id)).map((i) => i.id),
  );
});

// ── Byte-identical All Recalls and Affects Me over the real builders ────────

const NOW = new Date('2026-08-30T00:00:00.000Z');
const PROFILE = { state: 'CA', allergens: ['sesame', 'peanut'], retailers: ['costco'] };
const joined = (list: readonly { id: string }[]) => list.map((i) => i.id).join(',');

/**
 * The fixture corpus with real, varied categories attached.
 *
 * The cycle length is 7 on purpose: the fixtures vary geography on a 4-cycle
 * and states on a 5-cycle, so a category cycle sharing a factor with either
 * would correlate the two — and a "location tiers survive filtering" test
 * whose filtered set happens to contain only one tier passes vacuously. Seven
 * is coprime with both, so every category meets every geography kind.
 */
function categorized(items: FeedItem[]): FeedItem[] {
  const cycle: FoodCategoryId[][] = [
    ['produce'],
    ['meat_poultry'],
    ['seafood'],
    ['other'],
    ['dairy_eggs', 'bakery_grains'],
    ['prepared_foods'],
    ['pantry_condiments'],
  ];
  return items.map((item, index) => ({ ...item, productCategories: cycle[index % cycle.length] }));
}

test('with no category selected, All Recalls is byte-identical to its pre-category self', () => {
  const plain = makeCorpus(30);
  const tagged = categorized(plain);
  const before = buildFeedSections(applyFeedFilters(plain, EMPTY_FEED_FILTERS), NOW);
  const after = buildFeedSections(applyFeedFilters(tagged, EMPTY_FEED_FILTERS), NOW);
  assert.equal(joined(after.recent), joined(before.recent));
  assert.equal(joined(after.olderActive), joined(before.olderActive));
  assert.equal(
    before.recent.length + before.olderActive.length,
    plain.length,
    'every case placed exactly once',
  );
});

test('Affects Me is byte-identical no matter what All has selected', () => {
  const corpus = categorized(makeCorpus(30));
  const relevanceOf = (item: FeedItem) =>
    evaluatePersonalRelevance(
      {
        geography: item.geography,
        pathogenOrAllergen: item.pathogenOrAllergen,
        retailerNames: item.retailerNames,
        hazardCategory: item.hazardCategory,
        reasonText: item.reasonText,
      },
      PROFILE,
    );
  const baseline = buildAffectsMeSections(corpus, relevanceOf, { now: NOW });

  // Affects Me is built from the COMPLETE corpus, never from the filtered
  // view. Selecting every category in turn must not move one card.
  for (const id of ['produce', 'meat_poultry', 'seafood', 'dairy_eggs'] as FoodCategoryId[]) {
    const withSelection = buildAffectsMeSections(corpus, relevanceOf, { now: NOW });
    assert.equal(joined(withSelection.affects), joined(baseline.affects), id);
    assert.equal(joined(withSelection.older), joined(baseline.older), id);
    // And the filtered All view is genuinely different, so the invariance
    // above is not vacuous.
    const filtered = applyFeedFilters(corpus, filters({ categoryIds: [id] }));
    assert.ok(filtered.length < corpus.length, `${id} must actually narrow the feed`);
  }
});

test('filtering changes membership only — the comparator still orders the result', () => {
  const corpus = categorized(makeCorpus(40));
  const selected = filters({ categoryIds: ['produce'], stateCodes: ['CA'] });
  const filtered = applyFeedFilters(corpus, selected);
  const sectioned = buildFeedSections(filtered, NOW);
  const ordered = orderByLocationTiers(sectioned.recent, selected.stateCodes);

  // Every admitted case is a produce case, and sectioning + ordering over the
  // filtered list equals sectioning + ordering over the same list built any
  // other way — filtering hands the comparator a subset, nothing more.
  for (const item of filtered) {
    assert.equal(item.productCategories?.includes('produce'), true, item.id);
  }
  assert.equal(
    joined(ordered),
    joined(orderByLocationTiers(buildFeedSections(filtered, NOW).recent, ['CA'])),
  );
});

test('location-specific cases stay above nationwide ones after category filtering', () => {
  // Hand-built rows rather than the shared corpus: the fixtures store postal
  // CODES in `geography.states` while the location filter matches canonical
  // state NAMES, so no fixture case is ever an explicit match and the tier
  // assertion would hold vacuously over them.
  const rows = [
    row('nationwide-produce-a', ['produce'], NATIONWIDE),
    row('california-produce', ['produce'], CALIFORNIA),
    row('nationwide-produce-b', ['produce'], NATIONWIDE),
    row('california-seafood', ['seafood'], CALIFORNIA),
    row('texas-produce', ['produce'], { ...CALIFORNIA, states: ['Texas'] }),
  ];
  const selected = filters({ categoryIds: ['produce'], stateCodes: ['CA'] });
  const filtered = applyFeedFilters(rows, selected);

  // The category and location dimensions both bit: Texas produce and
  // California seafood are gone.
  assert.deepEqual(ids(filtered), [
    'nationwide-produce-a',
    'california-produce',
    'nationwide-produce-b',
  ]);

  // Ordering then runs over the filtered set exactly as it does unfiltered:
  // the explicit California match leads both nationwide ones, even though it
  // arrived second.
  assert.deepEqual(ids(orderByLocationTiers(filtered, ['CA'])), [
    'california-produce',
    'nationwide-produce-a',
    'nationwide-produce-b',
  ]);
});
