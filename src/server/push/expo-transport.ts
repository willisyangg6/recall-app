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
 * the AGENTS.md minimal-dependency rule. If enhanced push security is enabled
 * on the Expo account, EXPO_ACCESS_TOKEN (server env only — never the client)
 * is sent as a Bearer token.
 */

import type { PushMessage, PushReceipt, PushTicket, PushTransport } from './types';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Documented Expo request caps. The worker chunks to these. */
export const MAX_MESSAGES_PER_REQUEST = 100;
export const MAX_RECEIPT_IDS_PER_REQUEST = 1000;

export interface ExpoTransportOptions {
  /** Enhanced-push-security access token; omitted when not configured. */
  accessToken?: string;
  fetchImpl?: typeof fetch;
}

export class ExpoPushTransport implements PushTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly accessToken: string | undefined;

  constructor(options: ExpoTransportOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.accessToken = options.accessToken;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    return headers;
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (messages.length === 0) return [];
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
    if (!response.ok) {
      throw new Error(`Expo push send failed (HTTP ${response.status})`);
    }
    const payload = (await response.json()) as { data?: PushTicket[] };
    if (!Array.isArray(payload.data) || payload.data.length !== messages.length) {
      throw new Error('Expo push send returned an unexpected ticket shape');
    }
    return payload.data;
  }

  async getReceipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    if (ticketIds.length === 0) return {};
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
    if (!response.ok) {
      throw new Error(`Expo receipt fetch failed (HTTP ${response.status})`);
    }
    const payload = (await response.json()) as { data?: Record<string, PushReceipt> };
    return payload.data ?? {};
  }
}
