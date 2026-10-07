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
import type { FeedItem } from './recall-feed';

const NOW = () => new Date('2026-08-28T12:00:00Z');

/**
 * Manifest requests one COLD sync costs (2026-10-05): the manifest that
 * starts the reconciliation, and the recovery pass after the full reload
 * that looks for a case founded behind the loader's cursor. A warm
 * incremental sync still costs exactly one.
 */
const COLD_MANIFESTS = 2;

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
  // One reconciliation for two callers: the cold manifest and its recovery
  // pass, never a second reconciliation's worth.
  assert.equal(scripted.calls.manifest, COLD_MANIFESTS);
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
  assert.equal(scripted.calls.manifest, COLD_MANIFESTS + 1); // a real second reconciliation
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

// ── Cache resilience (P2B7S) ───────────────────────────────────────────────

test('a failed sync leaves the cached corpus untouched', async () => {
  const corpus = makeCorpus(20);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  const before = cache.current();

  scripted.setManifest(new Error('offline'));
  scripted.setAll(new Error('offline'));
  await assert.rejects(syncFeed({ store: cache.store, transport: scripted.transport, now: NOW }));

  assert.equal(cache.current(), before, 'a failed refresh rewrote the cache');
  assert.equal(parseFeedCache(cache.current()!)!.items.length, 20);
});

test('a cache from any other app version is discarded whole, never half-read', async () => {
  // Rejected by version, so the next load is cold and complete rather than
  // a corpus of unknown field coverage.
  //
  // v3 is in this list deliberately. P2B7S briefly wrote a v3 document
  // carrying an ingestion-freshness snapshot; that field is gone, and when
  // rows next changed shape (open evidence, 2026-10-06) the version skipped
  // to 4 so those development-only v3 caches still drop cleanly instead of
  // being half-read. v2 is the last shipped shape without open evidence.
  const cache = memoryCacheStore();
  for (const stale of [1, 2, 3, 99]) {
    cache.setStored(
      JSON.stringify({
        schemaVersion: stale,
        syncedAt: '2026-08-28T12:00:00.000Z',
        items: makeCorpus(5),
        versions: {},
        freshness: { observedAt: 'x', receivedAtDeviceMs: 1 },
      }),
    );
    assert.equal(await loadCachedFeed(cache.store), null, `v${stale} was accepted`);
    assert.equal(cache.current(), null, `v${stale} was not discarded`);
  }
});

test('the committed document stores the corpus and its tokens, and nothing else', async () => {
  // No freshness, no operational metadata: the device keeps recall content
  // and sync tokens only.
  const corpus = makeCorpus(8);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  const raw = JSON.parse(cache.current()!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(raw).sort(), ['items', 'schemaVersion', 'syncedAt', 'versions']);
  assert.ok(!cache.current()!.includes('freshness'));
  assert.ok(!cache.current()!.includes('checkedAt'));
});

// ── Foreground revalidation (P2B7S) ─────────────────────────────────────────

/** A session over a settable device clock, so thresholds are testable. */
function foregroundSession(corpus = makeCorpus(12)) {
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  let clock = Date.parse('2026-08-28T12:00:00.000Z');
  const session = createFeedSession({
    store: cache.store,
    transport: scripted.transport,
    now: () => new Date(clock),
  });
  return {
    session,
    scripted,
    cache,
    advanceMinutes: (minutes: number) => {
      clock += minutes * 60_000;
    },
    setClock: (ms: number) => {
      clock = ms;
    },
  };
}

const FIFTEEN_MINUTES = 15 * 60_000;

test('a foreground return inside the threshold issues no request at all', async () => {
  const { session, scripted, advanceMinutes } = foregroundSession();
  await session.sync();
  assert.equal(scripted.calls.manifest, COLD_MANIFESTS);

  advanceMinutes(14);
  assert.equal(await session.syncIfOlderThan(FIFTEEN_MINUTES), null);
  assert.equal(
    scripted.calls.manifest,
    COLD_MANIFESTS,
    'a skipped foreground still hit the network',
  );
});

test('a foreground return past the threshold revalidates exactly once', async () => {
  const { session, scripted, advanceMinutes } = foregroundSession();
  await session.sync();
  advanceMinutes(15);

  const outcome = await session.syncIfOlderThan(FIFTEEN_MINUTES);
  assert.ok(outcome, 'the threshold boundary did not revalidate');
  assert.equal(scripted.calls.manifest, COLD_MANIFESTS + 1);
});

test('rapid AppState events cost one request, not one each', async () => {
  // iOS reports `inactive` for the app switcher, Control Centre and the
  // notification shade; a return from any of those looks exactly like a
  // real foreground. The threshold IS the debounce.
  const { session, scripted, advanceMinutes } = foregroundSession();
  await session.sync();
  advanceMinutes(20);

  const results = await Promise.all(
    Array.from({ length: 12 }, () => session.syncIfOlderThan(FIFTEEN_MINUTES)),
  );
  assert.equal(
    scripted.calls.manifest,
    COLD_MANIFESTS + 1,
    'a burst of transitions fanned out into requests',
  );
  // Every caller got the same in-flight reconciliation.
  const synced = results.filter((outcome) => outcome !== null);
  assert.equal(synced.length, 12);
  assert.equal(new Set(synced).size, 1);
});

test('a foreground return JOINS a sync already in flight rather than starting a second', async () => {
  const { session, scripted, advanceMinutes } = foregroundSession();
  await session.sync();
  advanceMinutes(60);

  let release: ((entries: ReturnType<typeof manifestFor>) => void) | null = null;
  const pending = new Promise<ReturnType<typeof manifestFor>>((resolve) => {
    release = resolve;
  });
  scripted.setManifest([]);
  const slow = { ...scripted.transport, fetchManifest: () => pending };
  const joined = createFeedSession({ store: memoryCacheStore().store, transport: slow });

  const pull = joined.sync();
  const foreground = joined.syncIfOlderThan(FIFTEEN_MINUTES);
  assert.equal(await Promise.race([foreground, Promise.resolve('pending')]), 'pending');
  release!(manifestFor([]));
  assert.equal(await pull, await foreground);
});

test('the threshold is measured from the last SUCCESSFUL sync, not the last attempt', async () => {
  // A failed attempt must not buy silence: the corpus never updated, so the
  // next foreground has to try again rather than wait out the window.
  const { session, scripted, advanceMinutes } = foregroundSession();
  await session.sync();
  advanceMinutes(20);

  scripted.setManifest(new Error('offline'));
  scripted.setAll(new Error('offline'));
  await assert.rejects(session.syncIfOlderThan(FIFTEEN_MINUTES));
  const attempts = scripted.calls.manifest;

  advanceMinutes(1); // well inside the window since the FAILED attempt
  scripted.setManifest(manifestFor([]));
  scripted.setAll([]);
  const retried = await session.syncIfOlderThan(FIFTEEN_MINUTES);
  assert.ok(retried, 'a failed attempt was treated as a refresh');
  // An empty manifest over a non-empty cache takes the complete loader, whose
  // recovery pass costs the second manifest of a cold sync.
  assert.equal(scripted.calls.manifest, attempts + COLD_MANIFESTS);
});

test('a session that has never synced always revalidates on foreground', async () => {
  const { session, scripted } = foregroundSession();
  const outcome = await session.syncIfOlderThan(FIFTEEN_MINUTES);
  assert.ok(outcome);
  assert.equal(scripted.calls.manifest, COLD_MANIFESTS);
});

test('a device clock that jumps BACKWARD revalidates rather than believing it is fresh', async () => {
  // Clamping the elapsed time to zero would leave the session permanently
  // convinced it had just synced. One extra manifest request is the safe
  // outcome.
  const { session, scripted, setClock } = foregroundSession();
  await session.sync();
  const synced = session.lastSyncedAtMs()!;
  setClock(synced - 3_600_000);

  assert.ok(await session.syncIfOlderThan(FIFTEEN_MINUTES));
  assert.equal(scripted.calls.manifest, COLD_MANIFESTS + 1);
});

test('the cached corpus is available before any request, so the list never flashes empty', async () => {
  const corpus = makeCorpus(9);
  const { session, scripted, cache } = foregroundSession(corpus);
  await session.sync();

  const warm = createFeedSession({ store: cache.store, transport: scripted.transport });
  const cached = await warm.getCached();
  assert.ok(cached);
  assert.equal(cached.length, 9);
  assert.equal(scripted.calls.manifest, COLD_MANIFESTS, 'reading the cache issued a request');
});

test('no cache and no network yields nothing to show, and says so by throwing', async () => {
  // The screens turn this into their error state. What must never happen is
  // resolving with an empty corpus, which would render as "no current
  // recalls" — a false statement about the world.
  const scripted = scriptedTransport([]);
  scripted.setManifest(new Error('offline'));
  scripted.setAll(new Error('offline'));
  const cache = memoryCacheStore();
  const session = createFeedSession({ store: cache.store, transport: scripted.transport });

  assert.equal(await session.getCached(), null);
  await assert.rejects(session.sync());
});

// ── The Building → Ready handoff (2026-10-02) ──────────────────────────────

test('served() is the newest complete corpus handed out: the cache until a sync finishes, then the sync', async () => {
  const corpus = makeCorpus(12);
  const { session: first, scripted, cache } = foregroundSession(corpus);
  await first.sync();

  const session = createFeedSession({ store: cache.store, transport: scripted.transport });
  assert.equal(session.served(), null, 'served something before anything was read');
  const cached = await session.getCached();
  assert.deepEqual(ids(session.served() ?? []), ids(cached ?? []));

  const next = [...corpus, makeFeedItem(901)];
  scripted.setManifest(manifestFor(next));
  scripted.setAll(next);
  const outcome = await session.sync();
  assert.equal(
    session.served(),
    outcome.items,
    'Ready would not open on the corpus Building counted',
  );
  // A later cache read can only be as new as that sync: it never replaces it.
  await session.getCached();
  assert.equal(session.served(), outcome.items);
});

test('a failed sync leaves served() exactly as it was: a failure is never handed on as a corpus', async () => {
  const corpus = makeCorpus(6);
  const { session: first, scripted, cache } = foregroundSession(corpus);
  await first.sync();
  const session = createFeedSession({ store: cache.store, transport: scripted.transport });
  const cached = await session.getCached();
  scripted.setManifest(new Error('offline'));
  scripted.setAll(new Error('offline'));
  await assert.rejects(session.sync());
  assert.equal(session.served(), cached);

  const empty = createFeedSession({
    store: memoryCacheStore().store,
    transport: scripted.transport,
  });
  await assert.rejects(empty.sync());
  assert.equal(empty.served(), null);
});

// ── Recovery behind the cursor (2026-10-05) ──────────────────────────────────

/**
 * A server whose complete loader can be interrupted by ingestion: between the
 * first and second page, a case announced TODAY is founded with an id that
 * sorts BEFORE the cursor. The real loader cannot see it (demonstrated with
 * `loadAllPages` directly); the full reload's recovery pass must.
 */
function serverWithFoundingMidScan(size: number) {
  let rows = makeCorpus(size);
  const newest = makeFeedItem(7, {
    id: 'case-00000-founded-mid-scan',
    publishedAt: '2026-08-28T00:00:00.000Z',
    lastPublicActivityAt: '2026-08-28T00:00:00.000Z',
    timeline: [
      {
        occurredAt: '2026-08-28T00:00:00.000Z',
        kind: 'published',
        summary: 'Recall published.',
        causedBySnapshotIds: [],
        material: false,
      },
    ],
  });
  let founded = false;
  const calls = { manifest: 0, byIds: [] as string[][] };
  const transport = {
    async fetchManifest() {
      calls.manifest += 1;
      return manifestFor(rows);
    },
    // The complete loader as the server sees it: id pages of 500, and the
    // founding lands after page 1 has been served.
    async fetchAll() {
      const out = [];
      let cursor: string | null = null;
      for (;;) {
        const page = [...rows]
          .sort((a, b) => a.id.localeCompare(b.id))
          .filter((r) => cursor === null || r.id > cursor)
          .slice(0, 500);
        out.push(...page);
        if (!founded) {
          founded = true;
          rows = [...rows, newest];
        }
        if (page.length < 500) break;
        cursor = page[page.length - 1].id;
      }
      return out;
    },
    async fetchByIds(ids: string[]) {
      calls.byIds.push([...ids]);
      return rows.filter((r) => ids.includes(r.id));
    },
  };
  return { transport, calls, newest, size: () => rows.length };
}

test('a case founded behind the cursor during a full reload is recovered in the same sync', async () => {
  const server = serverWithFoundingMidScan(1200);
  const cache = memoryCacheStore();

  const outcome = await syncFeed({ store: cache.store, transport: server.transport, now: NOW });

  assert.equal(outcome.mode, 'full');
  assert.equal(server.size(), 1201);
  assert.equal(outcome.items.length, 1201, 'the founded case is in the committed corpus');
  assert.ok(outcome.items.some((item) => item.id === server.newest.id));
  assert.equal(outcome.downloadedRows, 1201);
  // Exactly one recovery manifest after the cold one, and exactly the missing id.
  assert.equal(server.calls.manifest, 2);
  assert.deepEqual(server.calls.byIds, [[server.newest.id]]);
  // Committed under the token that listed it, so the next sync does not re-fetch it.
  const stored = parseFeedCache(cache.current()!);
  assert.ok(stored);
  assert.equal(stored.items.length, 1201);
  assert.equal(stored.versions[server.newest.id], manifestFor([server.newest])[0].version);
  const again = await syncFeed({ store: cache.store, transport: server.transport, now: NOW });
  assert.equal(again.mode, 'incremental');
  assert.equal(again.downloadedRows, 0);
});

test('with nothing founded behind the cursor the recovery pass downloads nothing', async () => {
  const corpus = makeCorpus(30);
  const scripted = scriptedTransport(corpus);
  const cache = memoryCacheStore();
  const outcome = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(outcome.downloadedRows, 30);
  assert.equal(scripted.calls.manifest, 2, 'the cold manifest and the recovery manifest');
  assert.deepEqual(scripted.calls.byIds, []);
});

test('a failing recovery pass leaves the complete full result standing', async () => {
  const server = serverWithFoundingMidScan(600);
  const cache = memoryCacheStore();
  let manifests = 0;
  const transport = {
    ...server.transport,
    async fetchManifest() {
      manifests += 1;
      if (manifests === 2) throw new Error('recovery manifest offline');
      return server.transport.fetchManifest();
    },
  };
  const outcome = await syncFeed({ store: cache.store, transport, now: NOW });
  assert.equal(outcome.items.length, 600, 'complete as of the scan; the founded case waits');
  assert.equal(outcome.persisted, true);
  // The next ordinary reconciliation finds it, exactly as before.
  const next = await syncFeed({ store: cache.store, transport, now: NOW });
  assert.equal(next.mode, 'incremental');
  assert.ok(next.items.some((item) => item.id === server.newest.id));
});

// ── Open evidence (2026-10-06): status-only changes ─────────────────────────

/**
 * The server token's shape (20261006000000_fda_ongoing_evidence.sql): the C8
 * content hash, plus `|<date>` only when evidence exists — so a null leaves
 * the token exactly as it was, and any change to the date moves it.
 */
function serverToken(item: ReturnType<typeof makeFeedItem>): string {
  const { fdaOngoingAsOf, ...content } = item;
  return `c8:${JSON.stringify(content)}${fdaOngoingAsOf === null ? '' : `|${fdaOngoingAsOf}`}`;
}

test('a status-only evidence change is detected and downloads only that row, with no other change', async () => {
  const { buildAffectsMeSections } = await import('./affects-me-ranking');
  const { buildFeedSections } = await import('./feed-relevance');
  const { buildHomeCardModel } = await import('./recall-presentation');
  const { recencyKey } = await import('./recency-order');
  const { evaluatePersonalRelevance } = await import('./relevance');

  // Every row is an FDA recall long past the window, matching California.
  const old = '2025-03-01T00:00:00.000Z';
  const corpus: FeedItem[] = makeCorpus(12).map((item) => ({
    ...item,
    sourceAgency: 'FDA' as const,
    noticeType: 'recall' as const,
    publishedAt: old,
    lastPublicActivityAt: old,
    timeline: [],
    geography: {
      scope: 'nationwide' as const,
      states: [],
      confidence: 'stated' as const,
      sourceText: 'Nationwide',
    },
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Salmonella',
    reasonText: 'Potential Salmonella contamination',
  }));
  const scripted = scriptedTransport(corpus);
  scripted.setManifest(manifestFor(corpus, serverToken));
  const cache = memoryCacheStore();
  const first = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  // The enforcement job confirms one recall open: only its column moved.
  const target = corpus[5];
  const evidenced = { ...target, fdaOngoingAsOf: '2026-08-24' };
  const next = corpus.map((item) => (item.id === target.id ? evidenced : item));
  scripted.setManifest(manifestFor(next, serverToken));
  scripted.setAll(next);
  const second = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });

  // Sync detection: exactly that row, and nothing else, was re-downloaded.
  assert.deepEqual(scripted.calls.byIds, [[target.id]]);
  assert.equal(second.downloadedRows, 1);

  const now = NOW();
  const before = first.items.find((item) => item.id === target.id)!;
  const after = second.items.find((item) => item.id === target.id)!;
  assert.equal(after.fdaOngoingAsOf, '2026-08-24');
  // No resurfacing: the recency key, the card's date line, the timeline and
  // All recalls (section and position) are exactly as before.
  assert.deepEqual(recencyKey(after), recencyKey(before));
  assert.deepEqual(after.timeline, before.timeline);
  const card = (item: FeedItem) => buildHomeCardModel(item, { today: '2026-08-28', prefs: null });
  assert.deepEqual(card(after).activity, card(before).activity);
  const allBefore = buildFeedSections(first.items, now).olderActive.map((item) => item.id);
  const allAfter = buildFeedSections(second.items, now).olderActive.map((item) => item.id);
  assert.deepEqual(allAfter, allBefore);
  assert.deepEqual(buildFeedSections(second.items, now).recent, []);

  // Membership: the recall joins the counted Affects me list — at its own
  // date's position, which for a 2025 recall is not the top.
  const ca = { states: ['CA'], allergens: [], retailers: [] };
  const counted = (items: readonly FeedItem[]) =>
    buildAffectsMeSections(items, (item) => evaluatePersonalRelevance(item, ca), {
      now,
    }).affects.map((item) => item.id);
  assert.deepEqual(counted(first.items), []);
  assert.deepEqual(counted(second.items), [target.id]);
});

test('a null evidence value leaves the server token formula unchanged', () => {
  const item = makeFeedItem(3);
  assert.equal(serverToken(item), `c8:${JSON.stringify({ ...item, fdaOngoingAsOf: undefined })}`);
});

test('evidence REMOVAL reaches a cached phone: the token returns to its original value, the engine downloads it, and all three counts drop', async () => {
  const { buildAffectsMeSections } = await import('./affects-me-ranking');
  const { buildingData } = await import('./building-watch');
  const { buildReadyPreview, previewMatchCount } = await import('./ready-preview');
  const { evaluatePersonalRelevance } = await import('./relevance');

  const old = '2025-03-01T00:00:00.000Z';
  const base: FeedItem[] = makeCorpus(8).map((item) => ({
    ...item,
    sourceAgency: 'FDA' as const,
    noticeType: 'recall' as const,
    publishedAt: old,
    lastPublicActivityAt: old,
    timeline: [],
    geography: {
      scope: 'nationwide' as const,
      states: [],
      confidence: 'stated' as const,
      sourceText: 'Nationwide',
    },
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Salmonella',
    reasonText: 'Potential Salmonella contamination',
  }));
  const target = base[3];
  const originalToken = serverToken(target);

  // 1. The phone caches the corpus while the server holds evidence on one row.
  const withEvidence = base.map((item) =>
    item.id === target.id ? { ...item, fdaOngoingAsOf: '2026-08-24' } : item,
  );
  const scripted = scriptedTransport(withEvidence);
  scripted.setManifest(manifestFor(withEvidence, serverToken));
  const cache = memoryCacheStore();
  const cached = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  const stored = parseFeedCache(cache.current()!)!;
  assert.equal(stored.items.find((item) => item.id === target.id)!.fdaOngoingAsOf, '2026-08-24');
  assert.notEqual(stored.versions[target.id], originalToken);

  // 2. The enforcement job clears it: the server token is the ORIGINAL token
  //    again, byte for byte — and still differs from what the phone holds.
  scripted.setManifest(manifestFor(base, serverToken));
  scripted.setAll(base);
  assert.equal(manifestFor(base, serverToken)[3].version, originalToken);

  // 3. The real incremental engine downloads exactly that row.
  const synced = await syncFeed({ store: cache.store, transport: scripted.transport, now: NOW });
  assert.equal(synced.mode, 'incremental');
  assert.deepEqual(scripted.calls.byIds, [[target.id]]);
  assert.equal(synced.items.find((item) => item.id === target.id)!.fdaOngoingAsOf, null);
  assert.equal(parseFeedCache(cache.current()!)!.versions[target.id], originalToken);

  // 4. All three counts drop by exactly that recall, on the same clock.
  const ca = { states: ['CA'], allergens: [], retailers: [] };
  const now = NOW();
  const counts = (items: readonly FeedItem[]) => {
    const building = buildingData({ status: 'ready', items }, false, ca, now);
    return {
      feed: buildAffectsMeSections(items, (item) => evaluatePersonalRelevance(item, ca), { now })
        .affects.length,
      building: building.kind === 'usable' ? building.total : -1,
      ready:
        previewMatchCount(buildReadyPreview({ status: 'ready', items }, ca, '2026-08-28', now)) ??
        0,
    };
  };
  assert.deepEqual(counts(cached.items), { feed: 1, building: 1, ready: 1 });
  assert.deepEqual(counts(synced.items), { feed: 0, building: 0, ready: 0 });
});
