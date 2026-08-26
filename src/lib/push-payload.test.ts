/**
 * Tap-navigation safety: the app only ever navigates from a validated typed
 * payload it reconstructs itself — never from a URL or arbitrary value inside
 * a push. Invalid payloads return null (no navigation), never throw.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRecallPushPayload } from './push-payload';

const CASE_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';

test('valid recall payload navigates to the canonical case id', () => {
  const parsed = parseRecallPushPayload({
    kind: 'recall',
    recallCaseId: CASE_ID,
    notificationEventId: EVENT_ID,
  });
  assert.deepEqual(parsed, { recallCaseId: CASE_ID, notificationEventId: EVENT_ID });
});

test('test notifications and unknown kinds never navigate', () => {
  assert.equal(parseRecallPushPayload({ kind: 'test' }), null);
  assert.equal(parseRecallPushPayload({ kind: 'marketing', recallCaseId: CASE_ID }), null);
});

test('malformed payloads never navigate and never throw', () => {
  assert.equal(parseRecallPushPayload(undefined), null);
  assert.equal(parseRecallPushPayload(null), null);
  assert.equal(parseRecallPushPayload('recall'), null);
  assert.equal(parseRecallPushPayload({}), null);
  assert.equal(parseRecallPushPayload({ kind: 'recall' }), null);
  assert.equal(parseRecallPushPayload({ kind: 'recall', recallCaseId: 42 }), null);
  // A URL or path smuggled where the id belongs must be rejected.
  assert.equal(
    parseRecallPushPayload({ kind: 'recall', recallCaseId: 'https://evil.example/x' }),
    null,
  );
  assert.equal(parseRecallPushPayload({ kind: 'recall', recallCaseId: '../secrets' }), null);
});

test('a bad event id degrades to null but a valid case still navigates', () => {
  const parsed = parseRecallPushPayload({
    kind: 'recall',
    recallCaseId: CASE_ID,
    notificationEventId: 'not-a-uuid',
  });
  assert.deepEqual(parsed, { recallCaseId: CASE_ID, notificationEventId: null });
});
