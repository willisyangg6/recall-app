/**
 * The Ready photo registry (2026-10-05): Building's warm session is the one
 * Ready adopts, keyed by the candidate photos' content; sessions are bounded
 * in number and in idle lifetime; a dropped session never notifies again.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NOT_STARTED,
  PHOTO_SESSION_IDLE_MS,
  PHOTO_SESSION_LIMIT,
  createPhotoRegistry,
  photoSessionKey,
  type PhotoRegistryEvent,
} from './ready-photo-registry';
import type { PhotoSession } from './ready-photo-session';

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

/** A hand-driven session: `settle` answers every candidate, `loaded` lists the successes. */
function fakeSessions() {
  const started: { candidates: string[]; cancelled: boolean; failed: string[] }[] = [];
  const controls = new Map<string, { settle: (loaded: string[]) => void }>();
  const start = (candidates: readonly string[], onChange: () => void): PhotoSession => {
    const record = { candidates: [...candidates], cancelled: false, failed: [] as string[] };
    started.push(record);
    let settled = candidates.length === 0;
    let loaded = new Set<string>();
    controls.set(photoSessionKey(candidates), {
      settle: (urls) => {
        if (record.cancelled) return;
        settled = true;
        loaded = new Set(urls);
        onChange();
      },
    });
    return {
      settled: () => settled,
      isLoaded: (url) => loaded.has(url),
      fail: (url) => {
        record.failed.push(url);
        loaded.delete(url);
        onChange();
      },
      cancel: () => {
        record.cancelled = true;
      },
    };
  };
  return {
    start,
    started,
    settle: (key: string, urls: string[]) => controls.get(key)!.settle(urls),
  };
}

function setup(limit?: number) {
  const timers = clock();
  const sessions = fakeSessions();
  const events: PhotoRegistryEvent[] = [];
  const registry = createPhotoRegistry({
    start: sessions.start,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    limit,
    onEvent: (event) => events.push(event),
  });
  return { timers, sessions, events, registry };
}

const A = ['https://img/a.jpg', 'https://img/b.jpg'];
const B = ['https://img/c.jpg'];
const C = ['https://img/d.jpg'];
const D = ['https://img/e.jpg'];

test('Building warms a session and Ready adopts that same session, already answered', () => {
  const { sessions, events, registry } = setup();
  registry.warm(A);
  sessions.settle(photoSessionKey(A), ['https://img/a.jpg']);
  // Ready derives the same candidates into a NEW array: the content is the key.
  const sameContent = [...A];
  const key = photoSessionKey(sameContent);
  assert.equal(registry.snapshot(key).settled, true, 'the first render already has the answer');
  const stop = registry.subscribe(sameContent, () => {});
  assert.equal(sessions.started.length, 1, 'no second session, no second probe');
  assert.deepEqual(events.at(-1), { kind: 'adopted', key, settled: true });
  assert.equal(registry.snapshot(key).loaded('https://img/a.jpg'), true);
  stop();
});

test('direct entry has no warm session: the first watcher starts one and the check shows until it settles', () => {
  const { sessions, events, registry } = setup();
  assert.equal(registry.snapshot(photoSessionKey(A)), NOT_STARTED);
  let notified = 0;
  registry.subscribe(A, () => (notified += 1));
  assert.equal(sessions.started.length, 1);
  assert.deepEqual(events[0], {
    kind: 'started',
    key: photoSessionKey(A),
    candidates: 2,
    by: 'watch',
  });
  assert.equal(registry.snapshot(photoSessionKey(A)).settled, false);
  sessions.settle(photoSessionKey(A), []);
  assert.equal(notified, 1);
  assert.equal(registry.snapshot(photoSessionKey(A)).settled, true);
});

test('a preference change or corpus update that changes the candidates gets its own session; the same candidates keep theirs', () => {
  const { sessions, registry } = setup();
  const stopA = registry.subscribe(A, () => {});
  registry.warm([...A]); // a corpus update with the same candidates
  assert.equal(sessions.started.length, 1);
  const stopB = registry.subscribe(B, () => {}); // new candidates (new choices, or a new corpus)
  assert.equal(sessions.started.length, 2);
  stopA();
  stopB();
});

test('an unwatched session expires after the idle time, and coming back inside it reuses the session', () => {
  const { timers, sessions, events, registry } = setup();
  registry.warm(A); // a warm-up nobody adopts yet
  timers.advance(PHOTO_SESSION_IDLE_MS - 1);
  const stop = registry.subscribe(A, () => {}); // Ready arrives just in time
  timers.advance(PHOTO_SESSION_IDLE_MS * 2);
  assert.equal(sessions.started[0].cancelled, false, 'a watched session never expires');
  stop(); // Ready is left (Back to Stores)
  timers.advance(PHOTO_SESSION_IDLE_MS / 2);
  registry.subscribe(A, () => {}); // and reached again
  assert.equal(sessions.started.length, 1, 'reused, not restarted');
  assert.equal(sessions.started[0].cancelled, false);

  registry.warm(B);
  timers.advance(PHOTO_SESSION_IDLE_MS);
  assert.equal(sessions.started[1].cancelled, true, 'a warm-up never adopted is cancelled');
  assert.deepEqual(events.at(-1), { kind: 'expired', key: photoSessionKey(B) });
  assert.equal(registry.snapshot(photoSessionKey(B)), NOT_STARTED);
});

test('the registry is bounded: the least recently used unwatched session is evicted, a watched one never is', () => {
  const { sessions, registry } = setup();
  assert.equal(PHOTO_SESSION_LIMIT, 3);
  const stopA = registry.subscribe(A, () => {}); // shown
  registry.warm(B);
  registry.warm(C);
  registry.warm(D); // over the bound: B is the oldest unwatched
  assert.deepEqual(registry.keys(), [A, C, D].map(photoSessionKey));
  assert.equal(sessions.started[1].cancelled, true);
  assert.equal(sessions.started[0].cancelled, false, 'the watched session stays');
  stopA();
});

test('only watched sessions can exceed the bound', () => {
  const { registry } = setup(1);
  const stops = [A, B].map((candidates) => registry.subscribe(candidates, () => {}));
  assert.equal(registry.keys().length, 2, 'two mounted screens keep two sessions');
  stops.forEach((stop) => stop());
  registry.warm(C);
  assert.deepEqual(registry.keys(), [photoSessionKey(C)], 'back within the bound once unwatched');
});

test('a render failure reaches its own session; a dropped session never notifies a watcher again', () => {
  const { timers, sessions, registry } = setup();
  let notified = 0;
  const stop = registry.subscribe(A, () => (notified += 1));
  sessions.settle(photoSessionKey(A), ['https://img/a.jpg']);
  registry.fail(photoSessionKey(A), 'https://img/a.jpg');
  assert.deepEqual(sessions.started[0].failed, ['https://img/a.jpg']);
  assert.equal(registry.snapshot(photoSessionKey(A)).loaded('https://img/a.jpg'), false);
  const before = notified;
  stop();
  timers.advance(PHOTO_SESSION_IDLE_MS);
  sessions.settle(photoSessionKey(A), ['https://img/b.jpg']); // a late answer from the cancelled session
  assert.equal(notified, before);
  registry.fail(photoSessionKey(A), 'https://img/b.jpg'); // and a late failure goes nowhere
  assert.deepEqual(sessions.started[0].failed, ['https://img/a.jpg']);
});

test('clearing (a new development stand-in) cancels every session', () => {
  const { sessions, registry } = setup();
  registry.warm(A);
  registry.subscribe(B, () => {});
  registry.clear();
  assert.deepEqual(registry.keys(), []);
  assert.ok(sessions.started.every((record) => record.cancelled));
});
