/**
 * Keeps this installation's consent-revocation key in step with its age
 * record (age assurance, 2026-10-13). Called after every confirmed alert
 * registration (push-registration.ts), never on its own: a key matters only
 * while an alert subscription exists, because stopping alerts is all a
 * revocation does.
 *
 * - Eligible (lib/revocation-key.ts): send StoreKit's appTransactionId,
 *   re-read each time, so a different Apple Account's id is replaced.
 * - Not eligible, and a key was sent before (a 17-year-old who turned 18,
 *   or another account): clear it.
 * - Not eligible, nothing sent: no request at all.
 *
 * Best effort and silent. A failure leaves the previous state; the next
 * registration (launch upkeep, the daily check-in) tries again.
 */

import * as SecureStore from 'expo-secure-store';

import { getAppTransactionAsync } from '../../modules/app-transaction';
import { loadAgeRecord } from './age-record-store';
import { revocationKeyEligible } from './revocation-key';
import { setPushRevocationKey } from './revocation-key-api';

/** '1' while this device believes the server holds a key for it. */
const SENT_KEY = 'recall.revocation-key-sent';

export async function syncRevocationKey(installationId: string): Promise<void> {
  try {
    const eligible = revocationKeyEligible(await loadAgeRecord());
    const sent = (await SecureStore.getItemAsync(SENT_KEY)) === '1';
    if (!eligible && !sent) return;
    if (!eligible) {
      await setPushRevocationKey(installationId, null);
      await SecureStore.deleteItemAsync(SENT_KEY);
      return;
    }
    const id = (await getAppTransactionAsync())?.appTransactionId ?? null;
    if (id === null) return;
    await setPushRevocationKey(installationId, id);
    await SecureStore.setItemAsync(SENT_KEY, '1');
  } catch {
    // Silent: retried at the next registration.
  }
}
