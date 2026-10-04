/**
 * `/onboarding/notifications` (P2B7X.1; outcomes 2026-10-04) — Screen 7,
 * notification education. Mounted ONLY in the education phase, which the
 * gate enters after a verified purchase or restore (lib/access-gate.ts), so
 * nothing on this screen can run before entitlement success.
 *
 * ## The permission rule
 *
 * `Turn on notifications` is the one press on this screen that reaches the
 * enable ports — the same `resolvePermission` / `register` pair the
 * Notifications screen uses, which prompts only when the system can still
 * ask (and once, as iOS governs). `Not now` calls nothing but the
 * completion: no read, no request, no registration.
 *
 * ## The outcomes
 *
 * The rules live in lib/notification-education-actions.ts. Granted and
 * registered → the Feed. Denied at the prompt → the Feed, with no enabled
 * claim. Denied before today → the blocked notice with `Open settings` and
 * `Continue without alerts`; a return from Settings re-checks ONLY because
 * the shopper opened them from here (`resume`, below), and registers only
 * if the permission now allows. Registration failed or too slow → the
 * failed notice with `Try again` and `Continue without alerts`. One attempt
 * at a time; a stale result after `Continue without alerts` changes
 * nothing; the education completes at most once, so the Feed's one-time
 * `Your preferences are set.` notice is unchanged.
 *
 * The only effect on mount subscribes to the app's active/background
 * changes and forwards them to `resume`, which the leaf ignores unless
 * Settings were opened from the enable flow. Nothing reads the permission
 * on mount or on focus.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { NotificationEducation } from '@/components/onboarding/notification-education';
import { useAccess } from '@/hooks/use-access';
import {
  educationActions,
  INITIAL_EDUCATION_VIEW,
  type EducationActions,
} from '@/lib/notification-education-actions';
import { educationEnablePorts } from '@/lib/notification-education-ports';

export default function NotificationEducationScreen() {
  const access = useAccess();
  const [view, setView] = useState(INITIAL_EDUCATION_VIEW);
  // Made at the FIRST press and kept, so its one-attempt guard and its
  // generation counter hold across every re-render that follows (busy, the
  // gate's own update, the foreground entitlement refresh).
  const actions = useRef<EducationActions | null>(null);
  const ready = () => {
    if (actions.current === null) {
      const ports = educationEnablePorts();
      actions.current = educationActions({
        resolvePermission: async () => (await ports).resolvePermission(),
        register: async (signal) => (await ports).register(signal),
        complete: () => access.completeNotificationEducation(),
        openSettings: () => void Linking.openSettings(),
        onView: setView,
        onError: (error) => {
          if (__DEV__) console.warn('Recall alerts could not be enabled during onboarding', error);
        },
      });
    }
    return actions.current;
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') actions.current?.resume();
    });
    return () => subscription.remove();
  }, []);

  return (
    <NotificationEducation
      view={view}
      onEnable={() => void ready().enable()}
      onSkip={() => void ready().skip()}
      onOpenSettings={() => ready().openSettings()}
    />
  );
}
