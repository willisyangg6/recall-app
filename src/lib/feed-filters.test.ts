import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Geography } from '@/domain/recall-types';
import { RISK_TIER_RANK } from '@/domain/risk-tier';
import { buildAffectsMeSections } from './affects-me-ranking';
import {
  activeFilterCount,
  applyFeedFilters,
  EMPTY_FEED_FILTERS,
  hasActiveFilters,
  locationMatchTier,
  matchesLocationFilter,
  matchesRiskFilter,
  RISK_FILTER_TIERS,
  type FeedFilterState,
} from './feed-filters';
import { buildFeedSections } from './feed-relevance';
import { buildSearchEntry, filterBySearch } from './feed-search';
import type { FeedItem } from './recall-feed';
import { sortNewestFirst } from './recency-order';
import { evaluatePersonalRelevance } from './relevance';

function geo(scope: Geography['scope'], states: string[] = []): Geography {
  return { scope, states, confidence: 'stated', sourceText: null };
}

function classified(value: 'class_I' | 'class_II' | 'class_III'): FeedItem['classification'] {
  return { value, sourceText: value, officialClasses: [value] } as FeedItem['classification'];
}

let counter = 0;
function item(overrides: Partial<FeedItem> = {}): FeedItem {
  counter += 1;
  return {
    id: `case-${String(counter).padStart(3, '0')}`,
    sourceAgency: 'FSIS',
    noticeType: 'recall',
    state: 'active',
    title: `Test recall ${counter}`,
    classification: classified('class_I'),
    hazardCategory: 'unknown',
    publishedAt: '2026-08-17',
    lastPublicActivityAt: '2026-08-17',
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

function filters(overrides: Partial<FeedFilterState>): FeedFilterState {
  return { ...EMPTY_FEED_FILTERS, ...overrides };
}

// ── Location semantics ───────────────────────────────────────────────────────

test('a selected state includes explicit matches and nationwide notices', () => {
  assert.equal(matchesLocationFilter(geo('states', ['California']), ['CA']), true);
  assert.equal(matchesLocationFilter(geo('nationwide'), ['CA']), true);
});

test('explicitly excluded geography does not match', () => {
  assert.equal(matchesLocationFilter(geo('states', ['Maine', 'Vermont']), ['CA']), false);
});

test('unknown geography never silently matches a state filter', () => {
  assert.equal(matchesLocationFilter(geo('unknown'), ['CA']), false);
});

test('multiple selected jurisdictions OR together', () => {
  const texasOnly = geo('states', ['Texas']);
  assert.equal(matchesLocationFilter(texasOnly, ['CA', 'TX']), true);
  assert.equal(matchesLocationFilter(texasOnly, ['CA', 'NY']), false);
  // DC and PR are first-class jurisdictions, same vocabulary as geography.
  assert.equal(matchesLocationFilter(geo('states', ['Puerto Rico']), ['PR']), true);
});

test('an empty location selection matches everything, including unknown', () => {
  assert.equal(matchesLocationFilter(geo('unknown'), []), true);
});

// ── Risk semantics ───────────────────────────────────────────────────────────

test('risk filtering uses the canonical tiers, never collapsing the non-scale states', () => {
  const pha = {
    value: 'not_applicable_pha',
    sourceText: null,
    officialClasses: [],
  } as unknown as FeedItem['classification'];
  const pending = {
    value: 'not_yet_classified',
    sourceText: null,
    officialClasses: [],
  } as unknown as FeedItem['classification'];
  const unsupported = {
    value: 'unclassified',
    sourceText: null,
    officialClasses: [],
  } as unknown as FeedItem['classification'];

  assert.equal(matchesRiskFilter(classified('class_I'), ['critical']), true);
  assert.equal(matchesRiskFilter(classified('class_II'), ['critical']), false);
  assert.equal(matchesRiskFilter(classified('class_II'), ['critical', 'high']), true);
  // Pending and Unknown are their own levels — selectable, never absorbed.
  assert.equal(matchesRiskFilter(pending, ['pending']), true);
  assert.equal(matchesRiskFilter(pending, ['high']), false);
  assert.equal(matchesRiskFilter(pha, ['unknown']), true);
  assert.equal(matchesRiskFilter(pha, ['pending']), false);
  // A value outside the supported vocabulary is Unknown, never quietly
  // Pending: the filter must not promise a classification is on its way.
  assert.equal(matchesRiskFilter(unsupported, ['unknown']), true);
  assert.equal(matchesRiskFilter(unsupported, ['pending']), false);
});

test('the sheet vocabulary is exactly the seven canonical tiers', () => {
  assert.deepEqual([...RISK_FILTER_TIERS].sort(), Object.keys(RISK_TIER_RANK).sort());
});

// ── Composition ──────────────────────────────────────────────────────────────

test('dimensions AND together: (CA OR TX) AND (Critical OR Very High)', () => {
  const caCritical = item({ geography: geo('states', ['California']) });
  const caLow = item({
    geography: geo('states', ['California']),
    classification: classified('class_III'),
  });
  const nyCritical = item({ geography: geo('states', ['New York']) });
  const nationwideVeryHigh = item({
    geography: geo('nationwide'),
    classification: {
      value: 'class_I',
      sourceText: null,
      officialClasses: ['class_I', 'class_II'],
    } as FeedItem['classification'],
  });
  const corpus = [caCritical, caLow, nyCritical, nationwideVeryHigh];
  const result = applyFeedFilters(
    corpus,
    filters({ stateCodes: ['CA', 'TX'], riskTiers: ['critical', 'very_high'] }),
  );
  assert.deepEqual(
    result.map((entry) => entry.id),
    [caCritical.id, nationwideVeryHigh.id],
  );
  // The loaded corpus is untouched: same length, same members, same order.
  assert.equal(corpus.length, 4);
  assert.deepEqual(
    corpus.map((entry) => entry.id),
    [caCritical.id, caLow.id, nyCritical.id, nationwideVeryHigh.id],
  );
});

test('clearing filters restores baseline output — the SAME array instance', () => {
  const corpus = [item(), item(), item()];
  assert.equal(applyFeedFilters(corpus, EMPTY_FEED_FILTERS), corpus);
  assert.equal(hasActiveFilters(EMPTY_FEED_FILTERS), false);
  assert.equal(activeFilterCount(filters({ stateCodes: ['CA'], riskTiers: ['high'] })), 2);
});

test('All Recalls with no filters and empty search deep-equals its current sectioning', () => {
  const corpus = [
    item({ publishedAt: '2026-08-20', lastPublicActivityAt: '2026-08-20' }),
    item({ publishedAt: '2025-01-01', lastPublicActivityAt: '2025-01-01' }),
    item({ publishedAt: '2026-08-25', lastPublicActivityAt: '2026-08-26' }),
  ];
  const now = new Date('2026-08-28T12:00:00Z');
  const baseline = buildFeedSections(corpus, now);
  const throughPipeline = buildFeedSections(
    filterBySearch(applyFeedFilters(corpus, EMPTY_FEED_FILTERS), '', buildSearchEntry),
    now,
  );
  assert.deepEqual(throughPipeline, baseline);
});

test('search composes with filters: filter first, then search the survivors', () => {
  const caPeanut = item({
    geography: geo('states', ['California']),
    title: 'Peanut Butter Cups',
  });
  const nyPeanut = item({ geography: geo('states', ['New York']), title: 'Peanut Brittle' });
  const caCheese = item({ geography: geo('states', ['California']), title: 'Cheese Dip' });
  const corpus = [caPeanut, nyPeanut, caCheese];
  const visible = filterBySearch(
    applyFeedFilters(corpus, filters({ stateCodes: ['CA'] })),
    'peanut',
    buildSearchEntry,
  );
  assert.deepEqual(
    visible.map((entry) => entry.id),
    [caPeanut.id],
  );
});

// ── Location filtering keeps the ONE shared order (2026-10-05) ───────────────

const NOW = new Date('2026-08-28T12:00:00Z');

/** The real Home pipeline for a filtered All Recalls: filter → section. Nothing else. */
function visibleAllRecalls(
  corpus: FeedItem[],
  stateCodes: string[],
): { recent: string[]; older: string[] } {
  const sectioned = buildFeedSections(applyFeedFilters(corpus, filters({ stateCodes })), NOW);
  return {
    recent: sectioned.recent.map((entry) => entry.id),
    older: sectioned.olderActive.map((entry) => entry.id),
  };
}

/** Recent-tier item: announced inside the 60-day window unless overridden. */
function recentItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return item({ publishedAt: '2026-08-10', lastPublicActivityAt: '2026-08-10', ...overrides });
}

/** Announced on `day` — the date the shared newest-first order reads. */
function announced(day: string): Pick<FeedItem, 'publishedAt' | 'lastPublicActivityAt'> {
  return { publishedAt: day, lastPublicActivityAt: day };
}

test('a newer nationwide recall precedes an older explicit selected-state match', () => {
  // The founder's rule: one newest-first order across ALL qualifying results.
  // The C6.1 location tier that led with explicit matches is gone.
  const caOld = recentItem({
    geography: geo('states', ['California']),
    ...announced('2026-08-02'),
  });
  const nationalNew = recentItem({ geography: geo('nationwide'), ...announced('2026-08-27') });
  assert.deepEqual(visibleAllRecalls([caOld, nationalNew], ['CA']).recent, [
    nationalNew.id,
    caOld.id,
  ]);
  // And in the other direction the explicit match leads only because it is newer.
  const caNew = recentItem({
    geography: geo('states', ['California']),
    ...announced('2026-08-27'),
  });
  const nationalOld = recentItem({ geography: geo('nationwide'), ...announced('2026-08-02') });
  assert.deepEqual(visibleAllRecalls([nationalOld, caNew], ['CA']).recent, [
    caNew.id,
    nationalOld.id,
  ]);
});

test('explicit and nationwide matches interleave purely by date; list length and risk weigh nothing', () => {
  const caOnly = recentItem({
    geography: geo('states', ['California']),
    ...announced('2026-08-05'),
  });
  const caTx = recentItem({
    geography: geo('states', ['California', 'Texas', 'Nevada', 'Oregon']),
    ...announced('2026-08-20'),
  });
  const nationalMid = recentItem({ geography: geo('nationwide'), ...announced('2026-08-12') });
  const nationalCritical = recentItem({
    geography: geo('nationwide'),
    classification: classified('class_I'),
    ...announced('2026-08-01'),
  });
  const caLowNewest = recentItem({
    geography: geo('states', ['California']),
    classification: classified('class_III'),
    ...announced('2026-08-25'),
  });
  const corpus = [caOnly, caTx, nationalMid, nationalCritical, caLowNewest];
  assert.deepEqual(visibleAllRecalls(corpus, ['CA']).recent, [
    caLowNewest.id,
    caTx.id,
    nationalMid.id,
    caOnly.id,
    nationalCritical.id,
  ]);
  // Exactly the shared comparator over the admitted set.
  assert.deepEqual(
    visibleAllRecalls(corpus, ['CA']).recent,
    sortNewestFirst(corpus).map((entry) => entry.id),
  );
});

test('equal dates fall to the id tie-break, whatever the geography', () => {
  const tiedA = recentItem({ geography: geo('states', ['California']) });
  const tiedB = recentItem({ geography: geo('nationwide') });
  const tiedC = recentItem({ geography: geo('states', ['California', 'Texas']) });
  const [first, second, third] = [tiedA.id, tiedB.id, tiedC.id].sort();
  assert.deepEqual(visibleAllRecalls([tiedC, tiedB, tiedA], ['CA']).recent, [first, second, third]);
});

test('with several jurisdictions selected, an explicit match to EITHER is admitted', () => {
  const ca = recentItem({ geography: geo('states', ['California']), ...announced('2026-08-20') });
  const tx = recentItem({ geography: geo('states', ['Texas']), ...announced('2026-08-21') });
  const national = recentItem({ geography: geo('nationwide'), ...announced('2026-08-22') });
  const visible = visibleAllRecalls([national, ca, tx], ['CA', 'TX']).recent;
  assert.deepEqual(visible, [national.id, tx.id, ca.id]);
});

test('unknown and unselected geography stay excluded, so they never appear at all', () => {
  const unknown = recentItem({ geography: geo('unknown') });
  const maine = recentItem({ geography: geo('states', ['Maine']) });
  const ca = recentItem({ geography: geo('states', ['California']) });
  assert.deepEqual(visibleAllRecalls([unknown, maine, ca], ['CA']).recent, [ca.id]);
  assert.equal(locationMatchTier(geo('unknown'), ['CA']), null);
  assert.equal(locationMatchTier(geo('states', ['Maine']), ['CA']), null);
  assert.equal(locationMatchTier(geo('states', ['California', 'Maine']), ['CA']), 0);
  assert.equal(locationMatchTier(geo('nationwide'), ['CA']), 1);
});

test('filtering never moves a notice between sections', () => {
  // An old explicit California match stays in Older active notices; it is not
  // promoted into Recent activity by matching the selected location.
  const oldCa = item({ geography: geo('states', ['California']), ...announced('2024-01-05') });
  const recentNational = recentItem({ geography: geo('nationwide') });
  const visible = visibleAllRecalls([oldCa, recentNational], ['CA']);
  assert.deepEqual(visible.recent, [recentNational.id]);
  assert.deepEqual(visible.older, [oldCa.id]);
});

test('with no jurisdiction selected the sections are byte-identical to the unfiltered feed', () => {
  const corpus = [
    recentItem({ geography: geo('nationwide'), ...announced('2026-08-11') }),
    recentItem({ geography: geo('states', ['California']), ...announced('2026-08-19') }),
    recentItem({ geography: geo('unknown'), ...announced('2026-08-15') }),
  ];
  assert.equal(applyFeedFilters(corpus, EMPTY_FEED_FILTERS), corpus);
  assert.deepEqual(
    buildFeedSections(applyFeedFilters(corpus, EMPTY_FEED_FILTERS), NOW),
    buildFeedSections(corpus, NOW),
  );
  // Risk-only filtering likewise leaves ordering to the shared comparator.
  const riskOnly = buildFeedSections(
    applyFeedFilters(corpus, filters({ riskTiers: ['critical'] })),
    NOW,
  );
  assert.deepEqual(
    riskOnly.recent.map((entry) => entry.id),
    sortNewestFirst(corpus.filter((entry) => entry.classification.value === 'class_I')).map(
      (entry) => entry.id,
    ),
  );
});

test('filtering never mutates the source list', () => {
  const corpus = [
    recentItem({ geography: geo('nationwide'), ...announced('2026-08-01') }),
    recentItem({ geography: geo('states', ['California']), ...announced('2026-08-20') }),
  ];
  const before = corpus.map((entry) => entry.id);
  const filtered = applyFeedFilters(corpus, filters({ stateCodes: ['CA'] }));
  buildFeedSections(filtered, NOW);
  assert.notEqual(filtered, corpus, 'an active filter derives a new array');
  assert.deepEqual(
    corpus.map((entry) => entry.id),
    before,
  );
});

test('search filters the located results without reordering them', () => {
  const caA = recentItem({
    geography: geo('states', ['California']),
    title: 'Peanut Alpha',
    ...announced('2026-08-09'),
  });
  const national = recentItem({
    geography: geo('nationwide'),
    title: 'Peanut National',
    ...announced('2026-08-21'),
  });
  const caB = recentItem({
    geography: geo('states', ['California']),
    title: 'Cheese Beta',
    ...announced('2026-08-15'),
  });
  const filtered = applyFeedFilters([national, caA, caB], filters({ stateCodes: ['CA'] }));
  const ordered = buildFeedSections(filtered, NOW).recent;
  const searched = filterBySearch(ordered, 'peanut', buildSearchEntry);
  // Same relative order as the sectioned list, minus the non-matches.
  assert.deepEqual(
    searched.map((entry) => entry.id),
    ordered.filter((entry) => entry.title.includes('Peanut')).map((entry) => entry.id),
  );
  assert.equal(searched[0].id, national.id, 'the newer nationwide notice leads after search');
});

test('the filter module holds no ordering at all (2026-10-05)', () => {
  // Severity left ordering everywhere, and the location tier followed: a
  // filtered view keeps the sections' shared order. A sort in this module
  // would be one decision applied to one surface.
  const source = readFileSync(join(__dirname, 'feed-filters.ts'), 'utf8');
  // (`sameSelection` sorts two SELECTIONS to compare them; no recall list is
  // ever sorted here.)
  assert.doesNotMatch(
    source,
    /orderByLocationTiers|tierA - tierB|locationMatchTier\(a\.|RISK_PRIORITY|consumerRiskTier\(a/,
  );
  assert.doesNotMatch(source, /items\]\.sort|\.sort\(\(a, b\)/);
  assert.doesNotMatch(source, /from '\.\/affects-me-ranking'|from '\.\/recency-order'/);
  const home = readFileSync(join(__dirname, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
  assert.doesNotMatch(home, /orderByLocationTiers/);
});

// ── Affects Me boundaries ────────────────────────────────────────────────────

test('search within Affects me narrows the eligible ranked set and cannot surface an ineligible notice', () => {
  const prefs = { states: ['CA'], allergens: [], retailers: [] };
  const eligible = item({ geography: geo('states', ['California']), title: 'Peanut Crunch Bars' });
  const ineligible = item({ geography: geo('states', ['Maine']), title: 'Peanut Snack Mix' });
  const corpus = [eligible, ineligible];

  const ranked = buildAffectsMeSections(
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
        prefs,
      ),
    { now: new Date('2026-08-28T12:00:00Z') },
  );
  const rankedIds = new Set([...ranked.affects, ...ranked.older].map((entry) => entry.id));
  assert.ok(!rankedIds.has(ineligible.id), 'precondition: geography exclusion holds');

  // "peanut" matches BOTH titles — but search runs over the ranked output, so
  // the ineligible notice has no path in.
  const searched = filterBySearch([...ranked.affects, ...ranked.older], 'peanut', buildSearchEntry);
  assert.deepEqual(
    searched.map((entry) => entry.id),
    [eligible.id],
  );
});

test('filtering and searching never touch preferences or personalization state', () => {
  // Structural guarantee: the pure filter/search modules import nothing that
  // can read or write preferences, so mode switches and browsing state cannot
  // mutate the profile. (The preference store is the only write path, and it
  // is not reachable from these modules.)
  for (const file of ['feed-filters.ts', 'feed-search.ts']) {
    const source = readFileSync(join(__dirname, file), 'utf8');
    for (const forbidden of ['preferences-store', 'savePreferences', 'push-registration']) {
      assert.ok(!source.includes(forbidden), `${file} references ${forbidden}`);
    }
  }
});

const count = (source: string, needle: string): number => source.split(needle).length - 1;

test('the Feed Location filter is untouched by multi-state personalization (P2B7U)', () => {
  // The Location filter and saved personalization are two different
  // questions — "show me only these states while I browse" and "which
  // recalls concern me" — and they stay two. Multi-select personalization
  // changed neither the filter's matching nor its independence.
  //
  // 1. Its matcher takes the SESSION's chosen codes and nothing else: there
  //    is no preferences argument it could read.
  assert.equal(matchesLocationFilter.length, 2);
  assert.equal(locationMatchTier.length, 2);
  const ca = geo('states', ['California']);
  const me = geo('states', ['Maine']);
  const national = geo('nationwide');
  const silent = geo('unknown');
  assert.equal(matchesLocationFilter(ca, ['CA']), true);
  assert.equal(matchesLocationFilter(me, ['CA']), false);
  assert.equal(matchesLocationFilter(national, ['CA']), true);
  assert.equal(matchesLocationFilter(silent, ['CA']), false);
  // No selection is no filter — every notice passes, unknown included.
  for (const geography of [ca, me, national, silent]) {
    assert.equal(matchesLocationFilter(geography, []), true);
  }
  // It was already a multi-value filter, and its OR semantics are unchanged.
  assert.equal(matchesLocationFilter(me, ['CA', 'ME']), true);
  // The tier still names explicit vs nationwide for MEMBERSHIP; it orders nothing.
  assert.equal(locationMatchTier(ca, ['CA']), 0);
  assert.equal(locationMatchTier(national, ['CA']), 1);
  assert.equal(locationMatchTier(me, ['CA']), null);

  // 2. A saved personalization profile cannot reach it. The filter state has
  //    its own field, seeded empty, and the module imports nothing that can
  //    read preferences.
  assert.deepEqual(EMPTY_FEED_FILTERS.stateCodes, []);
  const source = readFileSync(join(__dirname, 'feed-filters.ts'), 'utf8');
  for (const forbidden of [
    'UserRecallPreferences',
    'preferences-store',
    'loadPreferences',
    'savePreferences',
    'evaluatePersonalRelevance',
    'affectsYouVerdict',
    'SecureStore',
  ]) {
    assert.ok(!source.includes(forbidden), `the Location filter reaches ${forbidden}`);
  }
  // It does share ONE thing with the preference domain — the postal-code to
  // name lookup, which is the country's vocabulary, not this user's answer.
  assert.ok(source.includes("import { stateNameForCode } from '@/domain/preferences';"));
  assert.equal(count(source, "from '@/domain/preferences'"), 1);

  // 3. The Feed screen feeds it session state, never the saved profile.
  const home = readFileSync(join(__dirname, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
  assert.ok(home.includes('applyFeedFilters(state.items, filters)'));
  assert.ok(!home.includes('prefs.states)'), 'the filter is fed from the saved profile');
  assert.ok(!/applyFeedFilters\([^)]*prefs/.test(home));
  assert.ok(!/stateCodes:\s*prefs\./.test(home));
});
