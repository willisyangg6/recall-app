/**
 * The onboarding steps' preferences (P2B7X.1): the SAME store the
 * Personalization screen reads and writes, read on every focus and saved
 * progressively on every change.
 *
 * Nothing new is persisted: a state chosen on first launch is the state
 * Profile shows and the Feed personalizes by, through `savePreferences` and
 * its server mirror, queue and retry exactly as under Profile. A read that
 * has not answered is `loading`, and a failed read says so — a step is
 * never rendered as an empty selection the store did not actually give.
 *
 * Saves are silent here: the shopper is mid-flow and the local write always
 * succeeds (and, since 2026-10-04, never waits on the server mirror); a
 * failed server sync is retried on the next launch or save as it always was.
 *
 * A value committed anywhere else while this screen is mounted (the
 * one-page Edit preferences over Ready, 2026-09-30) is shown the moment it
 * is written locally, so Ready never draws the old board or the old preview
 * under the newly saved choices while its focus re-read is in flight.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import type { UserRecallPreferences } from '@/domain/preferences';
import type { PreferencesLoadState } from '@/lib/personalization-screen';
import {
  loadPreferences,
  onPreferencesSaved,
  preferencesAvailable,
  savePreferences,
} from '@/lib/preferences-store';

/**
 * The newest preferences this process has read or saved through the store
 * (2026-10-02), in memory only. A screen that opts in starts from them
 * instead of a loading state — the Building step and Ready, arriving from
 * Stores, never flash `Loading your preferences` over choices read a moment
 * ago — and still re-reads on focus, so a store that fails says so.
 */
let lastKnown: UserRecallPreferences | null = null;
onPreferencesSaved((prefs) => {
  lastKnown = prefs;
});

export interface OnboardingPreferencesOptions {
  /**
   * Start from the preferences already read or saved in this process. With
   * none (a cold launch or resume), the screen shows its loading state as
   * before.
   */
  reuseLoaded?: boolean;
}

export function useOnboardingPreferences({
  reuseLoaded = false,
}: OnboardingPreferencesOptions = {}): {
  load: PreferencesLoadState;
  /** Commit an edited copy: shown immediately, saved through the store. */
  update: (next: UserRecallPreferences) => void;
} {
  const [load, setLoad] = useState<PreferencesLoadState>(() =>
    reuseLoaded && lastKnown !== null && preferencesAvailable()
      ? { status: 'ready', prefs: lastKnown }
      : { status: 'loading' },
  );
  // Every change this screen committed, counted: a focus re-read that
  // started before a change was requested answers with the OLDER stored
  // value, and must not put it back over the newer one (2026-10-04).
  const edits = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (!preferencesAvailable()) {
        setLoad({ status: 'unsupported' });
        return;
      }
      let current = true;
      const readAt = edits.current;
      loadPreferences().then(
        (prefs) => {
          if (!current || edits.current !== readAt) return;
          lastKnown = prefs;
          setLoad({ status: 'ready', prefs });
        },
        () => {
          if (!current || edits.current !== readAt) return;
          lastKnown = null;
          setLoad({ status: 'failed' });
        },
      );
      return () => {
        current = false;
      };
    }, []),
  );

  useEffect(() => onPreferencesSaved((prefs) => setLoad({ status: 'ready', prefs })), []);

  const update = useCallback((next: UserRecallPreferences) => {
    edits.current += 1;
    lastKnown = next;
    setLoad({ status: 'ready', prefs: next });
    void savePreferences(next).catch(() => {});
  }, []);

  return { load, update };
}
