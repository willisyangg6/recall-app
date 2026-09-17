/**
 * The root error boundary (P3C1) — what a shopper sees if a render throws.
 *
 * Expo Router mounts this from the root layout's `ErrorBoundary` export, so
 * it covers every screen in the app. It is deliberately the plainest
 * component in the repository, because it runs precisely when something else
 * has already failed:
 *
 * - **No safe-area, navigation, theme, or store context.** A boundary that
 *   read a context its own failed parent was supposed to provide would throw
 *   inside the fallback and leave the shopper on a blank screen. The content
 *   is centred in a full-screen view, so insets do not change what is
 *   readable, and the only imports are React Native, the tokens, and the two
 *   presentational primitives.
 * - **No network, no storage, no logging service.** Nothing here can fail.
 * - **The splash is dismissed here too.** `_layout.tsx` calls
 *   `preventAutoHideAsync()` at module scope and hides the splash from an
 *   effect once the fonts settle. If the layout throws before that effect
 *   runs, the native splash would otherwise stay up forever and hide this
 *   screen; hiding it here is what makes the failure visible at all.
 *
 * ## What the shopper is told, and what they are not
 *
 * The title, the sentence and the action come from `lib/error-boundary-copy`.
 * The `error` is never rendered: no message, no stack, no component trace, no
 * server response, no configuration value. In a development build the whole
 * error goes to the console, where the founder and the debugger can see it;
 * `__DEV__` is false in a release build, so that call never runs there.
 *
 * Retry is Expo Router's own `retry()`, which clears the boundary's error
 * state and re-renders the tree. It is safe to offer for the common case
 * this catches — a transient render failure — and if the failure is
 * deterministic the boundary simply catches it again and the copy's second
 * suggestion (reopen the app) applies.
 */

import { useEffect } from 'react';
import { type ErrorBoundaryProps } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { color, spacing } from '@/constants/design-tokens';
import {
  CRASH_ACCESSIBILITY_LABEL,
  CRASH_BODY,
  CRASH_RETRY_ACTION,
  CRASH_RETRY_HINT,
  CRASH_TITLE,
} from '@/lib/error-boundary-copy';

export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    // Development diagnostics: the whole error, preserved, where a developer
    // looks for it. Never runs in a release build.
    if (__DEV__) console.error('Lotly render failed', error);
    // Without this the native splash can outlive the crash and cover the
    // screen below (see the note above). A failure to hide is not worth a
    // second crash inside the boundary.
    void SplashScreen.hideAsync().catch(() => {});
  }, [error]);

  return (
    <View style={styles.screen}>
      <View accessible accessibilityRole="alert" accessibilityLabel={CRASH_ACCESSIBILITY_LABEL}>
        <Text variant="heading-3" style={styles.text}>
          {CRASH_TITLE}
        </Text>
        <Text variant="body-small" color="text/secondary" style={[styles.text, styles.body]}>
          {CRASH_BODY}
        </Text>
      </View>
      <Button
        label={CRASH_RETRY_ACTION}
        accessibilityHint={CRASH_RETRY_HINT}
        onPress={() => {
          void retry();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing[24],
    padding: spacing[24],
    backgroundColor: color['background/page'],
  },
  text: {
    textAlign: 'center',
  },
  body: {
    marginTop: spacing[8],
  },
});
