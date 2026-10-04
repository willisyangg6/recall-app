/**
 * Notification education's choices under every permission and registration
 * outcome (2026-10-04), with the real effects replaced: the permission port
 * grants, denies at the prompt, or reports a denial the system will not
 * revisit; the registration port succeeds, fails, never answers, or answers
 * late and ignores its abort. No prompt, no token and no network exist here;
 * the deadline is shortened to milliseconds.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  educationActions,
  INITIAL_EDUCATION_VIEW,
  REGISTRATION_TIMEOUT_MS,
  type EducationView,
} from './notification-education-actions';
import type { PermissionResolution } from './push-registration';

const GRANTED: PermissionResolution = { granted: true, canAskAgain: false, prompted: false };
const GRANTED_AT_PROMPT: PermissionResolution = {
  granted: true,
  canAskAgain: true,
  prompted: true,
};
const DENIED_NOW: PermissionResolution = { granted: false, canAskAgain: false, prompted: true };
const BLOCKED: PermissionResolution = { granted: false, canAskAgain: false, prompted: false };

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function harness(options: {
  permission: PermissionResolution | PermissionResolution[] | (() => Promise<PermissionResolution>);
  register?: (signal?: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}) {
  const calls: string[] = [];
  const views: EducationView[] = [];
  const signals: AbortSignal[] = [];
  let completes = 0;
  const answers = Array.isArray(options.permission) ? [...options.permission] : null;
  const actions = educationActions({
    resolvePermission: async () => {
      calls.push('permission');
      if (typeof options.permission === 'function') return options.permission();
      if (answers)
        return answers.length > 1 ? (answers.shift() as PermissionResolution) : answers[0];
      return options.permission as PermissionResolution;
    },
    register: async (signal) => {
      calls.push('register');
      if (signal) signals.push(signal);
      await (options.register ?? (async () => {}))(signal);
    },
    complete: async () => {
      calls.push('complete');
      completes += 1;
    },
    openSettings: () => calls.push('settings'),
    onView: (view) => views.push(view),
    onError: () => calls.push('error'),
    registrationTimeoutMs: options.timeoutMs ?? 30,
  });
  return { actions, calls, views, signals, completes: () => completes };
}

/** A registration that answers only to its abort signal. */
function hangs(signal?: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

test('the deadline is ten seconds in production and never covers the prompt', () => {
  assert.equal(REGISTRATION_TIMEOUT_MS, 10_000);
  assert.deepEqual(INITIAL_EDUCATION_VIEW, { phase: 'intro', busy: false });
});

test('granted and registered: busy, register, complete — the normal flow, with or without a prompt', async () => {
  for (const permission of [GRANTED, GRANTED_AT_PROMPT]) {
    const h = harness({ permission });
    await h.actions.enable();
    assert.deepEqual(h.calls, ['permission', 'register', 'complete']);
    assert.deepEqual(h.views, [{ phase: 'intro', busy: true }]);
    assert.equal(h.completes(), 1);
  }
});

test('denied at the prompt just shown: completes with no registration and no claim', async () => {
  const h = harness({ permission: DENIED_NOW });
  await h.actions.enable();
  assert.deepEqual(h.calls, ['permission', 'complete']);
  assert.equal(h.actions.view().phase, 'intro');
});

test('denied before today: the blocked phase, nothing completes, nothing registers', async () => {
  const h = harness({ permission: BLOCKED });
  await h.actions.enable();
  assert.deepEqual(h.calls, ['permission']);
  assert.deepEqual(h.views, [
    { phase: 'intro', busy: true },
    { phase: 'blocked', busy: false },
  ]);
  assert.equal(h.completes(), 0);
});

test('registration failure after a granted permission: the failed phase, nothing completes', async () => {
  const h = harness({
    permission: GRANTED,
    register: async () => {
      throw new Error('HTTP 500');
    },
  });
  await h.actions.enable();
  assert.deepEqual(h.calls, ['permission', 'register', 'error']);
  assert.equal(h.actions.view().phase, 'failed');
  assert.equal(h.completes(), 0);
});

test('a permission read that throws is shown as a failure, never as success', async () => {
  const h = harness({
    permission: async () => {
      throw new Error('platform');
    },
  });
  await h.actions.enable();
  assert.deepEqual(h.calls, ['permission', 'error']);
  assert.equal(h.actions.view().phase, 'failed');
});

test('Try again from the failed phase is one new attempt: permission re-read, registration retried', async () => {
  let attempts = 0;
  const h = harness({
    permission: GRANTED,
    register: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('first time');
    },
  });
  await h.actions.enable();
  assert.equal(h.actions.view().phase, 'failed');
  await h.actions.enable();
  assert.deepEqual(h.calls, [
    'permission',
    'register',
    'error',
    'permission',
    'register',
    'complete',
  ]);
  assert.deepEqual(h.views.at(-1), { phase: 'failed', busy: true }, 'busy keeps the failed phase');
  assert.equal(h.completes(), 1);
});

test('a slow registration is aborted at the deadline and shown as a failure; the shopper is not held', async () => {
  const h = harness({ permission: GRANTED, register: hangs, timeoutMs: 20 });
  const started = Date.now();
  await h.actions.enable();
  assert.ok(Date.now() - started < 1000);
  assert.equal(h.signals[0].aborted, true, 'the attempt signal fired');
  assert.equal(h.actions.view().phase, 'failed');
  assert.equal(h.completes(), 0);
  // Continue without alerts is now available and completes once.
  await h.actions.skip();
  assert.equal(h.completes(), 1);
});

test('a late registration result — after the deadline or after Continue without alerts — changes nothing', async () => {
  // Ignores its abort and resolves long after the deadline.
  let release: () => void = () => {};
  const late = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = harness({ permission: GRANTED, register: () => late, timeoutMs: 10 });
  const first = h.actions.enable();
  await tick(40);
  assert.equal(h.actions.view().phase, 'failed');
  await h.actions.skip();
  assert.equal(h.completes(), 1);
  const viewsBefore = h.views.length;
  release();
  await first;
  await tick();
  assert.equal(h.completes(), 1, 'the late success completes nothing a second time');
  assert.equal(h.views.length, viewsBefore, 'and moves no view');
});

test('double taps start one attempt: one permission read, one registration, one completion', async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = harness({ permission: GRANTED, register: () => pending, timeoutMs: 5000 });
  const first = h.actions.enable();
  await tick();
  await h.actions.enable();
  await h.actions.enable();
  release();
  await first;
  assert.deepEqual(h.calls, ['permission', 'register', 'complete']);
});

test('Not now completes without reading, asking or registering anything — and only once', async () => {
  const h = harness({ permission: GRANTED });
  await h.actions.skip();
  await h.actions.skip();
  await h.actions.enable();
  assert.deepEqual(h.calls, ['complete']);
});

test('Continue without alerts during an attempt aborts it and completes; the stale result is dropped', async () => {
  const h = harness({ permission: GRANTED, register: hangs, timeoutMs: 5000 });
  const first = h.actions.enable();
  await tick();
  await h.actions.skip();
  assert.equal(h.signals[0].aborted, true);
  await first;
  assert.deepEqual(h.calls, ['permission', 'register', 'complete']);
  assert.equal(h.actions.view().phase, 'intro', 'the aborted attempt showed no failure');
});

test('Open settings opens them and nothing else; a foreground without it reads nothing', async () => {
  const h = harness({ permission: BLOCKED });
  // Resume before anything was opened: nothing.
  h.actions.resume();
  await tick();
  assert.deepEqual(h.calls, []);
  await h.actions.enable();
  h.actions.openSettings();
  assert.deepEqual(h.calls, ['permission', 'settings']);
  assert.equal(h.completes(), 0);
});

test('returning from Settings re-checks within the enable flow: granted registers and completes', async () => {
  const h = harness({ permission: [BLOCKED, GRANTED] });
  await h.actions.enable();
  h.actions.openSettings();
  h.actions.resume();
  await tick(5);
  assert.deepEqual(h.calls, ['permission', 'settings', 'permission', 'register', 'complete']);
  assert.deepEqual(
    h.views.at(-1),
    { phase: 'blocked', busy: true },
    'the re-check showed Checking…',
  );
  // A second foreground after completion does nothing.
  h.actions.resume();
  await tick();
  assert.equal(h.completes(), 1);
});

test('returning from Settings still denied stays on the blocked phase; a second return without opening again reads nothing', async () => {
  const h = harness({ permission: BLOCKED });
  await h.actions.enable();
  h.actions.openSettings();
  h.actions.resume();
  await tick(5);
  assert.deepEqual(h.calls, ['permission', 'settings', 'permission']);
  assert.deepEqual(h.actions.view(), { phase: 'blocked', busy: false });
  h.actions.resume();
  await tick();
  assert.deepEqual(h.calls, ['permission', 'settings', 'permission'], 'the flag was consumed');
  assert.equal(h.completes(), 0);
});

test('Open settings is ignored while an attempt is in flight and after completion', async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = harness({ permission: GRANTED, register: () => pending, timeoutMs: 5000 });
  const first = h.actions.enable();
  await tick();
  h.actions.openSettings();
  release();
  await first;
  h.actions.openSettings();
  assert.deepEqual(h.calls, ['permission', 'register', 'complete']);
});
