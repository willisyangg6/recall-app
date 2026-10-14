/**
 * The alert entitlement gate's client half (2026-10-14): both registration
 * RPCs carry the RevenueCat purchase id when the app has one, and omit the
 * parameter otherwise. The server then holds that registration's alerts, and
 * an older database without the parameter keeps working for older builds.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';

const PURCHASE_ID = '8a1f6c2e-3b4d-4e5f-9a0b-1c2d3e4f5a6b';
const BASE = {
  installationId: 'a'.repeat(32),
  expoPushToken: 'ExponentPushToken[abc]',
  platform: 'ios' as const,
  appVersion: '1.0.0',
  sequence: 3,
};

async function capture(
  call: () => Promise<unknown>,
): Promise<{ url: string; body: Record<string, unknown> }> {
  const original = globalThis.fetch;
  let seen: { url: string; body: Record<string, unknown> } | null = null;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ applied: true, last_sequence: 3 }), { status: 200 });
  }) as typeof fetch;
  try {
    await call();
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(seen);
  return seen;
}

test('the plain registration sends p_purchase_id, and omits it when there is none', async () => {
  const { registerPushSubscription } = await import('./push-api');
  const withId = await capture(() =>
    registerPushSubscription({ ...BASE, purchaseId: PURCHASE_ID }),
  );
  assert.match(withId.url, /\/rest\/v1\/rpc\/register_push_subscription$/);
  assert.equal(withId.body.p_purchase_id, PURCHASE_ID);

  for (const purchaseId of [null, undefined]) {
    const without = await capture(() => registerPushSubscription({ ...BASE, purchaseId }));
    assert.ok(!('p_purchase_id' in without.body));
  }
});

test('the keyed (regulated teen) registration sends it too', async () => {
  const { registerPushSubscriptionWithRevocationKey } = await import('./revocation-key-api');
  const keyed = await capture(() =>
    registerPushSubscriptionWithRevocationKey({
      ...BASE,
      appTransactionId: '2000000123456789',
      purchaseId: PURCHASE_ID,
    }),
  );
  assert.match(keyed.url, /register_push_subscription_with_revocation_key$/);
  assert.equal(keyed.body.p_purchase_id, PURCHASE_ID);
  assert.equal(keyed.body.p_app_transaction_id, '2000000123456789');
});
