/**
 * The Notifications screen's status and action (P2B6A), drawn from the
 * system and free of any permission API: the route reads the status and
 * runs the operations; this panel is handed what it is showing and three
 * callbacks, which is what lets the Design Preview render every permission
 * state without asking the operating system anything.
 *
 * The status is the soft-blue information callout with one truthful
 * sentence for the current state, and beneath it the one action that state
 * allows, as the shared Button — primary for the explicit enable (the only
 * place the system prompt can fire) and for the system-settings pointer,
 * secondary for turning alerts off. While a read is in flight there is a
 * plain checking line and no control, so nothing can pass for a disabled
 * one; a failed operation reads beneath the action as an alert, in the same
 * bordered treatment the questionnaire gives a refused submission. The web
 * gets the shared state message and no control at all.
 */

import { StyleSheet, View } from 'react-native';

import { StateMessage } from '@/components/state-message';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';
import {
  notificationsPresentation,
  UNSUPPORTED_STATE,
  type NotificationsActionKind,
  type NotificationsView,
} from '@/lib/notifications-screen';

export function NotificationsPanel({
  view,
  onEnable,
  onDisable,
  onOpenSettings,
}: {
  view: NotificationsView;
  /** The explicit enable — the caller's, and the one path to the system prompt. */
  onEnable: () => void;
  onDisable: () => void;
  onOpenSettings: () => void;
}) {
  if (view.status === 'unsupported') {
    return (
      <StateMessage
        scrollable={false}
        title={UNSUPPORTED_STATE.title}
        body={UNSUPPORTED_STATE.body}
      />
    );
  }

  const shown = notificationsPresentation(view);
  const handlers: Record<NotificationsActionKind, () => void> = {
    enable: onEnable,
    disable: onDisable,
    settings: onOpenSettings,
  };

  return (
    <View style={styles.panel}>
      {shown.busy ? (
        <Text
          variant="body-small"
          color="text/secondary"
          accessibilityLiveRegion="polite"
          accessibilityState={{ busy: true }}>
          {shown.message}
        </Text>
      ) : (
        <Callout tone="information">{shown.message}</Callout>
      )}

      {shown.action ? (
        <Button
          label={shown.action.label}
          variant={shown.action.variant}
          busy={view.status === 'ready' && view.busy && shown.action.busyLabel !== null}
          busyLabel={shown.action.busyLabel ?? undefined}
          accessibilityHint={shown.action.hint ?? undefined}
          onPress={handlers[shown.action.kind]}
        />
      ) : null}

      {shown.error ? (
        <Surface
          radius={8}
          border="border/strong"
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.failure}>
          <Text variant="body-small">{shown.error}</Text>
        </Surface>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing[12],
  },
  failure: {
    padding: spacing[12],
  },
});
