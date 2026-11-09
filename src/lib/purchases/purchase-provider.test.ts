/**
 * The purchase boundary (P2B7X.1; one lifetime purchase since 2026-11-06):
 * the fail-closed release provider, the development adapter's scenario
 * matrix and its containment, and the source pins that keep the adapter out
 * of a release build.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import {
  clearSimulatedSubscription,
  createDevelopmentPurchaseProvider,
  DEVELOPMENT_OFFERING,
  DEVELOPMENT_PURCHASE_SCENARIOS,
  developmentControlsHidden,
  developmentPurchaseScenario,
  parseSimulatedSubscription,
  seedSimulatedSubscription,
  setDevelopmentControlsHidden,
  setDevelopmentPurchaseScenario,
  simulatedExpiry,
  subscribeDevelopmentControlsHidden,
  type DevelopmentPurchaseScenarioId,
  type DevelopmentPurchaseStorage,
} from './development-scenarios';
import { unconfiguredPurchaseProvider } from './purchase-provider';

const NOW = '2026-09-23T12:00:00.000Z';
const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function memoryStorage(
  initial: string | null = null,
): DevelopmentPurchaseStorage & { value: string | null } {
  const store = {
    value: initial,
    async read() {
      return store.value;
    },
    async write(value: string) {
      store.value = value;
    },
    async remove() {
      store.value = null;
    },
  };
  return store;
}

function devProvider(
  scenario: DevelopmentPurchaseScenarioId,
  storage = memoryStorage(),
  isDevelopment = () => true,
) {
  return {
    storage,
    provider: createDevelopmentPurchaseProvider({
      storage,
      isDevelopment,
      now: () => NOW,
      scenario: () => scenario,
    }),
  };
}

// ── Fail closed ─────────────────────────────────────────────────────────────

test('the unconfigured release provider fails closed on every call', async () => {
  const provider = unconfiguredPurchaseProvider();
  assert.equal(provider.id, 'unconfigured');
  assert.deepEqual(await provider.loadOfferings(), { kind: 'unavailable' });
  assert.deepEqual(await provider.readEntitlement(), { kind: 'unavailable' });
  assert.deepEqual(await provider.purchase(DEVELOPMENT_OFFERING.lifetime), { kind: 'unavailable' });
  assert.deepEqual(await provider.restore(), { kind: 'unavailable' });
});

test('the development adapter is inert outside a development build, whatever its scenario or account', async () => {
  const storage = memoryStorage(JSON.stringify({ period: 'annual', purchasedAt: NOW }));
  for (const scenario of DEVELOPMENT_PURCHASE_SCENARIOS) {
    const { provider } = devProvider(scenario.id, storage, () => false);
    assert.deepEqual(await provider.readEntitlement(), { kind: 'unavailable' }, scenario.id);
    assert.deepEqual(await provider.purchase(DEVELOPMENT_OFFERING.lifetime), {
      kind: 'unavailable',
    });
    assert.deepEqual(await provider.restore(), { kind: 'unavailable' });
    assert.deepEqual(await provider.loadOfferings(), { kind: 'unavailable' });
  }
  // And the simulated subscription it holds is never written by those calls.
  assert.equal(storage.value, JSON.stringify({ period: 'annual', purchasedAt: NOW }));
});

// ── The ten scenarios ───────────────────────────────────────────────────────

test('the ten scenarios exist, in order, each with an expectation', () => {
  assert.deepEqual(
    DEVELOPMENT_PURCHASE_SCENARIOS.map((s) => s.id),
    [
      'inactive',
      'loading',
      'purchase_success',
      'user_cancelled',
      'purchase_error',
      'restore_lifetime',
      'restore_subscription',
      'restore_nothing',
      'unavailable_cached_active',
      'unavailable_unverified',
    ],
  );
  for (const scenario of DEVELOPMENT_PURCHASE_SCENARIOS) {
    assert.ok(scenario.expectation.length > 20, scenario.id);
  }
  assert.equal(developmentPurchaseScenario(), 'inactive', 'the default scenario is inactive');
});

test('the fixture offering is one lifetime package at the proposed price', () => {
  assert.deepEqual(DEVELOPMENT_OFFERING, {
    lifetime: {
      id: 'lotly_lifetime',
      period: 'lifetime',
      price: { amount: 19.99, currencyCode: 'USD', formatted: '$19.99' },
    },
  });
});

test('inactive: nothing bought, a lifetime purchase succeeds with no expiry and persists, a restore finds nothing', async () => {
  const { provider, storage } = devProvider('inactive');
  assert.deepEqual(await provider.readEntitlement(), { kind: 'inactive', asOf: NOW });
  assert.deepEqual(await provider.restore(), { kind: 'nothing_to_restore' });
  const outcome = await provider.purchase(DEVELOPMENT_OFFERING.lifetime);
  assert.deepEqual(outcome, {
    kind: 'success',
    entitlement: {
      productId: 'lotly_lifetime',
      period: 'lifetime',
      verifiedAt: NOW,
      expiresAt: null,
    },
  });
  assert.equal(simulatedExpiry(NOW, 'lifetime'), null);
  // Persisted: a relaunch reads active, as a real customer's would.
  assert.deepEqual(parseSimulatedSubscription(storage.value), {
    period: 'lifetime',
    purchasedAt: NOW,
  });
  const reading = await provider.readEntitlement();
  assert.equal(reading.kind, 'active');
  if (reading.kind === 'active') assert.equal(reading.entitlement.expiresAt, null);
});

test('an earlier build’s subscription on the simulated account still reads active, with its expiry', async () => {
  for (const period of ['annual', 'monthly'] as const) {
    const storage = memoryStorage(JSON.stringify({ period, purchasedAt: NOW }));
    const reading = await devProvider('inactive', storage).provider.readEntitlement();
    assert.deepEqual(reading, {
      kind: 'active',
      entitlement: {
        productId: `lotly_${period}`,
        period,
        verifiedAt: NOW,
        expiresAt: simulatedExpiry(NOW, period),
      },
    });
  }
});

test('loading: the offering never resolves while the entitlement still answers', async () => {
  const { provider } = devProvider('loading');
  const raced = await Promise.race([
    provider.loadOfferings().then(() => 'resolved'),
    new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 30)),
  ]);
  assert.equal(raced, 'pending');
  assert.deepEqual(await provider.readEntitlement(), { kind: 'inactive', asOf: NOW });
});

test('user cancellation and a purchase error change nothing', async () => {
  for (const [id, kind] of [
    ['user_cancelled', 'cancelled'],
    ['purchase_error', 'error'],
  ] as const) {
    const { provider, storage } = devProvider(id);
    assert.deepEqual(await provider.purchase(DEVELOPMENT_OFFERING.lifetime), { kind });
    assert.equal(storage.value, null, `${id} wrote a subscription`);
    assert.deepEqual(await provider.readEntitlement(), { kind: 'inactive', asOf: NOW });
  }
});

test('restore finds a lifetime purchase, or an earlier build’s subscription, and persists it; restore-nothing finds nothing', async () => {
  for (const [id, period] of [
    ['restore_lifetime', 'lifetime'],
    ['restore_subscription', 'annual'],
  ] as const) {
    const found = devProvider(id);
    const restored = await found.provider.restore();
    assert.equal(restored.kind, 'restored', id);
    if (restored.kind === 'restored') assert.equal(restored.entitlement.period, period, id);
    assert.equal(parseSimulatedSubscription(found.storage.value)?.period, period, id);
  }
  const nothing = devProvider('restore_nothing');
  assert.deepEqual(await nothing.provider.restore(), { kind: 'nothing_to_restore' });
  assert.equal(nothing.storage.value, null);
});

test('unavailable: every call answers unavailable, whether or not a simulated subscription exists', async () => {
  const withSub = memoryStorage(JSON.stringify({ period: 'annual', purchasedAt: NOW }));
  for (const [id, storage] of [
    ['unavailable_cached_active', withSub],
    ['unavailable_unverified', memoryStorage()],
  ] as const) {
    const { provider } = devProvider(id, storage);
    assert.deepEqual(await provider.readEntitlement(), { kind: 'unavailable' }, id);
    assert.deepEqual(await provider.loadOfferings(), { kind: 'unavailable' }, id);
    assert.deepEqual(await provider.purchase(DEVELOPMENT_OFFERING.lifetime), {
      kind: 'unavailable',
    });
    assert.deepEqual(await provider.restore(), { kind: 'unavailable' });
  }
});

test('the scenario is live: switching it changes the next call without a new provider', async () => {
  const storage = memoryStorage();
  let current: DevelopmentPurchaseScenarioId = 'user_cancelled';
  const provider = createDevelopmentPurchaseProvider({
    storage,
    isDevelopment: () => true,
    now: () => NOW,
    scenario: () => current,
  });
  assert.deepEqual(await provider.purchase(DEVELOPMENT_OFFERING.lifetime), { kind: 'cancelled' });
  current = 'inactive';
  assert.equal((await provider.purchase(DEVELOPMENT_OFFERING.lifetime)).kind, 'success');
  // The module-level scenario used by the app follows the same setter.
  setDevelopmentPurchaseScenario('purchase_error');
  assert.equal(developmentPurchaseScenario(), 'purchase_error');
  setDevelopmentPurchaseScenario('inactive');
});

test('the development controls clear and seed the simulated account', async () => {
  const storage = memoryStorage();
  await seedSimulatedSubscription(storage, 'lifetime', NOW);
  assert.deepEqual(parseSimulatedSubscription(storage.value), {
    period: 'lifetime',
    purchasedAt: NOW,
  });
  await seedSimulatedSubscription(storage, 'annual', NOW);
  assert.deepEqual(parseSimulatedSubscription(storage.value), {
    period: 'annual',
    purchasedAt: NOW,
  });
  await clearSimulatedSubscription(storage);
  assert.equal(storage.value, null);
  assert.equal(parseSimulatedSubscription('not json'), null);
  assert.equal(
    parseSimulatedSubscription(JSON.stringify({ period: 'weekly', purchasedAt: NOW })),
    null,
  );
});

// ── Containment: the adapter cannot ship as a bypass ────────────────────────

/** Every non-test client source under src, as `{ path, source }`. */
function clientSources(): { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'server') continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      files.push({ path: relative(SRC, full), source: readFileSync(full, 'utf8') });
    }
  };
  walk(SRC);
  return files;
}

test('the release resolver reaches the development adapter only through a __DEV__-folded require', () => {
  const resolver = codeOnly(readFileSync(join(__dirname, 'provider.ts'), 'utf8'));
  assert.ok(
    !/^import .*development-provider/m.test(resolver),
    'a static import would ship the adapter',
  );
  assert.ok(resolver.includes('if (__DEV__) {'));
  const branch = resolver.slice(
    resolver.indexOf('if (__DEV__) {'),
    resolver.indexOf('resolved = revenueCatPurchaseProvider(purchaseIdentity);'),
  );
  assert.ok(branch.includes("require('./development-provider')"));
  assert.ok(
    resolver.includes('resolved = revenueCatPurchaseProvider(purchaseIdentity);'),
    'the release path runs the RevenueCat provider',
  );
  // The identity handed to a real adapter is the separate purchase id —
  // never the installation id, which the data reset rotates.
  assert.ok(resolver.includes('appUserId: createPurchaseIdentity({'));
  // It may PEEK the installation id (upgrade adoption), never mint one.
  assert.ok(!resolver.includes('getOrCreateInstallationId'));
  assert.ok(resolver.includes("import { peekInstallationId } from '../installation-id';"));
  // The RevenueCat wiring fails closed off iOS, without the public key, and
  // without the native module — each by returning the unconfigured provider —
  // and reads nothing from the environment but the one public key.
  const wiring = codeOnly(readFileSync(join(__dirname, 'revenuecat-provider.ts'), 'utf8'));
  assert.equal((wiring.match(/return unconfiguredPurchaseProvider\(\);/g) ?? []).length, 3);
  assert.ok(wiring.includes("if (Platform.OS !== 'ios') return unconfiguredPurchaseProvider();"));
  assert.ok(wiring.includes('if (!nativeModuleLinked()) return unconfiguredPurchaseProvider();'));
  assert.deepEqual(
    [...wiring.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]),
    ['EXPO_PUBLIC_REVENUECAT_IOS_KEY'],
  );
  const web = codeOnly(readFileSync(join(__dirname, 'revenuecat-provider.web.ts'), 'utf8'));
  assert.ok(!web.includes('react-native-purchases'), 'the web variant imports the SDK');
  assert.ok(web.includes('return unconfiguredPurchaseProvider();'));
});

test('nothing imports the development adapter statically except its own native wiring and the dev-only controls', () => {
  const importers = clientSources().filter(({ source }) =>
    /^import .*purchases\/development-(provider|scenarios)'/m.test(codeOnly(source)),
  );
  assert.deepEqual(
    importers.map(({ path }) => path).sort(),
    [
      'components/paywall/paywall-development-controls.tsx',
      'lib/purchases/development-provider.ts',
      'lib/purchases/development-provider.web.ts',
    ].filter((path) => importers.some((i) => i.path === path)),
  );
  // The development-controls component is itself reached only through a
  // __DEV__ require, and returns null outside a development build.
  const controls = codeOnly(
    readFileSync(join(SRC, 'components', 'paywall', 'paywall-development-controls.tsx'), 'utf8'),
  );
  assert.ok(controls.includes('if (!__DEV__) return null;'));
  // The one purchase flow (shared by the Ready step and the paywall) is the
  // only place that reaches them, inside a __DEV__ branch.
  const flow = codeOnly(readFileSync(join(SRC, 'hooks', 'use-purchase-flow.tsx'), 'utf8'));
  assert.ok(!/^import .*paywall-development-controls/m.test(flow));
  assert.ok(
    flow.includes(
      "? // eslint-disable-next-line @typescript-eslint/no-require-imports\n    (require('@/components/paywall/paywall-development-controls')",
    ),
  );
  for (const route of [
    'paywall.tsx',
    join('onboarding', 'paywall.tsx'),
    join('onboarding', 'preview.tsx'),
  ]) {
    const code = codeOnly(readFileSync(join(SRC, 'app', route), 'utf8'));
    assert.ok(!code.includes('paywall-development-controls'), `${route} reaches the controls`);
    assert.ok(!code.includes('development-scenarios'), `${route} reaches the scenarios`);
  }
  const hub = codeOnly(readFileSync(join(SRC, 'app', 'design-preview', 'index.tsx'), 'utf8'));
  assert.ok(
    !/^import .*purchases\/development-/m.test(hub),
    'the hub imports the adapter statically',
  );
});

test('no route or product component names a US dollar price; the fixtures live in the development adapter alone', () => {
  const price = /\$\d+\.\d{2}/;
  for (const { path, source } of clientSources()) {
    if (path === 'lib/purchases/development-scenarios.ts') continue;
    if (path.startsWith('app/design-preview/')) continue;
    assert.doesNotMatch(codeOnly(source), price, `${path} hardcodes a price`);
  }
});

test('the development adapter re-checks the development gate on every method, not once at construction', () => {
  const source = codeOnly(readFileSync(join(__dirname, 'development-scenarios.ts'), 'utf8'));
  const checks =
    source.match(/if \(!deps\.isDevelopment\(\)\) return \{ kind: 'unavailable' \};/g) ?? [];
  assert.equal(checks.length, 4, 'loadOfferings, readEntitlement, purchase and restore each guard');
});

test('the clean-capture switch is in memory, off by default, tells its subscribers, and changes no scenario', () => {
  assert.equal(developmentControlsHidden(), false, 'controls must be shown at every launch');
  const scenario = developmentPurchaseScenario();
  let heard = 0;
  const unsubscribe = subscribeDevelopmentControlsHidden(() => {
    heard += 1;
  });
  setDevelopmentControlsHidden(true);
  assert.equal(developmentControlsHidden(), true);
  setDevelopmentControlsHidden(false);
  assert.equal(heard, 2);
  unsubscribe();
  setDevelopmentControlsHidden(true);
  assert.equal(heard, 2, 'an unsubscribed listener is not called');
  setDevelopmentControlsHidden(false);
  assert.equal(developmentPurchaseScenario(), scenario);
  // Reached only through the purchase flow's and the gallery's __DEV__
  // branches, so a release bundle folds the store and its names away.
  for (const path of [
    join(SRC, 'hooks', 'use-purchase-flow.tsx'),
    join(SRC, 'components', 'development', 'onboarding-gallery.tsx'),
  ]) {
    const code = codeOnly(readFileSync(path, 'utf8'));
    assert.match(code, /const controlsHiddenStore =\s+__DEV__ && \w+\s+\?/);
    assert.ok(code.includes(': { subscribe: () => () => {}, get: () => false };'), path);
  }
});
