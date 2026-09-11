import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { flushPreferencesSync } from '@/lib/preferences-store';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Foreground presentation, tap → recall deep link, and silent registration
  // upkeep. Never triggers a permission prompt (that stays behind the
  // explicit control on the Notifications screen).
  usePushNotifications();
  useEffect(() => {
    // Retry a preference sync that failed offline. Silent, launch never blocks.
    void flushPreferencesSync();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        {/* P2A: the three-destination bottom navigation (Feed, Saved,
            Profile). It is a route GROUP, so it owns no URL segment — Feed is
            still `/` and Profile still `/profile`. Its own header is hidden
            because the tab navigator inside renders one per destination;
            leaving both on would stack two headers.

            The C6 header entry to Profile is retired: Profile is a permanent
            tab now, so a second entry point from the feed header would be
            duplicate navigation. The `/profile` route itself is unchanged and
            every deep link to it still works. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Everything below is pushed OVER the tabs, deliberately: these are
            destinations you enter and leave, not places you switch between,
            and keeping them out of the group is what guarantees the bar can
            never grow a fourth item. */}
        <Stack.Screen name="recall/[id]" options={{ title: 'Recall Details' }} />
        {/* The former combined "Alerts" screen is now two pages. `/settings`
            survives as a redirect so existing deep links keep working. */}
        <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
        <Stack.Screen name="settings/personalization" options={{ title: 'Personalization' }} />
        <Stack.Screen name="settings/notifications" options={{ title: 'Notifications' }} />
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
