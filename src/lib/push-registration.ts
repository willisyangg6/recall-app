/**
 * Push registration flow (native). The permission prompt fires ONLY from the
 * user's explicit enable action — the Notifications screen's "Enable recall
 * alerts" and the notification education's "Turn on notifications" —
 * nothing here runs a system prompt on app launch. Silent paths (app start
 * refresh, Expo token rotation) re-register only when the user already
 * enabled alerts on this device, and re-registration is idempotent on the
 * backend (same installation id).
 *
 * ## The two ports (2026-10-04)
 *
 * Enabling is two distinct steps and the app never conflates them:
 *
 * 1. `resolvePermission` — the SYSTEM permission: read it, and prompt once
 *    only while the system can still ask. Its answer says whether iOS
 *    allows notifications, and whether a prompt was shown just now.
 * 2. `register` — the SERVER registration: the Expo push token, the
 *    installation's subscription row, and only then the local
 *    alerts-enabled flag. Alerts are "on" when, and only when, this step
 *    completed; a granted permission alone is not an enabled alert.
 *
 * `attemptRecallAlerts` runs both and reports which of the three outcomes
 * was reached — enabled, permission denied (with whether a prompt was
 * shown and whether one can still be shown), or registration failed — so a
 * caller can tell a shopper the truth. `enableRecallAlerts` is the
 * Notifications screen's original shape on top of it.
 *
 * ## Cancellation, and the write that may have landed
 *
 * `register` takes an `AbortSignal`. The server write honours it (the fetch
 * is aborted). Reading the Expo push token is a platform operation with no
 * cancellation — it is awaited to completion — but its result is discarded
 * when the signal has fired by then: nothing is registered, no flag is
 * written. A write that was already sent may still land on the server —
 * in the instant before the abort, or later — so every registration whose
 * outcome is unknown is followed by a disable that OUTRANKS it, by sequence
 * (src/lib/alert-intent.ts; the push_subscription_sequence migration):
 * whichever order the two reach the server in, the row ends disabled, and a
 * newer registration the shopper retries successfully outranks that cleanup
 * in turn. The confirmed flag is written only after the server answered,
 * so nothing reports alerts as on while the server's state is unknown.
 *
 * The prompt itself stays OUTSIDE the shared installation queue (queueing a
 * user dialog would stall every queued save behind it); only the server
 * registration + flag write are queued (C7.1), so enabling serializes with
 * saves, refreshes, and data deletion.
 */

import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { alertStatus, type AlertStatus } from './alert-status';
import { getOrCreateInstallationId, peekInstallationId } from './installation-id';
import { enqueueInstallationMutation } from './installation-lifecycle';
import {
  alertIntent,
  INITIAL_ALERT_INTENT,
  parseAlertIntent,
  serializeAlertIntent,
  type AlertIntent,
  type AlertIntentState,
} from './alert-intent';
import {
  disablePushSubscription,
  isDefiniteRejection,
  registerPushSubscription,
  RpcAbortedError,
} from './push-api';
import { getAppTransactionAsync } from '../../modules/app-transaction';
import {
  disableAlertsAfterAgeStop as disableAfterAgeStop,
  type AgeStopAlertsOutcome,
} from './age-stop-alerts';
import { loadAgeRecord } from './age-record-store';
import {
  registrationRoute,
  revocationKeyEligible,
  routedRegistration,
  type RegistrationRoute,
} from './revocation-key';
import {
  clearPushRevocationKey,
  registerPushSubscriptionWithRevocationKey,
} from './revocation-key-api';

/**
 * '1' once a keyed registration (consent revocation) was confirmed on this
 * device, until the key is cleared: such an installation keeps using the
 * keyed path, the only one that can renew a row a parent's revocation
 * disabled.
 */
const REVOCATION_KEY_HELD = 'recall.revocation-key-held';

/**
 * How this installation must register (lib/revocation-key.ts). StoreKit is
 * asked for the app transaction only when a key is needed or held.
 */
async function resolveRegistrationRoute(): Promise<RegistrationRoute> {
  const eligible = revocationKeyEligible(await loadAgeRecord());
  const keyHeld = (await SecureStore.getItemAsync(REVOCATION_KEY_HELD)) === '1';
  if (!eligible && !keyHeld) return { kind: 'plain', clearAfter: false };
  let appTransactionId: string | null = null;
  try {
    appTransactionId = (await getAppTransactionAsync())?.appTransactionId ?? null;
  } catch {
    appTransactionId = null;
  }
  return registrationRoute({ eligible, keyHeld, appTransactionId });
}

/**
 * The flag as it was stored before the intent record (below) replaced it:
 * read once, so a device that enabled alerts under the old key stays
 * enabled. Never written any more.
 */
const ENABLED_FLAG_KEY = 'recall.alerts-enabled';
/**
 * The installation's alert intent (src/lib/alert-intent.ts): the write
 * sequence, whether a registration is CONFIRMED, and any disable still owed
 * to the server. `enabled` here is the one source of "alerts are on for
 * this device": written only after the server confirmed a registration,
 * cleared before any disable is sent.
 */
const INTENT_KEY = 'recall.alerts-intent';

async function loadIntentState(): Promise<AlertIntentState> {
  const stored = parseAlertIntent(await SecureStore.getItemAsync(INTENT_KEY));
  if (stored) return stored;
  const legacyEnabled = (await SecureStore.getItemAsync(ENABLED_FLAG_KEY)) === '1';
  return { ...INITIAL_ALERT_INTENT, enabled: legacyEnabled };
}

/**
 * The protocol over this installation's server row. `token` is the Expo
 * push token a registration will carry; null for a caller that only
 * disables or reconciles (a registration is then a programming error).
 */
function installationIntent(installationId: string, token: string | null): AlertIntent {
  return alertIntent({
    load: loadIntentState,
    save: (state) => SecureStore.setItemAsync(INTENT_KEY, serializeAlertIntent(state)),
    async register(sequence, signal) {
      if (token === null) throw new Error('registration needs a push token');
      const common = {
        installationId,
        expoPushToken: token,
        platform: Platform.OS === 'ios' ? ('ios' as const) : ('android' as const),
        appVersion: Constants.expoConfig?.version ?? null,
      };
      // Consent revocation (age assurance): a regulated 13–17 user registers
      // ONLY with the keyed RPC (row + mapping in one transaction); without
      // Apple's id nothing is sent and the protocol's cleanup keeps alerts
      // disabled (lib/revocation-key.ts).
      return routedRegistration({
        resolveRoute: resolveRegistrationRoute,
        registerPlain: (seq, sig) =>
          registerPushSubscription({ ...common, sequence: seq, signal: sig }),
        registerKeyed: (seq, appTransactionId, sig) =>
          registerPushSubscriptionWithRevocationKey({
            ...common,
            sequence: seq,
            appTransactionId,
            signal: sig,
          }),
        clearKey: () => clearPushRevocationKey(installationId),
        setKeyHeld: (held) =>
          held
            ? SecureStore.setItemAsync(REVOCATION_KEY_HELD, '1')
            : SecureStore.deleteItemAsync(REVOCATION_KEY_HELD),
      })(sequence, signal);
    },
    disable: (sequence) => disablePushSubscription(installationId, sequence),
    isDefiniteRejection,
  });
}

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

/** True only while a registration is CONFIRMED and no disable was issued since. */
async function hasEnabledFlag(): Promise<boolean> {
  return (await loadIntentState()).enabled;
}

/** Current control state. Read-only: never triggers a permission prompt. */
export async function getAlertStatus(): Promise<AlertStatus> {
  const permission = await Notifications.getPermissionsAsync();
  return alertStatus(
    { granted: permission.granted, canAskAgain: permission.canAskAgain },
    await hasEnabledFlag(),
  );
}

// ── The ports ───────────────────────────────────────────────────────────────

/** The system permission after one deliberate enable: read, and prompted if it could be. */
export interface PermissionResolution {
  granted: boolean;
  /** False once the system will not ask again: only Settings can change it. */
  canAskAgain: boolean;
  /** True when the system prompt was shown by THIS call. */
  prompted: boolean;
}

export interface EnablePorts {
  /**
   * Read the permission and prompt ONCE if, and only if, it is not granted
   * and the system can still ask. The one place the prompt can fire.
   */
  resolvePermission(): Promise<PermissionResolution>;
  /**
   * Register this installation: token, server row, then the local flag.
   * Rejects on any failure; rejects with `RpcAbortedError` when `signal`
   * fired before the server write began.
   */
  register(signal?: AbortSignal): Promise<void>;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RpcAbortedError();
}

/** The ports as the app ships them. */
export function realEnablePorts(): EnablePorts {
  return {
    async resolvePermission() {
      await ensureAndroidChannel();
      let permission = await Notifications.getPermissionsAsync();
      let prompted = false;
      if (!permission.granted && permission.canAskAgain) {
        permission = await Notifications.requestPermissionsAsync();
        prompted = true;
      }
      return { granted: permission.granted, canAskAgain: permission.canAskAgain, prompted };
    },
    register(signal) {
      return enqueueInstallationMutation(async () => {
        throwIfAborted(signal);
        const projectId = easProjectId();
        if (!projectId) {
          throw new Error(
            'This build is not linked to an EAS project yet, so push tokens are unavailable. ' +
              '(Founder: run `eas init`, then rebuild.)',
          );
        }
        // A platform read with no cancellation: awaited, then discarded if
        // the caller gave up meanwhile — nothing below runs on a dead signal.
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        throwIfAborted(signal);
        // The protocol: a sequence on the write, the confirmed flag only on
        // success, and a cleanup disable — carrying the next sequence, so it
        // outranks the write however the two are ordered — when the
        // outcome is unknown (the abort, the timeout, the network).
        await installationIntent(await getOrCreateInstallationId(), token).register(signal);
      });
    },
  };
}

// ── The one enable path ─────────────────────────────────────────────────────

export type EnableAttempt =
  /** Permission granted AND this installation registered. */
  | { outcome: 'enabled' }
  /** iOS does not allow notifications; `prompted` says whether it just asked. */
  | { outcome: 'permission_denied'; canAskAgain: boolean; prompted: boolean }
  /** Permission granted, but the registration did not complete. */
  | { outcome: 'registration_failed'; error: unknown };

/**
 * The user's deliberate enable: resolve the permission (prompting only while
 * the system can ask), then register when it allows. Never throws — every
 * way it can end is a named outcome.
 */
export async function attemptRecallAlerts(
  ports: EnablePorts = realEnablePorts(),
  signal?: AbortSignal,
): Promise<EnableAttempt> {
  const permission = await ports.resolvePermission();
  if (!permission.granted) {
    return {
      outcome: 'permission_denied',
      canAskAgain: permission.canAskAgain,
      prompted: permission.prompted,
    };
  }
  try {
    await ports.register(signal);
    return { outcome: 'enabled' };
  } catch (error) {
    return { outcome: 'registration_failed', error };
  }
}

/**
 * The Notifications screen's "Enable recall alerts": the attempt, reported
 * as the control state the screen renders. A registration failure throws,
 * as it always did, so the screen shows its failure line.
 */
export async function enableRecallAlerts(): Promise<AlertStatus> {
  const attempt = await attemptRecallAlerts();
  switch (attempt.outcome) {
    case 'enabled':
      return 'enabled';
    case 'permission_denied':
      return alertStatus(
        { granted: false, canAskAgain: attempt.canAskAgain },
        await hasEnabledFlag(),
      );
    case 'registration_failed':
      throw attempt.error;
  }
}

/**
 * The user turned alerts off. The confirmed flag is cleared first, then the
 * server row is disabled with the next sequence. Offline is fine: the
 * disable stays pending in the intent record and is retried at the next
 * launch and before the next registration; meanwhile the cleared flag stops
 * silent refresh, and nothing reports alerts as on.
 */
export function disableRecallAlerts(): Promise<AlertStatus> {
  return enqueueInstallationMutation<AlertStatus>(async () => {
    await installationIntent(await getOrCreateInstallationId(), null).disable();
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
      // First, what the server is still owed: a disable left pending offline,
      // or the cleanup of a registration a crash interrupted.
      const installationId = await getOrCreateInstallationId();
      await installationIntent(installationId, null).reconcile();
      if (!(await hasEnabledFlag())) return;
      // A regulated 13–17 user whose Apple id cannot be read must not keep
      // an enabled row without its revocation mapping: disable, persisted
      // and retried like any disable. Alerts stay off until the user turns
      // them on again with the id available.
      if ((await resolveRegistrationRoute()).kind === 'blocked') {
        await installationIntent(installationId, null).disable();
        return;
      }
      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) return;
      await ensureAndroidChannel();
      const projectId = easProjectId();
      if (!projectId) return;
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      await installationIntent(installationId, token).refresh();
    } catch {
      // Best-effort: a failed silent refresh must never surface at launch.
    }
  });
}

/**
 * The under-13 stop's protective request (components/age-gate.tsx;
 * lib/age-stop-alerts.ts): disable this installation's alerts on Lotly's
 * server with the existing sequenced disable. Sends only the stored
 * installation id (never minted here) and the sequence; retried at every
 * launch until confirmed. Queued like every installation mutation.
 */
export function disableAlertsAfterAgeStop(): Promise<AgeStopAlertsOutcome> {
  return enqueueInstallationMutation(() =>
    disableAfterAgeStop({
      peekInstallationId,
      intentFor: (installationId) => installationIntent(installationId, null),
    }),
  );
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
  await SecureStore.deleteItemAsync(INTENT_KEY);
  await SecureStore.deleteItemAsync(ENABLED_FLAG_KEY);
}
