/**
 * The bounded AppTransaction read (lib/app-transaction-read.ts), alone and
 * through the real alert protocol, the real serial queue and the real reset
 * orchestration: a stalled StoreKit call can neither hang a regulated teen's
 * registration nor block queued preference saves and "Reset app and delete
 * my data" — and the alerts stay OFF until a later read succeeds.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alertIntent, type AlertIntentState, type WriteDecision } from './alert-intent';
import { boundedAppTransactionRead } from './app-transaction-read';
import { resetInstallationData } from './installation-reset';
import {
  resolveRegistrationRoute,
  RevocationKeyUnavailableError,
  routedRegistration,
} from './revocation-key';
import { createSerialQueue } from './serial-queue';

const LIMIT = 30;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const never = <T>() => new Promise<T>(() => {});
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('a never-resolving native call answers null within the time limit', async () => {
  const read = boundedAppTransactionRead({ read: never, timeoutMs: LIMIT });
  const started = Date.now();
  assert.equal(await read(), null);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= LIMIT - 5 && elapsed < 1000, `answered after ${elapsed} ms`);
});

test('a rejection, a synchronous throw, a missing module or a missing id answer null at once', async () => {
  for (const native of [
    () => Promise.reject(new Error('StoreKit failed')),
    () => {
      throw new Error('module threw');
    },
    async () => null,
    async () => ({ appTransactionId: '' }),
    async () => ({}),
  ]) {
    const read = boundedAppTransactionRead({ read: native as never, timeoutMs: 10_000 });
    const started = Date.now();
    assert.equal(await read(), null);
    assert.ok(Date.now() - started < 1000, 'no waiting for the time limit');
  }
});

test('a successful call answers its id', async () => {
  const read = boundedAppTransactionRead({
    read: async () => ({ appTransactionId: '704289572311859823' }),
    timeoutMs: LIMIT,
  });
  assert.equal(await read(), '704289572311859823');
});

test('late completion is inert, and the next read starts a fresh call that can succeed', async () => {
  const calls: ReturnType<typeof deferred<{ appTransactionId: string }>>[] = [];
  const read = boundedAppTransactionRead({
    read: () => {
      const call = deferred<{ appTransactionId: string }>();
      calls.push(call);
      return call.promise;
    },
    timeoutMs: LIMIT,
  });

  // The first read gives up; its call is still pending.
  assert.equal(await read(), null);
  // A retry while it is still stalled SHARES it: no second native call.
  assert.equal(await read(), null);
  assert.equal(calls.length, 1);

  // The stalled call completes late: nobody receives that value.
  calls[0].resolve({ appTransactionId: 'LATE' });
  await tick();

  // The slot is free again: the next read is a fresh native call.
  const retry = read();
  assert.equal(calls.length, 2);
  calls[1].resolve({ appTransactionId: 'FRESH' });
  assert.equal(await retry, 'FRESH');
});

test('a late rejection is swallowed (no unhandled rejection) and frees the slot', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    let pending = deferred<{ appTransactionId: string }>();
    let calls = 0;
    const read = boundedAppTransactionRead({
      read: () => {
        calls += 1;
        return pending.promise;
      },
      timeoutMs: LIMIT,
    });
    assert.equal(await read(), null);
    pending.reject(new Error('StoreKit gave up late'));
    await tick();
    await tick();
    assert.deepEqual(unhandled, []);
    pending = deferred();
    const retry = read();
    pending.resolve({ appTransactionId: 'AFTER-LATE-FAILURE' });
    assert.equal(await retry, 'AFTER-LATE-FAILURE');
    assert.equal(calls, 2);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

// ── Through the alert protocol, the shared queue and the reset ─────────────

const ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

/** The 20261017 server rules that matter here, in memory. */
function server() {
  const state = { enabled: false, hash: null as string | null, lastSequence: 0, deleted: false };
  const gate = (sequence: number) => {
    if (sequence <= state.lastSequence) return false;
    state.lastSequence = sequence;
    return true;
  };
  const answer = (applied: boolean): WriteDecision => ({
    applied,
    lastSequence: state.lastSequence,
  });
  return {
    state,
    async registerPlain(sequence: number) {
      if (!gate(sequence)) return answer(false);
      state.enabled = true;
      return answer(true);
    },
    async registerKeyed(sequence: number, id: string) {
      if (!gate(sequence)) return answer(false);
      Object.assign(state, { enabled: true, hash: `hmac(${id})` });
      return answer(true);
    },
    async disable(sequence: number) {
      if (!gate(sequence)) return answer(false);
      state.enabled = false;
      return answer(true);
    },
  };
}

/** A regulated 13–17 device whose StoreKit read is `native`, on the shared queue. */
function teenDevice(
  native: () => Promise<{ appTransactionId?: string | null } | null>,
  bounded: boolean,
) {
  const backend = server();
  const queue = createSerialQueue();
  let stored: AlertIntentState | null = null;
  const readId = bounded
    ? boundedAppTransactionRead({ read: native, timeoutMs: LIMIT })
    : async () => (await native())?.appTransactionId ?? null;
  const intent = alertIntent({
    load: async () => stored,
    save: async (state) => {
      stored = state;
    },
    register: routedRegistration({
      resolveRoute: () =>
        resolveRegistrationRoute({
          isEligible: async () => true,
          isKeyHeld: async () => false,
          readAppTransactionId: readId,
        }),
      registerPlain: (sequence) => backend.registerPlain(sequence),
      registerKeyed: (sequence, id) => backend.registerKeyed(sequence, id),
      clearKey: async () => {},
      setKeyHeld: async () => {},
    }),
    disable: (sequence) => backend.disable(sequence),
    isDefiniteRejection: () => false,
  });
  const saved: string[] = [];
  const savePreferences = (value: string) =>
    queue(async () => {
      saved.push(value);
    });
  const reset = () =>
    resetInstallationData({
      enqueue: queue,
      peekInstallationId: async () => ID,
      deleteServerData: async () => {
        backend.state.deleted = true;
      },
      clearLocalPreferences: async () => {},
      clearLocalSavedRecalls: async () => {},
      clearLocalAlertState: async () => {
        stored = null;
      },
      clearLocalOnboardingState: async () => {},
      clearInstallationId: async () => {},
      createFreshInstallationId: async () => 'fresh-installation-0001',
    });
  return { backend, queue, intent, state: () => stored, saved, savePreferences, reset };
}

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise.then((value) => ({ done: true as const, value })),
    new Promise<{ done: false }>((resolve) => setTimeout(() => resolve({ done: false }), ms)),
  ]);

test('a stalled StoreKit read cannot hang registration or block saves and reset; alerts stay off', async () => {
  const device = teenDevice(never, true);
  // The registration, a preference save and a reset, queued in that order.
  const registration = device.queue(() => device.intent.register());
  const save = device.savePreferences('CA+peanut');
  const reset = device.reset();

  const outcome = await within(
    registration.then(
      () => 'enabled',
      (error) => error,
    ),
    2_000,
  );
  assert.equal(outcome.done, true, 'registration settled within its bound');
  assert.ok(outcome.done && outcome.value instanceof RevocationKeyUnavailableError);
  assert.equal(device.backend.state.enabled, false, 'no keyless enable');
  assert.equal(device.state()?.enabled ?? false, false, 'the local flag stays off');

  assert.equal((await within(save, 2_000)).done, true, 'the queued save ran');
  assert.deepEqual(device.saved, ['CA+peanut']);
  const resetOutcome = await within(reset, 2_000);
  assert.equal(resetOutcome.done, true, 'the queued reset ran');
  assert.deepEqual(resetOutcome.done && resetOutcome.value, { status: 'deleted' });
  assert.equal(device.backend.state.deleted, true);
});

test('control: WITHOUT the bound, the same stall holds the queue — saves and reset never run', async () => {
  const device = teenDevice(never, false);
  void device.queue(() => device.intent.register()).catch(() => {});
  const save = device.savePreferences('CA+peanut');
  const reset = device.reset();
  assert.equal((await within(save, 300)).done, false);
  assert.equal((await within(reset, 50)).done, false);
  assert.deepEqual(device.saved, []);
});

test('a rejected read: alerts stay off; a later successful read enables WITH the mapping', async () => {
  let attempt = 0;
  const device = teenDevice(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('StoreKit failed');
    return { appTransactionId: '704289572311859823' };
  }, true);

  await assert.rejects(
    device.queue(() => device.intent.register()),
    RevocationKeyUnavailableError,
  );
  assert.equal(device.backend.state.enabled, false);

  await device.queue(() => device.intent.register());
  assert.deepEqual(
    { enabled: device.backend.state.enabled, hash: device.backend.state.hash },
    { enabled: true, hash: 'hmac(704289572311859823)' },
  );
  assert.equal(device.state()?.enabled, true);
});

test('late completion of a timed-out read never enables alerts; the next attempt does', async () => {
  const calls: ReturnType<typeof deferred<{ appTransactionId: string }>>[] = [];
  const device = teenDevice(() => {
    const call = deferred<{ appTransactionId: string }>();
    calls.push(call);
    return call.promise;
  }, true);

  await assert.rejects(
    device.queue(() => device.intent.register()),
    RevocationKeyUnavailableError,
  );
  calls[0].resolve({ appTransactionId: '704289572311859823' }); // late
  await tick();
  assert.equal(device.backend.state.enabled, false, 'the late value enabled nothing');
  assert.equal(device.state()?.enabled ?? false, false);

  // The next registration attempt (launch refresh or the user's retry).
  const retry = device.queue(() => device.intent.register());
  await tick();
  calls[1].resolve({ appTransactionId: '704289572311859823' });
  await retry;
  assert.equal(device.backend.state.enabled, true);
  assert.equal(device.backend.state.hash, 'hmac(704289572311859823)');
});
