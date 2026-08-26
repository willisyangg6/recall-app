/**
 * The app's ONLY backend write path: narrowly scoped SECURITY DEFINER RPCs
 * (see the push_delivery and installation_preferences migrations).
 * Client-safe configuration only (EXPO_PUBLIC_* + publishable key); the
 * client can register/disable its own opaque subscription and set its own
 * preferences, and nothing else — tokens and other installations' rows are
 * never readable through this key.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function rpcPost(fn: string, args: Record<string, unknown>): Promise<void> {
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Recall backend is not configured.');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error(`Alert registration failed (HTTP ${response.status}).`);
  }
}

export async function registerPushSubscription(input: {
  installationId: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  appVersion: string | null;
}): Promise<void> {
  await rpcPost('register_push_subscription', {
    p_installation_id: input.installationId,
    p_expo_push_token: input.expoPushToken,
    p_platform: input.platform,
    p_app_version: input.appVersion,
  });
}

export async function disablePushSubscription(installationId: string): Promise<void> {
  await rpcPost('disable_push_subscription', { p_installation_id: installationId });
}

/**
 * Sync this installation's preferences to the server (push eligibility input).
 * The RPC is a strict no-op when the values are unchanged, so retries and
 * app-launch re-syncs never move the server-side preference horizon.
 */
export async function setInstallationPreferences(input: {
  installationId: string;
  stateCode: string | null;
  allergens: string[];
  retailerIds: string[];
}): Promise<void> {
  await rpcPost('set_installation_preferences', {
    p_installation_id: input.installationId,
    p_state_code: input.stateCode,
    p_allergens: input.allergens,
    p_retailer_ids: input.retailerIds,
  });
}
