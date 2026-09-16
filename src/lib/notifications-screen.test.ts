/**
 * The Notifications screen's status → presentation mapping (P2B6A), driven
 * against the real module: every permission state gets one truthful
 * sentence and the one action appropriate to it; loading is a checking line
 * with no action; the web gets no action at all; "on" is said only when the
 * permission is granted AND this installation is registered; and a thrown
 * operation failure keeps its own words or falls back to the generic line.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AlertStatus } from './alert-status';
import * as copy from './notifications-screen';
import {
  CHECKING_STATUS,
  DISABLE_ACTION,
  ENABLE_ACTION,
  ENABLE_HINT,
  failureMessage,
  GENERIC_FAILURE,
  NOTIFICATIONS_FOOTNOTE,
  NOTIFICATIONS_INTRO,
  notificationsPresentation,
  SETTINGS_ACTION,
  STATUS_DENIED,
  STATUS_OFF,
  STATUS_ON,
  UNSUPPORTED_STATE,
  WORKING_LABEL,
  type NotificationsView,
} from './notifications-screen';

const ready = (alerts: AlertStatus, error: string | null = null): NotificationsView => ({
  status: 'ready',
  alerts,
  busy: false,
  error,
});

test('loading is a checking line with no action — nothing that could pass for a disabled control', () => {
  const shown = notificationsPresentation({ status: 'loading' });
  assert.equal(shown.message, CHECKING_STATUS);
  assert.equal(shown.busy, true);
  assert.equal(shown.action, null);
  assert.equal(shown.error, null);
  assert.equal(CHECKING_STATUS, 'Checking status…');
});

test('not enabled: alerts are off here, and the one action is the explicit enable', () => {
  const shown = notificationsPresentation(ready('not_enabled'));
  assert.equal(shown.message, STATUS_OFF);
  assert.equal(shown.busy, false);
  assert.deepEqual(shown.action, {
    kind: 'enable',
    label: ENABLE_ACTION,
    busyLabel: WORKING_LABEL,
    variant: 'primary',
    hint: ENABLE_HINT,
  });
  assert.equal(ENABLE_ACTION, 'Enable recall alerts');
  assert.equal(WORKING_LABEL, 'Working…');
  // The hint says the prompt may come — the shopper is told before it fires.
  assert.match(ENABLE_HINT, /permission/);
});

test('enabled: the exact device-scoped sentence, and the secondary turn-off action', () => {
  const shown = notificationsPresentation(ready('enabled'));
  assert.equal(shown.message, 'Recall alerts are on for this device.');
  assert.equal(shown.message, STATUS_ON);
  assert.equal(shown.action?.kind, 'disable');
  assert.equal(shown.action?.label, DISABLE_ACTION);
  assert.equal(shown.action?.variant, 'secondary');
  assert.equal(shown.action?.busyLabel, WORKING_LABEL);
  assert.equal(DISABLE_ACTION, 'Turn off alerts');
});

test('denied: names Lotly and the system settings, and the action opens them instead of re-prompting', () => {
  const shown = notificationsPresentation(ready('denied'));
  assert.equal(shown.message, STATUS_DENIED);
  assert.match(STATUS_DENIED, /Notifications for Lotly are turned off in your device settings\./);
  assert.equal(shown.action?.kind, 'settings');
  assert.equal(shown.action?.label, SETTINGS_ACTION);
  assert.equal(shown.action?.variant, 'primary');
  // Opening settings is not an operation with a busy state.
  assert.equal(shown.action?.busyLabel, null);
  assert.equal(SETTINGS_ACTION, 'Open system settings');
});

test('the web gets the message alone: no action, and the product is named Lotly', () => {
  const shown = notificationsPresentation({ status: 'unsupported' });
  assert.equal(shown.message, UNSUPPORTED_STATE.body);
  assert.equal(shown.action, null);
  assert.equal(UNSUPPORTED_STATE.body, 'Push alerts are available in the Lotly mobile app.');
});

test('"on" is said only for the enabled state; every state has its own sentence', () => {
  const statuses: AlertStatus[] = ['not_enabled', 'enabled', 'denied'];
  const messages = statuses.map((s) => notificationsPresentation(ready(s)).message);
  assert.equal(new Set(messages).size, 3);
  for (const status of statuses) {
    const message = notificationsPresentation(ready(status)).message;
    assert.equal(/\bare on\b/.test(message), status === 'enabled', message);
  }
  assert.ok(!CHECKING_STATUS.includes(' on '));
  // The off sentence is explicit that nothing is sent — never implied on.
  assert.match(STATUS_OFF, /off for this device/);
  assert.match(STATUS_OFF, /You will not receive notifications/);
});

test('the approved Notifications copy appears exactly, and no authored sentence carries an em dash', () => {
  assert.equal(
    NOTIFICATIONS_INTRO,
    'Get alerts when a relevant recall is announced or changes. Lotly does not send marketing notifications.',
  );
  assert.equal(
    STATUS_OFF,
    'Alerts are off for this device. You will not receive notifications until you turn them on.',
  );
  assert.equal(STATUS_ON, 'Recall alerts are on for this device.');
  assert.equal(
    STATUS_DENIED,
    'Notifications for Lotly are turned off in your device settings. Allow them there, then return to Lotly to turn on alerts.',
  );
  assert.equal(
    NOTIFICATIONS_FOOTNOTE,
    'Lotly uses your state, allergens, and stores to decide which recall alerts to send.',
  );
  // Action labels are kept as they were.
  assert.deepEqual(
    [
      ENABLE_ACTION,
      DISABLE_ACTION,
      SETTINGS_ACTION,
      WORKING_LABEL,
      CHECKING_STATUS,
      GENERIC_FAILURE,
    ],
    [
      'Enable recall alerts',
      'Turn off alerts',
      'Open system settings',
      'Working…',
      'Checking status…',
      'Something went wrong.',
    ],
  );
  for (const [name, value] of Object.entries(copy)) {
    const strings =
      typeof value === 'string'
        ? [value]
        : typeof value === 'object' && value !== null
          ? Object.values(value as Record<string, unknown>).filter(
              (v): v is string => typeof v === 'string',
            )
          : [];
    for (const text of strings) assert.ok(!text.includes('—'), `${name}: ${text}`);
  }
  // The vague and defensive phrasings the copy rules retire are gone.
  for (const phrase of ['in a way that matters', 'nothing else', 'no marketing.']) {
    assert.ok(!NOTIFICATIONS_INTRO.includes(phrase), phrase);
  }
});

test('a failed operation is carried beneath the action, in its own words or the generic line', () => {
  assert.equal(notificationsPresentation(ready('not_enabled', 'Refused.')).error, 'Refused.');
  assert.equal(notificationsPresentation(ready('not_enabled')).error, null);
  assert.equal(
    failureMessage(new Error('This build is not linked to an EAS project yet.')),
    'This build is not linked to an EAS project yet.',
  );
  assert.equal(failureMessage(new Error('')), GENERIC_FAILURE);
  assert.equal(failureMessage('a string'), GENERIC_FAILURE);
  assert.equal(failureMessage(undefined), GENERIC_FAILURE);
  assert.equal(GENERIC_FAILURE, 'Something went wrong.');
});
