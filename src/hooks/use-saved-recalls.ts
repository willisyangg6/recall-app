/**
 * The one in-memory copy of the saved list, shared by every screen that
 * shows or changes it (P2A).
 *
 * Why a shared subscription rather than per-screen state: the save control
 * appears on Feed cards and on Recall Details, and the Saved tab lists the
 * result. Three independent copies would disagree the moment one of them
 * wrote — a card still reading "Save" for a recall the Detail screen just
 * saved. `useSyncExternalStore` is React's own primitive for exactly this,
 * so the app gains no state-management dependency.
 *
 * The store below is the cache; storage (saved-recalls-store) stays the
 * authority. Every toggle resolves with what STORAGE now holds, and that is
 * what gets published — a write that failed publishes the unchanged list
 * rather than an optimistic lie.
 *
 * The store itself lives in `lib/saved-recalls-cache` (P3C1.5): it is pure,
 * so the cold-launch sequence every screen depends on is driven directly in
 * `saved-recalls-cache.test.ts` instead of being reasoned about. This module
 * is the wiring — the single app-wide instance, bound to real storage.
 */

import { useCallback, useSyncExternalStore } from 'react';

import { createSavedRecallsCache } from '@/lib/saved-recalls-cache';
import {
  loadSavedRecalls,
  savedRecallsAvailable,
  toggleSavedRecall,
} from '@/lib/saved-recalls-store';

/** The app's single saved-list cache. */
const cache = createSavedRecallsCache({
  load: loadSavedRecalls,
  available: savedRecallsAvailable,
});

export interface SavedRecalls {
  /** Saved case ids, newest save first. Empty until storage has answered. */
  ids: readonly string[];
  /** False until the first storage read resolves (or on web, where saving is off). */
  loaded: boolean;
  /** Saving is offered on this platform at all. */
  available: boolean;
  /** Save or unsave one recall; resolves once storage has answered. */
  toggle: (id: string) => Promise<void>;
}

export function useSavedRecalls(): SavedRecalls {
  // Both values come through the ONE subscribed snapshot. Reading `loaded`
  // from anywhere else would be state React cannot see changing — which is
  // precisely what stranded a cold launch into Saved on its loading state.
  const { ids, loaded } = useSyncExternalStore(
    cache.subscribe,
    cache.getSnapshot,
    cache.getSnapshot,
  );
  const toggle = useCallback(async (id: string) => {
    if (!savedRecallsAvailable()) return;
    cache.publish(await toggleSavedRecall(id));
  }, []);

  return { ids, loaded, available: savedRecallsAvailable(), toggle };
}

/**
 * Drop the in-memory copy after "Reset app and delete my data" cleared
 * storage, so every mounted screen re-renders empty instead of holding the
 * deleted list until the next launch.
 */
export function forgetSavedRecallsCache(): void {
  cache.forget();
}
