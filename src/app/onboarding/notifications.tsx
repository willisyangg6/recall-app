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
 * screen would report, and the shopper is not held on this screen.
 */

import { useState } from 'react';

import { NotificationEducation } from '@/components/onboarding/notification-education';
import { useAccess } from '@/hooks/use-access';
import { enableRecallAlerts } from '@/lib/push-registration';

export default function NotificationEducationScreen() {
  const access = useAccess();
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await enableRecallAlerts();
    } catch (error) {
      if (__DEV__) console.warn('Recall alerts could not be enabled during onboarding', error);
    } finally {
      await access.completeNotificationEducation();
    }
  };

  const skip = () => {
    if (busy) return;
    void access.completeNotificationEducation();
  };

  return <NotificationEducation busy={busy} onEnable={() => void enable()} onSkip={skip} />;
}
