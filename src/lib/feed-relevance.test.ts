/**
 * All recalls sectioning and order (2026-10-05): one date — material
 * activity — decides both the recent/older split and the newest-first order,
 * for both sections. Wording edits (`lastPublicActivityAt` movement) and our
 * own writes decide nothing.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TimelineEntry } from '@/domain/recall-types';
import { buildFeedSections, feedTier } from './feed-relevance';
import type { FeedItem } from './recall-feed';

const NOW = new Date('2026-08-21T12:00:00Z');

function published(occurredAt: string): TimelineEntry {
  return {
    occurredAt,
    kind: 'published',
    summary: 'Recall published.',
    causedBySnapshotIds: [],
    material: false,
  };
}

function material(occurredAt: string, kind: TimelineEntry['kind'] = 'expanded'): TimelineEntry {
  return {
    occurredAt,
    kind,
    summary: 'Authoritative change.',
    causedBySnapshotIds: [],
    material: true,
    ruleId: kind === 'classified' ? 'classification_assigned' : 'expansion_products',
  };
}

function bookkeeping(occurredAt: string): TimelineEntry {
  return {
    occurredAt,
    kind: 'source_updated',
    summary: 'Source record updated (no consumer-relevant change).',
    causedBySnapshotIds: [],
    material: false,
  };
}

let seq = 0;
function item(overrides: Partial<FeedItem>): FeedItem {
  const publishedAt = overrides.publishedAt ?? '2026-08-17';
  seq += 1;
  return {
    id: `case-${String(seq).padStart(3, '0')}`,
    fdaOngoingAsOf: null,
    sourceAgency: 'FSIS',
    noticeType: 'recall',
    state: 'active',
    title: 'Test',
    classification: { value: 'class_I', sourceText: 'Class I', officialClasses: ['class_I'] },
    hazardCategory: 'unknown',
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
    geography: { scope: 'unknown', states: [], confidence: 'stated', sourceText: null },
    officialUrl: 'https://example.gov',
    timeline: [published(publishedAt)],
    ...overrides,
  };
}

test('a stale agency-active PHA is never placed among recent items', () => {
  const stalePha = item({ noticeType: 'public_health_alert', publishedAt: '2022-08-24' });
  assert.equal(feedTier(stalePha, NOW), 'older_active');
});

test('a recent PHA stays in the current feed', () => {
  const recentPha = item({ noticeType: 'public_health_alert', publishedAt: '2026-08-08' });
  assert.equal(feedTier(recentPha, NOW), 'recent');
});

test('an old case with a genuine material update counts as recent', () => {
  const updated = item({
    publishedAt: '2026-02-19',
    lastPublicActivityAt: '2026-08-13',
    timeline: [published('2026-02-19'), material('2026-08-13')],
  });
  assert.equal(feedTier(updated, NOW), 'recent');
});

test('an old case moved only by a wording edit is NOT recent, although lastPublicActivityAt moved', () => {
  const churned = item({
    publishedAt: '2026-02-19',
    lastPublicActivityAt: '2026-08-13',
    timeline: [published('2026-02-19'), bookkeeping('2026-08-13')],
  });
  assert.equal(feedTier(churned, NOW), 'older_active');
});

test('an empty or missing timeline falls back to the announcement date', () => {
  assert.equal(feedTier(item({ publishedAt: '2026-08-17', timeline: [] }), NOW), 'recent');
  assert.equal(feedTier(item({ publishedAt: '2026-01-17', timeline: [] }), NOW), 'older_active');
});

test('an enforcement-dated classification AFTER lastPublicActivityAt counts — material activity is not bounded by it', () => {
  // The live shape (232 of 911 active cases on 2026-10-05): FDA classified the
  // recall after the announcement page was last modified. The classification
  // is the agency's event and dates the case.
  const classified = item({
    publishedAt: '2026-05-01',
    lastPublicActivityAt: '2026-05-04',
    timeline: [published('2026-05-01'), material('2026-08-15', 'classified')],
  });
  assert.equal(feedTier(classified, NOW), 'recent');
});

test('sections split on material activity, and BOTH sections are newest first', () => {
  const items = [
    item({ publishedAt: '2026-08-17' }),
    item({ publishedAt: '2014-06-01' }),
    item({ publishedAt: '2022-08-24' }),
    item({ publishedAt: '2026-08-08' }),
    // Announced 2021, expanded 2022: older, but ahead of the 2022 announcement
    // because its material activity is later.
    item({
      publishedAt: '2021-03-03',
      timeline: [published('2021-03-03'), material('2022-09-01')],
    }),
  ];
  const { recent, olderActive } = buildFeedSections(items, NOW);
  assert.deepEqual(
    recent.map((i) => i.publishedAt),
    ['2026-08-17', '2026-08-08'],
  );
  assert.deepEqual(
    olderActive.map((i) => i.publishedAt),
    ['2021-03-03', '2022-08-24', '2014-06-01'],
  );
});

test('a newer Pending recall leads an older Critical one: severity is not an order', () => {
  const criticalOlder = item({ publishedAt: '2026-08-01' });
  const pendingNewer = item({
    publishedAt: '2026-08-19',
    classification: { value: 'not_yet_classified', sourceText: null, officialClasses: [] },
  });
  const moderateNewest = item({
    publishedAt: '2026-08-20',
    classification: { value: 'class_II', sourceText: 'Class II', officialClasses: ['class_II'] },
  });
  const { recent } = buildFeedSections([criticalOlder, pendingNewer, moderateNewest], NOW);
  assert.deepEqual(
    recent.map((i) => i.id),
    [moderateNewest.id, pendingNewer.id, criticalOlder.id],
  );
});

test('a same-day material entry bumps nothing: the case keeps its announcement date', () => {
  const sameDay = item({
    publishedAt: '2026-08-10',
    timeline: [published('2026-08-10'), material('2026-08-10', 'classified')],
  });
  const plain = item({ publishedAt: '2026-08-10' });
  const { recent } = buildFeedSections([sameDay, plain], NOW);
  // Equal material activity and announcement: the id tie-break decides.
  assert.deepEqual(
    recent.map((i) => i.id),
    [sameDay.id, plain.id].sort(),
  );
});

test('ties are total and stable: any input permutation gives the same order', () => {
  const a = item({ id: 'zzz', publishedAt: '2026-08-10' });
  const b = item({ id: 'aaa', publishedAt: '2026-08-10' });
  const c = item({ id: 'mmm', publishedAt: '2026-08-10' });
  const expected = ['aaa', 'mmm', 'zzz'];
  for (const permutation of [
    [a, b, c],
    [c, a, b],
    [b, c, a],
  ]) {
    assert.deepEqual(
      buildFeedSections(permutation, NOW).recent.map((i) => i.id),
      expected,
    );
  }
});

test('sorting never mutates the input', () => {
  const items = [item({ publishedAt: '2026-08-01' }), item({ publishedAt: '2026-08-17' })];
  const before = items.map((i) => i.id);
  buildFeedSections(items, NOW);
  assert.deepEqual(
    items.map((i) => i.id),
    before,
  );
});

// ── P2B7Q.1: resurfacing and identity survive the update-note removal ───────

/**
 * The founder removed the generated update NOTE from Recall Detail, and kept
 * update RESURFACING. These pin the difference, because the two are easy to
 * confuse and only one of them was ever the shopper's signal that something
 * changed.
 *
 * What a shopper is told about an update, after P2B7Q.1:
 *
 *   · the recall returns to Recent activity (this file);
 *   · its card and its Detail header read "Updated <date>", earned from the
 *     material-change ledger (`activityDisplay`);
 *   · and nothing paraphrases what changed.
 *
 * Since 2026-10-05 "returns to Recent activity" is earned by the SAME material
 * ledger entry that earns "Updated" — never by a page edit.
 */
test('P2B7Q.1: an update resurfaces a years-old recall into Recent activity', () => {
  const resurfaced = item({
    publishedAt: '2017-05-16',
    lastPublicActivityAt: '2026-08-13',
    timeline: [published('2017-05-16'), material('2026-08-13')],
  });
  const dormant = item({ publishedAt: '2017-05-16' });
  assert.equal(feedTier(resurfaced, NOW), 'recent');
  assert.equal(feedTier(dormant, NOW), 'older_active');

  const { recent, olderActive } = buildFeedSections([dormant, resurfaced], NOW);
  assert.deepEqual(
    recent.map((i) => i.id),
    [resurfaced.id],
  );
  assert.equal(olderActive.length, 1);
});
