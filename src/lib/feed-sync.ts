/**
 * Feed reconciliation engine (Phase C8): renders the last complete cached
 * corpus instantly, then keeps it complete by downloading only what changed.
 *
 * ## The contract (unchanged from C5.1)
 *
 * Every result this module hands the UI is a COMPLETE consumer-visible
 * active corpus, or nothing. There is no partial success: a sync either
 * commits a corpus the manifest vouches for, or it throws and the previous
 * complete corpus (cache or memory) stands. All Recalls, "affects me",
 * search, and every filter run over exactly what a cold load would have
 * produced — caching changes transfer, never membership or content.
 *
 * ## The protocol
 *
 *  1. Fetch the complete manifest (id → opaque version token, complete-or-
 *     throw, same id-cursor paging as the feed).
 *  2. Diff against the cache: ids the cache lacks or holds under a different
 *     (or null) token need downloading; cached ids absent from the manifest
 *     are removed (closed, retracted, or merged — the manifest view serves
 *     exactly the consumer read contract).
 *  3. Download the needed rows — by id when few, via the frozen complete
 *     loader when many (or when there is no cache) — and commit atomically:
 *     items plus the manifest tokens that prompted each download.
 *
 * ## Consistency model (documented honestly)
 *
 * Tokens are recorded BEFORE their rows are fetched, so cached content is
 * always at least as new as its token claims. A row that changes mid-sync is
 * stored with the older token and re-fetched on the next reconciliation —
 * one redundant download, never an undetectable stale row. A case added or
 * hidden after the manifest read appears/disappears one sync later. The
 * committed corpus is therefore a consistent snapshot no older than this
 * sync's manifest, converging within one further sync for concurrent
 * changes. An id requested by the sync that the row fetch does not return
 * is authoritatively no longer visible (the row query carries the same
 * `state=active` + RLS contract) and is removed in the same commit.
 *
 * ## Failure behavior
 *
 *  - Manifest unavailable (endpoint missing pre-migration, or any error):
 *    fall back to the frozen complete loader. Success commits the corpus
 *    with null tokens (re-verified next sync); failure throws with the
 *    cache untouched.
 *  - Any row-fetch failure: throw, commit nothing, cache untouched.
 *  - Cache write failure: the fresh corpus is still returned and served
 *    from memory; only persistence is lost.
 *  - Corrupt or schema-mismatched cache: discarded whole, cold load.
 *
 * Pure module: storage and transport are injected, no Expo imports.
 */

import {
  FEED_CACHE_SCHEMA_VERSION,
  parseFeedCache,
  serializeFeedCache,
  type FeedCacheDocument,
} from './feed-cache';
import type { FeedCacheStore } from './feed-cache-store';
import type { FeedItem, FeedManifestEntry } from './recall-feed';

export interface FeedSyncTransport {
  /** Complete manifest or throw (fetchCurrentManifest). */
  fetchManifest(): Promise<FeedManifestEntry[]>;
  /** Complete corpus or throw — the frozen C5.1 loader (fetchCurrentFeed). */
  fetchAll(): Promise<FeedItem[]>;
  /** Full rows for specific ids; missing ids are authoritative removals. */
  fetchByIds(ids: string[]): Promise<FeedItem[]>;
}

export interface FeedSyncOutcome {
  /** The complete corpus this sync committed. */
  items: FeedItem[];
  /**
   * How the corpus was obtained: 'incremental' downloaded only changed rows;
   * 'full' used the complete loader (no cache, large drift, or manifest
   * unavailable).
   */
  mode: 'incremental' | 'full';
  /** False when the manifest endpoint failed and the full fallback ran. */
  manifestAvailable: boolean;
  /** Full feed rows downloaded by this sync (0 = warm unchanged refresh). */
  downloadedRows: number;
  /** Cases removed because they are no longer consumer-visible. */
  removedIds: string[];
  /** True when the committed document reached persistent storage. */
  persisted: boolean;
}

/**
 * How stale this DEVICE's last successful sync may be before returning to
 * the foreground triggers a revalidation (P2B7S).
 *
 * 15 minutes, against a server that refreshes every ~45 min: short enough
 * that a returning shopper is never far behind what the server knows, long
 * enough that app-switching costs nothing. One revalidation is one manifest
 * request — measured 82.4 KB raw / 37.9 KB gzipped for today's 898 cases —
 * and downloads zero rows when nothing changed.
 *
 * It is also the debounce. iOS reports `inactive` for the app switcher,
 * Control Centre and the notification shade, and a return from any of those
 * arrives as the same background-to-active transition as a real one; every
 * such event inside the window is dropped without a request.
 *
 * It lives beside the session it governs. It is a SYNC threshold, not a
 * freshness one: nothing about it is shown to a shopper.
 */
export const FOREGROUND_REVALIDATE_AFTER_MINUTES = 15;

/**
 * Above this fraction of the manifest needing download, the frozen complete
 * loader is cheaper than id-batched requests (500 rows/request vs 60) and is
 * the exhaustively proven path — so large drift and cold starts both take it.
 */
const FULL_RELOAD_FRACTION = 0.5;

export async function loadCachedFeed(
  store: FeedCacheStore | null,
): Promise<FeedCacheDocument | null> {
  if (!store) return null;
  const text = await store.read();
  if (text === null) return null;
  const document = parseFeedCache(text);
  if (document === null) {
    // Corrupt or incompatible: discard whole so the next load is cold. A
    // damaged document must never linger and re-fail every launch.
    await store.clear();
    return null;
  }
  return document;
}

interface SyncDependencies {
  store: FeedCacheStore | null;
  transport: FeedSyncTransport;
  now?: () => Date;
}

async function commit(
  store: FeedCacheStore | null,
  items: FeedItem[],
  versions: Record<string, string | null>,
  now: () => Date,
): Promise<boolean> {
  if (!store) return false;
  const document: FeedCacheDocument = {
    schemaVersion: FEED_CACHE_SCHEMA_VERSION,
    syncedAt: now().toISOString(),
    items,
    versions,
  };
  return store.write(serializeFeedCache(document));
}

/** Complete load through the frozen loader, committed with the given tokens. */
async function fullReload(
  deps: SyncDependencies,
  manifest: FeedManifestEntry[] | null,
  cachedIds: Set<string>,
  now: () => Date,
): Promise<FeedSyncOutcome> {
  const fetched = await deps.transport.fetchAll();
  // Collapse by id (last occurrence wins): the real loader already dedupes,
  // but the cache document must never be committable with a doubled case —
  // parseFeedCache treats duplicates as corruption.
  const items = [...new Map(fetched.map((item) => [item.id, item])).values()];
  const tokenById = new Map(manifest?.map((entry) => [entry.id, entry.version]) ?? []);
  const versions: Record<string, string | null> = {};
  for (const item of items) {
    // A row the manifest did not list (appeared mid-sync, or no manifest)
    // gets a null token and is re-verified on the next reconciliation.
    versions[item.id] = tokenById.get(item.id) ?? null;
  }
  const nextIds = new Set(items.map((item) => item.id));
  const persisted = await commit(deps.store, items, versions, now);
  return {
    items,
    mode: 'full',
    manifestAvailable: manifest !== null,
    downloadedRows: items.length,
    removedIds: [...cachedIds].filter((id) => !nextIds.has(id)),
    persisted,
  };
}

/**
 * One full reconciliation. Resolves with a complete corpus or throws with
 * the previous cache untouched. Callers wanting coalescing use
 * `createFeedSession` below.
 */
export async function syncFeed(deps: SyncDependencies): Promise<FeedSyncOutcome> {
  const now = deps.now ?? (() => new Date());
  const cached = await loadCachedFeed(deps.store);
  const cachedIds = new Set(cached?.items.map((item) => item.id) ?? []);

  let manifest: FeedManifestEntry[] | null;
  try {
    manifest = await deps.transport.fetchManifest();
  } catch {
    // Endpoint missing (pre-migration backend) or failing: the complete
    // loader is the fallback. If IT also fails, the throw propagates and the
    // cache — still the last complete corpus — keeps serving.
    manifest = null;
  }
  if (manifest === null) {
    return fullReload(deps, null, cachedIds, now);
  }

  // An empty manifest against a non-empty cache is either a mass closure or
  // a server fault; the complete loader is authoritative for both, and this
  // never commits an emptied corpus on the manifest's word alone.
  if (manifest.length === 0 && cachedIds.size > 0) {
    return fullReload(deps, manifest, cachedIds, now);
  }

  const tokenById = new Map(manifest.map((entry) => [entry.id, entry.version]));
  const need: string[] = [];
  for (const { id, version } of manifest) {
    const held = cached && cachedIds.has(id) ? cached.versions[id] : undefined;
    // undefined = not cached; null = cached but never verified; mismatch =
    // changed. All three download.
    if (held === undefined || held === null || held !== version) need.push(id);
  }
  const removedIds = [...cachedIds].filter((id) => !tokenById.has(id));

  if (cached === null || need.length > manifest.length * FULL_RELOAD_FRACTION) {
    return fullReload(deps, manifest, cachedIds, now);
  }

  let fetched: FeedItem[] = [];
  if (need.length > 0) {
    // Any failure here throws before anything is committed.
    fetched = await deps.transport.fetchByIds(need);
  }
  const fetchedById = new Map(fetched.map((item) => [item.id, item]));

  const nextById = new Map(cached.items.map((item) => [item.id, item]));
  const versions: Record<string, string | null> = {};
  for (const item of cached.items) versions[item.id] = cached.versions[item.id] ?? null;
  for (const id of removedIds) {
    nextById.delete(id);
    delete versions[id];
  }
  for (const id of need) {
    const item = fetchedById.get(id);
    if (item === undefined) {
      // Listed by the manifest, gone by row-fetch time: authoritatively no
      // longer consumer-visible. Removed now rather than left stale.
      nextById.delete(id);
      delete versions[id];
      removedIds.push(id);
      continue;
    }
    nextById.set(id, item);
    // The token recorded is the one that PROMPTED the download: content can
    // only be newer than it, so a mid-sync change re-downloads next sync
    // instead of hiding.
    versions[id] = tokenById.get(id) ?? null;
  }

  const items = [...nextById.values()];
  const persisted = await commit(deps.store, items, versions, now);
  return {
    items,
    mode: 'incremental',
    manifestAvailable: true,
    downloadedRows: fetched.length,
    removedIds,
    persisted,
  };
}

export interface FeedSession {
  /** The cached complete corpus for instant render, or null. */
  getCached(): Promise<FeedItem[] | null>;
  /**
   * Run (or join) a reconciliation. Concurrent callers — mount revalidation
   * and a pull-to-refresh, say — share one in-flight sync; a call made after
   * completion starts a fresh one. Every resolution is a complete corpus.
   */
  sync(): Promise<FeedSyncOutcome>;
  /**
   * The foreground contract (P2B7S). Sync only when this session's last
   * SUCCESSFUL sync is older than `maxAgeMs`; otherwise resolve `null`
   * having issued no request at all.
   *
   * Three properties, and all three are why this lives here and not in a
   * React effect:
   *
   *   - A sync already in flight is JOINED, never duplicated. A pull-to-
   *     refresh and a foreground return landing together make one request.
   *   - The age is measured from the last sync that SUCCEEDED. A failed
   *     attempt does not count as a refresh, so the next foreground retries
   *     instead of waiting out the window over a corpus that never updated.
   *   - It is a plain function of injected time, so every rapid-AppState,
   *     duplicate-listener and hot-reload case is an ordinary unit test
   *     rather than something that must be reproduced on a device.
   */
  syncIfOlderThan(maxAgeMs: number): Promise<FeedSyncOutcome | null>;
  /** Device-clock ms of the last successful sync, or null. Test/diagnostic. */
  lastSyncedAtMs(): number | null;
}

export function createFeedSession(deps: SyncDependencies): FeedSession {
  let inFlight: Promise<FeedSyncOutcome> | null = null;
  // Device clock, used only as the left side of a device-to-device
  // subtraction, so a wrong-but-stable device clock measures it correctly.
  let lastSyncedAtMs: number | null = null;
  const clockMs = (): number => (deps.now ? deps.now().getTime() : Date.now());

  const session: FeedSession = {
    async getCached(): Promise<FeedItem[] | null> {
      const cached = await loadCachedFeed(deps.store);
      return cached?.items ?? null;
    },
    sync(): Promise<FeedSyncOutcome> {
      if (inFlight === null) {
        inFlight = syncFeed(deps)
          .then((outcome) => {
            // Recorded on success ONLY. A throw leaves the previous value
            // standing, so a broken network cannot make the session believe
            // it is up to date.
            lastSyncedAtMs = clockMs();
            return outcome;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    },
    syncIfOlderThan(maxAgeMs: number): Promise<FeedSyncOutcome | null> {
      // Join first: an in-flight sync IS a refresh happening right now, and
      // starting a second would be the duplicate request this exists to
      // prevent.
      if (inFlight !== null) return inFlight;
      if (lastSyncedAtMs !== null) {
        const elapsed = clockMs() - lastSyncedAtMs;
        // A device clock that jumped BACKWARD makes elapsed negative. Treat
        // that as "cannot tell" and sync, which costs one manifest request
        // and is the safe direction; the alternative is a session that
        // believes it is permanently fresh.
        if (elapsed >= 0 && elapsed < maxAgeMs) return Promise.resolve(null);
      }
      return session.sync();
    },
    lastSyncedAtMs(): number | null {
      return lastSyncedAtMs;
    },
  };
  return session;
}
