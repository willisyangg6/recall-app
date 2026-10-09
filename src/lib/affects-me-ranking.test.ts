/**
 * Newest-first Affects me (2026-10-05): the one shared recency order, proved
 * on each thing that used to move a recall and no longer does, plus the
 * invariants this milestone must NOT have changed — eligibility, sections,
 * push, and the count the Ready preview and the Building step show.
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
import { BASELINE_RECALLS, BASELINE_RECORDED_AT } from '@/lib/baseline-recalls';
import {
  affectsMePriority,
  buildAffectsMeSections,
  compareAffectsMePriority,
  explainAffectsMePriority,
} from './affects-me-ranking';
import { buildFeedSections, tierForActivityDate } from './feed-relevance';
import { confirmedOpen } from './open-evidence';
import type { FeedItem } from './recall-feed';
import { compareRecency, sortNewestFirst } from './recency-order';
import { evaluatePersonalRelevance, pushEligible } from './relevance';
import { riskView } from './risk-display';

const NOW = new Date('2026-08-26T12:00:00Z');
/** The 60-day boundary sits at 2026-06-27; these are comfortably either side. */
const RECENT_DAY = '2026-08-20';
const OLD_DAY = '2026-01-15';

/** California; Sesame + Peanuts; Costco + Trader Joe's — the §35 example user. */
const CALIFORNIAN: UserRecallPreferences = {
  states: ['CA'],
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
  ruleId: TimelineEntry['ruleId'] = kind === 'classified'
    ? 'classification_assigned'
    : 'expansion_products',
): TimelineEntry {
  return {
    occurredAt,
    kind,
    summary: 'Authoritative change.',
    causedBySnapshotIds: [],
    material: true,
    ruleId,
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
    fdaOngoingAsOf: null,
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
    productNames: [],
    geography: geo('nationwide'),
    officialUrl: 'https://example.gov',
    timeline: [published(publishedAt)],
    ...overrides,
  };
}

function relevanceOf(prefs: UserRecallPreferences) {
  return (candidate: FeedItem) => evaluatePersonalRelevance(candidate, prefs);
}

function rank(items: FeedItem[], prefs: UserRecallPreferences = CALIFORNIAN) {
  return buildAffectsMeSections(items, relevanceOf(prefs), { now: NOW });
}

function order(items: FeedItem[], prefs: UserRecallPreferences = CALIFORNIAN): string[] {
  return rank(items, prefs).affects.map((entry) => entry.id);
}

// ── Newest first ─────────────────────────────────────────────────────────────

test('a newer Pending recall ranks ahead of an older Critical one', () => {
  const criticalOlder = item({ classification: classes('class_I'), publishedAt: '2026-08-01' });
  const pendingNewer = item({ classification: classes(), publishedAt: '2026-08-19' });
  assert.deepEqual(order([criticalOlder, pendingNewer]), [pendingNewer.id, criticalOlder.id]);
  // The labels are untouched: Pending stays Pending, Critical stays Critical.
  assert.equal(riskView(pendingNewer.classification, 'FDA', 'recall').badgeLabel, 'PENDING');
  assert.equal(riskView(criticalOlder.classification, 'FDA', 'recall').badgeLabel, 'CRITICAL');
});

test('a newer Moderate recall ranks ahead of an older Critical one', () => {
  const criticalOlder = item({ classification: classes('class_I'), publishedAt: '2026-08-05' });
  const moderateNewer = item({
    classification: classes('class_II', 'class_III'),
    publishedAt: '2026-08-21',
  });
  assert.equal(consumerRiskTier(moderateNewer.classification), 'moderate');
  assert.deepEqual(order([criticalOlder, moderateNewer]), [moderateNewer.id, criticalOlder.id]);
});

test('every tier on one day: risk decides nothing, the id decides everything', () => {
  const tiers = [
    item({ classification: classes('class_III') }),
    item({ classification: PHA_CLASSIFICATION, noticeType: 'public_health_alert' }),
    item({ classification: classes('class_I') }),
    item({ classification: classes('class_II', 'class_III') }),
    item({ classification: classes() }),
    item({ classification: classes('class_I', 'class_II') }),
    item({ classification: classes('class_II') }),
  ];
  assert.deepEqual(order(tiers), tiers.map((entry) => entry.id).sort());
});

// ── Match strength moves nothing ─────────────────────────────────────────────

test('a stronger preference match does not change the order: allergen + store, allergen, store, none', () => {
  const both = item({
    publishedAt: '2026-08-10',
    pathogenOrAllergen: 'Undeclared sesame',
    retailerNames: ['Costco'],
  });
  const allergenOnly = item({ publishedAt: '2026-08-12', pathogenOrAllergen: 'Undeclared sesame' });
  const retailerOnly = item({ publishedAt: '2026-08-14', retailerNames: ['Costco'] });
  const neither = item({ publishedAt: '2026-08-16' });
  // Newest first, which here is the REVERSE of signal strength.
  assert.deepEqual(order([both, allergenOnly, retailerOnly, neither]), [
    neither.id,
    retailerOnly.id,
    allergenOnly.id,
    both.id,
  ]);
  // The relevance layer still sees every signal — membership and card copy
  // keep them; only the position stopped reading them.
  assert.equal(relevanceOf(CALIFORNIAN)(both).matchedAllergens.length, 1);
  assert.equal(relevanceOf(CALIFORNIAN)(both).matchedRetailers.length, 1);
});

test('three matched stores are not worth more than one, and two allergens not more than one', () => {
  const one = item({ retailerNames: ['Costco'] });
  const three = item({
    retailerNames: ['Costco', "Trader Joe's", 'Costco Wholesale'],
    pathogenOrAllergen: 'Undeclared sesame and peanuts',
  });
  assert.deepEqual(affectsMePriority(one), { ...affectsMePriority(three), id: one.id });
  assert.deepEqual(order([three, one]), [one.id, three.id].sort());
});

test('confirmed geography does not outrank unknown geography kept by a signal', () => {
  const confirmedOlder = item({
    geography: geo('states', ['California']),
    publishedAt: '2026-08-10',
  });
  const unknownNewer = item({
    geography: geo('unknown'),
    pathogenOrAllergen: 'Undeclared sesame',
    publishedAt: '2026-08-18',
  });
  assert.deepEqual(order([confirmedOlder, unknownNewer]), [unknownNewer.id, confirmedOlder.id]);
});

test('a geography correction changes membership only, never a position among the eligible', () => {
  // C5.2A repairs `projection.geography` only. The sort key does not read
  // geography, so a corrected case holds exactly the place its dates give it.
  const other = item({ geography: geo('states', ['California']), publishedAt: '2026-08-01' });
  const beforeRepair = item({
    geography: geo('unknown'),
    retailerNames: ['Costco'],
    publishedAt: RECENT_DAY,
  });
  const afterRepair: FeedItem = { ...beforeRepair, geography: geo('states', ['California']) };
  assert.deepEqual(affectsMePriority(beforeRepair), affectsMePriority(afterRepair));
  assert.deepEqual(order([other, beforeRepair]), [beforeRepair.id, other.id]);
  assert.deepEqual(order([other, afterRepair]), [afterRepair.id, other.id]);
});

// ── Material activity: what may move a recall ────────────────────────────────

test('a meaningful official update resurfaces an old recall to the top', () => {
  const freshAnnouncement = item({ publishedAt: '2026-08-18' });
  const expanded = item({
    publishedAt: OLD_DAY,
    lastPublicActivityAt: '2026-08-24',
    timeline: [published(OLD_DAY), materialEntry('2026-08-24')],
  });
  const sections = rank([freshAnnouncement, expanded]);
  assert.deepEqual(
    sections.affects.map((i) => i.id),
    [expanded.id, freshAnnouncement.id],
  );
  assert.deepEqual(sections.older, []);
});

test('a material classification update raises an older recall back into recent activity', () => {
  const reclassified = item({
    publishedAt: OLD_DAY,
    lastPublicActivityAt: '2026-08-04',
    timeline: [published(OLD_DAY), materialEntry('2026-08-04', 'classified')],
  });
  const sections = rank([reclassified]);
  assert.deepEqual(
    sections.affects.map((i) => i.id),
    [reclassified.id],
  );
  assert.deepEqual(sections.older, []);
});

test('an enforcement-dated classification AFTER lastPublicActivityAt still counts — the key is not bounded by it', () => {
  // The live shape on 2026-10-05 (232 of 911 active cases): FDA's
  // classification date postdates the announcement page's last edit, because
  // enforcement records are never voiced into lastPublicActivityAt.
  const classified = item({
    publishedAt: '2026-05-01',
    lastPublicActivityAt: '2026-05-04',
    timeline: [published('2026-05-01'), materialEntry('2026-08-15', 'classified')],
  });
  const key = affectsMePriority(classified);
  assert.equal(key.materialActivityAt, '2026-08-15');
  assert.ok(key.materialActivityAt > classified.lastPublicActivityAt);
  assert.equal(tierForActivityDate(key.materialActivityAt, NOW), 'recent');
  assert.deepEqual(
    rank([classified]).affects.map((i) => i.id),
    [classified.id],
  );
});

test('the material source_updated kinds (illnesses, instructions) count: the flag is read, not the kind', () => {
  const instructions = item({
    publishedAt: OLD_DAY,
    timeline: [
      published(OLD_DAY),
      materialEntry('2026-08-22', 'source_updated', 'instructions_changed'),
    ],
  });
  const illnesses = item({
    publishedAt: OLD_DAY,
    timeline: [published(OLD_DAY), materialEntry('2026-08-23', 'source_updated', 'health_impact')],
  });
  assert.deepEqual(order([instructions, illnesses]), [illnesses.id, instructions.id]);
  assert.equal(affectsMePriority(instructions).materialActivityAt, '2026-08-22');
});

test('a same-day material entry bumps nothing: the case keeps its announcement date', () => {
  const sameDay = item({
    publishedAt: '2026-08-10',
    timeline: [published('2026-08-10'), materialEntry('2026-08-10', 'classified')],
  });
  assert.equal(affectsMePriority(sameDay).materialActivityAt, '2026-08-10');
  const plain = item({ publishedAt: '2026-08-10' });
  assert.deepEqual(order([sameDay, plain]), [sameDay.id, plain.id].sort());
});

test('a missing or empty timeline falls back to the announcement date', () => {
  const none = item({ publishedAt: '2026-08-12', timeline: [] });
  assert.equal(affectsMePriority(none).materialActivityAt, '2026-08-12');
  const withTime = item({ publishedAt: '2026-08-12T15:30:00.000Z', timeline: [] });
  assert.equal(affectsMePriority(withTime).materialActivityAt, '2026-08-12');
  assert.equal(affectsMePriority(withTime).publishedAt, '2026-08-12');
});

// ── What can never move a recall ─────────────────────────────────────────────

test('a wording edit cannot raise an old recall — even though it moved lastPublicActivityAt', () => {
  const churned = item({
    publishedAt: OLD_DAY,
    lastPublicActivityAt: '2026-08-25',
    timeline: [published(OLD_DAY), bookkeepingEntry('2026-08-25')],
  });
  const sections = rank([churned]);
  assert.deepEqual(sections.affects, []);
  assert.deepEqual(
    sections.older.map((i) => i.id),
    [churned.id],
  );
  // And among recent recalls a wording edit yesterday beats nothing announced earlier.
  const edited = item({
    publishedAt: '2026-08-01',
    lastPublicActivityAt: '2026-08-25',
    timeline: [published('2026-08-01'), bookkeepingEntry('2026-08-25')],
  });
  const later = item({ publishedAt: '2026-08-02' });
  assert.deepEqual(order([edited, later]), [later.id, edited.id]);
});

test('an internal write cannot raise an old recall: a retailer backfill writes no timeline entry', () => {
  const before = item({ publishedAt: OLD_DAY, timeline: [published(OLD_DAY)] });
  const afterBackfill: FeedItem = { ...before, retailerNames: ['Costco'] };
  assert.deepEqual(affectsMePriority(before), affectsMePriority(afterBackfill));
  assert.deepEqual(rank([afterBackfill]).affects, []);
  assert.deepEqual(
    rank([afterBackfill]).older.map((i) => i.id),
    [afterBackfill.id],
  );
});

test('a repair entry (material: false, our clock) and agency closure move nothing', () => {
  const repaired = item({
    publishedAt: OLD_DAY,
    timeline: [
      published(OLD_DAY),
      {
        occurredAt: '2026-08-25T10:00:00.000Z',
        kind: 'corrected',
        summary: 'The app corrected its reading of the original official notice.',
        causedBySnapshotIds: [],
        material: false,
        repair: {
          fingerprint: 'x',
          derivationContract: 'c',
          wave: 'w',
          changedCategories: [],
          consumerVisible: true,
          notificationEventCreated: false,
        },
      },
      {
        occurredAt: '2026-08-25',
        kind: 'closed',
        summary: 'Recall closed by the agency.',
        causedBySnapshotIds: [],
        material: false,
      },
    ],
  });
  assert.equal(affectsMePriority(repaired).materialActivityAt, OLD_DAY);
});

// ── Ties and totality ────────────────────────────────────────────────────────

test('with equal material activity, the newer announcement ranks first', () => {
  const older = item({
    publishedAt: '2026-07-01',
    timeline: [published('2026-07-01'), materialEntry('2026-08-20')],
  });
  const newer = item({
    publishedAt: '2026-08-01',
    timeline: [published('2026-08-01'), materialEntry('2026-08-20')],
  });
  assert.deepEqual(order([older, newer]), [newer.id, older.id]);
});

test('ordering is stable and total: repeated sorts of any input permutation agree', () => {
  const items = [item({ id: 'zzz' }), item({ id: 'aaa' }), item({ id: 'mmm' })];
  const expected = ['aaa', 'mmm', 'zzz'];
  assert.deepEqual(order(items), expected);
  assert.deepEqual(order([...items].reverse()), expected);
  assert.deepEqual(order([items[1], items[2], items[0]]), expected);
  assert.deepEqual(order(items), order(items));
});

test('the comparator never reports two distinct cases as equal', () => {
  const a = item({ id: 'a' });
  const b = item({ id: 'b' });
  const pa = affectsMePriority(a);
  const pb = affectsMePriority(b);
  assert.notEqual(compareAffectsMePriority(pa, pb), 0);
  assert.equal(compareAffectsMePriority(pa, pa), 0);
  assert.equal(
    Math.sign(compareAffectsMePriority(pa, pb)),
    -Math.sign(compareAffectsMePriority(pb, pa)),
  );
});

test('Affects me, All recalls and the plain comparator are ONE order', () => {
  const corpus = [
    item({ publishedAt: '2026-08-01' }),
    item({ publishedAt: OLD_DAY, timeline: [published(OLD_DAY), materialEntry('2026-08-22')] }),
    item({ publishedAt: '2026-08-22' }),
    item({ publishedAt: '2026-08-10', classification: classes() }),
    item({ publishedAt: '2026-08-10', classification: classes('class_I') }),
  ];
  const shared = sortNewestFirst(corpus).map((i) => i.id);
  assert.deepEqual(order(corpus), shared);
  assert.deepEqual(
    buildFeedSections(corpus, NOW).recent.map((i) => i.id),
    shared,
  );
  assert.deepEqual(
    [...corpus].sort(compareRecency).map((i) => i.id),
    shared,
  );
});

// ── Sections ─────────────────────────────────────────────────────────────────

test('every case appears in at most one section', () => {
  const items = [
    item({ geography: geo('states', ['California']) }),
    item({ geography: geo('unknown') }),
    item({ geography: geo('unknown'), retailerNames: ['Costco'] }),
    item({ geography: geo('states', ['Maine']) }),
    item({ publishedAt: OLD_DAY, timeline: [published(OLD_DAY)] }),
    item({ publishedAt: OLD_DAY, geography: geo('unknown'), timeline: [published(OLD_DAY)] }),
  ];
  const { affects, older } = rank(items);
  const seen = [...affects, ...older].map((i: FeedItem) => i.id);
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(seen.length, 3);
});

test('unknown geography with no personal signal appears in NO Affects Me section', () => {
  const silent = item({ geography: geo('unknown') });
  const { affects, older } = rank([silent]);
  assert.deepEqual(affects, []);
  assert.deepEqual(older, []);
  assert.deepEqual(relevanceOf(CALIFORNIAN)(silent).reasons, []);
});

test('an authoritative geographic exclusion never enters Affects Me, whatever its signals', () => {
  const excluded = item({
    geography: geo('states', ['Maine']),
    pathogenOrAllergen: 'Undeclared sesame and peanuts',
    retailerNames: ['Costco', "Trader Joe's"],
  });
  const ordinary = item({ classification: classes('class_III') });
  const sections = rank([excluded, ordinary]);
  assert.deepEqual(
    sections.affects.map((i) => i.id),
    [ordinary.id],
  );
  assert.deepEqual(sections.older, []);
});

test('an unknown-location notice with a real match ranks in the main flow', () => {
  const prefs: UserRecallPreferences = { states: [], allergens: ['sesame'], retailers: [] };
  const silent = item({ geography: geo('unknown') });
  const matching = item({ geography: geo('unknown'), pathogenOrAllergen: 'Undeclared sesame' });
  const sections = rank([silent, matching], prefs);
  assert.deepEqual(
    sections.affects.map((i) => i.id),
    [matching.id],
  );
  assert.deepEqual(sections.older, []);
});

// ── Invariants: what 2026-10-05 must NOT have changed ────────────────────────

test('Affects Me eligibility is unchanged: the sections hold exactly the qualifying cases', () => {
  const items = [
    item({ geography: geo('nationwide') }),
    item({ geography: geo('states', ['California']) }),
    item({ geography: geo('states', ['Maine']), pathogenOrAllergen: 'Undeclared sesame' }),
    item({ geography: geo('unknown') }),
    item({ geography: geo('unknown'), retailerNames: ["Trader Joe's"] }),
    item({ publishedAt: OLD_DAY, timeline: [published(OLD_DAY)] }),
  ];
  const eligible = items
    .filter((i) => relevanceOf(CALIFORNIAN)(i).affectsMe)
    .map((i) => i.id)
    .sort();
  const { affects, older } = rank(items);
  assert.deepEqual([...affects, ...older].map((i) => i.id).sort(), eligible);
});

test('the matching count is unchanged by the order, on the synthetic corpus and the real offline baseline', () => {
  // The count the Ready preview and the Building step show is the length of
  // `affects`: eligibility AND (the material window OR an agency's confirmation
  // that the recall is still open — the shared `confirmedOpen`, 2026-10-06),
  // nothing about position.
  const expectedCount = (items: readonly FeedItem[], prefs: UserRecallPreferences, now: Date) =>
    items.filter(
      (i) =>
        relevanceOf(prefs)(i).affectsMe &&
        (tierForActivityDate(affectsMePriority(i).materialActivityAt, now) === 'recent' ||
          confirmedOpen(i, now)),
    ).length;

  const synthetic = [
    item({ geography: geo('states', ['California']) }),
    item({ geography: geo('unknown'), retailerNames: ['Costco'] }),
    item({ geography: geo('states', ['Maine']) }),
    item({ publishedAt: OLD_DAY, timeline: [published(OLD_DAY)] }),
    item({ classification: classes(), publishedAt: '2026-08-25' }),
  ];
  assert.equal(rank(synthetic).affects.length, expectedCount(synthetic, CALIFORNIAN, NOW));

  // The bundled baseline: real records, clock fixed at its recording time.
  const recordedAt = new Date(BASELINE_RECORDED_AT);
  for (const prefs of [
    { states: ['CA'], allergens: [], retailers: [] },
    { states: ['TX'], allergens: [], retailers: ['walmart'] },
    { states: ['AL', 'AZ'], allergens: ['peanut', 'milk'], retailers: ['aldi'] },
    { states: [], allergens: ['peanut'], retailers: [] },
  ] satisfies UserRecallPreferences[]) {
    const sections = buildAffectsMeSections(BASELINE_RECALLS, relevanceOf(prefs), {
      now: recordedAt,
    });
    assert.equal(sections.affects.length, expectedCount(BASELINE_RECALLS, prefs, recordedAt));
    // Offline ordering is the same shared order a downloaded corpus gets.
    assert.deepEqual(
      sections.affects.map((i) => i.id),
      sortNewestFirst(sections.affects).map((i) => i.id),
    );
  }
});

test('an older recall counts only when its agency confirms it is still open', () => {
  // Both are eligible California matches, both well past the 60-day window,
  // both FDA. Only the one with current FDA evidence (within 21 days of the
  // clock) counts; the other stays in Older notices.
  const confirmed = item({
    publishedAt: OLD_DAY,
    timeline: [published(OLD_DAY)],
    geography: geo('states', ['California']),
    fdaOngoingAsOf: '2026-08-20',
  });
  const unconfirmed = item({
    publishedAt: OLD_DAY,
    timeline: [published(OLD_DAY)],
    geography: geo('states', ['California']),
  });
  assert.equal(confirmedOpen(confirmed, NOW), true);
  assert.equal(confirmedOpen(unconfirmed, NOW), false);
  const { affects, older } = rank([confirmed, unconfirmed]);
  assert.deepEqual(
    affects.map((i) => i.id),
    [confirmed.id],
  );
  assert.deepEqual(
    older.map((i) => i.id),
    [unconfirmed.id],
  );
});

test('the offline baseline is ordered newest first with no severity rung', () => {
  const recordedAt = new Date(BASELINE_RECORDED_AT);
  const { affects } = buildAffectsMeSections(
    BASELINE_RECALLS,
    relevanceOf({ states: ['CA'], allergens: [], retailers: [] }),
    { now: recordedAt },
  );
  assert.ok(affects.length > 3);
  for (let i = 1; i < affects.length; i += 1) {
    assert.ok(
      compareAffectsMePriority(affectsMePriority(affects[i - 1]), affectsMePriority(affects[i])) <
        0,
    );
  }
  // The real corpus has Pending recalls announced after Critical ones; the
  // first Pending must sit above the first older Critical.
  const firstPending = affects.findIndex((i) => consumerRiskTier(i.classification) === 'pending');
  const lastCritical = affects
    .map((i, index) => ({ i, index }))
    .filter(({ i }) => consumerRiskTier(i.classification) === 'critical')
    .at(-1)!.index;
  assert.ok(firstPending >= 0 && firstPending < lastCritical);
});

test('All recalls splits and orders on the same material date as Affects me', () => {
  const churned = item({
    publishedAt: OLD_DAY,
    lastPublicActivityAt: '2026-08-25',
    timeline: [published(OLD_DAY), bookkeepingEntry('2026-08-25')],
  });
  const fresh = item({ publishedAt: RECENT_DAY });
  const stale = item({ publishedAt: OLD_DAY, timeline: [published(OLD_DAY)] });
  const { recent, olderActive } = buildFeedSections([churned, fresh, stale], NOW);
  assert.deepEqual(
    recent.map((i) => i.id),
    [fresh.id],
  );
  // Wording-edit movement is not recency: the churned case is older, and
  // among the older it ties with `stale` on dates, so the id decides.
  assert.deepEqual(
    olderActive.map((i) => i.id),
    [churned.id, stale.id].sort(),
  );
});

test('C5.2B: All Recalls is byte-identical — personalization cannot touch it', () => {
  const corpus = [
    item({ geography: geo('states', ['California']) }),
    item({ geography: geo('unknown') }),
    item({ geography: geo('states', ['Maine']), pathogenOrAllergen: 'undeclared sesame' }),
    item({
      geography: geo('nationwide'),
      hazardCategory: 'allergen',
      reasonText: 'Unreported Allergens',
      pathogenOrAllergen: 'undeclared milk',
    }),
    item({ publishedAt: OLD_DAY, timeline: [published(OLD_DAY)] }),
  ];
  const baseline = buildFeedSections(corpus, NOW);
  for (const prefs of [
    CALIFORNIAN,
    { states: ['CA'], allergens: [], retailers: [] } as UserRecallPreferences,
    { states: [], allergens: ['milk'], retailers: [] } as UserRecallPreferences,
  ]) {
    rank(corpus, prefs);
    assert.deepEqual(buildFeedSections(corpus, NOW), baseline, JSON.stringify(prefs));
  }
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
    ...milkOnly,
    id: 'stale-milk',
    publishedAt: OLD_DAY,
    timeline: [published(OLD_DAY)],
  });
  const sections = rank([milkOnly, staleMilkOnly]);
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
    assert.ok(
      relevanceOf(CALIFORNIAN)(entry).reasons.length > 0,
      `${entry.id} must explain itself`,
    );
  }
  const ids = placed.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(placed.length, corpus.filter((e) => relevanceOf(CALIFORNIAN)(e).affectsMe).length);
});

test('push eligibility is unchanged: ranking is not part of the delivery decision', () => {
  const nationwideCritical = item({ classification: classes('class_I') });
  const excludedWithSignal = item({
    geography: geo('states', ['Maine']),
    pathogenOrAllergen: 'Undeclared sesame',
  });
  assert.equal(pushEligible(nationwideCritical, CALIFORNIAN), true);
  assert.equal(pushEligible(excludedWithSignal, CALIFORNIAN), false);
  assert.equal(pushEligible(excludedWithSignal, null), false);
  assert.equal(pushEligible(nationwideCritical, null), false);
});

// ── Review affordance ────────────────────────────────────────────────────────

test('a priority explains itself in review copy with the two dates and nothing else', () => {
  const explained = item({
    id: 'explained',
    publishedAt: '2026-07-01',
    timeline: [published('2026-07-01'), materialEntry('2026-08-04', 'classified')],
  });
  assert.equal(
    explainAffectsMePriority(affectsMePriority(explained)),
    'activity 2026-08-04 · announced 2026-07-01',
  );
});

// ── Confirmed open (2026-10-06): membership only, one comparator ─────────────

const LONG_AGO = '2025-01-15';

test('older matches join Affects me only on agency evidence: FSIS recall, current FDA Ongoing', () => {
  const sections = rank([
    item({
      id: 'fda-ongoing',
      publishedAt: LONG_AGO,
      timeline: [published(LONG_AGO)],
      fdaOngoingAsOf: '2026-08-24',
    }),
    item({
      id: 'fsis-recall',
      sourceAgency: 'FSIS',
      publishedAt: LONG_AGO,
      timeline: [published(LONG_AGO)],
    }),
    item({ id: 'fda-none', publishedAt: LONG_AGO, timeline: [published(LONG_AGO)] }),
    item({
      id: 'fsis-alert',
      sourceAgency: 'FSIS',
      noticeType: 'public_health_alert',
      publishedAt: LONG_AGO,
      timeline: [published(LONG_AGO)],
    }),
    item({
      id: 'fda-expired',
      publishedAt: LONG_AGO,
      timeline: [published(LONG_AGO)],
      fdaOngoingAsOf: '2026-07-01',
    }),
  ]);
  assert.deepEqual(sections.affects.map((i) => i.id).sort(), ['fda-ongoing', 'fsis-recall']);
  assert.deepEqual(sections.older.map((i) => i.id).sort(), [
    'fda-expired',
    'fda-none',
    'fsis-alert',
  ]);
});

test('no current-first tier: the counted list IS the shared comparator over the counted set', () => {
  // A deliberately mixed set: in-window and confirmed-open older matches, ties
  // on dates, ids out of order. If any evidence or "current" key took part in
  // the order, some permutation would disagree with the plain sort.
  const items = [
    item({ id: 'case-z-recent', publishedAt: RECENT_DAY, timeline: [published(RECENT_DAY)] }),
    item({
      id: 'case-a-open-old',
      publishedAt: LONG_AGO,
      timeline: [published(LONG_AGO)],
      fdaOngoingAsOf: '2026-08-24',
    }),
    item({
      id: 'case-m-open-old',
      publishedAt: LONG_AGO,
      timeline: [published(LONG_AGO)],
      sourceAgency: 'FSIS',
    }),
    item({
      id: 'case-b-open-newer',
      publishedAt: '2026-05-01',
      timeline: [published('2026-05-01')],
      fdaOngoingAsOf: '2026-08-24',
    }),
    item({ id: 'case-c-recent', publishedAt: '2026-08-25', timeline: [published('2026-08-25')] }),
  ];
  const counted = rank(items).affects;
  assert.deepEqual(
    counted.map((i) => i.id),
    sortNewestFirst(items).map((i) => i.id),
  );
  assert.deepEqual(
    counted.map((i) => i.id),
    ['case-c-recent', 'case-z-recent', 'case-b-open-newer', 'case-a-open-old', 'case-m-open-old'],
  );
  for (const permutation of [
    [...items].reverse(),
    [items[2], items[0], items[4], items[1], items[3]],
  ]) {
    assert.deepEqual(
      rank(permutation).affects.map((i) => i.id),
      counted.map((i) => i.id),
    );
  }
});

test('All recalls never reads evidence: "Recent activity" stays date-only', () => {
  const old = item({
    id: 'open-old',
    publishedAt: LONG_AGO,
    timeline: [published(LONG_AGO)],
    fdaOngoingAsOf: '2026-08-24',
  });
  const fsis = item({
    id: 'fsis-old',
    sourceAgency: 'FSIS',
    publishedAt: LONG_AGO,
    timeline: [published(LONG_AGO)],
  });
  const sections = buildFeedSections([old, fsis], NOW);
  assert.deepEqual(sections.recent, []);
  assert.deepEqual(sections.olderActive.map((i) => i.id).sort(), ['fsis-old', 'open-old']);
  // Byte-identical with and without evidence.
  assert.deepEqual(
    buildFeedSections([{ ...old, fdaOngoingAsOf: null }, fsis], NOW).olderActive.map((i) => i.id),
    sections.olderActive.map((i) => i.id),
  );
});

test('evidence never changes push eligibility or a recency key', () => {
  const base = item({ id: 'p', publishedAt: LONG_AGO, timeline: [published(LONG_AGO)] });
  const evidenced = { ...base, fdaOngoingAsOf: '2026-08-24' };
  assert.equal(pushEligible(evidenced, CALIFORNIAN), pushEligible(base, CALIFORNIAN));
  assert.deepEqual(rank([evidenced]).priorityById.get('p'), rank([base]).priorityById.get('p'));
});
