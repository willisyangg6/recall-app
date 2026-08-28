/**
 * ingest-watchdog Edge Function — Deno adapter only. All decision, dispatch,
 * auth, and sanitization logic lives in ./core.ts (portable TypeScript,
 * tested by the Node suite in src/server/watchdog/). This file wires the
 * runtime: env, the service-role RPC transport, and Deno.serve.
 *
 * Deployed with verify_jwt = false (config.toml): Supabase Cron cannot send a
 * user JWT, so the platform check is disabled and core.ts authenticates every
 * request itself with the dedicated x-watchdog-secret header (digest-compared).
 * NOTE: this file is Deno-runtime code and is excluded from the repo's Node
 * typecheck (tsconfig.json "exclude"); core.ts IS typechecked and tested.
 *
 * Secrets read here (Edge Function secrets; never logged, never in responses):
 *   WATCHDOG_SHARED_SECRET  — cron-to-function auth
 *   GITHUB_ACTIONS_TOKEN    — fine-grained PAT, Actions: write, one repository
 * Platform-injected: SUPABASE_URL + a service key for the RPC calls.
 */

import { handleWatchdogRequest, type WatchdogDeps } from './core.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey =
    Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const deps: WatchdogDeps = {
    env: {
      sharedSecret: Deno.env.get('WATCHDOG_SHARED_SECRET'),
      githubToken: Deno.env.get('GITHUB_ACTIONS_TOKEN'),
    },
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
    fetchImpl: fetch,
    log: (line) => console.log(`[ingest-watchdog] ${line}`),
  };

  let mode = 'tick';
  try {
    const body = await req.json();
    if (body && typeof body.mode === 'string') mode = body.mode;
  } catch {
    // No/invalid JSON body — default tick mode.
  }

  const { status, body } = await handleWatchdogRequest(
    deps,
    req.headers.get('x-watchdog-secret'),
    mode,
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
});
