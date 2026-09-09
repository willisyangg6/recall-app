/**
 * One bounded retry primitive for idempotent READS, shared by every server
 * read path that can meet a transient infrastructure fault.
 *
 * Extracted from the O3-B3A audit policy (applied-state-reconcile.ts) after the
 * 2026-09-08/09 incident, in which four distinct faults each killed a whole
 * scheduled run that a sub-second retry would have absorbed:
 *
 *   1. PG 57014 statement timeout on the enforcement case-page read;
 *   2. a Cloudflare HTML `502 Bad Gateway` page returned instead of PostgREST
 *      JSON, surfaced as `SupabaseStore.getLatestSnapshotMeta failed: <html>…`;
 *   3. a persistent upstream FDA 404 (the documented bot-gate behaviour);
 *   4. an HTML body delivered under HTTP 200, which crashed `response.json()`
 *      as a raw, unclassified `SyntaxError: Unexpected token '<'`.
 *
 * The scheduler watchdog recovered each about twenty minutes later. That is
 * recovery, not hardening: the run still failed, and nothing retried.
 *
 * ── THE MUTATION RULE ──────────────────────────────────────────────────────
 * Nothing in this module may ever wrap a mutation. A retried write is a
 * duplicate write attempt whose first try may well have committed before the
 * response was lost; idempotence is NOT permission to retry automatically.
 * Callers enforce this structurally — see store/read-retry.ts, whose allowlist
 * is asserted disjoint from every mutating store method.
 *
 * ── CLASSIFICATION ORDER (deliberate) ──────────────────────────────────────
 * Permanent faults are matched FIRST and win. A genuine defect — a permission
 * error, a missing column, a constraint violation — must surface on the first
 * attempt, never be masked by retries, and never be slowed by backoff. Only
 * what is left is tested for transience. Anything unrecognized is permanent:
 * retrying is the privileged case and has to be earned.
 */

/** Faults worth a second attempt. */
export type TransientErrorClass =
  | 'transport'
  | 'gateway'
  | 'rate_limited'
  | 'statement_timeout'
  | 'invalid_source_response'
  | 'connection';

/** Faults that a retry can only delay. */
export type PermanentErrorClass =
  'auth' | 'schema' | 'validation' | 'client_error' | 'source_unavailable' | 'unclassified';

export type ErrorClassification =
  | { retryable: true; errorClass: TransientErrorClass; minDelayMs?: number }
  | { retryable: false; errorClass: PermanentErrorClass };

/**
 * What classification can read. supabase-js rejects with a PostgrestError
 * carrying `code`; SupabaseStore re-throws it as a StoreReadError preserving
 * that code, so the PG SQLSTATE is classified exactly rather than by prose.
 */
interface ErrorFacts {
  message: string;
  code: string | null;
  status: number | null;
  /** Server-advertised Retry-After, already in ms. Bounded by the policy cap. */
  retryAfterMs: number | null;
}

function factsOf(error: unknown): ErrorFacts {
  const bag = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>;
  const rawCode = bag.code;
  const rawStatus = bag.status ?? bag.statusCode;
  const rawRetryAfter = bag.retryAfterMs;
  return {
    message: (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' '),
    code: typeof rawCode === 'string' && rawCode.length > 0 ? rawCode : null,
    status: typeof rawStatus === 'number' ? rawStatus : null,
    retryAfterMs:
      typeof rawRetryAfter === 'number' && Number.isFinite(rawRetryAfter) && rawRetryAfter > 0
        ? rawRetryAfter
        : null,
  };
}

// ── PostgreSQL SQLSTATE, matched on the code itself, never on prose ─────────

/** Retryable on a READ only; this module never wraps a write. */
const TRANSIENT_SQLSTATE = new Set([
  '57014', // query_canceled — statement_timeout
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

/** SQLSTATE class prefixes that are defects, not weather. */
const PERMANENT_SQLSTATE_PREFIX: readonly [string, PermanentErrorClass][] = [
  ['28', 'auth'], // invalid_authorization_specification
  ['42', 'schema'], // syntax error / undefined object / insufficient_privilege
  ['3F', 'schema'], // invalid_schema_name
  ['23', 'validation'], // integrity_constraint_violation
  ['22', 'validation'], // data_exception
  ['0L', 'auth'], // invalid_grantor
  ['2F', 'validation'], // sql_routine_exception
];

// ── HTTP status ────────────────────────────────────────────────────────────

const TRANSIENT_STATUS = new Set([408, 425, 429, 502, 503, 504, 521, 522, 523, 524, 525]);
/**
 * Ordinary non-transient 4xx: a wrong request does not become right.
 *
 * 403 and 404 are here deliberately. For a DATABASE read they mean a missing
 * route or a denied policy — defects that must surface at once, not after four
 * attempts of backoff. The one place they are plausibly transient is
 * www.fda.gov, which has historically served them to non-browser clients
 * (source contract §3.1); fda/fetch.ts classifies its own bot-gate statuses
 * locally rather than loosening the rule for every read in the system.
 */
const PERMANENT_STATUS = new Set([400, 401, 403, 404, 405, 406, 409, 410, 413, 414, 415, 422, 431]);

// ── Message patterns, used only when there is no code or status ─────────────

/**
 * Auth prose must name an auth FAILURE, never merely an auth concept. An
 * earlier draft matched a bare `api ?key`, which matched the string `apikey=`
 * inside an error's echoed payload and mis-classified a genuine
 * `TypeError: fetch failed` as permanent. Patterns here stay verb-anchored.
 */
const AUTH_TEXT =
  /\bjwt (?:expired|malformed|invalid|missing)|(?:invalid|expired|missing|no|bad) (?:\w+ ){0,2}(?:api ?key|bearer token|jwt|signature)|api ?key (?:not found|is invalid|required|missing)|permission denied for|insufficient.privilege|not authori[sz]ed to|unauthori[sz]ed\b|violates row.level security/i;
const SCHEMA_TEXT =
  /does not exist|unknown column|undefined (?:column|table|function|object)|schema cache|could not find the|no such (?:column|table|function)|relation .* missing/i;
const VALIDATION_TEXT =
  /violates (?:unique|foreign key|check|not.null)|duplicate key|invalid input syntax|invalid input value|out of range|malformed|failed to parse filter/i;
const TRANSPORT_TEXT =
  /fetch failed|network|socket hang ?up|connection (?:closed|reset|refused|terminated)|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EPIPE|EAI_AGAIN|UND_ERR|aborted|other side closed/i;
const GATEWAY_TEXT = /bad gateway|gateway time-?out|service unavailable|\b(?:502|503|504)\b/i;
const TIMEOUT_TEXT = /statement timeout|canceling statement|query.canceled|timed? ?out/i;
const RATE_LIMIT_TEXT = /\b429\b|rate.?limit|too many requests/i;
/** A proxy error page where PostgREST JSON was required. */
const HTML_BODY_TEXT = /<\s*(?:!doctype|html|head|body|title|center)\b|<\/\s*html\s*>/i;

/**
 * A source returned something that is not the documented payload — HTML under
 * HTTP 200, an empty body, truncated JSON. Always transient-classified: a
 * gateway or edge cache produced it, the parser did not change.
 */
export class InvalidSourceResponseError extends Error {
  constructor(
    readonly detail: string,
    readonly contentType: string | null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`invalid source response: ${detail}`);
    this.name = 'InvalidSourceResponseError';
  }
}

/**
 * Classify a failed read. Permanent wins over transient at every level, and
 * an unrecognized fault is permanent.
 */
export function classifyReadError(error: unknown): ErrorClassification {
  // A source-shape rejection is transient by construction — a gateway or edge
  // cache produced it. Checked first so its own detail text can never be
  // mistaken for an application-level defect.
  if (error instanceof InvalidSourceResponseError) {
    return {
      retryable: true,
      errorClass: 'invalid_source_response',
      ...(error.retryAfterMs !== null ? { minDelayMs: error.retryAfterMs } : {}),
    };
  }

  const { message, code, status, retryAfterMs } = factsOf(error);
  /** Attach the server's own Retry-After, when it gave one. */
  const transient = (errorClass: TransientErrorClass): ErrorClassification => ({
    retryable: true,
    errorClass,
    ...(retryAfterMs !== null ? { minDelayMs: retryAfterMs } : {}),
  });

  // ── 1. Explicit codes: the most reliable signal available ────────────────
  if (code) {
    const upper = code.toUpperCase();
    for (const [prefix, errorClass] of PERMANENT_SQLSTATE_PREFIX) {
      if (upper.startsWith(prefix)) return { retryable: false, errorClass };
    }
    // PostgREST's own PGRSTxxx codes are request/schema defects.
    if (upper.startsWith('PGRST')) return { retryable: false, errorClass: 'schema' };
    if (TRANSIENT_SQLSTATE.has(upper)) {
      return transient(upper === '57014' ? 'statement_timeout' : 'connection');
    }
  }

  // ── 2. HTTP status ──────────────────────────────────────────────────────
  if (status !== null) {
    if (PERMANENT_STATUS.has(status)) return { retryable: false, errorClass: 'client_error' };
    if (status === 429) return transient('rate_limited');
    if (TRANSIENT_STATUS.has(status)) return transient('gateway');
  }

  // ── 3. Unambiguous infrastructure facts ─────────────────────────────────
  // A transport rejection ("fetch failed", ECONNRESET) or an HTML proxy page is
  // a fact about the connection, not a statement about the request — so it
  // outranks the prose heuristics below, which can match incidental words
  // inside an error that echoes a query or payload.
  const htmlProxyPage = HTML_BODY_TEXT.test(message);
  if (TRANSPORT_TEXT.test(message)) return transient('transport');
  if (htmlProxyPage) return transient('gateway');

  // ── 4. Prose heuristics, permanent first ────────────────────────────────
  if (AUTH_TEXT.test(message)) return { retryable: false, errorClass: 'auth' };
  if (SCHEMA_TEXT.test(message)) return { retryable: false, errorClass: 'schema' };
  if (VALIDATION_TEXT.test(message)) return { retryable: false, errorClass: 'validation' };

  // ── 5. Remaining transient prose ────────────────────────────────────────
  if (RATE_LIMIT_TEXT.test(message)) return transient('rate_limited');
  if (GATEWAY_TEXT.test(message)) return transient('gateway');
  if (TIMEOUT_TEXT.test(message)) return transient('statement_timeout');

  // ── 6. Unrecognized ⇒ permanent. Retrying is the privileged case. ───────
  return { retryable: false, errorClass: 'unclassified' };
}

/** Retries exhausted. Carries the bounded final diagnostic, never a payload. */
export class ReadRetryExhaustedError extends Error {
  constructor(
    readonly operation: string,
    readonly attempts: number,
    readonly errorClass: TransientErrorClass,
    cause: unknown,
  ) {
    super(
      `read '${operation}' still failing after ${attempts} attempt(s) [${errorClass}]: ${clipDiagnostic(cause)}`,
    );
    this.name = 'ReadRetryExhaustedError';
  }
}

const DIAGNOSTIC_LIMIT = 200;

/**
 * The only text any retry diagnostic may contain: whitespace-collapsed, hard
 * length-capped, with query strings and HTML markup stripped. Credentials ride
 * in headers and URL query parameters, and payloads ride in response bodies;
 * neither may reach a log line.
 */
export function clipDiagnostic(error: unknown): string {
  let message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ');
  // Drop any query string (apikey=…, token=…) while keeping the host/path.
  message = message.replace(/\?[^\s"'<>]*/g, '?…');
  // Collapse markup to a shape label: an HTML error page must not be logged.
  if (HTML_BODY_TEXT.test(message)) {
    const title = /<title>\s*([^<]{0,60})/i.exec(message)?.[1]?.trim();
    message = message
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    message = `HTML response${title ? ` (${title})` : ''}`;
  }
  return message.length > DIAGNOSTIC_LIMIT ? `${message.slice(0, DIAGNOSTIC_LIMIT)}…` : message;
}

export interface RetryPolicy {
  /** Total attempts, including the first. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Floor for 429-class waits — the Retry-After substitute. */
  rateLimitMinDelayMs: number;
}

/**
 * 4 attempts, 500ms·2ⁿ capped at 5s: worst case 500+1000+2000 ≈ 3.5s of delay
 * (≤4.4s with jitter) per read, or ~6s when every wait hits the rate-limit
 * floor. An order of magnitude below both the job lease TTL and the workflow
 * budget, while absorbing the sustained 30–60s edge blips seen in production.
 */
export const DEFAULT_READ_RETRY_POLICY: RetryPolicy = {
  attempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  rateLimitMinDelayMs: 2000,
};

export interface RetryHooks {
  /** Injectable so tests cross every backoff boundary without real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable so jittered delays are deterministic under test. */
  jitter?: () => number;
  warn?: (line: string) => void;
  classify?: (error: unknown) => ErrorClassification;
  /** Wrap the exhaustion error, for callers with their own failure type. */
  onExhausted?: (operation: string, attempts: number, cause: unknown) => Error;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function retryDelayMs(
  attempt: number,
  classification: ErrorClassification,
  policy: RetryPolicy,
  jitter: number,
): number {
  let delay = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  if (classification.retryable) {
    if (classification.errorClass === 'rate_limited') {
      delay = Math.max(delay, policy.rateLimitMinDelayMs);
    }
    if (classification.minDelayMs !== undefined) {
      delay = Math.min(Math.max(delay, classification.minDelayMs), policy.maxDelayMs);
    }
  }
  return Math.round(delay * (0.75 + 0.5 * jitter));
}

/**
 * Run one idempotent read under the bounded policy.
 *
 * NEVER call this with a mutation. `fn` may be invoked up to `policy.attempts`
 * times.
 */
export async function retryTransientRead<T>(
  operation: string,
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_READ_RETRY_POLICY,
  hooks: RetryHooks = {},
): Promise<T> {
  const sleep = hooks.sleep ?? realSleep;
  const jitter = hooks.jitter ?? Math.random;
  const classify = hooks.classify ?? classifyReadError;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const classification = classify(error);
      if (!classification.retryable) throw error;
      if (attempt >= policy.attempts) {
        throw hooks.onExhausted
          ? hooks.onExhausted(operation, policy.attempts, error)
          : new ReadRetryExhaustedError(
              operation,
              policy.attempts,
              classification.errorClass,
              error,
            );
      }
      const delay = retryDelayMs(attempt, classification, policy, jitter());
      hooks.warn?.(
        `  read retry: ${operation} attempt ${attempt + 1}/${policy.attempts} in ${delay}ms ` +
          `[${classification.errorClass}] (${clipDiagnostic(error)})`,
      );
      await sleep(delay);
    }
  }
}
