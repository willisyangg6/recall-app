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
 * Appearance (P2B6B): set apart from the document above it by a rule and
 * `spacing/32` of air, then a content section heading (`Delete my data`)
 * over one white `radius/12` panel with the strong border — the system's
 * existing emphasis border, the same one the development entry uses to
 * stand apart — holding the consequence sentence FIRST, then the one action
 * as the shared secondary Button, then the outcome. Danger is carried by
 * the words (the heading, the label, the dialog), never by a colour: no
 * risk token is borrowed and no destructive token was added, because the
 * words, the border and the platform's own destructive dialog already say
 * it. Busy is the Button's own busy state with its progress word.
 *
 * `ResetPanel` is the whole appearance with its state handed in, so the
 * development gallery can show every state without being able to start a
 * run; `InstallationResetSection` is the only thing that wires it to the
 * runner. All copy comes from lib/installation-reset.ts (a tested contract
 * shared with the document text) and lib/document-screen.ts; this file is
 * layout and state only.
 */

import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, spacing } from '@/constants/design-tokens';
import { forgetSavedRecallsCache } from '@/hooks/use-saved-recalls';
import { RESET_BUSY_LABEL, RESET_HEADING } from '@/lib/document-screen';
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

export type ResetUiState = 'idle' | 'running' | 'deleted' | 'failed';

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

  return <ResetPanel state={state} onPress={confirm} />;
}

/** The section's whole appearance in one state; the press is the caller's. */
export function ResetPanel({ state, onPress }: { state: ResetUiState; onPress: () => void }) {
  return (
    <View style={styles.section}>
      <Text variant="heading-3" accessibilityRole="header">
        {RESET_HEADING}
      </Text>
      <Surface radius={12} border="border/strong" style={styles.panel}>
        <Text variant="body-small" selectable>
          {RESET_SUPPORTING_COPY}
        </Text>
        <Button
          variant="secondary"
          label={RESET_ACTION_LABEL}
          busy={state === 'running'}
          busyLabel={RESET_BUSY_LABEL}
          disabled={state === 'running'}
          onPress={onPress}
        />
        {state === 'deleted' ? (
          <Text variant="body-small" accessibilityLiveRegion="polite">
            {RESET_SUCCESS_MESSAGE}
          </Text>
        ) : null}
        {state === 'failed' ? (
          <Text variant="body-small" accessibilityLiveRegion="polite">
            {RESET_FAILURE_MESSAGE}
          </Text>
        ) : null}
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  // Apart from the document: a rule, then the section's own air.
  section: {
    marginTop: spacing[32],
    paddingTop: spacing[24],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color['border/default'],
    gap: spacing[12],
  },
  panel: {
    padding: spacing[16],
    gap: spacing[12],
  },
});
