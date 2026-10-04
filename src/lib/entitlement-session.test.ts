/**
 * The entitlement session (2026-10-04): the ordering between a refresh, a
 * purchase or restore, and the cache, driven with a fake provider whose
 * every answer the test releases by hand.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CACHED_ACCESS_GRACE_MS,
  type ActiveEntitlement,
  type EntitlementReading,
  type EntitlementStatus,
} from './entitlement';
import { createEntitlementSession } from './entitlement-session';

const T0 = '2026-10-04T12:00:00.000Z'; // before the purchase
const T1 = '2026-10-04T12:00:10.000Z'; // the purchase is verified
const T2 = '2026-10-04T12:00:20.000Z'; // after the purchase

const PURCHASED: ActiveEntitlement = {
  productId: 'lotly_annual',
  period: 'annual',
  verifiedAt: T1,
  expiresAt: '2027-10-04T12:00:10.000Z',
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every settled promise's continuation run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function harness(options: { cache?: ActiveEntitlement | null; slowWrites?: boolean } = {}) {
  const state = {
    cache: options.cache ?? null,
    now: T2,
    reads: [] as Deferred<EntitlementReading>[],
    writes: [] as (ActiveEntitlement | null)[],
    pendingWrites: [] as Deferred<void>[],
    loads: 0,
    statuses: [] as EntitlementStatus[],
  };
  const session = createEntitlementSession({
    readEntitlement: () => {
      const next = deferred<EntitlementReading>();
      state.reads.push(next);
      return next.promise;
    },
    loadCache: async () => {
      state.loads += 1;
      return state.cache;
    },
    saveCache: async (entitlement) => {
      if (options.slowWrites) {
        const gate = deferred<void>();
        state.pendingWrites.push(gate);
        await gate.promise;
      }
      state.cache = entitlement;
      state.writes.push(entitlement);
    },
    now: () => state.now,
    timeoutMs: 50,
    onStatus: (status) => {
      state.statuses.push(status);
    },
  });
  return { session, state };
}

/**
 * Start a read and let it reach the provider. The pending read is handed
 * back inside an object so that awaiting this helper does not await the
 * read itself.
 */
async function startRead(h: ReturnType<typeof harness>) {
  const result = h.session.read();
  await settle();
  assert.equal(h.state.reads.length, 1, 'the read reached the provider');
  return { result };
}

async function startReadAgain(h: ReturnType<typeof harness>, expectedReads: number) {
  const result = h.session.read();
  await settle();
  assert.equal(h.state.reads.length, expectedReads, 'the read reached the provider');
  return { result };
}

// ── 1. An old inactive refresh resolving after a successful purchase ────────

test('a refresh started before a purchase is discarded whole when its inactive answer lands after it', async () => {
  const h = harness();
  const { result: refresh } = await startRead(h);
  await h.session.apply(PURCHASED);
  h.state.reads[0].resolve({ kind: 'inactive', asOf: T0 });
  assert.equal(await refresh, null, 'the stale refresh committed a status');
  assert.deepEqual(h.state.statuses, [], 'nothing was committed by the refresh');
  assert.deepEqual(h.state.writes, [PURCHASED], 'the cache holds only the purchase');
  assert.deepEqual(h.state.cache, PURCHASED);
});

// ── 2. An old unavailable or timed-out result after a successful purchase ──

test('a refresh that answers unavailable, or never answers, after a purchase is discarded too', async () => {
  for (const answer of ['unavailable', 'timeout'] as const) {
    const h = harness();
    const { result: refresh } = await startRead(h);
    await h.session.apply(PURCHASED);
    if (answer === 'unavailable') h.state.reads[0].resolve({ kind: 'unavailable' });
    // `timeout`: the provider stays silent and readWithTimeout gives up.
    assert.equal(await refresh, null, `${answer}: the stale refresh committed`);
    assert.deepEqual(h.state.statuses, [], `${answer}: a status was committed`);
    assert.deepEqual(h.state.writes, [PURCHASED], `${answer}: the cache was touched`);
  }
});

// ── 3. The same races after a restore ───────────────────────────────────────

test('the same races are closed for a restore, whose apply runs under the store guard', async () => {
  for (const stale of [
    { kind: 'inactive', asOf: T0 },
    { kind: 'unavailable' },
  ] as const satisfies readonly EntitlementReading[]) {
    const h = harness();
    const { result: refresh } = await startRead(h);
    await h.session.runStoreOperation(async () => {
      await h.session.apply(PURCHASED);
      return { kind: 'restored' as const };
    });
    h.state.reads[0].resolve(stale);
    assert.equal(await refresh, null);
    assert.deepEqual(h.state.statuses, []);
    assert.deepEqual(h.state.cache, PURCHASED);
  }
});

// ── 4. Foreground events during a purchase or restore ───────────────────────

test('a foreground event during a store operation starts no refresh; one runs after it settles', async () => {
  const h = harness();
  const operation = deferred<{ kind: 'success' }>();
  const run = h.session.runStoreOperation(async () => {
    const outcome = await operation.promise;
    await h.session.apply(PURCHASED);
    return outcome;
  });
  h.session.onForeground();
  h.session.onForeground();
  await settle();
  assert.equal(h.state.reads.length, 0, 'the provider was asked during the operation');
  assert.equal(h.session.storeOperationInFlight, true);
  operation.resolve({ kind: 'success' });
  await run;
  await settle();
  assert.equal(h.session.storeOperationInFlight, false);
  assert.equal(h.state.reads.length, 1, 'exactly one deferred refresh ran');
  // The deferred refresh sees the applied cache and a fresh active answer.
  assert.equal(h.state.loads, 1);
  h.state.reads[0].resolve({ kind: 'active', entitlement: { ...PURCHASED, verifiedAt: T2 } });
  await settle();
  assert.equal(h.state.statuses.length, 1);
  assert.equal(h.state.statuses[0].kind, 'active');
});

test('an explicit read during a store operation is declined, not queued twice', async () => {
  const h = harness();
  const operation = deferred<void>();
  const run = h.session.runStoreOperation(() => operation.promise);
  assert.equal(await h.session.read(), null);
  assert.equal(h.state.reads.length, 0);
  operation.resolve();
  await run;
  await settle();
  assert.equal(h.state.reads.length, 0, 'no foreground event, so no deferred refresh');
});

// ── 5. A post-success refresh returning stale inactive data ─────────────────

test('the first refresh after a success cannot revoke it with data older than the purchase', async () => {
  const h = harness();
  await h.session.apply(PURCHASED);
  const { result: refresh } = await startRead(h);
  h.state.reads[0].resolve({ kind: 'inactive', asOf: T0 });
  const status = await refresh;
  assert.deepEqual(status, { kind: 'active', entitlement: PURCHASED, confirmation: 'cached' });
  assert.deepEqual(h.state.writes, [PURCHASED], 'the stale answer rewrote the cache');
});

test('stale data does not keep access alive past the cached-access bound', async () => {
  const expired: ActiveEntitlement = { ...PURCHASED, expiresAt: T2 };
  const h = harness({ cache: expired });
  h.state.now = new Date(Date.parse(T2) + CACHED_ACCESS_GRACE_MS + 1).toISOString();
  const { result: refresh } = await startRead(h);
  h.state.reads[0].resolve({ kind: 'inactive', asOf: T0 });
  assert.deepEqual(await refresh, { kind: 'inactive', reason: 'unconfirmed' });
});

// ── 6. Cancellation and error release the guard ─────────────────────────────

test('a cancelled, failed or throwing operation releases the guard and a later refresh runs', async () => {
  const outcomes: (() => Promise<unknown>)[] = [
    async () => ({ kind: 'cancelled' }),
    async () => ({ kind: 'error' }),
    async () => {
      throw new Error('store threw');
    },
  ];
  for (const operation of outcomes) {
    const h = harness();
    await h.session.runStoreOperation(operation).catch(() => {});
    assert.equal(h.session.storeOperationInFlight, false);
    const { result: refresh } = await startRead(h);
    h.state.reads[0].resolve({ kind: 'inactive', asOf: T2 });
    assert.deepEqual(await refresh, { kind: 'inactive', reason: 'verified' });
  }
});

test('a foreground event during a cancelled operation still refreshes once it settles', async () => {
  const h = harness();
  const operation = deferred<{ kind: 'cancelled' }>();
  const run = h.session.runStoreOperation(() => operation.promise);
  h.session.onForeground();
  operation.resolve({ kind: 'cancelled' });
  await run;
  await settle();
  assert.equal(h.state.reads.length, 1);
});

// ── 7. Cache-write ordering, and a legitimate later expiry or revocation ────

test('cache writes are serialized in order and a read waits for a pending write before loading', async () => {
  const h = harness({ slowWrites: true });
  const applied = h.session.apply(PURCHASED);
  const refresh = h.session.read();
  await settle();
  assert.equal(h.state.loads, 0, 'the read loaded the cache under a pending write');
  assert.equal(h.state.pendingWrites.length, 1);
  h.state.pendingWrites[0].resolve();
  await settle();
  await applied;
  assert.equal(h.state.loads, 1);
  assert.deepEqual(h.state.cache, PURCHASED);
  // A real revocation after the purchase: dated after it, honoured, and the
  // cache clear is queued behind the purchase write.
  h.state.reads[0].resolve({ kind: 'inactive', asOf: T2 });
  await settle();
  assert.equal(h.state.pendingWrites.length, 2);
  h.state.pendingWrites[1].resolve();
  assert.deepEqual(await refresh, { kind: 'inactive', reason: 'verified' });
  await h.session.flushCache();
  assert.deepEqual(h.state.writes, [PURCHASED, null]);
});

test('a later verified expiry or revocation is honoured: the cache is cleared and access ends', async () => {
  const h = harness({ cache: PURCHASED });
  const { result: refresh } = await startRead(h);
  h.state.reads[0].resolve({ kind: 'inactive', asOf: T2 });
  assert.deepEqual(await refresh, { kind: 'inactive', reason: 'verified' });
  await h.session.flushCache();
  assert.deepEqual(h.state.writes, [null]);
  assert.equal(h.state.cache, null);
});

test('a newer verified reading replaces the cache; an older active reading does not', async () => {
  const h = harness({ cache: PURCHASED });
  const newer: ActiveEntitlement = { ...PURCHASED, verifiedAt: T2 };
  let { result: refresh } = await startRead(h);
  h.state.reads[0].resolve({ kind: 'active', entitlement: newer });
  assert.equal((await refresh)?.kind, 'active');
  await h.session.flushCache();
  assert.deepEqual(h.state.cache, newer);
  const older: ActiveEntitlement = { ...PURCHASED, productId: 'lotly_monthly', verifiedAt: T0 };
  ({ result: refresh } = await startReadAgain(h, 2));
  h.state.reads[1].resolve({ kind: 'active', entitlement: older });
  assert.deepEqual(await refresh, { kind: 'active', entitlement: newer, confirmation: 'cached' });
  assert.deepEqual(h.state.writes, [newer], 'the older record overwrote the cache');
});

test('only one read runs at a time; a second concurrent read is declined', async () => {
  const h = harness();
  const { result: first } = await startRead(h);
  assert.equal(await h.session.read(), null);
  h.state.reads[0].resolve({ kind: 'inactive', asOf: T2 });
  assert.deepEqual(await first, { kind: 'inactive', reason: 'verified' });
});
