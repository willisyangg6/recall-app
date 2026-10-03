/**
 * Notification education's choices under every permission outcome, with the
 * real effects replaced: the enable path is a mock that grants, denies,
 * finds a previous denial or throws a registration error. No prompt, no
 * token and no network exist here.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { educationActions } from './notification-education-actions';

function harness(enable: () => Promise<unknown>) {
  const calls: string[] = [];
  const actions = educationActions({
    enable: async () => {
      calls.push('enable');
      return enable();
    },
    complete: async () => {
      calls.push('complete');
    },
    onBusy: () => calls.push('busy'),
    onEnableError: () => calls.push('error'),
  });
  return { actions, calls };
}

test('Turn on: every permission outcome asks once, then completes once', async () => {
  for (const [outcome, result] of [
    ['previously granted (no prompt: the enable path checks first)', async () => 'enabled'],
    ['granted at the prompt', async () => 'enabled'],
    ['denied at the prompt', async () => 'permission_denied'],
    ['denied before (no prompt can show)', async () => 'blocked'],
  ] as const) {
    const { actions, calls } = harness(result);
    await actions.enable();
    assert.deepEqual(calls, ['busy', 'enable', 'complete'], outcome);
  }
});

test('Turn on: a registration error is swallowed and the education still completes', async () => {
  const { actions, calls } = harness(async () => {
    throw new Error('registration failed');
  });
  await actions.enable();
  assert.deepEqual(calls, ['busy', 'enable', 'error', 'complete']);
});

test('Not now completes without reading, asking or registering anything', async () => {
  const { actions, calls } = harness(async () => 'enabled');
  await actions.skip();
  assert.deepEqual(calls, ['complete']);
});

test('the first press takes the screen: double taps and a second action do nothing', async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { actions, calls } = harness(() => pending);
  const first = actions.enable();
  // Pressed again, and Not now pressed, while the prompt is up.
  await actions.enable();
  await actions.skip();
  release();
  await first;
  assert.deepEqual(calls, ['busy', 'enable', 'complete']);
  // And after Not now, Turn on never reaches the enable path.
  const skipped = harness(async () => 'enabled');
  await skipped.actions.skip();
  await skipped.actions.enable();
  assert.deepEqual(skipped.calls, ['complete']);
});
