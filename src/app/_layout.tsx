import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Link, Stack, ThemeProvider } from 'expo-router';
import { Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { flushPreferencesSync } from '@/lib/preferences-store';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Foreground presentation, tap → recall deep link, and silent registration
  // upkeep. Never triggers a permission prompt (that stays behind the
  // explicit control in Settings → Alerts).
  usePushNotifications();
  useEffect(() => {
    // Retry a preference sync that failed offline. Silent, launch never blocks.
    void flushPreferencesSync();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen
          name="index"
          options={{
            title: 'Recall Alerts',
            headerRight: () => (
              <Link href="/settings" asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Alert settings"
                  hitSlop={8}>
                  <ThemedText themeColor="link">Alerts</ThemedText>
                </Pressable>
              </Link>
            ),
          }}
        />
        <Stack.Screen name="recall/[id]" options={{ title: 'Recall Details' }} />
        <Stack.Screen name="settings" options={{ title: 'Alerts' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
