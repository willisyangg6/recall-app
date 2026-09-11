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
 */

import { useCallback, useSyncExternalStore } from 'react';

import {
  loadSavedRecalls,
  savedRecallsAvailable,
  toggleSavedRecall,
} from '@/lib/saved-recalls-store';

/** Null until the first read from storage resolves. */
let snapshot: readonly string[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Stable empty snapshot: a new array each read would loop the subscription. */
const NOT_LOADED: readonly string[] = [];

function publish(ids: readonly string[]): void {
  snapshot = ids;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // First subscriber triggers the single read; later ones join it.
  if (snapshot === null && loading === null && savedRecallsAvailable()) {
    loading = loadSavedRecalls().then(
      (ids) => publish(ids),
      () => publish([]),
    );
  }
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly string[] {
  return snapshot ?? NOT_LOADED;
}

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
  const ids = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const toggle = useCallback(async (id: string) => {
    if (!savedRecallsAvailable()) return;
    publish(await toggleSavedRecall(id));
  }, []);

  return {
    ids,
    loaded: snapshot !== null || !savedRecallsAvailable(),
    available: savedRecallsAvailable(),
    toggle,
  };
}

/**
 * Drop the in-memory copy after "Reset app and delete my data" cleared
 * storage, so every mounted screen re-renders empty instead of holding the
 * deleted list until the next launch.
 */
export function forgetSavedRecallsCache(): void {
  // The reset deleted the stored document, so an empty list is the truth —
  // not a "not yet loaded" state that would re-read the file for nothing.
  loading = Promise.resolve();
  publish([]);
}
