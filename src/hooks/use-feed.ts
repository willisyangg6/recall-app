/**
 * The app's single feed session and the hook every screen reads it through.
 *
 * Extracted from the Home screen in P2A, unchanged in behavior, because the
 * Saved tab needs the SAME corpus: saved recalls are ids resolved against the
 * live feed, never a stored copy. Two screens creating their own sessions
 * would mean two caches, two reconciliations, and duplicate request storms on
 * every tab switch — exactly what the session's coalescing exists to prevent.
 *
 * `ready` always means COMPLETE: `fetchCurrentFeed` pages to exhaustion and
 * throws rather than resolving with part of the corpus, so nothing downstream
 * has to reason about a feed that might be missing its tail.
 */

import { useCallback, useEffect, useState } from 'react';

import { createFeedCacheStore } from '@/lib/feed-cache-store';
import { createFeedSession, type FeedSession } from '@/lib/feed-sync';
import {
  fetchCurrentFeed,
  fetchCurrentManifest,
  fetchFeedItemsByIds,
  isFeedConfigured,
  type FeedItem,
} from '@/lib/recall-feed';

export type FeedLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: FeedItem[] };

/**
 * One feed session for the app process (C8): it owns the persistent cache
 * and coalesces concurrent reconciliations, so a remount, the launch
 * revalidation, a tab switch, and a pull-to-refresh share one in-flight sync
 * instead of issuing duplicate request storms. Created lazily because the
 * module loads before env configuration is checked.
 */
let feedSession: FeedSession | null = null;
function getFeedSession(): FeedSession {
  if (feedSession === null) {
    feedSession = createFeedSession({
      store: createFeedCacheStore(),
      transport: {
        fetchManifest: fetchCurrentManifest,
        fetchAll: fetchCurrentFeed,
        fetchByIds: fetchFeedItemsByIds,
      },
    });
  }
  return feedSession;
}

export interface Feed {
  state: FeedLoadState;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** Set when a refresh failed over a feed we still hold — see below. */
  staleMessage: string | null;
}

export function useFeed(): Feed {
  const [state, setState] = useState<FeedLoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);

  // A sync resolves with a COMPLETE corpus or throws — the reconciliation
  // never hands back part of a feed, so `ready` keeps meaning complete.
  const revalidate = useCallback(async () => {
    try {
      const outcome = await getFeedSession().sync();
      setState({ status: 'ready', items: outcome.items });
      setStaleMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load recalls.';
      // A failed refresh must never cost the user a complete feed they already
      // have: keep showing it, and say plainly that it may be out of date.
      // Only a failure with nothing loaded becomes the full error screen.
      setState((current) => (current.status === 'ready' ? current : { status: 'error', message }));
      setStaleMessage(message);
    }
  }, []);

  useEffect(() => {
    // Cached-first render: the last complete corpus appears without waiting
    // on the network, then the background reconciliation replaces it. The
    // cache only ever fills a not-yet-ready state, so a sync that resolves
    // first is never overwritten by older cached items.
    if (!isFeedConfigured()) return;
    let cancelled = false;
    void getFeedSession()
      .getCached()
      .then((cachedItems) => {
        if (cancelled || cachedItems === null) return;
        setState((current) =>
          current.status === 'ready' ? current : { status: 'ready', items: cachedItems },
        );
      });
    // State updates happen after the network await resolves, not
    // synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void revalidate();
    return () => {
      cancelled = true;
    };
  }, [revalidate]);

  // Pull-to-refresh runs a real reconciliation (or joins the one in flight);
  // the feed is replaced only on complete success.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await revalidate();
    setRefreshing(false);
  }, [revalidate]);

  return { state, refreshing, refresh, staleMessage };
}
