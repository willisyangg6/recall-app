/**
 * Dead-man heartbeat sender (P2B7S):
 *
 *   npm run ops:heartbeat
 *
 * Runs as the LAST step of scheduled-ingest.yml. Re-reads ingestion
 * freshness from `ingest_runs` and pings the configured external monitor
 * only when both required agency channels satisfy the SLO. The decision
 * lives in src/server/watchdog/heartbeat.ts so it can be tested; this script
 * is I/O.
 *
 * This is the ONLY consumer of agency freshness in the product. Shoppers
 * never see ingestion freshness anywhere in the app, so there is no
 * consumer-facing view, no migration, and no public surface in this path —
 * just the service-role read this step already has the credentials for.
 *
 * ## Properties this file is responsible for
 *
 *   Never fails the workflow.  Every path exits 0. The heartbeat runs after
 *     ingestion has already committed, so failing here could not roll
 *     anything back, but a red workflow for a monitoring hiccup trains the
 *     founder to ignore red workflows — and the withheld ping is already
 *     the alarm. Exiting non-zero would be a second, noisier channel for
 *     something the designed channel already covers.
 *   Never prints a URL.  A heartbeat URL is a credential: anyone holding it
 *     can forge a healthy ping and silence the alarm permanently. Every log
 *     line goes through `redactUrls`, including thrown fetch errors, which
 *     routinely embed the request URL.
 *   Never writes.  It issues two SELECTs against `ingest_runs` and one
 *     POST. It touches no table, no lease, and no run row.
 *   Honest when unconfigured.  With no HEARTBEAT_URL it says so in as many
 *     words and exits 0. It never reports success for a monitor that does
 *     not exist.
 *
 * Requires SUPABASE_URL / SUPABASE_SECRET_KEY (server-only, step-scoped in
 * the workflow) and, optionally, HEARTBEAT_URL / HEARTBEAT_FDA_URL /
 * HEARTBEAT_FSIS_URL.
 */

import { createClient } from '@supabase/supabase-js';

import {
  AGENCY_JOB_NAME,
  AGENCY_LOOKBACK_DAYS,
  HEARTBEAT_MAX_ATTEMPTS,
  HEARTBEAT_RETRY_DELAY_MS,
  HEARTBEAT_SLO_MINUTES,
  HEARTBEAT_TIMEOUT_MS,
  planHeartbeat,
  redactUrls,
  type HeartbeatConfig,
  type HeartbeatFreshness,
} from '../src/server/watchdog/heartbeat';

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

/** A secret that is set but empty is unconfigured, not a valid endpoint. */
function readUrl(name: string): string | null {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

function log(line: string): void {
  console.log(redactUrls(line));
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A read that failed, kept distinct from a read that legitimately found no
 * run. `null` means "this channel has not succeeded inside the lookback",
 * which is a real breach; FAILED means "we do not know", which must also
 * withhold the ping but for a different, logged reason.
 */
const FAILED = Symbol('freshness-read-failed');

/**
 * One bounded POST. Resolves true on any 2xx, false otherwise; never throws.
 *
 * A 4xx is not retried: a wrong or revoked URL will be just as wrong on the
 * third attempt, and retrying it only delays the workflow. Transport errors
 * and 5xx are retried, because those are the transient ones.
 */
async function ping(url: string): Promise<boolean> {
  for (let attempt = 1; attempt <= HEARTBEAT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
      });
      if (response.ok) return true;
      if (response.status >= 400 && response.status < 500) {
        log(`  heartbeat endpoint refused the ping (HTTP ${response.status}); not retrying`);
        return false;
      }
      log(`  attempt ${attempt}/${HEARTBEAT_MAX_ATTEMPTS} failed (HTTP ${response.status})`);
    } catch (error) {
      // Fetch errors commonly embed the request URL. Redacted, always.
      const message = error instanceof Error ? error.message : String(error);
      log(`  attempt ${attempt}/${HEARTBEAT_MAX_ATTEMPTS} failed: ${redactUrls(message)}`);
    }
    if (attempt < HEARTBEAT_MAX_ATTEMPTS) await delay(HEARTBEAT_RETRY_DELAY_MS);
  }
  return false;
}

async function main(): Promise<void> {
  loadDotEnv();
  const config: HeartbeatConfig = {
    overall: readUrl('HEARTBEAT_URL'),
    fda: readUrl('HEARTBEAT_FDA_URL'),
    fsis: readUrl('HEARTBEAT_FSIS_URL'),
  };

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    // Named, never printed.
    log('heartbeat SKIPPED: SUPABASE_URL / SUPABASE_SECRET_KEY are not set.');
    return;
  }

  // Straight off `ingest_runs` with the service role this step already
  // holds. There is no view and no migration in this path, deliberately:
  //
  //   - The service role bypasses RLS, so it can read `ingest_runs`
  //     directly. Verified against production 2026-09-19: HTTP 200 for
  //     this exact query, while `anon` gets HTTP 401 on the same table.
  //   - A database projection would only be needed to expose these values
  //     to an UNPRIVILEGED reader. Nothing unprivileged reads them: the app
  //     has no freshness surface at all, so the only consumer is this step.
  //     A view granted to `anon` for a consumer that does not exist would
  //     be a public operational surface with no purpose.
  //
  // Two filters carry weight, and match what a view would have done:
  //
  //   `finished_at`, not `started_at` — a check is done when it is done;
  //     started would overstate freshness by the run's duration (measured
  //     p50 114 s, max 461 s).
  //   `outcome in (succeeded, partial)` — a lease skip is outcome-less BY
  //     DESIGN and still carries a `finished_at`, so filtering on
  //     `finished_at` alone would let a job that stood down without doing
  //     any work establish freshness. That confusion is exactly what the
  //     2026-08-27 stall turned on.
  //
  // The lookback keeps the read on the (job_name, started_at) index while
  // `ingest_runs` grows forever. Anything it drops is far past the SLO, and
  // a null reads as a breach, never as healthy — so the bound can only ever
  // make the answer more conservative.
  const db = createClient(url, secretKey, { auth: { persistSession: false } });
  const since = new Date(Date.now() - AGENCY_LOOKBACK_DAYS * 86_400_000).toISOString();

  async function lastCheckedAt(agency: 'fda' | 'fsis'): Promise<string | null | typeof FAILED> {
    const { data, error } = await db
      .from('ingest_runs')
      .select('finished_at')
      .eq('job_name', AGENCY_JOB_NAME[agency])
      .in('outcome', ['succeeded', 'partial'])
      .gte('started_at', since)
      .order('finished_at', { ascending: false })
      .limit(1);
    if (error) {
      log(`  could not read ${agency} freshness: ${redactUrls(error.message)}`);
      return FAILED;
    }
    return (data?.[0]?.finished_at as string | undefined) ?? null;
  }

  const [fda, fsis] = await Promise.all([lastCheckedAt('fda'), lastCheckedAt('fsis')]);
  if (fda === FAILED || fsis === FAILED) {
    // A read we could not complete is NOT evidence of health. Withhold and
    // let the monitor alarm on the missing ping.
    log(
      'heartbeat WITHHELD: ingestion freshness could not be read. ' +
        'No ping sent, so the external monitor will alarm.',
    );
    return;
  }

  const freshness: HeartbeatFreshness = {
    observedAt: new Date().toISOString(),
    fdaCheckedAt: fda,
    fsisCheckedAt: fsis,
  };

  const plan = planHeartbeat(config, freshness, HEARTBEAT_SLO_MINUTES);
  log(plan.summary);

  if (plan.action !== 'send') return;

  for (const target of plan.targets) {
    const ok = await ping(target.url);
    log(`  ${target.name}: ${ok ? 'delivered' : 'NOT delivered (monitor will alarm)'}`);
  }
}

// Every path exits 0, including an unexpected throw: a monitoring failure
// must never mark a successful ingestion run as failed.
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log(`heartbeat ERROR (ingestion unaffected): ${redactUrls(message)}`);
});
