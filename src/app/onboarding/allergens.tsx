/**
 * `/onboarding/allergens` (P2B7X.1) — Screen 3, `2 of 4`. Optional: an
 * empty selection continues. Every toggle autosaves through the one store.
 */

import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';

import { AllergensStep } from '@/components/onboarding/allergens-step';
import { StepPending } from '@/components/onboarding/step-pending';
import { useAccess } from '@/hooks/use-access';
import { useOnboardingPreferences } from '@/hooks/use-onboarding-preferences';
import { clearAllergens } from '@/lib/allergen-grid';
import { goBackFrom } from '@/lib/onboarding-navigation';
import { onboardingRoute } from '@/lib/onboarding-routes';
import { toggleAllergen } from '@/lib/personalization-screen';

export default function OnboardingAllergensScreen() {
  const access = useAccess();
  const { load, update } = useOnboardingPreferences();
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('allergens');
    }, [access]),
  );

  if (load.status !== 'ready') return <StepPending step="allergens" status={load.status} />;
  const prefs = load.prefs;
  return (
    <AllergensStep
      selected={prefs.allergens}
      onToggle={(token) => update(toggleAllergen(prefs, token))}
      onClear={() => {
        const next = clearAllergens(prefs);
        if (next !== prefs) update(next);
      }}
      onContinue={() => router.push(onboardingRoute('retailers'))}
      onBack={() => goBackFrom('allergens', router)}
    />
  );
}
