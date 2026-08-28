/**
 * Watchdog core — the complete request/dispatch state machine of the
 * ingest-watchdog Edge Function, written as portable TypeScript (Web fetch +
 * WebCrypto only, no Deno or Node APIs) so the SAME code runs under the Deno
 * edge runtime and is tested by the Node suite (src/server/watchdog/).
 *
 * Responsibilities, in order:
 *   1. authenticate the invocation (dedicated shared secret, digest-compared)
 *   2. call the atomic claim RPC (watchdog_tick — one explainable decision)
 *   3. return without dispatching when fresh / running / cooling down
 *   4. only after a claim, call GitHub's workflow-dispatch REST endpoint
 *   5. finalize the claim as accepted or failed (watchdog_finalize_dispatch)
 *   6. sanitize everything: responses and logs carry error CLASSES, never
 *      credentials, raw headers, or upstream response bodies
 *
 * The GitHub contract was verified against the current official docs
 * (API version 2026-03-10): a successful dispatch returns 200 with
 * { workflow_run_id, run_url, html_url }. Older API versions documented 204
 * No Content, so ANY 2xx counts as accepted and the run id is read only when
 * a JSON body is present — never assume a single success code.
 */

/** Compile-time mirror of the migration's decision CHECK constraint. */
export const WATCHDOG_DECISIONS = [
  'fresh',
  'ingest_running',
  'dispatch_cooldown',
  'dispatch_claimed',
  'configuration_error',
] as const;
export type WatchdogDecision = (typeof WATCHDOG_DECISIONS)[number];

/** The GitHub target — must name the real workflow file and branch. */
export const WATCHDOG_TARGET = {
  repository: 'willisyangg6/recall-app',
  workflow: 'scheduled-ingest.yml',
  ref: 'master',
} as const;

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_API_VERSION = '2026-03-10';
/** Bounded network behavior: per-request timeout and total attempts. */
export const GITHUB_TIMEOUT_MS = 10_000;
export const GITHUB_MAX_ATTEMPTS = 2;
export const GITHUB_RETRY_DELAY_MS = 1_500;

export type WatchdogMode = 'tick' | 'probe' | 'force-dispatch';

export interface WatchdogEnv {
  /** Cron-to-function shared secret (Edge Function secret). */
  sharedSecret: string | undefined;
  /** Fine-grained GitHub token, Actions: write on the one repository. */
  githubToken: string | undefined;
}

export interface RpcResult {
  data: unknown;
  error: string | null;
}

export interface WatchdogDeps {
  env: WatchdogEnv;
  /** Service-role PostgREST RPC call (injected; faked in tests). */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  fetchImpl: typeof fetch;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Sanitized progress lines only — never given credential material. */
  log?: (line: string) => void;
}

export interface WatchdogResponse {
  status: number;
  body: Record<string, unknown>;
}

interface TickPayload {
  decision: WatchdogDecision;
  claimId: string | null;
  staleSources: string[];
  freshness: Record<string, unknown> | null;
  repository: string | null;
  workflow: string | null;
  ref: string | null;
  errorClass: string | null;
}

/**
 * Constant-time-in-effect secret comparison: both values are SHA-256 digested
 * and the fixed-length digests compared without early exit, so neither length
 * nor prefix of the expected secret leaks through timing.
 */
export async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/** Sanitized failure classes — the ONLY GitHub error detail ever recorded. */
export function classifyGithubFailure(status: number, rateLimitRemaining: string | null): string {
  if (status === 401) return 'github_unauthorized';
  if (status === 403) {
    return rateLimitRemaining === '0' ? 'github_rate_limited' : 'github_forbidden';
  }
  if (status === 404) return 'github_not_found';
  if (status === 422) return 'github_validation';
  if (status === 429) return 'github_rate_limited';
  if (status >= 500) return 'github_server_error';
  return 'github_error';
}

function parseTick(result: RpcResult): TickPayload | null {
  if (result.error || result.data === null || typeof result.data !== 'object') return null;
  const raw = result.data as Record<string, unknown>;
  const decision = raw.decision;
  if (
    typeof decision !== 'string' ||
    !(WATCHDOG_DECISIONS as readonly string[]).includes(decision)
  ) {
    return null;
  }
  return {
    decision: decision as WatchdogDecision,
    claimId: typeof raw.claimId === 'string' ? raw.claimId : null,
    staleSources: Array.isArray(raw.staleSources)
      ? raw.staleSources.filter((s): s is string => typeof s === 'string')
      : [],
    freshness:
      raw.freshness && typeof raw.freshness === 'object'
        ? (raw.freshness as Record<string, unknown>)
        : null,
    repository: typeof raw.repository === 'string' ? raw.repository : null,
    workflow: typeof raw.workflow === 'string' ? raw.workflow : null,
    ref: typeof raw.ref === 'string' ? raw.ref : null,
    errorClass: typeof raw.errorClass === 'string' ? raw.errorClass : null,
  };
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'recall-app-ingest-watchdog',
  };
}

interface DispatchAttemptResult {
  accepted: boolean;
  status: number | null;
  errorClass: string | null;
  workflowRunId: number | null;
  runUrl: string | null;
  attempts: number;
}

/**
 * POST the workflow-dispatch event. Retries once, only on network failure or
 * a 5xx — a 4xx is deterministic and a rate limit must back off to a later
 * watchdog tick, not hammer.
 */
async function dispatchWorkflow(
  deps: WatchdogDeps,
  token: string,
  target: { repository: string; workflow: string; ref: string },
): Promise<DispatchAttemptResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const url = `${GITHUB_API_BASE}/repos/${target.repository}/actions/workflows/${target.workflow}/dispatches`;
  let attempts = 0;
  let last: DispatchAttemptResult = {
    accepted: false,
    status: null,
    errorClass: 'network_error',
    workflowRunId: null,
    runUrl: null,
    attempts: 0,
  };
  while (attempts < GITHUB_MAX_ATTEMPTS) {
    attempts += 1;
    let response: Response;
    try {
      response = await deps.fetchImpl(url, {
        method: 'POST',
        headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: target.ref }),
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      last = {
        accepted: false,
        status: null,
        errorClass: timedOut ? 'network_timeout' : 'network_error',
        workflowRunId: null,
        runUrl: null,
        attempts,
      };
      deps.log?.(`dispatch attempt ${attempts} failed: ${last.errorClass}`);
      if (attempts < GITHUB_MAX_ATTEMPTS) await sleep(GITHUB_RETRY_DELAY_MS);
      continue;
    }
    if (response.ok) {
      // 200 (API 2026-03-10, JSON body with the run id) or 204 (older API
      // versions, no body) — both are documented acceptance.
      let workflowRunId: number | null = null;
      let runUrl: string | null = null;
      try {
        const body = (await response.json()) as Record<string, unknown>;
        if (typeof body.workflow_run_id === 'number') workflowRunId = body.workflow_run_id;
        if (typeof body.run_url === 'string') runUrl = body.run_url;
      } catch {
        // No body (204) — acceptance stands.
      }
      return {
        accepted: true,
        status: response.status,
        errorClass: null,
        workflowRunId,
        runUrl,
        attempts,
      };
    }
    const errorClass = classifyGithubFailure(
      response.status,
      response.headers.get('x-ratelimit-remaining'),
    );
    last = {
      accepted: false,
      status: response.status,
      errorClass,
      workflowRunId: null,
      runUrl: null,
      attempts,
    };
    deps.log?.(`dispatch attempt ${attempts} rejected: ${errorClass} (${response.status})`);
    if (errorClass !== 'github_server_error') break;
    if (attempts < GITHUB_MAX_ATTEMPTS) await sleep(GITHUB_RETRY_DELAY_MS);
  }
  return last;
}

/**
 * Probe-only GitHub check: GET the workflow. Validates the credential, the
 * repository, and the workflow's existence WITHOUT creating any run.
 */
async function checkWorkflowExists(
  deps: WatchdogDeps,
  token: string,
  target: { repository: string; workflow: string },
): Promise<{ ok: boolean; status: number | null; errorClass: string | null }> {
  const url = `${GITHUB_API_BASE}/repos/${target.repository}/actions/workflows/${target.workflow}`;
  try {
    const response = await deps.fetchImpl(url, {
      method: 'GET',
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (response.ok) return { ok: true, status: response.status, errorClass: null };
    return {
      ok: false,
      status: response.status,
      errorClass: classifyGithubFailure(
        response.status,
        response.headers.get('x-ratelimit-remaining'),
      ),
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return { ok: false, status: null, errorClass: timedOut ? 'network_timeout' : 'network_error' };
  }
}

/**
 * The whole request, one entry point. Never throws; never places credential
 * material in the returned body or in log lines.
 */
export async function handleWatchdogRequest(
  deps: WatchdogDeps,
  providedSecret: string | null,
  mode: string,
): Promise<WatchdogResponse> {
  if (!deps.env.sharedSecret) {
    // The function itself is misconfigured — reject everyone loudly.
    return { status: 503, body: { error: 'watchdog_secret_not_configured' } };
  }
  if (!providedSecret || !(await secretsMatch(providedSecret, deps.env.sharedSecret))) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  if (mode !== 'tick' && mode !== 'probe' && mode !== 'force-dispatch') {
    return { status: 400, body: { error: 'invalid_mode' } };
  }

  const probe = mode === 'probe';
  const force = mode === 'force-dispatch';

  // A missing GitHub token must never reach a claim: record the heartbeat as
  // a configuration error instead, so health sees it and nothing dispatches.
  if (!deps.env.githubToken && !probe) {
    const tick = parseTick(
      await deps.rpc('watchdog_tick', {
        p_probe: false,
        p_force: false,
        p_configuration_error: 'missing_github_token',
      }),
    );
    return {
      status: 503,
      body: {
        mode,
        decision: tick?.decision ?? 'configuration_error',
        errorClass: 'missing_github_token',
        dispatched: false,
      },
    };
  }

  const tick = parseTick(await deps.rpc('watchdog_tick', { p_probe: probe, p_force: force }));
  if (!tick) {
    return { status: 500, body: { error: 'tick_failed', errorClass: 'database_error' } };
  }

  const base: Record<string, unknown> = {
    mode,
    decision: tick.decision,
    staleSources: tick.staleSources,
    freshness: tick.freshness,
    dispatched: false,
  };
  if (tick.errorClass) base.errorClass = tick.errorClass;

  if (probe) {
    // A dry probe validates the GitHub side READ-ONLY and never dispatches,
    // whatever the decision came out as.
    const target = {
      repository: tick.repository ?? WATCHDOG_TARGET.repository,
      workflow: tick.workflow ?? WATCHDOG_TARGET.workflow,
    };
    const github = deps.env.githubToken
      ? await checkWorkflowExists(deps, deps.env.githubToken, target)
      : { ok: false, status: null, errorClass: 'missing_github_token' };
    return { status: 200, body: { ...base, github } };
  }

  if (tick.decision !== 'dispatch_claimed') {
    return { status: 200, body: base };
  }
  if (!tick.claimId || !tick.repository || !tick.workflow || !tick.ref) {
    return {
      status: 500,
      body: { ...base, error: 'claim_incomplete', errorClass: 'database_error' },
    };
  }

  const result = await dispatchWorkflow(deps, deps.env.githubToken as string, {
    repository: tick.repository,
    workflow: tick.workflow,
    ref: tick.ref,
  });

  // A dispatch failure is recorded, never marked successful, and the claim
  // row's failure_backoff makes it retryable on a later tick.
  const finalize = await deps.rpc('watchdog_finalize_dispatch', {
    p_claim_id: tick.claimId,
    p_accepted: result.accepted,
    p_github_status: result.status,
    p_github_run_id: result.workflowRunId,
    p_error_class: result.errorClass,
    p_attempts: result.attempts,
  });
  const finalizeRecorded = !finalize.error;
  if (!finalizeRecorded) deps.log?.('finalize failed: database_error');

  const body: Record<string, unknown> = {
    ...base,
    dispatched: true,
    accepted: result.accepted,
    attempts: result.attempts,
    finalizeRecorded,
  };
  if (result.status !== null) body.githubStatus = result.status;
  if (result.workflowRunId !== null) body.workflowRunId = result.workflowRunId;
  if (result.runUrl !== null) body.runUrl = result.runUrl;
  if (result.errorClass) body.errorClass = result.errorClass;

  return { status: result.accepted ? 200 : 502, body };
}
