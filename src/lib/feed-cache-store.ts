/**
 * Native feed-cache storage (iOS/Android): one JSON document in the app's
 * private cache directory, written atomically (temp file + rename) so a
 * crash mid-write can never leave a torn document where a complete one
 * stood. Every operation is failure-tolerant: storage trouble degrades to
 * "no cache" (a cold load), never to an exception on the feed path.
 *
 * Why `Paths.cache` and not `Paths.document`: the corpus is re-downloadable
 * public data. If the OS reclaims the cache directory under storage
 * pressure, the app falls back to exactly the complete cold load it
 * performed before C8 — safe by construction. Nothing here is user data.
 *
 * Storage choice (C8 decision): a single JSON document, not SQLite. The
 * frozen product semantics require the COMPLETE corpus in memory for every
 * render — sectioning, ranking, filters, and search all run over the whole
 * set — so the access pattern is strictly read-all / replace-all. A
 * database's row-level access would buy nothing while adding a native
 * dependency and migration machinery. Revisit if the corpus grows past
 * ~5,000 cases (see docs/recall-feed-sync.md, Scaling).
 */

import { File, Paths } from 'expo-file-system';

export interface FeedCacheStore {
  /** The stored document text, or null when missing/unreadable. */
  read(): Promise<string | null>;
  /** Atomically replace the stored document. Returns false on failure. */
  write(text: string): Promise<boolean>;
  /** Remove the stored document (corruption recovery). Never throws. */
  clear(): Promise<void>;
}

const CACHE_FILE = 'recall-feed-cache-v1.json';
const TEMP_FILE = 'recall-feed-cache-v1.json.tmp';

export function createFeedCacheStore(): FeedCacheStore | null {
  return {
    async read(): Promise<string | null> {
      try {
        const file = new File(Paths.cache, CACHE_FILE);
        if (!file.exists) return null;
        return await file.text();
      } catch {
        return null;
      }
    },
    async write(text: string): Promise<boolean> {
      try {
        const temp = new File(Paths.cache, TEMP_FILE);
        if (temp.exists) temp.delete();
        temp.write(text);
        const target = new File(Paths.cache, CACHE_FILE);
        // Complete-document swap: the full text lands in the temp file first,
        // so the named cache file only ever holds a complete document. If the
        // process dies between delete and move the cache is ABSENT — which
        // reads as a cold load — never torn.
        if (target.exists) target.delete();
        temp.move(target);
        return true;
      } catch {
        return false;
      }
    },
    async clear(): Promise<void> {
      for (const name of [CACHE_FILE, TEMP_FILE]) {
        try {
          const file = new File(Paths.cache, name);
          if (file.exists) file.delete();
        } catch {
          // Unremovable cache files are re-validated (and rewritten) on the
          // next sync; nothing to surface on the feed path.
        }
      }
    },
  };
}
