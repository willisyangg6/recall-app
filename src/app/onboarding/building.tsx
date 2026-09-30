/**
 * `/onboarding/building` (2026-09-28) — the one-time "building your watch"
 * interstitial between Stores and Ready. No progress bar, no back control,
 * no footer: about 3.2 seconds of truthful captions while the recall feed
 * the Ready preview reads syncs underneath (`useFeed` mounted here is the
 * prefetch — the session is shared, so Ready's own mount answers from it).
 *
 * When the sequence finishes it marks the sticky `watchBuilt` fact and
 * REPLACES itself with Ready, so Back from Ready pops to Stores and the
 * interstitial never replays — not from Ready or the paywall, and not on a
 * relaunch (Stores' Continue skips it once `watchBuilt` is set; a kill
 * DURING the play resumes here and finishes the one play).
 *
 * If the preferences cannot be read there is nothing truthful to caption,
 * so the screen routes straight to Ready — whose own pending state says
 * what is wrong — rather than trapping the shopper behind a loader.
 */

import { useCallback, useEffect } from 'react';
import { router, useFocusEffect } from 'expo-router';

import { BuildingStep } from '@/components/onboarding/building-step';
import { useAccess } from '@/hooks/use-access';
import { useFeed } from '@/hooks/use-feed';
import { useOnboardingPreferences } from '@/hooks/use-onboarding-preferences';
import { buildingDone } from '@/lib/onboarding-navigation';

export default function OnboardingBuildingScreen() {
  const access = useAccess();
  const { load } = useOnboardingPreferences();
  // The prefetch: mounting the hook starts (or joins) the feed sync the
  // Ready preview will read. The state itself is not consumed here.
  useFeed();
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('building');
    }, [access]),
  );
  const done = useCallback(() => {
    void access.completeWatchBuild();
    buildingDone(router);
  }, [access]);
  // An unreadable preference store: nothing truthful to caption, so go
  // straight to Ready, which explains the failure itself.
  const failed = load.status === 'failed' || load.status === 'unsupported';
  useEffect(() => {
    if (failed) buildingDone(router);
  }, [failed]);

  if (load.status !== 'ready') return null;
  return <BuildingStep prefs={load.prefs} onDone={done} />;
}
