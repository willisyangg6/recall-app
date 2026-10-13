/**
 * The consent-revocation key write (age assurance, 2026-10-13): one narrowly
 * scoped SECURITY DEFINER RPC, `set_push_revocation_key`, that sets or
 * clears the keyed hash on this installation's existing alert subscription.
 * Same posture as push-api.ts: client-safe configuration only.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function setPushRevocationKey(
  installationId: string,
  appTransactionId: string | null,
): Promise<void> {
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Recall backend is not configured.');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/set_push_revocation_key`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_installation_id: installationId,
      p_app_transaction_id: appTransactionId,
    }),
  });
  if (!response.ok) {
    throw new Error(`Revocation key request failed (HTTP ${response.status}).`);
  }
}
