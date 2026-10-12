/**
 * DEVELOPMENT-only: keep preference saves on this device (2026-10-04).
 *
 * The onboarding selectors save on every change and every save mirrors to
 * the production installation row, so a real walk through States →
 * Allergens → Stores on a QA simulator is a production write. This switch
 * lets QA exercise the real routes, the real store and the real queue while
 * the server mirror is answered locally as "done" and never sent. It is a
 * QA aid, not a product mode: it is reached only through the `__DEV__`
 * `require` in preferences-store.ts and the Design Preview's Building QA
 * controls, both folded out of a release bundle, and it persists under its
 * own development key so a relaunch keeps the choice until it is turned off.
 *
 * While it is on, the dirty flag clears as if the mirror had landed, so the
 * server row stays whatever it was; turn it off (and save once, or relaunch
 * with a save owed) to mirror again. Set it off when QA is done.
 */

import * as SecureStore from 'expo-secure-store';

import type { UserRecallPreferences } from '@/domain/preferences';

const KEY = 'recall.dev-local-only-saves';

let localOnly = false;
/** The persisted choice, read once; the mirror waits for it before deciding. */
const restored: Promise<void> = SecureStore.getItemAsync(KEY)
  .then((stored) => {
    localOnly = stored === '1';
  })
  .catch(() => {});

export function localOnlySaves(): boolean {
  return localOnly;
}

export function setLocalOnlySaves(on: boolean): void {
  localOnly = on;
  void SecureStore.setItemAsync(KEY, on ? '1' : '0').catch(() => {});
}

/** The mirror the store runs in development: the real one unless the switch is on. */
export function wrapDevelopmentMirror(
  sync: (prefs: UserRecallPreferences) => Promise<void>,
): (prefs: UserRecallPreferences) => Promise<void> {
  return async (prefs) => {
    await restored;
    if (localOnly) return;
    await sync(prefs);
  };
}

/**
 * The persisted switch, once restored (2026-10-12): the foreground check-in
 * also stays on the device while it is on, so a QA walk-through records no
 * production activity.
 */
export async function localOnlySavesSettled(): Promise<boolean> {
  await restored;
  return localOnly;
}
