/**
 * Native wiring for the DEVELOPMENT purchase adapter: the simulated store
 * account under its own dev-only SecureStore key, the development-build
 * guard, and the live scenario. See development-scenarios.ts for the
 * behaviour and its containment; this file is the one place the key lives.
 *
 * Reached only from `resolvePurchaseProvider`'s `__DEV__` branch and from
 * the Design Preview hub (both pinned by test). A release bundle folds the
 * branch away; even if a reference survived, every call re-checks the
 * development gate and answers `unavailable`.
 */

import * as SecureStore from 'expo-secure-store';

import { isDevelopmentBuild } from '../design-preview';
import {
  clearSimulatedSubscription,
  createDevelopmentPurchaseProvider,
  developmentPurchaseScenario,
  seedSimulatedSubscription,
  type DevelopmentPurchaseStorage,
} from './development-scenarios';
import type { PlanPeriod, PurchaseProvider } from './purchase-provider';

/** Development only. Never read by production code. */
const DEV_ACCOUNT_KEY = 'recall.dev-purchases';

const storage: DevelopmentPurchaseStorage = {
  read: () => SecureStore.getItemAsync(DEV_ACCOUNT_KEY),
  write: (value) => SecureStore.setItemAsync(DEV_ACCOUNT_KEY, value),
  remove: () => SecureStore.deleteItemAsync(DEV_ACCOUNT_KEY),
};

export function developmentPurchaseProvider(): PurchaseProvider {
  return createDevelopmentPurchaseProvider({
    storage,
    isDevelopment: isDevelopmentBuild,
    now: () => new Date().toISOString(),
    scenario: developmentPurchaseScenario,
  });
}

/** A development control: forget the simulated subscription. */
export function clearDevelopmentSubscription(): Promise<void> {
  if (!isDevelopmentBuild()) return Promise.resolve();
  return clearSimulatedSubscription(storage);
}

/** A development control: grant a simulated subscription without a purchase. */
export function seedDevelopmentSubscription(period: PlanPeriod): Promise<void> {
  if (!isDevelopmentBuild()) return Promise.resolve();
  return seedSimulatedSubscription(storage, period, new Date().toISOString());
}
