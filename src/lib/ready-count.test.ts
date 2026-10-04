/**
 * What "We found N recalls for you." counts (2026-10-04): the Affects You
 * current window — every active recall whose geography matches a chosen
 * state (a Nationwide recall matches every state), or whose geography is
 * unknown but carries one of the shopper's allergen or store signals, and
 * whose last MATERIAL activity is within the Affects Me recency window —
 * with the one allergen-only exclusion. It never depends on an image, a
 * category or a page size, and the Building step and Ready read the same
 * number from the same corpus.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { UserRecallPreferences } from '@/domain/preferences';
import { buildingData } from '@/lib/building-watch';
import { makeFeedItem } from '@/lib/feed-fixtures';
import type { FeedItem } from '@/lib/recall-feed';
import { buildAffectsMeSections } from '@/lib/affects-me-ranking';
import { affectsYouMatches, buildReadyPreview, previewMatchCount } from '@/lib/ready-preview';
import { evaluatePersonalRelevance } from '@/lib/relevance';

const TODAY = '2026-08-28';
const NOW = new Date(`${TODAY}T12:00:00.000Z`);

const prefs = (states: string[], allergens: string[] = [], retailers: string[] = []) =>
  ({ states, allergens, retailers }) satisfies UserRecallPreferences;

/** A recall with a given material activity date, nationwide unless stated. */
function recall(
  id: string,
  options: {
    scope?: 'nationwide' | 'states' | 'unknown';
    states?: string[];
    imaged?: boolean;
    daysAgo?: number;
    categoryLabel?: string | null;
    hazard?: { category: string; agent: string | null; reason?: string };
  } = {},
): FeedItem {
  const daysAgo = options.daysAgo ?? 3;
  const when = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  const scope = options.scope ?? 'nationwide';
  return makeFeedItem(id.length, {
    id,
    geography:
      scope === 'nationwide'
        ? { scope, states: [], confidence: 'stated', sourceText: 'Nationwide' }
        : scope === 'unknown'
          ? { scope, states: [], confidence: 'inferred', sourceText: null }
          : {
              scope,
              states: options.states ?? [],
              confidence: 'stated',
              sourceText: (options.states ?? []).join(', '),
            },
    publishedAt: when,
    lastPublicActivityAt: when,
    heroImageUrl: options.imaged === false ? null : `https://example.test/${id}.webp`,
    // Material activity decides the window; the fixture's timeline carries it.
    timeline: [
      {
        occurredAt: when,
        kind: 'published',
        summary: 'Recall published.',
        causedBySnapshotIds: [],
        material: true,
      },
    ],
    // A general hazard by default: never withheld by the allergen-only rule.
    hazardCategory: options.hazard?.category ?? 'microbial_contamination',
    pathogenOrAllergen: options.hazard ? options.hazard.agent : 'Salmonella',
    reasonText: options.hazard?.reason ?? 'Potential Salmonella contamination',
    retailerNames: [],
  });
}

test('a Nationwide recall qualifies for every chosen state, alone or among several', () => {
  const nationwide = recall('nationwide-1');
  for (const chosen of [['CA'], ['WY'], ['NY', 'TX'], ['HI', 'AK', 'DC']]) {
    const matches = affectsYouMatches([nationwide], prefs(chosen));
    assert.deepEqual(
      matches.map((m) => m.id),
      ['nationwide-1'],
      `nationwide did not count for ${chosen.join('+')}`,
    );
  }
  // …but not for a profile with no state: geography cannot be personal then.
  assert.deepEqual(affectsYouMatches([nationwide], prefs([])), []);
});

test('the count never depends on an image, a category or the deck’s limit', () => {
  const items = [
    recall('a', { imaged: false }),
    recall('b', { imaged: true }),
    recall('c', { imaged: false }),
    recall('d', { imaged: true }),
    recall('e', { imaged: false }),
  ];
  const preview = buildReadyPreview({ status: 'ready', items }, prefs(['CA']), TODAY, NOW);
  assert.equal(previewMatchCount(preview), 5);
  assert.ok(preview.kind === 'matches');
  // Every real match is readable in rank order up to the limit, imaged or
  // not; the fourth is the locked real card; the fifth is unshown.
  assert.equal(preview.models.length, 3);
  assert.notEqual(preview.locked, null);
});

test('Building and Ready read the same number from the same corpus, whatever its shape', () => {
  const corpora: FeedItem[][] = [
    [],
    [recall('one', { imaged: false })],
    [recall('x'), recall('y', { imaged: false })],
    [recall('p'), recall('q'), recall('r'), recall('s'), recall('t', { imaged: false })],
    [recall('tx', { scope: 'states', states: ['Texas'] }), recall('nat')],
    [recall('old', { daysAgo: 400 }), recall('new')],
  ];
  for (const items of corpora) {
    const chosen = prefs(['CA']);
    const building = buildingData({ status: 'ready', items }, false, chosen, NOW);
    const ready = buildReadyPreview({ status: 'ready', items }, chosen, TODAY, NOW);
    assert.ok(building.kind === 'usable');
    assert.equal(
      building.total,
      previewMatchCount(ready) ?? 0,
      `Building ${building.total} vs Ready ${previewMatchCount(ready)}`,
    );
  }
});

test('what the count excludes: another state’s recall, unknown geography with no signal, and material activity past the window', () => {
  const chosen = prefs(['CA']);
  const texasOnly = recall('texas', { scope: 'states', states: ['Texas'] });
  const unknownNoSignal = recall('unknown', { scope: 'unknown' });
  const stale = recall('stale', { daysAgo: 90 });
  const fresh = recall('fresh');
  const matches = affectsYouMatches([texasOnly, unknownNoSignal, stale, fresh], chosen, NOW);
  assert.deepEqual(
    matches.map((m) => m.id),
    ['fresh'],
  );
  // The stale one still AFFECTS the shopper; it is the older tier, not the
  // current window the count names.
  const california = recall('ca', { scope: 'states', states: ['California'], daysAgo: 1 });
  assert.deepEqual(
    affectsYouMatches([california], chosen, NOW).map((m) => m.id),
    ['ca'],
  );
});

test('a Nationwide Salmonella recall counts for a shopper with NO matching allergen or store', () => {
  const salmonella = recall('nationwide-salmonella');
  // Peanuts chosen, Costco chosen: neither appears on the recall, and
  // neither is needed. Also with no allergens and no stores at all.
  for (const chosen of [
    prefs(['CA'], ['peanut'], ['costco']),
    prefs(['CA']),
    prefs(['NY', 'TX']),
  ]) {
    const relevance = evaluatePersonalRelevance(salmonella, chosen);
    assert.equal(relevance.geographic, 'matches');
    assert.equal(relevance.affectsMe, true);
    assert.deepEqual(relevance.matchedAllergens, []);
    assert.deepEqual(relevance.matchedRetailers, []);
    assert.deepEqual(
      affectsYouMatches([salmonella], chosen, NOW).map((m) => m.id),
      ['nationwide-salmonella'],
    );
  }
});

test('a Nationwide non-allergen hazard counts for ANY chosen states: foreign material, chemical, integrity, unknown', () => {
  const hazards = [
    { category: 'foreign_material', agent: null, reason: 'Possible foreign matter contamination' },
    { category: 'chemical_contamination', agent: null, reason: 'Elevated lead levels' },
    { category: 'product_integrity', agent: null, reason: 'Underprocessing' },
    { category: 'unknown', agent: null, reason: 'See notice' },
    { category: 'microbial_contamination', agent: 'Listeria monocytogenes' },
  ];
  const states = [['AL'], ['WA', 'OR'], ['DC'], ['FL', 'GA', 'SC', 'NC'], ['PR']];
  for (const [i, hazard] of hazards.entries()) {
    const item = recall(`nat-${hazard.category}`, { hazard });
    for (const chosen of states) {
      assert.equal(
        evaluatePersonalRelevance(item, prefs(chosen)).affectsMe,
        true,
        `${hazard.category} did not count for ${chosen.join('+')} (${i})`,
      );
    }
  }
});

test('Building, Ready and the Feed’s Affects You include the same Nationwide recalls and count them identically', () => {
  const items = [
    recall('nat-salmonella'),
    recall('nat-foreign', {
      hazard: { category: 'foreign_material', agent: null, reason: 'Metal' },
    }),
    recall('texas-only', { scope: 'states', states: ['Texas'] }),
    recall('old-nat', { daysAgo: 120 }),
    recall('nat-no-image', { imaged: false }),
  ];
  const chosen = prefs(['OH'], ['milk'], ['kroger']);
  // The Feed's Affects You list: the same sections call the Feed makes.
  const feedAffects = buildAffectsMeSections(
    items,
    (item) => evaluatePersonalRelevance(item, chosen),
    { now: NOW },
  ).affects.map((item) => item.id);
  const readyMatches = affectsYouMatches(items, chosen, NOW).map((item) => item.id);
  const building = buildingData({ status: 'ready', items }, false, chosen, NOW);
  const ready = buildReadyPreview({ status: 'ready', items }, chosen, TODAY, NOW);
  assert.deepEqual(readyMatches, feedAffects);
  assert.deepEqual([...readyMatches].sort(), ['nat-foreign', 'nat-no-image', 'nat-salmonella']);
  assert.ok(building.kind === 'usable');
  assert.equal(building.total, 3);
  assert.equal(previewMatchCount(ready), 3);
});

test('the one filter that lowers a Nationwide count: an identified allergen-only recall is withheld from a shopper who chose none of its allergens — including a shopper who chose no allergens at all (C5.2B, unchanged here)', () => {
  const milkOnly = recall('nat-milk', {
    hazard: { category: 'allergen', agent: 'Undeclared Milk', reason: 'Undeclared milk' },
  });
  // Milk chosen: counted. Peanut only, or no allergens: withheld, by the
  // existing product rule — All Recalls still lists it. Recorded here so the
  // founder can confirm the rule rather than mistake it for a data gap. The
  // rule fires only when the source names the allergen in its own
  // `Undeclared …` form (domain/hazard `normalizedAllergenTokens`); an
  // allergen notice worded any other way is never withheld.
  assert.equal(evaluatePersonalRelevance(milkOnly, prefs(['CA'], ['milk'])).affectsMe, true);
  assert.equal(evaluatePersonalRelevance(milkOnly, prefs(['CA'], ['peanut'])).affectsMe, false);
  assert.equal(evaluatePersonalRelevance(milkOnly, prefs(['CA'])).affectsMe, false);
  // An allergen notice whose allergen is NOT identified is never withheld.
  const unnamed = recall('nat-unnamed-allergen', {
    hazard: { category: 'allergen', agent: null, reason: 'Undeclared allergen' },
  });
  assert.equal(evaluatePersonalRelevance(unnamed, prefs(['CA'])).affectsMe, true);
});
