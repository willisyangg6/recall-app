/**
 * `/onboarding/edit-preferences` — the one-page Edit preferences
 * (2026-09-30), presented over Ready by Ready's `Edit preferences`. It is
 * not an onboarding step: it records no resume point, draws no progress,
 * and never replays States, Allergens, Stores or the building interstitial.
 *
 * It reads the saved preferences once, on opening, into one working draft
 * (lib/edit-preferences.ts). `Save changes` commits the draft once through
 * the canonical store's local-first `commitPreferences` — guarded against a
 * double tap, kept open with the draft intact on a failed local write — and
 * then returns directly to Ready, which already shows the saved choices and
 * recomputes its real preview from them. `Cancel` and Android's back return
 * to Ready having saved nothing. Onboarding completion, `watchBuilt`, the
 * installation, the paywall and any purchase are untouched either way.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { router } from 'expo-router';

import {
  EditPreferencesPending,
  EditPreferencesStep,
} from '@/components/onboarding/edit-preferences-step';
import {
  beginEditing,
  editorReducer,
  saveRequest,
  type EditorAction,
  type EditorState,
} from '@/lib/edit-preferences';
import { EDIT_SAVE_FAILED } from '@/lib/onboarding-copy';
import { commitPreferences, loadPreferences, preferencesAvailable } from '@/lib/preferences-store';

export default function EditPreferencesScreen() {
  const [state, setState] = useState<EditorState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    loadPreferences().then(
      (saved) => {
        if (current) setState(beginEditing(saved));
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const dispatch = useCallback((action: EditorAction) => {
    setState((prior) => (prior === null ? prior : editorReducer(prior, action)));
  }, []);

  // One save at a time, whatever the taps: the latch is released only by a
  // failure, which is the only way the page stays open after a save.
  const saving = useRef(false);
  const save = useCallback(() => {
    if (state === null || saving.current) return;
    const request = saveRequest(state);
    if (request === null) return;
    saving.current = true;
    dispatch({ type: 'save-started' });
    commitPreferences(request).then(
      () => router.back(),
      () => {
        saving.current = false;
        dispatch({ type: 'save-failed' });
        AccessibilityInfo.announceForAccessibility(EDIT_SAVE_FAILED);
      },
    );
  }, [dispatch, state]);

  if (state === null) {
    // Never an empty draft the store did not give; Cancel is always there.
    return (
      <EditPreferencesPending
        status={!preferencesAvailable() ? 'unsupported' : failed ? 'failed' : 'loading'}
        onCancel={() => router.back()}
      />
    );
  }
  return (
    <EditPreferencesStep
      state={state}
      onToggleState={(code) => dispatch({ type: 'toggle-state', code })}
      onToggleAllergen={(token) => dispatch({ type: 'toggle-allergen', token })}
      onClearAllergens={() => dispatch({ type: 'clear-allergens' })}
      onToggleStore={(id) => dispatch({ type: 'toggle-store', id })}
      onSave={save}
      onCancel={() => router.back()}
    />
  );
}
