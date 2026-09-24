/**
 * The DEVELOPMENT purchase adapter (P2B7X.1) — a fake store for the
 * Simulator and the Design Preview, and nothing else.
 *
 * ## What it simulates
 *
 * A store ACCOUNT (whether a simulated subscription exists, persisted so a
 * relaunch behaves like a real subscriber's) and a SCENARIO (what the next
 * operations do), chosen from the ten presets the brief names. The presets
 * are data: each one fixes the offering's availability, what a purchase
 * returns, what a restore returns, and whether the store can be reached.
 *
 * ## Containment
 *
 * 1. Every method re-checks `isDevelopment()` and answers `unavailable` when
 *    it is not a development build, so even a constructed instance is inert
 *    in a release binary.
 * 2. The module is reached from exactly two places — the provider resolver
 *    (inside a `__DEV__` branch that Metro folds away in a release bundle)
 *    and the Design Preview hub (development-only) — pinned by test.
 * 3. Its persisted state lives under its own dev-only storage key, which
 *    production code never reads.
 *
 * The prices here are FIXTURES ($29.99/year, $4.99/month, the expected US
 * product prices). They are the only US dollar amounts in the client and
 * they exist so the paywall can be rendered; production prices come from
 * the store through the real adapter.
 *
 * Pure: storage and the clock are injected, so the whole scenario matrix is
 * driven in Node. The native wiring is development-provider.ts.
 */

import type { ActiveEntitlement, EntitlementReading } from '../entitlement';
import type {
  Offering,
  OfferingsResult,
  PlanPackage,
  PlanPeriod,
  PurchaseOutcome,
  PurchaseProvider,
  RestoreOutcome,
} from './purchase-provider';

// ── Scenarios ───────────────────────────────────────────────────────────────

export type DevelopmentPurchaseScenarioId =
  | 'inactive'
  | 'loading'
  | 'annual_purchase_success'
  | 'monthly_purchase_success'
  | 'user_cancelled'
  | 'purchase_error'
  | 'restore_success'
  | 'restore_nothing'
  | 'unavailable_cached_active'
  | 'unavailable_unverified';

export interface DevelopmentPurchaseScenario {
  id: DevelopmentPurchaseScenarioId;
  title: string;
  /** What the founder should see on the paywall or at the gate. */
  expectation: string;
  /** Whether the store can be reached at all. */
  available: boolean;
  /** `pending` never resolves, which is what a loading paywall looks like. */
  offerings: 'ready' | 'pending' | 'error';
  purchase: 'success' | 'cancelled' | 'error';
  restore: 'found' | 'nothing' | 'error';
  /** The plan the paywall preselects for this scenario. */
  initialPlan: PlanPeriod;
}

export const DEVELOPMENT_PURCHASE_SCENARIOS: readonly DevelopmentPurchaseScenario[] = [
  {
    id: 'inactive',
    title: 'Inactive',
    expectation:
      'No subscription on the simulated account. The paywall shows both plans with Annual ' +
      'preselected; subscribing succeeds.',
    available: true,
    offerings: 'ready',
    purchase: 'success',
    restore: 'nothing',
    initialPlan: 'annual',
  },
  {
    id: 'loading',
    title: 'Loading',
    expectation:
      'The offering never arrives: the paywall stays in its loading state with the ' +
      'subscribe action unavailable and Restore, Terms, Privacy and Support still present.',
    available: true,
    offerings: 'pending',
    purchase: 'success',
    restore: 'nothing',
    initialPlan: 'annual',
  },
  {
    id: 'annual_purchase_success',
    title: 'Annual purchase success',
    expectation:
      'Annual preselected. Subscribe shows the in-progress state, then succeeds: the gate ' +
      'moves to notification education (or straight to Feed once educated).',
    available: true,
    offerings: 'ready',
    purchase: 'success',
    restore: 'nothing',
    initialPlan: 'annual',
  },
  {
    id: 'monthly_purchase_success',
    title: 'Monthly purchase success',
    expectation: 'Monthly preselected; the same success path with the monthly package.',
    available: true,
    offerings: 'ready',
    purchase: 'success',
    restore: 'nothing',
    initialPlan: 'monthly',
  },
  {
    id: 'user_cancelled',
    title: 'User cancellation',
    expectation:
      'Subscribe is dismissed the way a shopper cancels the store sheet: a calm inline ' +
      'sentence, both plans still selectable, nothing else changes.',
    available: true,
    offerings: 'ready',
    purchase: 'cancelled',
    restore: 'nothing',
    initialPlan: 'annual',
  },
  {
    id: 'purchase_error',
    title: 'Purchase error',
    expectation:
      'Subscribe fails recoverably: the error sentence renders beneath the action and the ' +
      'shopper can try again.',
    available: true,
    offerings: 'ready',
    purchase: 'error',
    restore: 'nothing',
    initialPlan: 'annual',
  },
  {
    id: 'restore_success',
    title: 'Restore success',
    expectation:
      'Restore Purchases finds an annual subscription on the simulated account: the ' +
      'restored sentence, then the gate moves on exactly as a purchase would.',
    available: true,
    offerings: 'ready',
    purchase: 'success',
    restore: 'found',
    initialPlan: 'annual',
  },
  {
    id: 'restore_nothing',
    title: 'Restore finds nothing',
    expectation: 'Restore Purchases finds no subscription: the honest sentence, still inactive.',
    available: true,
    offerings: 'ready',
    purchase: 'success',
    restore: 'nothing',
    initialPlan: 'annual',
  },
  {
    id: 'unavailable_cached_active',
    title: 'Temporarily unavailable, cached active entitlement',
    expectation:
      'The store cannot be reached. Make a simulated purchase first, then apply this: the ' +
      'cached verified entitlement keeps the app open (no paywall).',
    available: false,
    offerings: 'ready',
    purchase: 'success',
    restore: 'nothing',
    initialPlan: 'annual',
  },
  {
    id: 'unavailable_unverified',
    title: 'Unavailable, no prior entitlement',
    expectation:
      'The store cannot be reached and nothing was ever verified: the paywall shows the ' +
      'could-not-confirm state and fails closed; Subscribe and Restore report unavailable.',
    available: false,
    offerings: 'ready',
    purchase: 'success',
    restore: 'nothing',
    initialPlan: 'annual',
  },
];

export function developmentScenario(id: string): DevelopmentPurchaseScenario | null {
  return DEVELOPMENT_PURCHASE_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

// ── The fixture offering ────────────────────────────────────────────────────

/** The store's expected US prices, as fixtures for development only. */
export const DEVELOPMENT_OFFERING: Offering = {
  annual: {
    id: 'lotly_annual',
    period: 'annual',
    price: { amount: 29.99, currencyCode: 'USD', formatted: '$29.99' },
  },
  monthly: {
    id: 'lotly_monthly',
    period: 'monthly',
    price: { amount: 4.99, currencyCode: 'USD', formatted: '$4.99' },
  },
};

/**
 * A long localized price pair for the Design Preview: what the paywall has
 * to survive when a store renders a wide currency string. Not a real price.
 */
export const LONG_PRICE_OFFERING: Offering = {
  annual: {
    id: 'lotly_annual',
    period: 'annual',
    price: { amount: 499000, currencyCode: 'IDR', formatted: 'Rp 499.000,00' },
  },
  monthly: {
    id: 'lotly_monthly',
    period: 'monthly',
    price: { amount: 79000, currencyCode: 'IDR', formatted: 'Rp 79.000,00' },
  },
};

// ── The simulated store account ─────────────────────────────────────────────

export interface SimulatedSubscription {
  period: PlanPeriod;
  purchasedAt: string;
}

/** The injected persistence for the simulated account. */
export interface DevelopmentPurchaseStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

export function parseSimulatedSubscription(raw: string | null): SimulatedSubscription | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { period?: unknown; purchasedAt?: unknown };
    if (
      (value.period === 'annual' || value.period === 'monthly') &&
      typeof value.purchasedAt === 'string'
    ) {
      return { period: value.period, purchasedAt: value.purchasedAt };
    }
  } catch {
    // Fall through: an unreadable value is no subscription.
  }
  return null;
}

/** One simulated year or month of access from the purchase instant. */
export function simulatedExpiry(purchasedAtIso: string, period: PlanPeriod): string {
  const at = new Date(purchasedAtIso);
  if (period === 'annual') at.setUTCFullYear(at.getUTCFullYear() + 1);
  else at.setUTCMonth(at.getUTCMonth() + 1);
  return at.toISOString();
}

function entitlementFor(
  subscription: SimulatedSubscription,
  verifiedAt: string,
): ActiveEntitlement {
  return {
    productId: subscription.period === 'annual' ? 'lotly_annual' : 'lotly_monthly',
    period: subscription.period,
    verifiedAt,
    expiresAt: simulatedExpiry(subscription.purchasedAt, subscription.period),
  };
}

export interface DevelopmentProviderDeps {
  storage: DevelopmentPurchaseStorage;
  /** Re-checked on EVERY call: the adapter is inert outside a development build. */
  isDevelopment: () => boolean;
  now: () => string;
  /** The active scenario, read on every call so the founder can switch live. */
  scenario: () => DevelopmentPurchaseScenarioId;
}

/** A promise that never settles: the `loading` scenario's offering. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

export function createDevelopmentPurchaseProvider(deps: DevelopmentProviderDeps): PurchaseProvider {
  const current = () => developmentScenario(deps.scenario()) ?? DEVELOPMENT_PURCHASE_SCENARIOS[0];
  const readSubscription = async () => parseSimulatedSubscription(await deps.storage.read());

  return {
    id: 'development',

    async loadOfferings(): Promise<OfferingsResult> {
      if (!deps.isDevelopment()) return { kind: 'unavailable' };
      const scenario = current();
      if (!scenario.available) return { kind: 'unavailable' };
      if (scenario.offerings === 'pending') return pending();
      if (scenario.offerings === 'error') return { kind: 'error' };
      return { kind: 'ready', offering: DEVELOPMENT_OFFERING };
    },

    async readEntitlement(): Promise<EntitlementReading> {
      if (!deps.isDevelopment()) return { kind: 'unavailable' };
      if (!current().available) return { kind: 'unavailable' };
      const subscription = await readSubscription();
      return subscription === null
        ? { kind: 'inactive' }
        : { kind: 'active', entitlement: entitlementFor(subscription, deps.now()) };
    },

    async purchase(pkg: PlanPackage): Promise<PurchaseOutcome> {
      if (!deps.isDevelopment()) return { kind: 'unavailable' };
      const scenario = current();
      if (!scenario.available) return { kind: 'unavailable' };
      if (scenario.purchase === 'cancelled') return { kind: 'cancelled' };
      if (scenario.purchase === 'error') return { kind: 'error' };
      const subscription: SimulatedSubscription = { period: pkg.period, purchasedAt: deps.now() };
      await deps.storage.write(JSON.stringify(subscription));
      return { kind: 'success', entitlement: entitlementFor(subscription, deps.now()) };
    },

    async restore(): Promise<RestoreOutcome> {
      if (!deps.isDevelopment()) return { kind: 'unavailable' };
      const scenario = current();
      if (!scenario.available) return { kind: 'unavailable' };
      if (scenario.restore === 'error') return { kind: 'error' };
      const existing = await readSubscription();
      if (existing !== null) {
        return { kind: 'restored', entitlement: entitlementFor(existing, deps.now()) };
      }
      if (scenario.restore === 'nothing') return { kind: 'nothing_to_restore' };
      // `found`: the simulated account already held an annual subscription.
      const subscription: SimulatedSubscription = { period: 'annual', purchasedAt: deps.now() };
      await deps.storage.write(JSON.stringify(subscription));
      return { kind: 'restored', entitlement: entitlementFor(subscription, deps.now()) };
    },
  };
}

/** Forget the simulated subscription (a development control). */
export async function clearSimulatedSubscription(
  storage: DevelopmentPurchaseStorage,
): Promise<void> {
  await storage.remove();
}

/** Grant a simulated subscription without a purchase (a development control). */
export async function seedSimulatedSubscription(
  storage: DevelopmentPurchaseStorage,
  period: PlanPeriod,
  nowIso: string,
): Promise<void> {
  const subscription: SimulatedSubscription = { period, purchasedAt: nowIso };
  await storage.write(JSON.stringify(subscription));
}

// ── The live scenario ───────────────────────────────────────────────────────

/**
 * In memory and nowhere else: the scenario the founder armed. Reloading the
 * app returns to `inactive` — the simulated ACCOUNT persists, the scenario
 * does not, so a relaunch after a simulated purchase behaves like a real
 * subscriber's relaunch rather than replaying a cancellation.
 */
let liveScenario: DevelopmentPurchaseScenarioId = 'inactive';

export function developmentPurchaseScenario(): DevelopmentPurchaseScenarioId {
  return liveScenario;
}

export function setDevelopmentPurchaseScenario(id: DevelopmentPurchaseScenarioId): void {
  liveScenario = id;
}
