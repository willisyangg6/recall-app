/**
 * ONE stored geography drives every surface (P2B7Q.2).
 *
 * Before this milestone there were four readers of distribution geography: the
 * FDA parser's own keyword gate, the canonical evidence contract, the feed
 * card's read of the stored projection, and Recall Detail's display-time
 * re-read of the announcement prose. The last one worked at PARAGRAPH scope,
 * so Detail named states the card, the Location filter and Affects Me had
 * never heard of — on 19 of 911 active cases — and some of those states were
 * places the notice says are NOT affected.
 *
 * This file is the structural guard on the corrected boundary:
 *
 *   `projection.geography` is the only source of a state, anywhere.
 *   Card, Detail, Location filter, Affects Me and what a screen reader
 *   announces are all FORMATTING of that one set.
 *
 * The parity tests below run the whole path a real case takes, from the
 * recorded FDA announcement through `projectCase` to each surface, so a
 * regression has to survive the actual pipeline rather than a hand-built
 * projection.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';

import { deriveGeography } from '@/domain/geography-evidence';
import type { CaseProjection, Geography } from '@/domain/recall-types';
import { projectCase } from '@/domain/projection';
import { parseFdaAnnouncement } from '@/server/fda/parse';
import { buildConsumerCase } from './consumer-projection';
import { matchesLocationFilter } from './feed-filters';
import type { CaseDetail, FeedItem } from './recall-feed';
import {
  buildDetailModel,
  buildHomeCardModel,
  homeLocationSummary,
  UNSPECIFIED_DISTRIBUTION,
  whereSoldModel,
  WHERE_SOLD_INITIAL_STATES,
} from './recall-presentation';
import { evaluatePersonalRelevance } from './relevance';
import { STATE_TO_POSTAL } from '@/domain/us-geography';

const TODAY = '2026-08-10';

/** A recorded announcement whose notice names twenty distribution states. */
interface QaCorpusEntry {
  path: string;
  listing: Parameters<typeof parseFdaAnnouncement>[0]['listing'];
  mainHtml: string;
}
const CORPUS: QaCorpusEntry[] = JSON.parse(
  gunzipSync(readFileSync('src/server/fda/fixtures/qa-corpus.json.gz')).toString('utf8'),
);

function projectedFixture(fragment: string): CaseProjection {
  const entry = CORPUS.find((candidate) => candidate.path.includes(fragment));
  assert.ok(entry, `recorded FDA announcement ${fragment} missing`);
  return projectCase([
    parseFdaAnnouncement({
      listing: entry!.listing,
      detailMainHtml: entry!.mainHtml,
      path: entry!.path,
    }),
  ]);
}

function feedItemFrom(projection: CaseProjection): FeedItem {
  return {
    id: 'case-1',
    sourceAgency: projection.sourceAgency,
    noticeType: projection.noticeType,
    state: 'active',
    title: projection.title,
    classification: projection.classification,
    hazardCategory: projection.hazardCategory,
    publishedAt: projection.publishedAt,
    lastPublicActivityAt: projection.lastPublicActivityAt,
    reasonText: projection.reasonText,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    firmName: projection.recallingFirm.displayName,
    brands: projection.brands,
    productDescription: projection.productDescription,
    retailerNames: projection.retailerNames ?? [],
    heroImageUrl: projection.heroImageUrl,
    productNames: [],
    // THE egress contract: the feed row carries `geography` and no prose.
    geography: projection.geography,
    officialUrl: projection.officialUrl,
    timeline: [],
  };
}

function detailFrom(projection: CaseProjection): CaseDetail {
  return { id: 'case-1', projection, timeline: [], affectedProducts: [], visuals: [] };
}

// ── The whole path, on a real announcement ──────────────────────────────────

test('new ingest: source → parse → projectCase → egress → card, Detail, filter, Affects Me', () => {
  // "Distributed to select stores in:" followed by a twenty-code list.
  const projection = projectedFixture('braga-fresh-issues-voluntary-and-precautionary-advisory');
  const states = projection.geography.states;
  assert.equal(projection.geography.scope, 'states');
  assert.equal(states.length, 20, states.join(', '));
  assert.ok(states.includes('Texas') && states.includes('Alaska'));

  // No repair participates: this is what a NEW case is born with.
  const item = feedItemFrom(projection);
  const card = buildHomeCardModel(item, { today: TODAY, prefs: null });
  const detail = buildDetailModel(detailFrom(projection), { today: TODAY, affectsYou: false });

  // Card abbreviates; Detail lists. Same set.
  assert.equal(
    card.locationSummary,
    `${STATE_TO_POSTAL[states[0]]}, ${STATE_TO_POSTAL[states[1]]} +${states.length - 2}`,
  );
  assert.deepEqual(detail.sections.whereSold.states, states);

  // Filter and Affects Me read the same value the card printed.
  for (const state of ['TX', 'AK']) {
    assert.equal(matchesLocationFilter(item.geography, [state]), true, state);
  }
  assert.equal(matchesLocationFilter(item.geography, ['NY']), false);
  assert.equal(
    evaluatePersonalRelevance(
      {
        geography: projection.geography,
        pathogenOrAllergen: projection.pathogenOrAllergen,
        retailerNames: projection.retailerNames ?? [],
        hazardCategory: projection.hazardCategory,
        reasonText: projection.reasonText,
      },
      { states: ['TX'], allergens: [], retailers: [] },
    ).geographic,
    'matches',
  );
});

// ── Parity: one set, four formattings ───────────────────────────────────────

const SETS: Geography[] = [
  { scope: 'states', states: ['California'], confidence: 'inferred', sourceText: null },
  {
    scope: 'states',
    states: ['Connecticut', 'Illinois', 'Maine', 'New York', 'Ohio', 'Texas'],
    confidence: 'inferred',
    sourceText: null,
  },
  { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
  { scope: 'unknown', states: [], confidence: 'stated', sourceText: null },
];

test('card, Detail, filter and Affects Me answer from the SAME stored set', () => {
  for (const geography of SETS) {
    const projection: CaseProjection = {
      ...projectedFixture('braga-fresh-issues-voluntary-and-precautionary-advisory'),
      geography,
      summaryText: 'Unrelated prose naming Oregon, Georgia and Rhode Island.',
      summaryHtml: null,
    };
    const consumer = buildConsumerCase(projection, []);
    const sold = whereSoldModel(consumer.distribution);

    // Detail states the canonical set and nothing it read for itself: the
    // decoy prose above names three states that are in no stored value here.
    assert.deepEqual(sold.states, geography.scope === 'states' ? geography.states : []);
    for (const decoy of ['Oregon', 'Georgia', 'Rhode Island']) {
      if (geography.states.includes(decoy)) continue;
      assert.ok(!sold.states.includes(decoy), `${decoy} leaked into Detail from prose`);
      assert.ok(!sold.lead.includes(decoy), `${decoy} leaked into the Detail lead`);
    }

    // Unknown is unknown everywhere; nationwide is nationwide everywhere.
    if (geography.scope === 'unknown') {
      assert.equal(sold.lead, UNSPECIFIED_DISTRIBUTION);
      assert.equal(homeLocationSummary(geography), UNSPECIFIED_DISTRIBUTION);
      assert.equal(sold.locationState, 'unspecified');
    }
    if (geography.scope === 'nationwide') {
      assert.equal(homeLocationSummary(geography), 'Nationwide');
      assert.equal(sold.locationState, 'nationwide');
    }

    // Filter parity, across every jurisdiction the app knows.
    for (const state of geography.states) {
      const code = STATE_TO_POSTAL[state];
      assert.equal(matchesLocationFilter(geography, [code]), true, `${state} filter`);
      assert.ok(sold.states.includes(state), `${state} missing from Detail`);
    }
  }
});

test('accessibility announces the same count the canonical set holds', () => {
  const states = ['Connecticut', 'Illinois', 'Maine', 'New York', 'Ohio', 'Texas'];
  const geography: Geography = {
    scope: 'states',
    states,
    confidence: 'inferred',
    sourceText: null,
  };
  const consumer = buildConsumerCase(
    {
      ...projectedFixture('braga-fresh-issues-voluntary-and-precautionary-advisory'),
      geography,
      summaryText: '',
      summaryHtml: null,
    },
    [],
  );
  const sold = whereSoldModel(consumer.distribution);
  assert.ok(sold.statesDisclosure);
  // "See all 6 states" — the REAL total, not the hidden remainder.
  assert.equal(sold.statesDisclosure!.expandAccessibilityLabel, `See all ${states.length} states`);
  assert.equal(sold.statesDisclosure!.expandLabel, `See all (${states.length})`);
  // Collapsed shows the first five of the same list, in the same order.
  assert.equal(sold.leadCollapsed, states.slice(0, WHERE_SOLD_INITIAL_STATES).join(', '));
  // And the card's "+N" counts the same set.
  assert.equal(homeLocationSummary(geography), `CT, IL +${states.length - 2}`);
});

// ── Structural: no second reader may come back ──────────────────────────────

test('no shopper surface reads announcement prose for a state', () => {
  const source = readFileSync('src/lib/consumer-projection.ts', 'utf8');
  const distribution = source.slice(
    source.indexOf('export function buildDistribution'),
    source.indexOf('// The AREAS block'),
  );
  assert.ok(distribution.length > 0, 'buildDistribution moved');
  // The states line is exactly one expression, and it is a read.
  assert.match(distribution, /const states = \[\.\.\.geography\.states\]\.sort\(\);/);
  for (const banned of [
    'statesInText',
    'extractDistributionListStates',
    'distributionTableStates',
    'places.states',
  ]) {
    assert.ok(
      !distribution.includes(banned),
      `buildDistribution reads ${banned}: geography has a second reader again`,
    );
  }
});

test('the canonical derivation is the only place a distribution state is read', () => {
  // Every module that turns announcement text into a STATE has to be this one.
  // A new reader elsewhere is the exact regression P2B7Q.2 removed.
  const readers = ['src/domain/geography-evidence.ts'];
  for (const file of [
    'src/lib/recall-presentation.ts',
    'src/lib/feed-filters.ts',
    'src/lib/relevance.ts',
    'src/lib/recall-feed.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !source.includes('statesInText'),
      `${file} reads states out of text; the one reader is ${readers[0]}`,
    );
  }
});

test('the FDA parser derives geography through the shared contract, not its own gate', () => {
  const source = readFileSync('src/server/fda/parse.ts', 'utf8');
  const geographyFn = source.slice(
    source.indexOf('export function parseFdaGeography'),
    source.indexOf('// ── Quantity'),
  );
  assert.match(geographyFn, /deriveGeography\(/);
  // A bare keyword gate is what it used to be, and what it may not be again.
  assert.ok(!/const DISTRIBUTION_SENTENCE\s*=/.test(source), 'the parser rebuilt its own gate');
});

test('the display layer cannot narrow the stored set', () => {
  const geography: Geography = {
    scope: 'states',
    states: ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California'],
    confidence: 'inferred',
    sourceText: null,
  };
  // Prose that mentions none of them, and a notice that contradicts one.
  const projection: CaseProjection = {
    ...projectedFixture('braga-fresh-issues-voluntary-and-precautionary-advisory'),
    geography,
    summaryText: 'Stores in Alaska are not impacted by this recall.',
    summaryHtml: null,
  };
  const sold = whereSoldModel(buildConsumerCase(projection, []).distribution);
  assert.deepEqual(sold.states, geography.states, 'Detail must state the stored set verbatim');
  // The exclusion belongs upstream, where it changes the filter too.
  const repaired = deriveGeography({
    title: projection.title,
    summaryText: projection.summaryText,
    summaryHtml: null,
    carried: geography,
  });
  assert.ok(!repaired.states.includes('Alaska'));
  assert.equal(repaired.states.length, 4);
});

// ── City-level evidence: preserved, and never promoted to a state ───────────

test('a city the source never ties to a state is stated, but is not a state', () => {
  // Verbatim from the Feve Artisan Chocolatier / Dandelion Chocolate notice.
  // The founder decision (P2B7Q.2) is that this sentence is TRUE and stays on
  // Detail — deleting it would remove a fact the notice states — while San
  // Francisco and Las Vegas are never resolved to California and Nevada,
  // because the notice does not say California or Nevada. City-level evidence
  // sits outside the state-level canonical contract; it is not an exception
  // to it, and there is no per-case rule anywhere.
  const summaryText =
    'It was sold by Dandelion at their retail stores (in San Francisco and Las Vegas) and via ' +
    'the Dandelion Chocolate website ( dandelionchocolate.com ).';
  const carried: Geography = {
    scope: 'unknown',
    states: [],
    confidence: 'inferred',
    sourceText: null,
  };
  const geography = deriveGeography({
    title: 'Feve Artisan Chocolatier and Dandelion Chocolate Issue Allergy Alert',
    summaryText,
    summaryHtml: null,
    carried,
  });

  // 1. No state is invented from a city name.
  assert.equal(geography.scope, 'unknown');
  assert.deepEqual(geography.states, []);

  // 2. Neither the state the city sits in, nor any other, matches a filter.
  for (const code of ['CA', 'NV', 'NY', 'TX']) {
    assert.equal(matchesLocationFilter(geography, [code]), false, `${code} must not match`);
  }

  // 3. Affects Me stays UNKNOWN — never "matches", never "does not match".
  assert.equal(
    evaluatePersonalRelevance(
      {
        geography,
        pathogenOrAllergen: 'hazelnuts',
        retailerNames: [],
        hazardCategory: 'allergen',
        reasonText: null,
      },
      { states: ['CA'], allergens: [], retailers: [] },
    ).geographic,
    'unknown',
  );

  // 4. The card says the honest thing…
  assert.equal(homeLocationSummary(geography), UNSPECIFIED_DISTRIBUTION);

  // 5. …and Detail still states what the notice actually said.
  const projection: CaseProjection = {
    ...projectedFixture('braga-fresh-issues-voluntary-and-precautionary-advisory'),
    geography,
    summaryText,
    summaryHtml: null,
  };
  const sold = whereSoldModel(buildConsumerCase(projection, []).distribution);
  assert.equal(sold.lead, 'San Francisco and Las Vegas');
  assert.equal(sold.locationState, 'areas');
  assert.deepEqual(sold.states, [], 'an area contributes no state, on any surface');
});
