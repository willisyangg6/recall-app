import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildFeedSections, feedTier } from './feed-relevance';
import type { FeedItem } from './recall-feed';

const NOW = new Date('2026-08-21T12:00:00Z');

function item(overrides: Partial<FeedItem>): FeedItem {
  return {
    id: overrides.publishedAt ?? 'id',
    sourceAgency: 'FSIS',
    noticeType: 'recall',
    state: 'active',
    title: 'Test',
    classification: { value: 'class_I', sourceText: 'Class I', officialClasses: ['class_I'] },
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
    geography: { scope: 'unknown', states: [], confidence: 'stated', sourceText: null },
    officialUrl: 'https://example.gov',
    timeline: [],
    ...overrides,
  };
}

test('a stale agency-active PHA is never placed among recent items', () => {
  const stalePha = item({
    noticeType: 'public_health_alert',
    publishedAt: '2022-08-24',
    lastPublicActivityAt: '2022-08-24',
  });
  assert.equal(feedTier(stalePha, NOW), 'older_active');
});

test('a recent PHA stays in the current feed', () => {
  const recentPha = item({
    noticeType: 'public_health_alert',
    publishedAt: '2026-08-08',
    lastPublicActivityAt: '2026-08-08',
  });
  assert.equal(feedTier(recentPha, NOW), 'recent');
});

test('an old case with genuinely recent update activity counts as recent', () => {
  const updated = item({ publishedAt: '2026-02-19', lastPublicActivityAt: '2026-08-13' });
  assert.equal(feedTier(updated, NOW), 'recent');
});

test('sections separate tiers; older items ordered by announcement date', () => {
  const items = [
    item({ publishedAt: '2026-08-17', lastPublicActivityAt: '2026-08-17' }),
    item({ publishedAt: '2014-06-01', lastPublicActivityAt: '2014-06-01' }),
    item({ publishedAt: '2022-08-24', lastPublicActivityAt: '2022-08-24' }),
    item({ publishedAt: '2026-08-08', lastPublicActivityAt: '2026-08-08' }),
  ];
  const { recent, olderActive } = buildFeedSections(items, NOW);
  assert.deepEqual(
    recent.map((i) => i.publishedAt),
    ['2026-08-17', '2026-08-08'],
  );
  assert.deepEqual(
    olderActive.map((i) => i.publishedAt),
    ['2022-08-24', '2014-06-01'],
  );
});
