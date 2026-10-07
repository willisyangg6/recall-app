/**
 * One clock for every eligibility decision on screen (2026-10-06): the Feed
 * tab's sections, the Building count and the Ready preview read the `Date`
 * this hook returns, so the 60-day window, the 21-day FDA evidence expiry and
 * the card dates all recompute together — at each calendar boundary while the
 * app stays open (within `TICK_SLACK_MS` of it), and on every return to the
 * foreground — without waiting for a sync to land. The schedule itself is
 * `startCalendarClock` (lib/calendar-clock.ts), tested under node; this hook
 * only binds it to React state, real timers and AppState. Never shown to a
 * shopper; it only decides membership.
 */

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { startCalendarClock } from '@/lib/calendar-clock';

export function useCalendarClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(
    () =>
      startCalendarClock(
        {
          now: () => new Date(),
          setTimer: (callback, ms) => setTimeout(callback, ms),
          clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
          onAppState: (listener) => {
            const subscription = AppState.addEventListener('change', listener);
            return () => subscription.remove();
          },
        },
        new Date(),
        setNow,
      ),
    [],
  );

  return now;
}
