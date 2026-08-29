/**
 * Preference persistence (native).
 *
 * Source of truth is the LOCAL copy: preferences are this device's own
 * choices, they must work offline and before push is ever enabled, and only
 * this installation writes them. The server row (installation_preferences)
 * is explicitly a mirror the delivery worker reads for push eligibility —
 * synced after every local save, and re-synced on the next save or app
 * launch when a sync fails (dirty flag). There are never two authorities:
 * local wins, the server converges.
 *
 * Stored in SecureStore alongside the installation id: allergen selections
 * are sensitive-ish personal data, and the keychain survives reinstalls, so
 * preferences and the installation identity live and die together. Reading
 * or writing preferences NEVER triggers a notification-permission prompt —
 * the installation id is an opaque UUID with no permission attached.
 */

import * as SecureStore from 'expo-secure-store';

import {
  EMPTY_PREFERENCES,
  sanitizePreferences,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { getOrCreateInstallationId } from './installation-id';
import { enqueueInstallationMutation } from './installation-lifecycle';
import { setInstallationPreferences } from './push-api';

const PREFS_KEY = 'recall.preferences';
/** '1' while the last server sync failed and a retry is owed. */
const DIRTY_KEY = 'recall.preferences-dirty';

/** Preferences are available on this platform. */
export function preferencesAvailable(): boolean {
  return true;
}

/** The locally stored preferences; EMPTY when none were ever saved. */
export async function loadPreferences(): Promise<UserRecallPreferences> {
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY);
    if (!raw) return { ...EMPTY_PREFERENCES };
    return sanitizePreferences(JSON.parse(raw));
  } catch {
    // A corrupt or unreadable value degrades to empty preferences — it never
    // crashes Home or Settings.
    return { ...EMPTY_PREFERENCES };
  }
}

async function syncToServer(prefs: UserRecallPreferences): Promise<void> {
  await setInstallationPreferences({
    installationId: await getOrCreateInstallationId(),
    stateCode: prefs.state,
    allergens: prefs.allergens,
    retailerIds: prefs.retailers,
  });
}

export interface SaveResult {
  /** False = saved locally but the server sync failed (retried later). */
  synced: boolean;
}

/**
 * Serializes saves. Settings autosaves on every toggle, so several saves can
 * be in flight at once; without a queue a slower earlier write could land
 * last and silently revert the user's latest choice (locally and on the
 * mirror). Ordering/rejection-resilience proofs live in serial-queue.test.ts
 * — SecureStore makes this file itself unimportable under the test harness.
 *
 * C7.1: the queue is the SHARED installation mutation queue, so saves — and
 * the launch flush below — also serialize against push registration writes
 * and "Reset app and delete my data". A save queued before a reset finishes
 * before the deletion runs; one queued after runs against the fresh
 * installation identity. Save-vs-save ordering is exactly what it was.
 */
const enqueueSave = enqueueInstallationMutation;

/**
 * Persist preferences: local write first (never lost to a network error),
 * then best-effort server sync. A failed sync sets the dirty flag so
 * `flushPreferencesSync` retries on the next app launch.
 */
export function savePreferences(prefs: UserRecallPreferences): Promise<SaveResult> {
  return enqueueSave(() => writePreferences(prefs));
}

async function writePreferences(prefs: UserRecallPreferences): Promise<SaveResult> {
  const cleaned = sanitizePreferences(prefs);
  await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(cleaned));
  try {
    await syncToServer(cleaned);
    await SecureStore.deleteItemAsync(DIRTY_KEY);
    return { synced: true };
  } catch {
    await SecureStore.setItemAsync(DIRTY_KEY, '1');
    return { synced: false };
  }
}

/**
 * Retry a previously failed server sync (called once at app launch).
 * No-op when the last sync succeeded; silent — launch is never blocked.
 * Queued (C7.1) so a launch-time flush can never interleave with a save or
 * with data deletion — unqueued, a flush in flight during a reset could
 * re-upsert the just-deleted server row under the old installation id.
 */
export function flushPreferencesSync(): Promise<void> {
  return enqueueSave(async () => {
    try {
      if ((await SecureStore.getItemAsync(DIRTY_KEY)) !== '1') return;
      await syncToServer(await loadPreferences());
      await SecureStore.deleteItemAsync(DIRTY_KEY);
    } catch {
      // Still offline: the flag stays set for the next launch or save.
    }
  });
}

/**
 * Remove the locally persisted preference state — the preference blob and
 * the retry flag (C7.1 reset). Local-only: never touches the server, and
 * deliberately NOT queued — the reset orchestrator calls it inside its own
 * queue turn, after the server deletion for the old id succeeded.
 */
export async function deleteLocalPreferenceState(): Promise<void> {
  await SecureStore.deleteItemAsync(PREFS_KEY);
  await SecureStore.deleteItemAsync(DIRTY_KEY);
}
