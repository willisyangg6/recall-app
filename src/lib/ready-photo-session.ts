/**
 * One Ready screen's photo session (2026-10-05): which candidate photos have
 * loaded, when the deck may be shown, and what a late or failed photo may
 * change. Pure apart from injected timers, so every timing case is a unit
 * test rather than a device reproduction.
 *
 * ## The contract
 *
 *   - `settled` turns true when every candidate has a verdict, or when
 *     `PHOTO_DECK_DEADLINE_MS` passes — whichever is first. Until then the screen
 *     shows its quiet `checking` state; afterwards the deck is built from the
 *     verdicts, with any candidate still unanswered counted as absent.
 *   - A verdict that arrives AFTER settling never promotes a photo: a deck
 *     that has been shown does not rearrange itself because a slow image
 *     finally came in. (The session memory still remembers the success for
 *     the next build.)
 *   - `fail(url)` — a shown photo that failed to render after all — marks it
 *     absent and notifies, so the recall reclassifies to its no-photo group.
 *     The carousel applies that change only at rest.
 *   - Each session is one generation. `cancel()` ends it: no later callback
 *     from its probes reaches the listener, so an unmounted or rebuilt screen
 *     can never be written to.
 */

import { probePhotos, type PhotoProbeDeps, type PhotoVerdict } from './photo-probe';

/**
 * How long the deck may wait for its first photos before it is shown as is.
 * Not the carousel's card animation (`DECK_SETTLE_MS`, 260 ms, in
 * lib/ready-presentation.ts): this is a data deadline, that is motion.
 */
export const PHOTO_DECK_DEADLINE_MS = 5000;

export interface PhotoSessionDeps extends PhotoProbeDeps {
  deadlineMs?: number;
}

export interface PhotoSession {
  /** Whether the deck may be built: every candidate answered, or the deadline passed. */
  settled(): boolean;
  /** True only for a candidate whose photo loaded before the session settled. */
  isLoaded(url: string): boolean;
  /** A shown photo failed to render: treat it as absent from now on. */
  fail(url: string): void;
  /** End the session; nothing it started may notify again. */
  cancel(): void;
}

export function startPhotoSession(
  candidates: readonly string[],
  deps: PhotoSessionDeps,
  onChange: () => void,
): PhotoSession {
  const schedule = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const unschedule = deps.clearTimeout ?? ((handle) => clearTimeout(handle as never));
  const verdicts = new Map<string, PhotoVerdict>();
  const pending = new Set<string>(candidates);
  let settled = false;
  let cancelled = false;
  let timer: unknown = null;

  const settle = () => {
    if (settled || cancelled) return;
    settled = true;
    if (timer !== null) unschedule(timer);
    // Unanswered candidates are absent for this build; a late success is a
    // success for the next build only.
    for (const url of pending) verdicts.set(url, 'unavailable');
    pending.clear();
    onChange();
  };

  const run = probePhotos(candidates, deps, (url, verdict) => {
    if (cancelled) return;
    if (settled) return; // never promote (or change) after the deck is shown
    verdicts.set(url, verdict);
    pending.delete(url);
    if (pending.size === 0) settle();
    else onChange();
  });

  if (pending.size === 0) settled = true;
  else timer = schedule(settle, deps.deadlineMs ?? PHOTO_DECK_DEADLINE_MS);

  return {
    settled: () => settled,
    isLoaded: (url) => verdicts.get(url) === 'loaded',
    fail(url) {
      if (cancelled) return;
      if (verdicts.get(url) === 'unavailable') return;
      verdicts.set(url, 'unavailable');
      pending.delete(url);
      onChange();
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      run.cancel();
      if (timer !== null) unschedule(timer);
    },
  };
}
