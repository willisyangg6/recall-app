/**
 * `/onboarding/notifications` (P2B7X.1) — Screen 7, notification
 * education. Mounted ONLY in the education phase, which the gate enters
 * after a verified purchase or restore (lib/access-gate.ts), so nothing on
 * this screen can run before entitlement success.
 *
 * ## The permission rule
 *
 * `Turn on notifications` is the one press on this screen that reaches
 * `enableRecallAlerts` — the same single path the Notifications screen
 * uses, which prompts only when the system can still ask (and once, as iOS
 * governs). `Not now` calls nothing but the completion: no read, no
 * request, no registration. Both choices complete the education, and the
 * gate then opens the app; the Feed shows its one-time confirmation.
 *
 * An enable that fails (permission refused, a registration error) still
 * completes the education: alerts stay off, exactly as the Notifications
 * screen would report, and the shopper is not held on this screen. Nothing
 * here ever says alerts are on. Two known gaps, kept as they are and
 * recorded in docs/recall-push-delivery.md: a shopper who denied the
 * permission earlier gets no prompt and no explanation from `Turn on`, and a
 * registration error is swallowed (logged in development only).
 *
 * The rules live in lib/notification-education-actions.ts: one action per
 * visit, the first press of either takes the screen.
 */

import { useRef, useState } from 'react';

import { NotificationEducation } from '@/components/onboarding/notification-education';
import { useAccess } from '@/hooks/use-access';
import { educationActions } from '@/lib/notification-education-actions';
import { enableRecallAlerts } from '@/lib/push-registration';

export default function NotificationEducationScreen() {
  const access = useAccess();
  const [busy, setBusy] = useState(false);
  // Made at the FIRST press and kept, so its one-action guard holds across
  // every re-render that follows (busy, the gate's own update).
  const actions = useRef<ReturnType<typeof educationActions> | null>(null);

  const choose = (choice: 'enable' | 'skip') => {
    actions.current ??= educationActions({
      enable: enableRecallAlerts,
      complete: () => access.completeNotificationEducation(),
      onBusy: () => setBusy(true),
      onEnableError: (error) => {
        if (__DEV__) console.warn('Recall alerts could not be enabled during onboarding', error);
      },
    });
    void actions.current[choice]();
  };

  return (
    <NotificationEducation
      busy={busy}
      onEnable={() => choose('enable')}
      onSkip={() => choose('skip')}
    />
  );
}
