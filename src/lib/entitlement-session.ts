/**
 * The entitlement session (2026-10-04): the ordering between the three
 * things that can change what this device believes about its subscription —
 * the launch read, a refresh (every return to the foreground), and a
 * verified purchase or restore — so that none of them can overwrite a newer
 * fact with an older one.
 *
 * ## The race it closes (audit F5)
 *
 * The StoreKit sheet backgrounds the app. On return a refresh starts, reads
 * the cache (nothing yet), and asks the store. The purchase then succeeds and
 * is applied. The refresh's answer lands LAST: `inactive` from a store cache
 * that predates the purchase, or `unavailable` from the launch-style timeout
 * — and either, resolved against the refresh's stale cache snapshot, would
 * revoke the purchase and send an entitled shopper to the lapsed paywall.
 *
 * ## Three guards, each pinned by `entitlement-session.test.ts`
 *
 *   1. A sequence number. `apply` increments it before anything else; a read
 *      that started under an older number discards its result entirely —
 *      no cache write, no status. (A refresh started before a purchase
 *      succeeds cannot overwrite it.)
 *   2. A store-operation guard. While `runStoreOperation` is in flight — the
 *      purchase or restore AND the apply that follows a success — a
 *      foreground refresh is not started; one runs when the operation ends,
 *      whatever its outcome. The guard is released in `finally`, so a
 *      cancellation, an error or a throw releases it too. (A foreground
 *      event cannot interfere with an in-flight operation.)
 *   3. Freshness. A reading dated before the last verified fact is stale and
 *      resolves as `unavailable` (`reconcileReading`), so the first refresh
 *      after a success cannot revoke it with pre-purchase data; a reading
 *      dated after it is a real expiry or revocation and is honoured. No
 *      new grace period: a stale store falls under the existing cached-
 *      access bound. (A post-success refresh cannot revoke on stale data.)
 *
 * Cache writes are serialized through one promise chain in call order, and
 * every read waits for the chain before loading the cache, so a refresh
 * never resolves against a cache a pending write is about to replace.
 *
 * A leaf over the pure rules in entitlement.ts: no React, no I/O of its own.
 * The hook (hooks/use-access.tsx) supplies the provider, the store and the
 * clock, and turns each committed status into state.
 */

import {
  readWithTimeout,
  reconcileReading,
  resolveEntitlement,
  type ActiveEntitlement,
  type EntitlementReading,
  type EntitlementStatus,
} from './entitlement';

export interface EntitlementSessionDeps {
  readEntitlement: () => Promise<EntitlementReading>;
  loadCache: () => Promise<ActiveEntitlement | null>;
  saveCache: (entitlement: ActiveEntitlement | null) => Promise<void>;
  /** ISO instant. */
  now: () => string;
  /** How long a read may take before it counts as unavailable. */
  timeoutMs?: number;
  /** A status that survived every guard and should become the app's. */
  onStatus: (status: EntitlementStatus) => void;
}

export interface EntitlementSession {
  /**
   * Read the provider and resolve against the cache. Resolves to the status
   * it committed, or null when the read was discarded (a purchase or restore
   * was applied while it ran), skipped (one is already running, or a store
   * operation is in flight) or failed.
   */
  read(): Promise<EntitlementStatus | null>;
  /**
   * A verified purchase or restore. The sequence advances SYNCHRONOUSLY, so a
   * read in flight is already stale when this returns; the cache write is
   * queued behind any pending write. The caller commits the status itself,
   * in the same commit as whatever else the success changes.
   */
  apply(entitlement: ActiveEntitlement): Promise<void>;
  /**
   * Run a purchase or restore (and, on success, its apply) under the store
   * guard. Foreground refreshes are deferred until it settles, then one
   * runs — after success, cancellation, error or a throw alike.
   */
  runStoreOperation<T>(operation: () => Promise<T>): Promise<T>;
  /** The app returned to the foreground: refresh, or defer while a store operation runs. */
  onForeground(): void;
  /** Settled when no cache write is pending (tests and the development reload). */
  flushCache(): Promise<void>;
  readonly storeOperationInFlight: boolean;
}

export function createEntitlementSession(deps: EntitlementSessionDeps): EntitlementSession {
  let sequence = 0;
  let reading = false;
  let operationsInFlight = 0;
  let refreshDeferred = false;
  let writes: Promise<void> = Promise.resolve();

  const queueWrite = (entitlement: ActiveEntitlement | null): Promise<void> => {
    writes = writes.then(() => deps.saveCache(entitlement)).catch(() => {});
    return writes;
  };

  const read = async (): Promise<EntitlementStatus | null> => {
    if (reading || operationsInFlight > 0) return null;
    reading = true;
    const started = sequence;
    try {
      await writes;
      const cache = await deps.loadCache();
      const raw = await readWithTimeout(deps.readEntitlement(), deps.timeoutMs);
      // A purchase or restore landed while the store was answering: this
      // read describes a world that no longer exists. Drop it whole.
      if (sequence !== started) return null;
      const reconciled = reconcileReading(raw, cache);
      const resolution = resolveEntitlement(reconciled, cache, deps.now());
      if (resolution.cache !== cache) void queueWrite(resolution.cache);
      deps.onStatus(resolution.status);
      return resolution.status;
    } catch {
      return null;
    } finally {
      reading = false;
    }
  };

  const apply = (entitlement: ActiveEntitlement): Promise<void> => {
    sequence += 1;
    return queueWrite(entitlement);
  };

  const runStoreOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
    operationsInFlight += 1;
    try {
      return await operation();
    } finally {
      operationsInFlight -= 1;
      if (operationsInFlight === 0 && refreshDeferred) {
        refreshDeferred = false;
        void read();
      }
    }
  };

  const onForeground = () => {
    if (operationsInFlight > 0) {
      refreshDeferred = true;
      return;
    }
    void read();
  };

  return {
    read,
    apply,
    runStoreOperation,
    onForeground,
    flushCache: () => writes,
    get storeOperationInFlight() {
      return operationsInFlight > 0;
    },
  };
}
