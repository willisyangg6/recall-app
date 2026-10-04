/**
 * Preference persistence (2026-10-04): the durable local write never waits
 * on the network, rapid saves land in order, the mirror sends only the
 * newest value and never regresses, failures stay owed, and the reset can
 * settle the mirror before deleting. Driven with real delays over a fake
 * device and a fake (slow, failing) server.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { EMPTY_PREFERENCES, type UserRecallPreferences } from '@/domain/preferences';
import { createPreferencePersistence, type PersistenceDeps } from './preference-persistence';
import { createSerialQueue } from './serial-queue';

const prefs = (states: string[], allergens: string[] = []): UserRecallPreferences => ({
  states,
  allergens,
  retailers: [],
});

function fakeDevice(options: { syncMs?: number | (() => number); failSyncs?: number } = {}) {
  let failSyncs = options.failSyncs ?? 0;
  const world = {
    local: null as UserRecallPreferences | null,
    dirty: false,
    server: null as UserRecallPreferences | null,
    /** The mirrored states, read through a call so narrowing never hides a later write. */
    serverStates(): string[] | null {
      return world.server ? world.server.states : null;
    },
    syncs: [] as UserRecallPreferences[],
    log: [] as string[],
  };
  const deps: PersistenceDeps = {
    enqueueLocal: createSerialQueue(),
    async readLocal() {
      return world.local ? structuredClone(world.local) : { ...EMPTY_PREFERENCES };
    },
    async writeLocal(value) {
      world.local = structuredClone(value);
      world.log.push(`local:${value.states.join('+')}`);
    },
    async isDirty() {
      return world.dirty;
    },
    async setDirty(dirty) {
      world.dirty = dirty;
    },
    async syncRemote(value) {
      const ms = typeof options.syncMs === 'function' ? options.syncMs() : (options.syncMs ?? 0);
      world.log.push(`sync:start:${value.states.join('+')}`);
      await delay(ms);
      if (failSyncs > 0) {
        failSyncs -= 1;
        world.log.push(`sync:fail:${value.states.join('+')}`);
        throw new Error('offline');
      }
      world.server = structuredClone(value);
      world.syncs.push(structuredClone(value));
      world.log.push(`sync:done:${value.states.join('+')}`);
    },
  };
  return { world, deps, store: createPreferencePersistence(deps) };
}

test('the local write lands and answers while a slow mirror is still in flight', async () => {
  const { world, store } = fakeDevice({ syncMs: 150 });
  const started = Date.now();
  const stored = await store.commit(prefs(['CA']));
  const elapsed = Date.now() - started;
  assert.deepEqual(stored.states, ['CA']);
  assert.deepEqual(world.local?.states, ['CA'], 'the device holds the value');
  assert.ok(elapsed < 100, `commit waited on the network (${elapsed}ms)`);
  assert.equal(world.serverStates(), null, 'the mirror had not landed yet');
  assert.equal(world.dirty, true, 'owed until the mirror confirms');
  await store.mirrorIdle();
  assert.deepEqual(world.serverStates(), ['CA']);
  assert.equal(world.dirty, false);
});

test('rapid successive changes each land locally in order; the mirror sends the newest, never an older one after it', async () => {
  const { world, store } = fakeDevice({ syncMs: 60 });
  const toggles = [['CA'], ['CA', 'TX'], ['CA', 'NY', 'TX'], ['NY', 'TX'], ['TX']];
  const writes = toggles.map((states) => store.commit(prefs(states)));
  await Promise.all(writes);
  // Every toggle reached the device, in the order it was made.
  assert.deepEqual(
    world.log.filter((line) => line.startsWith('local:')),
    toggles.map((states) => `local:${states.join('+')}`),
  );
  assert.deepEqual(world.local?.states, ['TX']);
  await store.mirrorIdle();
  // The server ends on the newest value, and no sync carried an older value
  // after a newer one had been sent.
  assert.deepEqual(world.serverStates(), ['TX']);
  const sent = world.syncs.map((value) =>
    toggles.findIndex((t) => t.join() === value.states.join()),
  );
  assert.deepEqual(
    [...sent].sort((a, b) => a - b),
    sent,
    'an older value was synced after a newer one',
  );
  assert.ok(world.syncs.length <= 2, `five toggles cost ${world.syncs.length} requests`);
  assert.equal(world.dirty, false);
});

test('save answers synced once the mirror confirms its value, and the local write did not wait', async () => {
  const { world, store } = fakeDevice({ syncMs: 80 });
  const started = Date.now();
  let localSeen = false;
  const unsubscribe = store.onSaved(() => {
    localSeen = true;
  });
  const result = store.save(prefs(['WA']));
  await delay(10);
  assert.equal(localSeen, true, 'the local write had not landed within 10ms');
  assert.deepEqual(world.local?.states, ['WA']);
  assert.deepEqual(await result, { synced: true });
  assert.ok(Date.now() - started >= 80, 'the synced answer came before the mirror');
  unsubscribe();
});

test('a failing mirror answers unsynced, keeps the local value and the dirty flag, and flush retries it', async () => {
  const { world, store } = fakeDevice({ failSyncs: 1 });
  assert.deepEqual(await store.save(prefs(['OR'])), { synced: false });
  assert.deepEqual(world.local?.states, ['OR'], 'the local value survives the failed mirror');
  assert.equal(world.dirty, true);
  assert.equal(world.serverStates(), null);
  await store.flush();
  await store.mirrorIdle();
  assert.deepEqual(world.serverStates(), ['OR']);
  assert.equal(world.dirty, false);
});

test('flush with nothing owed sends nothing', async () => {
  const { world, store } = fakeDevice();
  await store.flush();
  await store.mirrorIdle();
  assert.deepEqual(world.syncs, []);
});

test('a request during a run sends the newer value after it; a request for an already-mirrored value sends nothing', async () => {
  const { world, store } = fakeDevice({ syncMs: 40 });
  await store.commit(prefs(['CA']));
  await delay(5); // the CA sync is in flight
  await store.commit(prefs(['CA', 'TX']));
  await store.mirrorIdle();
  assert.deepEqual(
    world.syncs.map((v) => v.states.join('+')),
    ['CA', 'CA+TX'],
  );
  await store.flush(); // nothing owed any more
  await store.mirrorIdle();
  assert.equal(world.syncs.length, 2, 'an already-mirrored value was sent again');
});

test('settleMirror drops the pending request and waits for the run in flight (the reset’s guard)', async () => {
  const { world, store } = fakeDevice({ syncMs: 60 });
  await store.commit(prefs(['CA']));
  await delay(5);
  await store.commit(prefs(['TX'])); // pending behind the CA run
  const settled = store.settleMirror();
  await settled;
  assert.deepEqual(
    world.log.filter((l) => l.startsWith('sync:')),
    ['sync:start:CA', 'sync:done:CA'],
    'the pending TX request ran after the settle',
  );
  // The device still holds the newest value and still owes its mirror.
  assert.deepEqual(world.local?.states, ['TX']);
  assert.equal(world.dirty, true);
  // The next write (or launch flush) mirrors it.
  await store.flush();
  await store.mirrorIdle();
  assert.deepEqual(world.serverStates(), ['TX']);
});

test('readSettled sees every write requested before it, even while the mirror is slow', async () => {
  const { store } = fakeDevice({ syncMs: 100 });
  void store.commit(prefs(['CA']));
  void store.commit(prefs(['CA', 'TX']));
  const seen = await store.readSettled();
  assert.deepEqual(seen.states, ['CA', 'TX']);
});

test('a save queued behind another queue turn (a reset) still writes after it, in order', async () => {
  const { world, deps, store } = fakeDevice();
  const log = world.log;
  const turn = deps.enqueueLocal(async () => {
    log.push('turn:start');
    await delay(30);
    log.push('turn:end');
  });
  const save = store.commit(prefs(['MT']));
  await Promise.all([turn, save]);
  assert.deepEqual(log.slice(0, 3), ['turn:start', 'turn:end', 'local:MT']);
});
