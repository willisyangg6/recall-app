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
import { EMPTY_PREFERENCES } from '@/domain/preferences';
import { useAccess } from '@/hooks/use-access';
import { useFeed } from '@/hooks/use-feed';
import { useOnboardingPreferences } from '@/hooks/use-onboarding-preferences';
import { goBackFrom } from '@/lib/onboarding-navigation';
import { EDIT_PREFERENCES_ROUTE, onboardingRoute } from '@/lib/onboarding-routes';
import { presentedPreferences } from '@/lib/presented-preferences';
import { isFeedConfigured } from '@/lib/recall-feed';
import { readyCorpus } from '@/lib/ready-preview';
import { useCalendarClock } from '@/hooks/use-calendar-clock';
import { useReadyPreview } from '@/hooks/use-ready-preview';

type DevelopmentProbe = typeof import('@/lib/development-photo-probe');

/** Development only: the one-shot "change the card set during a settle" control. */
const developmentProbe = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/lib/development-photo-probe') as DevelopmentProbe)
  : null;

export default function OnboardingPreviewScreen() {
  const access = useAccess();
  // Arriving from the Building step, the choices it just read: no pending
  // flash. A cold resume still loads (and can still fail) as before.
  const { load } = useOnboardingPreferences({ reuseLoaded: true });
  // Arriving from the Building step, Ready opens on the corpus Building
  // counted, and does not reconcile again within the foreground threshold.
  const feed = useFeed({ reuseRecent: true });
  // The one corpus decision Building made too (`readyCorpus`): the session's
  // answer, else the bundled baseline, so Ready shows the count Building
  // counted; a sync that lands later replaces it with the live corpus.
  const feedInput = readyCorpus(isFeedConfigured() ? feed.state : { status: 'error' });
  // The saved choices (a development QA profile may present them differently,
  // display only). Before they load, nothing matches and nothing is probed.
  const prefs = presentedPreferences(load.status === 'ready' ? load.prefs : EMPTY_PREFERENCES);
  // The preview with photo knowledge: the pure selection over the real
  // matches, fed by the bounded photo session for these candidates — the one
  // the Building step started when Ready is reached from it.
  const now = useCalendarClock();
  const { preview, onPhotoFailed } = useReadyPreview(
    load.status === 'ready' ? feedInput : { status: 'loading' },
    prefs,
    now,
  );
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
  return (
    <PreviewStep
      prefs={prefs}
      preview={preview}
      onPhotoFailed={onPhotoFailed}
      onDeckSettling={
        developmentProbe
          ? () => developmentProbe.developmentDeckSettling(preview, onPhotoFailed)
          : undefined
      }
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
