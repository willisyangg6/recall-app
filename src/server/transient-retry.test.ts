/**
 * Fault classification and the bounded read-retry engine.
 *
 * Every transient case here is a fault actually observed in production on
 * 2026-09-08/09 or 2026-09-06, reproduced from its recorded error text. Every
 * permanent case is a defect that must surface on the first attempt: retrying it
 * would only delay the alarm, and backing off would make the delay worse.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyReadError,
  clipDiagnostic,
  DEFAULT_READ_RETRY_POLICY,
  InvalidSourceResponseError,
  ReadRetryExhaustedError,
  retryDelayMs,
  retryTransientRead,
} from './transient-retry';

/** The recorded production error from scheduled-ingest #434. */
const CLOUDFLARE_502 =
  'SupabaseStore.getLatestSnapshotMeta failed: <html> <head><title>502 Bad Gateway</title></head> ' +
  '<body> <center><h1>502 Bad Gateway</h1></center> <hr><center>cloudflare</center> </body> </html>';

const pg = (code: string, message: string) => Object.assign(new Error(message), { code });
const http = (status: number, message = `HTTP ${status}`) =>
  Object.assign(new Error(message), { status });

const NO_WAIT = { sleep: async () => {}, jitter: () => 0.5 };

// ── Retryable classes ───────────────────────────────────────────────────────

test('PG 57014 statement timeout on a read is retryable — the enforcement failure', () => {
  const result = classifyReadError(pg('57014', 'canceling statement due to statement timeout'));
  assert.deepEqual(result, { retryable: true, errorClass: 'statement_timeout' });
});

test('57014 is still recognized from bare prose when no code survives the boundary', () => {
  // reconcile.ts historically re-threw only error.message; the production row
  // carried exactly this text with no SQLSTATE attached.
  assert.equal(
    classifyReadError(new Error('canceling statement due to statement timeout')).retryable,
    true,
  );
});

test('a Cloudflare HTML 502 page where PostgREST JSON was expected is retryable', () => {
  const result = classifyReadError(new Error(CLOUDFLARE_502));
  assert.equal(result.retryable, true);
});

test('an HTML gateway page with no status number in it is still retryable', () => {
  const result = classifyReadError(
    new Error('SupabaseStore.listCases failed: <html><head><title>Bad Gateway</title></head>'),
  );
  assert.equal(result.retryable, true);
});

test('408/429/502/503/504 are retryable; 429 is named as rate limiting', () => {
  for (const status of [408, 502, 503, 504, 521, 524]) {
    assert.equal(classifyReadError(http(status)).retryable, true, `HTTP ${status}`);
  }
  assert.deepEqual(classifyReadError(http(429)), {
    retryable: true,
    errorClass: 'rate_limited',
  });
});

test('transport failures are retryable — the 2026-09-06 census fault', () => {
  for (const message of [
    'TypeError: fetch failed',
    'socket hang up',
    'read ECONNRESET',
    'connect ECONNREFUSED 127.0.0.1:54321',
    'getaddrinfo EAI_AGAIN db.example.supabase.co',
    'UND_ERR_SOCKET',
    'other side closed',
  ]) {
    assert.equal(classifyReadError(new Error(message)).retryable, true, message);
  }
});

test('connection-class SQLSTATEs are retryable on a read', () => {
  for (const code of ['08006', '57P03', '53300', '40001', '40P01']) {
    assert.equal(classifyReadError(pg(code, 'database said no')).retryable, true, code);
  }
});

test('an invalid source response is retryable whatever its detail text says', () => {
  // Detail containing "malformed" must not be read as a validation defect.
  const result = classifyReadError(
    new InvalidSourceResponseError('malformed, invalid input syntax-looking detail', 'text/html'),
  );
  assert.deepEqual(result, { retryable: true, errorClass: 'invalid_source_response' });
});

// ── Non-retryable classes ───────────────────────────────────────────────────

test('authentication and authorization failures fail on the first attempt', () => {
  for (const error of [
    pg('28000', 'invalid authorization specification'),
    new Error('JWT expired'),
    new Error('No API key found in request'),
    new Error('permission denied for table recall_cases'),
    new Error('new row violates row-level security policy'),
  ]) {
    const result = classifyReadError(error);
    assert.equal(result.retryable, false, String(error));
  }
});

test('schema errors fail on the first attempt', () => {
  for (const error of [
    pg('42703', 'column watchdog_dispatches.created_at does not exist'),
    pg('42P01', 'relation "nope" does not exist'),
    pg('PGRST204', "Could not find the 'x' column of 'y' in the schema cache"),
    new Error('column recall_cases.nope does not exist'),
  ]) {
    assert.equal(classifyReadError(error).retryable, false, String(error));
  }
});

test('validation and integrity errors fail on the first attempt', () => {
  for (const error of [
    pg('23505', 'duplicate key value violates unique constraint'),
    pg('22P02', 'invalid input syntax for type uuid'),
    new Error('violates foreign key constraint'),
  ]) {
    assert.equal(classifyReadError(error).retryable, false, String(error));
  }
});

test('ordinary non-transient 4xx fails on the first attempt', () => {
  for (const status of [400, 401, 405, 406, 409, 410, 422]) {
    assert.deepEqual(classifyReadError(http(status)), {
      retryable: false,
      errorClass: 'client_error',
    });
  }
});

test('an unrecognized error is permanent — retrying is the privileged case', () => {
  assert.deepEqual(classifyReadError(new Error('something nobody predicted')), {
    retryable: false,
    errorClass: 'unclassified',
  });
});

test('an explicit permanent SQLSTATE outranks transient-looking prose', () => {
  // A schema defect whose message happens to mention a gateway number.
  assert.equal(classifyReadError(pg('42703', 'column "x502" does not exist')).retryable, false);
});

test('a definitive transport fact outranks prose that merely looks permanent', () => {
  // The regression that made this ordering explicit: a payload echoed into the
  // error text contained `apikey=`, which an earlier auth pattern matched.
  const result = classifyReadError(
    new Error('TypeError: fetch failed while reading rawPayload=… apikey=SHOULD_NEVER_APPEAR'),
  );
  assert.deepEqual(result, { retryable: true, errorClass: 'transport' });
});

// ── Engine ──────────────────────────────────────────────────────────────────

test('a transient failure then a success resolves, calling the read twice', async () => {
  let calls = 0;
  const value = await retryTransientRead(
    'probe',
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('TypeError: fetch failed');
      return 'ok';
    },
    DEFAULT_READ_RETRY_POLICY,
    NO_WAIT,
  );
  assert.equal(value, 'ok');
  assert.equal(calls, 2);
});

test('a permanent failure is thrown unchanged after exactly one attempt', async () => {
  let calls = 0;
  const thrown = pg('42703', 'column does not exist');
  await assert.rejects(
    () =>
      retryTransientRead(
        'probe',
        async () => {
          calls += 1;
          throw thrown;
        },
        DEFAULT_READ_RETRY_POLICY,
        NO_WAIT,
      ),
    // The original error object, not a wrapper: callers already handle it.
    (error: unknown) => error === thrown,
  );
  assert.equal(calls, 1);
});

test('exhaustion reports the bound, the class, and nothing else', async () => {
  await assert.rejects(
    () =>
      retryTransientRead(
        'probe.read',
        async () => {
          throw pg('57014', 'canceling statement due to statement timeout');
        },
        DEFAULT_READ_RETRY_POLICY,
        NO_WAIT,
      ),
    (error: unknown) => {
      assert.ok(error instanceof ReadRetryExhaustedError);
      assert.equal(error.attempts, 4);
      assert.equal(error.errorClass, 'statement_timeout');
      assert.match(error.message, /read 'probe\.read' still failing after 4 attempt\(s\)/);
      return true;
    },
  );
});

test('backoff is bounded, jittered, and floors 429 waits at the rate-limit minimum', () => {
  const policy = DEFAULT_READ_RETRY_POLICY;
  const gateway = { retryable: true, errorClass: 'gateway' } as const;
  // 500 · 2ⁿ with ±25% jitter; jitter()=0.5 is the midpoint, so exact.
  assert.equal(retryDelayMs(1, gateway, policy, 0.5), 500);
  assert.equal(retryDelayMs(2, gateway, policy, 0.5), 1000);
  assert.equal(retryDelayMs(3, gateway, policy, 0.5), 2000);
  // Capped, never unbounded.
  assert.equal(retryDelayMs(9, gateway, policy, 0.5), policy.maxDelayMs);
  // Jitter band.
  assert.equal(retryDelayMs(1, gateway, policy, 0), 375);
  assert.equal(retryDelayMs(1, gateway, policy, 1), 625);
  // 429 never waits less than the Retry-After substitute.
  const limited = { retryable: true, errorClass: 'rate_limited' } as const;
  assert.ok(retryDelayMs(1, limited, policy, 0.5) >= policy.rateLimitMinDelayMs * 0.75);

  // The whole policy stays far inside the lease and workflow budgets.
  const worst = [1, 2, 3].reduce((sum, n) => sum + retryDelayMs(n, gateway, policy, 1), 0);
  assert.ok(worst < 5000, `worst-case delay ${worst}ms should stay under 5s`);
});

test('a server Retry-After is honored and clamped to the policy cap', () => {
  const within = classifyReadError(
    Object.assign(new Error('HTTP 429'), { status: 429, retryAfterMs: 3000 }),
  );
  assert.equal(within.retryable && within.minDelayMs, 3000);
  assert.equal(retryDelayMs(1, within, DEFAULT_READ_RETRY_POLICY, 0.5), 3000);
  // A 10-minute Retry-After cannot stall a job: the cap wins.
  const huge = classifyReadError(
    Object.assign(new Error('HTTP 503'), { status: 503, retryAfterMs: 600_000 }),
  );
  assert.equal(
    retryDelayMs(1, huge, DEFAULT_READ_RETRY_POLICY, 0.5),
    DEFAULT_READ_RETRY_POLICY.maxDelayMs,
  );
});

test('diagnostics are bounded, strip query strings, and never echo an HTML body', () => {
  const line = clipDiagnostic(new Error(CLOUDFLARE_502));
  assert.match(line, /^HTML response/);
  assert.doesNotMatch(line, /<|cloudflare|hr>/);
  assert.ok(line.length <= 201);

  const withKey = clipDiagnostic(
    new Error('fetch failed: https://db.example.co/rest/v1/x?apikey=SUPER_SECRET&select=*'),
  );
  assert.doesNotMatch(withKey, /SUPER_SECRET/);
  assert.match(withKey, /\?…/);

  const long = clipDiagnostic(new Error(`payload ${'X'.repeat(5000)}`));
  assert.ok(long.length <= 201, `diagnostic length ${long.length}`);
  assert.match(long, /…$/);
});

test('retry warnings name the operation, attempt, class, and a clipped cause only', async () => {
  const lines: string[] = [];
  await retryTransientRead(
    'store.getLatestSnapshotMeta',
    (() => {
      let calls = 0;
      return async () => {
        calls += 1;
        if (calls === 1) throw new Error(CLOUDFLARE_502);
        return 'ok';
      };
    })(),
    DEFAULT_READ_RETRY_POLICY,
    { ...NO_WAIT, warn: (line) => lines.push(line) },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /store\.getLatestSnapshotMeta attempt 2\/4 in \d+ms \[gateway\]/);
  assert.doesNotMatch(lines[0], /<html|cloudflare/);
});

test('403/404 are permanent for a database read — a missing route is a defect', () => {
  // Retrying these would delay a real schema or policy defect by ~3.5s of
  // backoff and teach nobody anything. The one source that legitimately serves
  // them (www.fda.gov's bot gate) declares its own exception in fda/fetch.ts.
  for (const status of [403, 404]) {
    assert.deepEqual(classifyReadError(http(status)), {
      retryable: false,
      errorClass: 'client_error',
    });
  }
});
