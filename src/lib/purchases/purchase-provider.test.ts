/**
 * The purchase boundary (P2B7X.1): the fail-closed release provider, the
 * development adapter's scenario matrix and its containment, the price
 * arithmetic, and the source pins that keep the adapter out of a release
 * build.
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
  developmentPurchaseScenario,
  parseSimulatedSubscription,
  seedSimulatedSubscription,
  setDevelopmentPurchaseScenario,
  simulatedExpiry,
  type DevelopmentPurchaseScenarioId,
  type DevelopmentPurchaseStorage,
} from './development-scenarios';
import {
  annualSavingsPercent,
  monthlyEquivalentAmount,
  MONTHS_PER_YEAR,
  unconfiguredPurchaseProvider,
  type Offering,
} from './purchase-provider';

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
  assert.deepEqual(await provider.purchase(DEVELOPMENT_OFFERING.annual), { kind: 'unavailable' });
  assert.deepEqual(await provider.restore(), { kind: 'unavailable' });
});

test('the development adapter is inert outside a development build, whatever its scenario or account', async () => {
  const storage = memoryStorage(JSON.stringify({ period: 'annual', purchasedAt: NOW }));
  for (const scenario of DEVELOPMENT_PURCHASE_SCENARIOS) {
    const { provider } = devProvider(scenario.id, storage, () => false);
    assert.deepEqual(await provider.readEntitlement(), { kind: 'unavailable' }, scenario.id);
    assert.deepEqual(await provider.purchase(DEVELOPMENT_OFFERING.annual), { kind: 'unavailable' });
    assert.deepEqual(await provider.restore(), { kind: 'unavailable' });
    assert.deepEqual(await provider.loadOfferings(), { kind: 'unavailable' });
  }
  // And the simulated subscription it holds is never written by those calls.
  assert.equal(storage.value, JSON.stringify({ period: 'annual', purchasedAt: NOW }));
});

// ── The ten scenarios ───────────────────────────────────────────────────────

test('the ten scenarios the brief names exist, in order, each with an expectation', () => {
  assert.deepEqual(
    DEVELOPMENT_PURCHASE_SCENARIOS.map((s) => s.id),
    [
      'inactive',
      'loading',
      'annual_purchase_success',
      'monthly_purchase_success',
      'user_cancelled',
      'purchase_error',
      'restore_success',
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

test('inactive: no subscription, a purchase succeeds and persists, a restore finds nothing', async () => {
  const { provider, storage } = devProvider('inactive');
  assert.deepEqual(await provider.readEntitlement(), { kind: 'inactive' });
  assert.deepEqual(await provider.restore(), { kind: 'nothing_to_restore' });
  const outcome = await provider.purchase(DEVELOPMENT_OFFERING.monthly);
  assert.equal(outcome.kind, 'success');
  if (outcome.kind !== 'success') return;
  assert.equal(outcome.entitlement.period, 'monthly');
  assert.equal(outcome.entitlement.productId, 'lotly_monthly');
  assert.equal(outcome.entitlement.verifiedAt, NOW);
  assert.equal(outcome.entitlement.expiresAt, simulatedExpiry(NOW, 'monthly'));
  // Persisted: a relaunch reads active, as a real subscriber's would.
  assert.deepEqual(parseSimulatedSubscription(storage.value), {
    period: 'monthly',
    purchasedAt: NOW,
  });
  const reading = await provider.readEntitlement();
  assert.equal(reading.kind, 'active');
});

test('annual and monthly purchase success preselect their plan and succeed for the package bought', async () => {
  const annual = DEVELOPMENT_PURCHASE_SCENARIOS.find((s) => s.id === 'annual_purchase_success');
  const monthly = DEVELOPMENT_PURCHASE_SCENARIOS.find((s) => s.id === 'monthly_purchase_success');
  assert.equal(annual?.initialPlan, 'annual');
  assert.equal(monthly?.initialPlan, 'monthly');
  const a = await devProvider('annual_purchase_success').provider.purchase(
    DEVELOPMENT_OFFERING.annual,
  );
  assert.equal(a.kind, 'success');
  const m = await devProvider('monthly_purchase_success').provider.purchase(
    DEVELOPMENT_OFFERING.monthly,
  );
  assert.equal(m.kind, 'success');
});

test('loading: the offering never resolves while the entitlement still answers', async () => {
  const { provider } = devProvider('loading');
  const raced = await Promise.race([
    provider.loadOfferings().then(() => 'resolved'),
    new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 30)),
  ]);
  assert.equal(raced, 'pending');
  assert.deepEqual(await provider.readEntitlement(), { kind: 'inactive' });
});

test('user cancellation and a purchase error change nothing', async () => {
  for (const [id, kind] of [
    ['user_cancelled', 'cancelled'],
    ['purchase_error', 'error'],
  ] as const) {
    const { provider, storage } = devProvider(id);
    assert.deepEqual(await provider.purchase(DEVELOPMENT_OFFERING.annual), { kind });
    assert.equal(storage.value, null, `${id} wrote a subscription`);
    assert.deepEqual(await provider.readEntitlement(), { kind: 'inactive' });
  }
});

test('restore success finds an annual subscription and persists it; restore-nothing finds nothing', async () => {
  const found = devProvider('restore_success');
  const restored = await found.provider.restore();
  assert.equal(restored.kind, 'restored');
  if (restored.kind === 'restored') assert.equal(restored.entitlement.period, 'annual');
  assert.equal(parseSimulatedSubscription(found.storage.value)?.period, 'annual');
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
    assert.deepEqual(await provider.purchase(DEVELOPMENT_OFFERING.annual), { kind: 'unavailable' });
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
  assert.deepEqual(await provider.purchase(DEVELOPMENT_OFFERING.annual), { kind: 'cancelled' });
  current = 'inactive';
  assert.equal((await provider.purchase(DEVELOPMENT_OFFERING.annual)).kind, 'success');
  // The module-level scenario used by the app follows the same setter.
  setDevelopmentPurchaseScenario('purchase_error');
  assert.equal(developmentPurchaseScenario(), 'purchase_error');
  setDevelopmentPurchaseScenario('inactive');
});

test('the development controls clear and seed the simulated account', async () => {
  const storage = memoryStorage();
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

// ── Price arithmetic ────────────────────────────────────────────────────────

test('the annual saving is computed from the store prices: $29.99 against 12 × $4.99 is 50%', () => {
  assert.equal(MONTHS_PER_YEAR, 12);
  assert.equal(annualSavingsPercent(DEVELOPMENT_OFFERING), 50);
  assert.equal(monthlyEquivalentAmount(DEVELOPMENT_OFFERING.annual), 29.99 / 12);
});

test('the saving follows the prices, never a typed number', () => {
  const priced = (annual: number, monthly: number, currency = 'USD'): Offering => ({
    annual: {
      id: 'a',
      period: 'annual',
      price: { amount: annual, currencyCode: currency, formatted: '' },
    },
    monthly: {
      id: 'm',
      period: 'monthly',
      price: { amount: monthly, currencyCode: currency, formatted: '' },
    },
  });
  assert.equal(annualSavingsPercent(priced(39.99, 4.99)), 33);
  assert.equal(annualSavingsPercent(priced(59.88, 4.99)), null, 'no saving');
  assert.equal(annualSavingsPercent(priced(70, 4.99)), null, 'annual costs more');
  assert.equal(annualSavingsPercent(priced(29.99, 0)), null, 'no monthly price');
  assert.equal(
    annualSavingsPercent({ ...priced(29.99, 4.99), monthly: priced(1, 4.99, 'EUR').monthly }),
    null,
    'currency mismatch',
  );
  assert.equal(monthlyEquivalentAmount(priced(0, 4.99).annual), null);
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
    resolver.indexOf('resolved = unconfiguredPurchaseProvider();'),
  );
  assert.ok(branch.includes("require('./development-provider')"));
  assert.ok(
    resolver.includes('resolved = unconfiguredPurchaseProvider();'),
    'the release path fails closed',
  );
  // The identity handed to a real adapter is the installation id.
  assert.ok(resolver.includes('appUserId: getOrCreateInstallationId'));
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
  const paywall = codeOnly(readFileSync(join(SRC, 'app', 'paywall.tsx'), 'utf8'));
  assert.ok(!/^import .*paywall-development-controls/m.test(paywall));
  assert.ok(
    paywall.includes(
      "? // eslint-disable-next-line @typescript-eslint/no-require-imports\n    (require('@/components/paywall/paywall-development-controls')",
    ),
  );
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
