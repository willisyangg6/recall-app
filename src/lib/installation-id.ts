/**
 * Stable, opaque installation identity for push registration.
 *
 * A random UUID generated on this device the first time it is needed,
 * persisted in SecureStore (it acts as the bearer capability for this
 * installation's own subscription/preference rows, so it gets keychain-grade
 * storage). It is NOT a hardware or advertising identifier: nothing about the
 * device is encoded in it, and regenerating it (reinstall, cleared keychain,
 * C7.1 data reset) only creates a fresh installation — the backend disables
 * the stale row when the same push token re-registers under the new id.
 *
 * Lifecycle (C7.1): "Reset app and delete my data" deletes the server rows
 * keyed by this id, then discards it via clearInstallationId(); the next
 * getOrCreateInstallationId() call mints the fresh identity through this one
 * canonical path. peekInstallationId() exists so the reset can read the
 * credential WITHOUT creating one — an installation that never had an id has
 * nothing on the server to delete, and deletion must not invent an identity
 * as a side effect.
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

/** The stored id, or null when none exists. Never creates one. */
export async function peekInstallationId(): Promise<string | null> {
  return SecureStore.getItemAsync(STORE_KEY);
}

/**
 * Discard the stored id (C7.1 reset). Only called AFTER the server deletion
 * for this id succeeded — the id is the sole credential able to delete or
 * retry deleting its server rows, so dropping it early would strand them.
 */
export async function clearInstallationId(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY);
}
