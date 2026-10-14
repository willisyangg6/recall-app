/**
 * The alert entitlement gate (D2, founder-approved 2026-10-14): recall alerts
 * stop when a subscription ends.
 *
 * The server holds a CACHED copy of RevenueCat's `premium` entitlement for each
 * alert registration, refreshed on a fixed schedule (entitlement-refresh.ts).
 * It therefore agrees with RevenueCat as of its last successful check, never
 * more than MAX_STALENESS old when a delivery is sent. It does not always
 * agree with RevenueCat at every instant.
 *
 * A delivery is allowed only when ALL of these hold:
 *   1. status is 'active';
 *   2. the known expiry is still in the future. This is the CLOCK gate:
 *      expiry stops alerts at expires_at with no refresh, no webhook and no
 *      app open. A missing expiry (a non-expiring grant) is refused, as the
 *      app refuses it (lib/purchases/revenuecat-adapter.ts).
 *   3. the last successful check is no older than MAX_STALENESS. This is the
 *      STALENESS gate: an unverifiable status is refused, never trusted (fail
 *      closed).
 *   4. the event was created at or after entitled_since. This is the
 *      NO-BACKLOG horizon: recalls announced while the subscription had
 *      ended, or before the server first saw it active again, are never sent
 *      later.
 *
 * Maximum delays (documented in docs/recall-push-delivery.md):
 *   expiry                   0, by the clock gate;
 *   refund, transfer to another purchase id, promotional access removed:
 *                            REFRESH_INTERVAL plus one worker-run gap (about
 *                            1 h 53 min at the measured worst run gap of
 *                            52 min), never more than MAX_STALENESS (3 h);
 *   RevenueCat unreachable   no alerts once the cached status is 3 h old.
 */

/** How often a row's entitlement is re-read from RevenueCat (R). */
export const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
/** The oldest successful check a delivery may rely on (S). Must exceed R plus the worst run gap. */
export const MAX_STALENESS_MS = 3 * 60 * 60 * 1000;

export type EntitlementStatus = 'unknown' | 'active' | 'inactive';

/** The four stored entitlement fields of one alert registration. */
export interface SubscriptionEntitlement {
  status: EntitlementStatus;
  expiresAt: string | null;
  checkedAt: string | null;
  entitledSince: string | null;
}

export const UNKNOWN_ENTITLEMENT: SubscriptionEntitlement = {
  status: 'unknown',
  expiresAt: null,
  checkedAt: null,
  entitledSince: null,
};

/** What one successful RevenueCat check found. */
export interface EntitlementObservation {
  active: boolean;
  /** ISO time the active entitlement expires; null when RevenueCat gives none. */
  expiresAt: string | null;
}

export type EntitlementVerdict =
  /** Every gate passes. */
  | 'entitled'
  /** RevenueCat reported no active entitlement. Definitive. */
  | 'inactive'
  /** The known expiry has passed, or there is none. Definitive for this event. */
  | 'expired'
  /** The event predates entitled_since. Definitive: no backlog. */
  | 'before_entitlement'
  /** Never checked, or the last check is too old. Held, not failed. */
  | 'unverified';

const at = (iso: string) => new Date(iso).getTime();

/** The send-time decision for one registration and one event. */
export function entitlementVerdict(
  entitlement: SubscriptionEntitlement,
  eventCreatedAt: string,
  nowIso: string,
): EntitlementVerdict {
  const now = at(nowIso);
  // A KNOWN expiry is definitive however old the check: the clock gate needs
  // no refresh, so a passed expiry fails the delivery rather than holding it.
  if (
    entitlement.status === 'active' &&
    (entitlement.expiresAt === null || at(entitlement.expiresAt) <= now)
  ) {
    return 'expired';
  }
  if (
    entitlement.status === 'unknown' ||
    entitlement.checkedAt === null ||
    now - at(entitlement.checkedAt) > MAX_STALENESS_MS
  ) {
    return 'unverified';
  }
  if (entitlement.status === 'inactive') return 'inactive';
  if (entitlement.entitledSince === null || eventCreatedAt < entitlement.entitledSince) {
    return 'before_entitlement';
  }
  return 'entitled';
}

/**
 * True when the row is due for a RevenueCat check this run: never checked, the
 * interval has passed, or the known expiry falls within the next interval. The
 * last case checks every run near expiry, so a renewal is normally seen before
 * the old expiry passes. One seen only afterwards restarts the no-backlog
 * horizon (nextEntitlement).
 */
export function needsRefresh(entitlement: SubscriptionEntitlement, nowIso: string): boolean {
  if (entitlement.status === 'unknown' || entitlement.checkedAt === null) return true;
  const now = at(nowIso);
  if (now - at(entitlement.checkedAt) >= REFRESH_INTERVAL_MS) return true;
  return (
    entitlement.status === 'active' &&
    entitlement.expiresAt !== null &&
    at(entitlement.expiresAt) - now < REFRESH_INTERVAL_MS
  );
}

/**
 * The fields to store after a successful check. `entitledSince` moves to now
 * whenever the check finds the subscription active and the stored state was
 * NOT continuously entitled: unknown, inactive, or already past its known
 * expiry. A renewal seen before expiry keeps it, because the entitlement never
 * lapsed. Recalls announced between a re-subscription and the refresh that
 * sees it are not sent either: the conservative side of no backlog.
 */
export function nextEntitlement(
  previous: SubscriptionEntitlement,
  observation: EntitlementObservation,
  nowIso: string,
): SubscriptionEntitlement {
  if (!observation.active) {
    return { status: 'inactive', expiresAt: null, checkedAt: nowIso, entitledSince: null };
  }
  const continuous =
    previous.status === 'active' &&
    previous.entitledSince !== null &&
    previous.expiresAt !== null &&
    at(previous.expiresAt) > at(nowIso);
  return {
    status: 'active',
    expiresAt: observation.expiresAt,
    checkedAt: nowIso,
    entitledSince: continuous ? previous.entitledSince : nowIso,
  };
}
