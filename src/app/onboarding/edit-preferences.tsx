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
 * to Ready having saved nothing — and are locked for the milliseconds a save
 * is in flight, so a draft can never be half-written and abandoned, and a
 * save's answer never pops a page that has already gone (2026-10-04). Onboarding completion, `watchBuilt`, the
 * installation, the paywall and any purchase are untouched either way.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

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
import {
  commitPreferences,
  loadPreferencesSettled,
  preferencesAvailable,
} from '@/lib/preferences-store';

export default function EditPreferencesScreen() {
  const [state, setState] = useState<EditorState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    // Read AFTER every write already requested has landed, so a toggle still
    // in the queue when the page opened can never be missed here and then
    // reverted by Save (2026-10-04).
    loadPreferencesSettled().then(
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
  // Whether this page is still the one on screen: a save that lands after
  // the page has already gone (it cannot, while Cancel is locked during a
  // save — but a late answer must never pop Ready too) navigates nowhere.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      // Android's back is Cancel: locked while a save is in flight, so the
      // draft being written is never abandoned half-way (2026-10-04).
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        if (saving.current) return true;
        router.back();
        return true;
      });
      return () => {
        focused.current = false;
        back.remove();
      };
    }, []),
  );
  const save = useCallback(() => {
    if (state === null || saving.current) return;
    const request = saveRequest(state);
    if (request === null) return;
    saving.current = true;
    dispatch({ type: 'save-started' });
    commitPreferences(request).then(
      () => {
        if (focused.current) router.back();
      },
      () => {
        saving.current = false;
        dispatch({ type: 'save-failed' });
        AccessibilityInfo.announceForAccessibility(EDIT_SAVE_FAILED);
      },
    );
  }, [dispatch, state]);
  // Cancel is locked while a save is in flight: the page stays until the
  // local write has answered (milliseconds), then leaves on its own.
  const cancel = useCallback(() => {
    if (!saving.current) router.back();
  }, []);

  if (state === null) {
    // Never an empty draft the store did not give; Cancel is always there.
    return (
      <EditPreferencesPending
        status={!preferencesAvailable() ? 'unsupported' : failed ? 'failed' : 'loading'}
        onCancel={cancel}
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
      onCancel={cancel}
    />
  );
}
