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
 * The price here is a FIXTURE ($19.99, the proposed US lifetime price,
 * 2026-11-06). It is the only US dollar amount in the client and it exists
 * so the paywall can be rendered; the production price comes from the store
 * through the real adapter. The simulated account can also hold an annual
 * or monthly subscription, as a customer of an earlier build would, so a
 * legacy subscriber's access can be walked without a store.
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
  | 'purchase_success'
  | 'user_cancelled'
  | 'purchase_error'
  | 'restore_lifetime'
  | 'restore_subscription'
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
  /** `found` restores what the simulated account holds, or `restoredPeriod` when it holds nothing. */
  restore: 'found' | 'nothing' | 'error';
  /** What a `found` restore finds on an empty simulated account. */
  restoredPeriod: PlanPeriod;
}

export const DEVELOPMENT_PURCHASE_SCENARIOS: readonly DevelopmentPurchaseScenario[] = [
  {
    id: 'inactive',
    title: 'Inactive',
    expectation:
      'No purchase on the simulated account. The paywall shows lifetime access at the fixture ' +
      'price; buying succeeds.',
    available: true,
    offerings: 'ready',
    purchase: 'success',
    restore: 'nothing',
    restoredPeriod: 'lifetime',
  },
  {
    id: 'loading',
    title: 'Loading',
    expectation:
      'The offering never arrives: the paywall stays in its loading state with the purchase ' +
      'action unavailable and Restore, Terms, Privacy and Support still present.',
    available: true,
    offerings: 'pending',
    purchase: 'success',
    restore: 'nothing',
    restoredPeriod: 'lifetime',
  },
  {
    id: 'purchase_success',
    title: 'Lifetime purchase success',
    expectation:
      'Get lifetime access shows the in-progress state, then succeeds with no expiry: the gate ' +
      'moves to notification education (or straight to Feed once educated).',
    available: true,
    offerings: 'ready',
    purchase: 'success',
    restore: 'nothing',
    restoredPeriod: 'lifetime',
  },
  {
    id: 'user_cancelled',
    title: 'User cancellation',
    expectation:
      'The purchase is dismissed the way a shopper cancels the store sheet: a calm inline ' +
      'sentence, the action still available, nothing else changes.',
    available: true,
    offerings: 'ready',
    purchase: 'cancelled',
    restore: 'nothing',
    restoredPeriod: 'lifetime',
  },
  {
    id: 'purchase_error',
    title: 'Purchase error',
    expectation:
      'The purchase fails recoverably: the error sentence renders above the action and the ' +
      'shopper can try again.',
    available: true,
    offerings: 'ready',
    purchase: 'error',
    restore: 'nothing',
    restoredPeriod: 'lifetime',
  },
  {
    id: 'restore_lifetime',
    title: 'Restore lifetime access',
    expectation:
      'Restore Purchases finds a lifetime purchase on the simulated account: the restored ' +
      'sentence, then the gate moves on exactly as a purchase would.',
    available: true,
    offerings: 'ready',
    purchase: 'success',
    restore: 'found',
    restoredPeriod: 'lifetime',
  },
  {
    id: 'restore_subscription',
    title: 'Restore an earlier subscription',
    expectation:
      'Restore Purchases finds an annual subscription bought in an earlier build: it unlocks ' +
      'Lotly with its expiry, and the shopper is not asked to pay again.',
    available: true,
    offerings: 'ready',
    purchase: 'success',
    restore: 'found',
    restoredPeriod: 'annual',
  },
  {
    id: 'restore_nothing',
    title: 'Restore finds nothing',
    expectation: 'Restore Purchases finds no purchase: the honest sentence, still inactive.',
    available: true,
    offerings: 'ready',
    purchase: 'success',
    restore: 'nothing',
    restoredPeriod: 'lifetime',
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
    restoredPeriod: 'lifetime',
  },
  {
    id: 'unavailable_unverified',
    title: 'Unavailable, no prior entitlement',
    expectation:
      'The store cannot be reached and nothing was ever verified: the paywall shows the ' +
      'could-not-confirm state and fails closed; the purchase and Restore report unavailable.',
    available: false,
    offerings: 'ready',
    purchase: 'success',
    restore: 'nothing',
    restoredPeriod: 'lifetime',
  },
];

export function developmentScenario(id: string): DevelopmentPurchaseScenario | null {
  return DEVELOPMENT_PURCHASE_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

// ── The fixture offering ────────────────────────────────────────────────────

/** The proposed US lifetime price, as a fixture for development only. */
export const DEVELOPMENT_OFFERING: Offering = {
  lifetime: {
    id: 'lotly_lifetime',
    period: 'lifetime',
    price: { amount: 19.99, currencyCode: 'USD', formatted: '$19.99' },
  },
};

/**
 * A long localized price for the Design Preview: what the offer has to
 * survive when a store renders a wide currency string. Not a real price.
 */
export const LONG_PRICE_OFFERING: Offering = {
  lifetime: {
    id: 'lotly_lifetime',
    period: 'lifetime',
    price: { amount: 329000, currencyCode: 'IDR', formatted: 'Rp 329.000,00' },
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
      (value.period === 'annual' || value.period === 'monthly' || value.period === 'lifetime') &&
      typeof value.purchasedAt === 'string'
    ) {
      return { period: value.period, purchasedAt: value.purchasedAt };
    }
  } catch {
    // Fall through: an unreadable value is no subscription.
  }
  return null;
}

/**
 * One simulated year or month of access from the purchase instant; none for
 * a lifetime purchase, which never expires.
 */
export function simulatedExpiry(purchasedAtIso: string, period: PlanPeriod): string | null {
  if (period === 'lifetime') return null;
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
    productId: `lotly_${subscription.period}`,
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
        ? { kind: 'inactive', asOf: deps.now() }
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
      // `found`: the simulated account already held this purchase.
      const subscription: SimulatedSubscription = {
        period: scenario.restoredPeriod,
        purchasedAt: deps.now(),
      };
      await deps.storage.write(JSON.stringify(subscription));
      return { kind: 'restored', entitlement: entitlementFor(subscription, deps.now()) };
    },
  };
}

/** Forget the simulated purchase or subscription (a development control). */
export async function clearSimulatedSubscription(
  storage: DevelopmentPurchaseStorage,
): Promise<void> {
  await storage.remove();
}

/** Grant simulated access without a purchase (a development control). */
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

// ── Clean captures ──────────────────────────────────────────────────────────

/**
 * In memory and nowhere else, like the scenario: whether the paywalls leave
 * out their development controls, so a target comparison shows the screen
 * exactly as a release build draws it. Off at every launch, so the controls
 * can never stay hidden by accident; the Design Preview's paywall gallery
 * switches it. Hiding the controls changes nothing about the simulated store.
 */
let controlsHidden = false;
const controlsListeners = new Set<() => void>();

export function developmentControlsHidden(): boolean {
  return controlsHidden;
}

export function setDevelopmentControlsHidden(hidden: boolean): void {
  controlsHidden = hidden;
  for (const listener of controlsListeners) listener();
}

export function subscribeDevelopmentControlsHidden(listener: () => void): () => void {
  controlsListeners.add(listener);
  return () => {
    controlsListeners.delete(listener);
  };
}
