/**
 * Bounded photo probing for the Ready preview (2026-10-05).
 *
 * A readable preview in a "with photo" group must have a photo that LOADED,
 * not merely a stored URL. The deck therefore asks the platform to prefetch
 * each candidate's photo before it decides which cards are readable, under
 * three bounds and one memory:
 *
 *   - every probe has a deadline (`PHOTO_PROBE_TIMEOUT_MS`): nothing waits
 *     on one image indefinitely;
 *   - at most `PHOTO_PROBE_CONCURRENCY` probes are in flight at once;
 *   - a session-scoped memory keyed by URL: a photo that loaded is not asked
 *     for again, and a photo that failed or timed out is treated as absent
 *     for the rest of the session with no second request. Failures share the
 *     card tile's own memory (lib/image-failures.ts), so the deck and the
 *     Feed agree about a broken image.
 *
 * The platform call is injected (`PhotoPrefetch`) so the module is testable
 * under Node and so development QA can stand in a probe that fails or hangs.
 * This module never decides WHICH recalls are shown — `lib/ready-preview.ts`
 * does, reading only the verdicts.
 */

import { hasImageFailed, recordImageFailure } from './image-failures';

/** How long one photo may take to prefetch before it counts as absent. */
export const PHOTO_PROBE_TIMEOUT_MS = 4000;
/** How many prefetches run at once. */
export const PHOTO_PROBE_CONCURRENCY = 3;

/** Resolves true when the platform has the image, false when it cannot get it. */
export type PhotoPrefetch = (url: string) => Promise<boolean>;

export type PhotoVerdict = 'loaded' | 'unavailable';

const loadedPhotoUrls = new Set<string>();

/** What this session already knows about a URL, or null when it must be probed. */
export function knownPhotoVerdict(url: string): PhotoVerdict | null {
  if (loadedPhotoUrls.has(url)) return 'loaded';
  if (hasImageFailed(url)) return 'unavailable';
  return null;
}

export function recordPhotoLoaded(url: string): void {
  loadedPhotoUrls.add(url);
}

/** Tests only: forget every verdict. */
export function resetPhotoMemory(): void {
  loadedPhotoUrls.clear();
}

export interface PhotoProbeDeps {
  prefetch: PhotoPrefetch;
  timeoutMs?: number;
  concurrency?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface PhotoProbeRun {
  /** Stop issuing probes and stop reporting. In-flight results still reach the session memory. */
  cancel(): void;
}

/**
 * Probe `urls` in order, reporting one verdict per URL exactly once. Known
 * verdicts are reported synchronously, before any request; the rest are
 * prefetched under the concurrency and timeout bounds. A URL listed twice is
 * probed once.
 */
export function probePhotos(
  urls: readonly string[],
  deps: PhotoProbeDeps,
  onVerdict: (url: string, verdict: PhotoVerdict) => void,
): PhotoProbeRun {
  const timeoutMs = deps.timeoutMs ?? PHOTO_PROBE_TIMEOUT_MS;
  const concurrency = Math.max(1, deps.concurrency ?? PHOTO_PROBE_CONCURRENCY);
  const schedule = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const unschedule = deps.clearTimeout ?? ((handle) => clearTimeout(handle as never));

  let cancelled = false;
  const queue: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const known = knownPhotoVerdict(url);
    if (known !== null) onVerdict(url, known);
    else queue.push(url);
  }

  let inFlight = 0;
  const report = (url: string, verdict: PhotoVerdict) => {
    if (verdict === 'loaded') recordPhotoLoaded(url);
    else recordImageFailure(url);
    if (!cancelled) onVerdict(url, verdict);
  };
  const next = (): void => {
    while (!cancelled && inFlight < concurrency && queue.length > 0) {
      const url = queue.shift()!;
      inFlight += 1;
      let done = false;
      const finish = (verdict: PhotoVerdict) => {
        if (done) return;
        done = true;
        unschedule(timer);
        inFlight -= 1;
        report(url, verdict);
        next();
      };
      const timer = schedule(() => finish('unavailable'), timeoutMs);
      let outcome: Promise<boolean>;
      try {
        outcome = deps.prefetch(url);
      } catch {
        outcome = Promise.resolve(false);
      }
      void outcome.then(
        (ok) => finish(ok ? 'loaded' : 'unavailable'),
        () => finish('unavailable'),
      );
    }
  };
  next();

  return {
    cancel() {
      cancelled = true;
      queue.length = 0;
    },
  };
}
