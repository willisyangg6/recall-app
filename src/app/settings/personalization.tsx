/**
 * Personalization (P2A structure, P2B6A design) — state, allergens to
 * watch, and stores.
 *
 * The route reads and saves; everything it shows is drawn by the sections
 * in components/settings/personalization-form.tsx, which are handed the
 * preferences and hand back the edited copy. What this screen DOES is
 * unchanged from the day it was split out of the combined "Alerts" screen:
 * it owns the same `UserRecallPreferences` fields, in the same order,
 * through the same `savePreferences` path, autosaving on every change —
 * the local write first, then the best-effort server mirror, reported
 * honestly beneath the form. Nothing about matching, relevance, or Affects
 * Me lives here.
 *
 * Preferences are re-read on every focus (not just mount): after the data
 * reset ran on the Privacy & Data Controls screen, coming back here must
 * show the cleared state, not a stale in-memory copy. A read that has not
 * answered shows a loading message, a read that failed says so, and a
 * platform without preferences (the web) says the feature is in the app;
 * none of the three is ever rendered as an empty form, and while a re-read
 * is in flight the form keeps the last real answer rather than flashing.
 *
 * Choosing a state, an allergen, or a store never prompts for a permission —
 * preferences are plain app state, useful on Feed even while push alerts stay
 * off. The one permission prompt in the app lives on the Notifications
 * screen, behind its explicit button.
 *
 * The header is the navigator's own `Personalization` title, styled by the
 * root stack from the tokens; there is no second heading on the page.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  PersonalizationForm,
  PreferencesNotReady,
  SaveStatusLine,
} from '@/components/settings/personalization-form';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { layout, spacing } from '@/constants/design-tokens';
import type { UserRecallPreferences } from '@/domain/preferences';
import {
  PERSONALIZATION_INTRO,
  type PreferencesLoadState,
  type SaveState,
} from '@/lib/personalization-screen';
import { loadPreferences, preferencesAvailable, savePreferences } from '@/lib/preferences-store';

export default function PersonalizationScreen() {
  const insets = useSafeAreaInsets();
  // Loading until the store answers; never an assumed empty set.
  const [load, setLoad] = useState<PreferencesLoadState>({ status: 'loading' });
  const [saveState, setSaveState] = useState<SaveState>('idle');

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
        // A read that resolves after the screen lost focus is discarded, so a
        // slower earlier read can never overwrite a newer answer.
        current = false;
      };
    }, []),
  );

  // Autosave: local write always succeeds; a failed server sync is reported
  // honestly and retried on the next launch (never a lost preference).
  const update = useCallback((next: UserRecallPreferences) => {
    setLoad({ status: 'ready', prefs: next });
    setSaveState('saving');
    void savePreferences(next).then(
      (result) => setSaveState(result.synced ? 'saved' : 'local_only'),
      () => setSaveState('local_only'),
    );
  }, []);

  return (
    <Surface background="background/page" style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing[24] + insets.bottom }]}
        keyboardShouldPersistTaps="handled">
        {load.status === 'ready' ? (
          <>
            <Text variant="body-small" color="text/secondary">
              {PERSONALIZATION_INTRO}
            </Text>
            <PersonalizationForm prefs={load.prefs} onChange={update} />
            <SaveStatusLine state={saveState} />
          </>
        ) : (
          <PreferencesNotReady status={load.status} />
        )}
      </ScrollView>
    </Surface>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  // The content column at the page margin, capped at the content width, with
  // one section's breathing room between the groups.
  content: {
    flexGrow: 1,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[16],
    gap: spacing[24],
  },
});
