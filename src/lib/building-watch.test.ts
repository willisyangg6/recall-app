/**
 * The Building step's behaviour (the five-stop watch, 2026-10-02): the data
 * gate, the shared count, and the sequence's timing, interruptions and single
 * exit — every case on a fake clock, under Node.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { UserRecallPreferences } from '@/domain/preferences';
import {
  BUILDING_STOPS,
  BUILDING_TIMING,
  buildingCaption,
  buildingData,
  captionText,
  completedStops,
  COMPLETE_BEAT,
  completionAnnouncement,
  createBuildingSequence,
  presentedDurationMs,
  startAnnouncement,
  stopStates,
  type BuildingData,
  type BuildingView,
} from './building-watch';
import { buildReadyPreview, previewMatchCount } from './ready-preview';
import type { FeedItem } from './recall-feed';

const T = BUILDING_TIMING;
const PREFS: UserRecallPreferences = {
  states: ['CA'],
  allergens: ['peanut'],
  retailers: ['costco'],
};
const NONE: UserRecallPreferences = { states: ['CA'], allergens: [], retailers: [] };

/** A fake clock: time moves only when the test says so. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    clock: {
      now: () => now,
      setTimeout: (run: () => void, ms: number) => {
        const id = next++;
        timers.set(id, { at: now + ms, run });
        return id;
      },
      clearTimeout: (handle: unknown) => {
        timers.delete(handle as number);
      },
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

function harness(reduceMotion = false) {
  const time = fakeClock();
  const views: BuildingView[] = [];
  const spoken: string[] = [];
  let completions = 0;
  const sequence = createBuildingSequence({
    reduceMotion,
    clock: time.clock,
    onChange: (view) => views.push(view),
    onComplete: () => {
      completions += 1;
    },
    onAnnounce: (text) => spoken.push(text),
  });
  return {
    sequence,
    time,
    views,
    spoken,
    completions: () => completions,
    view: () => sequence.view(),
  };
}

const usable = (total: number): BuildingData => ({ kind: 'usable', total });

// ── The data gate and the shared count ──────────────────────────────────────

test('the gate: loading is pending, a failure with nothing loaded is failed, a retry in flight is pending', () => {
  assert.deepEqual(buildingData({ status: 'loading' }, false, PREFS), { kind: 'pending' });
  assert.deepEqual(buildingData({ status: 'error' }, false, PREFS), { kind: 'failed' });
  assert.deepEqual(buildingData({ status: 'error' }, true, PREFS), { kind: 'pending' });
  assert.deepEqual(buildingData({ status: 'ready', items: [] }, false, PREFS), usable(0));
});

test('the count is the SAME Affects You total Ready shows, from the same corpus', () => {
  // An empty corpus is the one fixture-free corpus: both answer zero matches
  // the same way. The non-empty identity is structural: both call
  // affectsYouMatches (pinned in onboarding-design.test.ts).
  const items: FeedItem[] = [];
  const ready = buildReadyPreview({ status: 'ready', items }, PREFS, '2026-10-02');
  const data = buildingData({ status: 'ready', items }, false, PREFS);
  assert.equal(data.kind, 'usable');
  assert.equal(ready.kind, 'none');
  assert.equal(previewMatchCount(ready), null);
  assert.equal(data.kind === 'usable' ? data.total : -1, 0);
});

// ── Copy ────────────────────────────────────────────────────────────────────

test('the five captions, the no-selection variants, and the count only with usable results', () => {
  const at = (beat: number, prefs = PREFS, data: BuildingData = usable(22)) =>
    captionText(buildingCaption({ phase: 'presenting', beat }, prefs, data));
  assert.equal(at(0), 'Searching recalls in your area…');
  assert.equal(at(1), 'Checking for allergen matches…');
  assert.equal(at(2), 'Checking recalls where you shop…');
  assert.equal(at(3), 'Found 22 recalls for you.');
  assert.equal(at(4), 'Putting your personalized feed together…');
  assert.equal(at(1, NONE), 'Checking recalls across allergens…');
  assert.equal(at(2, NONE), 'Checking recalls across stores…');
  assert.equal(at(3, PREFS, usable(1)), 'Found 1 recall for you.');
  assert.equal(at(3, PREFS, usable(0)), 'No matching recalls found.');
  // Never a count without usable results.
  assert.equal(at(3, PREFS, { kind: 'pending' }), 'Searching recalls in your area…');
  const count = buildingCaption({ phase: 'presenting', beat: 3 }, PREFS, usable(22));
  assert.deepEqual(count, { before: 'Found ', bold: '22', after: ' recalls for you.' });
  assert.equal(
    captionText(buildingCaption({ phase: 'complete', beat: COMPLETE_BEAT }, PREFS, usable(22))),
    'Your personalized feed is ready.',
  );
  assert.equal(
    captionText(buildingCaption({ phase: 'slow', beat: 0 }, PREFS, { kind: 'pending' })),
    'Recalls are taking longer than usual to load.',
  );
  assert.equal(
    captionText(buildingCaption({ phase: 'error', beat: 0 }, PREFS, { kind: 'failed' })),
    'Lotly couldn’t reach the recall service.',
  );
});

test('no caption says watch, names a selection or claims safety; the headline alone says watch', () => {
  const captions = [0, 1, 2, 3, 4, COMPLETE_BEAT].flatMap((beat) =>
    [PREFS, NONE].map((prefs) =>
      captionText(
        buildingCaption(
          { phase: beat === COMPLETE_BEAT ? 'complete' : 'presenting', beat },
          prefs,
          usable(3),
        ),
      ),
    ),
  );
  for (const caption of captions) {
    assert.ok(!/watch/i.test(caption), caption);
    assert.ok(!/peanut|costco|california/i.test(caption), caption);
    assert.ok(!/safe|today|purchased|unsafe/i.test(caption), caption);
  }
  assert.match(startAnnouncement(), /^Getting your watch ready\./);
  assert.equal(
    completionAnnouncement(1),
    'Found 1 recall for you. Your personalized feed is ready.',
  );
});

test('stop states: colour never carries state; pending and error stops are never complete', () => {
  assert.deepEqual(stopStates({ phase: 'arriving', beat: 0 }), Array(5).fill('upcoming'));
  assert.deepEqual(stopStates({ phase: 'presenting', beat: 1 }), [
    'complete',
    'active',
    'upcoming',
    'upcoming',
    'upcoming',
  ]);
  assert.deepEqual(stopStates({ phase: 'error', beat: 0 }), Array(5).fill('upcoming'));
  assert.deepEqual(stopStates({ phase: 'slow', beat: 0 })[0], 'active');
  assert.deepEqual(
    stopStates({ phase: 'complete', beat: COMPLETE_BEAT }),
    Array(5).fill('complete'),
  );
  assert.equal(completedStops({ phase: 'complete', beat: COMPLETE_BEAT }), BUILDING_STOPS.length);
});

// ── The sequence ────────────────────────────────────────────────────────────

test('nothing is presented before the route is visible, however long the push takes', () => {
  const h = harness();
  h.sequence.setData(usable(4));
  h.time.advance(5_000);
  assert.deepEqual(h.view(), { phase: 'arriving', beat: 0 });
  assert.equal(h.spoken.length, 0, 'announced mid-slide');
  assert.equal(h.completions(), 0);
});

test('with usable results: one stop per beat from visibility, the hold, then Ready exactly once', () => {
  const h = harness();
  h.sequence.setData(usable(22));
  h.sequence.visible();
  h.sequence.visible(); // the fallback after transitionEnd: ignored
  assert.deepEqual(h.view(), { phase: 'presenting', beat: 0 });
  assert.deepEqual(h.spoken, [startAnnouncement()]);
  for (let beat = 1; beat < COMPLETE_BEAT; beat++) {
    // Area's caption is up on arrival; every later one first crossfades in.
    const hold = beat === 1 ? T.stopMs : T.captionFadeMs + T.stopMs;
    h.time.advance(hold - 1);
    assert.equal(h.view().beat, beat - 1, `beat ${beat} came early`);
    h.time.advance(1);
    assert.deepEqual(h.view(), { phase: 'presenting', beat });
  }
  h.time.advance(T.captionFadeMs + T.stopMs);
  assert.deepEqual(h.view(), { phase: 'complete', beat: COMPLETE_BEAT });
  assert.equal(h.spoken.at(-1), completionAnnouncement(22));
  h.time.advance(T.captionFadeMs + T.completionHoldMs - 1);
  assert.equal(h.completions(), 0);
  h.time.advance(1);
  assert.equal(h.completions(), 1);
  assert.equal(h.view().phase, 'left');
  h.time.advance(60_000);
  h.sequence.setData(usable(22));
  assert.equal(h.completions(), 1, 'Ready was asked for twice');
  assert.equal(
    presentedDurationMs(),
    T.stopMs + 4 * (T.captionFadeMs + T.stopMs) + T.captionFadeMs + T.completionHoldMs,
  );
});

test('slow results hold Area active, never complete it, and move on the moment they arrive', () => {
  const h = harness();
  h.sequence.visible();
  h.time.advance(4_000);
  assert.deepEqual(h.view(), { phase: 'presenting', beat: 0 });
  assert.equal(stopStates(h.view())[0], 'active');
  h.sequence.setData(usable(3));
  assert.deepEqual(h.view(), { phase: 'presenting', beat: 1 }, 'a met minimum waited again');
  assert.equal(stopStates(h.view())[0], 'complete');
});

test('after 10 s of foreground time without results: the slow escape, no count, no completion', () => {
  const h = harness();
  h.sequence.visible();
  h.time.advance(T.slowAfterMs - 1);
  assert.equal(h.view().phase, 'presenting');
  h.time.advance(1);
  assert.deepEqual(h.view(), { phase: 'slow', beat: 0 });
  assert.equal(h.spoken.at(-1), 'Recalls are taking longer than usual to load.');
  h.time.advance(60_000);
  assert.equal(h.completions(), 0);
  // Results that arrive late still present truthfully, from Area on.
  h.sequence.setData(usable(5));
  assert.deepEqual(h.view(), { phase: 'presenting', beat: 1 });
});

test('background time never counts: the slow bound and every beat measure foreground time only', () => {
  const h = harness();
  h.sequence.visible();
  h.time.advance(6_000);
  h.sequence.pause();
  h.time.advance(60_000);
  assert.equal(h.view().phase, 'presenting', 'background time reached the slow bound');
  h.sequence.resume();
  h.time.advance(T.slowAfterMs - 6_000 - 1);
  assert.equal(h.view().phase, 'presenting');
  h.time.advance(1);
  assert.equal(h.view().phase, 'slow');

  const g = harness();
  g.sequence.setData(usable(2));
  g.sequence.visible();
  g.time.advance(T.stopMs - 100);
  g.sequence.pause();
  g.time.advance(30_000);
  assert.equal(g.view().beat, 0, 'a beat advanced in the background');
  g.sequence.resume();
  g.time.advance(99);
  assert.equal(g.view().beat, 0);
  g.time.advance(1);
  assert.equal(g.view().beat, 1);
});

test('a screen that appears while the app is in the background waits for the foreground', () => {
  const h = harness();
  h.sequence.setData(usable(2));
  h.sequence.pause();
  h.sequence.visible();
  h.time.advance(30_000);
  assert.deepEqual(h.view(), { phase: 'presenting', beat: 0 });
  h.sequence.resume();
  h.time.advance(T.stopMs);
  assert.equal(h.view().beat, 1);
});

test('a failure with nothing cached says so at once; Try again restarts the slow bound; Ready is never claimed', () => {
  const h = harness();
  h.sequence.setData({ kind: 'failed' });
  h.sequence.visible();
  assert.deepEqual(h.view(), { phase: 'error', beat: 0 });
  assert.deepEqual(stopStates(h.view()), Array(5).fill('upcoming'));
  assert.equal(h.spoken.at(-1), 'Lotly couldn’t reach the recall service.');
  h.time.advance(60_000);
  assert.equal(h.completions(), 0);
  h.sequence.retry();
  h.sequence.setData({ kind: 'pending' });
  assert.deepEqual(h.view(), { phase: 'presenting', beat: 0 });
  h.time.advance(T.slowAfterMs - 1);
  assert.equal(h.view().phase, 'presenting');
  h.sequence.setData({ kind: 'failed' });
  assert.equal(h.view().phase, 'error');
  h.sequence.retry();
  h.sequence.setData({ kind: 'pending' });
  h.sequence.setData(usable(1));
  assert.deepEqual(h.view(), { phase: 'presenting', beat: 1 });
});

test('Reduce Motion: no staged build-up, the count held readably, and still never before real results', () => {
  const h = harness(true);
  h.sequence.visible();
  h.time.advance(5_000);
  assert.deepEqual(h.view(), { phase: 'presenting', beat: 0 }, 'drew stops complete while pending');
  h.sequence.setData(usable(9));
  assert.deepEqual(h.view(), { phase: 'presenting', beat: 3 });
  assert.deepEqual(stopStates(h.view()).slice(0, 3), ['complete', 'complete', 'complete']);
  h.time.advance(T.reducedCountHoldMs);
  assert.deepEqual(h.view(), { phase: 'complete', beat: COMPLETE_BEAT });
  h.time.advance(T.reducedCompletionHoldMs);
  assert.equal(h.completions(), 1);
});

test('dispose (Continue, departure, unmount) cancels every timer: no later change, completion or announcement', () => {
  const h = harness();
  h.sequence.setData(usable(4));
  h.sequence.visible();
  h.time.advance(T.stopMs);
  const changes = h.views.length;
  const spoken = h.spoken.length;
  h.sequence.dispose();
  assert.equal(h.time.pending(), 0);
  h.sequence.setData(usable(5));
  h.sequence.resume();
  h.sequence.visible();
  h.time.advance(60_000);
  assert.equal(h.views.length, changes);
  assert.equal(h.spoken.length, spoken);
  assert.equal(h.completions(), 0);
});

test('a usable cache presents at once; a later sync updates the count the screen shows', () => {
  const h = harness();
  h.sequence.setData(usable(20));
  h.sequence.visible();
  h.time.advance(T.stopMs + 2 * (T.captionFadeMs + T.stopMs));
  assert.equal(h.view().beat, 3);
  // The sync lands during the count: the screen reads the newest total.
  h.sequence.setData(usable(21));
  assert.equal(h.view().beat, 3, 'a new total restarted the beat');
  assert.equal(
    captionText(buildingCaption(h.view(), PREFS, usable(21))),
    'Found 21 recalls for you.',
  );
});

// ── The founder's pacing (2026-10-02; 1,100ms holds 2026-10-04) ────────────

test('every caption is read for 1,100ms once fully visible, the completion 800ms: 7.4 s in all', () => {
  assert.equal(T.stopMs, 1_100);
  assert.equal(T.captionFadeOutMs, 80);
  assert.equal(T.captionFadeInMs, 140);
  assert.equal(T.captionFadeMs, T.captionFadeOutMs + T.captionFadeInMs);
  assert.equal(T.completionHoldMs, 800);
  // Area 1,100; four stops of fade-through (220) + 1,100; the completion's 220 + 800.
  assert.equal(presentedDurationMs(), 1_100 + 4 * 1_320 + 220 + 800);
  const h = harness();
  h.sequence.setData(usable(7));
  h.sequence.visible();
  const changes: number[] = [];
  let at = 0;
  let last = h.view().beat;
  while (h.completions() === 0 && at < 20_000) {
    h.time.advance(10);
    at += 10;
    if (h.view().beat !== last) {
      changes.push(at);
      last = h.view().beat;
    }
  }
  // Beat changes: Area's 1,100, then fade + hold (1,320) apart; the screen
  // leaves fade + 800 after the completion caption arrived.
  assert.deepEqual(changes, [1_100, 2_420, 3_740, 5_060, 6_380]);
  assert.equal(at, 6_380 + 220 + 800);
  assert.equal(h.completions(), 1);
});

test('the longer presentation alone never raises the slow warning: it waits only on pending data', () => {
  const h = harness();
  h.sequence.setData(usable(3));
  h.sequence.visible();
  const seen = new Set<string>();
  for (let t = 0; t < presentedDurationMs(); t += 100) {
    h.time.advance(100);
    seen.add(h.view().phase);
  }
  assert.ok(!seen.has('slow'), 'a 7.4 s presentation looked like a slow load');
  assert.equal(h.completions(), 1);
  // Results that arrive after 9.9 s of waiting: no warning, and Area still
  // holds its full reading time from visibility (long met) before moving on.
  const g = harness();
  g.sequence.visible();
  g.time.advance(T.slowAfterMs - 100);
  g.sequence.setData(usable(3));
  assert.deepEqual(g.view(), { phase: 'presenting', beat: 1 });
  g.time.advance(T.slowAfterMs);
  assert.notEqual(g.view().phase, 'slow');
});

test('a stop takes longer when its data is not ready; Reduce Motion keeps its own short holds', () => {
  const h = harness();
  h.sequence.visible();
  h.time.advance(4_000);
  assert.deepEqual(h.view(), { phase: 'presenting', beat: 0 }, 'Area completed without results');
  const r = harness(true);
  r.sequence.setData(usable(5));
  r.sequence.visible();
  assert.deepEqual(r.view(), { phase: 'presenting', beat: 0 });
  r.time.advance(T.reducedAreaMs);
  assert.deepEqual(r.view(), { phase: 'presenting', beat: 3 });
  r.time.advance(T.reducedCountHoldMs + T.reducedCompletionHoldMs);
  assert.equal(r.completions(), 1, 'Reduce Motion was made to sit through 7.4 s');
  assert.equal(T.reducedAreaMs + T.reducedCountHoldMs + T.reducedCompletionHoldMs, 3_060);
});

test('a stop is read for 1,100ms from the moment its caption is fully visible on screen', () => {
  const h = harness();
  h.sequence.setData(usable(4));
  h.sequence.visible();
  h.time.advance(T.stopMs);
  assert.equal(h.view().beat, 1);
  // The native crossfade finished 30ms late: the hold starts at the report.
  h.time.advance(T.captionFadeMs + 30);
  h.sequence.captionSettled();
  h.time.advance(T.stopMs - 1);
  assert.equal(h.view().beat, 1, 'the hold was cut short by the late fade');
  h.time.advance(1);
  assert.equal(h.view().beat, 2);
  // No report at all: the nominal schedule still moves on (never stalls).
  h.time.advance(T.captionFadeMs + T.stopMs);
  assert.equal(h.view().beat, 3);
  // A report with no caption awaiting (or a repeat) changes nothing.
  const before = h.view().beat;
  h.sequence.captionSettled();
  h.sequence.captionSettled();
  h.time.advance(T.captionFadeMs + T.stopMs);
  assert.equal(h.view().beat, before + 1);
});

test('the completion holds 800ms from its caption settling; Reduce Motion and disposal ignore reports', () => {
  const h = harness();
  h.sequence.setData(usable(4));
  h.sequence.visible();
  h.time.advance(T.stopMs + 4 * (T.captionFadeMs + T.stopMs) - 1);
  h.time.advance(1);
  assert.equal(h.view().phase, 'complete');
  h.time.advance(T.captionFadeMs + 40);
  h.sequence.captionSettled();
  h.time.advance(T.completionHoldMs - 1);
  assert.equal(h.completions(), 0, 'Ready came before 800ms of the settled completion');
  h.time.advance(1);
  assert.equal(h.completions(), 1);

  const r = harness(true);
  r.sequence.setData(usable(4));
  r.sequence.visible();
  r.time.advance(T.reducedAreaMs);
  r.sequence.captionSettled();
  r.time.advance(T.reducedCountHoldMs);
  assert.equal(r.view().phase, 'complete', 'a report lengthened Reduce Motion');

  const d = harness();
  d.sequence.setData(usable(4));
  d.sequence.visible();
  d.time.advance(T.stopMs);
  d.sequence.dispose();
  d.sequence.captionSettled();
  assert.equal(d.time.pending(), 0);
});
