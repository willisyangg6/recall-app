/**
 * The approved C3.2 hierarchy, proved dimension by dimension, plus the
 * invariants that say what this milestone must NOT have changed.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { UserRecallPreferences } from '@/domain/preferences';
import type {
  Classification,
  Geography,
  OfficialClass,
  TimelineEntry,
} from '@/domain/recall-types';
import { consumerRiskTier } from '@/domain/risk-tier';
import {
  affectsMePriority,
  buildAffectsMeSections,
  compareAffectsMePriority,
  explainAffectsMePriority,
} from './affects-me-ranking';
import { buildFeedSections } from './feed-relevance';
import type { FeedItem } from './recall-feed';
import { evaluatePersonalRelevance, pushEligible } from './relevance';
import { riskView } from './risk-display';

const NOW = new Date('2026-08-26T12:00:00Z');
/** The 60-day boundary sits at 2026-06-27; these are comfortably either side. */
const RECENT_DAY = '2026-08-20';
const OLD_DAY = '2026-01-15';

/** California; Sesame + Peanuts; Costco + Trader Joe's — the §35 example user. */
const CALIFORNIAN: UserRecallPreferences = {
  state: 'CA',
  allergens: ['sesame', 'peanut'],
  retailers: ['costco', 'trader-joes'],
};

function geo(scope: Geography['scope'], states: string[] = []): Geography {
  return { scope, states, confidence: 'stated', sourceText: null };
}

function classes(...set: OfficialClass[]): Classification {
  if (set.length === 0)
    return { value: 'not_yet_classified', sourceText: null, officialClasses: [] };
  if (set.length === 1) return { value: set[0], sourceText: null, officialClasses: set };
  return { value: 'multiple_classes', sourceText: null, officialClasses: set };
}

const PHA_CLASSIFICATION: Classification = {
  value: 'not_applicable_pha',
  sourceText: null,
  officialClasses: [],
};

function published(occurredAt: string): TimelineEntry {
  return {
    occurredAt,
    kind: 'published',
    summary: 'Recall published.',
    causedBySnapshotIds: [],
    material: false,
  };
}

function materialEntry(
  occurredAt: string,
  kind: TimelineEntry['kind'] = 'expanded',
): TimelineEntry {
  return {
    occurredAt,
    kind,
    summary: 'The agency expanded this recall.',
    causedBySnapshotIds: [],
    material: true,
    ruleId: kind === 'classified' ? 'classification_assigned' : 'expansion_products',
  };
}

function bookkeepingEntry(occurredAt: string): TimelineEntry {
  return {
    occurredAt,
    kind: 'source_updated',
    summary: 'Source record updated (no consumer-relevant change).',
    causedBySnapshotIds: [],
    material: false,
  };
}

let seq = 0;
function item(overrides: Partial<FeedItem> = {}): FeedItem {
  const publishedAt = overrides.publishedAt ?? RECENT_DAY;
  seq += 1;
  return {
    id: `case-${String(seq).padStart(3, '0')}`,
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    title: 'Test recall',
    classification: classes('class_I'),
    hazardCategory: 'allergen',
    publishedAt,
    lastPublicActivityAt: publishedAt,
    reasonText: null,
    pathogenOrAllergen: null,
    firmName: null,
    brands: [],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    geography: geo('unknown'),
    officialUrl: 'https://example.gov',
    timeline: [published(publishedAt)],
    ...overrides,
  };
}

function relevanceOf(prefs: UserRecallPreferences) {
  return (candidate: FeedItem) =>
    evaluatePersonalRelevance(
      {
        geography: candidate.geography,
        pathogenOrAllergen: candidate.pathogenOrAllergen,
        retailerNames: candidate.retailerNames,
        hazardCategory: candidate.hazardCategory,
        reasonText: candidate.reasonText,
      },
      prefs,
    );
}

function rank(items: FeedItem[], prefs: UserRecallPreferences = CALIFORNIAN) {
  return buildAffectsMeSections(items, relevanceOf(prefs), { now: NOW });
}

function order(items: FeedItem[], prefs: UserRecallPreferences = CALIFORNIAN): string[] {
  return rank(items, prefs).affects.map((entry) => entry.id);
}

// ── Dimension 1: consumer risk leads ─────────────────────────────────────────

test('risk is the first dimension: Critical, High, Moderate, Pending/Unrated, Low, Minimal', () => {
  const minimal = item({ classification: classes('class_III'), geography: geo('nationwide') });
  const unrated = item({ classification: PHA_CLASSIFICATION, geography: geo('nationwide') });
  const critical = item({ classification: classes('class_I'), geography: geo('nationwide') });
  const low = item({
    classification: classes('class_II', 'class_III'),
    geography: geo('nationwide'),
  });
  const pending = item({ classification: classes(), geography: geo('nationwide') });
  const high = item({
    classification: classes('class_I', 'class_II'),
    geography: geo('nationwide'),
  });
  const moderate = item({ classification: classes('class_II'), geography: geo('nationwide') });

  assert.deepEqual(order([minimal, unrated, critical, low, pending, high, moderate]), [
    critical.id,
    high.id,
    moderate.id,
    // Pending and Unrated share one position; the id tie-break settles them.
    ...[pending.id, unrated.id].sort(),
    low.id,
    minimal.id,
  ]);
});

test('Critical with confirmed geography outranks High with an exact personal signal', () => {
  const criticalPlain = item({
    classification: classes('class_I'),
    geography: geo('states', ['California']),
  });
  const highWithBoth = item({
    classification: classes('class_I', 'class_II'),
    geography: geo('states', ['California']),
    pathogenOrAllergen: 'Undeclared sesame',
    retailerNames: ['Costco'],
  });
  assert.deepEqual(order([highWithBoth, criticalPlain]), [criticalPlain.id, highWithBoth.id]);
});

test('Pending and Unrated rank below Moderate and above Low — and are never relabeled', () => {
  const pending = item({ classification: classes() });
  const unrated = item({ classification: PHA_CLASSIFICATION, noticeType: 'public_health_alert' });

  assert.equal(consumerRiskTier(pending.classification), 'pending');
  assert.equal(consumerRiskTier(unrated.classification), 'unrated');
  // Ordering never becomes a label: the risk layer still says Pending / Not
  // rated, and neither is badged as a rated tier on a card.
  assert.equal(riskView(pending.classification, 'FDA').tier, 'pending');
  assert.equal(riskView(pending.classification, 'FDA').badgeLabel, null);
  assert.equal(riskView(unrated.classification, 'FSIS').tier, 'unrated');
  assert.equal(riskView(unrated.classification, 'FSIS').badgeLabel, null);

  const pendingPriority = affectsMePriority(pending, relevanceOf(CALIFORNIAN)(pending));
  const unratedPriority = affectsMePriority(unrated, relevanceOf(CALIFORNIAN)(unrated));
  const moderate = item({ classification: classes('class_II') });
  const low = item({ classification: classes('class_II', 'class_III') });
  const moderatePriority = affectsMePriority(moderate, relevanceOf(CALIFORNIAN)(moderate));
  const lowPriority = affectsMePriority(low, relevanceOf(CALIFORNIAN)(low));

  assert.equal(pendingPriority.riskPriority, unratedPriority.riskPriority);
  assert.ok(moderatePriority.riskPriority < pendingPriority.riskPriority);
  assert.ok(pendingPriority.riskPriority < lowPriority.riskPriority);
});

// ── Dimension 2: geographic confidence ───────────────────────────────────────

test('within equal risk, confirmed geography outranks unknown geography with signals', () => {
  const confirmed = item({ geography: geo('states', ['California']) });
  const unknownWithBoth = item({
    geography: geo('unknown'),
    pathogenOrAllergen: 'Undeclared sesame',
    retailerNames: ['Costco'],
  });
  assert.deepEqual(order([unknownWithBoth, confirmed]), [confirmed.id, unknownWithBoth.id]);
});

test('explicit state inclusion and nationwide are equal geographic confidence', () => {
  const stateListed = item({ geography: geo('states', ['California', 'Nevada']) });
  const nationwide = item({ geography: geo('nationwide') });
  const a = affectsMePriority(stateListed, relevanceOf(CALIFORNIAN)(stateListed));
  const b = affectsMePriority(nationwide, relevanceOf(CALIFORNIAN)(nationwide));
  assert.equal(a.geographyPriority, 0);
  assert.equal(b.geographyPriority, 0);
  // The distinction is carried by the reason chip, not by the position.
  assert.deepEqual(
    relevanceOf(CALIFORNIAN)(stateListed).reasons.map((r) => r.label),
    ['Affects California'],
  );
  assert.deepEqual(
    relevanceOf(CALIFORNIAN)(nationwide).reasons.map((r) => r.label),
    ['Nationwide recall'],
  );
});

test('an authoritative geographic exclusion still overrides every personal signal', () => {
  const excluded = item({
    classification: classes('class_I'),
    geography: geo('states', ['Maine']),
    pathogenOrAllergen: 'Undeclared sesame and peanuts',
    retailerNames: ['Costco', "Trader Joe's"],
  });
  const ordinary = item({ classification: classes('class_III'), geography: geo('nationwide') });
  const sections = rank([excluded, ordinary]);
  assert.deepEqual(
    sections.affects.map((i) => i.id),
    [ordinary.id],
  );
  assert.deepEqual(sections.older, []);
});

// ── Dimension 3: personal-signal strength ────────────────────────────────────

test('allergen + retailer > allergen > retailer > no signal, at equal risk and geography', () => {
  const both = item({
    geography: geo('nationwide'),
    pathogenOrAllergen: 'Undeclared sesame',
    retailerNames: ['Costco'],
  });
  const allergenOnly = item({
    geography: geo('nationwide'),
    pathogenOrAllergen: 'Undeclared sesame',
  });
  const retailerOnly = item({ geography: geo('nationwide'), retailerNames: ['Costco'] });
  const neither = item({ geography: geo('nationwide') });
  assert.deepEqual(order([neither, retailerOnly, allergenOnly, both]), [
    both.id,
    allergenOnly.id,
    retailerOnly.id,
    neither.id,
  ]);
});

test('signals are boolean categories — matching three retailers is not worth more than one', () => {
  const oneRetailer = item({ geography: geo('nationwide'), retailerNames: ['Costco'] });
  const twoRetailers = item({
    geography: geo('nationwide'),
    retailerNames: ['Costco', "Trader Joe's"],
  });
  const a = affectsMePriority(oneRetailer, relevanceOf(CALIFORNIAN)(oneRetailer));
  const b = affectsMePriority(twoRetailers, relevanceOf(CALIFORNIAN)(twoRetailers));
  assert.equal(a.signalPriority, b.signalPriority);
  assert.equal(relevanceOf(CALIFORNIAN)(twoRetailers).matchedRetailers.length, 2);
});

test('two matched allergens do not outrank one matched allergen', () => {
  const one = item({ geography: geo('nationwide'), pathogenOrAllergen: 'Undeclared sesame' });
  const two = item({
    geography: geo('nationwide'),
    pathogenOrAllergen: 'Undeclared sesame and peanuts',
  });
  const a = affectsMePriority(one, relevanceOf(CALIFORNIAN)(one));
  const b = affectsMePriority(two, relevanceOf(CALIFORNIAN)(two));
  assert.equal(a.signalPriority, b.signalPriority);
  assert.equal(relevanceOf(CALIFORNIAN)(two).matchedAllergens.length, 2);
});

test('the strongest possible case ranks first in a mixed field', () => {
  const best = item({
    classification: classes('class_I'),
    geography: geo('states', ['California']),
    pathogenOrAllergen: 'Undeclared sesame',
    retailerNames: ['Costco'],
  });
  const rivals = [
    item({ classification: classes('class_I'), geography: geo('nationwide') }),
    item({
      classification: classes('class_I', 'class_II'),
      geography: geo('states', ['California']),
      pathogenOrAllergen: 'Undeclared peanuts',
      retailerNames: ["Trader Joe's"],
    }),
    item({
      classification: classes('class_I'),
      geography: geo('unknown'),
      pathogenOrAllergen: 'Undeclared sesame',
      retailerNames: ['Costco'],
    }),
  ];
  assert.equal(order([...rivals, best])[0], best.id);
});

// ── Dimension 4: material activity ───────────────────────────────────────────

test('within an identical relevance tuple, the latest material activity ranks first', () => {
  const quiet = item({
    publishedAt: '2026-07-01',
    geography: geo('nationwide'),
    timeline: [published('2026-07-01')],
  });
  const updated = item({
    publishedAt: '2026-07-01',
    geography: geo('nationwide'),
    timeline: [published('2026-07-01'), materialEntry('2026-08-20', 'classified')],
  });
  assert.deepEqual(order([quiet, updated]), [updated.id, quiet.id]);
});

test('a material classification update raises an older recall back into recent activity', () => {
  const reclassified = item({
    publishedAt: OLD_DAY,
    lastPublicActivityAt: '2026-08-04',
    geography: geo('nationwide'),
    timeline: [published(OLD_DAY), materialEntry('2026-08-04', 'classified')],
  });
  const sections = rank([reclassified]);
  assert.deepEqual(
    sections.affects.map((i) => i.id),
    [reclassified.id],
  );
  assert.deepEqual(sections.older, []);
});

test('a bookkeeping source edit cannot raise an old recall — even though it moved lastPublicActivityAt', () => {
  const churned = item({
    publishedAt: OLD_DAY,
    // The agency re-touched the page yesterday; the diff found nothing
    // consumer-relevant, so the pipeline logged a non-material entry.
    lastPublicActivityAt: '2026-08-25',
    geography: geo('nationwide'),
    timeline: [published(OLD_DAY), bookkeepingEntry('2026-08-25')],
  });
  const sections = rank([churned]);
  assert.deepEqual(sections.affects, []);
  assert.deepEqual(
    sections.older.map((i) => i.id),
    [churned.id],
  );
});

test('a retailer backfill cannot raise an old recall: it writes no timeline entry at all', () => {
  // The repair patches projection.retailerNames only (server/retailer-backfill.ts).
  const before = item({
    publishedAt: OLD_DAY,
    geography: geo('nationwide'),
    timeline: [published(OLD_DAY)],
  });
  const afterBackfill: FeedItem = { ...before, retailerNames: ['Costco'] };
  assert.deepEqual(
    rank([before]).older.map((i) => i.id),
    [before.id],
  );
  assert.deepEqual(
    rank([afterBackfill]).older.map((i) => i.id),
    [afterBackfill.id],
  );
  assert.deepEqual(rank([afterBackfill]).affects, []);
});

// ── Dimensions 5–6: announcement date, then a total order ────────────────────

test('with equal material activity, the newer announcement ranks first', () => {
  const older = item({
    publishedAt: '2026-07-01',
    geography: geo('nationwide'),
    timeline: [published('2026-07-01'), materialEntry('2026-08-20')],
  });
  const newer = item({
    publishedAt: '2026-08-01',
    geography: geo('nationwide'),
    timeline: [published('2026-08-01'), materialEntry('2026-08-20')],
  });
  assert.deepEqual(order([older, newer]), [newer.id, older.id]);
});

test('ordering is stable and total: repeated sorts of any input permutation agree', () => {
  const items = [
    item({ id: 'zzz', geography: geo('nationwide') }),
    item({ id: 'aaa', geography: geo('nationwide') }),
    item({ id: 'mmm', geography: geo('nationwide') }),
  ];
  const expected = ['aaa', 'mmm', 'zzz'];
  assert.deepEqual(order(items), expected);
  assert.deepEqual(order([...items].reverse()), expected);
  assert.deepEqual(order([items[1], items[2], items[0]]), expected);
  // Two runs over the same list must not drift.
  assert.deepEqual(order(items), order(items));
});

test('the comparator never reports two distinct cases as equal', () => {
  const a = item({ id: 'a', geography: geo('nationwide') });
  const b = item({ id: 'b', geography: geo('nationwide') });
  const pa = affectsMePriority(a, relevanceOf(CALIFORNIAN)(a));
  const pb = affectsMePriority(b, relevanceOf(CALIFORNIAN)(b));
  assert.notEqual(compareAffectsMePriority(pa, pb), 0);
  assert.equal(compareAffectsMePriority(pa, pa), 0);
  assert.equal(
    Math.sign(compareAffectsMePriority(pa, pb)),
    -Math.sign(compareAffectsMePriority(pb, pa)),
  );
});

test('a geography correction moves a case by exactly one tier, and nothing else', () => {
  // C5.2A repairs `projection.geography` only. The ranking rules are
  // untouched, so a corrected case moves for exactly the reason its geography
  // changed — from "unknown, kept by a personal signal" to "confirmed" — and
  // every other case holds its place.
  const other = item({ geography: geo('states', ['California']), publishedAt: '2026-07-01' });
  const beforeRepair = item({
    geography: geo('unknown'),
    retailerNames: ['Costco'],
    publishedAt: RECENT_DAY,
  });
  const afterRepair: FeedItem = {
    ...beforeRepair,
    geography: geo('states', ['California']),
  };

  const before = affectsMePriority(beforeRepair, relevanceOf(CALIFORNIAN)(beforeRepair));
  const after = affectsMePriority(afterRepair, relevanceOf(CALIFORNIAN)(afterRepair));
  assert.equal(before.geographyPriority, 1, 'unknown geography, kept by the retailer signal');
  assert.equal(after.geographyPriority, 0, 'the source’s own state list, once it is read');
  // The geography tier is the ONLY dimension that moved.
  assert.deepEqual({ ...before, geographyPriority: 0 }, { ...after, geographyPriority: 0 });

  // Eligibility is unchanged — the case affected this user before and after —
  // and it simply overtakes the older confirmed case it used to rank behind.
  assert.deepEqual(order([other, beforeRepair]), [other.id, beforeRepair.id]);
  assert.deepEqual(order([other, afterRepair]), [afterRepair.id, other.id]);
});

test('a corrected state list that excludes the user is final, as it always was', () => {
  // The repair can also move a case OUT: once the source's own state list is
  // read, a user outside it is authoritatively excluded, and no personal
  // signal overrides that. Same rule as before — new input, not new behavior.
  const unknown = item({
    geography: geo('unknown'),
    pathogenOrAllergen: 'Undeclared sesame',
    retailerNames: ['Costco'],
  });
  const corrected: FeedItem = { ...unknown, geography: geo('states', ['Ohio', 'Indiana']) };
  const before = rank([unknown]);
  assert.deepEqual(
    before.affects.map((entry) => entry.id),
    [unknown.id],
    'unknown geography plus a personal signal still qualifies',
  );
  const after = rank([corrected]);
  assert.equal(after.affects.length, 0, 'an authoritative exclusion is final');
  assert.equal(after.older.length, 0, 'and it does not leak into older notices either');
});

// ── Sections ─────────────────────────────────────────────────────────────────

test('every case appears in at most one section', () => {
  const items = [
    item({ geography: geo('states', ['California']) }),
    item({ geography: geo('unknown') }),
    item({ geography: geo('unknown'), retailerNames: ['Costco'] }),
    item({ geography: geo('states', ['Maine']) }),
    item({
      publishedAt: OLD_DAY,
      geography: geo('nationwide'),
      timeline: [published(OLD_DAY)],
    }),
    item({
      publishedAt: OLD_DAY,
      geography: geo('unknown'),
      timeline: [published(OLD_DAY)],
    }),
  ];
  const { affects, older } = rank(items);
  const seen = [...affects, ...older].map((i: FeedItem) => i.id);
  assert.equal(new Set(seen).size, seen.length);
  // Excluded Maine, and BOTH unknown-geography cases with no personal signal,
  // appear nowhere: only the California case, the Costco one, and the older
  // nationwide one qualify.
  assert.equal(seen.length, 3);
});

test('unknown geography with no personal signal appears in NO Affects Me section', () => {
  // C5.2B removed the generic "Location not specified" section: a notice that
  // says nothing about this user is not placed at all, and All Recalls holds it.
  const silent = item({ geography: geo('unknown') });
  const { affects, older } = rank([silent]);
  assert.deepEqual(affects, []);
  assert.deepEqual(older, []);
  // And the relevance layer still refuses to claim anything about it.
  assert.deepEqual(relevanceOf(CALIFORNIAN)(silent).reasons, []);
});

test('an unknown-location notice with a real match ranks in the main flow', () => {
  const prefs: UserRecallPreferences = { state: null, allergens: ['sesame'], retailers: [] };
  const silent = item({ geography: geo('unknown') });
  const matching = item({ geography: geo('unknown'), pathogenOrAllergen: 'Undeclared sesame' });
  const sections = rank([silent, matching], prefs);
  assert.deepEqual(
    sections.affects.map((i) => i.id),
    [matching.id],
  );
  assert.deepEqual(sections.older, []);
});

// ── Invariants: what C3.2 must NOT have changed ──────────────────────────────

test('Affects Me eligibility is unchanged: the sections hold exactly the qualifying cases', () => {
  const items = [
    item({ geography: geo('nationwide') }),
    item({ geography: geo('states', ['California']) }),
    item({ geography: geo('states', ['Maine']), pathogenOrAllergen: 'Undeclared sesame' }),
    item({ geography: geo('unknown') }),
    item({ geography: geo('unknown'), retailerNames: ["Trader Joe's"] }),
    item({ publishedAt: OLD_DAY, geography: geo('nationwide'), timeline: [published(OLD_DAY)] }),
  ];
  const eligible = items
    .filter((i) => relevanceOf(CALIFORNIAN)(i).affectsMe)
    .map((i) => i.id)
    .sort();
  const { affects, older } = rank(items);
  assert.deepEqual([...affects, ...older].map((i) => i.id).sort(), eligible);
});

test('All Recalls sectioning and ordering are untouched by material activity', () => {
  const churned = item({
    publishedAt: OLD_DAY,
    // Bookkeeping moved public activity but not material activity: All Recalls
    // must still treat this as recent, exactly as it did before C3.2.
    lastPublicActivityAt: '2026-08-25',
    timeline: [published(OLD_DAY), bookkeepingEntry('2026-08-25')],
  });
  const fresh = item({ publishedAt: RECENT_DAY });
  const stale = item({
    publishedAt: OLD_DAY,
    lastPublicActivityAt: OLD_DAY,
    timeline: [published(OLD_DAY)],
  });
  const { recent, olderActive } = buildFeedSections([churned, fresh, stale], NOW);
  assert.deepEqual(
    recent.map((i) => i.id),
    [churned.id, fresh.id],
  );
  assert.deepEqual(
    olderActive.map((i) => i.id),
    [stale.id],
  );
});

test('C5.2B: All Recalls is byte-identical — personalization cannot touch it', () => {
  // All Recalls never sees preferences at all, so the strongest statement is
  // the direct one: the same input produces the same output, deeply equal,
  // including for the cases Affects Me now withholds.
  const corpus = [
    item({ geography: geo('states', ['California']) }),
    item({ geography: geo('unknown') }),
    item({ geography: geo('states', ['Maine']), pathogenOrAllergen: 'undeclared sesame' }),
    // Known allergen mismatch for every profile below.
    item({
      geography: geo('nationwide'),
      hazardCategory: 'allergen',
      reasonText: 'Unreported Allergens',
      pathogenOrAllergen: 'undeclared milk',
    }),
    item({ publishedAt: OLD_DAY, timeline: [published(OLD_DAY)], geography: geo('nationwide') }),
  ];
  const baseline = buildFeedSections(corpus, NOW);

  for (const prefs of [
    CALIFORNIAN,
    { state: 'CA', allergens: [], retailers: [] } as UserRecallPreferences,
    { state: null, allergens: ['milk'], retailers: [] } as UserRecallPreferences,
  ]) {
    // Ranking the same corpus for a profile must not disturb All Recalls.
    rank(corpus, prefs);
    const after = buildFeedSections(corpus, NOW);
    assert.deepEqual(after, baseline, JSON.stringify(prefs));
  }
  // Membership and count are complete: every case is in exactly one section.
  assert.equal(baseline.recent.length + baseline.olderActive.length, corpus.length);
});

test('C5.2B: a withheld allergen-only recall appears in NO Affects Me section', () => {
  const milkOnly = item({
    geography: geo('states', ['California']),
    hazardCategory: 'allergen',
    reasonText: 'Unreported Allergens',
    pathogenOrAllergen: 'undeclared milk',
  });
  const staleMilkOnly = item({
    geography: geo('states', ['California']),
    hazardCategory: 'allergen',
    reasonText: 'Unreported Allergens',
    pathogenOrAllergen: 'undeclared milk',
    publishedAt: OLD_DAY,
    timeline: [published(OLD_DAY)],
  });
  const sections = rank([milkOnly, staleMilkOnly]);
  // Not in the recent list, and — the leak this guards — not in older either.
  assert.deepEqual(sections.affects, []);
  assert.deepEqual(sections.older, []);
});

test('C5.2B: every placed notice has an explainable qualifying reason', () => {
  const corpus = [
    item({ geography: geo('states', ['California']) }),
    item({ geography: geo('nationwide') }),
    item({ geography: geo('unknown'), retailerNames: ['Costco'] }),
    item({ geography: geo('unknown'), pathogenOrAllergen: 'Undeclared sesame' }),
    item({ geography: geo('unknown') }),
    item({ geography: geo('states', ['Maine']), pathogenOrAllergen: 'Undeclared sesame' }),
    item({
      geography: geo('nationwide'),
      hazardCategory: 'allergen',
      reasonText: 'Unreported Allergens',
      pathogenOrAllergen: 'undeclared milk',
    }),
  ];
  const { affects, older } = rank(corpus);
  const placed = [...affects, ...older];
  for (const entry of placed) {
    const reasons = relevanceOf(CALIFORNIAN)(entry).reasons;
    assert.ok(reasons.length > 0, `${entry.id} must explain why it is here`);
  }
  // Exactly once, and only the qualifying ones.
  const ids = placed.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  const qualifying = corpus.filter((entry) => relevanceOf(CALIFORNIAN)(entry).affectsMe);
  assert.equal(placed.length, qualifying.length);
});

test('C5.2B: ranking of the notices that remain is unchanged', () => {
  // The comparator is untouched; only the eligible SET changed. With every
  // case eligible for this profile, the order is exactly the C3.2 order.
  const critical = item({ classification: classes('class_I'), geography: geo('nationwide') });
  const moderate = item({ classification: classes('class_II'), geography: geo('nationwide') });
  const unknownWithSignal = item({
    classification: classes('class_I'),
    geography: geo('unknown'),
    retailerNames: ['Costco'],
  });
  assert.deepEqual(order([moderate, unknownWithSignal, critical]), [
    critical.id,
    unknownWithSignal.id,
    moderate.id,
  ]);
});

test('push eligibility is unchanged: ranking is not part of the delivery decision', () => {
  const nationwideCritical = item({
    classification: classes('class_I'),
    geography: geo('nationwide'),
  });
  const excludedWithSignal = item({
    geography: geo('states', ['Maine']),
    pathogenOrAllergen: 'Undeclared sesame',
  });
  const facts = (i: FeedItem) => ({
    geography: i.geography,
    pathogenOrAllergen: i.pathogenOrAllergen,
    retailerNames: i.retailerNames,
    hazardCategory: i.hazardCategory,
    reasonText: i.reasonText,
  });
  assert.equal(pushEligible(facts(nationwideCritical), CALIFORNIAN), true);
  assert.equal(pushEligible(facts(excludedWithSignal), CALIFORNIAN), false);
  // No preferences at all: every deliverable event still qualifies.
  assert.equal(pushEligible(facts(excludedWithSignal), null), true);
});

// ── Review affordance ────────────────────────────────────────────────────────

test('a priority explains itself in review copy without exposing a score', () => {
  const best = item({
    id: 'explained',
    classification: classes('class_I'),
    publishedAt: '2026-07-01',
    geography: geo('states', ['California']),
    pathogenOrAllergen: 'Undeclared sesame',
    retailerNames: ['Costco'],
    timeline: [published('2026-07-01'), materialEntry('2026-08-04', 'classified')],
  });
  assert.equal(
    explainAffectsMePriority(affectsMePriority(best, relevanceOf(CALIFORNIAN)(best))),
    'critical · confirmed geography · allergen + retailer · activity 2026-08-04 · announced 2026-07-01',
  );
});
