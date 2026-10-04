/**
 * The Ready preview (2026-09-28; one experience over three sources,
 * 2026-10-04): the Feed's own matching and ordering, three readable matches
 * imaged or not, the real next one locked, the honest empty state, and the
 * corpus decision that stands the bundled baseline in for a session that
 * could not answer — proven over the synthetic feed fixtures (test-only
 * data; the screen itself reads the live feed).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMPTY_PREFERENCES } from '@/domain/preferences';
import { buildAffectsMeSections } from '@/lib/affects-me-ranking';
import { makeFeedItem } from '@/lib/feed-fixtures';
import type { FeedItem } from '@/lib/recall-feed';
import { deckDotCount } from '@/lib/ready-presentation';
import { evaluatePersonalRelevance } from '@/lib/relevance';
import {
  affectsYouMatches,
  buildReadyPreview,
  hasLockedMatches,
  matchAccessibilityLabel,
  readyCorpus,
  resetReadyCorpusMemory,
  PREVIEW_MATCH_LIMIT,
  previewMatchCount,
  type ReadyPreviewState,
} from './ready-preview';
import { BASELINE_RECALLS, BASELINE_RECORDED_AT } from '@/lib/baseline-recalls';

const TODAY = '2026-08-28';
const NOW = new Date(`${TODAY}T12:00:00.000Z`);

/** The deck's dots for a preview: one per navigable page (readable cards plus the locked one). */
function dots(preview: ReadyPreviewState): number {
  if (preview.kind !== 'matches') return 0;
  return deckDotCount(preview.models.length + (preview.locked ? 1 : 0));
}
const PREFS = { states: ['CA'], allergens: [], retailers: [] };

/**
 * One recent nationwide recall (it matches any chosen state). `imaged`
 * decides whether the shared image-role allocation gave it a hero.
 */
function match(n: number, imaged: boolean): FeedItem {
  const day = `2026-08-${String(27 - (n % 20)).padStart(2, '0')}T00:00:00.000Z`;
  return makeFeedItem(n, {
    id: `match-${n}`,
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: 'Nationwide' },
    publishedAt: day,
    lastPublicActivityAt: day,
    heroImageUrl: imaged ? `https://example.test/hero-${n}.webp` : null,
  });
}

/** A recall whose states exclude the chosen one: never a match. */
const ELSEWHERE = makeFeedItem(100, {
  id: 'elsewhere',
  geography: { scope: 'states', states: ['TX'], confidence: 'stated', sourceText: 'TX' },
  heroImageUrl: 'https://example.test/hero-elsewhere.webp',
});

/** The Feed's own ranked Affects You order for a corpus. */
function ranked(items: readonly FeedItem[]): string[] {
  return buildAffectsMeSections(items, (item) =>
    evaluatePersonalRelevance(item, PREFS),
  ).affects.map((item) => item.id);
}

test('the preview claims nothing before the feed answers', () => {
  assert.deepEqual(buildReadyPreview({ status: 'loading' }, PREFS, TODAY, NOW), {
    kind: 'checking',
  });
});

test('zero matches is an honest none — never an invented match', () => {
  // (shape: kind and stale only; no cards)
  const preview = buildReadyPreview({ status: 'ready', items: [ELSEWHERE] }, PREFS, TODAY, NOW);
  assert.equal(preview.kind, 'none');
  assert.equal(hasLockedMatches(preview), false);
  assert.equal(dots(preview), 0);
});

test('an empty profile matches nothing: the layer is the Feed’s own verdict', () => {
  const items = [1, 2, 3].map((n) => match(n, true));
  assert.equal(
    buildReadyPreview({ status: 'ready', items }, EMPTY_PREFERENCES, TODAY, NOW).kind,
    'none',
  );
});

test('the deck is the first ranked matches, imaged or not, in rank order, never reordered', () => {
  // Interleave imaged and imageless matches; the deck must be the first
  // three ids of the Feed's own ranking whatever their images, and the
  // locked card the fourth.
  const items = [
    match(1, false),
    match(2, true),
    match(3, false),
    match(4, true),
    match(5, true),
    match(6, false),
    match(7, true),
    match(8, true),
    ELSEWHERE,
  ];
  const order = ranked(items);
  const preview = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW);
  assert.ok(preview.kind === 'matches');
  assert.deepEqual(
    preview.models.map((m) => m.id),
    order.slice(0, PREVIEW_MATCH_LIMIT),
  );
  assert.equal(preview.locked?.id, order[PREVIEW_MATCH_LIMIT]);
  // A match without an image is still a readable card.
  assert.ok(preview.models.some((m) => m.heroImageUrl === null));
  // The total is every match, imaged or not.
  assert.equal(preview.total, 8);
  // Deterministic: the same corpus in another input order gives the same deck.
  const again = buildReadyPreview(
    { status: 'ready', items: [...items].reverse() },
    PREFS,
    TODAY,
    NOW,
  );
  assert.ok(again.kind === 'matches');
  assert.deepEqual(
    again.models.map((m) => m.id),
    preview.models.map((m) => m.id),
  );
  assert.equal(again.locked?.id, preview.locked?.id);
});

test('one, two and three matches, imaged or not: exactly those cards, truthful dots, no locked card, nothing claimed locked', () => {
  for (const count of [1, 2, 3]) {
    const items = Array.from({ length: count }, (_, i) => match(i + 1, i % 2 === 0));
    const preview = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW);
    assert.ok(preview.kind === 'matches');
    assert.equal(preview.models.length, count);
    assert.equal(preview.locked, null, `${count}: a locked card with nothing behind it`);
    assert.equal(hasLockedMatches(preview), false, `${count}: the strip claims more`);
    assert.equal(dots(preview), count === 1 ? 0 : count, 'a lone dot says nothing');
  }
});

test('four or more matches: three readable and the real fourth locked, whatever their images', () => {
  const items = [1, 2, 3, 4, 5].map((n) => match(n, n !== 4));
  const preview = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW);
  assert.ok(preview.kind === 'matches');
  assert.equal(preview.models.length, 3);
  assert.notEqual(preview.locked, null);
  assert.ok(!preview.models.some((m) => m.id === preview.locked!.id), 'a readable card is locked');
  assert.equal(dots(preview), 4, 'the locked page is navigable, so it has its own dot');
  assert.equal(hasLockedMatches(preview), true);
});

test('matches without images are readable cards, never an empty deck beside a count', () => {
  // Three imaged + two imageless: three readable, the fourth (imageless)
  // locked, five counted.
  const items = [match(1, true), match(2, true), match(3, true), match(4, false), match(5, false)];
  const preview = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW);
  assert.ok(preview.kind === 'matches');
  assert.equal(preview.models.length, 3);
  assert.notEqual(preview.locked, null);
  assert.equal(hasLockedMatches(preview), true);
  // No match carries an image at all: still a full deck, and the one-match
  // case is one card with nothing claimed locked (the audit's defect).
  const imageless = buildReadyPreview(
    { status: 'ready', items: [match(1, false), match(2, false)] },
    PREFS,
    TODAY,
    NOW,
  );
  assert.ok(imageless.kind === 'matches');
  assert.equal(imageless.models.length, 2);
  assert.equal(imageless.locked, null);
  assert.equal(imageless.total, 2);
  const one = buildReadyPreview({ status: 'ready', items: [match(1, false)] }, PREFS, TODAY, NOW);
  assert.ok(one.kind === 'matches');
  assert.equal(one.models.length, 1);
  assert.equal(one.locked, null);
  assert.equal(hasLockedMatches(one), false);
});

test('the count is every real match: never the deck’s length or a fixed number', () => {
  // Three imaged + two imageless: three cards, five matching recalls.
  const mixed = buildReadyPreview(
    {
      status: 'ready',
      items: [match(1, true), match(2, true), match(3, true), match(4, false), match(5, false)],
    },
    PREFS,
    TODAY,
    NOW,
  );
  assert.equal(previewMatchCount(mixed), 5);
  // Five imaged: three readable, one locked, five counted.
  const many = buildReadyPreview(
    { status: 'ready', items: [1, 2, 3, 4, 5].map((n) => match(n, true)) },
    PREFS,
    TODAY,
    NOW,
  );
  assert.equal(previewMatchCount(many), 5);
  // One and two matches count themselves.
  for (const count of [1, 2]) {
    const items = Array.from({ length: count }, (_, i) => match(i + 1, true));
    assert.equal(
      previewMatchCount(buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW)),
      count,
    );
  }
  // No matches imaged at all: the count is still the truth.
  const imageless = buildReadyPreview(
    { status: 'ready', items: [match(1, false), match(2, false)] },
    PREFS,
    TODAY,
    NOW,
  );
  assert.equal(previewMatchCount(imageless), 2);
  // Nothing to count while checking, or when none match.
  assert.equal(previewMatchCount({ kind: 'checking' }), null);
  assert.equal(
    previewMatchCount(
      buildReadyPreview({ status: 'ready', items: [ELSEWHERE] }, PREFS, TODAY, NOW),
    ),
    null,
  );
});

test('new preferences recompute the preview from the same feed: nothing stale survives an edit', () => {
  // A recent Texas-only recall matches once Texas is chosen, and not before.
  const texas = makeFeedItem(101, {
    id: 'texas',
    geography: { scope: 'states', states: ['Texas'], confidence: 'stated', sourceText: 'Texas' },
    publishedAt: '2026-08-26T00:00:00.000Z',
    lastPublicActivityAt: '2026-08-26T00:00:00.000Z',
    heroImageUrl: 'https://example.test/hero-texas.webp',
  });
  const items = [match(1, true), texas];
  const before = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY, NOW);
  const after = buildReadyPreview(
    { status: 'ready', items },
    { ...PREFS, states: ['CA', 'TX'] },
    TODAY,
    NOW,
  );
  assert.equal(previewMatchCount(before), 1);
  assert.equal(previewMatchCount(after), 2);
  assert.ok(after.kind === 'matches' && after.models.some((m) => m.id === 'texas'));
});

test('a readable card speaks its position, risk, relevance, product and provenance', () => {
  const preview = buildReadyPreview(
    { status: 'ready', items: [1, 2, 3, 4].map((n) => match(n, true)) },
    PREFS,
    TODAY,
    NOW,
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
});

test('readyCorpus: the session’s answer when it has one; the bundled baseline when it has none; remembered until a sync succeeds', () => {
  resetReadyCorpusMemory();
  // Loading with nothing remembered stays loading: nothing is claimed.
  assert.deepEqual(readyCorpus({ status: 'loading' }), { status: 'loading' });
  // A failed session: the baseline, as real records under the same rules.
  const fallen = readyCorpus({ status: 'error' });
  assert.ok(fallen.status === 'ready' && fallen.source === 'baseline');
  assert.equal(fallen.items, BASELINE_RECALLS);
  // The next screen mounting while the quiet retry is still pending shows
  // the SAME corpus (Ready after Building), never a checking flash.
  const again = readyCorpus({ status: 'loading' });
  assert.ok(again.status === 'ready' && again.source === 'baseline');
  // A successful sync replaces it and clears the memory.
  const items = [match(1, true)];
  const live = readyCorpus({ status: 'ready', items });
  assert.ok(live.status === 'ready' && live.source === 'feed');
  assert.equal(live.items, items);
  assert.deepEqual(readyCorpus({ status: 'loading' }), { status: 'loading' });
  resetReadyCorpusMemory();
});

test('the baseline goes through the same matching: real matches, the real count, Affects You computed, nothing invented', () => {
  const recordedAt = new Date(BASELINE_RECORDED_AT);
  const today = BASELINE_RECORDED_AT.slice(0, 10);
  const corpus = readyCorpus({ status: 'error' });
  resetReadyCorpusMemory();
  // At recording time, any single-state profile sees every Nationwide
  // recall the matcher qualifies for it (the recording rule keeps only the
  // current window; the one exclusion is the identified allergen-only rule,
  // which withholds a `undeclared milk` recall from a shopper who chose no
  // allergens — the Feed's own behaviour, unchanged).
  const nationwide = BASELINE_RECALLS.filter((i) => i.geography.scope === 'nationwide');
  assert.ok(nationwide.length > 0, 'the recorded baseline holds no Nationwide recall');
  for (const states of [['CA'], ['WY'], ['NY', 'TX']]) {
    const prefs = { states, allergens: [], retailers: [] };
    const preview = buildReadyPreview(corpus, prefs, today, recordedAt);
    assert.ok(preview.kind === 'matches', `${states.join('+')}: no matches at recording time`);
    assert.equal(preview.source, 'baseline');
    // Every match genuinely affects this profile; the count is the match list.
    assert.equal(preview.total, affectsYouMatches(BASELINE_RECALLS, prefs, recordedAt).length);
    const qualifying = nationwide.filter(
      (item) => evaluatePersonalRelevance(item, prefs).affectsMe,
    ).length;
    assert.ok(qualifying > 0 && preview.total >= qualifying);
    for (const model of preview.models) assert.equal(model.affectsYou, true);
    assert.equal(hasLockedMatches(preview), preview.total > preview.models.length);
  }
  // A profile nothing can reach is an honest none, even on the baseline.
  const none = buildReadyPreview(corpus, EMPTY_PREFERENCES, today, recordedAt);
  assert.equal(none.kind, 'none');
});

test('live recovery replaces the baseline deck and count with the genuine corpus; a preference edit recomputes offline', () => {
  resetReadyCorpusMemory();
  const recordedAt = new Date(BASELINE_RECORDED_AT);
  const today = BASELINE_RECORDED_AT.slice(0, 10);
  const offline = buildReadyPreview(readyCorpus({ status: 'error' }), PREFS, today, recordedAt);
  assert.ok(offline.kind === 'matches' && offline.source === 'baseline');
  // Editing preferences offline recomputes from the same baseline.
  const edited = buildReadyPreview(
    readyCorpus({ status: 'loading' }),
    { ...PREFS, states: ['CA', 'TX'] },
    today,
    recordedAt,
  );
  assert.ok(edited.kind === 'matches' && edited.source === 'baseline');
  assert.ok(edited.total >= offline.total);
  // Then the sync lands: the live corpus, its own count, no baseline card.
  const live = buildReadyPreview(
    readyCorpus({ status: 'ready', items: [match(1, true), match(2, false)] }),
    PREFS,
    TODAY,
    NOW,
  );
  assert.ok(live.kind === 'matches' && live.source === 'feed');
  assert.equal(live.total, 2);
  assert.ok(!live.models.some((m) => BASELINE_RECALLS.some((b) => b.id === m.id)));
  resetReadyCorpusMemory();
});
