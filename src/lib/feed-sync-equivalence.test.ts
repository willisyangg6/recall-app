/**
 * C8 equivalence proof: every consumer-facing computation — All Recalls
 * sections and order, Affects Me eligibility/reasons/ranking, Location and
 * Risk filters, explicit-state priority, and search — produces BYTE-IDENTICAL
 * results whether the corpus arrived from a direct network load or through
 * the persistent cache and an incremental sync. Caching changes transfer,
 * never product behavior.
 *
 * The corpus is deliberately larger than 500 cases so the pre-C5.1 ceiling
 * class of bug (a silently truncated feed changing every downstream number)
 * cannot reappear through the cache path either.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { UserRecallPreferences } from '../domain/preferences';
import { buildAffectsMeSections } from './affects-me-ranking';
import {
  makeCorpus,
  makeFeedItem,
  manifestFor,
  memoryCacheStore,
  scriptedTransport,
} from './feed-fixtures';
import { applyFeedFilters, orderByLocationTiers, type FeedFilterState } from './feed-filters';
import { buildFeedSections } from './feed-relevance';
import { buildSearchEntry, filterBySearch, type SearchEntry } from './feed-search';
import { syncFeed } from './feed-sync';
import type { FeedItem } from './recall-feed';
import { evaluatePersonalRelevance, type PersonalRelevance } from './relevance';

const NOW = new Date('2026-08-28T12:00:00Z');
const PROFILE: UserRecallPreferences = {
  state: 'CA',
  allergens: ['sesame', 'peanut'],
  retailers: ['costco', 'trader-joes'],
};

const relevanceOf = (item: FeedItem): PersonalRelevance =>
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

/** Every consumer-visible derivation, in one comparable value. */
function consumerView(items: FeedItem[]): unknown {
  const entries = new Map<string, SearchEntry>();
  for (const item of items) entries.set(item.id, buildSearchEntry(item));
  const entryOf = (item: FeedItem) => entries.get(item.id) ?? buildSearchEntry(item);

  const sections = buildFeedSections(items, NOW);
  const locationFilter: FeedFilterState = { stateCodes: ['CA'], riskTiers: [] };
  const riskFilter: FeedFilterState = { stateCodes: [], riskTiers: ['high'] };
  const affectsMe = buildAffectsMeSections(items, relevanceOf, { now: NOW });

  return {
    allRecallsRecent: sections.recent.map((item) => item.id),
    allRecallsOlder: sections.olderActive.map((item) => item.id),
    locationFiltered: applyFeedFilters(items, locationFilter).map((item) => item.id),
    // Explicit-state priority: selected-state matches order ahead of
    // nationwide within each section.
    locationOrderedRecent: orderByLocationTiers(sections.recent, ['CA']).map((item) => item.id),
    locationOrderedOlder: orderByLocationTiers(sections.olderActive, ['CA']).map((item) => item.id),
    riskFiltered: applyFeedFilters(items, riskFilter).map((item) => item.id),
    affectsMe: affectsMe.affects.map((item) => item.id),
    affectsMeOlder: affectsMe.older.map((item) => item.id),
    affectsMeReasons: [...items]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => ({
        id: item.id,
        relevance: relevanceOf(item),
      })),
    searchByName: filterBySearch(items, 'Product 17', entryOf).map((item) => item.id),
    searchByUpc: filterBySearch(items, '0 12345 00017 1', entryOf).map((item) => item.id),
    searchByFirm: filterBySearch(items, 'Test Firm 42', entryOf).map((item) => item.id),
  };
}

test('every consumer derivation is byte-identical before and after caching', async () => {
  const corpus = makeCorpus(620);
  const direct = consumerView(corpus);

  // Through the cache: cold sync commits, a warm sync re-reads the cache and
  // reconciles (unchanged), and the view is computed from what came OUT of
  // the cache document.
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport });
  const warm = await syncFeed({ store: cache.store, transport: scripted.transport });
  assert.equal(warm.downloadedRows, 0); // genuinely served from cache + manifest

  const cached = consumerView(warm.items);
  assert.equal(JSON.stringify(cached), JSON.stringify(direct));
});

test('equivalence holds across an incremental change, matching a fresh full load', async () => {
  const corpus = makeCorpus(560);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport });

  // One new case, one changed case, one removal — reconciled incrementally.
  const added = makeFeedItem(9001);
  const changed = { ...corpus[100], retailerNames: ['Costco'], title: 'Expanded recall' };
  const removedId = corpus[200].id;
  const next = [
    ...corpus
      .filter((item) => item.id !== removedId)
      .map((item) => (item.id === changed.id ? changed : item)),
    added,
  ];
  scripted.setManifest(manifestFor(next));
  scripted.setAll(next);

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport });
  assert.equal(outcome.mode, 'incremental');
  assert.ok(outcome.downloadedRows <= 2);

  assert.equal(JSON.stringify(consumerView(outcome.items)), JSON.stringify(consumerView(next)));
});
