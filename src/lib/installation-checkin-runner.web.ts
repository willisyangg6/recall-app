/**
 * Web variant: a web session holds no installation identity, so it has no
 * activity to record (same convention as installation-reset-runner.web.ts).
 */

import type { CheckinResult } from './installation-checkin';

export async function runInstallationCheckin(): Promise<CheckinResult> {
  return 'no-installation';
}
