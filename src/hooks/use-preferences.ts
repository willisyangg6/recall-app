/**
 * The one way a screen reads the user's personalization (P2B7N.1).
 *
 * ## Why this is shared
 *
 * Three surfaces render a personalization verdict — the Feed's cards and
 * "Affects me" membership, the Saved tab's cards, and Recall Details'
 * affects-you banner — and all three must be answering from the SAME
 * preferences. Before this hook each screen hydrated its own copy, which
 * is how the Saved tab came to have none at all: it never loaded
 * preferences, so every saved card reported "does not affect you" while
 * the identical card in the Feed reported the opposite.
 *
 * ## Why on focus, not on mount
 *
 * Preferences are edited in Settings, on a screen pushed OVER these ones.
 * A mount-only read would leave a tab sitting underneath the stack with
 * the profile the user just changed — showing AFFECTS YOU for an allergy
 * they removed, or withholding it for a state they just chose. Reloading
 * on every focus is what makes "change a preference, both surfaces agree"
 * true rather than true-until-you-navigate. It also picks up the C7.1
 * "Reset app and delete my data" wipe without a relaunch.
 *
 * `null` means "not read yet", never "nothing selected" — the distinction
 * matters because only one of those is a settled answer. Both are treated
 * as "no match" by `affectsYouVerdict`, which is the safe direction: a
 * card may briefly not claim relevance it has not yet established, but it
 * may never claim relevance it has not established at all.
 *
 * On a platform without preference storage (web) this stays `null` and no
 * read is attempted.
 */

import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import type { UserRecallPreferences } from '@/domain/preferences';
import { loadPreferences, preferencesAvailable } from '@/lib/preferences-store';

/**
 * @param onFirstLoad Called once per mount, with the FIRST profile read —
 * for a one-time decision that must not be re-made on later focuses (the
 * Feed's default tab). Later reads update the returned value and do not
 * call it again.
 */
export function usePreferences(
  onFirstLoad?: (prefs: UserRecallPreferences) => void,
): UserRecallPreferences | null {
  const [prefs, setPrefs] = useState<UserRecallPreferences | null>(null);
  const initialized = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!preferencesAvailable()) return;
      void loadPreferences().then((loaded) => {
        setPrefs(loaded);
        if (!initialized.current) {
          initialized.current = true;
          onFirstLoad?.(loaded);
        }
      });
    }, [onFirstLoad]),
  );

  return prefs;
}
