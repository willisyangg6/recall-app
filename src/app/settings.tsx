import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import type { AlertStatus } from '@/lib/alert-status';
import { disableRecallAlerts, enableRecallAlerts, getAlertStatus } from '@/lib/push-registration';

type ControlState =
  | { status: 'loading' }
  | { status: 'ready'; alerts: AlertStatus; busy: boolean; error: string | null };

/**
 * The smallest alerts control: one intentional enable action. The system
 * permission prompt fires only from the button below — never on app launch —
 * and a system-level denial routes to Settings instead of re-prompting.
 * (Phase C3 adds preferences — states, allergens, retailers — around this.)
 */
export default function SettingsScreen() {
  const [state, setState] = useState<ControlState>({ status: 'loading' });

  const load = useCallback(async () => {
    const alerts = await getAlertStatus();
    setState({ status: 'ready', alerts, busy: false, error: null });
  }, []);

  useEffect(() => {
    // Read-only status check on mount; resolves after the async gap.
    void load();
  }, [load]);

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
      <View style={styles.content}>
        <ThemedText type="subtitle">Recall alerts</ThemedText>
        <ThemedText themeColor="textSecondary">
          Get a push notification when a new recall is announced or an existing one changes in a way
          that matters — nothing else, no marketing.
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
            {state.error ? <ThemedText themeColor="textSecondary">{state.error}</ThemedText> : null}
          </>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
});
