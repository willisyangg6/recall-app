/**
 * The allergen consent record on this device (2026-10-13): one small JSON
 * value in the keychain beside the preferences it governs. Reading it never
 * contacts the server; "Reset app and delete my data" removes it.
 */

import * as SecureStore from 'expo-secure-store';

import {
  parseAllergenConsent,
  serializeAllergenConsent,
  type AllergenConsentRecord,
} from './allergen-consent';

const CONSENT_KEY = 'recall.allergen-consent';

/** The stored decision, or null when none was made (or it is unreadable). */
export async function loadAllergenConsent(): Promise<AllergenConsentRecord | null> {
  try {
    return parseAllergenConsent(await SecureStore.getItemAsync(CONSENT_KEY));
  } catch {
    return null;
  }
}

export async function saveAllergenConsent(record: AllergenConsentRecord): Promise<void> {
  await SecureStore.setItemAsync(CONSENT_KEY, serializeAllergenConsent(record));
}

/** "Reset app and delete my data". Local only. */
export async function deleteLocalAllergenConsent(): Promise<void> {
  await SecureStore.deleteItemAsync(CONSENT_KEY);
}
