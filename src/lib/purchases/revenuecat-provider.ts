/**
 * The RevenueCat provider's native wiring (P2B7X.2): binds the real
 * `react-native-purchases` SDK, the iOS platform and the public SDK key to
 * the SDK-agnostic adapter (revenuecat-adapter.ts), and fails closed when
 * any of them is missing.
 *
 * Returns the UNCONFIGURED provider — `unavailable` to everything, never a
 * grant — when:
 *
 *   - the platform is not iOS (Android and web have no store configured);
 *   - `EXPO_PUBLIC_REVENUECAT_IOS_KEY` is absent from the build. Metro
 *     inlines the variable at build time; a build made without it carries
 *     no key and no store, and the paywall shows its could-not-confirm state
 *     (release-exposure.test.ts records the variable as public
 *     configuration);
 *   - the native module is not linked. The SDK would otherwise fall back to
 *     its browser "preview" mode in Expo Go, a simulated store that answers
 *     purchases — never acceptable as a source of access, so the module is
 *     checked here, before the SDK is asked anything.
 *
 * The web variant (revenuecat-provider.web.ts) returns the unconfigured
 * provider outright and imports no SDK.
 */

import { NativeModules, Platform } from 'react-native';
import Purchases from 'react-native-purchases';

import {
  unconfiguredPurchaseProvider,
  type PurchaseIdentity,
  type PurchaseProvider,
} from './purchase-provider';
import { createRevenueCatAdapter, type RevenueCatSdk } from './revenuecat-adapter';

const sdk: RevenueCatSdk = {
  configure: (configuration) => Purchases.configure(configuration),
  getCustomerInfo: () => Purchases.getCustomerInfo(),
  getOfferings: () => Purchases.getOfferings(),
  purchasePackage: (pkg) => Purchases.purchasePackage(pkg),
  restorePurchases: () => Purchases.restorePurchases(),
};

/** The native module the SDK binds to; absent in Expo Go and in an unlinked build. */
function nativeModuleLinked(): boolean {
  return Boolean((NativeModules as Record<string, unknown>).RNPurchases);
}

export function revenueCatPurchaseProvider(identity: PurchaseIdentity): PurchaseProvider {
  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  if (Platform.OS !== 'ios') return unconfiguredPurchaseProvider();
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0)
    return unconfiguredPurchaseProvider();
  if (!nativeModuleLinked()) return unconfiguredPurchaseProvider();
  return createRevenueCatAdapter({ sdk, apiKey: apiKey.trim(), identity });
}
