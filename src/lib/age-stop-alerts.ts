/**
 * The under-13 stop's one protective request (age assurance, 2026-10-13;
 * components/age-gate.tsx). Pure orchestration over the alert protocol
 * (lib/alert-intent.ts), so its ordering and retry are provable in Node.
 *
 * - No installation id stored: nothing on the server is keyed to this
 *   device, nothing is sent, and no id is minted.
 * - Alerts confirmed: the protocol's own `disable()` — the local flag is
 *   cleared first, then `disable_push_subscription(installation_id,
 *   sequence)` is sent. It carries ONLY the installation id the server
 *   already holds and the write sequence: no age, nothing to RevenueCat or
 *   Expo, no other launch sync.
 * - A disable already owed (offline earlier, or a crashed registration):
 *   `reconcile()` sends it.
 * - Otherwise nothing is owed and nothing is sent.
 *
 * An unconfirmed disable stays `pending` in SecureStore and is sent again
 * every time the gate shows the stop (each launch) until the server answers.
 */

import type { AlertIntent } from './alert-intent';

export type AgeStopAlertsOutcome = 'no-installation' | 'nothing-owed' | 'confirmed' | 'pending';

export async function disableAlertsAfterAgeStop(deps: {
  /** The stored installation id, or null. MUST NOT create one. */
  peekInstallationId(): Promise<string | null>;
  intentFor(installationId: string): AlertIntent;
}): Promise<AgeStopAlertsOutcome> {
  const installationId = await deps.peekInstallationId();
  if (installationId === null) return 'no-installation';
  const intent = deps.intentFor(installationId);
  const before = await intent.state();
  if (!before.enabled && before.pending === null && before.inFlight === null) {
    return 'nothing-owed';
  }
  if (before.enabled) await intent.disable();
  else await intent.reconcile();
  const after = await intent.state();
  return after.pending === null && !after.enabled ? 'confirmed' : 'pending';
}
