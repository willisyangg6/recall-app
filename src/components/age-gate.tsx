/**
 * The launch age gate (age assurance, 2026-10-13). The root layout renders
 * everything that can reach a server — the preference mirror, the daily
 * check-in, push upkeep, and the access provider that configures RevenueCat
 * — as this component's children, so none of it mounts until
 * lib/age-assurance.ts has decided the launch may proceed.
 *
 * - **Proceed:** the children render; they hide the splash as before.
 * - **Pending:** the splash stays up for `SPLASH_HOLD_MS`, which covers
 *   Apple's cached answer on an ordinary launch. Past that (the first
 *   launch, where Apple shows its own sharing sheet) the splash gives way
 *   to a short explanation beneath Apple's sheet.
 * - **Under 13:** a stop screen with no way forward. Nothing beneath it
 *   ever mounts. If this device registered for alerts before (an earlier
 *   account on the same iPhone), the stop makes ONE protective request:
 *   the existing sequenced alert disable, carrying only the stored
 *   installation id (lib/push-registration.ts `disableAlertsAfterAgeStop`;
 *   lib/age-stop-alerts.ts). No age, no RevenueCat, no other launch sync.
 *   Unconfirmed (offline) it stays owed in SecureStore and is sent again at
 *   every launch until the server confirms. It also unregisters from
 *   Apple's push service, locally. Until the disable is confirmed the server
 *   row stays enabled, and an alert already handed to Expo cannot be
 *   recalled — docs/recall-push-delivery.md, "When the server stops alerts".
 * - **Retry:** Apple's service did not answer and the account may be
 *   regulated: Try again, and nothing beneath it mounts meanwhile.
 *
 * Like the error boundary it uses no navigation, safe-area or store context:
 * it renders before the navigator exists.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { color, spacing } from '@/constants/design-tokens';
import { runAgeCheck, type AgeDecision } from '@/lib/age-assurance';
import {
  AGE_CHECKING_BODY,
  AGE_CHECKING_TITLE,
  AGE_RETRY_ACTION,
  AGE_RETRY_BODY_NOT_SIGNED_IN,
  AGE_RETRY_BODY_UNAVAILABLE,
  AGE_RETRY_HINT,
  AGE_RETRY_TITLE,
  AGE_UNDER13_BODY,
  AGE_UNDER13_TITLE,
} from '@/lib/age-gate-copy';
import { createAgeCheckPorts } from '@/lib/age-range-service';
import { disableAlertsAfterAgeStop } from '@/lib/push-registration';

type DevelopmentScenario = typeof import('@/lib/development-age-scenario');
type DevelopmentProbe = typeof import('@/lib/development-revocation-probe');

/** Development only: a forced outcome for each screen, and the revocation probe. */
const developmentScenario = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/lib/development-age-scenario') as DevelopmentScenario)
  : null;
const developmentProbe = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/lib/development-revocation-probe') as DevelopmentProbe)
  : null;

/** How long the splash may hold for Apple's answer before the gate explains itself. */
export const SPLASH_HOLD_MS = 1500;

type GateState = { kind: 'pending'; explain: boolean } | AgeDecision;

function decide(): Promise<AgeDecision> {
  const scenario = developmentScenario?.developmentAgeScenario() ?? null;
  if (scenario === 'pending') return new Promise(() => {});
  if (scenario !== null) return Promise.resolve(scenario);
  return runAgeCheck(createAgeCheckPorts());
}

export function AgeGate({
  fontsSettled,
  children,
}: {
  fontsSettled: boolean;
  children: ReactNode;
}) {
  const [state, setState] = useState<GateState>({ kind: 'pending', explain: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    const hold = setTimeout(() => {
      if (current)
        setState((prior) => (prior.kind === 'pending' ? { ...prior, explain: true } : prior));
    }, SPLASH_HOLD_MS);
    void decide().then((decision) => {
      if (current) setState(decision);
    });
    return () => {
      current = false;
      clearTimeout(hold);
    };
  }, [attempt]);

  const proceeding = state.kind === 'proceed';
  const visible = !proceeding && fontsSettled && (state.kind !== 'pending' || state.explain);
  useEffect(() => {
    // The gate's own screens are the first thing shown; the children hide
    // the splash themselves once they are ready.
    if (visible) void SplashScreen.hideAsync().catch(() => {});
  }, [visible]);
  useEffect(() => {
    if (proceeding) developmentProbe?.runRevocationProbe();
  }, [proceeding]);
  const under13 = state.kind === 'under13';
  useEffect(() => {
    if (!under13) return;
    // The one protective request (installation id only), then the local
    // APNs unregister. Neither ever surfaces an error on the stop screen.
    void disableAlertsAfterAgeStop().catch(() => {});
    void Notifications.unregisterForNotificationsAsync().catch(() => {});
  }, [under13]);

  const retry = useCallback(() => {
    setState({ kind: 'pending', explain: true });
    setAttempt((count) => count + 1);
  }, []);

  if (proceeding) return children;
  if (!visible) return null;

  if (state.kind === 'under13') {
    return <AgeMessage title={AGE_UNDER13_TITLE} body={AGE_UNDER13_BODY} />;
  }
  if (state.kind === 'retry') {
    return (
      <AgeMessage
        title={AGE_RETRY_TITLE}
        body={
          state.reason === 'not-signed-in'
            ? AGE_RETRY_BODY_NOT_SIGNED_IN
            : AGE_RETRY_BODY_UNAVAILABLE
        }>
        <Button label={AGE_RETRY_ACTION} accessibilityHint={AGE_RETRY_HINT} onPress={retry} />
      </AgeMessage>
    );
  }
  return (
    <AgeMessage title={AGE_CHECKING_TITLE} body={AGE_CHECKING_BODY}>
      <ActivityIndicator color={color['text/secondary']} />
    </AgeMessage>
  );
}

function AgeMessage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.screen}>
      <View>
        <Text variant="heading-3" accessibilityRole="header" style={styles.text}>
          {title}
        </Text>
        <Text variant="body-small" color="text/secondary" style={[styles.text, styles.body]}>
          {body}
        </Text>
      </View>
      {children}
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
