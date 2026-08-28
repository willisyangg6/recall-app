/**
 * Scheduler-watchdog status — READ-ONLY, answerable from the database alone:
 *
 *   npm run scheduler:status
 *
 * Prints the watchdog section exactly as `npm run ops:health` does (shared
 * loader/formatter in src/server/watchdog/report.ts), plus the recent
 * invocation and dispatch history. Performs no RPC, no insert, no update, no
 * GitHub request — nothing here can dispatch or mutate.
 *
 * Before activation it reports the pre-activation state and exits 0. After
 * activation it exits non-zero when the watchdog is UNHEALTHY, so it can gate
 * other automation the same way ops:health does.
 *
 * Requires SUPABASE_URL / SUPABASE_SECRET_KEY (server-only). Prints no secrets.
 */

import { createClient } from '@supabase/supabase-js';

import {
  asWatchdogQueryClient,
  formatWatchdogSection,
  loadWatchdogReport,
} from '../src/server/watchdog/report';

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`\nScheduler watchdog — ${new Date().toISOString()}\n`);
  const report = await loadWatchdogReport(asWatchdogQueryClient(client), Date.now());
  for (const line of formatWatchdogSection(report)) console.log(line);
  console.log('');

  if (!report) {
    console.log(
      'Nothing is installed yet. Activation sequence: docs/recall-scheduler-watchdog.md.',
    );
    return;
  }

  // Recent history — invocations (heartbeats + decisions), then dispatches.
  const invocations = await client
    .from('watchdog_invocations')
    .select('invoked_at, probe, decision, stale_sources, error_class')
    .order('invoked_at', { ascending: false })
    .limit(10);
  if (invocations.error) {
    console.error(`watchdog_invocations query failed: ${invocations.error.message}`);
    process.exit(1);
  }
  console.log('Recent invocations (newest first)');
  if (!invocations.data?.length) console.log('  — none recorded yet');
  for (const row of invocations.data ?? []) {
    const stale = (row.stale_sources as string[] | null)?.length
      ? ` stale=${(row.stale_sources as string[]).join(',')}`
      : '';
    console.log(
      `  ${row.invoked_at}  ${row.decision}${stale}` +
        `${row.error_class ? ` (${row.error_class})` : ''}${row.probe ? '  [probe]' : ''}`,
    );
  }
  console.log('');

  const dispatches = await client
    .from('watchdog_dispatches')
    .select(
      'claimed_at, status, stale_sources, attempt_count, github_status, github_run_id, error_class, finalized_at',
    )
    .order('claimed_at', { ascending: false })
    .limit(10);
  if (dispatches.error) {
    console.error(`watchdog_dispatches query failed: ${dispatches.error.message}`);
    process.exit(1);
  }
  console.log('Recent dispatch claims (newest first)');
  if (!dispatches.data?.length) console.log('  — none recorded yet');
  for (const row of dispatches.data ?? []) {
    console.log(
      `  ${row.claimed_at}  ${row.status}` +
        `${row.github_status ? `  http ${row.github_status}` : ''}` +
        `${row.github_run_id ? `  run ${row.github_run_id}` : ''}` +
        `${row.error_class ? `  ${row.error_class}` : ''}` +
        `  attempts ${row.attempt_count}`,
    );
  }
  console.log('');

  if (report.summary.unhealthy) {
    console.error('Scheduler watchdog UNHEALTHY.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Status check failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
