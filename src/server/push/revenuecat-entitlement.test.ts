/**
 * The RevenueCat read (revenuecat-entitlement.ts): the request it makes, how it
 * reads the answer, that every failure is "unavailable" (never a guess), and
 * that no error can carry the purchase id.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RevenueCatUnavailableError,
  entitlementSourceFromEnv,
  revenueCatEntitlementSource,
} from './revenuecat-entitlement';

const PURCHASE_ID = '8a1f6c2e-3b4d-4e5f-9a0b-1c2d3e4f5a6b';
const PREMIUM = 'entl0a1b2c3d4e';

function source(respond: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return {
    calls,
    source: revenueCatEntitlementSource({
      secretKey: 'sk_test_value',
      projectId: 'proj1ab2c3d4',
      premiumEntitlementId: PREMIUM,
      fetchImpl,
    }),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('one read-only GET of the customer’s active entitlements, bearer-authenticated', async () => {
  const { calls, source: rc } = source(() => json({ items: [] }));
  await rc.check(PURCHASE_ID);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://api.revenuecat.com/v2/projects/proj1ab2c3d4/customers/${PURCHASE_ID}/active_entitlements`,
  );
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer sk_test_value');
  assert.equal(calls[0].init?.method ?? 'GET', 'GET');
});

test('premium listed: active until its expiry; other entitlements do not count', async () => {
  const expiresMs = Date.parse('2026-11-14T12:00:00.000Z');
  const { source: rc } = source(() =>
    json({
      items: [
        { entitlement_id: 'entlOTHER', expires_at: expiresMs + 1 },
        { entitlement_id: PREMIUM, expires_at: expiresMs },
      ],
    }),
  );
  assert.deepEqual(await rc.check(PURCHASE_ID), {
    active: true,
    expiresAt: '2026-11-14T12:00:00.000Z',
  });

  const { source: other } = source(() =>
    json({ items: [{ entitlement_id: 'entlOTHER', expires_at: expiresMs }] }),
  );
  assert.deepEqual(await other.check(PURCHASE_ID), { active: false, expiresAt: null });
});

test('a non-expiring grant reads as active with no expiry (the gate refuses it)', async () => {
  const { source: rc } = source(() =>
    json({ items: [{ entitlement_id: PREMIUM, expires_at: null }] }),
  );
  assert.deepEqual(await rc.check(PURCHASE_ID), { active: true, expiresAt: null });
});

test('an unknown customer (404) is not entitled', async () => {
  const { source: rc } = source(() => json({ message: 'not found' }, 404));
  assert.deepEqual(await rc.check(PURCHASE_ID), { active: false, expiresAt: null });
});

test('every other failure is unavailable, and no message carries the purchase id or the key', async () => {
  const failures: (() => Promise<Response> | Response)[] = [
    () => json({ message: `bad ${PURCHASE_ID}` }, 500),
    () => json({ message: 'rate limited' }, 429),
    () => json({ message: 'nope' }, 401),
    () => new Response('<html>', { status: 200 }),
    () => json({ unexpected: true }),
    () => json({ items: [{ entitlement_id: PREMIUM, expires_at: 'soon' }] }),
    () => {
      throw new TypeError(`fetch failed for https://api.revenuecat.com/…/${PURCHASE_ID}`);
    },
  ];
  for (const respond of failures) {
    const { source: rc } = source(respond);
    await assert.rejects(rc.check(PURCHASE_ID), (error: unknown) => {
      assert.ok(error instanceof RevenueCatUnavailableError);
      assert.doesNotMatch(error.message, new RegExp(PURCHASE_ID));
      assert.doesNotMatch(error.message, /sk_test_value|revenuecat\.com/);
      return true;
    });
  }
});

test('a malformed purchase id is refused before any request', async () => {
  const { calls, source: rc } = source(() => json({ items: [] }));
  await assert.rejects(rc.check('../../projects'), RevenueCatUnavailableError);
  assert.equal(calls.length, 0);
});

test('the job source needs all three settings; anything missing or malformed holds every alert', () => {
  const full = {
    REVENUECAT_SECRET_KEY: 'sk',
    REVENUECAT_PROJECT_ID: 'proj1ab2c3d4',
    REVENUECAT_PREMIUM_ENTITLEMENT_ID: PREMIUM,
  };
  assert.notEqual(entitlementSourceFromEnv(full), null);
  for (const key of Object.keys(full)) {
    assert.equal(entitlementSourceFromEnv({ ...full, [key]: undefined }), null, key);
  }
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(entitlementSourceFromEnv({ ...full, REVENUECAT_PROJECT_ID: 'a/b' }), null);
  } finally {
    console.warn = warn;
  }
});

test('a 429 is marked rate limited; other failures are not', async () => {
  const { source: limited } = source(() => json({ message: 'slow down' }, 429));
  await assert.rejects(limited.check(PURCHASE_ID), (error: unknown) => {
    assert.ok(error instanceof RevenueCatUnavailableError && error.rateLimited);
    return true;
  });
  const { source: broken } = source(() => json({ message: 'oops' }, 503));
  await assert.rejects(broken.check(PURCHASE_ID), (error: unknown) => {
    assert.ok(error instanceof RevenueCatUnavailableError && !error.rateLimited);
    return true;
  });
});
