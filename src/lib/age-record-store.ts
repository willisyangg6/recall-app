/**
 * The age record (native): Apple's last age-range answer, kept on this
 * iPhone only (lib/age-assurance.ts). Never sent anywhere.
 *
 * SecureStore, like the entitlement cache. Deliberately NOT cleared by
 * "Reset app and delete my data", for the same reason that cache is not:
 * the range belongs to the Apple Account, not to the installation, and
 * Apple answers again on the next launch without a prompt. Keeping it is
 * also what holds the under-13 stop in place offline.
 */

import * as SecureStore from 'expo-secure-store';

import { sanitizeAgeRecord } from './age-record';
import type { AgeRecord } from './age-assurance';

const RECORD_KEY = 'recall.age-range';

export async function loadAgeRecord(): Promise<AgeRecord | null> {
  try {
    const raw = await SecureStore.getItemAsync(RECORD_KEY);
    return raw ? sanitizeAgeRecord(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveAgeRecord(record: AgeRecord): Promise<void> {
  await SecureStore.setItemAsync(RECORD_KEY, JSON.stringify(record));
}
