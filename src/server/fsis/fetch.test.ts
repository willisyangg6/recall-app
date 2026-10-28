/**
 * The FSIS fetch failure diagnosis.
 *
 * On 2026-10-27 www.fsis.usda.gov stopped resolving. Node's fetch reported each
 * attempt as `TypeError: fetch failed` whose cause was a 10 s
 * UND_ERR_CONNECT_TIMEOUT, and the scheduled run failed with
 * "last error: fetch failed" plus a hint blaming Akamai fingerprints. These
 * tests pin the corrected message: the transport cause is kept, an observed
 * lookup failure is reported (without claiming where the fault lies), the
 * Akamai hint appears only for real 403s, and the run still fails after the
 * same four attempts.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchFsisRecords, FSIS_API_URL } from './fetch';

/** The exact shape undici produced in production (reproduced locally). */
function connectTimeout(): TypeError {
  const cause = Object.assign(
    new Error('Connect Timeout Error (attempted address: www.fsis.usda.gov:443, timeout: 10000ms)'),
    { name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' },
  );
  return new TypeError('fetch failed', { cause });
}

const NO_WAIT = { sleep: async () => {} };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('an unresolvable host fails loudly with the transport cause and the observed lookup failure', async () => {
  let calls = 0;
  const dnsChecks: string[] = [];
  const failing: typeof fetch = async () => {
    calls += 1;
    throw connectTimeout();
  };

  await assert.rejects(
    fetchFsisRecords(failing, {
      ...NO_WAIT,
      checkDns: async (hostname) => {
        dnsChecks.push(hostname);
        return 'no answer within 5 s';
      },
    }),
    (error: Error) => {
      assert.match(error.message, /failed after 4 attempts/);
      assert.match(error.message, /fetch failed \(UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error/);
      assert.match(
        error.message,
        /separate DNS lookup for www\.fsis\.usda\.gov also failed \(no answer/,
      );
      assert.match(error.message, /did not resolve from this runner/);
      // An observation, not a verdict: no outage claim, no ruling-out.
      assert.doesNotMatch(error.message, /outage|not a fingerprint|Akamai/i);
      return true;
    },
  );
  assert.equal(calls, 4, 'retry width is unchanged');
  assert.deepEqual(dnsChecks, ['www.fsis.usda.gov'], 'one DNS check, after the last attempt');
});

test('a transport failure with a resolving host keeps the cause but blames neither DNS nor Akamai', async () => {
  const reset: typeof fetch = async () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    });
  };
  await assert.rejects(
    fetchFsisRecords(reset, { ...NO_WAIT, checkDns: async () => null }),
    (error: Error) => {
      assert.match(error.message, /fetch failed \(ECONNRESET: read ECONNRESET\)/);
      assert.doesNotMatch(error.message, /DNS|Akamai/);
      return true;
    },
  );
});

test('persistent 403s keep the Akamai fingerprint hint and skip the DNS check', async () => {
  let dnsChecked = false;
  const gated: typeof fetch = async () => new Response('denied', { status: 403 });
  await assert.rejects(
    fetchFsisRecords(gated, {
      ...NO_WAIT,
      checkDns: async () => {
        dnsChecked = true;
        return 'unexpected';
      },
    }),
    (error: Error) => {
      assert.match(error.message, /last error: HTTP 403/);
      assert.match(error.message, /Akamai fingerprint rules may have changed/);
      return true;
    },
  );
  assert.equal(dnsChecked, false);
});

test('a transient transport failure still recovers on a later attempt', async () => {
  let calls = 0;
  const flaky: typeof fetch = async (input) => {
    calls += 1;
    assert.equal(String(input), FSIS_API_URL);
    if (calls < 3) throw connectTimeout();
    return jsonResponse([{ field_recall_number: '001-2026' }]);
  };
  const result = await fetchFsisRecords(flaky, {
    ...NO_WAIT,
    checkDns: async () => assert.fail('no DNS check on success'),
  });
  assert.equal(calls, 3);
  assert.equal(result.records.length, 1);
});

test('the diagnostic never carries the query string', async () => {
  const failing: typeof fetch = async () => {
    throw new TypeError(`fetch failed ${FSIS_API_URL}`, {
      cause: new Error(`bad ${FSIS_API_URL}`),
    });
  };
  await assert.rejects(
    fetchFsisRecords(failing, { ...NO_WAIT, checkDns: async () => null }),
    (error: Error) => {
      assert.doesNotMatch(error.message, /field_translation_language/);
      return true;
    },
  );
});
