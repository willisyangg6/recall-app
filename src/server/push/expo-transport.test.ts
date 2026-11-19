/**
 * The Expo transport's authentication and error contract (2026-11-18): a
 * missing access token is refused before any network call, and a whole-request
 * failure keeps the HTTP status plus Expo's sanitized error code — never
 * Expo's free-text message, which can quote push tokens.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ExpoAuthMissingError,
  ExpoPushTransport,
  ExpoRequestError,
  MISSING_ACCESS_TOKEN,
  redactPushTokens,
  sanitizedProviderCode,
} from './expo-transport';
import type { PushMessage } from './types';

const MESSAGE: PushMessage = {
  to: 'ExponentPushToken[abc]',
  title: 'Recall alert: Example',
  body: 'Example body.',
  sound: 'default',
  data: { kind: 'recall', recallCaseId: 'case-1', notificationEventId: 'event-1' },
};

function recordingFetch(response: () => Response): {
  fetchImpl: typeof fetch;
  calls: RequestInit[];
} {
  const calls: RequestInit[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {});
    return response();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('no token (absent or blank): authProblem names it and nothing reaches the network', async () => {
  for (const accessToken of [undefined, '', '   ']) {
    const { fetchImpl, calls } = recordingFetch(() => json(200, { data: [] }));
    const transport = new ExpoPushTransport({ accessToken, fetchImpl });
    assert.equal(transport.authProblem(), MISSING_ACCESS_TOKEN);
    await assert.rejects(transport.send([MESSAGE]), ExpoAuthMissingError);
    await assert.rejects(transport.getReceipts(['ticket-1']), ExpoAuthMissingError);
    assert.equal(calls.length, 0);
  }
});

test('with a token: authProblem is null and the bearer header is sent', async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    json(200, { data: [{ status: 'ok', id: 'ticket-1' }] }),
  );
  const transport = new ExpoPushTransport({ accessToken: 'robot-token', fetchImpl });
  assert.equal(transport.authProblem(), null);
  const tickets = await transport.send([MESSAGE]);
  assert.deepEqual(tickets, [{ status: 'ok', id: 'ticket-1' }]);
  const headers = calls[0].headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer robot-token');
});

test("a 403 keeps Expo's code, is systemic, and drops the free-text message", async () => {
  const { fetchImpl } = recordingFetch(() =>
    json(403, {
      errors: [{ code: 'UNAUTHORIZED', message: 'bad token for ExponentPushToken[abc]' }],
    }),
  );
  const transport = new ExpoPushTransport({ accessToken: 'revoked', fetchImpl });
  const error = await transport.send([MESSAGE]).then(
    () => assert.fail('expected a rejection'),
    (e: unknown) => e,
  );
  assert.ok(error instanceof ExpoRequestError);
  assert.equal(error.status, 403);
  assert.equal(error.code, 'UNAUTHORIZED');
  assert.equal(error.failureCode, 'UNAUTHORIZED');
  assert.equal(error.systemic, true);
  assert.equal(error.message, 'Expo push send failed (HTTP 403 UNAUTHORIZED)');
  assert.ok(!error.message.includes('ExponentPushToken'));
});

test('a non-JSON failure records the status alone; a 5xx is not systemic', async () => {
  const { fetchImpl } = recordingFetch(
    () => new Response('<html>Bad gateway</html>', { status: 502 }),
  );
  const transport = new ExpoPushTransport({ accessToken: 'robot-token', fetchImpl });
  const error = await transport.getReceipts(['ticket-1']).then(
    () => assert.fail('expected a rejection'),
    (e: unknown) => e,
  );
  assert.ok(error instanceof ExpoRequestError);
  assert.equal(error.code, null);
  assert.equal(error.failureCode, 'http_502');
  assert.equal(error.systemic, false);
  assert.equal(error.message, 'Expo push receipt fetch failed (HTTP 502)');
});

test('sanitizedProviderCode accepts only an upper-case identifier', () => {
  assert.equal(
    sanitizedProviderCode({ errors: [{ code: 'TOO_MANY_REQUESTS' }] }),
    'TOO_MANY_REQUESTS',
  );
  assert.equal(sanitizedProviderCode({ errors: [{ code: 'ExponentPushToken[abc]' }] }), null);
  assert.equal(sanitizedProviderCode({ errors: [{ code: 'A'.repeat(65) }] }), null);
  assert.equal(sanitizedProviderCode({ errors: [] }), null);
  assert.equal(sanitizedProviderCode('nope'), null);
  assert.equal(sanitizedProviderCode(null), null);
});

test('redactPushTokens removes both token spellings', () => {
  assert.equal(
    redactPushTokens('"ExponentPushToken[a1]" and ExpoPushToken[b-2] failed'),
    '"ExpoPushToken[redacted]" and ExpoPushToken[redacted] failed',
  );
});
