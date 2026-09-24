/**
 * The purchase boundary (P2B7X.1): the one typed interface the paywall, the
 * access gate and the notification education stand on, written so the real
 * store integration (RevenueCat, P2B7X.2) is an adapter beneath it and
 * nothing above it changes.
 *
 * ## What a provider does
 *
 *   loadOfferings     the two packages the store is selling, with the
 *                     STORE'S OWN localized price strings — Lotly never
 *                     writes a price into product code
 *   readEntitlement   whether this device is entitled right now; a provider
 *                     that cannot answer says so (`unavailable`) rather than
 *                     guessing either way
 *   purchase          buy one package; the four outcomes are kept apart so
 *                     the paywall can be calm about a cancellation, honest
 *                     about a recoverable error, and explicit when the store
 *                     is unreachable
 *   restore           find a purchase already made on this store account
 *
 * ## Identity
 *
 * The anonymous purchase identity is the EXISTING installation id
 * (lib/installation-id.ts) — no account, no sign-in. A provider is
 * constructed with `appUserId`, which resolves it lazily so the identity is
 * minted only when a purchase surface actually needs one (reading an
 * offering does not). The RevenueCat adapter will hand it to `logIn`.
 *
 * ## Fail closed
 *
 * `unconfiguredPurchaseProvider` is what a release build runs when no real
 * provider has been configured: every offering is unavailable, every
 * reading is unavailable, every purchase and restore is unavailable. Nothing
 * here can grant access, and the gate treats `unavailable` with no verified
 * cache as inactive (lib/entitlement.ts).
 *
 * A leaf: types and one inert implementation. No I/O.
 */

import type { ActiveEntitlement, EntitlementReading, PlanPeriod } from '../entitlement';

export type { ActiveEntitlement, EntitlementReading, PlanPeriod };

/** A price exactly as the store supplied it. */
export interface StorePrice {
  /** The numeric amount in the store's currency, for arithmetic only. */
  amount: number;
  /** ISO 4217 code, e.g. `USD`. */
  currencyCode: string;
  /** The store's own localized rendering, e.g. `$29.99`. Displayed verbatim. */
  formatted: string;
}

export interface PlanPackage {
  /** The store's package/product identifier. */
  id: string;
  period: PlanPeriod;
  price: StorePrice;
}

/** The current offering: exactly one annual and one monthly package. */
export interface Offering {
  annual: PlanPackage;
  monthly: PlanPackage;
}

export type OfferingsResult =
  | { kind: 'ready'; offering: Offering }
  /** No provider, or the store could not be reached. */
  | { kind: 'unavailable' }
  /** The store answered with an error the shopper can retry. */
  | { kind: 'error' };

export type PurchaseOutcome =
  | { kind: 'success'; entitlement: ActiveEntitlement }
  /** The shopper dismissed the store sheet. Nothing changed. */
  | { kind: 'cancelled' }
  /** A recoverable failure (payment declined, network). Nothing changed. */
  | { kind: 'error' }
  /** No provider, or the store is unreachable. */
  | { kind: 'unavailable' };

export type RestoreOutcome =
  | { kind: 'restored'; entitlement: ActiveEntitlement }
  /** The store account holds no Lotly subscription. */
  | { kind: 'nothing_to_restore' }
  | { kind: 'error' }
  | { kind: 'unavailable' };

export type PurchaseProviderId = 'unconfigured' | 'development' | 'revenuecat';

export interface PurchaseProvider {
  readonly id: PurchaseProviderId;
  loadOfferings(): Promise<OfferingsResult>;
  readEntitlement(): Promise<EntitlementReading>;
  purchase(pkg: PlanPackage): Promise<PurchaseOutcome>;
  restore(): Promise<RestoreOutcome>;
}

export interface PurchaseIdentity {
  /** The anonymous app-user id: the installation id, resolved lazily. */
  appUserId: () => Promise<string>;
}

/** The release build's provider until a real one is configured: fails closed. */
export function unconfiguredPurchaseProvider(): PurchaseProvider {
  return {
    id: 'unconfigured',
    loadOfferings: async () => ({ kind: 'unavailable' }),
    readEntitlement: async () => ({ kind: 'unavailable' }),
    purchase: async () => ({ kind: 'unavailable' }),
    restore: async () => ({ kind: 'unavailable' }),
  };
}

/** How many monthly payments one annual term replaces. */
export const MONTHS_PER_YEAR = 12;

/**
 * The saving an annual package offers against twelve monthly payments, as a
 * whole percentage, computed from the STORE'S prices — never a number typed
 * into product code. Null when the two prices cannot be compared: different
 * currencies, a non-positive monthly price, or an annual price that saves
 * nothing.
 */
export function annualSavingsPercent(offering: Offering): number | null {
  const { annual, monthly } = offering;
  if (annual.price.currencyCode !== monthly.price.currencyCode) return null;
  if (!(monthly.price.amount > 0) || !(annual.price.amount > 0)) return null;
  const yearOfMonthly = monthly.price.amount * MONTHS_PER_YEAR;
  if (annual.price.amount >= yearOfMonthly) return null;
  return Math.round(((yearOfMonthly - annual.price.amount) / yearOfMonthly) * 100);
}

/** The annual price spread over twelve months, in the store's currency. */
export function monthlyEquivalentAmount(annual: PlanPackage): number | null {
  if (!(annual.price.amount > 0)) return null;
  return annual.price.amount / MONTHS_PER_YEAR;
}
