/**
 * `/onboarding/problem-risk` (2026-09-28) — Screen 3, step 2 of 5: who
 * faces higher stakes (CDC). Records itself as the resume point, Continue
 * pushes the States step, Back returns to the scale screen.
 */

import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';

import { ProblemRiskStep } from '@/components/onboarding/problem-steps';
import { useAccess } from '@/hooks/use-access';
import { goBackFrom } from '@/lib/onboarding-navigation';
import { onboardingRoute } from '@/lib/onboarding-routes';

export default function OnboardingProblemRiskScreen() {
  const access = useAccess();
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('problem-risk');
    }, [access]),
  );
  return (
    <ProblemRiskStep
      onContinue={() => router.push(onboardingRoute('states'))}
      onBack={() => goBackFrom('problem-risk', router)}
    />
  );
}
