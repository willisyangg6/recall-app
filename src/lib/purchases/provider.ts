/**
 * Which purchase provider this build runs (P2B7X.1).
 *
 *   development build   the DEVELOPMENT adapter — a fake store for the
 *                       Simulator and the Design Preview
 *   release build       the RevenueCat provider (P2B7X.2), which itself
 *                       falls back to the UNCONFIGURED provider — fail closed
 *                       on every call — off iOS, without the public key, or
 *                       without the native module (revenuecat-provider.ts)
 *
 * The development branch is the bare `__DEV__` identifier, which Metro
 * replaces with a literal at build time so a release bundle folds the whole
 * branch — and the `require` inside it — away. There is no runtime flag,
 * setting or environment variable that can select the development adapter
 * in a release build, and the adapter itself re-checks the development gate
 * on every call besides. `purchase-provider.test.ts` pins both locks.
 *
 * The identity handed to the real provider is the PURCHASE id
 * (purchase-identity.ts, 2026-10-12): its own random keychain id, separate
 * from the installation id, never sent to Lotly's server and never rotated
 * by "Reset app and delete my data", so a subscription survives a reset
 * without a restore. Resolved lazily, on the adapter's first store call.
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { loadCachedEntitlement } from '../entitlement-store';
import { peekInstallationId } from '../installation-id';
import { loadOnboardingRecord } from '../onboarding-store';
import { createPurchaseIdentity, legacyPurchaseId } from './purchase-identity';
import type { PurchaseIdentity, PurchaseProvider } from './purchase-provider';
import { revenueCatPurchaseProvider } from './revenuecat-provider';

/**
 * The purchase id's keychain entry. Owned here alone; the data reset never
 * names it (installation-reset-runner.ts composes only installation state).
 */
const PURCHASE_ID_KEY = 'recall.purchase-id';

/** The anonymous purchase identity: its own id, kept across a data reset. */
export const purchaseIdentity: PurchaseIdentity = {
  appUserId: createPurchaseIdentity({
    readStored: () => SecureStore.getItemAsync(PURCHASE_ID_KEY),
    writeStored: (id) => SecureStore.setItemAsync(PURCHASE_ID_KEY, id),
    randomId: () => Crypto.randomUUID(),
    // Upgrade continuity: earlier builds used the installation id. Adopt it
    // only when this install reached a purchase (purchase-identity.ts).
    adoptableLegacyId: legacyPurchaseId({
      peekInstallationId,
      personalizationCompleted: async () => (await loadOnboardingRecord()).personalizationCompleted,
      hasCachedEntitlement: async () => (await loadCachedEntitlement()) !== null,
    }),
  }),
};

type DevelopmentModule = typeof import('./development-provider');

let resolved: PurchaseProvider | null = null;

export function resolvePurchaseProvider(): PurchaseProvider {
  if (resolved !== null) return resolved;
  if (__DEV__) {
    // A `require` rather than an import ON PURPOSE: Metro folds the dead
    // `__DEV__` branch and drops this dependency from a release bundle, which
    // a static import could never achieve (release-exposure.test.ts pins it).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const development = require('./development-provider') as DevelopmentModule;
    resolved = development.developmentPurchaseProvider();
    return resolved;
  }
  resolved = revenueCatPurchaseProvider(purchaseIdentity);
  return resolved;
}
