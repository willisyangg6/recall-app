/**
 * `/onboarding/building` (the five-stop watch, 2026-10-02) — the one-time
 * step between Stores and Ready. No progress bar, no back control, no swipe
 * back (the root stack disables it), no footer until it is needed.
 *
 * ## Real data, presented
 *
 * Mounting the screen starts — or joins — the shared feed session's sync:
 * the same corpus the Feed and Ready read. Presentation begins only once the
 * screen is visible. The five stops are a presentation of the real matching
 * work (lib/building-watch.ts maps each one); the count is the Affects You
 * total Ready shows, computed from the same corpus, and nothing completes
 * before that corpus and the saved preferences exist. Ready then opens on
 * the corpus this screen counted (`useFeed({ reuseRecent: true })`).
 *
 * ## Leaving, once
 *
 * When usable results have been presented to completion, or the shopper
 * chooses Continue to preview from the slow or error state, the screen marks
 * the sticky `watchBuilt` fact and REPLACES itself with Ready, so Back from
 * Ready pops to Stores and this screen never replays. `watchBuilt` records
 * that the one-time presentation was spent, never that data succeeded:
 * Continue reaches Ready, whose own loading and error states take over.
 * Onboarding is not completed here. A kill DURING the presentation resumes
 * on this screen (its recorded step) and presents again from the real state.
 *
 * If the preferences cannot be read there is nothing truthful to present,
 * so the screen routes straight to Ready, whose pending state says why.
 */

import { useCallback, useEffect, useRef } from 'react';
import { router, useFocusEffect } from 'expo-router';

import { BuildingStep } from '@/components/onboarding/building-step';
import { Surface } from '@/components/ui/surface';
import type { UserRecallPreferences } from '@/domain/preferences';
import { useAccess } from '@/hooks/use-access';
import { useBuildingSequence } from '@/hooks/use-building-sequence';
import { useFeed, type Feed } from '@/hooks/use-feed';
import { useOnboardingPreferences } from '@/hooks/use-onboarding-preferences';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { buildingCaption, buildingCaptionCandidates, buildingData } from '@/lib/building-watch';
import { buildingDone } from '@/lib/onboarding-navigation';
import { motionAllowed } from '@/lib/onboarding-state';
import { presentedPreferences } from '@/lib/presented-preferences';
import { isFeedConfigured } from '@/lib/recall-feed';

export default function OnboardingBuildingScreen() {
  const access = useAccess();
  // The choices Stores just showed: the step draws on its first frame.
  const { load } = useOnboardingPreferences({ reuseLoaded: true });
  // Start or join the shared sync now, while the push is still sliding.
  const feed = useFeed();
  useFocusEffect(
    useCallback(() => {
      void access.recordShownStep('building');
    }, [access]),
  );
  // One exit, whichever asks first: completion, Continue, or an unreadable
  // preference store.
  const left = useRef(false);
  const leave = useCallback(
    (spent: boolean) => {
      if (left.current) return;
      left.current = true;
      if (spent) void access.completeWatchBuild();
      buildingDone(router);
    },
    [access],
  );
  const failed = load.status === 'failed' || load.status === 'unsupported';
  useEffect(() => {
    if (failed) leave(false);
  }, [failed, leave]);

  if (load.status !== 'ready') return <Surface background="background/page" style={{ flex: 1 }} />;
  return (
    <BuildingPresentation
      prefs={presentedPreferences(load.prefs)}
      feed={feed}
      onLeave={() => leave(true)}
    />
  );
}

function BuildingPresentation({
  prefs,
  feed,
  onLeave,
}: {
  prefs: UserRecallPreferences;
  feed: Feed;
  onLeave: () => void;
}) {
  const reduceMotion = useReduceMotion();
  // A build without a configured feed can never answer: that is a failure,
  // offered the same Continue, never an endless wait.
  const data = buildingData(
    isFeedConfigured() ? feed.state : { status: 'error' },
    feed.refreshing,
    prefs,
  );
  // Every caption this screen can show for these choices: the caption box is
  // sized to the tallest, so a change of words never moves the layout.
  // (The React Compiler memoizes this per choices and result.)
  const candidates = buildingCaptionCandidates(prefs, data);
  const sequence = useBuildingSequence({
    data,
    reduceMotion: !motionAllowed(reduceMotion),
    onComplete: onLeave,
  });
  return (
    <BuildingStep
      view={sequence.view}
      caption={buildingCaption(sequence.view, prefs, data)}
      captionCandidates={candidates}
      onCaptionSettled={sequence.captionSettled}
      onRetry={() => {
        sequence.retry();
        void feed.refresh();
      }}
      onContinue={() => {
        sequence.leave();
        onLeave();
      }}
    />
  );
}
