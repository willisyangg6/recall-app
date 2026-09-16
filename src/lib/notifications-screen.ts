/**
 * The Notifications screen's copy and its status → presentation mapping
 * (P2B6A), Expo-free so the "never harass" rules stay provable in Node:
 *
 *   loading      a plain checking line, no action — nothing that could pass
 *                for a disabled control
 *   not_enabled  alerts are off here; the one primary action is the explicit
 *                enable, the only place the system prompt can fire
 *   enabled      on for this device; the secondary action turns them off
 *   denied       the system permission is denied and cannot be re-asked; the
 *                action opens system settings instead of re-prompting
 *   unsupported  the web: a message and no control at all
 *
 * The status sentence never says more than the app knows: "on for this
 * device" means permission granted AND this installation registered, never
 * that a delivery has happened (push delivery stays deactivated on the
 * server). The permission mapping itself is `alertStatus` in
 * lib/alert-status.ts and is unchanged. The sentences are the founder's
 * approved copy (P2B6A follow-up) and follow DESIGN.md "Consumer copy".
 */

import type { AlertStatus } from './alert-status';

/** What the screen is showing: the read's answer plus the one in-flight action. */
export type NotificationsView =
  | { status: 'loading' }
  | { status: 'unsupported' }
  | { status: 'ready'; alerts: AlertStatus; busy: boolean; error: string | null };

// ── Copy ────────────────────────────────────────────────────────────────────

export const NOTIFICATIONS_INTRO =
  'Get alerts when a relevant recall is announced or changes. Lotly does not send marketing notifications.';

export const NOTIFICATIONS_FOOTNOTE =
  'Lotly uses your state, allergens, and stores to decide which recall alerts to send.';

export const CHECKING_STATUS = 'Checking status…';

export const STATUS_OFF =
  'Alerts are off for this device. You will not receive notifications until you turn them on.';
export const STATUS_ON = 'Recall alerts are on for this device.';
export const STATUS_DENIED =
  'Notifications for Lotly are turned off in your device settings. Allow them there, then return to Lotly to turn on alerts.';

export const UNSUPPORTED_STATE = {
  title: 'Available in the app',
  body: 'Push alerts are available in the Lotly mobile app.',
} as const;

export const ENABLE_ACTION = 'Enable recall alerts';
/** Spoken after the enable action: it may raise the system prompt. */
export const ENABLE_HINT = 'May ask for notification permission.';
export const DISABLE_ACTION = 'Turn off alerts';
export const SETTINGS_ACTION = 'Open system settings';
export const SETTINGS_HINT = 'Opens the system settings for this app.';
export const WORKING_LABEL = 'Working…';
/** The failure shown when an operation throws something without a message. */
export const GENERIC_FAILURE = 'Something went wrong.';

// ── The mapping ─────────────────────────────────────────────────────────────

export type NotificationsActionKind = 'enable' | 'disable' | 'settings';

export interface NotificationsAction {
  kind: NotificationsActionKind;
  label: string;
  /** What the action reads while the operation runs; null for one with no operation. */
  busyLabel: string | null;
  variant: 'primary' | 'secondary';
  hint: string | null;
}

export interface NotificationsPresentation {
  /** The status sentence, truthful for the current permission state. */
  message: string;
  /** A read is in flight: the message is a checking line, not a status. */
  busy: boolean;
  /** The one action appropriate to the state, or none. */
  action: NotificationsAction | null;
  /** A failed operation's message, beneath the action. */
  error: string | null;
}

const ACTIONS: Record<AlertStatus, NotificationsAction> = {
  not_enabled: {
    kind: 'enable',
    label: ENABLE_ACTION,
    busyLabel: WORKING_LABEL,
    variant: 'primary',
    hint: ENABLE_HINT,
  },
  enabled: {
    kind: 'disable',
    label: DISABLE_ACTION,
    busyLabel: WORKING_LABEL,
    variant: 'secondary',
    hint: null,
  },
  denied: {
    kind: 'settings',
    label: SETTINGS_ACTION,
    busyLabel: null,
    variant: 'primary',
    hint: SETTINGS_HINT,
  },
};

const MESSAGES: Record<AlertStatus, string> = {
  not_enabled: STATUS_OFF,
  enabled: STATUS_ON,
  denied: STATUS_DENIED,
};

export function notificationsPresentation(view: NotificationsView): NotificationsPresentation {
  if (view.status === 'loading') {
    return { message: CHECKING_STATUS, busy: true, action: null, error: null };
  }
  if (view.status === 'unsupported') {
    return { message: UNSUPPORTED_STATE.body, busy: false, action: null, error: null };
  }
  return {
    message: MESSAGES[view.alerts],
    busy: false,
    action: ACTIONS[view.alerts],
    error: view.error,
  };
}

/** The message a thrown operation failure shows: its own words, or the generic line. */
export function failureMessage(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : GENERIC_FAILURE;
}
