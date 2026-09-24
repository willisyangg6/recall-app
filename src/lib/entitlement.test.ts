/**
 * Entitlement resolution (P2B7X.1): the fail-closed rule, the cached-access
 * rule, and the launch timeout, driven as pure functions.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CACHED_ACCESS_GRACE_MS,
  cacheGrantsAccess,
  ENTITLEMENT_READ_TIMEOUT_MS,
  isEntitled,
  readWithTimeout,
  resolveEntitlement,
  type ActiveEntitlement,
  type EntitlementReading,
} from './entitlement';

const NOW = '2026-09-23T12:00:00.000Z';
const VERIFIED: ActiveEntitlement = {
  productId: 'lotly_annual',
  period: 'annual',
  verifiedAt: '2026-09-01T00:00:00.000Z',
  expiresAt: '2027-09-01T00:00:00.000Z',
};

test('a verified active reading grants access and becomes the cache', () => {
  const reading: EntitlementReading = { kind: 'active', entitlement: VERIFIED };
  const result = resolveEntitlement(reading, null, NOW);
  assert.deepEqual(result.status, {
    kind: 'active',
    entitlement: VERIFIED,
    confirmation: 'verified',
  });
  assert.equal(result.cache, VERIFIED);
  assert.equal(isEntitled(result.status), true);
});

test('a verified inactive reading denies access and clears the cache', () => {
  const result = resolveEntitlement({ kind: 'inactive' }, VERIFIED, NOW);
  assert.deepEqual(result.status, { kind: 'inactive', reason: 'verified' });
  assert.equal(result.cache, null);
  assert.equal(isEntitled(result.status), false);
});

test('a first launch that has never been verified fails CLOSED when the provider is unavailable', () => {
  const result = resolveEntitlement({ kind: 'unavailable' }, null, NOW);
  assert.deepEqual(result.status, { kind: 'inactive', reason: 'unconfirmed' });
  assert.equal(result.cache, null);
  assert.equal(isEntitled(result.status), false);
});

test('a previously verified subscriber keeps CACHED access through an outage', () => {
  const result = resolveEntitlement({ kind: 'unavailable' }, VERIFIED, NOW);
  assert.deepEqual(result.status, {
    kind: 'active',
    entitlement: VERIFIED,
    confirmation: 'cached',
  });
  assert.equal(result.cache, VERIFIED);
  assert.equal(isEntitled(result.status), true);
});

test('cached access lapses a bounded time after the cached expiry, so staying offline cannot keep a cancelled subscription alive', () => {
  const expired: ActiveEntitlement = { ...VERIFIED, expiresAt: '2026-09-01T00:00:00.000Z' };
  const justInsideGrace = new Date(
    Date.parse(expired.expiresAt as string) + CACHED_ACCESS_GRACE_MS,
  ).toISOString();
  const justPastGrace = new Date(
    Date.parse(expired.expiresAt as string) + CACHED_ACCESS_GRACE_MS + 1,
  ).toISOString();
  assert.equal(cacheGrantsAccess(expired, justInsideGrace), true);
  assert.equal(cacheGrantsAccess(expired, justPastGrace), false);
  const lapsed = resolveEntitlement({ kind: 'unavailable' }, expired, justPastGrace);
  assert.deepEqual(lapsed.status, { kind: 'inactive', reason: 'unconfirmed' });
  // The lapsed record is kept for the next verified reading to settle, not
  // silently promoted and not silently erased.
  assert.equal(lapsed.cache, expired);
  assert.equal(CACHED_ACCESS_GRACE_MS, 3 * 24 * 60 * 60 * 1000);
});

test('a cached entitlement with no known expiry is honoured while the provider is silent', () => {
  const open: ActiveEntitlement = { ...VERIFIED, expiresAt: null };
  assert.equal(cacheGrantsAccess(open, '2030-01-01T00:00:00.000Z'), true);
});

test('an unparseable cache never grants access', () => {
  const garbage: ActiveEntitlement = { ...VERIFIED, expiresAt: 'not a date' };
  assert.equal(cacheGrantsAccess(garbage, NOW), false);
  assert.equal(cacheGrantsAccess(VERIFIED, 'not a date'), false);
  assert.equal(cacheGrantsAccess(null, NOW), false);
});

test('the launch reading is bounded: a silent provider counts as unavailable and never hangs launch', async () => {
  const never = new Promise<EntitlementReading>(() => {});
  const result = await readWithTimeout(never, 10);
  assert.deepEqual(result, { kind: 'unavailable' });
  assert.ok(ENTITLEMENT_READ_TIMEOUT_MS <= 5000, 'launch waits at most a few seconds on the store');
});

test('a reading that answers in time is returned as is, and a rejection is unavailable', async () => {
  const active: EntitlementReading = { kind: 'active', entitlement: VERIFIED };
  assert.deepEqual(await readWithTimeout(Promise.resolve(active), 100), active);
  assert.deepEqual(await readWithTimeout(Promise.reject(new Error('store down')), 100), {
    kind: 'unavailable',
  });
});

test('a loading status is never entitled', () => {
  assert.equal(isEntitled({ kind: 'loading' }), false);
});
