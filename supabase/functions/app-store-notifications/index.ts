/**
 * app-store-notifications Edge Function — Deno adapter only. All decision
 * logic lives in ./core.ts (portable, Node-tested in
 * src/server/app-store-notifications/). This file wires Apple's official
 * verifier, the service-role RPC transport and Deno.serve.
 *
 * Deployed with verify_jwt = false (config.toml): RevenueCat's forwarder
 * and Apple cannot send a Supabase JWT. Authentication is Apple's own
 * signature, checked in full by ./apple-jws.ts before anything is read.
 * (Apple's npm library cannot run here: the Edge Runtime lacks the
 * X509Certificate methods it needs — see apple-jws.ts.)
 * NOTE: Deno-runtime code, excluded from the repo's Node typecheck
 * (tsconfig.json "exclude"); core.ts IS typechecked and tested.
 *
 * Configuration (Edge Function secrets; none is a credential):
 *   APP_STORE_BUNDLE_ID      com.willisyang.lotly
 *   APP_STORE_APP_APPLE_ID   the app's numeric Apple ID (App Store Connect →
 *                            App Information). Required to accept Production;
 *                            without it only Sandbox is accepted.
 *   APP_STORE_ENVIRONMENTS   comma list, default "Sandbox,Production"
 * Platform-injected: SUPABASE_URL + a service key for the RPC call.
 */

import { APPLE_ROOT_CA_G3_BASE64 } from './apple-root-certificates.ts';
import { createAppleVerifier } from './apple-jws.ts';
import {
  handleAppStoreNotification,
  type AppStoreEnvironment,
  type AppStoreNotificationDeps,
  type NotificationVerifier,
} from './core.ts';

const bundleId = Deno.env.get('APP_STORE_BUNDLE_ID') ?? 'com.willisyang.lotly';
const appAppleId = Number(Deno.env.get('APP_STORE_APP_APPLE_ID') ?? '') || undefined;
const accepted = (Deno.env.get('APP_STORE_ENVIRONMENTS') ?? 'Sandbox,Production')
  .split(',')
  .map((value) => value.trim());
const roots = [Uint8Array.from(atob(APPLE_ROOT_CA_G3_BASE64), (c) => c.charCodeAt(0))];

const verifiers: Partial<Record<AppStoreEnvironment, NotificationVerifier>> = {};
if (accepted.includes('Sandbox')) {
  verifiers.Sandbox = createAppleVerifier({ roots, environment: 'Sandbox', bundleId });
}
if (accepted.includes('Production') && appAppleId !== undefined) {
  verifiers.Production = createAppleVerifier({
    roots,
    environment: 'Production',
    bundleId,
    appAppleId,
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey =
    Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const deps: AppStoreNotificationDeps = {
    verifiers,
    rpc: async (fn, args) => {
      if (!supabaseUrl || !serviceKey) return { data: null, error: 'missing supabase env' };
      try {
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return { data: null, error: `rpc ${fn}: http ${response.status}` };
        return { data: await response.json().catch(() => null), error: null };
      } catch {
        return { data: null, error: `rpc ${fn}: network failure` };
      }
    },
    log: (line) => console.log(`[app-store-notifications] ${line}`),
  };

  const result = await handleAppStoreNotification(
    { method: req.method, body: req.method === 'POST' ? await req.text() : '' },
    deps,
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
});
