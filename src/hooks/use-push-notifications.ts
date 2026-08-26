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
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { parseRecallPushPayload } from '@/lib/push-payload';
import { refreshRegistrationIfEnabled } from '@/lib/push-registration';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications(): void {
  const router = useRouter();
  const handledResponseId = useRef<string | null>(null);
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    void refreshRegistrationIfEnabled();
    const subscription = Notifications.addPushTokenListener(() => {
      void refreshRegistrationIfEnabled();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!response) return;
    const identifier = response.notification.request.identifier;
    if (identifier === handledResponseId.current) return;
    handledResponseId.current = identifier;
    const payload = parseRecallPushPayload(response.notification.request.content.data);
    if (!payload) return; // Unknown/test/malformed payloads never navigate.
    router.push({ pathname: '/recall/[id]', params: { id: payload.recallCaseId } });
  }, [response, router]);
}
