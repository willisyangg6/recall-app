/**
 * `/onboarding/allergens` (P2B7X.1) — Screen 3, `2 of 4`. Optional: an
 * empty selection continues. Every toggle autosaves through the one store.
 */

import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';

import { AllergenConsentSheet } from '@/components/allergen-consent/allergen-consent-sheet';
import { AllergensStep } from '@/components/onboarding/allergens-step';
import { StepPending } from '@/components/onboarding/step-pending';
import { useAccess } from '@/hooks/use-access';
import { useAllergenConsent } from '@/hooks/use-allergen-consent';
import { useOnboardingPreferences } from '@/hooks/use-onboarding-preferences';
import { allergensAreOnlyAlertChoice, shouldAskAllergenConsent } from '@/lib/allergen-consent';
import { clearAllergens } from '@/lib/allergen-grid';
import { goBackFrom } from '@/lib/onboarding-navigation';
import { onboardingRoute } from '@/lib/onboarding-routes';
import { toggleAllergen } from '@/lib/personalization-screen';

export default function OnboardingAllergensScreen() {
  const access = useAccess();
  const { load, update } = useOnboardingPreferences();
  // Allergen consent (2026-10-13): asked on Continue, never mid-selection.
  const { consent, decide } = useAllergenConsent();
  const [asking, setAsking] = useState(false);
  const [deciding, setDeciding] = useState(false);
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('allergens');
    }, [access]),
  );

  if (load.status !== 'ready') return <StepPending step="allergens" status={load.status} />;
  const prefs = load.prefs;
  const next = () => router.push(onboardingRoute('retailers'));
  const choose = (decision: 'granted' | 'declined') => {
    setDeciding(true);
    void decide(decision).finally(() => {
      setDeciding(false);
      setAsking(false);
      next();
    });
  };
  return (
    <>
      <AllergensStep
        selected={prefs.allergens}
        onToggle={(token) => update(toggleAllergen(prefs, token))}
        onClear={() => {
          const next = clearAllergens(prefs);
          if (next !== prefs) update(next);
        }}
        onContinue={() => {
          if (
            consent.status === 'ready' &&
            shouldAskAllergenConsent(prefs.allergens, consent.record)
          ) {
            setAsking(true);
          } else {
            next();
          }
        }}
        onBack={() => goBackFrom('allergens', router)}
      />
      <AllergenConsentSheet
        visible={asking}
        onlyChoice={allergensAreOnlyAlertChoice(prefs)}
        busy={deciding}
        onGrant={() => choose('granted')}
        onDecline={() => choose('declined')}
        onClose={() => setAsking(false)}
      />
    </>
  );
}
