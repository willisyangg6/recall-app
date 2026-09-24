/**
 * The verified-entitlement cache (native).
 *
 * Holds the last entitlement this device VERIFIED as active — written only
 * from a verified `active` reading or a successful purchase or restore, and
 * cleared by a verified `inactive` (lib/entitlement.ts owns that rule). It
 * is what lets a subscriber keep access through a store outage, and it is
 * never written from anything unverified, so it cannot grant access that no
 * verification established.
 *
 * SecureStore, because it is an access credential of a kind. It is
 * deliberately NOT cleared by "Reset app and delete my data": the purchase
 * belongs to the shopper's store account, not to the installation, and the
 * next verified reading settles it either way.
 */

import * as SecureStore from 'expo-secure-store';

import type { ActiveEntitlement } from './entitlement';

const CACHE_KEY = 'recall.entitlement';

function sanitize(raw: unknown): ActiveEntitlement | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.productId !== 'string') return null;
  if (value.period !== 'annual' && value.period !== 'monthly') return null;
  if (typeof value.verifiedAt !== 'string') return null;
  if (value.expiresAt !== null && typeof value.expiresAt !== 'string') return null;
  return {
    productId: value.productId,
    period: value.period,
    verifiedAt: value.verifiedAt,
    expiresAt: value.expiresAt as string | null,
  };
}

export async function loadCachedEntitlement(): Promise<ActiveEntitlement | null> {
  try {
    const raw = await SecureStore.getItemAsync(CACHE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveCachedEntitlement(entitlement: ActiveEntitlement | null): Promise<void> {
  if (entitlement === null) await SecureStore.deleteItemAsync(CACHE_KEY);
  else await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(entitlement));
}
