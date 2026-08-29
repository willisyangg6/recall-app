/**
 * Push registration flow (native). The permission prompt fires ONLY from the
 * user's explicit "Enable recall alerts" action — nothing here runs a system
 * prompt on app launch. Silent paths (app start refresh, Expo token rotation)
 * re-register only when the user already enabled alerts on this device, and
 * re-registration is idempotent on the backend (same installation id).
 */

import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { alertStatus, type AlertStatus } from './alert-status';
import { getOrCreateInstallationId } from './installation-id';
import { enqueueInstallationMutation } from './installation-lifecycle';
import { disablePushSubscription, registerPushSubscription } from './push-api';

/** Set once the user enables alerts here; silent refresh only acts when set. */
const ENABLED_FLAG_KEY = 'recall.alerts-enabled';

function easProjectId(): string | null {
  const fromConfig = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const fromEas = Constants.easConfig?.projectId as string | undefined;
  return fromConfig ?? fromEas ?? null;
}

/** Android requires a channel before notifications can display (Expo docs). */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Recall alerts',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
  });
}

async function hasEnabledFlag(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ENABLED_FLAG_KEY)) === '1';
}

/** Current control state. Read-only: never triggers a permission prompt. */
export async function getAlertStatus(): Promise<AlertStatus> {
  const permission = await Notifications.getPermissionsAsync();
  return alertStatus(
    { granted: permission.granted, canAskAgain: permission.canAskAgain },
    await hasEnabledFlag(),
  );
}

async function obtainAndRegisterToken(): Promise<void> {
  const projectId = easProjectId();
  if (!projectId) {
    throw new Error(
      'This build is not linked to an EAS project yet, so push tokens are unavailable. ' +
        '(Founder: run `eas init`, then rebuild.)',
    );
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await registerPushSubscription({
    installationId: await getOrCreateInstallationId(),
    expoPushToken: token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    appVersion: Constants.expoConfig?.version ?? null,
  });
}

/**
 * The user tapped "Enable recall alerts". The one and only place the system
 * permission prompt can fire. The prompt itself stays OUTSIDE the shared
 * installation queue (queueing a user dialog would stall every queued save
 * behind it); only the server registration + flag write are queued (C7.1),
 * so enabling serializes with saves, refreshes, and data deletion.
 */
export async function enableRecallAlerts(): Promise<AlertStatus> {
  await ensureAndroidChannel();
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) {
    return alertStatus(
      { granted: false, canAskAgain: permission.canAskAgain },
      await hasEnabledFlag(),
    );
  }
  return enqueueInstallationMutation<AlertStatus>(async () => {
    await obtainAndRegisterToken();
    await SecureStore.setItemAsync(ENABLED_FLAG_KEY, '1');
    return 'enabled';
  });
}

/** The user turned alerts off. Local flag + backend row, both disabled. */
export function disableRecallAlerts(): Promise<AlertStatus> {
  return enqueueInstallationMutation<AlertStatus>(async () => {
    await SecureStore.deleteItemAsync(ENABLED_FLAG_KEY);
    try {
      await disablePushSubscription(await getOrCreateInstallationId());
    } catch {
      // Offline is fine: the local flag stops silent refresh, and the backend
      // row dies at the next DeviceNotRegistered receipt if the token expires.
    }
    return 'not_enabled';
  });
}

/**
 * Silent refresh on app start and on Expo token rotation: keeps the backend
 * token current and last_seen_at moving. No-op unless the user enabled
 * alerts here and permission is still granted. Never prompts.
 *
 * Queued (C7.1): unqueued, a slow launch refresh could re-register the OLD
 * installation on the server after "Reset app and delete my data" deleted
 * it. On the shared queue a refresh either runs before the reset (and its
 * row is deleted with everything else) or after it (the flag is gone — the
 * refresh is a no-op).
 */
export function refreshRegistrationIfEnabled(): Promise<void> {
  return enqueueInstallationMutation(async () => {
    try {
      if (!(await hasEnabledFlag())) return;
      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) return;
      await ensureAndroidChannel();
      await obtainAndRegisterToken();
    } catch {
      // Best-effort: a failed silent refresh must never surface at launch.
    }
  });
}

/**
 * Remove the locally persisted alerts-enabled flag (C7.1 reset). Local-only
 * and deliberately NOT queued — the reset orchestrator calls it inside its
 * own queue turn, after the server deletion succeeded. With the flag gone,
 * silent refresh cannot re-register, and the OS-level notification
 * permission (which the app cannot revoke) no longer reads as "enabled":
 * alerts stay off until the user explicitly enables them again.
 */
export async function clearLocalAlertState(): Promise<void> {
  await SecureStore.deleteItemAsync(ENABLED_FLAG_KEY);
}
