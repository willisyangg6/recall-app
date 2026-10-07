import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  crossedDayBoundary,
  msUntilNextDayBoundary,
  startCalendarClock,
  TICK_SLACK_MS,
  type ClockAppState,
} from './calendar-clock';
import { tierForActivityDate } from './feed-relevance';
import { confirmedOpen } from './open-evidence';

test('the next boundary is never later than the next UTC midnight, and never zero', () => {
  for (const iso of [
    '2026-10-06T00:00:00.000Z',
    '2026-10-06T13:45:10.000Z',
    '2026-10-06T23:59:59.999Z',
  ]) {
    const now = new Date(iso);
    const nextUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const wait = msUntilNextDayBoundary(now);
    assert.ok(wait >= 1, iso);
    assert.ok(now.getTime() + wait <= nextUtc, `${iso}: waits past the UTC boundary`);
  }
});

test('a timer armed for the boundary lands on a new UTC or local day', () => {
  const now = new Date('2026-10-06T13:45:10.000Z');
  const after = new Date(now.getTime() + msUntilNextDayBoundary(now) + 1_000);
  assert.equal(crossedDayBoundary(now, after), true);
});

test('within one calendar day nothing is crossed; across UTC midnight it is', () => {
  const morning = new Date('2026-10-06T00:00:01.000Z');
  assert.equal(crossedDayBoundary(morning, new Date(morning.getTime() + 1_000)), false);
  assert.equal(
    crossedDayBoundary(new Date('2026-10-06T23:59:59.000Z'), new Date('2026-10-07T00:00:01.000Z')),
    true,
  );
});

// ── The schedule, on a virtual clock ────────────────────────────────────────

/** A deterministic scheduler: virtual time, real ordering, no network anywhere. */
function virtualHost(startIso: string) {
  let time = Date.parse(startIso);
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let listener: ((status: ClockAppState) => void) | null = null;
  const published: Date[] = [];
  const deps = {
    now: () => new Date(time),
    setTimer: (fn: () => void, ms: number) => {
      seq += 1;
      timers.set(seq, { at: time + ms, fn });
      return seq;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    onAppState: (l: (status: ClockAppState) => void) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  return {
    deps,
    published,
    publish: (now: Date) => published.push(now),
    /** Advance virtual time, firing every due timer in order. */
    advanceTo(iso: string) {
      const target = Date.parse(iso);
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].fn();
      }
      time = target;
    },
    appState: (status: ClockAppState) => listener?.(status),
    pendingTimers: () => timers.size,
  };
}

const FDA = (asOf: string) =>
  ({ sourceAgency: 'FDA', noticeType: 'recall', state: 'active', fdaOngoingAsOf: asOf }) as const;

test('while the app stays open, the clock lands just past the real 21-day expiry boundary', () => {
  // Evidence dated 2026-09-28 counts through 2026-10-19T00:00:00.000Z exactly.
  const boundary = Date.parse('2026-10-19T00:00:00.000Z');
  const host = virtualHost('2026-10-18T15:00:00.000Z');
  const shown = { now: host.deps.now() };
  startCalendarClock(host.deps, shown.now, (now) => {
    shown.now = now;
    host.publish(now);
  });
  assert.equal(confirmedOpen(FDA('2026-09-28'), shown.now), true);
  host.advanceTo('2026-10-19T00:00:30.000Z');
  // The first clock value at or after the boundary is within TICK_SLACK_MS of it
  // (a local-midnight tick may land earlier in some time zones; it is before
  // the boundary and still counts the evidence).
  const after = host.published.filter((d) => d.getTime() >= boundary);
  assert.ok(after.length >= 1, 'no tick after the boundary');
  assert.ok(
    after[0].getTime() - boundary <= TICK_SLACK_MS,
    `late by ${after[0].getTime() - boundary} ms`,
  );
  assert.equal(confirmedOpen(FDA('2026-09-28'), after[0]), false);
  for (const before of host.published.filter((d) => d.getTime() < boundary)) {
    assert.equal(confirmedOpen(FDA('2026-09-28'), before), true);
  }
  // It keeps re-arming: one timer is always pending while in the foreground.
  assert.equal(host.pendingTimers(), 1);
});

test('the 60-day window edge is reached by the same schedule', () => {
  const host = virtualHost('2026-10-05T23:00:00.000Z');
  const shown = { now: host.deps.now() };
  startCalendarClock(host.deps, shown.now, (now) => (shown.now = now));
  // Activity on 2026-08-07 is recent through 2026-10-06T00:00:00.000Z.
  assert.equal(tierForActivityDate('2026-08-07', shown.now), 'recent');
  host.advanceTo('2026-10-06T00:00:05.000Z');
  assert.equal(tierForActivityDate('2026-08-07', shown.now), 'older_active');
});

test('a foreground return re-reads the clock at once, with no network and no sync', () => {
  const host = virtualHost('2026-10-18T22:00:00.000Z');
  const shown = { now: host.deps.now() };
  startCalendarClock(host.deps, shown.now, (now) => (shown.now = now));
  host.appState('background');
  assert.equal(host.pendingTimers(), 0, 'a backgrounded app keeps no timer');
  host.advanceTo('2026-10-21T09:00:00.000Z'); // two days asleep, no timers fire
  assert.equal(confirmedOpen(FDA('2026-09-28'), shown.now), true, 'stale while asleep');
  host.appState('active');
  // The deps above have no network at all: the refresh is the clock alone.
  assert.equal(shown.now.toISOString(), '2026-10-21T09:00:00.000Z');
  assert.equal(confirmedOpen(FDA('2026-09-28'), shown.now), false);
  assert.equal(host.pendingTimers(), 1, 'resume re-arms the next boundary');
});

test('a foreground return within the same day publishes nothing (no needless re-render)', () => {
  const host = virtualHost('2026-10-18T12:00:00.000Z');
  startCalendarClock(host.deps, host.deps.now(), host.publish);
  host.appState('background');
  host.advanceTo('2026-10-18T12:30:00.000Z');
  host.appState('active');
  assert.deepEqual(host.published, []);
});

test('stopping the clock removes its timer and its app-state listener', () => {
  const host = virtualHost('2026-10-18T12:00:00.000Z');
  const stop = startCalendarClock(host.deps, host.deps.now(), host.publish);
  stop();
  assert.equal(host.pendingTimers(), 0);
  host.appState('active');
  assert.deepEqual(host.published, []);
});
