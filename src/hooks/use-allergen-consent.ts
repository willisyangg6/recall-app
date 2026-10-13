/**
 * The allergen consent decision as screens see it (2026-10-13): the stored
 * record and whether the server still owes it (both re-read on focus), and
 * `decide`, which records a decision and mirrors its effect
 * (lib/preferences-store.ts `setAllergenConsentDecision`). `pending` is true
 * while the server has not received the newest decision — offline, a
 * withdrawal is recorded on this iPhone at once but reaches the server only
 * once it is back online, and the screen must say so.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import type { AllergenConsentDecision, AllergenConsentRecord } from '@/lib/allergen-consent';
import { loadAllergenConsent } from '@/lib/allergen-consent-store';
import { allergenServerSyncPending, setAllergenConsentDecision } from '@/lib/preferences-store';

export type AllergenConsentState =
  | { status: 'loading' }
  | { status: 'ready'; record: AllergenConsentRecord | null; pending: boolean };

export function useAllergenConsent(): {
  consent: AllergenConsentState;
  decide: (decision: AllergenConsentDecision) => Promise<void>;
} {
  const [consent, setConsent] = useState<AllergenConsentState>({ status: 'loading' });
  useFocusEffect(
    useCallback(() => {
      let current = true;
      void Promise.all([loadAllergenConsent(), allergenServerSyncPending()]).then(
        ([record, pending]) => {
          if (current) setConsent({ status: 'ready', record, pending });
        },
      );
      return () => {
        current = false;
      };
    }, []),
  );
  const decide = useCallback(async (decision: AllergenConsentDecision) => {
    const { synced } = await setAllergenConsentDecision(decision);
    setConsent({ status: 'ready', record: await loadAllergenConsent(), pending: !synced });
  }, []);
  return { consent, decide };
}
