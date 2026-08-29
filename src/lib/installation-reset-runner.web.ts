/**
 * Web variant: personalization, push registration, and the installation
 * identity are native (SecureStore) — a web session holds no installation
 * data to delete, so the reset control does not render (same convention as
 * preferences-store.web.ts / push-registration.web.ts).
 */

import type { InstallationResetResult } from './installation-reset';

export function resetAvailable(): boolean {
  return false;
}

export async function runInstallationReset(): Promise<InstallationResetResult> {
  return { status: 'failed', message: 'Data reset is available in the Recall mobile app.' };
}
