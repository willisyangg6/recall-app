/**
 * The RevenueCat adapter (P2B7X.2, 2026-10-04): the real store behind the
 * typed purchase boundary (purchase-provider.ts), written against a small
 * SDK interface so the mapping and the ordering are provable in Node with a
 * fake SDK. The native wiring that binds the real `react-native-purchases`
 * module, the platform and the public key is revenuecat-provider.ts; this
 * file imports no native code.
 *
 * ## What the store is configured as (founder setup, 2026-10-04)
 *
 *   entitlement   `premium`, attached to both Apple products
 *   offering      the CURRENT offering, expected to be `default`
 *   packages      `$rc_annual` → com.willisyang.lotly.annual
 *                 `$rc_monthly` → com.willisyang.lotly.monthly
 *
 * The adapter VALIDATES that configuration on every read: an offering that
 * lacks either built-in package, a package whose product is not the expected
 * Apple product, or a product without a usable localized price is
 * `unavailable` — never a guess, never a price typed here.
 *
 * ## Fail closed, dated by the store
 *
 * Every reading is dated by `CustomerInfo.requestDate`, the instant the
 * store last served that customer info — `verifiedAt` for an active
 * entitlement and `asOf` for an inactive one. NEVER `Date.now()`: the SDK
 * answers from a cache minutes old, and dating a cached answer with the
 * device clock would turn pre-purchase data into a fresh revocation
 * (lib/entitlement.ts `reconcileReading`). A customer info whose request
 * date, product or expiry cannot be read is `unavailable`. An active premium
 * entitlement for these subscription products always carries an expiry; one
 * without is not trusted — nothing here grants lifetime access.
 *
 * A resolved SDK call is not proof of access: a purchase or restore succeeds
 * only when the customer info it returns holds an active, valid `premium`
 * entitlement.
 *
 * ## Configure once
 *
 * `configure` runs lazily, on the first call that needs the store, and
 * concurrent callers share the one in-flight promise so the SDK is never
 * configured twice. A failed configuration is forgotten so the next call
 * can try again.
 */

import type {
  CustomerInfo,
  MakePurchaseResult,
  PurchasesOfferings,
  PurchasesPackage,
} from 'react-native-purchases';

import type { ActiveEntitlement, EntitlementReading, PlanPeriod } from '../entitlement';
import type {
  Offering,
  OfferingsResult,
  PlanPackage,
  PurchaseIdentity,
  PurchaseOutcome,
  PurchaseProvider,
  RestoreOutcome,
  StorePrice,
} from './purchase-provider';

export const REVENUECAT_ENTITLEMENT = 'premium';
export const REVENUECAT_OFFERING = 'default';
export const APPLE_PRODUCT_IDS: Readonly<Record<PlanPeriod, string>> = {
  annual: 'com.willisyang.lotly.annual',
  monthly: 'com.willisyang.lotly.monthly',
};

/** The subset of the SDK the adapter uses, so a test can stand in for it. */
export interface RevenueCatSdk {
  configure(configuration: { apiKey: string; appUserID: string }): void;
  getCustomerInfo(): Promise<CustomerInfo>;
  getOfferings(): Promise<PurchasesOfferings>;
  purchasePackage(pkg: PurchasesPackage): Promise<MakePurchaseResult>;
  restorePurchases(): Promise<CustomerInfo>;
}

export interface RevenueCatAdapterDeps {
  sdk: RevenueCatSdk;
  apiKey: string;
  identity: PurchaseIdentity;
}

/**
 * The store could not be configured (no identity, or the SDK refused). Carries
 * the SDK's CONFIGURATION_ERROR code so it classifies as `unavailable`.
 */
class ConfigurationFailure extends Error {
  readonly code = '23';
  constructor(cause: unknown) {
    super('RevenueCat could not be configured', { cause });
  }
}

// ── Pure mapping ────────────────────────────────────────────────────────────

function periodForProduct(productId: string): PlanPeriod | null {
  if (productId === APPLE_PRODUCT_IDS.annual) return 'annual';
  if (productId === APPLE_PRODUCT_IDS.monthly) return 'monthly';
  return null;
}

function isoInstant(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) return null;
  return new Date(millis).toISOString();
}

/**
 * The reading a customer info amounts to. Undatable, or active for a product
 * or without the expiry these products always carry: `unavailable`.
 */
export function readingFromCustomerInfo(info: CustomerInfo | null | undefined): EntitlementReading {
  if (typeof info !== 'object' || info === null) return { kind: 'unavailable' };
  const requestDate = isoInstant(info.requestDate);
  if (requestDate === null) return { kind: 'unavailable' };
  const active = info.entitlements?.active?.[REVENUECAT_ENTITLEMENT];
  if (active === undefined || active === null) return { kind: 'inactive', asOf: requestDate };
  if (active.isActive !== true) return { kind: 'inactive', asOf: requestDate };
  const period = periodForProduct(active.productIdentifier);
  if (period === null) return { kind: 'unavailable' };
  const expiresAt = isoInstant(active.expirationDate);
  if (expiresAt === null) return { kind: 'unavailable' };
  const entitlement: ActiveEntitlement = {
    productId: active.productIdentifier,
    period,
    verifiedAt: requestDate,
    expiresAt,
  };
  return { kind: 'active', entitlement };
}

function storePrice(pkg: PurchasesPackage): StorePrice | null {
  const product = pkg.product;
  if (typeof product !== 'object' || product === null) return null;
  const { price, priceString, currencyCode } = product;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  if (typeof priceString !== 'string' || priceString.trim().length === 0) return null;
  if (typeof currencyCode !== 'string' || currencyCode.trim().length === 0) return null;
  return { amount: price, currencyCode, formatted: priceString };
}

function planPackage(
  pkg: PurchasesPackage | null | undefined,
  period: PlanPeriod,
): PlanPackage | null {
  if (typeof pkg !== 'object' || pkg === null) return null;
  if (pkg.product?.identifier !== APPLE_PRODUCT_IDS[period]) return null;
  if (typeof pkg.identifier !== 'string' || pkg.identifier.length === 0) return null;
  const price = storePrice(pkg);
  if (price === null) return null;
  return { id: pkg.identifier, period, price };
}

/** The current offering as the paywall's two packages, or null when misconfigured. */
export function offeringFromOfferings(
  offerings: PurchasesOfferings | null | undefined,
): { offering: Offering; packages: Record<PlanPeriod, PurchasesPackage> } | null {
  const current = offerings?.current;
  if (typeof current !== 'object' || current === null) return null;
  const annual = planPackage(current.annual, 'annual');
  const monthly = planPackage(current.monthly, 'monthly');
  if (annual === null || monthly === null) return null;
  return {
    offering: { annual, monthly },
    packages: {
      annual: current.annual as PurchasesPackage,
      monthly: current.monthly as PurchasesPackage,
    },
  };
}

/**
 * How an SDK rejection is classified. The SDK rejects with a PurchasesError
 * (`code`, `userCancelled`), but a thrown value is never trusted to be one.
 */
export type SdkFailure = 'cancelled' | 'unavailable' | 'error';

/** Error codes that mean the store could not be reached or is not set up. */
const UNAVAILABLE_CODES = new Set([
  '2', // STORE_PROBLEM_ERROR
  '10', // NETWORK_ERROR
  '11', // INVALID_CREDENTIALS_ERROR
  '17', // INVALID_APPLE_SUBSCRIPTION_KEY_ERROR
  '23', // CONFIGURATION_ERROR
  '24', // UNSUPPORTED_ERROR
  '33', // API_ENDPOINT_BLOCKED
  '35', // OFFLINE_CONNECTION_ERROR
]);

export function classifySdkFailure(error: unknown): SdkFailure {
  if (typeof error !== 'object' || error === null) return 'error';
  const value = error as { userCancelled?: unknown; code?: unknown };
  if (value.userCancelled === true) return 'cancelled';
  const code = typeof value.code === 'string' ? value.code : String(value.code ?? '');
  if (code === '1') return 'cancelled'; // PURCHASE_CANCELLED_ERROR
  if (UNAVAILABLE_CODES.has(code)) return 'unavailable';
  return 'error';
}

// ── The adapter ─────────────────────────────────────────────────────────────

export function createRevenueCatAdapter(deps: RevenueCatAdapterDeps): PurchaseProvider {
  let configuring: Promise<void> | null = null;
  let resolvedPackages: Record<PlanPeriod, PurchasesPackage> | null = null;

  /** Configure once; concurrent callers share the attempt, a failure is retried next time. */
  const ensureConfigured = (): Promise<void> => {
    if (configuring === null) {
      configuring = (async () => {
        const appUserID = await deps.identity.appUserId();
        if (typeof appUserID !== 'string' || appUserID.length === 0) {
          throw new Error('no purchase identity');
        }
        deps.sdk.configure({ apiKey: deps.apiKey, appUserID });
      })().catch((error: unknown) => {
        configuring = null;
        throw new ConfigurationFailure(error);
      });
    }
    return configuring;
  };

  const loadPackages = async (): Promise<Record<PlanPeriod, PurchasesPackage> | null> => {
    const mapped = offeringFromOfferings(await deps.sdk.getOfferings());
    resolvedPackages = mapped?.packages ?? null;
    return resolvedPackages;
  };

  return {
    id: 'revenuecat',

    async loadOfferings(): Promise<OfferingsResult> {
      try {
        await ensureConfigured();
        const mapped = offeringFromOfferings(await deps.sdk.getOfferings());
        if (mapped === null) return { kind: 'unavailable' };
        resolvedPackages = mapped.packages;
        return { kind: 'ready', offering: mapped.offering };
      } catch (error) {
        return classifySdkFailure(error) === 'unavailable'
          ? { kind: 'unavailable' }
          : { kind: 'error' };
      }
    },

    async readEntitlement(): Promise<EntitlementReading> {
      try {
        await ensureConfigured();
        return readingFromCustomerInfo(await deps.sdk.getCustomerInfo());
      } catch {
        return { kind: 'unavailable' };
      }
    },

    async purchase(pkg: PlanPackage): Promise<PurchaseOutcome> {
      try {
        await ensureConfigured();
        // The ACTUAL store package the offering resolved, never one rebuilt
        // from the plan; re-resolved when the paywall's offering predates
        // this adapter instance.
        let packages = resolvedPackages;
        if (packages === null || packages[pkg.period].identifier !== pkg.id) {
          packages = await loadPackages();
        }
        if (packages === null || packages[pkg.period].identifier !== pkg.id) {
          return { kind: 'unavailable' };
        }
        const result = await deps.sdk.purchasePackage(packages[pkg.period]);
        const reading = readingFromCustomerInfo(result?.customerInfo);
        if (reading.kind === 'active') return { kind: 'success', entitlement: reading.entitlement };
        // The sheet completed but the store does not show an active premium
        // entitlement: not access. Recoverable — Restore settles it later.
        return { kind: 'error' };
      } catch (error) {
        const failure = classifySdkFailure(error);
        return failure === 'cancelled'
          ? { kind: 'cancelled' }
          : failure === 'unavailable'
            ? { kind: 'unavailable' }
            : { kind: 'error' };
      }
    },

    async restore(): Promise<RestoreOutcome> {
      try {
        await ensureConfigured();
        const reading = readingFromCustomerInfo(await deps.sdk.restorePurchases());
        if (reading.kind === 'active')
          return { kind: 'restored', entitlement: reading.entitlement };
        if (reading.kind === 'inactive') return { kind: 'nothing_to_restore' };
        return { kind: 'unavailable' };
      } catch (error) {
        return classifySdkFailure(error) === 'unavailable'
          ? { kind: 'unavailable' }
          : { kind: 'error' };
      }
    },
  };
}
