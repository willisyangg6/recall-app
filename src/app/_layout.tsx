import { useEffect } from 'react';
import { IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import {
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
} from '@expo-google-fonts/public-sans';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { color, textStyle } from '@/constants/design-tokens';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { flushPreferencesSync } from '@/lib/preferences-store';

/**
 * The app-wide error boundary (P3C1). Expo Router looks for this exact export
 * name on a route; exporting it from the ROOT layout is what makes it cover
 * every screen rather than one. The component lives in its own file so the
 * fallback shares none of this module's imports — see the note there.
 */
export { AppErrorBoundary as ErrorBoundary };

// Keep the native splash up until the fonts below have loaded (or failed), so
// the first screen never paints in a stand-in face and then reflows. Called at
// module scope, as expo-splash-screen recommends — inside a component it can
// run after the splash has already gone.
void SplashScreen.preventAutoHideAsync();

/**
 * The spoken name of every pushed screen's back control (P2B2). The screens
 * beneath the stack are the `(tabs)` route GROUP, which has no title of its
 * own, so the platform used to fall back to the group's name and the back
 * control read "(tabs)". The control is now the platform chevron alone
 * (`headerBackButtonDisplayMode: 'minimal'`, the design's back affordance)
 * and this is what a screen reader and the long-press back menu call it —
 * "Back" rather than the name of whichever tab the reader came from, because
 * the group returns to whichever tab was active.
 */
const BACK_LABEL = 'Back';

export default function RootLayout() {
  // The six faces the design contract uses (DESIGN.md, "Typography"), loaded
  // once for the whole app. The keys are the names `textStyle` emits as
  // `fontFamily`, so a token and its face can never disagree.
  const [fontsLoaded, fontError] = useFonts({
    PublicSans_400Regular,
    PublicSans_500Medium,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  // Foreground presentation, tap → recall deep link, and silent registration
  // upkeep. Never triggers a permission prompt (that stays behind the
  // explicit control on the Notifications screen).
  usePushNotifications();
  useEffect(() => {
    // Retry a preference sync that failed offline. Silent, launch never blocks.
    void flushPreferencesSync();
  }, []);
  useEffect(() => {
    // A failed load is not a reason to stay blank: the app proceeds with the
    // platform's fallback face for any name it cannot resolve, and the failure
    // is named in development rather than hidden.
    if (fontError && __DEV__) console.warn('Design-system fonts failed to load', fontError);
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // Nothing renders under the splash until the fonts have settled either way.
  if (!fontsLoaded && !fontError) return null;

  // The pushed screens' header is navigation chrome the navigator owns, so
  // it is styled here from the tokens exactly as the tab layout styles the
  // Feed's: the page colour, no shadow, `heading-3` for the title, the
  // action colour for the back chevron.
  const { fontFamily, fontSize, fontWeight } = textStyle('heading-3');

  return (
    // Light appearance only (founder decision, 2026-09-14): dark mode is
    // deferred until it has approved tokens and designs, so the navigation
    // theme is pinned to light here and the app's `userInterfaceStyle` is
    // `light` in app.json. There is no toggle and no dark palette.
    <ThemeProvider value={DefaultTheme}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: color['background/page'] },
          headerShadowVisible: false,
          headerTintColor: color['action/primary'],
          headerTitleStyle: { fontFamily, fontSize, fontWeight, color: color['text/primary'] },
          headerBackButtonDisplayMode: 'minimal',
          headerBackTitle: BACK_LABEL,
        }}>
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
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
