/**
 * The Ready screen's photo session (2026-10-05): when the deck may be shown,
 * what a late answer may change (nothing), what a failed shown photo changes
 * (its own card), and what a cancelled session may do afterwards (nothing).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resetPhotoMemory } from './photo-probe';
import { PHOTO_DECK_DEADLINE_MS, startPhotoSession } from './ready-photo-session';

function clock() {
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let now = 0;
  let seq = 0;
  return {
    setTimeout: (fn: () => void, ms: number) => {
      const id = (seq += 1);
      timers.push({ fn, at: now + ms, id });
      return id;
    },
    clearTimeout: (handle: unknown) => {
      const index = timers.findIndex((t) => t.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    advance(ms: number) {
      now += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at <= now) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
      }
    },
  };
}

function controlledPrefetch() {
  const pending = new Map<string, (ok: boolean) => void>();
  return {
    prefetch: (url: string) =>
      new Promise<boolean>((resolve) => {
        pending.set(url, resolve);
      }),
    answer: (url: string, ok: boolean) => pending.get(url)!(ok),
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('with no candidates the session is settled at once and nothing is loaded', () => {
  resetPhotoMemory();
  let changes = 0;
  const session = startPhotoSession([], { prefetch: async () => true, ...clock() }, () => {
    changes += 1;
  });
  assert.equal(session.settled(), true);
  assert.equal(session.isLoaded('any'), false);
  assert.equal(changes, 0);
});

test('the deck may be shown once every candidate answered; loaded photos are loaded, failed are not', async () => {
  resetPhotoMemory();
  const net = controlledPrefetch();
  let changes = 0;
  const session = startPhotoSession(['a', 'b'], { prefetch: net.prefetch, ...clock() }, () => {
    changes += 1;
  });
  assert.equal(session.settled(), false);
  net.answer('a', true);
  await tick();
  assert.equal(session.settled(), false, 'one answer is not every answer');
  net.answer('b', false);
  await tick();
  assert.equal(session.settled(), true);
  assert.equal(session.isLoaded('a'), true);
  assert.equal(session.isLoaded('b'), false);
  assert.ok(changes >= 1);
  resetPhotoMemory();
});

test('the photo deadline shows the deck with unanswered photos as absent, and a late success never promotes', async () => {
  resetPhotoMemory();
  const net = controlledPrefetch();
  const timers = clock();
  let changes = 0;
  const session = startPhotoSession(
    ['slow', 'quick'],
    { prefetch: net.prefetch, timeoutMs: 10_000, ...timers },
    () => {
      changes += 1;
    },
  );
  net.answer('quick', true);
  await tick();
  timers.advance(PHOTO_DECK_DEADLINE_MS);
  assert.equal(session.settled(), true);
  assert.equal(session.isLoaded('quick'), true);
  assert.equal(session.isLoaded('slow'), false);
  const shownAt = changes;
  net.answer('slow', true);
  await tick();
  assert.equal(session.isLoaded('slow'), false, 'a late success rearranged a shown deck');
  assert.equal(changes, shownAt, 'a late success notified');
  resetPhotoMemory();
});

test('a shown photo that fails after all becomes absent and notifies once', async () => {
  resetPhotoMemory();
  const net = controlledPrefetch();
  let changes = 0;
  const session = startPhotoSession(['a'], { prefetch: net.prefetch, ...clock() }, () => {
    changes += 1;
  });
  net.answer('a', true);
  await tick();
  assert.equal(session.isLoaded('a'), true);
  const before = changes;
  session.fail('a');
  assert.equal(session.isLoaded('a'), false);
  assert.equal(changes, before + 1);
  session.fail('a');
  assert.equal(changes, before + 1, 'a second report changed nothing');
  resetPhotoMemory();
});

test('a cancelled session never notifies again, whatever its probes do next', async () => {
  resetPhotoMemory();
  const net = controlledPrefetch();
  const timers = clock();
  let changes = 0;
  const session = startPhotoSession(['a'], { prefetch: net.prefetch, ...timers }, () => {
    changes += 1;
  });
  session.cancel();
  net.answer('a', true);
  await tick();
  timers.advance(PHOTO_DECK_DEADLINE_MS);
  session.fail('a');
  assert.equal(changes, 0);
  resetPhotoMemory();
});
