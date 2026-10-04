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
import { presentedPreferences } from '@/lib/presented-preferences';
import { isFeedConfigured } from '@/lib/recall-feed';
import { todayIso } from '@/lib/recall-presentation';
import { buildReadyPreview, readyCorpus } from '@/lib/ready-preview';

export default function OnboardingPreviewScreen() {
  const access = useAccess();
  // Arriving from the Building step, the choices it just read: no pending
  // flash. A cold resume still loads (and can still fail) as before.
  const { load } = useOnboardingPreferences({ reuseLoaded: true });
  // Arriving from the Building step, Ready opens on the corpus Building
  // counted, and does not reconcile again within the foreground threshold.
  const feed = useFeed({ reuseRecent: true });
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
  // The one corpus decision Building made too (`readyCorpus`): the session's
  // answer, else the bundled baseline, so Ready shows the count Building
  // counted; a sync that lands later replaces it with the live corpus.
  const feedInput = readyCorpus(isFeedConfigured() ? feed.state : { status: 'error' });
  // The saved choices (a development QA profile may present them differently,
  // display only).
  const prefs = presentedPreferences(load.prefs);
  return (
    <PreviewStep
      prefs={prefs}
      preview={buildReadyPreview(feedInput, prefs, todayIso())}
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
