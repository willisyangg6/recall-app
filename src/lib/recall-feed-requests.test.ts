/**
 * C8 request-shape pins for the client read path, driven through the real
 * module against a recording fetch: the manifest asks for two columns, the
 * by-id fetch keeps the frozen SELECT and filters with bounded chunks, and a
 * chunk failure rejects the whole call — no partial row set can ever reach
 * the sync engine.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

// The module reads EXPO_PUBLIC_* at import time, and static imports hoist
// above any assignment — so the env is pinned first and the module loaded
// dynamically, exactly the way the QA scripts do it.
const loaded = (async () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example-test.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  return import('./recall-feed');
})();

function recordingFetch(handler: (url: string) => unknown) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const body = handler(url);
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return urls;
}

test('the manifest page requests id and version only, in id order', async () => {
  const { fetchManifestPage } = await loaded;
  const urls = recordingFetch(() => [{ id: 'a', version: 'v1' }]);
  const page = await fetchManifestPage(null, 1000);
  assert.deepEqual(page, [{ id: 'a', version: 'v1' }]);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /consumer_feed_manifest\?select=id,version&order=id\.asc&limit=1000/);
});

test('the manifest cursor pages by immutable id', async () => {
  const { fetchManifestPage } = await loaded;
  const urls = recordingFetch(() => []);
  await fetchManifestPage('case-00500', 1000);
  assert.match(urls[0], /id=gt\.case-00500/);
});

test('by-id fetch keeps the frozen contract and chunks at the bound', async () => {
  const { FEED_IDS_CHUNK_SIZE, fetchFeedItemsByIds } = await loaded;
  const ids = Array.from({ length: FEED_IDS_CHUNK_SIZE + 5 }, (_, i) => `id-${i}`);
  const urls = recordingFetch(() => []);
  await fetchFeedItemsByIds(ids);

  assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.match(url, /state=eq\.active/);
    assert.match(url, /affected_products\.order=ordinal\.asc/);
    assert.match(url, /id=in\./);
  }
  // The two chunks partition the ids exactly — nothing dropped, nothing doubled.
  const requested = urls.flatMap((url) => decodeURIComponent(url).match(/id-\d+/g) ?? []);
  assert.deepEqual([...requested].sort(), [...ids].sort());
});

test('a failing chunk rejects the whole by-id fetch — no partial row set escapes', async () => {
  const { FEED_IDS_CHUNK_SIZE, fetchFeedItemsByIds } = await loaded;
  const ids = Array.from({ length: FEED_IDS_CHUNK_SIZE * 2 }, (_, i) => `id-${i}`);
  let calls = 0;
  recordingFetch(() => {
    calls += 1;
    if (calls === 2) return new Error('second chunk died');
    return [];
  });
  await assert.rejects(fetchFeedItemsByIds(ids));
});
