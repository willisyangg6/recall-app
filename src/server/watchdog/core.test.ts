/**
 * The watchdog core state machine, driven through fakes: every decision path,
 * every documented GitHub outcome, bounded retries, and — because this
 * function holds two credentials — proof that neither ever reaches a
 * response, a log line, or a recorded row.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyGithubFailure,
  handleWatchdogRequest,
  secretsMatch,
  GITHUB_API_VERSION,
  GITHUB_MAX_ATTEMPTS,
  WATCHDOG_TARGET,
  type RpcResult,
  type WatchdogDeps,
} from '../../../supabase/functions/ingest-watchdog/core';

const SECRET = 'watchdog-shared-secret-8f3a1c';
const TOKEN = 'github-fine-grained-token-77e2b9';

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

interface Harness {
  deps: WatchdogDeps;
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
  fetchCalls: FetchCall[];
  logs: string[];
}

function tickData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision: 'dispatch_claimed',
    claimId: 'claim-1',
    staleSources: ['fda_announcements'],
    freshness: { fdaLastSuccessAt: '2026-08-28T10:00:00Z', fsisLastSuccessAt: null },
    repository: WATCHDOG_TARGET.repository,
    workflow: WATCHDOG_TARGET.workflow,
    ref: WATCHDOG_TARGET.ref,
    errorClass: null,
    ...overrides,
  };
}

function harness(options: {
  tick?: RpcResult;
  finalize?: RpcResult;
  responses?: (Response | Error)[];
  githubToken?: string | undefined;
  sharedSecret?: string | undefined;
}): Harness {
  const rpcCalls: Harness['rpcCalls'] = [];
  const fetchCalls: FetchCall[] = [];
  const logs: string[] = [];
  const responses = [...(options.responses ?? [])];
  const deps: WatchdogDeps = {
    env: {
      sharedSecret: 'sharedSecret' in options ? options.sharedSecret : SECRET,
      githubToken: 'githubToken' in options ? options.githubToken : TOKEN,
    },
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      if (fn === 'watchdog_tick') return options.tick ?? { data: tickData(), error: null };
      return options.finalize ?? { data: true, error: null };
    },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[key.toLowerCase()] = value;
      }
      fetchCalls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        headers,
        body: typeof init?.body === 'string' ? init.body : null,
      });
      const next = responses.shift();
      if (!next) throw new Error('no fake response queued');
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch,
    sleep: async () => {},
    log: (line) => logs.push(line),
  };
  return { deps, rpcCalls, fetchCalls, logs };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function timeoutError(): Error {
  const error = new Error('operation timed out');
  error.name = 'TimeoutError';
  return error;
}

// ── Authentication ───────────────────────────────────────────────────────────

test('a missing function-side shared secret rejects every invocation', async () => {
  const h = harness({ sharedSecret: undefined });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.status, 503);
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(h.fetchCalls.length, 0);
});

test('a missing caller secret is rejected before any database or GitHub call', async () => {
  const h = harness({});
  const result = await handleWatchdogRequest(h.deps, null, 'tick');
  assert.equal(result.status, 401);
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(h.fetchCalls.length, 0);
});

test('an incorrect caller secret is rejected', async () => {
  const h = harness({});
  const result = await handleWatchdogRequest(h.deps, 'wrong-secret', 'tick');
  assert.equal(result.status, 401);
  assert.equal(h.rpcCalls.length, 0);
});

test('secretsMatch accepts equal values and rejects different ones without length leaks', async () => {
  assert.equal(await secretsMatch('abc', 'abc'), true);
  assert.equal(await secretsMatch('abc', 'abd'), false);
  assert.equal(await secretsMatch('abc', 'abc-longer'), false);
  assert.equal(await secretsMatch('', 'abc'), false);
});

test('an unknown mode is rejected after auth, before any work', async () => {
  const h = harness({});
  const result = await handleWatchdogRequest(h.deps, SECRET, 'delete-everything');
  assert.equal(result.status, 400);
  assert.equal(h.rpcCalls.length, 0);
});

// ── Decisions that must not dispatch ─────────────────────────────────────────

test('fresh sources → no GitHub call at all', async () => {
  const h = harness({
    tick: { data: tickData({ decision: 'fresh', claimId: null, staleSources: [] }), error: null },
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.status, 200);
  assert.equal(result.body.decision, 'fresh');
  assert.equal(result.body.dispatched, false);
  assert.equal(h.fetchCalls.length, 0);
  assert.deepEqual(
    h.rpcCalls.map((c) => c.fn),
    ['watchdog_tick'],
  );
});

test('a running ingest → no dispatch', async () => {
  const h = harness({
    tick: { data: tickData({ decision: 'ingest_running', claimId: null }), error: null },
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.body.decision, 'ingest_running');
  assert.equal(h.fetchCalls.length, 0);
});

test('a recent accepted dispatch → cooldown, no dispatch', async () => {
  const h = harness({
    tick: { data: tickData({ decision: 'dispatch_cooldown', claimId: null }), error: null },
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.body.decision, 'dispatch_cooldown');
  assert.equal(h.fetchCalls.length, 0);
});

test('a database failure on tick → 500, nothing dispatched', async () => {
  const h = harness({ tick: { data: null, error: 'rpc watchdog_tick: http 500' } });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.status, 500);
  assert.equal(result.body.errorClass, 'database_error');
  assert.equal(h.fetchCalls.length, 0);
});

test('a claim missing its id or target → 500, nothing dispatched', async () => {
  const h = harness({ tick: { data: tickData({ claimId: null }), error: null } });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.status, 500);
  assert.equal(h.fetchCalls.length, 0);
});

// ── The dispatch path ────────────────────────────────────────────────────────

test('a claimed stale tick dispatches the real workflow exactly once, correctly', async () => {
  const h = harness({
    responses: [json(200, { workflow_run_id: 4242, run_url: 'https://api.github.com/x/4242' })],
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.status, 200);
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.workflowRunId, 4242);
  assert.equal(h.fetchCalls.length, 1);
  const call = h.fetchCalls[0];
  assert.equal(
    call.url,
    `https://api.github.com/repos/${WATCHDOG_TARGET.repository}/actions/workflows/${WATCHDOG_TARGET.workflow}/dispatches`,
  );
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['accept'], 'application/vnd.github+json');
  assert.equal(call.headers['x-github-api-version'], GITHUB_API_VERSION);
  assert.equal(call.body, JSON.stringify({ ref: WATCHDOG_TARGET.ref }));
  // Finalized as accepted, with the run id the current API returns.
  const finalize = h.rpcCalls.find((c) => c.fn === 'watchdog_finalize_dispatch');
  assert.ok(finalize);
  assert.equal(finalize.args.p_accepted, true);
  assert.equal(finalize.args.p_github_status, 200);
  assert.equal(finalize.args.p_github_run_id, 4242);
});

test('both sources stale still means ONE dispatch (the claim is singular)', async () => {
  const h = harness({
    tick: {
      data: tickData({ staleSources: ['fda_announcements', 'fsis_ingest'] }),
      error: null,
    },
    responses: [json(200, { workflow_run_id: 1 })],
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.body.accepted, true);
  assert.equal(h.fetchCalls.length, 1);
});

test('a 204 acceptance (older API versions) counts as accepted without a body', async () => {
  const h = harness({ responses: [new Response(null, { status: 204 })] });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.status, 200);
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.workflowRunId, undefined);
  const finalize = h.rpcCalls.find((c) => c.fn === 'watchdog_finalize_dispatch');
  assert.equal(finalize?.args.p_accepted, true);
  assert.equal(finalize?.args.p_github_status, 204);
});

test('a network timeout is recorded as a retryable failure, never a success', async () => {
  const h = harness({ responses: [timeoutError(), timeoutError()] });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.status, 502);
  assert.equal(result.body.accepted, false);
  assert.equal(result.body.errorClass, 'network_timeout');
  assert.equal(result.body.attempts, GITHUB_MAX_ATTEMPTS);
  const finalize = h.rpcCalls.find((c) => c.fn === 'watchdog_finalize_dispatch');
  assert.equal(finalize?.args.p_accepted, false);
  assert.equal(finalize?.args.p_error_class, 'network_timeout');
});

test('a 401 marks the credential broken and does not retry', async () => {
  const h = harness({ responses: [new Response(null, { status: 401 })] });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.status, 502);
  assert.equal(result.body.errorClass, 'github_unauthorized');
  assert.equal(h.fetchCalls.length, 1);
});

test('a 404 identifies workflow/ref/repository configuration failure', async () => {
  const h = harness({ responses: [new Response(null, { status: 404 })] });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.body.errorClass, 'github_not_found');
  const finalize = h.rpcCalls.find((c) => c.fn === 'watchdog_finalize_dispatch');
  assert.equal(finalize?.args.p_error_class, 'github_not_found');
});

test('rate limiting is bounded to a single attempt and observable as its own class', async () => {
  const h = harness({
    responses: [new Response(null, { status: 403, headers: { 'x-ratelimit-remaining': '0' } })],
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.body.errorClass, 'github_rate_limited');
  assert.equal(h.fetchCalls.length, 1);
});

test('a 5xx retries once, and a subsequent acceptance wins', async () => {
  const h = harness({
    responses: [new Response(null, { status: 502 }), json(200, { workflow_run_id: 7 })],
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.attempts, 2);
  assert.equal(h.fetchCalls.length, 2);
});

test('a finalize failure after an accepted dispatch is reported, not hidden', async () => {
  const h = harness({
    responses: [json(200, { workflow_run_id: 9 })],
    finalize: { data: null, error: 'network' },
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.finalizeRecorded, false);
});

// ── Configuration failures ───────────────────────────────────────────────────

test('a missing GitHub token never attempts dispatch and records configuration_error', async () => {
  const h = harness({
    githubToken: undefined,
    tick: { data: tickData({ decision: 'configuration_error', claimId: null }), error: null },
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
  assert.equal(result.status, 503);
  assert.equal(result.body.errorClass, 'missing_github_token');
  assert.equal(result.body.dispatched, false);
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.rpcCalls[0].args.p_configuration_error, 'missing_github_token');
});

// ── Probe mode ───────────────────────────────────────────────────────────────

test('a probe never dispatches, even when the decision would claim', async () => {
  const h = harness({
    tick: { data: tickData({ claimId: null }), error: null },
    responses: [json(200, { id: 1, name: 'scheduled-ingest' })],
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'probe');
  assert.equal(result.status, 200);
  assert.equal(result.body.dispatched, false);
  assert.deepEqual(result.body.github, { ok: true, status: 200, errorClass: null });
  // The tick ran in probe mode, and the ONLY GitHub call was a read.
  assert.equal(h.rpcCalls[0].args.p_probe, true);
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.fetchCalls[0].method, 'GET');
  assert.ok(!h.fetchCalls[0].url.endsWith('/dispatches'));
});

test('a probe surfaces a broken GitHub credential without dispatching', async () => {
  const h = harness({
    tick: { data: tickData({ decision: 'fresh', claimId: null }), error: null },
    responses: [new Response(null, { status: 401 })],
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'probe');
  assert.deepEqual(result.body.github, {
    ok: false,
    status: 401,
    errorClass: 'github_unauthorized',
  });
});

test('a probe with no GitHub token configured reports it and makes no network call', async () => {
  const h = harness({
    githubToken: undefined,
    tick: { data: tickData({ decision: 'fresh', claimId: null }), error: null },
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'probe');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.github, {
    ok: false,
    status: null,
    errorClass: 'missing_github_token',
  });
  assert.equal(h.fetchCalls.length, 0);
});

// ── Force mode (controlled dispatch verification) ────────────────────────────

test('force-dispatch passes p_force through and dispatches on a claim', async () => {
  const h = harness({ responses: [json(200, { workflow_run_id: 11 })] });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'force-dispatch');
  assert.equal(h.rpcCalls[0].args.p_force, true);
  assert.equal(result.body.accepted, true);
});

test('force-dispatch still respects a cooldown decision — safety checks stay on', async () => {
  const h = harness({
    tick: { data: tickData({ decision: 'dispatch_cooldown', claimId: null }), error: null },
  });
  const result = await handleWatchdogRequest(h.deps, SECRET, 'force-dispatch');
  assert.equal(result.body.decision, 'dispatch_cooldown');
  assert.equal(h.fetchCalls.length, 0);
});

// ── Containment guarantees ───────────────────────────────────────────────────

test('the function touches ONLY the watchdog RPCs — no other table, no events', async () => {
  for (const mode of ['tick', 'probe', 'force-dispatch']) {
    const h = harness({
      responses: [json(200, { workflow_run_id: 1 }), json(200, { id: 1 })],
    });
    await handleWatchdogRequest(h.deps, SECRET, mode);
    for (const call of h.rpcCalls) {
      assert.ok(
        call.fn === 'watchdog_tick' || call.fn === 'watchdog_finalize_dispatch',
        `unexpected rpc ${call.fn}`,
      );
    }
  }
});

test('neither credential ever appears in responses, logs, or recorded arguments', async () => {
  const scenarios: Harness[] = [
    harness({ responses: [json(200, { workflow_run_id: 5 })] }),
    harness({ responses: [new Response('secret-ish upstream body', { status: 401 })] }),
    harness({ responses: [timeoutError(), timeoutError()] }),
    harness({ tick: { data: null, error: 'boom' } }),
  ];
  for (const h of scenarios) {
    const result = await handleWatchdogRequest(h.deps, SECRET, 'tick');
    const visible =
      JSON.stringify(result.body) +
      h.logs.join('\n') +
      JSON.stringify(h.rpcCalls.map((c) => c.args));
    assert.ok(!visible.includes(TOKEN), 'GitHub token leaked');
    assert.ok(!visible.includes(SECRET), 'shared secret leaked');
    // Upstream response bodies are never echoed either.
    assert.ok(!visible.includes('secret-ish'), 'upstream body leaked');
  }
});

// ── Failure classification table ─────────────────────────────────────────────

test('GitHub failures map to stable sanitized classes', () => {
  assert.equal(classifyGithubFailure(401, null), 'github_unauthorized');
  assert.equal(classifyGithubFailure(403, '42'), 'github_forbidden');
  assert.equal(classifyGithubFailure(403, '0'), 'github_rate_limited');
  assert.equal(classifyGithubFailure(404, null), 'github_not_found');
  assert.equal(classifyGithubFailure(422, null), 'github_validation');
  assert.equal(classifyGithubFailure(429, null), 'github_rate_limited');
  assert.equal(classifyGithubFailure(500, null), 'github_server_error');
  assert.equal(classifyGithubFailure(418, null), 'github_error');
});
