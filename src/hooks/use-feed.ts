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
 *
 * ## Foreground revalidation (P2B7S)
 *
 * Until P2B7S the app synced on cold launch and pull-to-refresh and at no
 * other time, so an app resumed from the background without a process kill
 * never refreshed at all. It now also revalidates when the app returns to
 * the foreground, subject to a centralized age threshold.
 *
 * All four safety properties live in the SESSION, not here:
 *
 *   - concurrent cold-launch, pull-to-refresh and foreground calls coalesce
 *     into one in-flight request
 *   - a return inside the threshold issues no request at all, which is also
 *     what debounces iOS's `inactive` flapping (app switcher, Control
 *     Centre, notification shade all arrive as the same transition)
 *   - the age is measured from the last SUCCESSFUL sync, so a failed attempt
 *     does not buy silence
 *   - a failed revalidation keeps the cached corpus on screen
 *
 * That placement is what makes duplicate listeners harmless. Feed, Saved and
 * the Design Preview hub can each mount this hook; every extra listener adds
 * one skipped call against a module-level session, never an extra request.
 * The effect removes its own subscription, so a hot reload cannot accumulate
 * them either.
 *
 * ## A failed refresh over a usable corpus is SILENT
 *
 * Founder product decision: shoppers are never shown ingestion freshness,
 * "last checked" times, or stale-state messaging. When a refresh fails and
 * a complete corpus is already on screen, this hook keeps showing that
 * corpus and says nothing at all — no notice, no banner, no timestamp, no
 * announcement. Whether ingestion is healthy is an OPERATIONS question, and
 * it is answered by the dead-man heartbeat that pages the founder, not by
 * the app talking to shoppers about its own plumbing.
 *
 * The one surviving failure surface is the honest no-data state: a sync
 * that fails with NOTHING loaded still becomes the full error screen,
 * because an empty list would otherwise read as "there are no current
 * recalls", which is a false statement about the world.
 */

import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { FEED_LOAD_FAILURE } from '@/lib/feed-copy';
import { createFeedCacheStore } from '@/lib/feed-cache-store';
import {
  createFeedSession,
  FOREGROUND_REVALIDATE_AFTER_MINUTES,
  type FeedSession,
} from '@/lib/feed-sync';
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
type DevelopmentFeedModule = typeof import('@/lib/development-feed-scenarios');

/**
 * Development only: the Simulator's feed scenarios (slow, failed, zero or
 * one match) wrap the one session. The `require` sits inside the `__DEV__`
 * branch, so a release bundle folds it away with the module.
 */
const developmentFeed = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/lib/development-feed-scenarios') as DevelopmentFeedModule)
  : null;

let feedSession: FeedSession | null = null;
function getFeedSession(): FeedSession {
  if (feedSession === null) {
    const session = createFeedSession({
      store: createFeedCacheStore(),
      transport: {
        fetchManifest: fetchCurrentManifest,
        fetchAll: fetchCurrentFeed,
        fetchByIds: fetchFeedItemsByIds,
      },
    });
    feedSession =
      __DEV__ && developmentFeed ? developmentFeed.wrapDevelopmentFeedSession(session) : session;
  }
  return feedSession;
}

export interface Feed {
  state: FeedLoadState;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export interface FeedOptions {
  /**
   * The Ready step after the Building step (2026-10-02): start from the
   * corpus the session last served instead of a loading state, and revalidate
   * on mount only when the last successful sync is older than the foreground
   * threshold (joining one in flight). Ready then opens on exactly the corpus
   * Building counted, without a second reconciliation seconds later.
   */
  reuseRecent?: boolean;
  /**
   * The Feed arriving after onboarding (2026-10-04): start from the corpus
   * the session last served — the complete corpus Building and Ready just
   * showed — instead of `Loading recalls…`, and still revalidate on mount
   * exactly as a cold launch does. A session that served nothing (a true
   * cold launch, or a feed that never answered) still starts loading, so the
   * loading and error states stay honest. Implied by `reuseRecent`.
   */
  startFromServed?: boolean;
}

export function useFeed({ reuseRecent = false, startFromServed = false }: FeedOptions = {}): Feed {
  const [state, setState] = useState<FeedLoadState>(() => {
    const served = reuseRecent || startFromServed ? getFeedSession().served() : null;
    return served === null ? { status: 'loading' } : { status: 'ready', items: served };
  });
  const [refreshing, setRefreshing] = useState(false);

  // A sync resolves with a COMPLETE corpus or throws — the reconciliation
  // never hands back part of a feed, so `ready` keeps meaning complete. With
  // a `maxAgeMs` the session may answer null: skipped, nothing changes.
  const revalidate = useCallback(async (maxAgeMs?: number) => {
    try {
      const outcome =
        maxAgeMs === undefined
          ? await getFeedSession().sync()
          : await getFeedSession().syncIfOlderThan(maxAgeMs);
      if (outcome === null) return;
      setState({ status: 'ready', items: outcome.items });
    } catch (error) {
      // The cause is a developer fact (an HTTP status, a stalled page); it
      // goes to the console and nowhere near a shopper.
      if (__DEV__) console.warn('Feed sync failed', error);
      // A failed refresh must never cost the user a complete feed they
      // already have: keep showing it, silently. Only a failure with
      // nothing loaded becomes the error screen, because an empty list
      // would read as "there are no current recalls".
      setState((current) =>
        current.status === 'ready' ? current : { status: 'error', message: FEED_LOAD_FAILURE },
      );
    }
  }, []);

  useEffect(() => {
    // Cached-first render: the last complete corpus appears without waiting
    // on the network, then the background reconciliation replaces it. The
    // cache only ever fills a not-yet-ready state, so a sync that resolves
    // first is never overwritten by older cached items — and the list never
    // flashes empty during a revalidation.
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
    if (reuseRecent) void revalidate(FOREGROUND_REVALIDATE_AFTER_MINUTES * 60_000);
    else void revalidate();
    return () => {
      cancelled = true;
    };
  }, [revalidate, reuseRecent]);

  // ── Foreground revalidation ───────────────────────────────────────────────
  useEffect(() => {
    if (!isFeedConfigured()) return;
    const maxAgeMs = FOREGROUND_REVALIDATE_AFTER_MINUTES * 60_000;
    const onChange = (next: AppStateStatus): void => {
      if (next !== 'active') return;
      // The session decides whether this is worth a request; it joins one
      // already in flight and skips entirely inside the threshold, so a
      // burst of transitions costs at most the one sync already running.
      void getFeedSession()
        .syncIfOlderThan(maxAgeMs)
        .then((outcome) => {
          // Null means "skipped, nothing to report". Only a real sync moves
          // any state, so a skipped return re-renders nothing at all.
          if (outcome === null) return;
          setState({ status: 'ready', items: outcome.items });
        })
        .catch((error: unknown) => {
          // A failed foreground refresh keeps the cached corpus exactly as
          // it is, and says nothing. Nothing on screen changes.
          if (__DEV__) console.warn('Foreground feed sync failed', error);
        });
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, []);

  // Pull-to-refresh runs a real reconciliation (or joins the one in flight);
  // the feed is replaced only on complete success.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await revalidate();
    setRefreshing(false);
  }, [revalidate]);

  return { state, refreshing, refresh };
}
