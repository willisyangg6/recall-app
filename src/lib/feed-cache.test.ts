/**
 * C8 cache-document tests: corruption and incompatibility always read as
 * "no cache" (never as a partial corpus), and the serialized document holds
 * recall content only — no installation identity, preferences, or push
 * material can ever ride along.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FEED_CACHE_SCHEMA_VERSION,
  parseFeedCache,
  serializeFeedCache,
  type FeedCacheDocument,
} from './feed-cache';
import { makeCorpus } from './feed-fixtures';

function document(overrides: Partial<FeedCacheDocument> = {}): FeedCacheDocument {
  const items = makeCorpus(12);
  return {
    schemaVersion: FEED_CACHE_SCHEMA_VERSION,
    syncedAt: '2026-08-28T12:00:00.000Z',
    items,
    versions: Object.fromEntries(items.map((item) => [item.id, `v-${item.id}`])),
    ...overrides,
  };
}

test('a valid document round-trips byte-identically', () => {
  const original = document();
  const parsed = parseFeedCache(serializeFeedCache(original));
  assert.ok(parsed);
  assert.equal(JSON.stringify(parsed), JSON.stringify(original));
});

test('unparsable bytes read as no cache', () => {
  assert.equal(parseFeedCache('not json at all'), null);
  assert.equal(parseFeedCache('{"schemaVersion":1,"items":[{'), null);
  assert.equal(parseFeedCache(''), null);
});

test('structural damage reads as no cache, never as a partial corpus', () => {
  assert.equal(parseFeedCache(JSON.stringify({ schemaVersion: 1 })), null);
  assert.equal(
    parseFeedCache(serializeFeedCache(document({ items: [{ id: '' }] as never }))),
    null,
  );
  assert.equal(
    parseFeedCache(serializeFeedCache(document({ items: [{ noId: true }] as never }))),
    null,
  );
  assert.equal(parseFeedCache(JSON.stringify({ ...document(), versions: null })), null);
  assert.equal(parseFeedCache(JSON.stringify({ ...document(), syncedAt: 42 })), null);
});

test('a different schema version reads as no cache (rebuild, not misread)', () => {
  const future = { ...document(), schemaVersion: FEED_CACHE_SCHEMA_VERSION + 1 };
  assert.equal(parseFeedCache(JSON.stringify(future)), null);
});

test('duplicate case ids are corruption, not something to render twice', () => {
  const items = makeCorpus(5);
  const doubled = document({ items: [...items, items[2]] });
  assert.equal(parseFeedCache(serializeFeedCache(doubled)), null);
});

test('non-string version tokens are corruption', () => {
  const damaged = document();
  (damaged.versions as Record<string, unknown>)[damaged.items[0].id] = 7;
  assert.equal(parseFeedCache(serializeFeedCache(damaged)), null);
});

test('the serialized cache carries no installation id, preferences, or push token material', () => {
  const serialized = serializeFeedCache(document({ items: makeCorpus(50) }));
  // Keys used by the preference store, push registration, and installation
  // identity. None of them can appear in a document built from FeedItems —
  // this pins that the document shape never grows a side channel.
  for (const forbidden of [
    '"installationId"',
    '"installation_id"',
    '"expoPushToken"',
    '"expo_push_token"',
    'ExponentPushToken',
    '"stateCode"',
    '"state_code"',
    '"retailerIds"',
    '"retailer_ids"',
    '"allergens"',
    'SUPABASE_SECRET_KEY',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `cache must not contain ${forbidden}`);
  }
});
