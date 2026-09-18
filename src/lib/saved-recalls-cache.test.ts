/**
 * The saved-list store, driven through the exact sequences a launch produces
 * (P3C1.5).
 *
 * The two that matter, and the difference between them:
 *
 *   COLD — the app opens directly on `/saved` (a `lotly://saved` deep link,
 *   or the tab restored as the initial route). The Saved screen is the FIRST
 *   subscriber, so the storage read starts at its mount and `loaded` has to
 *   flip from false to true underneath a screen that is already showing its
 *   loading state.
 *
 *   WARM — the app opens on Feed. A card's save control subscribes long
 *   before Saved mounts, so by the time Saved renders the store is already
 *   loaded and must say so on the FIRST snapshot: a screen that flashed
 *   "Loading saved recalls…" here would be showing a state that is over.
 *
 * Everything below reads `loaded` and `ids` only through `getSnapshot`,
 * because that is all React reads. A store that kept `loaded` anywhere else
 * would pass a test that inspected internals and still strand the screen.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSavedRecallsCache, type SavedRecallsCache } from './saved-recalls-cache';

/** A storage read this test resolves by hand, so no timing is guessed. */
function deferredLoad() {
  let resolve!: (ids: string[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  let calls = 0;
  return {
    /** Passed to the store. Counts how many times the store read storage. */
    load: () => {
      calls += 1;
      return promise;
    },
    resolve,
    reject,
    /** Await the read WITHOUT counting as one, then let handlers run. */
    settled: async () => {
      await promise.catch(() => {});
      await Promise.resolve();
    },
    get calls() {
      return calls;
    },
  };
}

/** A subscriber, recording exactly what React would re-render on. */
function mount(cache: SavedRecallsCache) {
  const seen: { ids: readonly string[]; loaded: boolean }[] = [];
  const unsubscribe = cache.subscribe(() => seen.push(cache.getSnapshot()));
  return { seen, unsubscribe, read: () => cache.getSnapshot() };
}

// ── Cold: the screen that is first to ask ───────────────────────────────────

test('cold — the first subscriber starts the read and is told when it lands', async () => {
  const storage = deferredLoad();
  const cache = createSavedRecallsCache({ load: storage.load, available: () => true });

  // Before anyone subscribes, nothing has been read.
  assert.equal(storage.calls, 0);
  assert.deepEqual(cache.getSnapshot(), { ids: [], loaded: false });

  const saved = mount(cache);
  assert.equal(storage.calls, 1, 'mounting Saved must start the one storage read');
  // The screen renders its loading state, correctly: no answer yet.
  assert.equal(saved.read().loaded, false);

  storage.resolve(['case-a', 'case-b']);
  await storage.settled();

  // The flip is DELIVERED, not merely stored: React re-renders on the
  // notification, and reads the new value from getSnapshot.
  assert.equal(saved.seen.length, 1, 'the subscriber must be notified exactly once');
  assert.deepEqual(saved.seen[0], { ids: ['case-a', 'case-b'], loaded: true });
  assert.deepEqual(saved.read(), { ids: ['case-a', 'case-b'], loaded: true });
});

test('cold — `loaded` is reachable through getSnapshot, not beside it', async () => {
  // The regression this file exists for. `loaded` used to be computed in the
  // hook body from a module-level variable, so a subscriber could be
  // notified and STILL read a stale `loaded` from somewhere React never
  // looked. Reading only what React reads is what this asserts.
  const storage = deferredLoad();
  const cache = createSavedRecallsCache({ load: storage.load, available: () => true });
  const saved = mount(cache);

  storage.resolve([]);
  await storage.settled();

  // An empty saved list still has to END the loading state — otherwise a
  // device with nothing saved spins forever instead of saying "No saved
  // recalls".
  assert.deepEqual(saved.read(), { ids: [], loaded: true });
  assert.equal(saved.seen.at(-1)?.loaded, true);
});

test('cold — a failed storage read settles on "nothing saved", never on loading', async () => {
  const storage = deferredLoad();
  const cache = createSavedRecallsCache({ load: storage.load, available: () => true });
  const saved = mount(cache);

  storage.reject(new Error('unreadable'));
  await storage.settled();

  assert.deepEqual(saved.read(), { ids: [], loaded: true });
});

// ── Warm: the screen that arrives after ─────────────────────────────────────

test('warm — a screen mounting after the read sees loaded on its FIRST snapshot', async () => {
  const storage = deferredLoad();
  const cache = createSavedRecallsCache({ load: storage.load, available: () => true });

  // A Feed card subscribes first and drives the read to completion.
  const card = mount(cache);
  storage.resolve(['case-a']);
  await storage.settled();
  assert.equal(card.read().loaded, true);

  // Saved mounts now. Its very first render must not show a loading state.
  const saved = mount(cache);
  assert.deepEqual(saved.read(), { ids: ['case-a'], loaded: true });
  assert.equal(storage.calls, 1, 'the second subscriber must not re-read storage');
});

test('warm — every live subscriber sees a toggle, so no screen disagrees', async () => {
  const storage = deferredLoad();
  const cache = createSavedRecallsCache({ load: storage.load, available: () => true });
  const card = mount(cache);
  const saved = mount(cache);
  storage.resolve([]);
  await storage.settled();

  // What a toggle resolves with is what STORAGE holds; the store publishes it.
  cache.publish(['case-a']);
  for (const [name, subscriber] of [
    ['card', card],
    ['saved', saved],
  ] as const) {
    assert.deepEqual(subscriber.read(), { ids: ['case-a'], loaded: true }, name);
  }
});

// ── The lifecycle React actually performs ───────────────────────────────────

test('a remount between the read and its answer neither re-reads nor loses the answer', async () => {
  // React invokes effects twice in development, and a tab can unmount and
  // remount; both produce subscribe → unsubscribe → subscribe around an
  // in-flight read.
  const storage = deferredLoad();
  const cache = createSavedRecallsCache({ load: storage.load, available: () => true });

  const first = mount(cache);
  first.unsubscribe();
  const second = mount(cache);
  assert.equal(storage.calls, 1, 'the read must not restart on resubscribe');

  storage.resolve(['case-a']);
  await storage.settled();

  assert.deepEqual(second.read(), { ids: ['case-a'], loaded: true });
  assert.equal(second.seen.length, 1, 'the resubscribed screen must be notified');
  assert.equal(first.seen.length, 0, 'the unsubscribed one must not be');
});

test('the snapshot is stable by identity, so React cannot loop on it', () => {
  const storage = deferredLoad();
  const cache = createSavedRecallsCache({ load: storage.load, available: () => true });
  // React calls getSnapshot on every render and compares by Object.is; a
  // fresh object per call is an infinite render loop.
  assert.equal(cache.getSnapshot(), cache.getSnapshot());
  mount(cache);
  assert.equal(cache.getSnapshot(), cache.getSnapshot());
});

test('a listener that unsubscribes while being notified does not disturb the others', async () => {
  const storage = deferredLoad();
  const cache = createSavedRecallsCache({ load: storage.load, available: () => true });
  let unsubscribeSelf = () => {};
  const order: string[] = [];
  unsubscribeSelf = cache.subscribe(() => {
    order.push('leaving');
    unsubscribeSelf();
  });
  cache.subscribe(() => order.push('staying'));

  storage.resolve(['case-a']);
  await storage.settled();

  assert.deepEqual(order, ['leaving', 'staying']);
});

// ── Platforms without saving, and the reset ─────────────────────────────────

test('where saving does not exist the store is loaded from the start and reads nothing', () => {
  const storage = deferredLoad();
  const cache = createSavedRecallsCache({ load: storage.load, available: () => false });
  // Web: `SAVED_UNAVAILABLE` is the screen's answer, and it is immediate —
  // never a loading state waiting on storage that will never answer.
  assert.deepEqual(cache.getSnapshot(), { ids: [], loaded: true });
  mount(cache);
  assert.equal(storage.calls, 0);
});

test('the reset publishes an empty LOADED list, not a fresh loading state', async () => {
  const storage = deferredLoad();
  const cache = createSavedRecallsCache({ load: storage.load, available: () => true });
  const saved = mount(cache);
  storage.resolve(['case-a']);
  await storage.settled();

  cache.forget();

  // "Reset app and delete my data" deleted the file: empty is the truth, and
  // sending the screen back to loading would re-read a file that is gone.
  assert.deepEqual(saved.read(), { ids: [], loaded: true });
  assert.equal(saved.seen.at(-1)?.loaded, true);
});
