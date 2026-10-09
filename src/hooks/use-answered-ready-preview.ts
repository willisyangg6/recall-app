/**
 * The Ready preview's answer and the deck it keeps on screen — the render
 * lifecycle half of `useReadyPreview`, kept free of React Native so a Node
 * test can render it.
 *
 * The answer is a pure function of its inputs. While a corpus update's new
 * photos are being checked for the SAME preferences, the last answered deck
 * stays on screen; a preference change shows the check, never the old deck.
 *
 * The answer is memoised on its inputs' CONTENT, never their identity
 * (2026-10-08). Ready rebuilds its corpus input (`readyCorpus`) and its
 * preference object on every render; memoised on those objects, every
 * render produced a new answer, the render-phase update below fired again,
 * and Ready failed with React's "Too many re-renders" as soon as the photos
 * settled. Keyed by content, the render after that update gets the same
 * answer back and the update does not repeat: one new answer per real change
 * (a corpus refresh, a preference change, a photo verdict, a new day).
 *
 * `answer` must be a stable function (a module-level one); it is not a key.
 */

import { useMemo, useState } from 'react';

import type { UserRecallPreferences } from '@/domain/preferences';
import type { PhotoSnapshot } from '@/lib/ready-photo-registry';
import type { ReadyFeedInput, ReadyPreviewState } from '@/lib/ready-preview';

export interface ReadyPreviewInputs {
  feed: ReadyFeedInput;
  prefs: UserRecallPreferences;
  today: string;
  now: Date;
  photos: PhotoSnapshot;
  candidates: readonly string[];
}

export function useAnsweredReadyPreview(
  inputs: ReadyPreviewInputs,
  answer: (inputs: ReadyPreviewInputs) => ReadyPreviewState,
): ReadyPreviewState {
  const { feed, today, now, photos, candidates } = inputs;
  const items = feed.status === 'ready' ? feed.items : null;
  const source = feed.status === 'ready' ? feed.source : undefined;
  const prefsKey = JSON.stringify(inputs.prefs);
  const nowMs = now.getTime();
  const candidatesKey = candidates.join('\n');

  const computed = useMemo<ReadyPreviewState>(
    () => {
      if (items === null || !photos.settled) return { kind: 'checking' };
      return answer(inputs);
    },
    // Content keys only: `inputs` is a new object every render, and each
    // field it carries is represented here by what it holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, source, prefsKey, today, nowMs, photos, candidatesKey],
  );

  const [shown, setShown] = useState<{ preview: ReadyPreviewState; prefsKey: string } | null>(null);
  if (
    computed.kind !== 'checking' &&
    (shown?.preview !== computed || shown.prefsKey !== prefsKey)
  ) {
    setShown({ preview: computed, prefsKey });
  }
  return computed.kind === 'checking' && items !== null && shown?.prefsKey === prefsKey
    ? shown.preview
    : computed;
}
