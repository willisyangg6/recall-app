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
 * succeeds; a failed server sync is retried on the next launch or save as
 * it always was.
 *
 * A value committed anywhere else while this screen is mounted (the
 * one-page Edit preferences over Ready, 2026-09-30) is shown the moment it
 * is written locally, so Ready never draws the old board or the old preview
 * under the newly saved choices while its focus re-read is in flight.
 */

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import type { UserRecallPreferences } from '@/domain/preferences';
import type { PreferencesLoadState } from '@/lib/personalization-screen';
import {
  loadPreferences,
  onPreferencesSaved,
  preferencesAvailable,
  savePreferences,
} from '@/lib/preferences-store';

export function useOnboardingPreferences(): {
  load: PreferencesLoadState;
  /** Commit an edited copy: shown immediately, saved through the store. */
  update: (next: UserRecallPreferences) => void;
} {
  const [load, setLoad] = useState<PreferencesLoadState>({ status: 'loading' });

  useFocusEffect(
    useCallback(() => {
      if (!preferencesAvailable()) {
        setLoad({ status: 'unsupported' });
        return;
      }
      let current = true;
      loadPreferences().then(
        (prefs) => {
          if (current) setLoad({ status: 'ready', prefs });
        },
        () => {
          if (current) setLoad({ status: 'failed' });
        },
      );
      return () => {
        current = false;
      };
    }, []),
  );

  useEffect(() => onPreferencesSaved((prefs) => setLoad({ status: 'ready', prefs })), []);

  const update = useCallback((next: UserRecallPreferences) => {
    setLoad({ status: 'ready', prefs: next });
    void savePreferences(next).catch(() => {});
  }, []);

  return { load, update };
}
