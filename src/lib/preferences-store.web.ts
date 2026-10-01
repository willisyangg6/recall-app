/**
 * Web variant: personalization is a mobile-app feature (SecureStore and the
 * installation identity are native). Home falls back to All Recalls and
 * Settings explains — same convention as push-registration.web.ts.
 */

import { EMPTY_PREFERENCES, type UserRecallPreferences } from '@/domain/preferences';

export function preferencesAvailable(): boolean {
  return false;
}

export async function loadPreferences(): Promise<UserRecallPreferences> {
  return { ...EMPTY_PREFERENCES };
}

export interface SaveResult {
  synced: boolean;
}

export async function savePreferences(_prefs: UserRecallPreferences): Promise<SaveResult> {
  return { synced: false };
}

/** Never reached on the web (no preferences); rejects rather than pretend to save. */
export async function commitPreferences(
  _prefs: UserRecallPreferences,
): Promise<UserRecallPreferences> {
  throw new Error('Preferences are not available on the web.');
}

export function onPreferencesSaved(_listener: (prefs: UserRecallPreferences) => void): () => void {
  return () => {};
}

export async function flushPreferencesSync(): Promise<void> {}

export async function deleteLocalPreferenceState(): Promise<void> {}
