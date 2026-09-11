/**
 * The C6.1 control hierarchy on Home: feed MODE (All / Affects me) is a
 * separate level from the All-only refinement filters (Location / Risk).
 *
 * The structural half is asserted against the screen source, the same way the
 * workflow and profile contracts are pinned: there is no React renderer in
 * this suite, and these are exactly the one-line render guards whose silent
 * removal would put All-only controls back in front of an Affects-me user.
 * The behavioural half is asserted against the real pure functions.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Geography } from '@/domain/recall-types';
import { buildAffectsMeSections } from './affects-me-ranking';
import {
  applyFeedFilters,
  EMPTY_FEED_FILTERS,
  sameFeedFilters,
  type FeedFilterState,
} from './feed-filters';
import { buildSearchEntry, filterBySearch } from './feed-search';
import type { FeedItem } from './recall-feed';
import { evaluatePersonalRelevance } from './relevance';

const HOME = readFileSync(join(__dirname, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');

/** The source between two marker comments, exclusive. */
function region(startMarker: string, endMarker: string): string {
  const start = HOME.indexOf(startMarker);
  const end = HOME.indexOf(endMarker);
  assert.ok(start >= 0, `marker "${startMarker}" missing from Home`);
  assert.ok(end > start, `marker "${endMarker}" missing or misordered in Home`);
  return HOME.slice(start, end);
}

const MODE_BLOCK = region('FEED MODE CONTROL (C6.1)', 'END FEED MODE CONTROL');
const FILTER_BLOCK = region('ALL-ONLY FILTER ROW (C6.1)', 'END ALL-ONLY FILTER ROW');
/** Everything that is NOT the All-only filter block. */
const OUTSIDE_FILTER_BLOCK = HOME.replace(FILTER_BLOCK, '');

// ── Structural separation ────────────────────────────────────────────────────

test('the feed-mode control is its own block, holding only the two scopes', () => {
  assert.match(MODE_BLOCK, /label: 'All'/);
  assert.match(MODE_BLOCK, /label: 'Affects me'/);
  assert.match(MODE_BLOCK, /setTab\(key\)/);
  // Refinement controls may not live in the scope control.
  for (const filterOnly of ['setOpenSheet', 'Clear all', 'activeFilterCount', 'stateCodes']) {
    assert.ok(!MODE_BLOCK.includes(filterOnly), `mode control contains ${filterOnly}`);
  }
});

test('the All-only filter row is a separate block, holding no mode switching', () => {
  assert.match(FILTER_BLOCK, /setOpenSheet\('location'\)/);
  assert.match(FILTER_BLOCK, /setOpenSheet\('risk'\)/);
  assert.match(FILTER_BLOCK, /label="Clear all"/);
  assert.ok(!FILTER_BLOCK.includes("setTab('affects_me')"), 'filter row switches feed mode');
});

test('Location, Risk, Clear all and their counts render ONLY while All is active', () => {
  // Every filter control sits inside the block, and the block is gated on All.
  assert.match(FILTER_BLOCK, /\{tab === 'all' \?/);
  for (const control of [
    "setOpenSheet('location')",
    "setOpenSheet('risk')",
    'label="Clear all"',
    'activeFilterCount(filters)',
    'filters.stateCodes.length > 0 ?',
    'filters.riskTiers.length > 0 ?',
  ]) {
    assert.ok(FILTER_BLOCK.includes(control), `${control} is not in the All-only block`);
    assert.ok(
      !OUTSIDE_FILTER_BLOCK.includes(control),
      `${control} also renders outside the All-only block — it would show in Affects me`,
    );
  }
});

test('the rejected instructional sentence is gone from Home entirely', () => {
  assert.ok(!HOME.includes('selections kept'));
  assert.ok(!HOME.includes('Location/Risk filters apply to All recalls'));
});

test('Affects me offers no way to open or clear the All-only filters', () => {
  // The only sheet openers and the only Clear all live in the All-gated block
  // (asserted above), and the sheets themselves cannot render without one.
  assert.equal((HOME.match(/setOpenSheet\('location'\)/g) ?? []).length, 1);
  assert.equal((HOME.match(/setOpenSheet\('risk'\)/g) ?? []).length, 1);
  assert.equal((HOME.match(/setFilters\(EMPTY_FEED_FILTERS\)/g) ?? []).length, 1);
});

test('switching feed mode never clears the filter selections', () => {
  // The single filter reset is the Clear all handler; no setTab path touches
  // setFilters, so All → Affects me → All returns to the same selections.
  //
  // C10B closure moved the reset one level, from inline JSX into the guarded
  // `clearAllFilters` callback (so clearing can also return the feed to the
  // top, but only when something was actually applied). The chain is asserted
  // rather than the inline call: Clear all → clearAllFilters → setFilters.
  assert.match(FILTER_BLOCK, /label="Clear all"[\s\S]*?onPress=\{clearAllFilters\}/);
  assert.match(HOME, /clearAllFilters = useCallback\([\s\S]*?setFilters\(EMPTY_FEED_FILTERS\)/);
  for (const handler of HOME.match(/onPress=\{\(\) => setTab\([^)]*\)\}/g) ?? []) {
    assert.ok(!handler.includes('setFilters'), `mode switch also resets filters: ${handler}`);
  }
  assert.match(HOME, /setTab\(key\)/);
});

test('search stays visible in both modes — the input is not gated on the feed mode', () => {
  assert.ok(!MODE_BLOCK.includes('TextInput'));
  assert.ok(!FILTER_BLOCK.includes('TextInput'), 'search must not be inside the All-only block');
  assert.match(HOME, /accessibilityLabel="Search recalls"/);
});

test('the Affects me context row explains scope without instructing or duplicating logic', () => {
  assert.match(HOME, /Based on your personalization/);
  assert.match(HOME, /tab === 'affects_me' && showTabs \?/);
  // It links to the one existing personalization screen; no preference state.
  // P2A split the combined settings screen, so the link is now the specific
  // personalization page rather than the page that held both.
  assert.match(HOME, /<Link href="\/settings\/personalization" asChild>/);
  assert.ok(!HOME.includes('savePreferences'));
});

// ── Behaviour: the two levels stay independent ───────────────────────────────

function geo(scope: Geography['scope'], states: string[] = []): Geography {
  return { scope, states, confidence: 'stated', sourceText: null };
}

let counter = 0;
function item(overrides: Partial<FeedItem> = {}): FeedItem {
  counter += 1;
  return {
    id: `ctl-${String(counter).padStart(3, '0')}`,
    sourceAgency: 'FSIS',
    noticeType: 'recall',
    state: 'active',
    title: `Control case ${counter}`,
    classification: {
      value: 'class_I',
      sourceText: 'Class I',
      officialClasses: ['class_I'],
    } as FeedItem['classification'],
    hazardCategory: 'unknown',
    publishedAt: '2026-08-20',
    lastPublicActivityAt: '2026-08-20',
    reasonText: null,
    pathogenOrAllergen: null,
    firmName: null,
    brands: [],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    productNames: [],
    geography: geo('unknown'),
    officialUrl: 'https://example.gov',
    timeline: [],
    ...overrides,
  };
}

const PREFS = { state: 'CA', allergens: [], retailers: [] };
const NOW = new Date('2026-08-28T12:00:00Z');

function affectsMe(corpus: FeedItem[]) {
  return buildAffectsMeSections(
    corpus,
    (candidate) =>
      evaluatePersonalRelevance(
        {
          geography: candidate.geography,
          pathogenOrAllergen: candidate.pathogenOrAllergen,
          retailerNames: candidate.retailerNames,
          hazardCategory: candidate.hazardCategory,
          reasonText: candidate.reasonText,
        },
        PREFS,
      ),
    { now: NOW },
  );
}

test('Home ranks Affects me over the COMPLETE corpus, never the filtered list', () => {
  // The pipeline variable `allVisible` is All-Recalls-only; the Affects me
  // branch reads `state.items`. This is what makes preserved filters inert.
  assert.match(HOME, /buildAffectsMeSections\(state\.items,/);
  assert.ok(!/buildAffectsMeSections\(allVisible/.test(HOME));
  assert.ok(!/orderByLocationTiers\(ranked\./.test(HOME));
});

test('filters preserved while in Affects me do not change its results or ranking', () => {
  const corpus = [
    item({ geography: geo('states', ['California']) }),
    item({ geography: geo('nationwide') }),
    item({
      geography: geo('states', ['California']),
      classification: {
        value: 'class_III',
        sourceText: 'Class III',
        officialClasses: ['class_III'],
      } as FeedItem['classification'],
    }),
    item({ geography: geo('states', ['Maine']) }),
  ];
  const baseline = affectsMe(corpus);

  // A Location+Risk selection that would drastically narrow All Recalls…
  const active: FeedFilterState = { stateCodes: ['TX'], riskTiers: ['minimal'], categoryIds: [] };
  assert.notDeepEqual(
    applyFeedFilters(corpus, active).map((entry) => entry.id),
    corpus.map((entry) => entry.id),
    'precondition: these filters really do change All Recalls',
  );
  // …leaves Affects me byte-identical, because it never sees them.
  const afterSwitch = affectsMe(corpus);
  assert.deepEqual(
    afterSwitch.affects.map((entry) => entry.id),
    baseline.affects.map((entry) => entry.id),
  );
  assert.deepEqual(
    afterSwitch.older.map((entry) => entry.id),
    baseline.older.map((entry) => entry.id),
  );
});

test('search still narrows each mode independently of the other', () => {
  const corpus = [
    item({ geography: geo('states', ['California']), title: 'Peanut Bars' }),
    item({ geography: geo('states', ['California']), title: 'Cheese Wheels' }),
    item({ geography: geo('states', ['Maine']), title: 'Peanut Clusters' }),
  ];
  // All: filters then search.
  const all = filterBySearch(
    applyFeedFilters(corpus, { stateCodes: ['CA'], riskTiers: [], categoryIds: [] }),
    'peanut',
    buildSearchEntry,
  );
  assert.deepEqual(
    all.map((entry) => entry.title),
    ['Peanut Bars'],
  );
  // Affects me: search over the eligible ranked set only — the Maine notice
  // matches the text but is not eligible, so it cannot appear.
  const ranked = affectsMe(corpus);
  const personal = filterBySearch([...ranked.affects, ...ranked.older], 'peanut', buildSearchEntry);
  assert.deepEqual(
    personal.map((entry) => entry.title),
    ['Peanut Bars'],
  );
});

test('clearing filters returns All Recalls to its untouched baseline', () => {
  const corpus = [item({ geography: geo('states', ['California']) }), item()];
  assert.equal(applyFeedFilters(corpus, EMPTY_FEED_FILTERS), corpus);
});

// ── Scroll position on filter change (C10B closure) ─────────────────────────
//
// Applying a filter swaps the result set underneath a scroll offset measured
// against the OLD one, leaving the reader deep inside a different list. The
// decision of WHETHER that happened is pure and is tested as such; the wiring
// that acts on it is pinned against the Home source, the same way the rest of
// this file pins render guards. There is no React renderer in this suite and
// this behaviour does not justify introducing one.

const filterState = (overrides: Partial<FeedFilterState> = {}): FeedFilterState => ({
  ...EMPTY_FEED_FILTERS,
  ...overrides,
});

test('an unchanged selection is not a change, in any dimension', () => {
  for (const applied of [
    filterState(),
    filterState({ stateCodes: ['CA'] }),
    filterState({ riskTiers: ['critical'] }),
    filterState({ categoryIds: ['produce'] }),
    filterState({ stateCodes: ['CA', 'TX'], riskTiers: ['high'], categoryIds: ['seafood'] }),
  ]) {
    assert.equal(sameFeedFilters(applied, { ...applied }), true);
  }
});

test('reselecting the same jurisdictions in a different order is not a change', () => {
  // The sheet builds its draft by toggling, so deselecting California and
  // reselecting it applies ['TX','CA'] where ['CA','TX'] stood. Same filter,
  // same results — the reader must not be thrown back to the top for it.
  assert.equal(
    sameFeedFilters(
      filterState({ stateCodes: ['CA', 'TX'] }),
      filterState({ stateCodes: ['TX', 'CA'] }),
    ),
    true,
  );
  assert.equal(
    sameFeedFilters(
      filterState({ riskTiers: ['critical', 'high'] }),
      filterState({ riskTiers: ['high', 'critical'] }),
    ),
    true,
  );
});

test('a real change in any one dimension is a change', () => {
  const base = filterState({
    stateCodes: ['CA'],
    riskTiers: ['critical'],
    categoryIds: ['produce'],
  });
  assert.equal(sameFeedFilters(base, { ...base, stateCodes: ['TX'] }), false);
  assert.equal(sameFeedFilters(base, { ...base, riskTiers: ['low'] }), false);
  assert.equal(sameFeedFilters(base, { ...base, categoryIds: ['meat_poultry'] }), false);
  // Swapping one category for another — the exact reported case.
  assert.equal(
    sameFeedFilters(
      filterState({ categoryIds: ['produce'] }),
      filterState({ categoryIds: ['meat_poultry'] }),
    ),
    false,
  );
});

test('adding to, removing from, and clearing a dimension are all changes', () => {
  const one = filterState({ categoryIds: ['produce'] });
  assert.equal(sameFeedFilters(one, filterState({ categoryIds: ['produce', 'seafood'] })), false);
  assert.equal(sameFeedFilters(filterState({ categoryIds: ['produce', 'seafood'] }), one), false);
  assert.equal(sameFeedFilters(one, EMPTY_FEED_FILTERS), false);
  assert.equal(sameFeedFilters(EMPTY_FEED_FILTERS, one), false);
});

test('Home scrolls to top only from the two explicit filter-change paths', () => {
  const block = region('SCROLL POSITION ON FILTER CHANGE', 'END SCROLL POSITION ON FILTER CHANGE');
  // The mechanism: a ref on the existing SectionList, and the documented
  // ScrollView handle — not a second list, not a new scroll abstraction.
  assert.ok(block.includes('useRef<SectionList'), 'scroll reset must use the existing list ref');
  assert.ok(block.includes('getScrollResponder()'), 'expected the documented ScrollView handle');
  assert.ok(HOME.includes('ref={listRef}'), 'the ref must be attached to the rendered list');

  // Both explicit paths guard on a real change before scrolling.
  assert.ok(block.includes('if (sameFeedFilters(filters, updated)) return;'));
  assert.ok(block.includes('if (!hasActiveFilters(filters)) return;'));
  // Exactly two call sites: the Apply path and the Clear all path.
  assert.equal(block.match(/scrollFeedToTop\(\);/g)?.length, 2, 'apply + clear all only');
  assert.equal(HOME.match(/scrollFeedToTop\(\);/g)?.length, 2, 'no third caller anywhere');

  // Clear all goes through the guarded handler, never a bare setFilters.
  assert.ok(HOME.includes('onPress={clearAllFilters}'));
  assert.ok(
    !/onPress=\{\(\) => setFilters\(EMPTY_FEED_FILTERS\)\}/.test(HOME),
    'Clear all must not bypass the change guard',
  );
});

test('nothing outside an explicit filter change can move the reading position', () => {
  // The exclusion list, asserted structurally. Each of these legitimately
  // rerenders the list while the reader is mid-feed, and none may scroll.
  for (const [handler, why] of [
    ['setShowOlder', 'expanding/collapsing Older Active Notices'],
    ['setOpenSheet(null)', 'closing or cancelling a sheet'],
    ['setQuery', 'typing in search'],
    ['onRefresh', 'background/pull-to-refresh'],
  ] as const) {
    for (const after of HOME.split(handler).slice(1)) {
      assert.ok(!after.slice(0, 160).includes('scrollFeedToTop'), `${why} must not reset scroll`);
    }
  }

  // The feed-mode segmented control switches All ↔ Affects me without ever
  // touching the scroll position. (Applying a filter FROM Affects me does
  // switch to All and does scroll — but that is a filter change, and it lives
  // in the filter-change block, not here.)
  assert.ok(!MODE_BLOCK.includes('scrollFeedToTop'), 'mode switching must not reset scroll');

  // Pull-to-refresh and pagination reach the list through the sync engine,
  // never through the scroll handle.
  for (const after of HOME.split('revalidate').slice(1)) {
    assert.ok(!after.slice(0, 160).includes('scrollFeedToTop'), 'a refresh must not reset scroll');
  }

  // And the reset is not wired to an effect, which is how "ordinary rerender"
  // and "returning from the detail screen" would start resetting it.
  assert.ok(!/useEffect\([^)]*scrollFeedToTop/s.test(HOME));
  assert.ok(!/useFocusEffect\([^)]*scrollFeedToTop/s.test(HOME));
});
