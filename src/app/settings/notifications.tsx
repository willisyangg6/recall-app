/**
 * Notifications (P2A) — recall alerts for this device.
 *
 * What was the top of the former combined "Alerts" screen, now its own
 * destination so Profile can separate it from Personalization. The status
 * read, the enable/disable controls, the denied-permission path, and the
 * error handling are UNCHANGED.
 *
 * The permission prompt still fires from exactly one place: the "Enable
 * recall alerts" button below. Opening this screen only READS the current
 * status (`getAlertStatus`), which never prompts — so reaching Notifications
 * from Profile, or landing on it from the legacy `/settings` link, cannot
 * cost the user a permission dialog they did not ask for.
 *
 * Push DELIVERY itself remains deactivated on the server. This screen does
 * not claim otherwise: it says only whether alerts are on for this device.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import type { AlertStatus } from '@/lib/alert-status';
import { disableRecallAlerts, enableRecallAlerts, getAlertStatus } from '@/lib/push-registration';

type ControlState =
  | { status: 'loading' }
  | { status: 'ready'; alerts: AlertStatus; busy: boolean; error: string | null };

export default function NotificationsScreen() {
  const [state, setState] = useState<ControlState>({ status: 'loading' });

  const load = useCallback(async () => {
    const alerts = await getAlertStatus();
    setState({ status: 'ready', alerts, busy: false, error: null });
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Read-only status on every focus (not just mount): after the data
      // reset ran on the Privacy & Data Controls screen, popping back here
      // must show the cleared state, not a stale in-memory copy.
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
        prev.status === 'ready'
          ? {
              ...prev,
              busy: false,
              error: error instanceof Error ? error.message : 'Something went wrong.',
            }
          : prev,
      );
    }
  }, []);

  if (Platform.OS === 'web') {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.content}>
          <ThemedText type="subtitle">Recall alerts</ThemedText>
          <ThemedText themeColor="textSecondary">
            Push alerts are available in the Recall mobile app.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView style={styles.scroll}>
        <View style={styles.content}>
          <ThemedText type="subtitle">Recall alerts</ThemedText>
          <ThemedText themeColor="textSecondary">
            Get a push notification when a new recall is announced or an existing one changes in a
            way that matters — nothing else, no marketing.
          </ThemedText>

          {state.status === 'loading' ? (
            <ThemedText themeColor="textSecondary">Checking status…</ThemedText>
          ) : (
            <>
              {state.alerts === 'enabled' ? (
                <>
                  <ThemedText>Recall alerts are on for this device.</ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    disabled={state.busy}
                    onPress={() => run(disableRecallAlerts)}>
                    <ThemedView type="backgroundElement" style={styles.button}>
                      <ThemedText>{state.busy ? 'Working…' : 'Turn off alerts'}</ThemedText>
                    </ThemedView>
                  </Pressable>
                </>
              ) : state.alerts === 'denied' ? (
                <>
                  <ThemedText>
                    Notifications for Recall are turned off in your system settings.
                  </ThemedText>
                  <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}>
                    <ThemedView type="backgroundSelected" style={styles.button}>
                      <ThemedText style={styles.buttonEmphasis}>Open system settings</ThemedText>
                    </ThemedView>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={state.busy}
                  onPress={() => run(enableRecallAlerts)}>
                  <ThemedView type="backgroundSelected" style={styles.button}>
                    <ThemedText style={styles.buttonEmphasis}>
                      {state.busy ? 'Working…' : 'Enable recall alerts'}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              )}
              {state.error ? (
                <ThemedText themeColor="textSecondary">{state.error}</ThemedText>
              ) : null}
            </>
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            Which recalls you are alerted about follows your personalization — your state,
            allergens, and stores — which you set under Personalization.
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  content: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.medium,
  },
  buttonEmphasis: {
    fontWeight: '600',
  },
  footnote: {
    marginTop: Spacing.two,
  },
});
