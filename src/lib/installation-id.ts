/**
 * Stable, opaque installation identity for push registration.
 *
 * A random UUID generated on this device the first time alerts are enabled,
 * persisted in SecureStore (it acts as the bearer capability for this
 * installation's own subscription row, so it gets keychain-grade storage).
 * It is NOT a hardware or advertising identifier: nothing about the device is
 * encoded in it, and regenerating it (reinstall, cleared keychain) only
 * creates a fresh subscription — the backend disables the stale row when the
 * same push token re-registers under the new id.
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const STORE_KEY = 'recall.installation-id';

export async function getOrCreateInstallationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(STORE_KEY);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(STORE_KEY, id);
  return id;
}
