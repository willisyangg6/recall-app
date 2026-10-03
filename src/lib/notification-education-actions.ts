/**
 * Notification education's two choices (2026-10-03), as a leaf with no
 * React, no Expo and no I/O of its own, so every permission outcome is
 * provable under Node with the real effects replaced.
 *
 * - `enable` (the primary, a real tap only): asks the ONE enable path
 *   (`enableRecallAlerts`, which prompts only while the system still can),
 *   then completes the education whatever it reports — granted, denied,
 *   previously denied, or a registration error. It never claims success:
 *   nothing on the way out says alerts are on.
 * - `skip` (`Not now`): completes the education and nothing else — no
 *   permission read, no request, no registration.
 *
 * The first press of either takes the screen; every later press, of either,
 * is ignored, so a double tap can neither prompt twice nor complete twice.
 */

export interface EducationEffects {
  /** The one enable path; its result is the alert status it reached. */
  enable: () => Promise<unknown>;
  /** Marks the education done, so the gate opens the app. */
  complete: () => Promise<void>;
  /** The enable is in flight: the primary shows its busy word. */
  onBusy: () => void;
  /** Development-only report of a swallowed enable failure. */
  onEnableError?: (error: unknown) => void;
}

export function educationActions(effects: EducationEffects) {
  let taken = false;
  return {
    async enable(): Promise<void> {
      if (taken) return;
      taken = true;
      effects.onBusy();
      try {
        await effects.enable();
      } catch (error) {
        effects.onEnableError?.(error);
      } finally {
        await effects.complete();
      }
    },
    async skip(): Promise<void> {
      if (taken) return;
      taken = true;
      await effects.complete();
    },
  };
}
