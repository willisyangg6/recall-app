/**
 * The app's ONLY backend write path: narrowly scoped SECURITY DEFINER RPCs
 * (see the push_delivery and installation_preferences migrations).
 * Client-safe configuration only (EXPO_PUBLIC_* + publishable key); the
 * client can register/disable its own opaque subscription, set its own
 * preferences, and delete its own installation's data (C7.1), and nothing
 * else — tokens and other installations' rows are never readable through
 * this key.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * How long one write may wait for the server (2026-10-04). A stalled
 * request used to hold the installation mutation queue open indefinitely —
 * every later save waited behind it, and the notification education's
 * registration had no way out. Past this bound the write throws like any
 * other failure and the caller's retry (the dirty flag, the Notifications
 * screen) takes over.
 */
export const RPC_TIMEOUT_MS = 15_000;

/** The error a caller's own cancellation produces; never retried, never shown. */
export class RpcAbortedError extends Error {
  constructor() {
    super('Request cancelled.');
    this.name = 'RpcAbortedError';
  }
}

/**
 * The server answered and REFUSED the write (a 4xx: the function raised, so
 * its transaction rolled back). The one failure whose outcome is certain —
 * nothing was committed. Every other failure (an abort, the timeout, a
 * network error, a 5xx from a gateway that may have cut a committed
 * transaction's reply) leaves the outcome unknown, and src/lib/alert-intent.ts
 * follows an unknown registration with a disable that outranks it.
 */
export class RpcRejectedError extends Error {
  constructor(readonly status: number) {
    super(`Alert registration failed (HTTP ${status}).`);
    this.name = 'RpcRejectedError';
  }
}

/** True when the server certainly did not commit the write. */
export function isDefiniteRejection(error: unknown): boolean {
  return error instanceof RpcRejectedError && error.status >= 400 && error.status < 500;
}

async function rpcPost(
  fn: string,
  args: Record<string, unknown>,
  /**
   * A caller's cancellation (2026-10-04): the notification education bounds
   * its registration and aborts it on `Continue without alerts`, so a slow
   * write can neither hold the shopper nor land late. Composed with the
   * timeout below; an aborted request throws `RpcAbortedError`.
   */
  signal?: AbortSignal,
): Promise<unknown> {
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Recall backend is not configured.');
  }
  if (signal?.aborted) throw new RpcAbortedError();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), RPC_TIMEOUT_MS);
  const onCallerAbort = () => abort.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: abort.signal,
    });
    if (!response.ok) {
      throw new RpcRejectedError(response.status);
    }
    // The body is the function's return value: JSON, or empty for `void`.
    const text = await response.text();
    return text.length === 0 ? null : (JSON.parse(text) as unknown);
  } catch (error) {
    if (signal?.aborted) throw new RpcAbortedError();
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * What the two sequenced subscription RPCs answer (the
 * push_subscription_sequence migration): whether the write applied, and the
 * sequence the server now holds for the installation — higher than the one
 * sent when the write was outranked, which lets a client whose persisted
 * counter was lost adopt the server's count (src/lib/alert-intent.ts).
 */
export interface SequencedWriteResult {
  applied: boolean;
  lastSequence: number;
}

function sequencedResult(body: unknown, sent: number | undefined): SequencedWriteResult {
  if (body && typeof body === 'object') {
    const record = body as { applied?: unknown; last_sequence?: unknown };
    if (typeof record.applied === 'boolean' && typeof record.last_sequence === 'number') {
      return { applied: record.applied, lastSequence: record.last_sequence };
    }
  }
  // A server without the gate (void): the write applied as it always did.
  return { applied: true, lastSequence: sent ?? 0 };
}

export async function registerPushSubscription(input: {
  installationId: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  appVersion: string | null;
  /**
   * The installation's write sequence (2026-10-04, push_subscription_sequence
   * migration): the server refuses a registration that a later write has
   * already outranked. Omitted only by code paths that predate it.
   */
  sequence?: number;
  /** The caller's cancellation; see `rpcPost`. */
  signal?: AbortSignal;
}): Promise<SequencedWriteResult> {
  const body = await rpcPost(
    'register_push_subscription',
    {
      p_installation_id: input.installationId,
      p_expo_push_token: input.expoPushToken,
      p_platform: input.platform,
      p_app_version: input.appVersion,
      ...(input.sequence === undefined ? {} : { p_sequence: input.sequence }),
    },
    input.signal,
  );
  return sequencedResult(body, input.sequence);
}

export async function disablePushSubscription(
  installationId: string,
  /** The installation's write sequence; see `registerPushSubscription`. */
  sequence?: number,
): Promise<SequencedWriteResult> {
  const body = await rpcPost('disable_push_subscription', {
    p_installation_id: installationId,
    ...(sequence === undefined ? {} : { p_sequence: sequence }),
  });
  return sequencedResult(body, sequence);
}

/**
 * Sync this installation's preferences to the server (push eligibility input).
 * The RPC is a strict no-op when the values are unchanged, so retries and
 * app-launch re-syncs never move the server-side preference horizon.
 */
export async function setInstallationPreferences(input: {
  installationId: string;
  /** Every chosen jurisdiction; empty = no location preference (P2B7U). */
  stateCodes: readonly string[];
  allergens: string[];
  retailerIds: string[];
}): Promise<void> {
  await rpcPost('set_installation_preferences', {
    p_installation_id: input.installationId,
    p_state_codes: [...input.stateCodes],
    p_allergens: input.allergens,
    p_retailer_ids: input.retailerIds,
  });
}

/**
 * Delete every server row keyed by this installation id (C7.1): its
 * preference mirror, its push registrations, and their delivery records —
 * one atomic, idempotent transaction on the backend. Returns nothing and
 * reveals nothing about whether the installation existed.
 */
export async function deleteInstallationData(installationId: string): Promise<void> {
  await rpcPost('delete_installation_data', { p_installation_id: installationId });
}
