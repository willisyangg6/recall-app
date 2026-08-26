/**
 * The queue behind preferences autosave (src/lib/preferences-store.ts). The
 * scenario it exists to prevent: Settings fires a save on every toggle, so a
 * slow first save (e.g. a delayed network sync) can finish after a fast
 * second save and overwrite the newer choice with the older one. Tasks here
 * mirror `writePreferences`'s own shape — a local write followed by a
 * best-effort server sync — so "the queue behaves correctly" translates
 * directly into "the real save path behaves correctly".
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createSerialQueue } from './serial-queue';

test('two calls made without awaiting the first run in request order, not concurrently', async () => {
  const run = createSerialQueue();
  const events: string[] = [];

  const first = run(async () => {
    events.push('first:start');
    await delay(20);
    events.push('first:end');
    return 'first';
  });
  // Started immediately after — NOT awaiting `first` — as Settings does when
  // the user toggles two chips in quick succession.
  const second = run(async () => {
    events.push('second:start');
    events.push('second:end');
    return 'second';
  });

  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  // If the two ran concurrently, "second:start" would appear before
  // "first:end" (second has no delay, first does).
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('a slower first save can never land after and overwrite a newer second save', async () => {
  const run = createSerialQueue();
  // Mirrors writePreferences: a local write, then a best-effort server sync.
  let localState: string | null = null;
  let syncedState: string | null = null;
  const save = (prefs: string, syncDelayMs: number) =>
    run(async () => {
      localState = prefs; // SecureStore write — always happens.
      await delay(syncDelayMs); // server sync — the part that can be slow.
      syncedState = prefs;
    });

  // Enqueued first but with the longer sync delay — the exact shape of the
  // bug this queue prevents.
  const slowerFirst = save('old-state', 30);
  const fasterSecond = save('new-state', 1);
  await Promise.all([slowerFirst, fasterSecond]);

  assert.equal(localState, 'new-state', 'local state must reflect the newest request');
  assert.equal(syncedState, 'new-state', 'the server mirror must reflect the newest request');
});

test('a rejected earlier save does not break the queue or block the next save', async () => {
  const run = createSerialQueue();
  const failing = run(async () => {
    throw new Error('network down');
  });
  const following = run(async () => 'ok');

  await assert.rejects(failing, /network down/);
  assert.equal(await following, 'ok');
});

test('rejections do not cross tasks: an earlier failure never fails a later, unrelated save', async () => {
  const run = createSerialQueue();
  const results = await Promise.allSettled([
    run(async () => {
      throw new Error('first sync failed');
    }),
    run(async () => 'second saved fine'),
    run(async () => 'third saved fine'),
  ]);

  assert.equal(results[0].status, 'rejected');
  assert.deepEqual(
    results.slice(1).map((r) => (r.status === 'fulfilled' ? r.value : r)),
    ['second saved fine', 'third saved fine'],
  );
});
