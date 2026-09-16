/**
 * Notifications (P2A structure, P2B6A design) — recall alerts for this
 * device.
 *
 * The route reads the status and runs the operations; what it shows is
 * drawn by components/settings/notifications-panel.tsx, which is handed the
 * current view and three callbacks. The status read, the enable/disable
 * controls, the denied-permission path, and the error handling are
 * UNCHANGED from the combined "Alerts" screen this was split out of.
 *
 * The permission prompt still fires from exactly one place: the "Enable
 * recall alerts" action, through the `run` call below. Opening
 * this screen only READS the current status (`getAlertStatus`), which never
 * prompts — so reaching Notifications from Profile, or landing on it from
 * the legacy `/settings` link, cannot cost the user a permission dialog they
 * did not ask for. The status is re-read on every focus (not just mount):
 * after the data reset ran on the Privacy & Data Controls screen, popping
 * back here must show the cleared state, not a stale in-memory copy.
 *
 * Push DELIVERY itself remains deactivated on the server. This screen does
 * not claim otherwise: it says only whether alerts are on for this device.
 *
 * The header is the navigator's own `Notifications` title, styled by the
 * root stack from the tokens; there is no second heading on the page.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Linking, Platform, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationsPanel } from '@/components/settings/notifications-panel';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { layout, spacing } from '@/constants/design-tokens';
import type { AlertStatus } from '@/lib/alert-status';
import {
  failureMessage,
  NOTIFICATIONS_FOOTNOTE,
  NOTIFICATIONS_INTRO,
  type NotificationsView,
} from '@/lib/notifications-screen';
import { disableRecallAlerts, enableRecallAlerts, getAlertStatus } from '@/lib/push-registration';

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<NotificationsView>({ status: 'loading' });

  const load = useCallback(async () => {
    const alerts = await getAlertStatus();
    setState({ status: 'ready', alerts, busy: false, error: null });
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Read-only status on every focus.
      void load();
    }, [load]),
  );

  const run = useCallback(async (action: () => Promise<AlertStatus>) => {
    setState((prev) => (prev.status === 'ready' ? { ...prev, busy: true, error: null } : prev));
    try {
      const alerts = await action();
      setState({ status: 'ready', alerts, busy: false, error: null });
    } catch (error) {
      setState((prev) =>
        prev.status === 'ready' ? { ...prev, busy: false, error: failureMessage(error) } : prev,
      );
    }
  }, []);

  // Push alerts are a mobile-app capability; the web gets the message alone.
  const view: NotificationsView = Platform.OS === 'web' ? { status: 'unsupported' } : state;

  return (
    <Surface background="background/page" style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing[24] + insets.bottom }]}>
        {view.status !== 'unsupported' ? (
          <Text variant="body-small" color="text/secondary">
            {NOTIFICATIONS_INTRO}
          </Text>
        ) : null}

        <NotificationsPanel
          view={view}
          onEnable={() => run(enableRecallAlerts)}
          onDisable={() => run(disableRecallAlerts)}
          onOpenSettings={() => void Linking.openSettings()}
        />

        {view.status !== 'unsupported' ? (
          <Text variant="caption" color="text/secondary">
            {NOTIFICATIONS_FOOTNOTE}
          </Text>
        ) : null}
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
  content: {
    flexGrow: 1,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[16],
    gap: spacing[16],
  },
});
