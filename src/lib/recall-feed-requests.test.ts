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

// ── Product categories on the feed row (C10B) ───────────────────────────────
//
// Driven through the real loader against a recording fetch, so the SELECT and
// the mapping are pinned as one thing: a test that mapped a hand-built row
// could pass while the column was never requested.

/** A minimal PostgREST row; `product_categories` is whatever the test names. */
const rowWith = (productCategories: unknown) => ({
  id: 'case-1',
  source_agency: 'FDA',
  notice_type: 'recall',
  state: 'active',
  title: 'Firm Recalls Product',
  classification: { value: 'class_I', sourceText: null, officialClasses: ['class_I'] },
  hazard_category: 'allergen',
  published_at: '2026-08-01',
  last_public_activity_at: '2026-08-01',
  reason_text: null,
  pathogen_or_allergen: null,
  firm_name: null,
  brands: null,
  product_description: null,
  retailer_names: null,
  hero_image_url: null,
  product_names: null,
  geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
  official_url: 'https://example.test/x',
  timeline: null,
  product_categories: productCategories,
});

async function loadOne(productCategories: unknown) {
  const { fetchFeedPage } = await loaded;
  recordingFetch(() => [rowWith(productCategories)]);
  const [item] = await fetchFeedPage(null, 10);
  return item;
}

test('the feed SELECT asks for the derived categories, and nothing else new', async () => {
  const { fetchFeedPage } = await loaded;
  const urls = recordingFetch(() => []);
  await fetchFeedPage(null, 500);
  const url = decodeURIComponent(urls[0]);
  assert.match(url, /product_categories:projection->productCategories/);
  // The classifier's inputs stay server-side: the app receives the answer, not
  // the evidence. `product_description` is already selected for the card's
  // product name and is not new here; `summaryText` — the classifier's
  // announcement span — must never be.
  assert.equal(url.includes('summaryText'), false);
  assert.equal(url.includes('announcement'), false);
});

test('valid stored categories map through in canonical order', async () => {
  const item = await loadOne(['meat_poultry', 'bakery_grains']);
  assert.deepEqual(item.productCategories, ['meat_poultry', 'bakery_grains']);
});

test('missing categories are UNDEFINED, and undefined is not Other', async () => {
  // The load-bearing distinction: a row the backfill has not reached carries
  // no answer at all, and must never be presented as "we looked and could not
  // name it". `null`, an absent key, and an empty list all mean the same
  // nothing — and none of them means `['other']`.
  for (const stored of [undefined, null, []]) {
    const item = await loadOne(stored);
    assert.equal(item.productCategories, undefined, JSON.stringify(stored));
  }
  const other = await loadOne(['other']);
  assert.deepEqual(other.productCategories, ['other']);
});

test('malformed, unknown, duplicate and out-of-order values normalize safely', async () => {
  // Unknown ids dropped, duplicates collapsed, display order restored.
  assert.deepEqual((await loadOne(['seafood', 'produce', 'seafood'])).productCategories, [
    'produce',
    'seafood',
  ]);
  assert.deepEqual(
    (await loadOne(['frozen_foods_v2', 'dairy_eggs', 17, null, {}])).productCategories,
    ['dairy_eggs'],
  );
  // `other` beside a real category is dropped — "we could not name this" is
  // false the moment we could.
  assert.deepEqual((await loadOne(['other', 'produce'])).productCategories, ['produce']);
  // Shapes Postgres would happily store but nothing should trust.
  for (const junk of ['produce', 42, { produce: true }, [['produce']]]) {
    const item = await loadOne(junk);
    assert.equal(item.productCategories, undefined, JSON.stringify(junk));
  }
  // Nothing valid left is the same as nothing at all — never `[]`.
  assert.equal((await loadOne(['frozen_foods_v2'])).productCategories, undefined);
});

test('the by-id sync path carries categories identically to a cold load', async () => {
  // A row re-downloaded by the incremental sync must be byte-identical to the
  // one a full load produced, or a warm cache would drift from a cold one.
  const { fetchFeedItemsByIds } = await loaded;
  recordingFetch(() => [rowWith(['snacks_sweets'])]);
  const [byId] = await fetchFeedItemsByIds(['case-1']);
  const cold = await loadOne(['snacks_sweets']);
  assert.deepEqual(byId, cold);
});

test('pagination is unchanged by the added column', async () => {
  const { fetchFeedPage } = await loaded;
  const urls = recordingFetch(() => []);
  await fetchFeedPage('case-00500', 500);
  assert.match(urls[0], /state=eq\.active/);
  assert.match(urls[0], /id=gt\.case-00500/);
  assert.match(urls[0], /order=id\.asc/);
  assert.match(urls[0], /limit=500/);
});
