/**
 * The calendar clock's pure core (2026-10-06). Eligibility on the device is a
 * function of the clock as well as the corpus: the 60-day window
 * (`tierForActivityDate`) and the 21-day FDA evidence expiry
 * (`lib/open-evidence.ts`) both cross their boundaries at UTC midnight, and
 * card dates ("Today", "Yesterday") roll over at local midnight. A screen that
 * only re-renders when a sync lands — and a foreground sync inside its reuse
 * threshold, or a failed one, lands nothing — would keep yesterday's answer
 * while the app stays open. `hooks/use-calendar-clock.ts` re-reads the clock
 * at each boundary and on every return to the foreground; this module decides
 * when.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Milliseconds until the next moment either calendar changes — the next UTC
 * midnight or the next local midnight, whichever comes first. Never less than
 * 1 ms, so a timer armed exactly on a boundary still fires after it.
 */
export function msUntilNextDayBoundary(now: Date): number {
  const nextUtc = Math.floor(now.getTime() / DAY_MS) * DAY_MS + DAY_MS;
  const nextLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return Math.max(1, Math.min(nextUtc, nextLocal) - now.getTime());
}

/** True when `next` falls on a different UTC or local calendar day than `previous`. */
export function crossedDayBoundary(previous: Date, next: Date): boolean {
  return utcDay(previous) !== utcDay(next) || localDay(previous) !== localDay(next);
}

/**
 * How long after a boundary the clock re-reads time. A timer can fire a hair
 * early; landing just past the boundary guarantees the new day is observed.
 * Every day boundary — and so the 21-day FDA evidence expiry and the 60-day
 * window, both of which fall exactly on a UTC midnight — is therefore
 * reflected at most this long after it passes (plus the platform's timer
 * latency) while the app stays open.
 */
export const TICK_SLACK_MS = 1_000;

export type ClockAppState = 'active' | 'background' | 'inactive' | (string & {});

/** Everything the clock touches, injected so the schedule is testable under node. */
export interface CalendarClockDeps {
  now: () => Date;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Subscribe to app-state changes; returns the unsubscribe. */
  onAppState: (listener: (status: ClockAppState) => void) => () => void;
}

/**
 * The clock's schedule: re-read time at every calendar boundary while the app
 * is in the foreground, and immediately on every return to the foreground.
 * `publish` is called only when the day actually changed. Nothing here
 * touches the network: a foreground return re-evaluates eligibility whether
 * or not any sync runs or succeeds. Returns the stop function.
 */
export function startCalendarClock(
  deps: CalendarClockDeps,
  initial: Date,
  publish: (now: Date) => void,
): () => void {
  let current = initial;
  let timer: unknown = null;
  const refresh = () => {
    const next = deps.now();
    if (crossedDayBoundary(current, next)) {
      current = next;
      publish(next);
    }
  };
  const disarm = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
  const arm = () => {
    disarm();
    timer = deps.setTimer(
      () => {
        timer = null;
        refresh();
        arm();
      },
      msUntilNextDayBoundary(deps.now()) + TICK_SLACK_MS,
    );
  };
  const unsubscribe = deps.onAppState((status) => {
    if (status === 'active') {
      refresh();
      arm();
    } else {
      // Timers do not run reliably in the background; resume re-arms.
      disarm();
    }
  });
  arm();
  return () => {
    unsubscribe();
    disarm();
  };
}
