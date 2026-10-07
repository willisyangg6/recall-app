/**
 * The control hierarchy on Home. Feed MODE (All / Affects me) is a separate
 * level from the refinement filters (C6.1). Since the Feed + Filters design
 * (2026-10-06, founder decision) the filters are no longer All-only: ONE
 * Filters control opens one sheet on both feeds, each feed keeps its OWN
 * selection, and in Affects me the filters only narrow the already-eligible,
 * already-ranked list.
 *
 * The structural half is asserted against the screen source, the same way the
 * workflow and profile contracts are pinned: there is no React renderer in
 * this suite. The behavioural half is asserted against the real pure
 * functions.
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

// ── Structural separation ────────────────────────────────────────────────────

test('the feed-mode control is its own block, holding only the two scopes', () => {
  assert.match(MODE_BLOCK, /<FeedTabs tab=\{tab\} onChange=\{setTab\} \/>/);
  assert.match(HOME, /label: 'All recalls'/);
  assert.match(HOME, /label: 'Affects you'/);
  // Refinement controls may not live in the scope control.
  for (const filterOnly of ['openFilters', 'Clear all', 'filtersByTab', 'stateCodes']) {
    assert.ok(!MODE_BLOCK.includes(filterOnly), `mode control contains ${filterOnly}`);
  }
});

test('one Filters control serves both feeds, and each feed keeps its own selection', () => {
  // Two independent selections, keyed by feed; the screen reads the open one.
  assert.match(
    HOME,
    /useState<Record<FeedTab, FeedFilterState>>\(\{\s*all: EMPTY_FEED_FILTERS,\s*affects_me: EMPTY_FEED_FILTERS,\s*\}\)/,
  );
  assert.ok(HOME.includes('const filters = filtersByTab[tab];'));
  // Apply writes ONLY the open feed's entry, and never switches the feed.
  assert.ok(HOME.includes('setFiltersByTab((prior) => ({ ...prior, [tab]: next }));'));
  const apply = HOME.slice(HOME.indexOf('const applyFilters = useCallback('));
  assert.ok(!apply.slice(0, 600).includes('setTab('), 'applying a filter switches the feed');
  // Offered wherever there is a list to narrow: All, and a configured Affects me.
  assert.ok(HOME.includes("const filtersAvailable = tab === 'all' || personalized;"));
  assert.equal((HOME.match(/<FiltersButton\b/g) ?? []).length, 1);
  assert.equal((HOME.match(/<FiltersSheet\b/g) ?? []).length, 1);
});

test('the rejected instructional sentence is gone from Home entirely', () => {
  assert.ok(!HOME.includes('selections kept'));
  assert.ok(!HOME.includes('Location/Risk filters apply to All recalls'));
});

test('filters change only through the guarded Apply path; leaving the sheet discards', () => {
  // The single write path is `applyFilters`: the sheet's Apply, and Affects
  // you's "Clear filters" empty-state action, which applies the empty set.
  // Close / backdrop / back only close.
  assert.ok(HOME.includes('onApply={applyFilters}'));
  assert.ok(HOME.includes('onClear={() => applyFilters(EMPTY_FEED_FILTERS)}'));
  assert.ok(HOME.includes('onClose={() => setSheetOpen(false)}'));
  assert.equal((HOME.match(/setFiltersByTab\(/g) ?? []).length, 1);
  // The previous chip row and its per-dimension sheets are gone.
  for (const gone of ['setOpenSheet', 'clearAllFilters', '<Chip']) {
    assert.ok(!HOME.includes(gone), `Home still contains ${gone}`);
  }
});

test('switching feed mode never clears either feed’s filter selection', () => {
  // The mode switch is `setTab` alone; nothing on that path touches filters.
  assert.match(HOME, /onChange=\{setTab\}/);
  for (const handler of HOME.match(/onPress=\{\(\) => onChange\([^)]*\)\}/g) ?? []) {
    assert.ok(!handler.includes('setFiltersByTab'), `mode switch also resets filters: ${handler}`);
  }
});

test('search stays visible in both modes — the input is not gated on the feed mode', () => {
  assert.ok(!MODE_BLOCK.includes('TextInput'));
  assert.ok(!MODE_BLOCK.includes('<SearchBar'));
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
    fdaOngoingAsOf: null,
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

const PREFS = { states: ['CA'], allergens: [], retailers: [] };
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

test('Home ranks Affects me over the COMPLETE corpus, never a filtered list', () => {
  // Eligibility and ranking read `state.items`; the All feed's filtered list
  // (`allVisible`) never reaches them, and Affects me's own filters apply to
  // the RANKED sections afterwards.
  assert.match(HOME, /buildAffectsMeSections\(state\.items,/);
  assert.ok(!/buildAffectsMeSections\(allVisible/.test(HOME));
  assert.ok(!/buildAffectsMeSections\(applyFeedFilters/.test(HOME));
  assert.ok(HOME.includes('applyFeedFilters(ranked.affects, filters)'));
  assert.ok(HOME.includes('applyFeedFilters(ranked.older, filters)'));
});

test('the All feed’s filters never reach Affects me', () => {
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
  // A selection that would drastically narrow All Recalls…
  const allFilters: FeedFilterState = { stateCodes: ['TX'], riskTiers: ['low'], categoryIds: [] };
  assert.notDeepEqual(
    applyFeedFilters(corpus, allFilters).map((entry) => entry.id),
    corpus.map((entry) => entry.id),
    'precondition: these filters really do change All Recalls',
  );
  // …leaves Affects me byte-identical: its own selection is empty.
  const affectsOwn = EMPTY_FEED_FILTERS;
  const after = affectsMe(corpus);
  assert.deepEqual(
    applyFeedFilters(after.affects, affectsOwn).map((entry) => entry.id),
    baseline.affects.map((entry) => entry.id),
  );
  assert.deepEqual(
    applyFeedFilters(after.older, affectsOwn).map((entry) => entry.id),
    baseline.older.map((entry) => entry.id),
  );
});

test('Affects me’s own filters narrow its ranked list: no new match, no re-ranking', () => {
  const corpus = [
    item({
      geography: geo('states', ['California']),
      publishedAt: '2026-08-25',
      lastPublicActivityAt: '2026-08-25',
    }),
    item({
      geography: geo('nationwide'),
      publishedAt: '2026-08-24',
      lastPublicActivityAt: '2026-08-24',
    }),
    item({
      geography: geo('states', ['California']),
      publishedAt: '2026-08-23',
      lastPublicActivityAt: '2026-08-23',
      classification: {
        value: 'class_II',
        sourceText: 'Class II',
        officialClasses: ['class_II'],
      } as FeedItem['classification'],
    }),
    // Not eligible (Maine only) but Critical: a Critical filter must not add it.
    item({
      geography: geo('states', ['Maine']),
      publishedAt: '2026-08-26',
      lastPublicActivityAt: '2026-08-26',
    }),
  ];
  const ranked = affectsMe(corpus);
  const eligible = new Set([...ranked.affects, ...ranked.older].map((entry) => entry.id));
  const critical: FeedFilterState = { stateCodes: [], riskTiers: ['critical'], categoryIds: [] };
  const narrowed = applyFeedFilters(ranked.affects, critical);
  // Every survivor was already eligible…
  for (const entry of narrowed) assert.ok(eligible.has(entry.id), `${entry.id} became eligible`);
  // …and the survivors keep the ranked order (a subsequence of it).
  const order = ranked.affects.map((entry) => entry.id);
  const positions = narrowed.map((entry) => order.indexOf(entry.id));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
  // The Class II recall is gone; the Critical ones stay.
  assert.ok(narrowed.length < ranked.affects.length);
  assert.ok(!narrowed.some((entry) => entry.classification.value === 'class_II'));
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

test('Home scrolls to top only from the one explicit filter-change path', () => {
  const block = region('SCROLL POSITION ON FILTER CHANGE', 'END SCROLL POSITION ON FILTER CHANGE');
  // The mechanism: a ref on the existing SectionList, and the documented
  // ScrollView handle — not a second list, not a new scroll abstraction.
  assert.ok(block.includes('useRef<SectionList'), 'scroll reset must use the existing list ref');
  assert.ok(block.includes('getScrollResponder()'), 'expected the documented ScrollView handle');
  assert.ok(HOME.includes('ref={listRef}'), 'the ref must be attached to the rendered list');

  // The one explicit path guards on a real change before scrolling. Since
  // 2026-10-06 Clear all edits the sheet's draft, so it too reaches the list
  // only through Apply — one call site.
  assert.ok(block.includes('if (sameFeedFilters(filters, next)) return;'));
  assert.equal(block.match(/scrollFeedToTop\(\);/g)?.length, 1, 'apply only');
  assert.equal(HOME.match(/scrollFeedToTop\(\);/g)?.length, 1, 'no second caller anywhere');
});

test('nothing outside an explicit filter change can move the reading position', () => {
  // The exclusion list, asserted structurally. Each of these legitimately
  // rerenders the list while the reader is mid-feed, and none may scroll.
  for (const [handler, why] of [
    ['setShowOlder', 'expanding/collapsing Older Active Notices'],
    ['setSheetOpen(false)', 'closing or dismissing the sheet'],
    ['setQuery', 'typing in search'],
    ['onRefresh', 'background/pull-to-refresh'],
  ] as const) {
    for (const after of HOME.split(handler).slice(1)) {
      assert.ok(!after.slice(0, 160).includes('scrollFeedToTop'), `${why} must not reset scroll`);
    }
  }

  // The feed-mode control switches All ↔ Affects me without ever touching
  // the scroll position.
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

test('Affects you’s filtered-empty state clears its own filters, never pointing at the national feed', () => {
  // Its own copy, not All recalls' "Clear all to see the complete feed": on
  // Affects you clearing filters restores the MATCHING recalls.
  assert.match(
    HOME,
    /personalized && filtersActive && !searchActive \?\s*\(\s*<AffectsFilteredEmpty onClear=\{\(\) => applyFilters\(EMPTY_FEED_FILTERS\)\} \/>/,
  );
  const COPY = readFileSync(join(__dirname, 'feed-copy.ts'), 'utf8');
  assert.ok(COPY.includes("title: 'No recalls match these filters.',"));
  assert.ok(COPY.includes("action: 'Clear filters',"));
  // All recalls keeps its own, accurate sentence.
  assert.ok(COPY.includes('Clear all to see the complete feed.'));
});

test('the Feed shows the approved tab names everywhere it names a feed', () => {
  // Founder decision, 2026-10-06: the tabs, the personalized section heading
  // and the Feed's own instructions all say "All recalls" / "Affects you".
  // Internal ids and APIs (affects_me, buildAffectsMeSections) are unchanged.
  assert.ok(HOME.includes("title: 'Affects you', data: affects"));
  assert.ok(!/title: 'Affects me'/.test(HOME));
  const COPY = readFileSync(join(__dirname, 'feed-copy.ts'), 'utf8');
  assert.ok(COPY.includes('Switch to All recalls to see every current recall.'));
  assert.ok(COPY.includes('to see matching recalls in Affects you.'));
  assert.ok(!/'[^']*\bAffects me\b[^']*'/.test(COPY), 'feed copy still names "Affects me"');
  assert.ok(!COPY.includes('Switch to All to'));
});
