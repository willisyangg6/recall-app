/**
 * `/onboarding/preview` — the Ready step (P2B7X.1; carousel 2026-09-28).
 * Reads the saved preferences on every focus (an edit lands here on the way
 * back), reads the REAL recall feed through the same session the Feed uses,
 * builds the preview through the Feed's own matching layer
 * (lib/ready-preview.ts), records itself as the resume point, and hands its
 * actions on:
 *
 *   See my plan       pushes the dedicated onboarding paywall — the locked
 *                     strip and the locked sentinel go there too
 *   Edit preferences  pushes the States step; completed choices are kept
 *   Back              the Stores step, choices kept
 *
 * Personalization is completed by the purchase on the paywall (or an
 *  entitled shopper's Continue there), never by reaching this screen, so a
 * kill and relaunch before buying resumes HERE. This screen holds no
 * purchase state and draws no purchase UI.
 */

import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';

import { PreviewStep } from '@/components/onboarding/preview-step';
import { StepPending } from '@/components/onboarding/step-pending';
import { useAccess } from '@/hooks/use-access';
import { useFeed } from '@/hooks/use-feed';
import { useOnboardingPreferences } from '@/hooks/use-onboarding-preferences';
import { goBackFrom } from '@/lib/onboarding-navigation';
import { onboardingRoute } from '@/lib/onboarding-routes';
import { isFeedConfigured } from '@/lib/recall-feed';
import { todayIso } from '@/lib/recall-presentation';
import { buildReadyPreview, type ReadyFeedInput } from '@/lib/ready-preview';

export default function OnboardingPreviewScreen() {
  const access = useAccess();
  const { load } = useOnboardingPreferences();
  const feed = useFeed();
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('preview');
    }, [access]),
  );

  if (load.status !== 'ready') return <StepPending step="preview" status={load.status} />;
  // A build without a configured feed can never answer: say so honestly
  // rather than checking forever.
  const feedInput: ReadyFeedInput = isFeedConfigured() ? feed.state : { status: 'error' };
  return (
    <PreviewStep
      prefs={load.prefs}
      preview={buildReadyPreview(feedInput, load.prefs, todayIso())}
      onSeePlan={() => router.push(onboardingRoute('paywall'))}
      onEdit={() => router.push(onboardingRoute('states'))}
      onBack={() => goBackFrom('preview', router)}
    />
  );
}
