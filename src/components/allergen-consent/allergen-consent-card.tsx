/**
 * The consent question inline (2026-10-13), under Personalization's
 * allergens: shown while allergens are chosen and no decision is recorded.
 * The autosave screen keeps working either way; the card only records the
 * decision and disappears once one is made.
 */

import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { AllergenConsentChoice } from '@/components/allergen-consent/allergen-consent-choice';
import { Surface } from '@/components/ui/surface';
import { spacing } from '@/constants/design-tokens';
import type { UserRecallPreferences } from '@/domain/preferences';
import { useAllergenConsent } from '@/hooks/use-allergen-consent';
import { allergensAreOnlyAlertChoice, shouldAskAllergenConsent } from '@/lib/allergen-consent';

export function AllergenConsentCard({ prefs }: { prefs: UserRecallPreferences }) {
  const { consent, decide } = useAllergenConsent();
  const [busy, setBusy] = useState(false);
  if (consent.status !== 'ready') return null;
  if (!shouldAskAllergenConsent(prefs.allergens, consent.record)) return null;
  const choose = (decision: 'granted' | 'declined') => {
    setBusy(true);
    void decide(decision).finally(() => setBusy(false));
  };
  return (
    <Surface radius={12} border="border/strong" style={styles.card}>
      <AllergenConsentChoice
        onlyChoice={allergensAreOnlyAlertChoice(prefs)}
        busy={busy}
        onGrant={() => choose('granted')}
        onDecline={() => choose('declined')}
      />
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing[16] },
});
