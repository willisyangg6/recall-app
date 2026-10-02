/**
 * The Building step's sequence, mounted (2026-10-02): the pure sequencer in
 * lib/building-watch.ts wired to the device.
 *
 *   visibility  the stack's `transitionEnd` for this screen's arrival (its
 *               push has settled), or — a cold resume has no push — a
 *               fallback shortly after mount; the sequencer ignores the
 *               second report, so both may arrive
 *   foreground  AppState: presentation time stops in the background and
 *               resumes from the real state on return
 *   data        the gate the route derives from the shared feed
 *   speech      the start, completion, slow and error announcements
 *
 * Everything is torn down on departure: the listeners, the fallback, the
 * sequencer's timer. The sequencer itself guarantees `onComplete` at most
 * once and nothing at all after `dispose`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { useNavigation } from 'expo-router';

import {
  BUILDING_TIMING,
  createBuildingSequence,
  type BuildingData,
  type BuildingSequence,
  type BuildingView,
} from '@/lib/building-watch';

/** The one event the native stack sends a screen when its transition ends. */
type TransitionEnd = { data?: { closing?: boolean } };

export function useBuildingSequence({
  data,
  reduceMotion,
  onComplete,
}: {
  data: BuildingData;
  reduceMotion: boolean;
  onComplete: () => void;
}): {
  view: BuildingView;
  retry: () => void;
  leave: () => void;
  /** The beat's caption reached full opacity on screen. */
  captionSettled: () => void;
} {
  const navigation = useNavigation();
  const [view, setView] = useState<BuildingView>({ phase: 'arriving', beat: 0 });
  const sequence = useRef<BuildingSequence | null>(null);
  const complete = useRef(onComplete);
  const latest = useRef(data);
  useEffect(() => {
    complete.current = onComplete;
  }, [onComplete]);

  // Created once per mount. Reduce Motion is decided at mount, as elsewhere
  // in onboarding: a screen never starts animating late.
  const [motionReduced] = useState(reduceMotion);
  useEffect(() => {
    const created = createBuildingSequence({
      reduceMotion: motionReduced,
      clock: {
        now: () => Date.now(),
        setTimeout: (run, ms) => setTimeout(run, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      onChange: setView,
      onComplete: () => complete.current(),
      onAnnounce: (text) => AccessibilityInfo.announceForAccessibility(text),
    });
    sequence.current = created;
    created.setData(latest.current);
    if (AppState.currentState !== 'active') created.pause();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') created.resume();
      else created.pause();
    });
    return () => {
      subscription.remove();
      created.dispose();
      if (sequence.current === created) sequence.current = null;
    };
  }, [motionReduced]);

  const kind = data.kind;
  const total = data.kind === 'usable' ? data.total : null;
  useEffect(() => {
    latest.current = data;
    sequence.current?.setData(data);
    // Keyed by what the gate says, not the object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, total]);

  useEffect(() => {
    const show = () => sequence.current?.visible();
    const unsubscribe = navigation.addListener(
      'transitionEnd' as never,
      ((event: TransitionEnd) => {
        if (!event?.data?.closing) show();
      }) as never,
    );
    const fallback = setTimeout(show, BUILDING_TIMING.visibilityFallbackMs);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, [navigation]);

  const retry = useCallback(() => sequence.current?.retry(), []);
  const leave = useCallback(() => sequence.current?.dispose(), []);
  const captionSettled = useCallback(() => sequence.current?.captionSettled(), []);
  return { view, retry, leave, captionSettled };
}
