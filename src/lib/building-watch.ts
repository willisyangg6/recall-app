/**
 * The Building step's rules (the five-stop watch, 2026-10-02): what each stop
 * means, when the screen may say what, and when it moves on. A leaf — no
 * React, no I/O, clock injected — so every gate, interruption and timing is
 * provable under Node.
 *
 * ## The five stops and the real work behind them
 *
 *   1. Area       The shared feed session's sync (started or joined when the
 *                 route mounts) delivering a complete corpus — the same one
 *                 the Feed and Ready read — and the saved preferences.
 *   2. Allergens  The allergen signal of `evaluatePersonalRelevance`.
 *   3. Stores     Its retailer signal.
 *   4. Matches    `affectsYouMatches(...)`: the Affects You counted list (in
 *                 the window, or confirmed open by the agency), whose length
 *                 is the count Ready shows.
 *   5. Feed       That same ranked list, which Ready receives.
 *
 * Stops 2–5 are ONE synchronous evaluation over the loaded corpus: the screen
 * presents its real checks one at a time, but it makes no request per stop,
 * runs no matching of its own and stages no fake work. Nothing completes
 * before the corpus and the preferences exist: the presentation holds on
 * Area, active, until usable results arrive.
 *
 * ## The data gate
 *
 * `buildingData` reads what the feed hook answered. A complete corpus — the
 * session's cache or a finished sync — is usable: under the app's existing
 * freshness policy a valid cached corpus IS the feed (shoppers are never told
 * about freshness), and its count is the count Ready shows from the same
 * corpus. A corpus that could not be read with nothing cached is `failed`;
 * while a retry is in flight it is `pending` again.
 *
 * ## Timing (foreground, visible time only)
 *
 * The clock starts when the route is VISIBLE (its push settled, or a cold
 * resume's fallback), never at mount, and stops while the app is in the
 * background. With usable results each stop shows for `stopMs`, then the
 * completion holds for `completionHoldMs`, each hold starting once the
 * stop's caption has faded through (`captionFadeMs`): about 9.4 s in all
 * (founder pacing, 2026-10-02: settled reading time, not slower motion). These are
 * display minima, not evidence of completion: slow data keeps Area's pending
 * caption up. After `slowAfterMs` of foreground time with no usable results
 * the screen says so and offers Retry and Continue to preview; a failure with
 * nothing cached says so at once. Neither path ever shows a count or a
 * completion.
 *
 * ## Reduce Motion
 *
 * No staged build-up: once results are usable, Area, Allergens and Stores
 * complete together and the count holds for a readable `reducedCountHoldMs`,
 * then the completion for `reducedCompletionHoldMs`. It still waits for real
 * results; it never draws a stop complete while data is pending.
 */

import type { UserRecallPreferences } from '@/domain/preferences';
import {
  BUILDING_AREA_CAPTION,
  BUILDING_DONE_CAPTION,
  BUILDING_ERROR_CAPTION,
  BUILDING_FEED_CAPTION,
  BUILDING_HEADLINE,
  BUILDING_SLOW_CAPTION,
  buildingAllergensCaption,
  buildingMatchesParts,
  buildingStoresCaption,
} from '@/lib/onboarding-copy';
import { affectsYouMatches, type FeedAnswer, type ReadyFeedInput } from '@/lib/ready-preview';

// ── The stops ───────────────────────────────────────────────────────────────

export type BuildingStopId = 'area' | 'allergens' | 'stores' | 'matches' | 'feed';

export const BUILDING_STOPS: readonly BuildingStopId[] = [
  'area',
  'allergens',
  'stores',
  'matches',
  'feed',
];

/** The beat after the last stop: every stop complete. */
export const COMPLETE_BEAT = BUILDING_STOPS.length;
/** The Matches stop's beat. */
const MATCHES_BEAT = BUILDING_STOPS.indexOf('matches');

// ── The data gate ───────────────────────────────────────────────────────────

export type BuildingData =
  { kind: 'pending' } | { kind: 'usable'; total: number } | { kind: 'failed' };

/**
 * What the screen may claim from what the feed answered. `refreshing` is a
 * retry in flight, which makes an earlier failure pending again.
 */
export function buildingData(
  feed: FeedAnswer | ReadyFeedInput,
  refreshing: boolean,
  prefs: UserRecallPreferences,
  now?: Date,
): BuildingData {
  if (feed.status === 'loading') return { kind: 'pending' };
  if (feed.status === 'error') return refreshing ? { kind: 'pending' } : { kind: 'failed' };
  return { kind: 'usable', total: affectsYouMatches(feed.items, prefs, now).length };
}

// ── Timing ──────────────────────────────────────────────────────────────────

export const BUILDING_TIMING = {
  /**
   * Each stop's readable minimum, once results are usable: foreground,
   * visible time, counted from the moment its caption is FULLY visible —
   * after the beat's fade-through, which runs at its usual speed outside
   * the hold (founder, 2026-10-04: 1,100ms, from 1,500ms).
   */
  stopMs: 1_100,
  /**
   * The caption fade-through that opens every beat after Area: the outgoing
   * caption fades to nothing (`captionFadeOutMs`), the words swap while
   * nothing is visible — the rail and tags change from that same moment —
   * and the incoming caption fades in (`captionFadeInMs`). Each stop's
   * reading hold, and the completion's, start once it is fully visible.
   */
  captionFadeOutMs: 80,
  captionFadeInMs: 140,
  /** The whole fade-through: out, then in, with no pause between. */
  captionFadeMs: 220,
  /** The completion caption's hold before Ready. */
  completionHoldMs: 800,
  /** Foreground visible time without usable results before the slow escape. */
  slowAfterMs: 10_000,
  /** A cold resume has no push to settle: present after this if none reports. */
  visibilityFallbackMs: 700,
  /**
   * Reduce Motion: Area's minimum before the reduced jump to the count —
   * unchanged by the slower animated pacing (2026-10-02), so the reduced
   * path stays about 3 s.
   */
  reducedAreaMs: 560,
  /** Reduce Motion: the count's readable hold. */
  reducedCountHoldMs: 1_600,
  /** Reduce Motion: the completion's readable hold. */
  reducedCompletionHoldMs: 900,
} as const;

/**
 * The presentation's whole length with usable results and motion allowed:
 * Area's hold (its caption is already up when the screen arrives), then for
 * each later stop and the completion a crossfade before its hold.
 */
export function presentedDurationMs(): number {
  const T = BUILDING_TIMING;
  const later = BUILDING_STOPS.length - 1;
  return T.stopMs + later * (T.captionFadeMs + T.stopMs) + T.captionFadeMs + T.completionHoldMs;
}

// ── The view ────────────────────────────────────────────────────────────────

export type BuildingPhase =
  /** Mounted, not yet visible: the push is still sliding. */
  | 'arriving'
  | 'presenting'
  | 'slow'
  | 'error'
  | 'complete'
  /** Ready has been asked for; nothing more happens here. */
  | 'left';

export type StopState = 'upcoming' | 'active' | 'complete';

export interface BuildingView {
  phase: BuildingPhase;
  /** The active stop's index, or `COMPLETE_BEAT` once every stop is done. */
  beat: number;
}

/** Each stop's state. Colour never carries it: the badge and rays do. */
export function stopStates(view: BuildingView): StopState[] {
  return BUILDING_STOPS.map((_, i) => {
    if (i < view.beat) return 'complete';
    const live = view.phase === 'presenting' || view.phase === 'slow';
    return i === view.beat && live ? 'active' : 'upcoming';
  });
}

/** How many stops are complete: the progress value. */
export function completedStops(view: BuildingView): number {
  return Math.min(view.beat, BUILDING_STOPS.length);
}

/** One caption, with the one part that may be bold. */
export interface BuildingCaption {
  before: string;
  bold: string;
  after: string;
}

export function captionText(caption: BuildingCaption): string {
  return `${caption.before}${caption.bold}${caption.after}`;
}

const plain = (text: string): BuildingCaption => ({ before: text, bold: '', after: '' });

/** The caption the view shows. The count appears only with usable results. */
export function buildingCaption(
  view: BuildingView,
  prefs: UserRecallPreferences,
  data: BuildingData,
): BuildingCaption {
  if (view.phase === 'slow') return plain(BUILDING_SLOW_CAPTION);
  if (view.phase === 'error') return plain(BUILDING_ERROR_CAPTION);
  if (view.beat >= COMPLETE_BEAT) return plain(BUILDING_DONE_CAPTION);
  switch (BUILDING_STOPS[view.beat]) {
    case 'allergens':
      return plain(buildingAllergensCaption(prefs.allergens.length > 0));
    case 'stores':
      return plain(buildingStoresCaption(prefs.retailers.length > 0));
    case 'matches': {
      // Unreachable without usable results (the gate holds on Area), but the
      // view never states a count it was not given.
      if (data.kind !== 'usable') return plain(BUILDING_AREA_CAPTION);
      const parts = buildingMatchesParts(data.total);
      return { before: parts.before, bold: parts.number, after: parts.after };
    }
    case 'feed':
      return plain(BUILDING_FEED_CAPTION);
    default:
      return plain(BUILDING_AREA_CAPTION);
  }
}

/**
 * Every caption this screen can show for these choices — the stable caption
 * box is sized to the tallest of them at the current width and text size, so
 * a change of words never moves the layout. Measurement only: a count not yet
 * known is measured at four digits and never displayed.
 */
export function buildingCaptionCandidates(
  prefs: UserRecallPreferences,
  data: BuildingData,
): BuildingCaption[] {
  const counted: BuildingData = data.kind === 'usable' ? data : { kind: 'usable', total: 9_999 };
  const views: BuildingView[] = [
    ...BUILDING_STOPS.map((_, beat) => ({ phase: 'presenting' as const, beat })),
    { phase: 'complete', beat: COMPLETE_BEAT },
    { phase: 'slow', beat: 0 },
    { phase: 'error', beat: 0 },
  ];
  return views.map((view) => buildingCaption(view, prefs, counted));
}

/** The start announcement: made when the screen is visible, never mid-slide. */
export function startAnnouncement(): string {
  return `${BUILDING_HEADLINE} ${BUILDING_AREA_CAPTION}`;
}

/** The completion announcement: made only once a usable result was shown. */
export function completionAnnouncement(total: number): string {
  const parts = buildingMatchesParts(total);
  return `${parts.before}${parts.number}${parts.after} ${BUILDING_DONE_CAPTION}`;
}

// ── The sequence ────────────────────────────────────────────────────────────

export interface BuildingClock {
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface BuildingSequenceOptions {
  reduceMotion: boolean;
  clock: BuildingClock;
  /** Every view change. */
  onChange: (view: BuildingView) => void;
  /** Usable results were presented to completion: replace with Ready. Once. */
  onComplete: () => void;
  /** The start, completion, slow and error announcements. */
  onAnnounce: (text: string) => void;
}

export interface BuildingSequence {
  view: () => BuildingView;
  /** The route is visible. Idempotent: the push and the fallback may both report. */
  visible: () => void;
  setData: (data: BuildingData) => void;
  /** The app left the foreground: presentation time stops. */
  pause: () => void;
  resume: () => void;
  /**
   * The beat's incoming caption has actually reached full opacity (its
   * crossfade finished on screen): the stop's reading hold, or the
   * completion's, starts now. Until it reports, the hold is scheduled from
   * the crossfade's nominal end, so a missing report never stalls the screen.
   */
  captionSettled: () => void;
  /** The shopper asked to try the feed again: the slow bound restarts. */
  retry: () => void;
  /** The screen is leaving (Continue, unmount): no further change or completion. */
  dispose: () => void;
}

export function createBuildingSequence(options: BuildingSequenceOptions): BuildingSequence {
  const { clock, reduceMotion } = options;
  const T = BUILDING_TIMING;
  let view: BuildingView = { phase: 'arriving', beat: 0 };
  let data: BuildingData = { kind: 'pending' };
  let paused = false;
  let disposed = false;
  // Foreground visible time: accumulated, plus the current stretch.
  let accumulated = 0;
  let runningSince: number | null = null;
  let beatDue = 0;
  let slowDue = 0;
  let completeDue = 0;
  let timer: unknown = null;
  /** The beat's caption is still crossfading in: its report sets the hold. */
  let awaitingCaption = false;

  const elapsed = () =>
    accumulated + (runningSince === null ? 0 : Math.max(0, clock.now() - runningSince));
  const set = (next: BuildingView) => {
    view = next;
    options.onChange(view);
  };
  const clear = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clear();
    if (disposed || paused || runningSince === null) return;
    const due: number[] = [];
    if (view.phase === 'presenting' || view.phase === 'slow') {
      if (data.kind === 'usable') due.push(beatDue);
      else if (view.phase === 'presenting' && data.kind === 'pending') due.push(slowDue);
    } else if (view.phase === 'complete') {
      due.push(completeDue);
    }
    if (due.length === 0) return;
    const wait = Math.max(0, Math.min(...due) - elapsed());
    timer = clock.setTimeout(() => {
      timer = null;
      tick();
    }, wait);
  };

  const advance = (at: number) => {
    const from = view.beat;
    const to = reduceMotion ? (from < MATCHES_BEAT ? MATCHES_BEAT : COMPLETE_BEAT) : from + 1;
    // The reading hold starts when the new caption is fully visible.
    const fade = reduceMotion ? 0 : T.captionFadeMs;
    awaitingCaption = !reduceMotion;
    if (to >= COMPLETE_BEAT) {
      completeDue = at + fade + (reduceMotion ? T.reducedCompletionHoldMs : T.completionHoldMs);
      set({ phase: 'complete', beat: COMPLETE_BEAT });
      if (data.kind === 'usable') options.onAnnounce(completionAnnouncement(data.total));
      return;
    }
    beatDue = at + fade + (reduceMotion && to === MATCHES_BEAT ? T.reducedCountHoldMs : T.stopMs);
    set({ phase: 'presenting', beat: to });
  };

  const tick = () => {
    if (disposed || paused) return;
    const at = elapsed();
    if (view.phase === 'complete') {
      if (at >= completeDue) {
        set({ phase: 'left', beat: COMPLETE_BEAT });
        options.onComplete();
        return;
      }
    } else if (view.phase === 'presenting' || view.phase === 'slow') {
      if (data.kind === 'usable') {
        if (view.phase === 'slow') set({ phase: 'presenting', beat: view.beat });
        // Results that arrive after a stop's minimum move on at once.
        if (at >= beatDue) advance(Math.max(at, beatDue));
      } else if (view.phase === 'presenting' && data.kind === 'pending' && at >= slowDue) {
        set({ phase: 'slow', beat: view.beat });
        options.onAnnounce(BUILDING_SLOW_CAPTION);
      }
    }
    schedule();
  };

  const fail = () => {
    set({ phase: 'error', beat: 0 });
    options.onAnnounce(BUILDING_ERROR_CAPTION);
    schedule();
  };

  return {
    view: () => view,
    visible() {
      if (disposed || view.phase !== 'arriving') return;
      runningSince = paused ? null : clock.now();
      beatDue = reduceMotion ? T.reducedAreaMs : T.stopMs;
      slowDue = T.slowAfterMs;
      set({ phase: 'presenting', beat: 0 });
      options.onAnnounce(startAnnouncement());
      if (data.kind === 'failed') fail();
      else tick();
    },
    setData(next) {
      if (disposed) return;
      data = next;
      if (view.phase === 'arriving' || view.phase === 'complete' || view.phase === 'left') return;
      if (next.kind === 'failed' && view.beat === 0 && view.phase !== 'error') fail();
      else tick();
    },
    pause() {
      if (disposed || paused) return;
      paused = true;
      if (runningSince !== null) accumulated += Math.max(0, clock.now() - runningSince);
      runningSince = null;
      clear();
    },
    resume() {
      if (disposed || !paused) return;
      paused = false;
      if (view.phase !== 'arriving') runningSince = clock.now();
      tick();
    },
    captionSettled() {
      if (disposed || paused || !awaitingCaption) return;
      awaitingCaption = false;
      const at = elapsed();
      if (view.phase === 'complete') completeDue = Math.max(completeDue, at + T.completionHoldMs);
      else if (view.phase === 'presenting') beatDue = Math.max(beatDue, at + T.stopMs);
      schedule();
    },
    retry() {
      if (disposed || (view.phase !== 'error' && view.phase !== 'slow')) return;
      slowDue = elapsed() + T.slowAfterMs;
      set({ phase: 'presenting', beat: 0 });
      schedule();
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
