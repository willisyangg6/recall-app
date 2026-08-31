/**
 * The persistent feed cache DOCUMENT (Phase C8) — serialization, validation,
 * and corruption handling for the complete cached corpus. Pure module: no
 * storage, no network, no Expo imports, so every invariant is testable in
 * Node.
 *
 * The cache holds exactly one thing: the last COMPLETE corpus a sync
 * committed, plus the per-case sync tokens it was committed under. There is
 * deliberately no partial state to represent — a document either parses into
 * a complete, well-formed corpus or it is discarded whole and the next load
 * is a cold one. Silent partial acceptance would recreate the truncated-feed
 * failure C5.1 eliminated.
 *
 * Version semantics (the load-bearing invariant): a cached item's token is
 * the manifest token that PROMPTED its download, recorded before the row was
 * fetched. Content is therefore always at least as new as its token claims —
 * a token can lag content (costing one redundant re-download) but can never
 * lead it (which would hide a stale row from every future diff). `null`
 * means "not yet verified against any manifest"; the sync engine treats null
 * as changed, so unverified rows are re-fetched on the next reconciliation.
 *
 * Privacy: the document contains recall content only. No installation id,
 * no preferences, no push token, no credentials — asserted by tests against
 * the serialized bytes.
 */

import type { FeedItem } from './recall-feed';

/**
 * Bump when the document shape changes; a mismatch triggers a cold rebuild.
 *
 * v2 (C10B) — feed rows gained `productCategories`. The bump is REQUIRED, not
 * hygiene, and the reason is a race the manifest cannot see:
 *
 *   A v1 cache written by a pre-C10B build holds rows with no category key,
 *   under the manifest tokens those rows carried at download time. If the
 *   historical backfill lands and the user's client re-syncs BEFORE taking the
 *   app update, the old build re-downloads every case (the token moved) and
 *   re-caches it — still without the field, because the old SELECT does not
 *   ask for it — now under the POST-backfill token. On the app update the new
 *   build's sync would then find every token matching, download nothing, and
 *   serve an un-enriched corpus that looks fully enriched. Category would
 *   silently show an empty feed for every chip.
 *
 * The token cannot catch this: it hashes what the SERVER holds, and the server
 * is correct — what changed is which columns the CLIENT asks for. A cache
 * document is only interchangeable between builds that select the same fields,
 * which is exactly what this version number means.
 */
export const FEED_CACHE_SCHEMA_VERSION = 2;

export interface FeedCacheDocument {
  schemaVersion: typeof FEED_CACHE_SCHEMA_VERSION;
  /** When the sync that committed this corpus finished (ISO). */
  syncedAt: string;
  /** The complete consumer-visible active corpus, unordered. */
  items: FeedItem[];
  /** Case id → sync token the item was committed under; null = unverified. */
  versions: Record<string, string | null>;
}

export function serializeFeedCache(document: FeedCacheDocument): string {
  return JSON.stringify(document);
}

/**
 * Parse and validate a stored document. Returns null — never throws, never a
 * partial document — for anything unusable: unparsable bytes, a different
 * schema version, structural damage, or duplicate case ids. The caller
 * treats null as "no cache" and performs a complete cold load.
 */
export function parseFeedCache(text: string): FeedCacheDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const document = parsed as Record<string, unknown>;
  if (document.schemaVersion !== FEED_CACHE_SCHEMA_VERSION) return null;
  if (typeof document.syncedAt !== 'string') return null;
  if (!Array.isArray(document.items)) return null;
  if (typeof document.versions !== 'object' || document.versions === null) return null;

  const seen = new Set<string>();
  for (const item of document.items) {
    if (typeof item !== 'object' || item === null) return null;
    const id = (item as Record<string, unknown>).id;
    if (typeof id !== 'string' || id === '') return null;
    // A duplicated case would double-count in every section; that is
    // corruption, not something to repair silently.
    if (seen.has(id)) return null;
    seen.add(id);
  }
  for (const version of Object.values(document.versions as Record<string, unknown>)) {
    if (version !== null && typeof version !== 'string') return null;
  }
  return {
    schemaVersion: FEED_CACHE_SCHEMA_VERSION,
    syncedAt: document.syncedAt,
    items: document.items as FeedItem[],
    versions: document.versions as Record<string, string | null>,
  };
}
