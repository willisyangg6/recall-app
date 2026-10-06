/**
 * Bounded photo probing (2026-10-05): one verdict per URL, a deadline per
 * probe, a concurrency cap, a session memory that stops every repeat, and a
 * cancel that silences a run without losing what it learned.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasImageFailed, recordImageFailure } from './image-failures';
import {
  knownPhotoVerdict,
  probePhotos,
  recordPhotoLoaded,
  resetPhotoMemory,
  type PhotoVerdict,
} from './photo-probe';

/** Fake timers: fire by hand, in order. */
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

/** A prefetch whose answers the test releases one by one. */
function controlledPrefetch() {
  const pending = new Map<string, { resolve: (ok: boolean) => void; reject: () => void }>();
  const calls: string[] = [];
  return {
    calls,
    prefetch: (url: string) =>
      new Promise<boolean>((resolve, reject) => {
        calls.push(url);
        pending.set(url, { resolve, reject });
      }),
    answer: (url: string, ok: boolean) => pending.get(url)!.resolve(ok),
    throwFor: (url: string) => pending.get(url)!.reject(),
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('a loaded photo is reported once and remembered; a failed one is remembered as failed', async () => {
  resetPhotoMemory();
  const net = controlledPrefetch();
  const verdicts: [string, PhotoVerdict][] = [];
  probePhotos(['a', 'b'], { prefetch: net.prefetch, ...clock() }, (u, v) => verdicts.push([u, v]));
  net.answer('a', true);
  net.answer('b', false);
  await tick();
  assert.deepEqual(verdicts, [
    ['a', 'loaded'],
    ['b', 'unavailable'],
  ]);
  assert.equal(knownPhotoVerdict('a'), 'loaded');
  assert.equal(knownPhotoVerdict('b'), 'unavailable');
  assert.equal(hasImageFailed('b'), true, 'the card tile shares the failure memory');
  resetPhotoMemory();
});

test('a probe that never answers times out as unavailable, and is not asked again this session', async () => {
  resetPhotoMemory();
  const net = controlledPrefetch();
  const timers = clock();
  const verdicts: [string, PhotoVerdict][] = [];
  probePhotos(['slow'], { prefetch: net.prefetch, timeoutMs: 4000, ...timers }, (u, v) =>
    verdicts.push([u, v]),
  );
  timers.advance(3999);
  assert.deepEqual(verdicts, []);
  timers.advance(1);
  assert.deepEqual(verdicts, [['slow', 'unavailable']]);
  // A late answer changes nothing.
  net.answer('slow', true);
  await tick();
  assert.deepEqual(verdicts, [['slow', 'unavailable']]);
  assert.equal(knownPhotoVerdict('slow'), 'unavailable');
  // The next run answers from memory with no request.
  const again: [string, PhotoVerdict][] = [];
  probePhotos(['slow'], { prefetch: net.prefetch, ...clock() }, (u, v) => again.push([u, v]));
  assert.deepEqual(again, [['slow', 'unavailable']]);
  assert.equal(net.calls.filter((u) => u === 'slow').length, 1);
  resetPhotoMemory();
});

test('known verdicts are answered synchronously with no request, in either direction', () => {
  resetPhotoMemory();
  recordPhotoLoaded('ok');
  recordImageFailure('bad');
  const net = controlledPrefetch();
  const verdicts: [string, PhotoVerdict][] = [];
  probePhotos(['ok', 'bad'], { prefetch: net.prefetch, ...clock() }, (u, v) =>
    verdicts.push([u, v]),
  );
  assert.deepEqual(verdicts, [
    ['ok', 'loaded'],
    ['bad', 'unavailable'],
  ]);
  assert.deepEqual(net.calls, []);
  resetPhotoMemory();
});

test('at most the concurrency bound is in flight; the queue advances as probes settle', async () => {
  resetPhotoMemory();
  const net = controlledPrefetch();
  probePhotos(
    ['1', '2', '3', '4', '5'],
    { prefetch: net.prefetch, concurrency: 3, ...clock() },
    () => {},
  );
  assert.deepEqual(net.calls, ['1', '2', '3']);
  net.answer('2', true);
  await tick();
  assert.deepEqual(net.calls, ['1', '2', '3', '4']);
  net.answer('1', false);
  net.answer('3', false);
  await tick();
  assert.deepEqual(net.calls, ['1', '2', '3', '4', '5']);
  resetPhotoMemory();
});

test('a prefetch that throws or rejects is unavailable, never a hang', async () => {
  resetPhotoMemory();
  const verdicts: [string, PhotoVerdict][] = [];
  probePhotos(
    ['throws'],
    {
      prefetch: () => {
        throw new Error('no network');
      },
      ...clock(),
    },
    (u, v) => verdicts.push([u, v]),
  );
  await tick();
  assert.deepEqual(verdicts, [['throws', 'unavailable']]);
  const net = controlledPrefetch();
  const more: [string, PhotoVerdict][] = [];
  probePhotos(['rejects'], { prefetch: net.prefetch, ...clock() }, (u, v) => more.push([u, v]));
  net.throwFor('rejects');
  await tick();
  assert.deepEqual(more, [['rejects', 'unavailable']]);
  resetPhotoMemory();
});

test('cancel silences the run and stops issuing probes, but what was learned stays learned', async () => {
  resetPhotoMemory();
  const net = controlledPrefetch();
  const verdicts: [string, PhotoVerdict][] = [];
  const run = probePhotos(
    ['k1', 'k2', 'k3'],
    { prefetch: net.prefetch, concurrency: 1, ...clock() },
    (u, v) => verdicts.push([u, v]),
  );
  assert.deepEqual(net.calls, ['k1']);
  run.cancel();
  net.answer('k1', true);
  await tick();
  assert.deepEqual(verdicts, [], 'a cancelled run reported');
  assert.deepEqual(net.calls, ['k1'], 'a cancelled run kept probing');
  assert.equal(knownPhotoVerdict('k1'), 'loaded', 'the session memory still learned the answer');
  resetPhotoMemory();
});

test('a URL listed twice is probed once and reported once', async () => {
  resetPhotoMemory();
  const net = controlledPrefetch();
  const verdicts: [string, PhotoVerdict][] = [];
  probePhotos(['x', 'x'], { prefetch: net.prefetch, ...clock() }, (u, v) => verdicts.push([u, v]));
  assert.deepEqual(net.calls, ['x']);
  net.answer('x', true);
  await tick();
  assert.deepEqual(verdicts, [['x', 'loaded']]);
  resetPhotoMemory();
});
