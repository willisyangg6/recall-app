/**
 * Serializes async work requested faster than it resolves — e.g. Settings
 * autosaving on every chip toggle. Without this, two overlapping calls can
 * finish out of order: a slower earlier request lands after a faster later
 * one and silently overwrites it with stale data. Chaining onto one queue
 * guarantees requests both start and finish in the order they were made, so
 * the last request made is always the last (and therefore authoritative)
 * one applied.
 *
 * Native-code-free by design (no SecureStore/RN import) so it can be unit
 * tested directly — preferences-store.ts, which SecureStore makes untestable
 * under this repo's Node test harness, only wires this queue to real I/O.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    // A rejected task must not break the chain for requests queued after it.
    tail = result.catch(() => undefined);
    return result;
  };
}
