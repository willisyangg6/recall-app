/**
 * The Ready screen's preview with photo knowledge (2026-10-05): the pure
 * selection (lib/ready-preview.ts) fed by one photo session per set of
 * candidate photos (lib/ready-photo-session.ts), probing through the
 * platform's image prefetch under the probe's bounds.
 *
 * The sessions live in one bounded registry (lib/ready-photo-registry.ts),
 * keyed by the candidate URLs themselves. The Building step starts Ready's
 * session early (`warmReadyPhotos`), without awaiting it, and Ready adopts it
 * by the same key — so arriving from Building the photos have usually been
 * answered already. Entered directly, Ready starts the session itself,
 * bounded by the session's deadline.
 *
 * What this hook owns is only the reading: it subscribes through
 * `useSyncExternalStore`, renders a snapshot (never a live object), and
 * keeps a shown deck on screen while a corpus update's new photos are being
 * checked for the same preferences, so a sync never turns a deck back into
 * the "checking" state (hooks/use-answered-ready-preview). Everything about WHICH recalls are shown stays in
 * the pure modules, and the count is the production count whatever the
 * photos do.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { Image } from 'react-native';

import type { FeedItem } from '@/lib/recall-feed';
import type { UserRecallPreferences } from '@/domain/preferences';
import type { PhotoPrefetch } from '@/lib/photo-probe';
import {
  createPhotoRegistry,
  photoSessionKey,
  type PhotoRegistryEvent,
} from '@/lib/ready-photo-registry';
import { startPhotoSession } from '@/lib/ready-photo-session';
import {
  buildReadyPreview,
  photoCandidates,
  type ReadyFeedInput,
  type ReadyPreviewState,
} from '@/lib/ready-preview';
import { todayIso } from '@/lib/recall-presentation';

import { useAnsweredReadyPreview, type ReadyPreviewInputs } from './use-answered-ready-preview';

type DevelopmentProbe = typeof import('@/lib/development-photo-probe');

/**
 * The stand-in probes exist only in development, reached through a `require`
 * inside the `__DEV__` branch, so a release bundle folds the module away and
 * the prefetch below is always the platform's.
 */
const developmentProbe = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/lib/development-photo-probe') as DevelopmentProbe)
  : null;

const platformPrefetch: PhotoPrefetch = (url) => Image.prefetch(url);

const prefetch: PhotoPrefetch =
  __DEV__ && developmentProbe
    ? developmentProbe.wrapDevelopmentPrefetch(platformPrefetch)
    : platformPrefetch;

/** Development only: one line per session event in the Metro log, for handoff QA. */
function logEvent(event: PhotoRegistryEvent): void {
  if (!__DEV__) return;
  const id = `${event.key.length}:${event.key.slice(-24)}`;
  console.info(`[Ready photos] ${event.kind} ${id}`, { ...event, key: undefined });
}

const registry = createPhotoRegistry({
  start: (candidates, onChange) => startPhotoSession(candidates, { prefetch }, onChange),
  onEvent: __DEV__ ? logEvent : undefined,
});

if (__DEV__ && developmentProbe) developmentProbe.onDevelopmentPhotoReset(() => registry.clear());

/**
 * The Building step's warm-up: start the photo session Ready will need for
 * this corpus and these preferences, and return at once. Idempotent per key.
 */
export function warmReadyPhotos(
  items: readonly FeedItem[],
  prefs: UserRecallPreferences,
  now: Date,
): void {
  registry.warm(photoCandidates(items, prefs, now));
}

/** The selection over the photo verdicts (and, in development, a QA stand-in). */
function answerReadyPreview(inputs: ReadyPreviewInputs): ReadyPreviewState {
  const { feed, prefs, today, now, photos, candidates } = inputs;
  const built = buildReadyPreview(feed, prefs, today, now, { loaded: photos.loaded });
  return developmentProbe ? developmentProbe.developmentPreview(built, candidates[0]) : built;
}

/** One candidate set's session as an external store (stable per key). */
function photoStore(candidates: readonly string[]) {
  const key = photoSessionKey(candidates);
  return {
    key,
    subscribe: (listener: () => void) => registry.subscribe(candidates, listener),
    getSnapshot: () => registry.snapshot(key),
  };
}

export function useReadyPreview(
  feed: ReadyFeedInput,
  prefs: UserRecallPreferences,
  /** The screen's calendar clock (hooks/use-calendar-clock): eligibility and card dates. */
  now: Date,
): { preview: ReadyPreviewState; onPhotoFailed: (url: string) => void } {
  const items = feed.status === 'ready' ? feed.items : null;
  const prefsKey = JSON.stringify(prefs);
  const today = todayIso(now);
  const candidates = useMemo(
    () =>
      items === null
        ? []
        : photoCandidates(items, JSON.parse(prefsKey) as UserRecallPreferences, now),
    [items, prefsKey, now],
  );
  const candidatesKey = photoSessionKey(candidates);
  // Keyed by the candidates' content: a new array with the same photos is
  // the same session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => photoStore(candidates), [candidatesKey]);
  const photos = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const onPhotoFailed = useCallback(
    (url: string) =>
      registry.fail(store.key, developmentProbe ? developmentProbe.originalPhotoUrl(url) : url),
    [store],
  );

  // The answer and the deck kept on screen (hooks/use-answered-ready-preview),
  // memoised on the inputs' content — Ready rebuilds these objects every
  // render.
  const preview = useAnsweredReadyPreview(
    { feed, prefs, today, now, photos, candidates },
    answerReadyPreview,
  );
  return { preview, onPhotoFailed };
}
