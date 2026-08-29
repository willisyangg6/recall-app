/**
 * Web variant: recall push alerts are a mobile-app capability. Every entry
 * point is a safe no-op so shared screens render without platform branches.
 */

import type { AlertStatus } from './alert-status';

export async function ensureAndroidChannel(): Promise<void> {}

export async function getAlertStatus(): Promise<AlertStatus> {
  return 'not_enabled';
}

export async function enableRecallAlerts(): Promise<AlertStatus> {
  return 'not_enabled';
}

export async function disableRecallAlerts(): Promise<AlertStatus> {
  return 'not_enabled';
}

export async function refreshRegistrationIfEnabled(): Promise<void> {}

export async function clearLocalAlertState(): Promise<void> {}
