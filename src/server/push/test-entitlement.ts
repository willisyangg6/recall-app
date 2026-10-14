/**
 * Test support for the alert entitlement gate (entitlement.ts). Used only by
 * tests: a RevenueCat stand-in that reports an active entitlement, and a
 * registration helper for tests about something OTHER than entitlement
 * (horizons, matching, receipts), so they keep their meaning under the gate.
 */

import type { MemoryPushStore } from './memory-push-store';
import type { EntitlementSource } from './revenuecat-entitlement';

export const FAR_FUTURE = '2099-01-01T00:00:00.000Z';

/** A RevenueCat that reports every purchase id as subscribed until FAR_FUTURE. */
export const ACTIVE_SOURCE: EntitlementSource = {
  async check() {
    return { active: true, expiresAt: FAR_FUTURE };
  },
};

/** A purchase id of the stored shape, derived from the installation id. */
export function purchaseIdFor(installationId: string): string {
  return `p-${installationId}`.slice(0, 64).padEnd(16, '0');
}

/**
 * Register as a current client does (with a purchase id), then record the
 * entitlement the worker's refresh would have stored: active, entitled since
 * the registration.
 */
export function registerEntitled(
  store: MemoryPushStore,
  installationId: string,
  expoPushToken: string,
  platform: 'ios' | 'android',
  nowIso: string,
  sequence?: number,
): ReturnType<MemoryPushStore['register']> {
  const result = store.register(
    installationId,
    expoPushToken,
    platform,
    nowIso,
    sequence,
    purchaseIdFor(installationId),
  );
  const row = store.subscriptionOf(installationId);
  // Only a row the guard left unknown (new, re-enabled): an idempotent
  // re-registration keeps its entitlement, exactly as the SQL does.
  if (result.applied && row?.enabled && row.entitlement.status === 'unknown') {
    store.seedEntitlement(installationId, {
      status: 'active',
      expiresAt: FAR_FUTURE,
      checkedAt: nowIso,
      entitledSince: nowIso,
    });
  }
  return result;
}
