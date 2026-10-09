/**
 * The Ready preview (2026-09-28; one experience over three sources,
 * 2026-10-04; priority-group selection, 2026-10-05): the Feed's own
 * matching and count, three readable cards chosen by group with the shared
 * newest-first order inside each, the real next match locked only when one
 * remains, photo knowledge that only a probe can supply, Unknown kept last
 * and never relabeled, the honest empty state, and the corpus decision that
 * stands the bundled baseline in for a session that could not answer —
 * proven over the synthetic feed fixtures and the real baseline.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONSUMER_ALLERGENS,
  EMPTY_PREFERENCES,
  STATE_CODES_IN_ORDER,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { RETAILER_CATALOG } from '@/domain/retailer-catalog';
import { buildAffectsMeSections } from '@/lib/affects-me-ranking';
import { buildingData } from '@/lib/building-watch';
import { sortNewestFirst } from '@/lib/recency-order';
import type { TimelineEntry } from '@/domain/recall-types';
import { consumerRiskTier } from '@/domain/risk-tier';
import { makeFeedItem } from '@/lib/feed-fixtures';
import type { FeedItem } from '@/lib/recall-feed';
import { deckDotCount } from '@/lib/ready-presentation';
import { evaluatePersonalRelevance } from '@/lib/relevance';
import { riskView } from '@/lib/risk-display';
import {
  affectsYouMatches,
  buildReadyPreview,
  hasLockedMatches,
  matchAccessibilityLabel,
  NO_PHOTO_KNOWLEDGE,
  PHOTO_PROBE_LIMIT,
  photoCandidates,
  PREVIEW_MATCH_LIMIT,
  previewMatchCount,
  priorityGroup,
  readyCorpus,
  resetReadyCorpusMemory,
  selectReadyMatches,
  type PhotoKnowledge,
  type ReadyPreviewState,
} from './ready-preview';
import { BASELINE_RECALLS, BASELINE_RECORDED_AT } from '@/lib/baseline-recalls';
import {
  HISTORICAL_BASELINE_RECALLS,
  HISTORICAL_BASELINE_RECORDED_AT,
} from '@/lib/historical-baseline';

const TODAY = '2026-08-28';
const NOW = new Date(`${TODAY}T12:00:00.000Z`);

/** The deck's dots for a preview: one per navigable page (readable cards plus the locked one). */
function dots(preview: ReadyPreviewState): number {
  if (preview.kind !== 'matches') return 0;
  return deckDotCount(preview.models.length + (preview.locked ? 1 : 0));
}
const PREFS = { states: ['CA'], allergens: [], retailers: [] };

/** Every stored photo loaded: what a screen knows after its probes all succeed. */
const ALL_LOADED: PhotoKnowledge = { loaded: () => true };
const only = (...urls: string[]): PhotoKnowledge => ({ loaded: (url) => urls.includes(url) });

const CLASS_I = {
  value: 'class_I' as const,
  sourceText: 'Class I',
  officialClasses: ['class_I' as const],
};
const CLASS_II = {
  value: 'class_II' as const,
  sourceText: 'Class II',
  officialClasses: ['class_II' as const],
};
const PENDING = { value: 'not_yet_classified' as const, sourceText: null, officialClasses: [] };
const PHA = { value: 'not_applicable_pha' as const, sourceText: null, officialClasses: [] };

function published(occurredAt: string): TimelineEntry {
  return {
    occurredAt,
    kind: 'published',
    summary: 'Recall published.',
    causedBySnapshotIds: [],
    material: false,
  };
}

/**
 * One recent nationwide recall (it matches any chosen state), announced
 * `daysAgo` days before the clock, with or without a stored photo.
 */
function match(
  n: number,
  options: {
    imaged?: boolean;
    daysAgo?: number;
    classification?: FeedItem['classification'];
    noticeType?: FeedItem['noticeType'];
  } = {},
): FeedItem {
  const daysAgo = options.daysAgo ?? n % 20;
  const day = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  return makeFeedItem(n, {
    id: `match-${n}`,
    noticeType: options.noticeType ?? 'recall',
    classification: options.classification ?? CLASS_I,
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: 'Nationwide' },
    publishedAt: day,
    lastPublicActivityAt: day,
    timeline: [published(day)],
    heroImageUrl: options.imaged === false ? null : `https://example.test/hero-${n}.webp`,
    // A general hazard: never withheld by the allergen-only rule.
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Salmonella',
    reasonText: 'Potential Salmonella contamination',
    retailerNames: [],
  });
}

/** A recall whose states exclude the chosen one: never a match. */
const ELSEWHERE = makeFeedItem(100, {
  id: 'elsewhere',
  geography: { scope: 'states', states: ['TX'], confidence: 'stated', sourceText: 'TX' },
  heroImageUrl: 'https://example.test/hero-elsewhere.webp',
});

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

// ── The groups ───────────────────────────────────────────────────────────────

test('a recall’s group: rated with a loaded photo, rated without, Pending with, Pending without, Unknown last', () => {
  const rated = match(1);
  const pending = match(2, { classification: PENDING });
  const alert = match(3, { classification: PHA, noticeType: 'public_health_alert', imaged: false });
  assert.equal(priorityGroup(rated, ALL_LOADED), 1);
  assert.equal(priorityGroup(rated, NO_PHOTO_KNOWLEDGE), 2);
  assert.equal(priorityGroup(match(4, { imaged: false }), ALL_LOADED), 2);
  assert.equal(priorityGroup(pending, ALL_LOADED), 3);
  assert.equal(priorityGroup(pending, NO_PHOTO_KNOWLEDGE), 4);
  assert.equal(priorityGroup(match(5, { classification: PENDING, imaged: false }), ALL_LOADED), 4);
  assert.equal(priorityGroup(alert, ALL_LOADED), 5);
  // Unknown stays Unknown: the alert's badge is suppressed, and nothing here
  // gives it a tier it does not have.
  assert.equal(consumerRiskTier(alert.classification), 'unknown');
  assert.equal(riskView(alert.classification, 'FSIS', 'public_health_alert').badgeLabel, null);
});

test('only a LOADED photo counts: a stored URL the screen has no verdict for is no photo', () => {
  const rated = match(1);
  assert.equal(priorityGroup(rated, only(rated.heroImageUrl!)), 1);
  assert.equal(priorityGroup(rated, only('https://example.test/other.webp')), 2);
  assert.equal(priorityGroup(rated, NO_PHOTO_KNOWLEDGE), 2);
});

// ── Filling the deck ─────────────────────────────────────────────────────────

test('three readable cards whenever three genuine matches exist, by group, newest first inside each', () => {
  const items = [
    match(1, { classification: PENDING, daysAgo: 0 }), // g3 — newest of all
    match(2, { imaged: false, daysAgo: 1 }), // g2
    match(3, { daysAgo: 5 }), // g1
    match(4, { daysAgo: 2 }), // g1 — newer than 3
    match(5, { classification: PENDING, imaged: false, daysAgo: 3 }), // g4
    match(6, { classification: CLASS_II, daysAgo: 9 }), // g1 — oldest rated
  ];
  const selection = selectReadyMatches(affectsYouMatches(items, PREFS, NOW), ALL_LOADED);
  assert.deepEqual(ids(selection.readable), ['match-4', 'match-3', 'match-6']);
  assert.equal(selection.locked?.id, 'match-2', 'the next match in group order');
  // Severity does not order inside a group: a Class II from nine days ago is
  // third only because it is the oldest rated match with a photo.
  assert.equal(consumerRiskTier(items[5].classification), 'high');
});

test('rated recalls without photos fill before Pending ones with photos; Pending without fills last', () => {
  const items = [
    match(1, { classification: PENDING, daysAgo: 0 }), // g3
    match(2, { imaged: false, daysAgo: 4 }), // g2
    match(3, { daysAgo: 6 }), // g1
    match(4, { classification: PENDING, imaged: false, daysAgo: 1 }), // g4
  ];
  const selection = selectReadyMatches(affectsYouMatches(items, PREFS, NOW), ALL_LOADED);
  assert.deepEqual(ids(selection.readable), ['match-3', 'match-2', 'match-1']);
  assert.equal(selection.locked?.id, 'match-4');
});

test('Unknown and public health alerts come after the four groups, and are readable only when nothing else fills', () => {
  const alert = match(1, {
    classification: PHA,
    noticeType: 'public_health_alert',
    imaged: false,
    daysAgo: 0,
  });
  const pendingNoPhoto = match(2, { classification: PENDING, imaged: false, daysAgo: 9 });
  const rated = match(3, { daysAgo: 8 });
  const crowded = selectReadyMatches(
    affectsYouMatches([alert, pendingNoPhoto, rated, match(4, { daysAgo: 7 })], PREFS, NOW),
    ALL_LOADED,
  );
  assert.deepEqual(ids(crowded.readable), ['match-4', 'match-3', 'match-2']);
  assert.equal(crowded.locked?.id, 'match-1', 'the alert is the locked page, counted and frosted');
  const sparse = selectReadyMatches(affectsYouMatches([alert, rated], PREFS, NOW), ALL_LOADED);
  assert.deepEqual(
    ids(sparse.readable),
    ['match-3', 'match-1'],
    'with one other match the alert is readable',
  );
  assert.equal(sparse.locked, null);
});

test('fewer than three matches show every match, with nothing locked and nothing claimed', () => {
  for (const count of [1, 2]) {
    const items = Array.from({ length: count }, (_, i) =>
      match(i + 1, { imaged: i % 2 === 0, classification: i === 1 ? PENDING : CLASS_I }),
    );
    const preview = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW, ALL_LOADED);
    assert.ok(preview.kind === 'matches');
    assert.equal(preview.models.length, count);
    assert.equal(preview.locked, null);
    assert.equal(hasLockedMatches(preview), false);
    assert.equal(dots(preview), count === 1 ? 0 : count, 'a lone dot says nothing');
  }
});

test('exactly three matches: three readable, nothing locked; four or more: the real next match locked, one dot per page', () => {
  const three = buildReadyPreview(
    { status: 'ready', items: [1, 2, 3].map((n) => match(n)) },
    PREFS,
    TODAY,
    NOW,
    ALL_LOADED,
  );
  assert.ok(three.kind === 'matches');
  assert.equal(three.models.length, 3);
  assert.equal(three.locked, null);
  assert.equal(hasLockedMatches(three), false);
  const five = buildReadyPreview(
    { status: 'ready', items: [1, 2, 3, 4, 5].map((n) => match(n, { imaged: n !== 4 })) },
    PREFS,
    TODAY,
    NOW,
    ALL_LOADED,
  );
  assert.ok(five.kind === 'matches');
  assert.equal(five.models.length, 3);
  assert.notEqual(five.locked, null);
  assert.ok(!five.models.some((m) => m.id === five.locked!.id), 'a readable card is locked');
  assert.equal(dots(five), 4);
  assert.equal(hasLockedMatches(five), true);
});

// ── The count ────────────────────────────────────────────────────────────────

test('the count is every genuine match, whatever the photos, the groups or the deck’s limit', () => {
  const items = [
    match(1),
    match(2, { imaged: false }),
    match(3, { classification: PENDING }),
    match(4, { classification: PENDING, imaged: false }),
    match(5, { classification: PHA, noticeType: 'public_health_alert', imaged: false }),
  ];
  for (const photos of [ALL_LOADED, NO_PHOTO_KNOWLEDGE, only(items[2].heroImageUrl!)]) {
    const preview = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW, photos);
    assert.equal(previewMatchCount(preview), 5);
    assert.equal(previewMatchCount(preview), affectsYouMatches(items, PREFS, NOW).length);
  }
  assert.equal(previewMatchCount({ kind: 'checking' }), null);
  assert.equal(
    previewMatchCount(
      buildReadyPreview({ status: 'ready', items: [ELSEWHERE] }, PREFS, TODAY, NOW),
    ),
    null,
  );
});

test('a failed photo moves its recall to the no-photo group and changes nothing else', () => {
  const items = [
    match(1, { daysAgo: 0 }),
    match(2, { daysAgo: 1 }),
    match(3, { daysAgo: 2 }),
    match(4, { imaged: false, daysAgo: 3 }),
  ];
  const before = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW, ALL_LOADED);
  assert.ok(before.kind === 'matches');
  assert.deepEqual(ids(before.models), ['match-1', 'match-2', 'match-3']);
  assert.equal(before.locked?.id, 'match-4');
  // match-1's photo failed: it drops to group 2, where match-4 already sits
  // (match-4 is older, so match-1 leads that group) — and the count holds.
  const after = buildReadyPreview(
    { status: 'ready', items },
    PREFS,
    TODAY,
    NOW,
    only(items[1].heroImageUrl!, items[2].heroImageUrl!),
  );
  assert.ok(after.kind === 'matches');
  assert.deepEqual(ids(after.models), ['match-2', 'match-3', 'match-1']);
  assert.equal(after.locked?.id, 'match-4');
  assert.equal(after.total, before.total);
});

test('with no photo knowledge every recall is a text-led card in the right group — never an empty deck', () => {
  const items = [match(1), match(2, { classification: PENDING }), match(3)];
  const preview = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW);
  assert.ok(preview.kind === 'matches');
  assert.equal(preview.models.length, 3);
  assert.deepEqual(ids(preview.models), ['match-1', 'match-3', 'match-2']);
});

// ── What a screen probes ─────────────────────────────────────────────────────

test('the photo candidates are the matches that could be readable with a photo, rated before Pending, capped', () => {
  const items = [
    match(1, { classification: PENDING, daysAgo: 0 }),
    match(2, { daysAgo: 1 }),
    match(3, { imaged: false, daysAgo: 2 }),
    match(4, { classification: PHA, noticeType: 'public_health_alert', daysAgo: 3 }),
    match(5, { daysAgo: 4 }),
    ELSEWHERE,
  ];
  assert.deepEqual(photoCandidates(items, PREFS, NOW), [
    items[1].heroImageUrl,
    items[4].heroImageUrl,
    items[0].heroImageUrl,
  ]);
  const many = Array.from({ length: 12 }, (_, i) => match(i + 1, { daysAgo: i }));
  assert.equal(photoCandidates(many, PREFS, NOW).length, PHOTO_PROBE_LIMIT);
  assert.deepEqual(photoCandidates([ELSEWHERE], PREFS, NOW), []);
});

// ── Determinism, copy, the corpus ────────────────────────────────────────────

test('the same corpus in another input order gives the same deck', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    match(n, { imaged: n % 3 !== 0, classification: n % 4 === 0 ? PENDING : CLASS_I }),
  );
  const a = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW, ALL_LOADED);
  const b = buildReadyPreview(
    { status: 'ready', items: [...items].reverse() },
    PREFS,
    TODAY,
    NOW,
    ALL_LOADED,
  );
  assert.ok(a.kind === 'matches' && b.kind === 'matches');
  assert.deepEqual(ids(a.models), ids(b.models));
  assert.equal(a.locked?.id, b.locked?.id);
  assert.equal(a.models.length, PREVIEW_MATCH_LIMIT);
});

test('new preferences recompute the preview from the same feed: nothing stale survives an edit', () => {
  const texas = makeFeedItem(101, {
    id: 'texas',
    geography: { scope: 'states', states: ['Texas'], confidence: 'stated', sourceText: 'Texas' },
    publishedAt: '2026-08-26T00:00:00.000Z',
    lastPublicActivityAt: '2026-08-26T00:00:00.000Z',
    heroImageUrl: 'https://example.test/hero-texas.webp',
  });
  const items = [match(1), texas];
  const before = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW, ALL_LOADED);
  const after = buildReadyPreview(
    { status: 'ready', items },
    { ...PREFS, states: ['CA', 'TX'] },
    TODAY,
    NOW,
    ALL_LOADED,
  );
  assert.equal(previewMatchCount(before), 1);
  assert.equal(previewMatchCount(after), 2);
  assert.ok(after.kind === 'matches' && after.models.some((m) => m.id === 'texas'));
});

test('a readable card speaks its position, risk, relevance, product and provenance', () => {
  const preview = buildReadyPreview(
    { status: 'ready', items: [1, 2, 3, 4].map((n) => match(n)) },
    PREFS,
    TODAY,
    NOW,
    ALL_LOADED,
  );
  assert.ok(preview.kind === 'matches');
  const label = matchAccessibilityLabel(preview.models[0], 0, preview.models.length);
  assert.match(label, /^Match 1 of 3\. /);
  assert.ok(label.includes(preview.models[0].productName));
  assert.ok(label.includes('Affects you'));
});

test('zero matches: `none` is a plain, truthful state — no cards, no count, nothing locked', () => {
  const preview = buildReadyPreview({ status: 'ready', items: [ELSEWHERE] }, PREFS, TODAY, NOW);
  assert.ok(preview.kind === 'none');
  assert.equal(previewMatchCount(preview), null);
  assert.equal(hasLockedMatches(preview), false);
  assert.deepEqual(buildReadyPreview({ status: 'loading' }, PREFS, TODAY, NOW), {
    kind: 'checking',
  });
});

test('readyCorpus: the session’s answer when it has one; the bundled baseline when it has none; remembered until a sync succeeds', () => {
  resetReadyCorpusMemory();
  assert.deepEqual(readyCorpus({ status: 'loading' }), { status: 'loading' });
  const fallen = readyCorpus({ status: 'error' });
  assert.ok(fallen.status === 'ready' && fallen.source === 'baseline');
  assert.equal(fallen.items, BASELINE_RECALLS);
  const again = readyCorpus({ status: 'loading' });
  assert.ok(again.status === 'ready' && again.source === 'baseline');
  const items = [match(1)];
  const live = readyCorpus({ status: 'ready', items });
  assert.ok(live.status === 'ready' && live.source === 'feed');
  assert.equal(live.items, items);
  assert.deepEqual(readyCorpus({ status: 'loading' }), { status: 'loading' });
  resetReadyCorpusMemory();
});

// ── The shipped baseline's clock, for the current-baseline tests below ─────

const RECORDED_AT = new Date(BASELINE_RECORDED_AT);
const RECORDED_DAY = BASELINE_RECORDED_AT.slice(0, 10);

// ── The current baseline: invariants over every real profile ────────────────
//
// Pinned to no particular id or count, so a re-recording never needs these
// edited: they hold for whatever the shipped baseline answers.

test('current baseline: every surface agrees, three readable cards when three exist, a locked card only when another remains, by group and newest first', () => {
  const profiles: UserRecallPreferences[] = [
    ...STATE_CODES_IN_ORDER.map((code) => ({ states: [code], allergens: [], retailers: [] })),
    ...CONSUMER_ALLERGENS.map((a) => ({ states: [], allergens: [a.token], retailers: [] })),
    ...RETAILER_CATALOG.map((r) => ({ states: [], allergens: [], retailers: [r.id] })),
    { states: ['CA'], allergens: ['sesame', 'peanut'], retailers: ['costco', 'trader-joes'] },
    { states: ['IA'], allergens: ['milk'], retailers: ['aldi'] },
    { states: ['MA', 'NC', 'PA', 'WV'], allergens: ['sesame', 'shellfish'], retailers: ['pcc'] },
  ];
  const corpus = { status: 'ready' as const, items: BASELINE_RECALLS, source: 'baseline' as const };
  let withMatches = 0;
  let withLocked = 0;
  for (const prefs of profiles) {
    const label = JSON.stringify(prefs);
    const feed = buildAffectsMeSections(
      BASELINE_RECALLS,
      (item) => evaluatePersonalRelevance(item, prefs),
      { now: RECORDED_AT },
    ).affects;
    const matches = affectsYouMatches(BASELINE_RECALLS, prefs, RECORDED_AT);
    const building = buildingData(corpus, false, prefs, RECORDED_AT);
    const preview = buildReadyPreview(corpus, prefs, RECORDED_DAY, RECORDED_AT, ALL_LOADED);
    // One count on every surface.
    assert.deepEqual(
      matches.map((i) => i.id),
      feed.map((i) => i.id),
      label,
    );
    assert.equal(building.kind === 'usable' ? building.total : 0, matches.length, label);
    assert.equal(previewMatchCount(preview) ?? 0, matches.length, label);
    // Newest first: the Affects You list is the shared order.
    assert.deepEqual(
      matches.map((i) => i.id),
      sortNewestFirst(matches).map((i) => i.id),
      label,
    );
    if (preview.kind !== 'matches') continue;
    withMatches += 1;
    // Three readable cards whenever three genuine matches exist; every match below that.
    assert.equal(preview.models.length, Math.min(PREVIEW_MATCH_LIMIT, matches.length), label);
    // A locked card only when another genuine match remains.
    assert.equal(preview.locked !== null, matches.length > PREVIEW_MATCH_LIMIT, label);
    assert.equal(hasLockedMatches(preview), matches.length > PREVIEW_MATCH_LIMIT, label);
    // Preview priority: groups never worsen across the readable cards, no unshown
    // match outranks a shown one, and inside a group the newest-first order holds.
    const byId = new Map(matches.map((item, index) => [item.id, { item, index }]));
    const shown = preview.models.map((m) => byId.get(m.id)!);
    const group = (item: FeedItem) => priorityGroup(item, ALL_LOADED);
    for (let i = 1; i < shown.length; i += 1) {
      const [a, b] = [shown[i - 1], shown[i]];
      assert.ok(group(a.item) <= group(b.item), label);
      if (group(a.item) === group(b.item)) assert.ok(a.index < b.index, label);
    }
    const shownIds = new Set(shown.map((s) => s.item.id));
    const worstShown = Math.max(...shown.map((s) => group(s.item)));
    const rest = matches.filter((item) => !shownIds.has(item.id));
    assert.ok(
      rest.every((item) => group(item) >= worstShown),
      label,
    );
    if (preview.locked !== null) {
      withLocked += 1;
      const best = Math.min(...rest.map(group));
      const locked = byId.get(preview.locked.id)!;
      assert.ok(!shownIds.has(locked.item.id), label);
      assert.equal(group(locked.item), best, label);
      assert.equal(locked.item.id, rest.find((item) => group(item) === best)!.id, label);
    }
  }
  // The sweep exercised both deck shapes on real data.
  assert.ok(withMatches > 0 && withLocked > 0 && withLocked < withMatches);
});

// ── Historical baseline (2026-10-04): the five fallback scenarios ───────────
//
// These decks were found by search over the baseline recorded on 2026-10-04
// (review scenarios, 2026-10-05). The current baseline also carries the
// recalls an agency confirms are still open, and those — mostly rated, with
// photos — now fill every realistic profile's deck, so photo-less rated and
// Pending recalls never reach it. The scenarios keep their real-data coverage
// on that frozen recording (content/historical/README.md), at its own clock.

const HISTORICAL_AT = new Date(HISTORICAL_BASELINE_RECORDED_AT);
const HISTORICAL_DAY = HISTORICAL_BASELINE_RECORDED_AT.slice(0, 10);
const HISTORICAL = {
  status: 'ready' as const,
  items: HISTORICAL_BASELINE_RECALLS,
  source: 'baseline' as const,
};
const tierOf = (id: string) =>
  consumerRiskTier(HISTORICAL_BASELINE_RECALLS.find((item) => item.id === id)!.classification);
const photoOf = (id: string) =>
  HISTORICAL_BASELINE_RECALLS.find((item) => item.id === id)!.heroImageUrl;

test('historical baseline, California: three rated recalls with photos lead nineteen matches; a rated recall without a photo is locked', () => {
  const prefs = { states: ['CA'], allergens: [], retailers: [] };
  const preview = buildReadyPreview(HISTORICAL, prefs, HISTORICAL_DAY, HISTORICAL_AT, ALL_LOADED);
  assert.ok(preview.kind === 'matches');
  assert.equal(preview.total, 19);
  assert.equal(
    preview.total,
    affectsYouMatches(HISTORICAL_BASELINE_RECALLS, prefs, HISTORICAL_AT).length,
  );
  assert.deepEqual(
    preview.models.map((m) => m.id.slice(0, 8)),
    ['7a9159b7', '6c54040d', '080dedcf'],
  );
  for (const model of preview.models) {
    assert.equal(tierOf(model.id), 'critical');
    assert.notEqual(photoOf(model.id), null);
  }
  assert.equal(preview.locked?.id.slice(0, 8), '6fcdc02c');
  assert.equal(tierOf(preview.locked!.id), 'critical');
  assert.equal(photoOf(preview.locked!.id), null);
  assert.equal(hasLockedMatches(preview), true);
});

test('historical baseline, tree nuts + Kroger: one rated recall with a photo, then two rated without; nothing locked', () => {
  const prefs = { states: [], allergens: ['tree nuts'], retailers: ['kroger'] };
  const preview = buildReadyPreview(HISTORICAL, prefs, HISTORICAL_DAY, HISTORICAL_AT, ALL_LOADED);
  assert.ok(preview.kind === 'matches');
  assert.equal(preview.total, 3);
  assert.deepEqual(
    preview.models.map((m) => m.id.slice(0, 8)),
    ['c858146a', 'b3faf760', 'e29ba3f8'],
  );
  assert.deepEqual(
    preview.models.map((m) => photoOf(m.id) !== null),
    [true, false, false],
  );
  assert.equal(preview.locked, null);
  assert.equal(hasLockedMatches(preview), false);
});

test('historical baseline, soy: a rated recall, then Pending with a photo, then Pending without — the newest recall last', () => {
  const prefs = { states: [], allergens: ['soy'], retailers: [] };
  const preview = buildReadyPreview(HISTORICAL, prefs, HISTORICAL_DAY, HISTORICAL_AT, ALL_LOADED);
  assert.ok(preview.kind === 'matches');
  assert.equal(preview.total, 3);
  assert.deepEqual(
    preview.models.map((m) => m.id.slice(0, 8)),
    ['c858146a', 'ea4c7576', '11032eb1'],
  );
  assert.deepEqual(
    preview.models.map((m) => tierOf(m.id)),
    ['high', 'pending', 'pending'],
  );
  assert.equal(photoOf(preview.models[2].id), null);
  assert.equal(preview.locked, null);
});

test('historical baseline, milk: two rated with photos, a Pending with a photo, and a Pending match locked behind', () => {
  const prefs = { states: [], allergens: ['milk'], retailers: [] };
  const preview = buildReadyPreview(HISTORICAL, prefs, HISTORICAL_DAY, HISTORICAL_AT, ALL_LOADED);
  assert.ok(preview.kind === 'matches');
  assert.equal(preview.total, 5);
  assert.deepEqual(
    preview.models.map((m) => m.id.slice(0, 8)),
    ['4e2cb847', 'c858146a', '6061bbb8'],
  );
  assert.equal(preview.locked?.id.slice(0, 8), 'fab432cd');
  assert.equal(tierOf(preview.locked!.id), 'pending');
  assert.equal(hasLockedMatches(preview), true);
});

test('historical baseline, one and two matches total: every match readable, nothing locked', () => {
  const two = buildReadyPreview(
    HISTORICAL,
    { states: [], allergens: ['tree nuts'], retailers: [] },
    HISTORICAL_DAY,
    HISTORICAL_AT,
    ALL_LOADED,
  );
  assert.ok(two.kind === 'matches');
  assert.equal(two.total, 2);
  assert.deepEqual(
    two.models.map((m) => m.id.slice(0, 8)),
    ['c858146a', 'b3faf760'],
  );
  assert.equal(two.locked, null);
  const one = buildReadyPreview(
    HISTORICAL,
    { states: [], allergens: [], retailers: ['costco'] },
    HISTORICAL_DAY,
    HISTORICAL_AT,
    ALL_LOADED,
  );
  assert.ok(one.kind === 'matches');
  assert.equal(one.total, 1);
  assert.equal(one.models[0].id.slice(0, 8), '365434a6');
  assert.equal(tierOf(one.models[0].id), 'pending');
  assert.equal(one.locked, null);
  assert.equal(hasLockedMatches(one), false);
});

test('the baseline goes through the same matching: real matches, the real count, Affects You computed, nothing invented', () => {
  const corpus = readyCorpus({ status: 'error' });
  resetReadyCorpusMemory();
  const nationwide = BASELINE_RECALLS.filter((i) => i.geography.scope === 'nationwide');
  assert.ok(nationwide.length > 0, 'the recorded baseline holds no Nationwide recall');
  for (const states of [['CA'], ['WY'], ['NY', 'TX']]) {
    const prefs = { states, allergens: [], retailers: [] };
    const preview = buildReadyPreview(corpus, prefs, RECORDED_DAY, RECORDED_AT, ALL_LOADED);
    assert.ok(preview.kind === 'matches', `${states.join('+')}: no matches at recording time`);
    assert.equal(preview.source, 'baseline');
    assert.equal(preview.total, affectsYouMatches(BASELINE_RECALLS, prefs, RECORDED_AT).length);
    const qualifying = nationwide.filter(
      (item) => evaluatePersonalRelevance(item, prefs).affectsMe,
    ).length;
    assert.ok(qualifying > 0 && preview.total >= qualifying);
    for (const model of preview.models) assert.equal(model.affectsYou, true);
    assert.equal(hasLockedMatches(preview), preview.total > preview.models.length);
  }
  const none = buildReadyPreview(corpus, EMPTY_PREFERENCES, RECORDED_DAY, RECORDED_AT);
  assert.equal(none.kind, 'none');
});

test('live recovery replaces the baseline deck and count with the genuine corpus; a preference edit recomputes offline', () => {
  resetReadyCorpusMemory();
  const offline = buildReadyPreview(
    readyCorpus({ status: 'error' }),
    PREFS,
    RECORDED_DAY,
    RECORDED_AT,
  );
  assert.ok(offline.kind === 'matches' && offline.source === 'baseline');
  const edited = buildReadyPreview(
    readyCorpus({ status: 'loading' }),
    { ...PREFS, states: ['CA', 'TX'] },
    RECORDED_DAY,
    RECORDED_AT,
  );
  assert.ok(edited.kind === 'matches' && edited.source === 'baseline');
  assert.ok(edited.total >= offline.total);
  const live = buildReadyPreview(
    readyCorpus({ status: 'ready', items: [match(1), match(2, { imaged: false })] }),
    PREFS,
    TODAY,
    NOW,
    ALL_LOADED,
  );
  assert.ok(live.kind === 'matches' && live.source === 'feed');
  assert.equal(live.total, 2);
  assert.ok(!live.models.some((m) => BASELINE_RECALLS.some((b) => b.id === m.id)));
  resetReadyCorpusMemory();
});
