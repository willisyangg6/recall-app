/**
 * Onboarding record persistence (native).
 *
 * One small JSON record in SecureStore, beside the preferences it belongs
 * with: both survive a reinstall together, so a shopper who reinstalls keeps
 * their choices AND their place. What is stored is exactly the versioned
 * `OnboardingRecord`; every read passes through `sanitizeOnboardingRecord`,
 * so an unreadable or foreign value restarts onboarding (the safe direction
 * for a gate) and never skips it.
 *
 * Reading or writing this record never mints an installation id, never
 * touches a permission, and never contacts the server: onboarding progress
 * is this device's own.
 */

import * as SecureStore from 'expo-secure-store';

import {
  INITIAL_ONBOARDING,
  sanitizeOnboardingRecord,
  type OnboardingRecord,
} from './onboarding-state';

const RECORD_KEY = 'recall.onboarding';

export async function loadOnboardingRecord(): Promise<OnboardingRecord> {
  try {
    const raw = await SecureStore.getItemAsync(RECORD_KEY);
    if (!raw) return { ...INITIAL_ONBOARDING };
    return sanitizeOnboardingRecord(JSON.parse(raw));
  } catch {
    return { ...INITIAL_ONBOARDING };
  }
}

export async function saveOnboardingRecord(record: OnboardingRecord): Promise<void> {
  await SecureStore.setItemAsync(RECORD_KEY, JSON.stringify(sanitizeOnboardingRecord(record)));
}

/**
 * Remove the record ("Reset app and delete my data"). The next launch
 * starts onboarding from Welcome. Local-only and deliberately unqueued: the
 * reset orchestrator calls it inside its own queue turn.
 */
export async function deleteLocalOnboardingState(): Promise<void> {
  await SecureStore.deleteItemAsync(RECORD_KEY);
}
