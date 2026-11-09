/**
 * The RevenueCat adapter (P2B7X.2; lifetime access since 2026-11-06): the
 * mapping from the SDK's customer info and offerings to the typed boundary,
 * the configure-once rule, and the entitlement-session races driven through
 * the adapter's own readings — all against a fake SDK whose every answer the
 * test controls. The fake's CURRENT offering is the legacy annual/monthly
 * one older builds read, so every test also proves this build never sells
 * from it.
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
    packageType:
      identifier === '$rc_lifetime'
        ? 'LIFETIME'
        : identifier === '$rc_annual'
          ? 'ANNUAL'
          : 'MONTHLY',
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

const LIFETIME = pkg('$rc_lifetime', APPLE_PRODUCT_IDS.lifetime, {
  price: 19.99,
  priceString: '$19.99',
});

/** The legacy offering build 9 and earlier read as `current`: annual and monthly only. */
const LEGACY_CURRENT = {
  identifier: 'default',
  availablePackages: [ANNUAL, MONTHLY],
  annual: ANNUAL,
  monthly: MONTHLY,
  lifetime: null,
} as unknown as PurchasesOffering;

/**
 * The project's offerings: the `lifetime` offering this build sells from
 * (null to leave it out), beside the legacy current offering.
 */
function offerings(sold: Partial<PurchasesOffering> | null): PurchasesOfferings {
  const lifetime =
    sold === null
      ? null
      : ({
          identifier: REVENUECAT_OFFERING,
          availablePackages: [LIFETIME],
          lifetime: LIFETIME,
          annual: null,
          monthly: null,
          ...sold,
        } as PurchasesOffering);
  return {
    all: { default: LEGACY_CURRENT, ...(lifetime ? { [REVENUECAT_OFFERING]: lifetime } : {}) },
    current: LEGACY_CURRENT,
  };
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

/** What a lifetime purchase reads as: active, with no expiry — never an invented one. */
const ACTIVE_LIFETIME = {
  productId: APPLE_PRODUCT_IDS.lifetime,
  period: 'lifetime' as const,
  verifiedAt: REQUESTED,
  expiresAt: null,
};

const LIFETIME_ENTITLEMENT = {
  productIdentifier: APPLE_PRODUCT_IDS.lifetime,
  expirationDate: null,
  willRenew: false,
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
    purchase: async () =>
      ({ customerInfo: customerInfo(entitlement(LIFETIME_ENTITLEMENT)) }) as MakePurchaseResult,
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

test('the product ids: the new lifetime product and the two subscriptions earlier builds sold', () => {
  assert.deepEqual(APPLE_PRODUCT_IDS, {
    annual: 'com.willisyang.lotly.annual',
    monthly: 'com.willisyang.lotly.monthly',
    lifetime: 'com.willisyang.lotly.lifetime',
  });
  assert.equal(REVENUECAT_ENTITLEMENT, 'premium');
  assert.equal(REVENUECAT_OFFERING, 'lifetime');
});

test('an active lifetime purchase is active with NO expiry, dated by requestDate; an expiry the store gives it is kept', () => {
  assert.deepEqual(readingFromCustomerInfo(customerInfo(entitlement(LIFETIME_ENTITLEMENT))), {
    kind: 'active',
    entitlement: ACTIVE_LIFETIME,
  });
  const dated = entitlement({ ...LIFETIME_ENTITLEMENT, expirationDate: EXPIRES });
  assert.deepEqual(readingFromCustomerInfo(customerInfo(dated)), {
    kind: 'active',
    entitlement: { ...ACTIVE_LIFETIME, expiresAt: EXPIRES },
  });
  // A refunded or revoked lifetime purchase is no longer listed active: inactive.
  assert.deepEqual(readingFromCustomerInfo(customerInfo(null)), {
    kind: 'inactive',
    asOf: REQUESTED,
  });
  assert.deepEqual(
    readingFromCustomerInfo(
      customerInfo(entitlement({ ...LIFETIME_ENTITLEMENT, isActive: false })),
    ),
    { kind: 'inactive', asOf: REQUESTED },
  );
});

test('an earlier build’s active subscription still maps to its plan, product and expiry, dated by requestDate', () => {
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
    ['a subscription with no expiry', customerInfo(entitlement({ expirationDate: null }))],
    [
      'a monthly subscription with no expiry',
      customerInfo(
        entitlement({ productIdentifier: APPLE_PRODUCT_IDS.monthly, expirationDate: null }),
      ),
    ],
    [
      'a promotional grant of another product with no expiry',
      customerInfo(
        entitlement({ productIdentifier: 'rc_promo_premium_lifetime', expirationDate: null }),
      ),
    ],
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

test('the lifetime offering resolves its one package with the store price verbatim, never the current offering', () => {
  const mapped = offeringFromOfferings(offerings({}));
  assert.ok(mapped);
  assert.deepEqual(mapped.offering, {
    lifetime: {
      id: '$rc_lifetime',
      period: 'lifetime',
      price: { amount: 19.99, currencyCode: 'USD', formatted: '$19.99' },
    },
  });
  assert.equal(mapped.package, LIFETIME);
});

test('a localized price is passed through as the store rendered it', () => {
  const euro = offerings({
    lifetime: pkg('$rc_lifetime', APPLE_PRODUCT_IDS.lifetime, {
      price: 19.99,
      priceString: '19,99 €',
      currencyCode: 'EUR',
    }),
  });
  const mapped = offeringFromOfferings(euro);
  assert.equal(mapped?.offering.lifetime.price.formatted, '19,99 €');
  assert.equal(mapped?.offering.lifetime.price.currencyCode, 'EUR');
});

test('a missing or inconsistent lifetime offering is unavailable, never guessed or borrowed from the current offering', () => {
  const cases: [string, PurchasesOfferings | null][] = [
    // The legacy current offering alone: build 9's configuration, untouched.
    ['no lifetime offering', offerings(null)],
    ['no offerings at all', null],
    ['no lifetime package', offerings({ lifetime: null })],
    [
      'the lifetime package sells a subscription',
      offerings({ lifetime: pkg('$rc_lifetime', APPLE_PRODUCT_IDS.annual) }),
    ],
    [
      'no price string',
      offerings({
        lifetime: pkg('$rc_lifetime', APPLE_PRODUCT_IDS.lifetime, { priceString: '' }),
      }),
    ],
    [
      'zero price',
      offerings({ lifetime: pkg('$rc_lifetime', APPLE_PRODUCT_IDS.lifetime, { price: 0 }) }),
    ],
    [
      'no currency',
      offerings({
        lifetime: pkg('$rc_lifetime', APPLE_PRODUCT_IDS.lifetime, { currencyCode: '' }),
      }),
    ],
  ];
  for (const [label, value] of cases) {
    assert.equal(offeringFromOfferings(value), null, label);
  }
  // Even a lifetime package placed in the CURRENT offering is not read: this
  // build sells only from the offering it names.
  const inCurrent = {
    all: { default: { ...LEGACY_CURRENT, lifetime: LIFETIME } },
    current: { ...LEGACY_CURRENT, lifetime: LIFETIME },
  } as unknown as PurchasesOfferings;
  assert.equal(offeringFromOfferings(inCurrent), null);
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

test('loadOfferings answers ready with the lifetime package, unavailable when misconfigured, error when the store errs', async () => {
  const { sdk, provider } = adapter();
  const ready = await provider.loadOfferings();
  assert.equal(ready.kind, 'ready');
  sdk.offerings = async () => offerings(null);
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
  sdk.customerInfo = async () => customerInfo(entitlement(LIFETIME_ENTITLEMENT));
  assert.deepEqual(await provider.readEntitlement(), {
    kind: 'active',
    entitlement: ACTIVE_LIFETIME,
  });
  sdk.customerInfo = async () => {
    throw sdkError('35');
  };
  assert.deepEqual(await provider.readEntitlement(), { kind: 'unavailable' });
});

test('purchase buys the ACTUAL resolved lifetime package and succeeds with no expiry only on an active premium', async () => {
  const { sdk, provider } = adapter();
  const ready = await provider.loadOfferings();
  assert.equal(ready.kind, 'ready');
  if (ready.kind !== 'ready') return;
  assert.deepEqual(await provider.purchase(ready.offering.lifetime), {
    kind: 'success',
    entitlement: ACTIVE_LIFETIME,
  });
  assert.deepEqual(sdk.purchased, [LIFETIME]);
});

test('a purchase that resolves without an active premium entitlement is not success', async () => {
  const { sdk, provider } = adapter();
  const ready = await provider.loadOfferings();
  if (ready.kind !== 'ready') throw new Error('offering');
  sdk.purchase = async () => ({ customerInfo: customerInfo(null) }) as MakePurchaseResult;
  assert.deepEqual(await provider.purchase(ready.offering.lifetime), { kind: 'error' });
  sdk.purchase = async () =>
    ({
      customerInfo: customerInfo(entitlement(LIFETIME_ENTITLEMENT), 'never'),
    }) as MakePurchaseResult;
  assert.deepEqual(await provider.purchase(ready.offering.lifetime), { kind: 'error' });
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
    assert.deepEqual(await provider.purchase(ready.offering.lifetime), { kind });
  }
});

test('a package the offering no longer resolves is re-resolved from the store, and unavailable if still absent', async () => {
  const { sdk, provider } = adapter();
  // Never loaded through this adapter: the package is fetched on demand.
  const outcome = await provider.purchase({
    id: '$rc_lifetime',
    period: 'lifetime',
    price: { amount: 19.99, currencyCode: 'USD', formatted: '$19.99' },
  });
  assert.equal(outcome.kind, 'success');
  assert.equal(sdk.purchased[0]?.identifier, '$rc_lifetime');
  // A stale package id the store does not sell any more.
  assert.deepEqual(
    await provider.purchase({
      id: '$rc_old_lifetime',
      period: 'lifetime',
      price: { amount: 1, currencyCode: 'USD', formatted: '$1' },
    }),
    { kind: 'unavailable' },
  );
  // Nor is a subscription package ever bought, even one the current offering holds.
  assert.deepEqual(
    await provider.purchase({
      id: '$rc_annual',
      period: 'annual',
      price: { amount: 29.99, currencyCode: 'USD', formatted: '$29.99' },
    }),
    { kind: 'unavailable' },
  );
  assert.equal(
    sdk.purchased.length,
    1,
    'no purchase was attempted for the stale or legacy package',
  );
});

test('restore: active premium restores it; none means nothing to restore; undatable or failed is unavailable or error', async () => {
  const { sdk, provider } = adapter();
  sdk.restore = async () => customerInfo(entitlement(LIFETIME_ENTITLEMENT));
  assert.deepEqual(await provider.restore(), { kind: 'restored', entitlement: ACTIVE_LIFETIME });
  // An earlier build's subscriber is restored too, never asked to pay again.
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
      id: '$rc_lifetime',
      period: 'lifetime',
      price: { amount: 19.99, currencyCode: 'USD', formatted: '$19.99' },
    });
    if (result.kind === 'success') await s.session.apply(result.entitlement);
    return result;
  });
  assert.equal(outcome.kind, 'success');
  release(customerInfo(null, EARLIER_REQUEST));
  assert.equal(await refresh, null);
  assert.deepEqual(s.statuses, []);
  assert.deepEqual(s.cache(), ACTIVE_LIFETIME);
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

test('a lifetime purchase survives a store outage on its cache, and a verified refund or revocation ends it', async () => {
  const sdk = fakeSdk();
  const s = sessionOver(sdk);
  await s.session.apply(ACTIVE_LIFETIME);
  // The store is unreachable: the cached lifetime access, with no expiry to
  // lapse, keeps the app open.
  sdk.customerInfo = async () => {
    throw sdkError('35');
  };
  assert.deepEqual(await s.session.read(), {
    kind: 'active',
    entitlement: ACTIVE_LIFETIME,
    confirmation: 'cached',
  });
  // Fresh customer info without the entitlement (Apple refunded it, or
  // RevenueCat revoked it): a real, verified end, and the cache is cleared.
  sdk.customerInfo = async () => customerInfo(null, '2026-10-04T15:00:20.000Z');
  assert.deepEqual(await s.session.read(), { kind: 'inactive', reason: 'verified' });
  assert.equal(s.cache(), null);
});
