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
            // C6: the header entry now opens Profile, which links on to the
            // unchanged Settings screen. The /settings route itself (and any
            // deep link to it) is preserved exactly.
            headerRight: () => (
              <Link href="/profile" asChild>
                <Pressable accessibilityRole="button" accessibilityLabel="Profile" hitSlop={8}>
                  <ThemedText themeColor="link">Profile</ThemedText>
                </Pressable>
              </Link>
            ),
          }}
        />
        <Stack.Screen name="recall/[id]" options={{ title: 'Recall Details' }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="settings" options={{ title: 'Alerts' }} />
        {/* C7 trust documents: one reusable screen; each document sets its
            own title from the content registry. */}
        <Stack.Screen name="document/[slug]" options={{ title: 'About' }} />
        {/* P1D shopper-report questionnaire. Reachable from the Detail
            community block, which renders nothing while the server feature
            gate is off; a direct deep link lands on the screen's own "not
            available" state rather than on a form. */}
        <Stack.Screen name="report/[id]" options={{ title: 'Share a shopper report' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
