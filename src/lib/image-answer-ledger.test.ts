/**
 * The request/answer ledger behind components/ui/guarded-image.tsx
 * (2026-10-06): every event order React Native 0.86 (iOS) can produce for
 * one drawing, with and without an answer meant for another image.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EMPTY_LEDGER,
  imageSourceKey,
  isOwnAnswer,
  recordAnswer,
  recordStart,
  type AnswerLedger,
} from './image-answer-ledger';

type Event =
  { kind: 'start' } | { kind: 'answer'; from: 'own' | 'stale'; outcome: 'load' | 'error' };

/**
 * Plays events into one drawing the way GuardedImage does: an own answer is
 * passed on and drawn (a load shows its picture, an error clears the view),
 * an answer beyond the count stops the drawing for a redraw.
 */
function play(events: readonly Event[]) {
  let ledger: AnswerLedger = EMPTY_LEDGER;
  let shown: 'nothing' | 'own' | 'stale' = 'nothing';
  const passedOn: string[] = [];
  for (const event of events) {
    if (event.kind === 'start') {
      ledger = recordStart(ledger);
      continue;
    }
    if (!isOwnAnswer(ledger)) return { redrawn: true, shown, passedOn };
    ledger = recordAnswer(ledger);
    passedOn.push(`${event.from}:${event.outcome}`);
    // The view draws whatever arrived: a picture, or nothing on an error.
    shown = event.outcome === 'load' ? event.from : 'nothing';
  }
  return { redrawn: false, shown, passedOn };
}

const START: Event = { kind: 'start' };
const OWN: Event = { kind: 'answer', from: 'own', outcome: 'load' };
const OWN_ERROR: Event = { kind: 'answer', from: 'own', outcome: 'error' };
const STALE: Event = { kind: 'answer', from: 'stale', outcome: 'load' };
const STALE_ERROR: Event = { kind: 'answer', from: 'stale', outcome: 'error' };

test('a request answered after its start is the drawing’s own', () => {
  assert.deepEqual(play([START, OWN]), { redrawn: false, shown: 'own', passedOn: ['own:load'] });
});

test('a request already complete answers before its start (one main-thread call), and is still its own', () => {
  assert.deepEqual(play([OWN, START]), { redrawn: false, shown: 'own', passedOn: ['own:load'] });
});

test('after an answer that came before its start, a later stale answer is caught — the case the first guard missed', () => {
  // The first guard counted the late start as a fresh announcement and
  // accepted the next unannounced answer against it.
  assert.equal(play([OWN, START, STALE]).redrawn, true);
  assert.equal(play([OWN, START, STALE_ERROR]).redrawn, true);
  assert.deepEqual(
    play([OWN, START, STALE]).passedOn,
    ['own:load'],
    'the stale answer was passed on',
  );
});

test('every allowed position of one stale load or error ends on the own picture or a redraw', () => {
  // The own pair is [start, answer] or [answer, start] (adjacent: one
  // main-thread call); the stale answer can arrive at any other point.
  for (const own of [OWN, OWN_ERROR]) {
    const pairs: Event[][] = [
      [START, own],
      [own, START],
    ];
    for (const pair of pairs) {
      for (const stale of [STALE, STALE_ERROR]) {
        const early = pair[0] !== START;
        const positions = early ? [0, 2] : [0, 1, 2];
        for (const at of positions) {
          const events: Event[] = [...pair];
          events.splice(at, 0, stale);
          const result = play(events);
          const ownShown = own.outcome === 'load' ? 'own' : 'nothing';
          assert.ok(
            result.redrawn ||
              (result.shown === ownShown && !result.passedOn.includes('stale:error')),
            `${JSON.stringify(events)} ended on ${result.shown} without a redraw`,
          );
        }
      }
    }
  }
});

test('a stale error after a good picture is never passed on, so a photo is never marked failed for it', () => {
  const result = play([START, OWN, STALE_ERROR]);
  assert.equal(result.redrawn, true);
  assert.deepEqual(result.passedOn, ['own:load']);
});

test('a legitimate reload (a new layout size asks again) is accepted when it answers after its start', () => {
  assert.deepEqual(play([START, OWN, START, OWN]).passedOn, ['own:load', 'own:load']);
  // An in-flight answer for the previous size of the SAME source is the
  // same picture, and is accepted.
  assert.equal(play([START, START, OWN, OWN]).redrawn, false);
});

test('a reload that answers before its own start costs one redundant redraw, never a wrong picture', () => {
  // Indistinguishable by count from an answer meant for another image, so it
  // is redrawn: the new drawing asks once at the current size and shows its
  // own answer. Bounded by the redraw limit.
  const result = play([OWN, START, OWN, START]);
  assert.equal(result.redrawn, true);
  assert.equal(result.shown, 'own');
  assert.deepEqual(result.passedOn, ['own:load']);
});

test('nothing meant for another image can be a drawing’s first event', () => {
  // A recycled view drops answers while pooled (no state, no event emitter)
  // and mounts props, event emitter and state in one main-thread call, so
  // any answer before the first start is the drawing's own (early) answer.
  assert.equal(isOwnAnswer(EMPTY_LEDGER), true);
  assert.equal(isOwnAnswer(recordAnswer(EMPTY_LEDGER)), false);
  assert.equal(isOwnAnswer(recordStart(recordAnswer(EMPTY_LEDGER))), false);
});

test('a genuine failure is the drawing’s own and is passed on once', () => {
  assert.deepEqual(play([START, OWN_ERROR]), {
    redrawn: false,
    shown: 'nothing',
    passedOn: ['own:error'],
  });
  assert.deepEqual(play([OWN_ERROR, START]).passedOn, ['own:error']);
});

test('the source key separates bundled assets, URIs and request options, and is stable', () => {
  assert.equal(imageSourceKey(12), 'asset:12');
  assert.notEqual(imageSourceKey(12), imageSourceKey(13));
  assert.notEqual(
    imageSourceKey({ uri: 'https://a/1.jpg' }),
    imageSourceKey({ uri: 'https://a/2.jpg' }),
  );
  assert.equal(
    imageSourceKey({ uri: 'https://a/1.jpg' }),
    imageSourceKey({ uri: 'https://a/1.jpg' }),
  );
  // Scale variants and headers are part of the request, so part of the key.
  assert.notEqual(
    imageSourceKey([{ uri: 'a@2x.png', scale: 2 }]),
    imageSourceKey([{ uri: 'a@3x.png', scale: 3 }]),
  );
  assert.equal(imageSourceKey(undefined), 'null');
});
