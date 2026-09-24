/**
 * `/onboarding/states` (P2B7X.1) — Screen 2, `1 of 4`. Reads and saves
 * through the one preference store (every change autosaves), records
 * itself as the resume point, requires at least one state to continue.
 */

import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';

import { StepPending } from '@/components/onboarding/step-pending';
import { StatesStep } from '@/components/onboarding/states-step';
import { useAccess } from '@/hooks/use-access';
import { useOnboardingPreferences } from '@/hooks/use-onboarding-preferences';
import { goBackFrom } from '@/lib/onboarding-navigation';
import { onboardingRoute } from '@/lib/onboarding-routes';
import { withStates } from '@/lib/personalization-screen';

export default function OnboardingStatesScreen() {
  const access = useAccess();
  const { load, update } = useOnboardingPreferences();
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('states');
    }, [access]),
  );

  if (load.status !== 'ready') return <StepPending step="states" status={load.status} />;
  const prefs = load.prefs;
  return (
    <StatesStep
      selected={prefs.states}
      onChange={(codes) => update(withStates(prefs, codes))}
      onContinue={() => router.push(onboardingRoute('allergens'))}
      onBack={() => goBackFrom('states', router)}
    />
  );
}
