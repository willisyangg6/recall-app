/**
 * The entitlement gate's pure rules (entitlement.ts): the four gates, when a
 * row is due for a check, and when the no-backlog horizon moves.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_STALENESS_MS,
  REFRESH_INTERVAL_MS,
  UNKNOWN_ENTITLEMENT,
  entitlementVerdict,
  needsRefresh,
  nextEntitlement,
  type SubscriptionEntitlement,
} from './entitlement';

const T0 = Date.parse('2026-10-14T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(T0 + ms).toISOString();

const active: SubscriptionEntitlement = {
  status: 'active',
  expiresAt: iso(30 * 24 * HOUR),
  checkedAt: iso(0),
  entitledSince: iso(-24 * HOUR),
};

test('the staleness limit outlasts the refresh interval plus the worst measured run gap', () => {
  assert.ok(MAX_STALENESS_MS > REFRESH_INTERVAL_MS + 53 * 60_000);
});

test('all four gates pass: entitled', () => {
  assert.equal(entitlementVerdict(active, iso(-HOUR), iso(HOUR)), 'entitled');
});

test('the clock gate: a known expiry stops alerts at that instant, with no refresh', () => {
  const expiring = { ...active, expiresAt: iso(2 * HOUR) };
  assert.equal(entitlementVerdict(expiring, iso(-HOUR), iso(2 * HOUR - 1)), 'entitled');
  assert.equal(entitlementVerdict(expiring, iso(-HOUR), iso(2 * HOUR)), 'expired');
  // A non-expiring grant is refused, as the app refuses it.
  assert.equal(
    entitlementVerdict({ ...active, expiresAt: null }, iso(-HOUR), iso(HOUR)),
    'expired',
  );
});

test('the staleness gate: an old or missing check is unverified, never trusted', () => {
  assert.equal(entitlementVerdict(UNKNOWN_ENTITLEMENT, iso(0), iso(0)), 'unverified');
  assert.equal(entitlementVerdict(active, iso(-HOUR), iso(MAX_STALENESS_MS)), 'entitled');
  assert.equal(entitlementVerdict(active, iso(-HOUR), iso(MAX_STALENESS_MS + 1)), 'unverified');
});

test('inactive is definitive', () => {
  const inactive = { ...active, status: 'inactive' as const, expiresAt: null, entitledSince: null };
  assert.equal(entitlementVerdict(inactive, iso(0), iso(HOUR)), 'inactive');
});

test('the no-backlog horizon: an event before entitled_since is never sent', () => {
  assert.equal(entitlementVerdict(active, iso(-25 * HOUR), iso(HOUR)), 'before_entitlement');
  assert.equal(entitlementVerdict(active, iso(-24 * HOUR), iso(HOUR)), 'entitled');
});

test('a row is due when never checked, after the interval, or near its expiry', () => {
  assert.equal(needsRefresh(UNKNOWN_ENTITLEMENT, iso(0)), true);
  assert.equal(needsRefresh(active, iso(REFRESH_INTERVAL_MS - 1)), false);
  assert.equal(needsRefresh(active, iso(REFRESH_INTERVAL_MS)), true);
  const nearExpiry = { ...active, expiresAt: iso(REFRESH_INTERVAL_MS / 2) };
  assert.equal(needsRefresh(nearExpiry, iso(60_000)), true);
  const pastExpiry = { ...active, expiresAt: iso(-HOUR) };
  assert.equal(needsRefresh(pastExpiry, iso(60_000)), true);
});

test('a renewal seen before expiry keeps the horizon: no gap for a continuous subscriber', () => {
  const renewed = nextEntitlement(
    active,
    { active: true, expiresAt: iso(60 * 24 * HOUR) },
    iso(HOUR),
  );
  assert.deepEqual(renewed, {
    status: 'active',
    expiresAt: iso(60 * 24 * HOUR),
    checkedAt: iso(HOUR),
    entitledSince: active.entitledSince,
  });
});

test('active after a lapse, or after unknown, restarts the horizon at the check', () => {
  const lapsed = { ...active, expiresAt: iso(-HOUR) };
  const back = nextEntitlement(lapsed, { active: true, expiresAt: iso(30 * 24 * HOUR) }, iso(HOUR));
  assert.equal(back.entitledSince, iso(HOUR));

  const inactive = nextEntitlement(active, { active: false, expiresAt: null }, iso(HOUR));
  assert.deepEqual(inactive, {
    status: 'inactive',
    expiresAt: null,
    checkedAt: iso(HOUR),
    entitledSince: null,
  });
  const resubscribed = nextEntitlement(
    inactive,
    { active: true, expiresAt: iso(9 * HOUR) },
    iso(2 * HOUR),
  );
  assert.equal(resubscribed.entitledSince, iso(2 * HOUR));

  const first = nextEntitlement(
    UNKNOWN_ENTITLEMENT,
    { active: true, expiresAt: iso(9 * HOUR) },
    iso(0),
  );
  assert.equal(first.entitledSince, iso(0));
});
