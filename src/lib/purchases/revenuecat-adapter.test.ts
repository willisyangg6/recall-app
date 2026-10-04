/**
 * The RevenueCat adapter (P2B7X.2): the mapping from the SDK's customer info
 * and offerings to the typed boundary, the configure-once rule, and the
 * entitlement-session races driven through the adapter's own readings — all
 * against a fake SDK whose every answer the test controls.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  CustomerInfo,
  MakePurchaseResult,
  PurchasesEntitlementInfo,
  PurchasesOffering,
  PurchasesOfferings,
  PurchasesPackage,
} from 'react-native-purchases';

import { createEntitlementSession } from '../entitlement-session';
import type { ActiveEntitlement, EntitlementStatus } from '../entitlement';
import {
  APPLE_PRODUCT_IDS,
  classifySdkFailure,
  createRevenueCatAdapter,
  offeringFromOfferings,
  readingFromCustomerInfo,
  REVENUECAT_ENTITLEMENT,
  REVENUECAT_OFFERING,
  type RevenueCatSdk,
} from './revenuecat-adapter';

const REQUESTED = '2026-10-04T15:00:00.000Z';
const EXPIRES = '2027-10-04T15:00:00.000Z';

// ── Fixtures shaped like the SDK's objects ──────────────────────────────────

function product(identifier: string, price = 29.99, priceString = '$29.99', currencyCode = 'USD') {
  return {
    identifier,
    description: '',
    title: 'Lotly',
    price,
    priceString,
    currencyCode,
  } as unknown as PurchasesPackage['product'];
}

function pkg(
  identifier: string,
  productId: string,
  overrides: Partial<PurchasesPackage['product']> = {},
) {
  return {
    identifier,
    packageType: identifier === '$rc_annual' ? 'ANNUAL' : 'MONTHLY',
    product: { ...product(productId), ...overrides },
    offeringIdentifier: REVENUECAT_OFFERING,
  } as unknown as PurchasesPackage;
}

const ANNUAL = pkg('$rc_annual', APPLE_PRODUCT_IDS.annual, {
  price: 29.99,
  priceString: '$29.99',
});
const MONTHLY = pkg('$rc_monthly', APPLE_PRODUCT_IDS.monthly, {
  price: 4.99,
  priceString: '$4.99',
});

function offerings(current: Partial<PurchasesOffering> | null): PurchasesOfferings {
  const offering =
    current === null
      ? null
      : ({
          identifier: REVENUECAT_OFFERING,
          availablePackages: [ANNUAL, MONTHLY],
          annual: ANNUAL,
          monthly: MONTHLY,
          ...current,
        } as PurchasesOffering);
  return { all: offering ? { [offering.identifier]: offering } : {}, current: offering };
}

function entitlement(overrides: Partial<PurchasesEntitlementInfo> = {}): PurchasesEntitlementInfo {
  return {
    identifier: REVENUECAT_ENTITLEMENT,
    isActive: true,
    willRenew: true,
    productIdentifier: APPLE_PRODUCT_IDS.annual,
    expirationDate: EXPIRES,
    store: 'APP_STORE',
    isSandbox: true,
    ...overrides,
  } as PurchasesEntitlementInfo;
}

function customerInfo(
  active: PurchasesEntitlementInfo | null,
  requestDate = REQUESTED,
): CustomerInfo {
  return {
    requestDate,
    entitlements: {
      all: active ? { [REVENUECAT_ENTITLEMENT]: active } : {},
      active: active ? { [REVENUECAT_ENTITLEMENT]: active } : {},
    },
    activeSubscriptions: active ? [active.productIdentifier] : [],
  } as unknown as CustomerInfo;
}

const ACTIVE_ANNUAL = {
  productId: APPLE_PRODUCT_IDS.annual,
  period: 'annual' as const,
  verifiedAt: REQUESTED,
  expiresAt: EXPIRES,
};

// ── A fake SDK ──────────────────────────────────────────────────────────────

interface FakeSdk extends RevenueCatSdk {
  configured: { apiKey: string; appUserID: string }[];
  purchased: PurchasesPackage[];
  customerInfo: () => Promise<CustomerInfo>;
  offerings: () => Promise<PurchasesOfferings>;
  purchase: (p: PurchasesPackage) => Promise<MakePurchaseResult>;
  restore: () => Promise<CustomerInfo>;
}

function fakeSdk(): FakeSdk {
  const sdk: FakeSdk = {
    configured: [],
    purchased: [],
    customerInfo: async () => customerInfo(null),
    offerings: async () => offerings({}),
    purchase: async () => ({ customerInfo: customerInfo(entitlement()) }) as MakePurchaseResult,
    restore: async () => customerInfo(null),
    configure(configuration) {
      sdk.configured.push(configuration);
    },
    getCustomerInfo: () => sdk.customerInfo(),
    getOfferings: () => sdk.offerings(),
    purchasePackage(p) {
      sdk.purchased.push(p);
      return sdk.purchase(p);
    },
    restorePurchases: () => sdk.restore(),
  };
  return sdk;
}

function adapter(sdk = fakeSdk(), appUserId = async () => 'install-uuid') {
  return {
    sdk,
    provider: createRevenueCatAdapter({ sdk, apiKey: 'appl_test', identity: { appUserId } }),
  };
}

function sdkError(code: string, userCancelled: boolean | null = null) {
  return {
    code,
    message: 'x',
    readableErrorCode: 'x',
    userInfo: {},
    underlyingErrorMessage: '',
    userCancelled,
  };
}

// ── Mapping: customer info ──────────────────────────────────────────────────

test('an active premium entitlement maps to the plan, product and expiry, dated by requestDate', () => {
  assert.deepEqual(readingFromCustomerInfo(customerInfo(entitlement())), {
    kind: 'active',
    entitlement: ACTIVE_ANNUAL,
  });
  const monthly = entitlement({ productIdentifier: APPLE_PRODUCT_IDS.monthly });
  assert.deepEqual(readingFromCustomerInfo(customerInfo(monthly)), {
    kind: 'active',
    entitlement: { ...ACTIVE_ANNUAL, productId: APPLE_PRODUCT_IDS.monthly, period: 'monthly' },
  });
});

test('no active premium entitlement is inactive, dated asOf requestDate — never the device clock', () => {
  const before = Date.now();
  assert.deepEqual(readingFromCustomerInfo(customerInfo(null)), {
    kind: 'inactive',
    asOf: REQUESTED,
  });
  const lapsed = entitlement({ isActive: false });
  assert.deepEqual(readingFromCustomerInfo(customerInfo(lapsed)), {
    kind: 'inactive',
    asOf: REQUESTED,
  });
  assert.ok(Date.parse(REQUESTED) < before, 'the fixture request date predates this test run');
});

test('an undatable, unknown-product or expiry-less customer info is unavailable: fail closed', () => {
  for (const [label, info] of [
    ['missing requestDate', customerInfo(entitlement(), '')],
    ['unparseable requestDate', customerInfo(entitlement(), 'not a date')],
    ['unparseable requestDate, inactive', customerInfo(null, 'yesterday')],
    ['unknown product', customerInfo(entitlement({ productIdentifier: 'com.other.app.plan' }))],
    ['no expiry (would be lifetime)', customerInfo(entitlement({ expirationDate: null }))],
    ['unparseable expiry', customerInfo(entitlement({ expirationDate: 'soon' }))],
    ['null customer info', null],
  ] as const) {
    assert.deepEqual(readingFromCustomerInfo(info), { kind: 'unavailable' }, label);
  }
});

test('an entitlement under another identifier grants nothing', () => {
  const other = {
    ...customerInfo(null),
    entitlements: { all: {}, active: { pro: entitlement() } },
  };
  assert.deepEqual(readingFromCustomerInfo(other as unknown as CustomerInfo), {
    kind: 'inactive',
    asOf: REQUESTED,
  });
});

// ── Mapping: offerings ──────────────────────────────────────────────────────

test('the current offering resolves both built-in packages with the store prices verbatim', () => {
  const mapped = offeringFromOfferings(offerings({}));
  assert.ok(mapped);
  assert.deepEqual(mapped.offering, {
    annual: {
      id: '$rc_annual',
      period: 'annual',
      price: { amount: 29.99, currencyCode: 'USD', formatted: '$29.99' },
    },
    monthly: {
      id: '$rc_monthly',
      period: 'monthly',
      price: { amount: 4.99, currencyCode: 'USD', formatted: '$4.99' },
    },
  });
  assert.equal(mapped.packages.annual, ANNUAL);
  assert.equal(mapped.packages.monthly, MONTHLY);
});

test('a localized price is passed through as the store rendered it', () => {
  const euro = offerings({
    annual: pkg('$rc_annual', APPLE_PRODUCT_IDS.annual, {
      price: 27.99,
      priceString: '27,99 €',
      currencyCode: 'EUR',
    }),
    monthly: pkg('$rc_monthly', APPLE_PRODUCT_IDS.monthly, {
      price: 4.49,
      priceString: '4,49 €',
      currencyCode: 'EUR',
    }),
  });
  const mapped = offeringFromOfferings(euro);
  assert.equal(mapped?.offering.annual.price.formatted, '27,99 €');
  assert.equal(mapped?.offering.monthly.price.currencyCode, 'EUR');
});

test('a missing or inconsistent offering is unavailable, never guessed', () => {
  const cases: [string, PurchasesOfferings][] = [
    ['no current offering', offerings(null)],
    ['no annual package', offerings({ annual: null })],
    ['no monthly package', offerings({ monthly: null })],
    [
      'annual package sells the wrong product',
      offerings({ annual: pkg('$rc_annual', 'com.willisyang.lotly.lifetime') }),
    ],
    [
      'packages swapped',
      offerings({
        annual: pkg('$rc_annual', APPLE_PRODUCT_IDS.monthly),
        monthly: pkg('$rc_monthly', APPLE_PRODUCT_IDS.annual),
      }),
    ],
    [
      'no price string',
      offerings({ annual: pkg('$rc_annual', APPLE_PRODUCT_IDS.annual, { priceString: '' }) }),
    ],
    [
      'zero price',
      offerings({ monthly: pkg('$rc_monthly', APPLE_PRODUCT_IDS.monthly, { price: 0 }) }),
    ],
    [
      'no currency',
      offerings({ monthly: pkg('$rc_monthly', APPLE_PRODUCT_IDS.monthly, { currencyCode: '' }) }),
    ],
  ];
  for (const [label, value] of cases) {
    assert.equal(offeringFromOfferings(value), null, label);
  }
});

// ── Failure classification ──────────────────────────────────────────────────

test('SDK rejections classify: cancellation, unreachable or misconfigured store, or a retryable error', () => {
  assert.equal(classifySdkFailure(sdkError('1')), 'cancelled');
  assert.equal(classifySdkFailure(sdkError('0', true)), 'cancelled');
  for (const code of ['2', '10', '11', '17', '23', '24', '33', '35']) {
    assert.equal(classifySdkFailure(sdkError(code)), 'unavailable', `code ${code}`);
  }
  for (const code of ['0', '3', '4', '5', '6', '20', '29']) {
    assert.equal(classifySdkFailure(sdkError(code)), 'error', `code ${code}`);
  }
  assert.equal(classifySdkFailure(new Error('boom')), 'error');
  assert.equal(classifySdkFailure('string'), 'error');
  assert.equal(classifySdkFailure(null), 'error');
});

// ── The adapter ─────────────────────────────────────────────────────────────

test('the adapter configures once with the key and the installation id, even for concurrent callers', async () => {
  let minted = 0;
  const { sdk, provider } = adapter(fakeSdk(), async () => {
    minted += 1;
    await Promise.resolve();
    return 'install-uuid';
  });
  await Promise.all([
    provider.readEntitlement(),
    provider.loadOfferings(),
    provider.readEntitlement(),
  ]);
  await provider.restore();
  assert.deepEqual(sdk.configured, [{ apiKey: 'appl_test', appUserID: 'install-uuid' }]);
  assert.equal(minted, 1);
});

test('a configuration that fails is forgotten so the next call can try again', async () => {
  let attempts = 0;
  const { sdk, provider } = adapter(fakeSdk(), async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('secure store unavailable');
    return 'install-uuid';
  });
  assert.deepEqual(await provider.readEntitlement(), { kind: 'unavailable' });
  assert.deepEqual(await provider.readEntitlement(), { kind: 'inactive', asOf: REQUESTED });
  assert.equal(sdk.configured.length, 1);
});

test('an empty identity never configures the store', async () => {
  const { sdk, provider } = adapter(fakeSdk(), async () => '');
  assert.deepEqual(await provider.loadOfferings(), { kind: 'unavailable' });
  assert.equal(sdk.configured.length, 0);
});

test('loadOfferings answers ready with both packages, unavailable when misconfigured, error when the store errs', async () => {
  const { sdk, provider } = adapter();
  const ready = await provider.loadOfferings();
  assert.equal(ready.kind, 'ready');
  sdk.offerings = async () => offerings({ monthly: null });
  assert.deepEqual(await provider.loadOfferings(), { kind: 'unavailable' });
  sdk.offerings = async () => {
    throw sdkError('10');
  };
  assert.deepEqual(await provider.loadOfferings(), { kind: 'unavailable' });
  sdk.offerings = async () => {
    throw sdkError('0');
  };
  assert.deepEqual(await provider.loadOfferings(), { kind: 'error' });
});

test('readEntitlement maps the customer info and is unavailable on any failure', async () => {
  const { sdk, provider } = adapter();
  sdk.customerInfo = async () => customerInfo(entitlement());
  assert.deepEqual(await provider.readEntitlement(), {
    kind: 'active',
    entitlement: ACTIVE_ANNUAL,
  });
  sdk.customerInfo = async () => {
    throw sdkError('35');
  };
  assert.deepEqual(await provider.readEntitlement(), { kind: 'unavailable' });
});

test('purchase buys the ACTUAL resolved package for the chosen plan and succeeds only on an active premium', async () => {
  const { sdk, provider } = adapter();
  const ready = await provider.loadOfferings();
  assert.equal(ready.kind, 'ready');
  if (ready.kind !== 'ready') return;
  sdk.purchase = async (p) =>
    ({
      customerInfo: customerInfo(
        entitlement({
          productIdentifier:
            p.identifier === '$rc_monthly' ? APPLE_PRODUCT_IDS.monthly : APPLE_PRODUCT_IDS.annual,
        }),
      ),
    }) as MakePurchaseResult;
  assert.deepEqual(await provider.purchase(ready.offering.monthly), {
    kind: 'success',
    entitlement: { ...ACTIVE_ANNUAL, productId: APPLE_PRODUCT_IDS.monthly, period: 'monthly' },
  });
  assert.deepEqual(await provider.purchase(ready.offering.annual), {
    kind: 'success',
    entitlement: ACTIVE_ANNUAL,
  });
  assert.deepEqual(
    sdk.purchased.map((p) => p.identifier),
    ['$rc_monthly', '$rc_annual'],
  );
});

test('a purchase that resolves without an active premium entitlement is not success', async () => {
  const { sdk, provider } = adapter();
  const ready = await provider.loadOfferings();
  if (ready.kind !== 'ready') throw new Error('offering');
  sdk.purchase = async () => ({ customerInfo: customerInfo(null) }) as MakePurchaseResult;
  assert.deepEqual(await provider.purchase(ready.offering.annual), { kind: 'error' });
  sdk.purchase = async () =>
    ({ customerInfo: customerInfo(entitlement(), 'never') }) as MakePurchaseResult;
  assert.deepEqual(await provider.purchase(ready.offering.annual), { kind: 'error' });
});

test('purchase maps cancellation, a store outage and a declined payment to their outcomes', async () => {
  const { sdk, provider } = adapter();
  const ready = await provider.loadOfferings();
  if (ready.kind !== 'ready') throw new Error('offering');
  for (const [thrown, kind] of [
    [sdkError('1', true), 'cancelled'],
    [sdkError('10'), 'unavailable'],
    [sdkError('3'), 'error'],
    [new Error('native crashed'), 'error'],
  ] as const) {
    sdk.purchase = async () => {
      throw thrown;
    };
    assert.deepEqual(await provider.purchase(ready.offering.annual), { kind });
  }
});

test('a plan the offering no longer resolves is re-resolved from the store, and unavailable if still absent', async () => {
  const { sdk, provider } = adapter();
  // Never loaded through this adapter: the package is fetched on demand.
  const outcome = await provider.purchase({
    id: '$rc_annual',
    period: 'annual',
    price: { amount: 29.99, currencyCode: 'USD', formatted: '$29.99' },
  });
  assert.equal(outcome.kind, 'success');
  assert.equal(sdk.purchased[0]?.identifier, '$rc_annual');
  // A stale plan id the store does not sell any more.
  assert.deepEqual(
    await provider.purchase({
      id: '$rc_old_annual',
      period: 'annual',
      price: { amount: 1, currencyCode: 'USD', formatted: '$1' },
    }),
    { kind: 'unavailable' },
  );
  assert.equal(sdk.purchased.length, 1, 'no purchase was attempted for the stale plan');
});

test('restore: active premium restores it; none means nothing to restore; undatable or failed is unavailable or error', async () => {
  const { sdk, provider } = adapter();
  sdk.restore = async () => customerInfo(entitlement());
  assert.deepEqual(await provider.restore(), { kind: 'restored', entitlement: ACTIVE_ANNUAL });
  sdk.restore = async () => customerInfo(null);
  assert.deepEqual(await provider.restore(), { kind: 'nothing_to_restore' });
  sdk.restore = async () => customerInfo(entitlement(), 'not a date');
  assert.deepEqual(await provider.restore(), { kind: 'unavailable' });
  sdk.restore = async () => {
    throw sdkError('10');
  };
  assert.deepEqual(await provider.restore(), { kind: 'unavailable' });
  sdk.restore = async () => {
    throw sdkError('0');
  };
  assert.deepEqual(await provider.restore(), { kind: 'error' });
});

// ── The entitlement-session races, through the adapter's own readings ───────

const EARLIER_REQUEST = '2026-10-04T14:59:00.000Z';

function sessionOver(sdk: FakeSdk) {
  const { provider } = adapter(sdk);
  const statuses: EntitlementStatus[] = [];
  let cache: ActiveEntitlement | null = null;
  const session = createEntitlementSession({
    readEntitlement: () => provider.readEntitlement(),
    loadCache: async () => cache,
    saveCache: async (value) => {
      cache = value;
    },
    now: () => '2026-10-04T15:00:30.000Z',
    timeoutMs: 50,
    onStatus: (status) => statuses.push(status),
  });
  return {
    provider,
    session,
    statuses,
    cache: () => cache,
  };
}

test('a refresh that started before the purchase and answers with pre-purchase customer info is discarded', async () => {
  const sdk = fakeSdk();
  let release!: (info: CustomerInfo) => void;
  sdk.customerInfo = () => new Promise((resolve) => (release = resolve));
  const s = sessionOver(sdk);
  const refresh = s.session.read();
  await new Promise((resolve) => setImmediate(resolve));
  // The purchase succeeds and is applied while the store is still answering.
  const outcome = await s.session.runStoreOperation(async () => {
    const result = await s.provider.purchase({
      id: '$rc_annual',
      period: 'annual',
      price: { amount: 29.99, currencyCode: 'USD', formatted: '$29.99' },
    });
    if (result.kind === 'success') await s.session.apply(result.entitlement);
    return result;
  });
  assert.equal(outcome.kind, 'success');
  release(customerInfo(null, EARLIER_REQUEST));
  assert.equal(await refresh, null);
  assert.deepEqual(s.statuses, []);
  assert.deepEqual(s.cache(), ACTIVE_ANNUAL);
});

test('a post-purchase refresh served from the SDK cache (older requestDate, no entitlement) cannot revoke', async () => {
  const sdk = fakeSdk();
  const s = sessionOver(sdk);
  await s.session.apply(ACTIVE_ANNUAL);
  sdk.customerInfo = async () => customerInfo(null, EARLIER_REQUEST);
  assert.deepEqual(await s.session.read(), {
    kind: 'active',
    entitlement: ACTIVE_ANNUAL,
    confirmation: 'cached',
  });
  assert.deepEqual(s.cache(), ACTIVE_ANNUAL);
  // Fresh customer info after the purchase that says inactive: a real revocation.
  sdk.customerInfo = async () => customerInfo(null, '2026-10-04T15:00:20.000Z');
  assert.deepEqual(await s.session.read(), { kind: 'inactive', reason: 'verified' });
  assert.equal(s.cache(), null);
});

test('a restore applied under the guard, then a refresh with undatable customer info, keeps the restored access cached', async () => {
  const sdk = fakeSdk();
  const s = sessionOver(sdk);
  sdk.restore = async () => customerInfo(entitlement());
  await s.session.runStoreOperation(async () => {
    const result = await s.provider.restore();
    if (result.kind === 'restored') await s.session.apply(result.entitlement);
    return result;
  });
  sdk.customerInfo = async () => customerInfo(null, 'garbage');
  assert.deepEqual(await s.session.read(), {
    kind: 'active',
    entitlement: ACTIVE_ANNUAL,
    confirmation: 'cached',
  });
});
