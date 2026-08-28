/**
 * Scheduler-watchdog probe — verifies the deployed Edge Function end to end
 * WITHOUT dispatching ingestion:
 *
 *   npm run scheduler:probe                # dry probe, never dispatches
 *   npm run scheduler:probe -- --dispatch  # founder-only controlled dispatch
 *
 * The dry probe validates, in one authenticated round trip:
 *   - function reachability (deployed at all? 404 = pre-activation)
 *   - shared-secret authentication (401 = wrong/missing secret)
 *   - the atomic claim logic (the function runs watchdog_tick in probe mode:
 *     the decision is computed and recorded, but NO claim row is inserted)
 *   - GitHub credential + workflow/ref existence (the function GETs the
 *     workflow; it never POSTs a dispatch in probe mode)
 *
 * `--dispatch` is the controlled end-to-end verification (activation step 8):
 * it asks the function for mode force-dispatch, which bypasses ONLY the
 * freshness check — the atomic claim, running-ingest and cooldown guards all
 * still apply — and then REALLY starts the production ingest workflow once.
 *
 * Requires SUPABASE_URL (the function URL is derived from it) and
 * WATCHDOG_SHARED_SECRET in .env. Prints no secrets.
 */

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const dispatch = process.argv.includes('--dispatch');
  const url = process.env.SUPABASE_URL;
  const secret = process.env.WATCHDOG_SHARED_SECRET;
  if (!url) {
    console.error('Missing SUPABASE_URL.');
    process.exit(1);
  }
  const functionUrl = `${url.replace(/\/$/, '')}/functions/v1/ingest-watchdog`;

  if (dispatch) {
    console.log('\n*** CONTROLLED DISPATCH ***');
    console.log('This will REALLY start the production scheduled-ingest workflow on GitHub');
    console.log('(one run; the running-ingest and cooldown guards still apply).');
    console.log('Use only as activation step 8 of docs/recall-scheduler-watchdog.md.\n');
  }

  if (!secret) {
    // Pre-activation: no local shared secret yet. Still check reachability —
    // an unauthenticated request distinguishes "not deployed" (404) from
    // "deployed and enforcing auth" (401) without touching anything.
    console.log('WATCHDOG_SHARED_SECRET is not set — pre-activation probe (reachability only).');
    if (dispatch) {
      console.error('--dispatch requires WATCHDOG_SHARED_SECRET. Aborting.');
      process.exit(1);
    }
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'probe' }),
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => {
      console.error(`Function unreachable: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
    if (response.status === 404) {
      console.log('Function NOT DEPLOYED (404) — pre-activation state. Nothing dispatched.');
      return;
    }
    if (response.status === 401 || response.status === 403) {
      console.log(
        `Function deployed and rejecting unauthenticated calls (${response.status}) — as designed.`,
      );
      console.log('Set WATCHDOG_SHARED_SECRET in .env to run the full probe.');
      return;
    }
    console.error(`Unexpected status ${response.status} for an unauthenticated call.`);
    process.exit(1);
  }

  const mode = dispatch ? 'force-dispatch' : 'probe';
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-watchdog-secret': secret },
    body: JSON.stringify({ mode }),
    signal: AbortSignal.timeout(30_000),
  }).catch((error: unknown) => {
    console.error(`Function unreachable: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });

  if (response.status === 404) {
    console.log('Function NOT DEPLOYED (404) — pre-activation state. Nothing dispatched.');
    return;
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  console.log(`HTTP ${response.status}`);
  console.log(JSON.stringify(body, null, 2));

  if (response.status === 401) {
    console.error('\nAuthentication REJECTED — the local WATCHDOG_SHARED_SECRET does not match.');
    process.exit(1);
  }
  if (!response.ok) {
    console.error('\nProbe FAILED — see the response above and npm run scheduler:status.');
    process.exit(1);
  }

  if (!dispatch) {
    const github = body?.github as { ok?: boolean; errorClass?: string } | undefined;
    console.log(
      `\nDry probe OK: auth accepted, decision ${String(body?.decision)}, ` +
        `GitHub workflow check ${github?.ok ? 'OK' : `FAILED (${github?.errorClass ?? 'unknown'})`}. ` +
        'Nothing was dispatched.',
    );
    if (github && !github.ok) process.exit(1);
    return;
  }
  console.log(
    body?.accepted
      ? `\nControlled dispatch ACCEPTED (github ${String(body.githubStatus)}` +
          `${body.workflowRunId ? `, run ${String(body.workflowRunId)}` : ''}). ` +
          'Verify the run in GitHub Actions, then npm run ops:health.'
      : `\nControlled dispatch DID NOT START A RUN (decision ${String(body?.decision)}` +
          `${body?.errorClass ? `, ${String(body.errorClass)}` : ''}).`,
  );
}

main().catch((error) => {
  console.error('Probe failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
