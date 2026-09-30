/**
 * `/onboarding/problem-scale` (2026-09-28) — Screen 2, step 1 of 5: the
 * scale of foodborne illness (CDC). Records itself as the resume point,
 * Continue pushes the second problem screen, Back returns to Welcome.
 */

import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';

import { ProblemScaleStep } from '@/components/onboarding/problem-steps';
import { useAccess } from '@/hooks/use-access';
import { goBackFrom } from '@/lib/onboarding-navigation';
import { onboardingRoute } from '@/lib/onboarding-routes';

export default function OnboardingProblemScaleScreen() {
  const access = useAccess();
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('problem-scale');
    }, [access]),
  );
  return (
    <ProblemScaleStep
      onContinue={() => router.push(onboardingRoute('problem-risk'))}
      onBack={() => goBackFrom('problem-scale', router)}
    />
  );
}
