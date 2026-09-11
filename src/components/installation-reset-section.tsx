/**
 * The destructive "Reset app and delete my data" section (C7.1), rendered at
 * the bottom of the Privacy & Data Controls document — deliberately the only
 * place it exists (the frozen product decision: no separate Profile row, no
 * prominent personalization-reset duplicate).
 *
 * Flow: tap → native confirmation dialog (Cancel mutates NOTHING — the run
 * starts only from the destructive "Delete data" button) → the queued
 * orchestrator (lib/installation-reset*) → inline success or retryable
 * failure. The button disables while a run is in flight, so a double tap
 * cannot start two runs — and the shared mutation queue would serialize them
 * harmlessly even if one slipped through.
 *
 * All copy comes from lib/installation-reset.ts (a tested contract shared
 * with the document text); this file is layout and state only.
 */

import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import { forgetSavedRecallsCache } from '@/hooks/use-saved-recalls';
import {
  RESET_ACTION_LABEL,
  RESET_CONFIRM_BODY,
  RESET_CONFIRM_CANCEL,
  RESET_CONFIRM_DELETE,
  RESET_CONFIRM_TITLE,
  RESET_FAILURE_MESSAGE,
  RESET_SUCCESS_MESSAGE,
  RESET_SUPPORTING_COPY,
} from '@/lib/installation-reset';
import { resetAvailable, runInstallationReset } from '@/lib/installation-reset-runner';

type ResetUiState = 'idle' | 'running' | 'deleted' | 'failed';

export function InstallationResetSection() {
  const [state, setState] = useState<ResetUiState>('idle');

  if (!resetAvailable()) return null;

  const run = async () => {
    // Belt over the queue's braces: never start a second run from the UI.
    setState((prior) => (prior === 'running' ? prior : 'running'));
    const result = await runInstallationReset();
    // The orchestrator cleared the stored saved-recall list; drop the shared
    // in-memory copy too, so every mounted screen re-renders empty instead of
    // showing deleted bookmarks until the next launch.
    if (result.status === 'deleted') forgetSavedRecallsCache();
    setState(result.status === 'deleted' ? 'deleted' : 'failed');
  };

  const confirm = () => {
    if (state === 'running') return;
    Alert.alert(RESET_CONFIRM_TITLE, RESET_CONFIRM_BODY, [
      // Cancel performs absolutely no mutation: it only dismisses the dialog.
      { text: RESET_CONFIRM_CANCEL, style: 'cancel' },
      { text: RESET_CONFIRM_DELETE, style: 'destructive', onPress: () => void run() },
    ]);
  };

  return (
    <View style={styles.section}>
      <ThemedText type="small" themeColor="textSecondary" accessibilityRole="header">
        DELETE MY DATA
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" selectable>
        {RESET_SUPPORTING_COPY}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={RESET_ACTION_LABEL}
        accessibilityState={{ disabled: state === 'running', busy: state === 'running' }}
        disabled={state === 'running'}
        onPress={confirm}>
        <ThemedView type="backgroundElement" style={styles.button}>
          <ThemedText style={styles.buttonLabel}>
            {state === 'running' ? 'Deleting…' : RESET_ACTION_LABEL}
          </ThemedText>
        </ThemedView>
      </Pressable>
      {state === 'deleted' ? (
        <ThemedText type="small" accessibilityLiveRegion="polite">
          {RESET_SUCCESS_MESSAGE}
        </ThemedText>
      ) : null}
      {state === 'failed' ? (
        <ThemedText type="small" accessibilityLiveRegion="polite">
          {RESET_FAILURE_MESSAGE}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Visual separation from the informational content above: extra distance
  // plus a hairline rule — provisional language only, no new colors.
  section: {
    marginTop: Spacing.four,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8888',
    gap: Spacing.two,
  },
  button: {
    alignSelf: 'flex-start',
    // Generous padding keeps the touch target comfortably above 44pt.
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.medium,
  },
  buttonLabel: {
    fontWeight: '600',
  },
});
