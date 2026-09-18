/**
 * The shared in-memory copy of the saved list, as a pure external store
 * (P3C1.5 — extracted from `hooks/use-saved-recalls` so the cold-launch
 * sequence is testable under Node, and so `loaded` stops being read from
 * module scope during render).
 *
 * ## The defect this extraction fixes
 *
 * The subscription lived here in spirit already; what did not was `loaded`.
 * It was computed in the hook body as `snapshot !== null` — a read of a
 * MODULE-LEVEL MUTABLE VARIABLE during render, which is exactly the thing
 * `useSyncExternalStore` exists to prevent. React only re-renders a
 * component for external state it reached through `getSnapshot`, and only
 * treats `getSnapshot`'s result as that state. A second value read beside it
 * is invisible to React: it is not compared, not part of the tearing check,
 * and — with the React Compiler enabled in this app (`app.json`
 * `experiments.reactCompiler`) — not a dependency of any memoization the
 * compiler inserts around the returned object.
 *
 * On the WARM path the mistake is masked: a Feed card has already driven the
 * store to loaded long before the Saved tab mounts, so `loaded` is true on
 * Saved's very first render and no update is needed. On the COLD path
 * (launching straight into `/saved`, where the Saved screen is the first
 * subscriber) `loaded` has to flip from false to true *after* mount, and a
 * value React does not track is not a safe thing to flip a screen on.
 *
 * So `loaded` is part of the snapshot now: one object, published together
 * with the ids, reached only through `getSnapshot`. Whether this was the
 * whole of the observed cold-launch symptom is NOT claimed here — it could
 * not be reproduced on any build available in this milestone (see
 * `docs/recall-release-readiness.md`). It is fixed because it is wrong.
 *
 * ## What is preserved exactly
 *
 * One store for the whole app, one storage read shared by every subscriber,
 * storage as the authority (a publish always carries what storage returned,
 * never an optimistic guess), and failure degrading to "nothing saved"
 * rather than to an exception on a screen.
 */

/**
 * What every subscriber sees. `loaded` is false only before the first
 * storage read resolves; `ids` is empty until then, so a screen that renders
 * the list anyway shows nothing rather than something wrong.
 */
export interface SavedRecallsSnapshot {
  readonly ids: readonly string[];
  readonly loaded: boolean;
}

export interface SavedRecallsCache {
  /** React's subscribe: the first subscriber triggers the one storage read. */
  subscribe(listener: () => void): () => void;
  /**
   * The current snapshot. Stable by identity between publishes — React calls
   * this on every render and a fresh object each time would loop forever.
   */
  getSnapshot(): SavedRecallsSnapshot;
  /** Publish what storage now holds (after a toggle). */
  publish(ids: readonly string[]): void;
  /**
   * Storage was deleted by "Reset app and delete my data": an empty list is
   * the truth, and it is LOADED — not "not yet read", which would send every
   * mounted screen back to its loading state and re-read a deleted file.
   */
  forget(): void;
}

export interface SavedRecallsCacheDeps {
  /** The one storage read. Rejection is treated as "nothing saved". */
  load: () => Promise<string[]>;
  /** Whether saving exists on this platform at all (false on web). */
  available: () => boolean;
}

/** The snapshot every unloaded store starts from, frozen and shared. */
const EMPTY: readonly string[] = Object.freeze([]);

export function createSavedRecallsCache(deps: SavedRecallsCacheDeps): SavedRecallsCache {
  const listeners = new Set<() => void>();
  // Where saving does not exist there is nothing to wait for, so the store
  // starts loaded and empty and no read is ever attempted.
  let snapshot: SavedRecallsSnapshot = deps.available()
    ? { ids: EMPTY, loaded: false }
    : { ids: EMPTY, loaded: true };
  let reading: Promise<void> | null = null;

  function set(next: SavedRecallsSnapshot): void {
    snapshot = next;
    // A copy, so a listener that unsubscribes while being notified cannot
    // mutate the set mid-iteration.
    for (const listener of [...listeners]) listener();
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      // The first subscriber starts the read; later ones join the same
      // promise. `reading` is never cleared, so a remount (React's
      // double-invoked effects in development included) cannot start a
      // second read of the same file.
      if (!snapshot.loaded && reading === null && deps.available()) {
        reading = deps.load().then(
          (ids) => set({ ids, loaded: true }),
          // Storage trouble is not a reason to keep a screen spinning: the
          // honest answer is that nothing is saved, and it is a final one.
          () => set({ ids: EMPTY, loaded: true }),
        );
      }
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): SavedRecallsSnapshot {
      return snapshot;
    },
    publish(ids: readonly string[]): void {
      set({ ids, loaded: true });
    },
    forget(): void {
      reading = Promise.resolve();
      set({ ids: EMPTY, loaded: true });
    },
  };
}
