/**
 * C8 sync-engine tests: every commit is a complete corpus; failures preserve
 * the previous complete cache; changes of every kind — new, changed,
 * removed, merged, maintenance-enriched — reconcile without re-downloading
 * the unchanged remainder.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FEED_CACHE_SCHEMA_VERSION, parseFeedCache } from './feed-cache';
import {
  makeCorpus,
  makeFeedItem,
  manifestFor,
  memoryCacheStore,
  scriptedTransport,
} from './feed-fixtures';
import { createFeedSession, loadCachedFeed, syncFeed } from './feed-sync';

const NOW = () => new Date('2026-08-28T12:00:00Z');

function ids(items: { id: string }[]): string[] {
  return items.map((item) => item.id).sort();
}

test('empty cache performs one complete load and commits it', async () => {
  const corpus = makeCorpus(30);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  assert.equal(outcome.mode, 'full');
  assert.equal(scripted.calls.all, 1);
  assert.deepEqual(ids(outcome.items), ids(corpus));
  assert.equal(outcome.downloadedRows, 30);
  assert.equal(outcome.persisted, true);
  const stored = parseFeedCache(cache.current()!);
  assert.ok(stored);
  assert.deepEqual(ids(stored.items), ids(corpus));
  // Every item committed under the manifest token that vouched for it.
  for (const entry of manifestFor(corpus)) {
    assert.equal(stored.versions[entry.id], entry.version);
  }
});

test('cold load over 500 cases holds every case exactly once (no ceiling can return)', async () => {
  // 623 cases — deliberately past the old 500-row ceiling AND past one page.
  const corpus = makeCorpus(623);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  assert.equal(outcome.items.length, 623);
  assert.equal(new Set(outcome.items.map((item) => item.id)).size, 623);
  assert.deepEqual(ids(outcome.items), ids(corpus));
});

test('warm unchanged sync downloads zero full rows', async () => {
  const corpus = makeCorpus(40);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  const warm = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  assert.equal(warm.mode, 'incremental');
  assert.equal(warm.downloadedRows, 0);
  assert.equal(scripted.calls.byIds.length, 0);
  assert.equal(scripted.calls.all, 1); // only the cold load
  assert.deepEqual(ids(warm.items), ids(corpus));
});

test('a new case is added by downloading only that case', async () => {
  const corpus = makeCorpus(40);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  const added = makeFeedItem(900);
  const next = [...corpus, added];
  scripted.setManifest(manifestFor(next));
  scripted.setAll(next);

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  assert.equal(outcome.mode, 'incremental');
  assert.deepEqual(scripted.calls.byIds, [[added.id]]);
  assert.equal(outcome.downloadedRows, 1);
  assert.deepEqual(ids(outcome.items), ids(next));
});

test('a changed case is replaced, unchanged cases are not re-downloaded', async () => {
  const corpus = makeCorpus(40);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  const changed = { ...corpus[7], title: 'UPDATED: recall expanded to more lots' };
  const next = corpus.map((item) => (item.id === changed.id ? changed : item));
  scripted.setManifest(manifestFor(next));
  scripted.setAll(next);

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  assert.deepEqual(scripted.calls.byIds, [[changed.id]]);
  const held = outcome.items.find((item) => item.id === changed.id);
  assert.equal(held?.title, changed.title);
  assert.deepEqual(ids(outcome.items), ids(next));
});

test('a case becoming inactive is removed without any row download', async () => {
  const corpus = makeCorpus(40);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  const closedId = corpus[3].id;
  const next = corpus.filter((item) => item.id !== closedId);
  scripted.setManifest(manifestFor(next));
  scripted.setAll(next);

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  assert.equal(outcome.downloadedRows, 0);
  assert.deepEqual(outcome.removedIds, [closedId]);
  assert.deepEqual(ids(outcome.items), ids(next));
  assert.deepEqual(ids(parseFeedCache(cache.current()!)!.items), ids(next));
});

test('a merged case (hidden by RLS, gone from the manifest) is removed', async () => {
  // Merging surfaces to the client as disappearance from the visible set —
  // exactly like closing. The cache must drop it the same way.
  const corpus = makeCorpus(25);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  const mergedId = corpus[10].id;
  const survivors = corpus.filter((item) => item.id !== mergedId);
  scripted.setManifest(manifestFor(survivors));
  scripted.setAll(survivors);

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.deepEqual(outcome.removedIds, [mergedId]);
  assert.equal(
    outcome.items.some((item) => item.id === mergedId),
    false,
  );
});

test('retailer enrichment is detected even though lastChangedAt-style fields never moved', async () => {
  const corpus = makeCorpus(30);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  // The maintenance repair changes ONLY projection.retailerNames; dates and
  // timeline are untouched. The manifest token is a content hash, so it
  // moves anyway — that is the entire reason the token is not a timestamp.
  const enriched = { ...corpus[5], retailerNames: ['Costco', 'Safeway'] };
  const next = corpus.map((item) => (item.id === enriched.id ? enriched : item));
  scripted.setManifest(manifestFor(next));
  scripted.setAll(next);

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.deepEqual(scripted.calls.byIds, [[enriched.id]]);
  const held = outcome.items.find((item) => item.id === enriched.id);
  assert.deepEqual(held?.retailerNames, ['Costco', 'Safeway']);
});

test('image enrichment is detected the same way', async () => {
  const corpus = makeCorpus(30);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  const enriched = { ...corpus[6], heroImageUrl: 'https://example.test/backfilled.webp' };
  const next = corpus.map((item) => (item.id === enriched.id ? enriched : item));
  scripted.setManifest(manifestFor(next));
  scripted.setAll(next);

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  const held = outcome.items.find((item) => item.id === enriched.id);
  assert.equal(held?.heroImageUrl, 'https://example.test/backfilled.webp');
});

test('a row changing between manifest and row fetch converges on the next sync', async () => {
  const corpus = makeCorpus(20);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  // The manifest vouches for v2 of the case, but by the time the row is
  // fetched the source moved to v3. The engine stores the NEWER content
  // under the OLDER token — content may lead its token, never lag it.
  const v2 = { ...corpus[2], title: 'v2 title' };
  const v3 = { ...corpus[2], title: 'v3 title' };
  const manifestAtV2 = manifestFor(corpus.map((item) => (item.id === v2.id ? v2 : item)));
  scripted.setManifest(manifestAtV2);
  scripted.setByIds(() => [v3]);

  const first = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(first.items.find((item) => item.id === v2.id)?.title, 'v3 title');

  // Next reconciliation: the manifest now names v3's token, which differs
  // from the stored (v2) token, so the case re-downloads and converges.
  const nextCorpus = corpus.map((item) => (item.id === v3.id ? v3 : item));
  scripted.setManifest(manifestFor(nextCorpus));
  scripted.setByIds(() => [v3]);
  const second = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.deepEqual(scripted.calls.byIds.at(-1), [v3.id]);
  assert.equal(second.items.find((item) => item.id === v3.id)?.title, 'v3 title');

  // And a third sync with nothing changed is quiet: converged.
  const third = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(third.downloadedRows, 0);
});

test('a failed manifest request falls back to the complete loader, and total failure preserves the cache', async () => {
  const corpus = makeCorpus(30);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  const committed = cache.current();

  // Manifest down, full loader up: the sync still returns a complete corpus.
  scripted.setManifest(new Error('manifest 404'));
  const fallback = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(fallback.mode, 'full');
  assert.equal(fallback.manifestAvailable, false);
  assert.deepEqual(ids(fallback.items), ids(corpus));

  // Manifest AND loader down: the sync throws and the cache is untouched.
  cache.setStored(committed);
  scripted.setAll(new Error('network down'));
  await assert.rejects(syncFeed({ store: cache.store, transport: scripted.transport, now: NOW }));
  assert.equal(cache.current(), committed);
  const preserved = await loadCachedFeed(cache.store);
  assert.deepEqual(ids(preserved!.items), ids(corpus));
});

test('a failed changed-row request preserves the previous complete cache', async () => {
  const corpus = makeCorpus(30);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  const committed = cache.current();

  const changed = { ...corpus[4], title: 'changed' };
  scripted.setManifest(
    manifestFor(corpus.map((item) => (item.id === changed.id ? changed : item))),
  );
  scripted.setByIds(new Error('row fetch failed'));

  await assert.rejects(syncFeed({ store: cache.store, transport: scripted.transport, now: NOW }));
  assert.equal(cache.current(), committed);
});

test('a partial sync is never committed: nothing is written before every fetch succeeds', async () => {
  const corpus = makeCorpus(30);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  const writesBefore = cache.writes.length;

  // Three changed cases; the row fetch dies mid-flight. However much the
  // transport managed internally, the engine commits nothing.
  const next = corpus.map((item, index) =>
    index < 3 ? { ...item, title: `changed ${index}` } : item,
  );
  scripted.setManifest(manifestFor(next));
  scripted.setByIds(new Error('died mid-fetch'));

  await assert.rejects(syncFeed({ store: cache.store, transport: scripted.transport, now: NOW }));
  assert.equal(cache.writes.length, writesBefore);
});

test('a corrupt cache is discarded and triggers a complete rebuild', async () => {
  const corpus = makeCorpus(20);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore('{"schemaVersion":1,"truncated');

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  assert.equal(outcome.mode, 'full');
  assert.equal(scripted.calls.all, 1);
  assert.deepEqual(ids(outcome.items), ids(corpus));
  assert.deepEqual(ids(parseFeedCache(cache.current()!)!.items), ids(corpus));
});

test('a cache-schema mismatch triggers a safe rebuild', async () => {
  const corpus = makeCorpus(20);
  const scripted = scriptedTransport(corpus);
  const futureDocument = JSON.stringify({
    schemaVersion: FEED_CACHE_SCHEMA_VERSION + 1,
    syncedAt: NOW().toISOString(),
    items: [],
    versions: {},
  });
  const cache = memoryCacheStore(futureDocument);

  assert.equal(await loadCachedFeed(cache.store), null);
  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(outcome.mode, 'full');
  assert.deepEqual(ids(outcome.items), ids(corpus));
});

test('duplicate rows and duplicate manifest entries never create duplicate cases', async () => {
  const corpus = makeCorpus(15);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  // The full loader dedupes in production; simulate a transport that does not.
  scripted.setAll([...corpus, corpus[0], corpus[1]]);
  scripted.setManifest([...manifestFor(corpus), ...manifestFor([corpus[2]])]);

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  assert.equal(outcome.items.length, 15);
  assert.equal(new Set(outcome.items.map((item) => item.id)).size, 15);
  const stored = parseFeedCache(cache.current()!);
  assert.ok(stored); // parse would reject duplicates as corruption
});

test('an id the manifest lists but the row fetch cannot see is removed, not left stale', async () => {
  const corpus = makeCorpus(20);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  // The case went inactive between the manifest read and the row fetch: the
  // row query (same active+RLS contract) returns nothing for it.
  const vanishing = corpus[8];
  scripted.setManifest(
    manifestFor(corpus.map((item) => (item.id === vanishing.id ? { ...item, title: 'x' } : item))),
  );
  scripted.setByIds(() => []);

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(
    outcome.items.some((item) => item.id === vanishing.id),
    false,
  );
  assert.ok(outcome.removedIds.includes(vanishing.id));
});

test('concurrent refreshes coalesce into one reconciliation', async () => {
  const corpus = makeCorpus(20);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  // Hold the manifest fetch open so both calls overlap.
  let release: (entries: ReturnType<typeof manifestFor>) => void;
  const gate = new Promise<ReturnType<typeof manifestFor>>((resolve) => {
    release = resolve;
  });
  const session = createFeedSession({
    store: cache.store,
    transport: {
      ...scripted.transport,
      fetchManifest: () => {
        scripted.calls.manifest += 1;
        return gate;
      },
    },
    now: NOW,
  });

  const first = session.sync();
  const second = session.sync();
  assert.equal(first, second); // literally the same in-flight promise
  release!(manifestFor(corpus));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(scripted.calls.manifest, 1);
});

test('a refresh after completion performs a fresh reconciliation (pull-to-refresh)', async () => {
  const corpus = makeCorpus(20);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  const session = createFeedSession({
    store: cache.store,
    transport: scripted.transport,
    now: NOW,
  });

  await session.sync();
  const added = makeFeedItem(901);
  scripted.setManifest(manifestFor([...corpus, added]));
  scripted.setAll([...corpus, added]);

  const refreshed = await session.sync();
  assert.equal(scripted.calls.manifest, 2); // a real second reconciliation
  assert.ok(refreshed.items.some((item) => item.id === added.id));
});

test('large drift takes the complete loader instead of hundreds of id fetches', async () => {
  const corpus = makeCorpus(40);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  const next = corpus.map((item, index) =>
    index < 25 ? { ...item, title: `bulk change ${index}` } : item,
  );
  scripted.setManifest(manifestFor(next));
  scripted.setAll(next);

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(outcome.mode, 'full');
  assert.equal(scripted.calls.byIds.length, 0);
  assert.deepEqual(ids(outcome.items), ids(next));
});

test('an empty manifest over a non-empty cache is verified against the complete loader', async () => {
  const corpus = makeCorpus(20);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  scripted.setManifest([]);
  // The loader still sees the corpus: the manifest's word alone never empties
  // the feed.
  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(outcome.mode, 'full');
  assert.deepEqual(ids(outcome.items), ids(corpus));
});

test('with no cache store (web), every sync is a complete network load', async () => {
  const corpus = makeCorpus(30);
  const scripted = scriptedTransport(corpus);

  const first = await syncFeed({ store: null, transport: scripted.transport, now: NOW });
  const second = await syncFeed({ store: null, transport: scripted.transport, now: NOW });

  assert.equal(first.mode, 'full');
  assert.equal(second.mode, 'full');
  assert.equal(first.persisted, false);
  assert.equal(scripted.calls.all, 2);
  assert.deepEqual(ids(second.items), ids(corpus));
});

test('a cache write failure still returns the fresh complete corpus', async () => {
  const corpus = makeCorpus(20);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  cache.setFailWrites(true);

  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(outcome.persisted, false);
  assert.deepEqual(ids(outcome.items), ids(corpus));
  assert.equal(cache.current(), null);
});

test('recovery after a manifest outage returns to incremental syncs', async () => {
  const corpus = makeCorpus(30);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();

  scripted.setManifest(new Error('manifest down'));
  const fallback = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(fallback.manifestAvailable, false);

  // Manifest returns: the null tokens force one verifying reload, after
  // which unchanged refreshes are quiet again.
  scripted.setManifest(manifestFor(corpus));
  const verify = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(verify.mode, 'full'); // all tokens were null → large drift path
  const warm = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(warm.mode, 'incremental');
  assert.equal(warm.downloadedRows, 0);
});
