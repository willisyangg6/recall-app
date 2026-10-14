/**
 * The purchase identity (2026-10-12): a subscription survives "Reset app and
 * delete my data", and an existing subscriber survives the UPGRADE to this
 * build, without a Restore.
 *
 * Proven here against the REAL adapter (revenuecat-adapter.ts), the real
 * reset orchestrator (installation-reset.ts) and the real adoption rule
 * (legacyPurchaseId), with a fake keychain and a fake RevenueCat that keeps
 * entitlements per app-user id and, like RevenueCat's default restore
 * behavior, moves them to the current id on Restore. What only RevenueCat's
 * backend and a device can show is the sandbox plan in
 * docs/recall-onboarding-and-paywall.md §5.2.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { CustomerInfo } from 'react-native-purchases';

import { resetInstallationData, type InstallationResetDeps } from '../installation-reset';
import { createPurchaseIdentity, legacyPurchaseId } from './purchase-identity';
import { createRevenueCatAdapter, type RevenueCatSdk } from './revenuecat-adapter';

const LIB = join(__dirname, '..');

/** The device keychain, as the real modules key it. */
function device(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    get: async (key: string) => items.get(key) ?? null,
    set: async (key: string, value: string) => {
      items.set(key, value);
    },
    delete: async (key: string) => {
      items.delete(key);
    },
  };
}
type Device = ReturnType<typeof device>;

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

const OLD_INSTALL = 'aaaaaaaa-0000-4000-8000-000000000001';
const COMPLETED = JSON.stringify({ personalizationCompleted: true });
const CACHED = JSON.stringify({ productId: 'com.willisyang.lotly.monthly' });

/** The provider's wiring, over the fake keychain (one resolver per process). */
function identityOver(store: Device, failWrites = { on: false }) {
  return createPurchaseIdentity({
    readStored: () => store.get('recall.purchase-id'),
    writeStored: async (id) => {
      if (failWrites.on) throw new Error('keychain locked');
      await store.set('recall.purchase-id', id);
    },
    randomId: uuid,
    adoptableLegacyId: legacyPurchaseId({
      peekInstallationId: () => store.get('recall.installation-id'),
      personalizationCompleted: async () =>
        (JSON.parse((await store.get('recall.onboarding')) ?? '{}') as Record<string, unknown>)
          .personalizationCompleted === true,
      hasCachedEntitlement: async () => (await store.get('recall.entitlement')) !== null,
    }),
  });
}

const NOW = '2026-10-12T12:00:00Z';

function info(active: boolean): CustomerInfo {
  return {
    requestDate: NOW,
    entitlements: {
      active: active
        ? {
            premium: {
              identifier: 'premium',
              isActive: true,
              productIdentifier: 'com.willisyang.lotly.monthly',
              expirationDate: '2026-11-12T12:00:00Z',
            },
          }
        : {},
      all: {},
    },
  } as unknown as CustomerInfo;
}

/** RevenueCat's backend: who holds the subscription, by app-user id. */
function revenueCat(holder: { id: string | null }, network = { up: true }) {
  const configured: string[] = [];
  let current: string | null = null;
  const sdk: RevenueCatSdk = {
    configure: ({ appUserID }) => {
      configured.push(appUserID);
      current = appUserID;
    },
    getCustomerInfo: async () => {
      if (!network.up) throw Object.assign(new Error('offline'), { code: '10' });
      return info(current !== null && holder.id === current);
    },
    getOfferings: async () => ({ current: null, all: {} }) as never,
    purchasePackage: async () => {
      throw new Error('no purchase in these tests');
    },
    // Default restore behavior: transfer to the current app-user id.
    restorePurchases: async () => {
      if (holder.id !== null) holder.id = current;
      return info(holder.id !== null && holder.id === current);
    },
  };
  return { sdk, configured };
}

/** One app process: an adapter over this launch's identity resolver. */
function launch(store: Device, holder: { id: string | null }, network = { up: true }) {
  const identity = identityOver(store);
  const rc = revenueCat(holder, network);
  const adapter = createRevenueCatAdapter({
    sdk: rc.sdk,
    apiKey: 'appl_test',
    identity: { appUserId: identity },
  });
  return { adapter, identity, configured: rc.configured };
}

function resetDeps(store: Device, preserve?: () => Promise<unknown>): InstallationResetDeps {
  const server = { deleted: [] as string[] };
  return Object.assign(
    {
      enqueue: <T>(task: () => Promise<T>) => task(),
      preservePurchaseIdentity: preserve,
      peekInstallationId: () => store.get('recall.installation-id'),
      deleteServerData: async (id: string) => {
        server.deleted.push(id);
      },
      clearLocalPreferences: async () => {},
      clearLocalSavedRecalls: async () => {},
      clearLocalAlertState: async () => {},
      clearLocalOnboardingState: () => store.delete('recall.onboarding'),
      clearInstallationId: () => store.delete('recall.installation-id'),
      createFreshInstallationId: async () => {
        const fresh = uuid();
        await store.set('recall.installation-id', fresh);
        return fresh;
      },
    },
    { server },
  );
}

// ── Minting ──────────────────────────────────────────────────────────────

test('a fresh install mints a separate id — even though an installation id already exists', async () => {
  // A fresh install mints its installation id at launch (push upkeep) before
  // any purchase; it has no completed personalization and no cached grant.
  const store = device({ 'recall.installation-id': OLD_INSTALL });
  const { adapter, configured } = launch(store, { id: null });
  await adapter.readEntitlement();
  assert.notEqual(configured[0], OLD_INSTALL, 'not adopted without evidence');
  assert.equal(store.items.get('recall.purchase-id'), configured[0]);
});

test('concurrent first callers share one id; a keychain failure fails closed and retries', async () => {
  const store = device();
  const failWrites = { on: true };
  const resolve = identityOver(store, failWrites);
  await assert.rejects(Promise.all([resolve(), resolve()]), /keychain locked/);
  assert.equal(store.items.has('recall.purchase-id'), false);
  failWrites.on = false;
  const [a, b] = await Promise.all([resolve(), resolve()]);
  assert.equal(a, b);
  assert.equal(store.items.get('recall.purchase-id'), a);
});

// ── Upgrade ──────────────────────────────────────────────────────────────

for (const [evidence, keys] of [
  ['completed personalization', { 'recall.onboarding': COMPLETED }],
  ['a cached verified entitlement', { 'recall.entitlement': CACHED }],
] as const) {
  test(`upgrade with ${evidence}: the subscriber keeps access with no Restore`, async () => {
    // An older build configured RevenueCat with the installation id.
    const store = device({ 'recall.installation-id': OLD_INSTALL, ...keys });
    const holder = { id: OLD_INSTALL };
    const first = launch(store, holder);
    assert.equal((await first.adapter.readEntitlement()).kind, 'active');
    assert.deepEqual(first.configured, [OLD_INSTALL]);
    assert.equal(store.items.get('recall.purchase-id'), OLD_INSTALL, 'adopted and persisted');
    // Relaunch: read from the keychain, no adoption logic needed.
    const second = launch(store, holder);
    assert.equal((await second.adapter.readEntitlement()).kind, 'active');
    assert.deepEqual(second.configured, [OLD_INSTALL]);
  });
}

test('upgrade, then reset BEFORE any store call: the reset preserves the adopted id first', async () => {
  const store = device({ 'recall.installation-id': OLD_INSTALL, 'recall.onboarding': COMPLETED });
  const holder = { id: OLD_INSTALL };
  const identity = identityOver(store);
  const deps = resetDeps(store, identity);
  assert.equal((await resetInstallationData(deps)).status, 'deleted');
  assert.equal(store.items.get('recall.purchase-id'), OLD_INSTALL);
  assert.notEqual(
    store.items.get('recall.installation-id'),
    OLD_INSTALL,
    'installation id rotated',
  );
  // Relaunch after the reset: still the subscriber's identity, no Restore.
  const after = launch(store, holder);
  assert.equal((await after.adapter.readEntitlement()).kind, 'active');
  assert.deepEqual(after.configured, [OLD_INSTALL]);
});

test('a reset that cannot preserve the purchase id changes nothing', async () => {
  const store = device({ 'recall.installation-id': OLD_INSTALL, 'recall.onboarding': COMPLETED });
  const deps = resetDeps(store, identityOver(store, { on: true }));
  const result = await resetInstallationData(deps);
  assert.equal(result.status, 'failed');
  assert.equal(store.items.get('recall.installation-id'), OLD_INSTALL, 'not rotated');
  assert.equal(store.items.get('recall.onboarding'), COMPLETED, 'nothing cleared');
  assert.deepEqual((deps as unknown as { server: { deleted: string[] } }).server.deleted, []);
});

// ── Reset, relaunch, offline, expired ───────────────────────────────────

test('new-build subscriber: reset → same session → relaunch keeps access, one configure per process', async () => {
  const store = device();
  const holder: { id: string | null } = { id: null };
  const first = launch(store, holder);
  assert.equal((await first.adapter.readEntitlement()).kind, 'inactive');
  const purchaseId = store.items.get('recall.purchase-id')!;
  holder.id = purchaseId; // the purchase lands under the purchase id
  await store.set('recall.installation-id', uuid());
  assert.equal((await resetInstallationData(resetDeps(store, first.identity))).status, 'deleted');
  assert.equal((await first.adapter.readEntitlement()).kind, 'active', 'same session');
  assert.deepEqual(first.configured, [purchaseId]);
  const second = launch(store, holder);
  assert.equal((await second.adapter.readEntitlement()).kind, 'active', 'after relaunch');
  assert.deepEqual(second.configured, [purchaseId]);
});

test('offline: the reading is unavailable — never a grant, never a revocation', async () => {
  const store = device();
  const network = { up: false };
  const { adapter } = launch(store, { id: null }, network);
  assert.equal((await adapter.readEntitlement()).kind, 'unavailable');
  assert.ok(store.items.get('recall.purchase-id'), 'the identity itself needs no network');
  network.up = true;
  assert.equal((await adapter.readEntitlement()).kind, 'inactive');
});

test('an expired subscription stays expired across upgrade and reset: no access is granted', async () => {
  const store = device({ 'recall.installation-id': OLD_INSTALL, 'recall.onboarding': COMPLETED });
  const { adapter } = launch(store, { id: null }); // RevenueCat holds no active entitlement
  assert.equal((await adapter.readEntitlement()).kind, 'inactive');
  assert.equal((await adapter.restore()).kind, 'nothing_to_restore');
});

// ── The one limitation ──────────────────────────────────────────────────

test('limitation: a reset on an OLDER build, not restored since, still needs Restore', async () => {
  // The older build moved RevenueCat to the post-reset installation id; the
  // subscription is still under the pre-reset id, which the device lost.
  const postReset = 'bbbbbbbb-0000-4000-8000-000000000002';
  const store = device({ 'recall.installation-id': postReset, 'recall.entitlement': CACHED });
  const holder = { id: OLD_INSTALL };
  const { adapter } = launch(store, holder);
  assert.equal((await adapter.readEntitlement()).kind, 'inactive', 'not recoverable silently');
  assert.equal((await adapter.restore()).kind, 'restored', 'Restore Purchases recovers it');
  assert.equal((await adapter.readEntitlement()).kind, 'active');
});

// ── Boundaries ───────────────────────────────────────────────────────────

test('the reset only resolves the purchase id; nothing rotates, deletes or sends it', () => {
  const reset = readFileSync(join(LIB, 'installation-reset.ts'), 'utf8');
  assert.ok(!reset.includes('purchases/'), 'the orchestrator imports nothing from purchases');
  const runner = readFileSync(join(LIB, 'installation-reset-runner.ts'), 'utf8');
  assert.match(runner, /preservePurchaseIdentity: purchaseIdentity\.appUserId,/);
  assert.ok(!runner.includes('recall.purchase-id'), 'the runner never names the key');
  const provider = readFileSync(join(LIB, 'purchases', 'provider.ts'), 'utf8');
  assert.match(provider, /const PURCHASE_ID_KEY = 'recall\.purchase-id';/);
  assert.doesNotMatch(provider, /deleteItemAsync\(PURCHASE_ID_KEY\)/, 'nothing deletes it');
  for (const file of ['report-api.ts', 'recall-feed.ts', 'installation-reset-runner.ts']) {
    const source = readFileSync(join(LIB, file), 'utf8');
    assert.ok(!/p_purchase_id|purchaseId\b/.test(source), `${file} never sends it`);
  }
  // The ONE approved exception (alert entitlement gate, founder 2026-10-14):
  // the alert registrations carry it, so the server can stop alerts when the
  // subscription ends. Nothing else in the client sends it to Lotly's server.
  const api = readFileSync(join(LIB, 'push-api.ts'), 'utf8');
  assert.equal(api.match(/p_purchase_id/g)?.length, 1, 'push-api sends it in one place');
  const registerBody = api.slice(api.indexOf('export async function registerPushSubscription('));
  assert.ok(
    registerBody.indexOf('p_purchase_id') <
      registerBody.indexOf('export async function disablePushSubscription'),
    'only the registration carries it, never the disable',
  );
  const registration = readFileSync(join(LIB, 'push-registration.ts'), 'utf8');
  assert.match(
    registration,
    /purchaseId: await purchaseIdentity\.appUserId\(\)\.catch\(\(\) => null\)/,
  );
});
