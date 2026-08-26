/**
 * The app's ONLY backend write path: push-subscription registration via two
 * narrowly scoped SECURITY DEFINER RPCs (see the push_delivery migration).
 * Client-safe configuration only (EXPO_PUBLIC_* + publishable key); the
 * client can register or disable its own opaque subscription and nothing
 * else — tokens are never readable through this key.
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
