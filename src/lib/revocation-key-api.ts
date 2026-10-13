/**
 * The consent-revocation RPCs the app calls (age assurance, 2026-10-13;
 * 20261017000000_consent_revocation):
 *
 * - `register_push_subscription_with_revocation_key`: a regulated 13–17
 *   user's ONLY registration. It enables the row and stores the keyed hash
 *   in one transaction, so alerts are never enabled without the mapping a
 *   parent's revocation needs. Same sequenced contract as
 *   `register_push_subscription` (push-api.ts): the same answer shape and
 *   the same error classes, so src/lib/alert-intent.ts treats both alike —
 *   a 4xx is a definite refusal (nothing committed), anything else leaves
 *   the outcome unknown.
 * - `clear_push_revocation_key`: drop a key the installation no longer
 *   needs. The server keeps a revoked row's key regardless.
 *
 * Same posture as push-api.ts: client-safe configuration only.
 */

import {
  RPC_TIMEOUT_MS,
  RpcAbortedError,
  RpcRejectedError,
  type SequencedWriteResult,
} from './push-api';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function rpc(
  fn: string,
  args: Record<string, unknown>,
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
    if (!response.ok) throw new RpcRejectedError(response.status);
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

/** The sequenced answer, read strictly: a keyed registration has no legacy shape. */
export function keyedRegistrationResult(body: unknown): SequencedWriteResult {
  if (body && typeof body === 'object') {
    const record = body as { applied?: unknown; last_sequence?: unknown };
    if (typeof record.applied === 'boolean' && typeof record.last_sequence === 'number') {
      return { applied: record.applied, lastSequence: record.last_sequence };
    }
  }
  throw new Error('Keyed registration response was not understood.');
}

export async function registerPushSubscriptionWithRevocationKey(input: {
  installationId: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  appVersion: string | null;
  sequence: number;
  appTransactionId: string;
  signal?: AbortSignal;
}): Promise<SequencedWriteResult> {
  const body = await rpc(
    'register_push_subscription_with_revocation_key',
    {
      p_installation_id: input.installationId,
      p_expo_push_token: input.expoPushToken,
      p_platform: input.platform,
      p_app_version: input.appVersion,
      p_sequence: input.sequence,
      p_app_transaction_id: input.appTransactionId,
    },
    input.signal,
  );
  return keyedRegistrationResult(body);
}

export async function clearPushRevocationKey(installationId: string): Promise<void> {
  await rpc('clear_push_revocation_key', { p_installation_id: installationId });
}
