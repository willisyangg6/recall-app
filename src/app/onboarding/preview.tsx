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
 *   Edit preferences  presents the one-page editor over Ready; on return,
 *                     focus goes back to Edit preferences
 *   Back              the Stores step, choices kept
 *
 * Personalization is completed by the purchase on the paywall (or an
 *  entitled shopper's Continue there), never by reaching this screen, so a
 * kill and relaunch before buying resumes HERE. This screen holds no
 * purchase state and draws no purchase UI.
 */

import { useCallback, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, type View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { PreviewStep } from '@/components/onboarding/preview-step';
import { StepPending } from '@/components/onboarding/step-pending';
import { useAccess } from '@/hooks/use-access';
import { useFeed } from '@/hooks/use-feed';
import { useOnboardingPreferences } from '@/hooks/use-onboarding-preferences';
import { goBackFrom } from '@/lib/onboarding-navigation';
import { EDIT_PREFERENCES_ROUTE, onboardingRoute } from '@/lib/onboarding-routes';
import { isFeedConfigured } from '@/lib/recall-feed';
import { todayIso } from '@/lib/recall-presentation';
import { buildReadyPreview, type ReadyFeedInput } from '@/lib/ready-preview';

export default function OnboardingPreviewScreen() {
  const access = useAccess();
  const { load } = useOnboardingPreferences();
  const feed = useFeed();
  // Back from the editor, focus returns to the action that opened it.
  const editRef = useRef<View>(null);
  const editing = useRef(false);
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('preview');
      if (editing.current) {
        editing.current = false;
        const tag = findNodeHandle(editRef.current);
        if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag);
      }
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
      onEdit={() => {
        editing.current = true;
        router.push(EDIT_PREFERENCES_ROUTE);
      }}
      editRef={editRef}
      onBack={() => goBackFrom('preview', router)}
    />
  );
}
