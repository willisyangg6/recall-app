/**
 * Entitlement resolution (P2B7X.1): the pure rule that turns what a purchase
 * provider answered, plus what this device last VERIFIED, into the one access
 * decision the gate acts on.
 *
 * ## The two inputs, and why both exist
 *
 *   reading   what the provider says RIGHT NOW: active, inactive, or that it
 *             could not answer (offline, the store down, no provider
 *             configured). A provider never answers "probably".
 *   cache     the last entitlement this device VERIFIED as active, kept in
 *             SecureStore (entitlement-store.ts). It is written only from a
 *             verified `active` reading or a successful purchase/restore, and
 *             cleared by a verified `inactive`.
 *
 * ## The rule
 *
 *   active      → active, verified; the cache becomes this entitlement.
 *   inactive    → inactive, verified; the cache is cleared.
 *   unavailable → with a cache that has not lapsed past the grace window,
 *                 active but CACHED (a subscriber keeps access through an
 *                 outage); with no cache, inactive and UNCONFIRMED — a first
 *                 launch that has never been verified fails closed, and the
 *                 paywall says the subscription could not be confirmed.
 *
 * Fail-closed is the invariant: nothing here can grant access that no
 * verification ever established. `CACHED_ACCESS_GRACE_MS` bounds how long a
 * lapsed cache is honoured after its own expiry when the provider is silent,
 * so a cancelled subscription cannot be kept alive by staying offline.
 *
 * A leaf: types and arithmetic only, so the whole matrix is provable in Node
 * and the future RevenueCat adapter plugs in beneath it without touching the
 * gate.
 */

export type PlanPeriod = 'annual' | 'monthly';

/** One verified entitlement, as the store reported it. */
export interface ActiveEntitlement {
  /** The store product that grants access. */
  productId: string;
  period: PlanPeriod;
  /** ISO instant of the verification that produced this record. */
  verifiedAt: string;
  /** ISO instant the store reported the current period ends, when known. */
  expiresAt: string | null;
}

/** What a provider answers when asked whether this device is entitled. */
export type EntitlementReading =
  | { kind: 'active'; entitlement: ActiveEntitlement }
  | { kind: 'inactive' }
  /** The provider could not answer: offline, store outage, or no provider. */
  | { kind: 'unavailable' };

/** The gate's decision. */
export type EntitlementStatus =
  | { kind: 'loading' }
  | { kind: 'active'; entitlement: ActiveEntitlement; confirmation: 'verified' | 'cached' }
  | {
      kind: 'inactive';
      /**
       * verified      the store said so
       * unconfirmed   the store could not be reached and nothing was cached;
       *               the paywall shows the temporarily-unavailable state
       */
      reason: 'verified' | 'unconfirmed';
    };

/**
 * How long past its own expiry a cached entitlement is still honoured while
 * the provider cannot be reached. Three days covers a weekend outage and the
 * store's own billing-retry window without letting a lapsed subscription ride
 * indefinitely. An entitlement with no known expiry is honoured for as long
 * as the provider stays silent — the store, not this device, is the authority
 * that ends it.
 */
export const CACHED_ACCESS_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** Whether a cached entitlement may still grant access at `nowIso`. */
export function cacheGrantsAccess(cache: ActiveEntitlement | null, nowIso: string): boolean {
  if (cache === null) return false;
  if (cache.expiresAt === null) return true;
  const expires = Date.parse(cache.expiresAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(expires) || Number.isNaN(now)) return false;
  return now <= expires + CACHED_ACCESS_GRACE_MS;
}

export interface EntitlementResolution {
  status: EntitlementStatus;
  /** What the cache should hold after this resolution. */
  cache: ActiveEntitlement | null;
}

export function resolveEntitlement(
  reading: EntitlementReading,
  cache: ActiveEntitlement | null,
  nowIso: string,
): EntitlementResolution {
  switch (reading.kind) {
    case 'active':
      return {
        status: { kind: 'active', entitlement: reading.entitlement, confirmation: 'verified' },
        cache: reading.entitlement,
      };
    case 'inactive':
      return { status: { kind: 'inactive', reason: 'verified' }, cache: null };
    case 'unavailable':
      if (cacheGrantsAccess(cache, nowIso)) {
        return {
          status: {
            kind: 'active',
            entitlement: cache as ActiveEntitlement,
            confirmation: 'cached',
          },
          cache,
        };
      }
      // Fail closed. A lapsed cache is kept (not cleared) so the record of
      // what WAS verified survives for the next successful reading to settle.
      return { status: { kind: 'inactive', reason: 'unconfirmed' }, cache };
  }
}

/** The one question the gate asks. */
export function isEntitled(status: EntitlementStatus): boolean {
  return status.kind === 'active';
}

/**
 * How long the launch-time reading may take before the app proceeds without
 * it. The provider keeps answering in the background; until it does, the
 * reading counts as `unavailable`, which the rule above resolves safely in
 * both directions (a cached subscriber enters, an unverified device does
 * not). Launch never hangs on a store.
 */
export const ENTITLEMENT_READ_TIMEOUT_MS = 4000;

/**
 * Resolve to `unavailable` if the reading has not answered within the
 * timeout. The original promise is left to settle on its own.
 */
export function readWithTimeout(
  reading: Promise<EntitlementReading>,
  timeoutMs: number = ENTITLEMENT_READ_TIMEOUT_MS,
): Promise<EntitlementReading> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: 'unavailable' });
    }, timeoutMs);
    reading.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ kind: 'unavailable' });
      },
    );
  });
}
