/**
 * Web variant: recall push alerts are a mobile-app capability. Every entry
 * point is a safe no-op so shared screens render without platform branches.
 */

import type { AlertStatus } from './alert-status';
import type { EnableAttempt, EnablePorts } from './push-registration';

export type { EnableAttempt, EnablePorts, PermissionResolution } from './push-registration';

export async function ensureAndroidChannel(): Promise<void> {}

export async function getAlertStatus(): Promise<AlertStatus> {
  return 'not_enabled';
}

/** The web cannot prompt or register: never granted, never asked. */
export function realEnablePorts(): EnablePorts {
  return {
    async resolvePermission() {
      return { granted: false, canAskAgain: false, prompted: false };
    },
    async register() {
      throw new Error('Recall alerts are available in the Lotly mobile app.');
    },
  };
}

export async function attemptRecallAlerts(): Promise<EnableAttempt> {
  return { outcome: 'permission_denied', canAskAgain: false, prompted: false };
}

export async function enableRecallAlerts(): Promise<AlertStatus> {
  return 'not_enabled';
}

export async function disableRecallAlerts(): Promise<AlertStatus> {
  return 'not_enabled';
}

export async function refreshRegistrationIfEnabled(): Promise<void> {}

export async function clearLocalAlertState(): Promise<void> {}

/** Web: no alerts, so nothing to disable. */
export async function disableAlertsAfterAgeStop(): Promise<'no-installation'> {
  return 'no-installation';
}
