/**
 * The tapped-notification intent (lib/push-tap-intent.ts).
 *
 * Regression (2026-10-10): a cold-launch tap opened the Feed. The launch
 * response is read at mount, while the access gate is still reading secure
 * storage — so the first answer is always "not ready, phase onboarding". The
 * former hook decided on that answer and marked the tap handled. These tests
 * replay the same order of answers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AccessPhase } from './access-gate';
import { createPushTapIntent, type TapGate } from './push-tap-intent';

const RECALL = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const EVENT = '16fd2706-8baf-433b-82eb-8c7fada847da';

function recallData(recallCaseId: string) {
  return { kind: 'recall', recallCaseId, notificationEventId: EVENT };
}

function gate(phase: AccessPhase, ready = true, navigatorReady = true): TapGate {
  return { ready, phase, navigatorReady };
}

test('cold launch: the tap waits for the gate, then opens the recall exactly once', () => {
  const intent = createPushTapIntent();
  // Mount: the launch response is already there; the gate has not read yet
  // (phase derived from the initial onboarding record) and nothing is mounted.
  intent.offer('n1', recallData(RECALL));
  assert.equal(intent.take(gate('onboarding', false, false)), null);
  assert.equal(intent.pending(), RECALL, 'the tap is kept, not consumed');
  // The same response is re-delivered on re-render: still one intent.
  intent.offer('n1', recallData(RECALL));
  // The gate settles on an entitled installation, but the navigator has not
  // mounted yet (it renders only once the gate is ready).
  assert.equal(intent.take(gate('app', true, false)), null);
  // The navigator's ready event retries it.
  assert.equal(intent.take(gate('app')), RECALL);
  // Later renders and navigator state events open nothing more.
  intent.offer('n1', recallData(RECALL));
  assert.equal(intent.take(gate('app')), null);
  assert.equal(intent.pending(), null);
});

test('warm tap in the app phase opens immediately', () => {
  const intent = createPushTapIntent();
  intent.offer('n1', recallData(RECALL));
  assert.equal(intent.take(gate('app')), RECALL);
});

for (const phase of ['onboarding', 'paywall', 'education'] as const) {
  test(`the ${phase} gate is never bypassed: the tap opens nothing while it stands`, () => {
    const intent = createPushTapIntent();
    intent.offer('n1', recallData(RECALL));
    assert.equal(intent.take(gate(phase)), null);
    assert.equal(intent.take(gate(phase)), null);
    assert.equal(intent.pending(), RECALL);
  });
}

test('a lapsed subscriber who buys again in the same session lands on the tapped recall', () => {
  const intent = createPushTapIntent();
  intent.offer('n1', recallData(RECALL));
  assert.equal(intent.take(gate('paywall')), null);
  assert.equal(intent.take(gate('education')), null);
  assert.equal(intent.take(gate('app')), RECALL);
});

test('test, unknown and malformed payloads never navigate', () => {
  const cases: [string, unknown][] = [
    ['test', { kind: 'test' }],
    ['url', { kind: 'recall', recallCaseId: 'https://evil.example' }],
    ['no-data', undefined],
    ['string', 'recall'],
  ];
  for (const [identifier, data] of cases) {
    const intent = createPushTapIntent();
    intent.offer(identifier, data);
    assert.equal(intent.take(gate('app')), null, identifier);
  }
});

test('the newest tap wins, and a newer tap naming no recall cancels a waiting one', () => {
  const intent = createPushTapIntent();
  intent.offer('n1', recallData(RECALL));
  intent.offer('n2', recallData(OTHER));
  assert.equal(intent.take(gate('app')), OTHER);

  const cancelled = createPushTapIntent();
  cancelled.offer('n1', recallData(RECALL));
  cancelled.offer('n2', { kind: 'test' });
  assert.equal(cancelled.take(gate('app')), null);
});

test('a second, different notification for the same recall opens it again', () => {
  const intent = createPushTapIntent();
  intent.offer('n1', recallData(RECALL));
  assert.equal(intent.take(gate('app')), RECALL);
  intent.offer('n2', recallData(RECALL));
  assert.equal(intent.take(gate('app')), RECALL);
});
