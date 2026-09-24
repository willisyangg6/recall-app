/**
 * `/onboarding/welcome` (P2B7X.1) — Screen 1. Records itself as the resume
 * point while personalization is incomplete and hands `Get started` to the
 * States step. Mounted only in the onboarding phase (the root layout's
 * protected group).
 */

import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';

import { WelcomeContent } from '@/components/onboarding/welcome-content';
import { useAccess } from '@/hooks/use-access';
import { onboardingRoute } from '@/lib/onboarding-routes';

export default function WelcomeScreen() {
  const access = useAccess();
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('welcome');
    }, [access]),
  );
  return <WelcomeContent onGetStarted={() => router.push(onboardingRoute('states'))} />;
}
