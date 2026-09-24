/**
 * Which purchase provider this build runs (P2B7X.1).
 *
 *   development build   the DEVELOPMENT adapter — a fake store for the
 *                       Simulator and the Design Preview
 *   release build       the real provider once one is configured
 *                       (RevenueCat, P2B7X.2); until then the UNCONFIGURED
 *                       provider, which fails closed on every call
 *
 * The development branch is the bare `__DEV__` identifier, which Metro
 * replaces with a literal at build time so a release bundle folds the whole
 * branch — and the `require` inside it — away. There is no runtime flag,
 * setting or environment variable that can select the development adapter
 * in a release build, and the adapter itself re-checks the development gate
 * on every call besides. `purchase-provider.test.ts` pins both locks.
 *
 * The identity handed to the real provider is the installation id (the
 * anonymous app-user id), resolved lazily so reading an offering never
 * mints one.
 */

import { getOrCreateInstallationId } from '../installation-id';
import {
  unconfiguredPurchaseProvider,
  type PurchaseIdentity,
  type PurchaseProvider,
} from './purchase-provider';

/** The anonymous purchase identity: the existing installation id. */
export const purchaseIdentity: PurchaseIdentity = {
  appUserId: getOrCreateInstallationId,
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
  // P2B7X.2 replaces this line with the configured RevenueCat adapter,
  // constructed with `purchaseIdentity`. Nothing above this module changes.
  resolved = unconfiguredPurchaseProvider();
  return resolved;
}
