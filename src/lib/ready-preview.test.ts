/**
 * The Ready preview (2026-09-28; image-led deck in the polish pass): the
 * Feed's own matching and ordering, narrowed to image-bearing matches,
 * three readable and the real next one locked, honest at every edge —
 * proven over the synthetic feed fixtures (test-only data; the screen
 * itself reads the live feed).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMPTY_PREFERENCES } from '@/domain/preferences';
import { buildAffectsMeSections } from '@/lib/affects-me-ranking';
import { makeFeedItem } from '@/lib/feed-fixtures';
import type { FeedItem } from '@/lib/recall-feed';
import { evaluatePersonalRelevance } from '@/lib/relevance';
import {
  buildReadyPreview,
  hasLockedMatches,
  matchAccessibilityLabel,
  PREVIEW_MATCH_LIMIT,
  previewDotCount,
} from './ready-preview';

const TODAY = '2026-08-28';
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

test('the preview claims nothing before the feed answers, and says so when it cannot', () => {
  assert.deepEqual(buildReadyPreview({ status: 'loading' }, PREFS, TODAY), { kind: 'checking' });
  assert.deepEqual(buildReadyPreview({ status: 'error' }, PREFS, TODAY), { kind: 'unavailable' });
});

test('zero matches is an honest none — never an invented match', () => {
  const preview = buildReadyPreview({ status: 'ready', items: [ELSEWHERE] }, PREFS, TODAY);
  assert.deepEqual(preview, { kind: 'none' });
  assert.equal(hasLockedMatches(preview), false);
  assert.equal(previewDotCount(preview), 0);
});

test('an empty profile matches nothing: the layer is the Feed’s own verdict', () => {
  const items = [1, 2, 3].map((n) => match(n, true));
  assert.deepEqual(buildReadyPreview({ status: 'ready', items }, EMPTY_PREFERENCES, TODAY), {
    kind: 'none',
  });
});

test('the deck is the ranked matches narrowed to image-bearing ones, in rank order, never reordered', () => {
  // Interleave imaged and imageless matches; the deck must be the first
  // three IMAGED ids of the Feed's own ranking, and the locked card the
  // fourth — not the raw first three results.
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
  const imagedOrder = order.filter((id) => items.find((i) => i.id === id)?.heroImageUrl);
  const preview = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY);
  assert.ok(preview.kind === 'matches');
  assert.deepEqual(
    preview.models.map((m) => m.id),
    imagedOrder.slice(0, PREVIEW_MATCH_LIMIT),
  );
  assert.equal(preview.locked?.id, imagedOrder[PREVIEW_MATCH_LIMIT]);
  // Every readable and locked card carries an image by construction.
  for (const model of [...preview.models, preview.locked!])
    assert.notEqual(model.heroImageUrl, null);
  // The total is every match, imaged or not.
  assert.equal(preview.total, 8);
  // Deterministic: the same corpus in another input order gives the same deck.
  const again = buildReadyPreview({ status: 'ready', items: [...items].reverse() }, PREFS, TODAY);
  assert.ok(again.kind === 'matches');
  assert.deepEqual(
    again.models.map((m) => m.id),
    preview.models.map((m) => m.id),
  );
  assert.equal(again.locked?.id, preview.locked?.id);
});

test('one, two and three image-bearing matches: exactly those cards, truthful dots, no locked card', () => {
  for (const count of [1, 2, 3]) {
    const items = Array.from({ length: count }, (_, i) => match(i + 1, true));
    const preview = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY);
    assert.ok(preview.kind === 'matches');
    assert.equal(preview.models.length, count);
    assert.equal(preview.locked, null, `${count}: a locked card with nothing behind it`);
    assert.equal(hasLockedMatches(preview), false, `${count}: the strip claims more`);
    assert.equal(previewDotCount(preview), count === 1 ? 0 : count, 'a lone dot says nothing');
  }
});

test('four or more image-bearing matches: three readable and the real fourth locked', () => {
  const items = [1, 2, 3, 4, 5].map((n) => match(n, true));
  const preview = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY);
  assert.ok(preview.kind === 'matches');
  assert.equal(preview.models.length, 3);
  assert.notEqual(preview.locked, null);
  assert.ok(!preview.models.some((m) => m.id === preview.locked!.id), 'a readable card is locked');
  assert.equal(previewDotCount(preview), 3, 'the locked card earned a dot');
  assert.equal(hasLockedMatches(preview), true);
});

test('more matches without images: no invented locked card, but the strip still tells the truth', () => {
  // Three imaged + two imageless: the deck is full, there is no fourth
  // image-bearing match to lock, and two real matches remain unshown.
  const items = [match(1, true), match(2, true), match(3, true), match(4, false), match(5, false)];
  const preview = buildReadyPreview({ status: 'ready', items }, PREFS, TODAY);
  assert.ok(preview.kind === 'matches');
  assert.equal(preview.models.length, 3);
  assert.equal(preview.locked, null);
  assert.equal(hasLockedMatches(preview), true);
  // No match carries an image at all: an empty deck, the count still real.
  const imageless = buildReadyPreview(
    { status: 'ready', items: [match(1, false), match(2, false)] },
    PREFS,
    TODAY,
  );
  assert.ok(imageless.kind === 'matches');
  assert.deepEqual(imageless.models, []);
  assert.equal(imageless.locked, null);
  assert.equal(imageless.total, 2);
});

test('a readable card speaks its position, risk, relevance, product and provenance', () => {
  const preview = buildReadyPreview(
    { status: 'ready', items: [1, 2, 3, 4].map((n) => match(n, true)) },
    PREFS,
    TODAY,
  );
  assert.ok(preview.kind === 'matches');
  const label = matchAccessibilityLabel(preview.models[0], 0, preview.models.length);
  assert.match(label, /^Match 1 of 3\. /);
  assert.ok(label.includes(preview.models[0].productName));
  assert.ok(label.includes('Affects you'));
});
