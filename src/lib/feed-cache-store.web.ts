/**
 * Web feed-cache storage: deliberately none (C8 decision).
 *
 * The current expo-file-system File API does not support web, and the web
 * build's existing behavior — a complete network load per visit — is
 * correct and was shipped that way through C7. Rather than bolt on a
 * different storage backend (IndexedDB) with its own quota, eviction, and
 * private-mode failure modes inside this milestone, web keeps the complete
 * network path: `createFeedCacheStore()` returns null, and the sync engine
 * treats "no store" as "no cache" — every load is a full, complete load,
 * exactly the pre-C8 behavior. See docs/recall-feed-sync.md, Web.
 */

import type { FeedCacheStore } from './feed-cache-store';

export type { FeedCacheStore };

export function createFeedCacheStore(): FeedCacheStore | null {
  return null;
}
