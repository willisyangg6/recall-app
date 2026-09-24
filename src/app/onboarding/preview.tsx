/**
 * `/onboarding/preview` (P2B7X.1) — Screen 5, `4 of 4`. Reads the saved
 * preferences on every focus (an edit lands here on the way back), records
 * itself as the resume point, and hands the two actions to the gate and
 * the selectors:
 *
 *   View plans        completes personalization — the gate moves the app to
 *                     the paywall phase; nothing is navigated to
 *   Edit preferences  pushes the States step; completed choices are kept
 */

import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';

import { PreviewStep } from '@/components/onboarding/preview-step';
import { StepPending } from '@/components/onboarding/step-pending';
import { useAccess } from '@/hooks/use-access';
import { useOnboardingPreferences } from '@/hooks/use-onboarding-preferences';
import { goBackFrom } from '@/lib/onboarding-navigation';
import { onboardingRoute } from '@/lib/onboarding-routes';

export default function OnboardingPreviewScreen() {
  const access = useAccess();
  const { load } = useOnboardingPreferences();
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('preview');
    }, [access]),
  );

  if (load.status !== 'ready') return <StepPending step="preview" status={load.status} />;
  return (
    <PreviewStep
      prefs={load.prefs}
      onViewPlans={() => void access.completePersonalization()}
      onEdit={() => router.push(onboardingRoute('states'))}
      onBack={() => goBackFrom('preview', router)}
    />
  );
}
