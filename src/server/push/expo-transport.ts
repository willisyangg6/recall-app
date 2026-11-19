/**
 * Expo Push Service HTTP transport (server-only).
 *
 * Verified against docs.expo.dev/push-notifications/sending-notifications
 * (2026-08): send accepts up to 100 messages per request at
 * https://exp.host/--/api/v2/push/send; receipts accept up to 1000 ticket ids
 * at /--/api/v2/push/getReceipts; the project-wide rate limit is 600
 * notifications/second — far above this worker's chunked, per-tick volume.
 *
 * Plain fetch instead of expo-server-sdk: the payloads are two small JSON
 * shapes, chunking is enforced by the worker, and one fewer dependency keeps
 * the AGENTS.md minimal-dependency rule. Enhanced push security is ON for the
 * Lotly Expo account (D5, 2026-10-14), so EXPO_ACCESS_TOKEN (server env only —
 * never the client) is REQUIRED: without it Expo refuses every request, so the
 * transport refuses first (`authProblem`, `ExpoAuthMissingError`) instead of
 * spending delivery attempts on requests that cannot succeed.
 *
 * Request-level failures throw `ExpoRequestError` carrying the HTTP status and
 * Expo's error code (`errors[0].code`, e.g. UNAUTHORIZED), sanitized to an
 * upper-case identifier. Expo's free-text messages are never kept: they can
 * quote push tokens.
 */

import type { PushMessage, PushReceipt, PushTicket, PushTransport, TestPushMessage } from './types';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Documented Expo request caps. The worker chunks to these. */
export const MAX_MESSAGES_PER_REQUEST = 100;
export const MAX_RECEIPT_IDS_PER_REQUEST = 1000;

export const MISSING_ACCESS_TOKEN = 'EXPO_ACCESS_TOKEN is not set (enhanced push security is on)';

/** The transport refused before any network call: no access token. */
export class ExpoAuthMissingError extends Error {
  readonly systemic = true;
  constructor() {
    super(MISSING_ACCESS_TOKEN);
    this.name = 'ExpoAuthMissingError';
  }
}

/**
 * Expo rejected the whole request (HTTP 4xx/5xx). `code` is Expo's own error
 * code when the body carried one, else null. `systemic` marks failures no
 * retry of the same request can fix — authentication (401/403,
 * UNAUTHORIZED) — so the worker stops sending for the rest of the run.
 */
export class ExpoRequestError extends Error {
  readonly systemic: boolean;
  constructor(
    readonly operation: 'send' | 'receipts',
    readonly status: number,
    readonly code: string | null,
  ) {
    super(
      `Expo push ${operation === 'send' ? 'send' : 'receipt fetch'} failed ` +
        `(HTTP ${status}${code ? ` ${code}` : ''})`,
    );
    this.name = 'ExpoRequestError';
    this.systemic = status === 401 || status === 403 || code === 'UNAUTHORIZED';
  }

  /** The delivery row's failure code: Expo's code, else the HTTP status. */
  get failureCode(): string {
    return this.code ?? `http_${this.status}`;
  }
}

const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Expo's request-level error code from a response body, or null. Never its message. */
export function sanitizedProviderCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const code = (errors[0] as { code?: unknown } | null)?.code;
  return typeof code === 'string' && PROVIDER_CODE.test(code) ? code : null;
}

const PUSH_TOKEN = /Expo(?:nent)?PushToken\[[^\]]*\]/g;

/** A provider message with every push token replaced — safe to store or log. */
export function redactPushTokens(message: string): string {
  return message.replace(PUSH_TOKEN, 'ExpoPushToken[redacted]');
}

async function failure(
  operation: 'send' | 'receipts',
  response: Response,
): Promise<ExpoRequestError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (a proxy page, an empty body): the status alone is recorded.
  }
  return new ExpoRequestError(operation, response.status, sanitizedProviderCode(body));
}

export interface ExpoTransportOptions {
  /** Enhanced-push-security access token. Required: blank or absent refuses every call. */
  accessToken?: string;
  fetchImpl?: typeof fetch;
}

export class ExpoPushTransport implements PushTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly accessToken: string | undefined;

  constructor(options: ExpoTransportOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    const token = options.accessToken?.trim();
    this.accessToken = token ? token : undefined;
  }

  authProblem(): string | null {
    return this.accessToken ? null : MISSING_ACCESS_TOKEN;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    headers.authorization = `Bearer ${this.accessToken ?? ''}`;
    return headers;
  }

  /** The worker's messages, or push:test's (TestPushMessage) — the same HTTP call. */
  async send(messages: readonly (PushMessage | TestPushMessage)[]): Promise<PushTicket[]> {
    if (messages.length === 0) return [];
    if (!this.accessToken) throw new ExpoAuthMissingError();
    if (messages.length > MAX_MESSAGES_PER_REQUEST) {
      throw new Error(
        `push send chunk too large: ${messages.length} > ${MAX_MESSAGES_PER_REQUEST}`,
      );
    }
    const response = await this.fetchImpl(SEND_URL, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(messages),
    });
    if (!response.ok) throw await failure('send', response);
    const payload = (await response.json()) as { data?: PushTicket[] };
    if (!Array.isArray(payload.data) || payload.data.length !== messages.length) {
      throw new Error('Expo push send returned an unexpected ticket shape');
    }
    return payload.data;
  }

  async getReceipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    if (ticketIds.length === 0) return {};
    if (!this.accessToken) throw new ExpoAuthMissingError();
    if (ticketIds.length > MAX_RECEIPT_IDS_PER_REQUEST) {
      throw new Error(
        `receipt request too large: ${ticketIds.length} > ${MAX_RECEIPT_IDS_PER_REQUEST}`,
      );
    }
    const response = await this.fetchImpl(RECEIPTS_URL, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ids: ticketIds }),
    });
    if (!response.ok) throw await failure('receipts', response);
    const payload = (await response.json()) as { data?: Record<string, PushReceipt> };
    return payload.data ?? {};
  }
}
