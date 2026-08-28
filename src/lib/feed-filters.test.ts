import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Geography } from '@/domain/recall-types';
import { RISK_TIER_RANK } from '@/domain/risk-tier';
import { buildAffectsMeSections, RISK_PRIORITY } from './affects-me-ranking';
import {
  activeFilterCount,
  applyFeedFilters,
  EMPTY_FEED_FILTERS,
  hasActiveFilters,
  locationMatchTier,
  matchesLocationFilter,
  matchesRiskFilter,
  orderByLocationTiers,
  RISK_FILTER_TIERS,
  type FeedFilterState,
} from './feed-filters';
import { buildFeedSections } from './feed-relevance';
import { buildSearchEntry, filterBySearch } from './feed-search';
import type { FeedItem } from './recall-feed';
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
    value: 'unclassified',
    sourceText: null,
    officialClasses: [],
  } as unknown as FeedItem['classification'];

  assert.equal(matchesRiskFilter(classified('class_I'), ['critical']), true);
  assert.equal(matchesRiskFilter(classified('class_II'), ['critical']), false);
  assert.equal(matchesRiskFilter(classified('class_II'), ['critical', 'moderate']), true);
  // Pending and Unrated are their own levels — selectable, never absorbed.
  assert.equal(matchesRiskFilter(pending, ['pending']), true);
  assert.equal(matchesRiskFilter(pending, ['moderate']), false);
  assert.equal(matchesRiskFilter(pha, ['unrated']), true);
  assert.equal(matchesRiskFilter(pha, ['pending']), false);
});

test('the sheet vocabulary is exactly the seven canonical tiers', () => {
  assert.deepEqual([...RISK_FILTER_TIERS].sort(), Object.keys(RISK_TIER_RANK).sort());
});

// ── Composition ──────────────────────────────────────────────────────────────

test('dimensions AND together: (CA OR TX) AND (Critical OR High)', () => {
  const caCritical = item({ geography: geo('states', ['California']) });
  const caMinimal = item({
    geography: geo('states', ['California']),
    classification: classified('class_III'),
  });
  const nyCritical = item({ geography: geo('states', ['New York']) });
  const nationwideHigh = item({
    geography: geo('nationwide'),
    classification: {
      value: 'class_I',
      sourceText: null,
      officialClasses: ['class_I', 'class_II'],
    } as FeedItem['classification'],
  });
  const corpus = [caCritical, caMinimal, nyCritical, nationwideHigh];
  const result = applyFeedFilters(
    corpus,
    filters({ stateCodes: ['CA', 'TX'], riskTiers: ['critical', 'high'] }),
  );
  assert.deepEqual(
    result.map((entry) => entry.id),
    [caCritical.id, nationwideHigh.id],
  );
  // The loaded corpus is untouched: same length, same members, same order.
  assert.equal(corpus.length, 4);
  assert.deepEqual(
    corpus.map((entry) => entry.id),
    [caCritical.id, caMinimal.id, nyCritical.id, nationwideHigh.id],
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

// ── Location-tier ordering (C6.1) ────────────────────────────────────────────

const NOW = new Date('2026-08-28T12:00:00Z');

/** The real Home pipeline for All Recalls: filter → section → location order. */
function visibleAllRecalls(
  corpus: FeedItem[],
  stateCodes: string[],
): { recent: string[]; older: string[] } {
  const filtered = applyFeedFilters(corpus, filters({ stateCodes }));
  const sectioned = buildFeedSections(filtered, NOW);
  return {
    recent: orderByLocationTiers(sectioned.recent, stateCodes).map((entry) => entry.id),
    older: orderByLocationTiers(sectioned.olderActive, stateCodes).map((entry) => entry.id),
  };
}

/** Recent-tier item: both dates inside the 60-day window unless overridden. */
function recentItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return item({ publishedAt: '2026-08-10', lastPublicActivityAt: '2026-08-10', ...overrides });
}

test('an explicit California-only notice outranks a nationwide one', () => {
  const ca = recentItem({ geography: geo('states', ['California']) });
  const national = recentItem({ geography: geo('nationwide') });
  assert.deepEqual(visibleAllRecalls([national, ca], ['CA']).recent, [ca.id, national.id]);
});

test('an explicit California-plus-Texas notice also outranks nationwide', () => {
  const caTx = recentItem({ geography: geo('states', ['California', 'Texas']) });
  const national = recentItem({ geography: geo('nationwide') });
  assert.deepEqual(visibleAllRecalls([national, caTx], ['CA']).recent, [caTx.id, national.id]);
});

test('California-only and California-plus-Texas carry EQUAL location weight', () => {
  // Same tier, so the order falls through to date — proved in both directions,
  // which a rule that rewarded a narrower (or broader) list could not satisfy.
  const caOnly = recentItem({
    geography: geo('states', ['California']),
    lastPublicActivityAt: '2026-08-05',
  });
  const caTxNewer = recentItem({
    geography: geo('states', ['California', 'Texas']),
    lastPublicActivityAt: '2026-08-20',
  });
  assert.deepEqual(visibleAllRecalls([caOnly, caTxNewer], ['CA']).recent, [
    caTxNewer.id,
    caOnly.id,
  ]);

  const caOnlyNewer = recentItem({
    geography: geo('states', ['California']),
    lastPublicActivityAt: '2026-08-20',
  });
  const caTxOlder = recentItem({
    geography: geo('states', ['California', 'Texas', 'Nevada', 'Oregon']),
    lastPublicActivityAt: '2026-08-05',
  });
  assert.deepEqual(visibleAllRecalls([caTxOlder, caOnlyNewer], ['CA']).recent, [
    caOnlyNewer.id,
    caTxOlder.id,
  ]);
});

test('equal location weight falls through to risk, then date, then the id tie-break', () => {
  const lowRiskNewer = recentItem({
    geography: geo('states', ['California']),
    classification: classified('class_III'),
    lastPublicActivityAt: '2026-08-25',
  });
  const highRiskOlder = recentItem({
    geography: geo('states', ['California', 'Texas']),
    classification: classified('class_I'),
    lastPublicActivityAt: '2026-08-05',
  });
  // Risk decides before date.
  assert.deepEqual(visibleAllRecalls([lowRiskNewer, highRiskOlder], ['CA']).recent, [
    highRiskOlder.id,
    lowRiskNewer.id,
  ]);

  // Same tier, same risk, same dates → the stable id tie-break settles it.
  const tiedA = recentItem({ geography: geo('states', ['California']) });
  const tiedB = recentItem({ geography: geo('states', ['California', 'Texas']) });
  const [first, second] = [tiedA.id, tiedB.id].sort();
  assert.deepEqual(visibleAllRecalls([tiedB, tiedA], ['CA']).recent, [first, second]);
});

test('explicit location beats nationwide even when nationwide is NEWER', () => {
  const caOld = recentItem({
    geography: geo('states', ['California']),
    lastPublicActivityAt: '2026-08-02',
  });
  const nationalNew = recentItem({
    geography: geo('nationwide'),
    lastPublicActivityAt: '2026-08-27',
  });
  assert.deepEqual(visibleAllRecalls([nationalNew, caOld], ['CA']).recent, [
    caOld.id,
    nationalNew.id,
  ]);
});

test('explicit location beats nationwide even when nationwide carries HIGHER risk', () => {
  const caMinimal = recentItem({
    geography: geo('states', ['California']),
    classification: classified('class_III'),
  });
  const nationalCritical = recentItem({
    geography: geo('nationwide'),
    classification: classified('class_I'),
  });
  assert.deepEqual(visibleAllRecalls([nationalCritical, caMinimal], ['CA']).recent, [
    caMinimal.id,
    nationalCritical.id,
  ]);
});

test('within a tier, higher consumer risk leads', () => {
  const moderate = recentItem({
    geography: geo('states', ['California']),
    classification: classified('class_II'),
  });
  const critical = recentItem({
    geography: geo('states', ['California']),
    classification: classified('class_I'),
  });
  const minimal = recentItem({
    geography: geo('states', ['California']),
    classification: classified('class_III'),
  });
  assert.deepEqual(visibleAllRecalls([minimal, moderate, critical], ['CA']).recent, [
    critical.id,
    moderate.id,
    minimal.id,
  ]);
});

test('nationwide notices are ordered among themselves by risk then date', () => {
  const older = recentItem({
    geography: geo('nationwide'),
    lastPublicActivityAt: '2026-08-04',
  });
  const newer = recentItem({
    geography: geo('nationwide'),
    lastPublicActivityAt: '2026-08-22',
  });
  const critical = recentItem({
    geography: geo('nationwide'),
    classification: classified('class_I'),
    lastPublicActivityAt: '2026-08-01',
  });
  const moderateNewest = recentItem({
    geography: geo('nationwide'),
    classification: classified('class_II'),
    lastPublicActivityAt: '2026-08-26',
  });
  assert.deepEqual(visibleAllRecalls([older, newer], ['CA']).recent, [newer.id, older.id]);
  assert.deepEqual(visibleAllRecalls([moderateNewest, critical], ['CA']).recent, [
    critical.id,
    moderateNewest.id,
  ]);
});

test('with several jurisdictions selected, an explicit match to EITHER is tier 1', () => {
  const ca = recentItem({ geography: geo('states', ['California']) });
  const tx = recentItem({ geography: geo('states', ['Texas']) });
  const national = recentItem({ geography: geo('nationwide') });
  const visible = visibleAllRecalls([national, ca, tx], ['CA', 'TX']).recent;
  assert.equal(visible.length, 3);
  assert.equal(visible[2], national.id, 'nationwide must rank last');
  assert.deepEqual([...visible.slice(0, 2)].sort(), [ca.id, tx.id].sort());
});

test('unknown and unselected geography stay excluded, so they never rank at all', () => {
  const unknown = recentItem({ geography: geo('unknown') });
  const maine = recentItem({ geography: geo('states', ['Maine']) });
  const ca = recentItem({ geography: geo('states', ['California']) });
  assert.deepEqual(visibleAllRecalls([unknown, maine, ca], ['CA']).recent, [ca.id]);
  assert.equal(locationMatchTier(geo('unknown'), ['CA']), null);
  assert.equal(locationMatchTier(geo('states', ['Maine']), ['CA']), null);
  assert.equal(locationMatchTier(geo('states', ['California', 'Maine']), ['CA']), 0);
  assert.equal(locationMatchTier(geo('nationwide'), ['CA']), 1);
});

test('ordering never moves a notice between sections', () => {
  // An old explicit California match stays in Older active notices; it is not
  // promoted into Recent activity by matching the selected location.
  const oldCa = item({
    geography: geo('states', ['California']),
    publishedAt: '2024-01-05',
    lastPublicActivityAt: '2024-01-05',
  });
  const recentNational = recentItem({ geography: geo('nationwide') });
  const visible = visibleAllRecalls([oldCa, recentNational], ['CA']);
  assert.deepEqual(visible.recent, [recentNational.id]);
  assert.deepEqual(visible.older, [oldCa.id]);
});

test('with no jurisdiction selected the order is the existing one, same instance', () => {
  const corpus = [
    recentItem({ geography: geo('nationwide') }),
    recentItem({ geography: geo('states', ['California']) }),
    recentItem({ geography: geo('unknown') }),
  ];
  const sectioned = buildFeedSections(applyFeedFilters(corpus, EMPTY_FEED_FILTERS), NOW);
  // Same instance in and out — an inactive Location filter cannot reorder.
  assert.equal(orderByLocationTiers(sectioned.recent, []), sectioned.recent);
  assert.equal(orderByLocationTiers(sectioned.olderActive, []), sectioned.olderActive);
  // Risk-only filtering likewise leaves ordering to the existing comparator.
  const riskOnly = buildFeedSections(
    applyFeedFilters(corpus, filters({ riskTiers: ['critical'] })),
    NOW,
  );
  assert.equal(orderByLocationTiers(riskOnly.recent, []), riskOnly.recent);
  assert.deepEqual(
    riskOnly.recent.map((entry) => entry.id),
    buildFeedSections(
      corpus.filter((entry) => entry.classification.value === 'class_I'),
      NOW,
    ).recent.map((entry) => entry.id),
  );
});

test('location ordering never mutates the source list', () => {
  const corpus = [
    recentItem({ geography: geo('nationwide') }),
    recentItem({ geography: geo('states', ['California']) }),
  ];
  const before = corpus.map((entry) => entry.id);
  const ordered = orderByLocationTiers(corpus, ['CA']);
  assert.notEqual(ordered, corpus, 'must return a new array, never sort in place');
  assert.deepEqual(
    corpus.map((entry) => entry.id),
    before,
  );
});

test('search filters the located results without reordering them', () => {
  const caA = recentItem({ geography: geo('states', ['California']), title: 'Peanut Alpha' });
  const national = recentItem({ geography: geo('nationwide'), title: 'Peanut National' });
  const caB = recentItem({ geography: geo('states', ['California']), title: 'Cheese Beta' });
  const filtered = applyFeedFilters([national, caA, caB], filters({ stateCodes: ['CA'] }));
  const ordered = orderByLocationTiers(buildFeedSections(filtered, NOW).recent, ['CA']);
  const searched = filterBySearch(ordered, 'peanut', buildSearchEntry);
  // Same relative order as the located list, minus the non-matches.
  assert.deepEqual(
    searched.map((entry) => entry.id),
    ordered.filter((entry) => entry.title.includes('Peanut')).map((entry) => entry.id),
  );
  assert.equal(searched[0].id, caA.id, 'explicit CA still leads nationwide after search');
});

test('the location comparator reuses the ONE canonical risk sequence', () => {
  // Not a second copy: All Recalls and Affects me sequence risk tiers the same
  // way, so a change to the decision cannot silently apply to only one surface.
  assert.equal(RISK_PRIORITY.critical < RISK_PRIORITY.high, true);
  assert.equal(RISK_PRIORITY.moderate < RISK_PRIORITY.pending, true);
  assert.equal(RISK_PRIORITY.pending < RISK_PRIORITY.low, true);
  assert.equal(RISK_PRIORITY.pending, RISK_PRIORITY.unrated);
  const source = readFileSync(join(__dirname, 'feed-filters.ts'), 'utf8');
  assert.match(source, /import \{ RISK_PRIORITY \} from '\.\/affects-me-ranking'/);
});

// ── Affects Me boundaries ────────────────────────────────────────────────────

test('search within Affects me narrows the eligible ranked set and cannot surface an ineligible notice', () => {
  const prefs = { state: 'CA', allergens: [], retailers: [] };
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
