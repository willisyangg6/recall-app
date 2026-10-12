/**
 * App-level push wiring (native), mounted once in the root layout:
 *
 * - Foreground presentation: the system banner/list shows even with the app
 *   open (no custom in-app duplicate), per Expo's current handler API.
 * - Tap navigation: `useLastNotificationResponse` covers cold launch (the tap
 *   that started the app), background, and foreground taps with one code
 *   path. The payload is validated (src/lib/push-payload.ts) and the typed
 *   route is constructed internally — a push can never steer the app to an
 *   arbitrary URL. A recall id that no longer resolves lands on the detail
 *   screen's built-in "not found" state, never a crash.
 * - Silent registration upkeep on launch and on Expo token rotation
 *   (idempotent server-side; no permission prompt is ever triggered here).
 *
 * ## The gate (P2B7X.1) and the waiting tap (2026-10-10)
 *
 * A tap navigates only once the access gate has settled, the phase is `app`
 * (`pushNavigationAllowed`) and the navigator can take a route. Until then
 * the tap WAITS in memory (lib/push-tap-intent.ts) instead of being consumed:
 * on a cold launch the launch response is read at mount, before the gate has
 * read onboarding and entitlement, and deciding then sent every cold-launch
 * tap to the Feed. Before onboarding is complete, or while the paywall or
 * the education stands, the waiting tap opens nothing — Recall Details is a
 * protected route there and the hook does not rely on the navigator to
 * refuse it — so a notification is never the door around the paywall.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigationContainerRef, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';

import type { AccessPhase } from '@/lib/access-gate';
import { createPushTapIntent } from '@/lib/push-tap-intent';
import { refreshRegistrationIfEnabled } from '@/lib/push-registration';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications(accessReady: boolean, phase: AccessPhase): void {
  const router = useRouter();
  const navigationRef = useNavigationContainerRef();
  // One intent for the app's lifetime, created once (never read from a ref in render).
  const [intent] = useState(createPushTapIntent);
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    void refreshRegistrationIfEnabled();
    const subscription = Notifications.addPushTokenListener(() => {
      void refreshRegistrationIfEnabled();
    });
    return () => subscription.remove();
  }, []);

  // Open the waiting recall if, and only if, everything it needs is settled.
  const openIfAllowed = useCallback(() => {
    const recallCaseId = intent.take({
      ready: accessReady,
      phase,
      navigatorReady: navigationRef.isReady(),
    });
    if (recallCaseId === null) return;
    router.push({ pathname: '/recall/[id]', params: { id: recallCaseId } });
  }, [intent, accessReady, phase, navigationRef, router]);

  useEffect(() => {
    if (response) {
      intent.offer(
        response.notification.request.identifier,
        response.notification.request.content.data,
      );
    }
    openIfAllowed();
  }, [response, intent, openIfAllowed]);

  // The navigator can become ready after the gate settles (it mounts only
  // then); its own events retry the waiting tap.
  useEffect(() => {
    const removeReady = navigationRef.addListener('ready', openIfAllowed);
    const removeState = navigationRef.addListener('state', openIfAllowed);
    return () => {
      removeReady();
      removeState();
    };
  }, [navigationRef, openIfAllowed]);
}
