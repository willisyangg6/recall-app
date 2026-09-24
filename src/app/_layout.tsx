import { useCallback, useEffect } from 'react';
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
import { AccessProvider, useAccess } from '@/hooks/use-access';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { onboardingDeclarationOrder, pushNavigationAllowed } from '@/lib/access-gate';
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
  useEffect(() => {
    // Retry a preference sync that failed offline. Silent, launch never blocks.
    void flushPreferencesSync();
  }, []);
  useEffect(() => {
    // A failed load is not a reason to stay blank: the app proceeds with the
    // platform's fallback face for any name it cannot resolve, and the failure
    // is named in development rather than hidden.
    if (fontError && __DEV__) console.warn('Design-system fonts failed to load', fontError);
  }, [fontError]);

  // The access gate reads in parallel with the fonts (P2B7X.1); the
  // navigator below renders nothing, and the splash stays, until both have
  // settled — so the first frame is the right phase, never a flash of the
  // wrong screen.
  return (
    <AccessProvider>
      <RootNavigator fontsSettled={fontsLoaded || fontError !== null} />
    </AccessProvider>
  );
}

/**
 * The root stack, gated (P2B7X.1).
 *
 * Every route sits in a `Stack.Protected` group whose guard is the access
 * phase it belongs to (lib/access-gate.ts). A protected screen is removed
 * from the navigator, so no tab, deep link, notification tap, gesture or
 * relaunch can reach it; when a phase changes underneath the current
 * screen, the navigator moves to the FIRST declared screen of the new
 * phase. That makes the ORDER here load-bearing, and `access-gate.test.ts`
 * pins it:
 *
 *   1. the paywall           the paywall phase's only screen
 *   2. notification education the education phase's only screen
 *   3. the app: `(tabs)` first, so the Feed is where an entitled launch
 *      (and a re-purchase after expiry) lands, then everything pushed over
 *      the tabs
 *   4. onboarding, with the RESUME step declared first — so a relaunch
 *      mid-onboarding opens on exactly the step that was showing, and the
 *      paywall's Back opens on the Preview
 *   5. the development hub, mounted in every phase of a development build
 *      and confined to the app phase (inert anyway) in a release build
 *
 * Nothing here navigates. The screens navigate only within their own
 * phase; the gate does the rest.
 */
function RootNavigator({ fontsSettled }: { fontsSettled: boolean }) {
  const access = useAccess();
  // Foreground presentation, tap → recall deep link, and silent registration
  // upkeep. Never triggers a permission prompt (that stays behind the
  // explicit controls on the Notifications screen and the education
  // screen), and never navigates before the app phase.
  const { phase } = access;
  usePushNotifications(useCallback(() => pushNavigationAllowed(phase), [phase]));

  const ready = fontsSettled && access.ready;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  // Under Reduce Motion every push and pop dissolves instead of sliding
  // (react-native-screens' own `fade`; the platform does not do this for a
  // native stack by itself). The interactive swipe back still follows the
  // finger. Until the setting is read the platform default stands.
  const reduceMotion = useReduceMotion();

  // Nothing renders under the splash until the fonts and the gate have settled.
  if (!ready) return null;

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
          animation: reduceMotion === true ? 'fade' : 'default',
        }}>
        {/* 1. The hard paywall: no header (its own back control returns to
            the Preview through the gate), no swipe (there is nothing beneath
            it to swipe to). */}
        <Stack.Protected guard={phase === 'paywall'}>
          <Stack.Screen name="paywall" options={{ headerShown: false, gestureEnabled: false }} />
        </Stack.Protected>

        {/* 2. Notification education, once, after entitlement success. */}
        <Stack.Protected guard={phase === 'education'}>
          <Stack.Screen
            name="onboarding/notifications"
            options={{ headerShown: false, gestureEnabled: false }}
          />
        </Stack.Protected>

        {/* 3. The app. */}
        <Stack.Protected guard={phase === 'app'}>
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
        </Stack.Protected>

        {/* 4. Onboarding: the resume step first. Each screen draws its own
            chrome (the progress line and the back control), so the
            navigator's header is off. */}
        <Stack.Protected guard={phase === 'onboarding'}>
          {onboardingDeclarationOrder(access.entryStep).map((name) => (
            <Stack.Screen key={name} name={name} options={{ headerShown: false }} />
          ))}
        </Stack.Protected>

        {/* 5. The development-only Design Preview hub. */}
        <Stack.Protected guard={__DEV__ || phase === 'app'}>
          <Stack.Screen name="design-preview/index" />
        </Stack.Protected>
      </Stack>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
