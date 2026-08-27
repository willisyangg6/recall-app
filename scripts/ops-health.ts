/**
 * Source/job health — read-only, answerable from the database alone:
 *
 *   npm run ops:health
 *
 * For each production job: the most recent attempt, the last success, and a
 * status derived from job-specific freshness expectations (FDA/FSIS tick twice
 * an hour; the enforcement source itself updates weekly; labels sweep daily).
 * Exits non-zero when anything is UNHEALTHY, so it can gate other automation.
 *
 * "Attempt" and "success" are deliberately separate: a run that stood down
 * because another worker held the lease is an attempt but not a success, and
 * that is what lets this distinguish a silent scheduler from lease contention.
 * The classification lives in src/server/jobs/health.ts so it can be tested;
 * this script is presentation and I/O.
 *
 * Requires SUPABASE_URL / SUPABASE_SECRET_KEY (server-only). Prints no secrets.
 */

import { createClient } from '@supabase/supabase-js';

import { summarizeJobRuns, type HealthRun } from '../src/server/jobs/health';

interface JobHealthSpec {
  jobName: string;
  label: string;
  /** No success within this window ⇒ UNHEALTHY. */
  staleAfterHours: number;
  /** Newest source item older than this ⇒ STALE SOURCE warning (feed silence). */
  sourceStaleDays?: number;
  /** Enforcement only: completed export older than this ⇒ STALE. */
  exportStaleDays?: number;
}

const JOBS: JobHealthSpec[] = [
  {
    jobName: 'fda_announcements',
    label: 'FDA announcements',
    staleAfterHours: 3,
    sourceStaleDays: 14,
  },
  { jobName: 'fsis_ingest', label: 'FSIS recalls/PHAs', staleAfterHours: 3, sourceStaleDays: 14 },
  { jobName: 'fsis_labels', label: 'FSIS product visuals', staleAfterHours: 30 },
  {
    jobName: 'fda_enforcement',
    label: 'FDA enforcement (openFDA)',
    staleAfterHours: 30,
    exportStaleDays: 10,
  },
];

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

interface RunRow {
  started_at: string;
  finished_at: string | null;
  outcome: string | null;
  metrics: Record<string, unknown> | null;
  version: string | null;
  error: string | null;
}

function hoursAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function daysAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
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

  let unhealthy = 0;
  console.log(`\nRecall source/job health — ${new Date().toISOString()}\n`);

  for (const spec of JOBS) {
    const { data, error } = await client
      .from('ingest_runs')
      .select('started_at, finished_at, outcome, metrics, version, error')
      .eq('job_name', spec.jobName)
      .order('started_at', { ascending: false })
      .limit(25);
    if (error) {
      if (/job_name|metrics|version/.test(error.message)) {
        console.error(
          'ingest_runs has no job columns yet — the job_operations migration has not been applied.\n' +
            'Run `supabase db push` (after review) to activate production job bookkeeping.',
        );
        process.exit(1);
      }
      console.error(`${spec.label}: query failed: ${error.message}`);
      process.exit(1);
    }

    const runs = (data ?? []) as RunRow[];
    const summary = summarizeJobRuns(
      runs.map((run): HealthRun => ({
        startedAt: run.started_at,
        outcome: run.outcome,
        metrics: run.metrics,
        error: run.error,
      })),
      spec.staleAfterHours,
      Date.now(),
    );
    const lastRun = runs[0] ?? null;
    const lastSuccess =
      runs.find((run) => run.outcome === 'succeeded' || run.outcome === 'partial') ?? null;

    const notes: string[] = [...summary.notes];
    // Widened beyond JobHealthStatus: the source/export checks below add their
    // own states, which are presentation-only and never gate the exit code.
    let status: string = summary.status;

    const successMetrics = lastSuccess?.metrics ?? null;
    if (spec.sourceStaleDays && typeof successMetrics?.newestPublishedAt === 'string') {
      const age = daysAgo(successMetrics.newestPublishedAt);
      if (age > spec.sourceStaleDays) {
        if (status === 'healthy') status = 'STALE SOURCE';
        notes.push(
          `newest source item is ${age.toFixed(0)}d old (threshold ${spec.sourceStaleDays}d) — feed may be silently broken`,
        );
      }
    }
    if (spec.exportStaleDays) {
      const completed = runs
        .map((run) => run.metrics?.completedExportDate)
        .find((value): value is string => typeof value === 'string');
      if (completed) {
        const age = daysAgo(completed);
        notes.push(`source export date: ${completed} (${age.toFixed(0)}d ago)`);
        if (age > spec.exportStaleDays && status === 'healthy') {
          status = 'STALE';
          notes.push(`export older than ${spec.exportStaleDays}d — weekly source refresh missed`);
        }
      } else {
        notes.push('no completed reconciliation recorded yet');
      }
    }

    if (status === 'UNHEALTHY') unhealthy += 1;
    console.log(`${spec.label}`);
    console.log(
      `  most recent attempt: ${lastRun ? `${lastRun.started_at} (${summary.lastAttemptKind}${lastRun.version ? `, ${lastRun.version}` : ''})` : '—'}`,
    );
    console.log(`  last successful run: ${lastSuccess ? lastSuccess.started_at : '—'}`);
    if (summary.leaseSkipsSinceSuccess > 0) {
      console.log(
        `  lease skips:         ${summary.leaseSkipsSinceSuccess} of ` +
          `${summary.attemptsSinceSuccess} attempt(s) since the last success`,
      );
    }
    console.log(`  status:              ${status}`);
    for (const note of notes) console.log(`    · ${note}`);
    console.log('');
  }

  // Product-visual failure backlog (label PDFs that keep failing).
  const failures = await client
    .from('product_visual_failures')
    .select('source_url, attempts, last_attempt_at', { count: 'exact' })
    .order('attempts', { ascending: false })
    .limit(5);
  if (failures.error) {
    if (!/product_visual_failures/.test(failures.error.message)) {
      console.error(`product_visual_failures query failed: ${failures.error.message}`);
      process.exit(1);
    }
    console.log('Product visuals: failure table not present (job_operations migration pending).\n');
  } else {
    console.log(`Product visuals`);
    console.log(`  failing PDFs:        ${failures.count ?? 0}`);
    for (const row of failures.data ?? []) {
      console.log(
        `    · ${row.attempts} attempt(s), last ${row.last_attempt_at}: ${row.source_url}`,
      );
    }
    console.log('');
  }

  // ── Push delivery (Phase C2) ───────────────────────────────────────────────
  // Before founder activation the correct status is "disabled", not
  // unhealthy; after activation the push job is held to the fast-job bar.
  const pushConfig = await client.from('push_delivery_config').select('push_enabled_at');
  if (pushConfig.error) {
    if (!/push_delivery_config/.test(pushConfig.error.message)) {
      console.error(`push_delivery_config query failed: ${pushConfig.error.message}`);
      process.exit(1);
    }
    console.log('Push delivery: not installed (push_delivery migration pending).\n');
  } else {
    const pushEnabledAt = (pushConfig.data?.[0]?.push_enabled_at as string | undefined) ?? null;
    const pushRuns = await client
      .from('ingest_runs')
      .select('started_at, outcome, metrics, error')
      .eq('job_name', 'push_delivery')
      .order('started_at', { ascending: false })
      .limit(25);
    const runs = (pushRuns.data ?? []) as RunRow[];
    const lastRun = runs[0] ?? null;
    const lastSuccess =
      runs.find((run) => run.outcome === 'succeeded' || run.outcome === 'partial') ?? null;

    const subs = await client
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('enabled', true);
    const disabledDead = await client
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('disabled_reason', 'device_not_registered');
    const statusCounts: Record<string, number> = {};
    for (const s of [
      'pending',
      'sending',
      'ticket_accepted',
      'retryable_failure',
      'permanent_failure',
    ]) {
      const { count } = await client
        .from('notification_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('status', s);
      if (count) statusCounts[s] = count;
    }
    const oldestPending = await client
      .from('notification_deliveries')
      .select('created_at')
      .in('status', ['pending', 'retryable_failure'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    let pushStatus = 'disabled (not activated)';
    const pushNotes: string[] = [];
    if (pushEnabledAt) {
      pushStatus = 'healthy';
      if (!lastSuccess) {
        pushStatus = 'UNHEALTHY';
        pushNotes.push(lastRun ? 'no successful push run recorded' : 'push job never ran');
      } else if (hoursAgo(lastSuccess.started_at) > 3) {
        pushStatus = 'UNHEALTHY';
        pushNotes.push(
          `no success in ${hoursAgo(lastSuccess.started_at).toFixed(1)}h (threshold 3h)`,
        );
      }
      if (lastRun?.outcome === 'failed' && pushStatus === 'healthy') {
        pushStatus = 'degraded';
        pushNotes.push(`latest run FAILED: ${lastRun.error ?? 'no error recorded'}`);
      }
      if (pushStatus === 'UNHEALTHY') unhealthy += 1;
    }

    console.log(`Push delivery`);
    console.log(
      `  activation:          ${pushEnabledAt ? `ACTIVE since ${pushEnabledAt}` : 'not activated (no-send state)'}`,
    );
    console.log(`  status:              ${pushStatus}`);
    console.log(
      `  last run:            ${lastRun ? `${lastRun.started_at} (${lastRun.outcome ?? 'running'})` : '—'}`,
    );
    console.log(`  active subscriptions: ${subs.count ?? 0}`);
    console.log(
      `  deliveries:          pending ${statusCounts.pending ?? 0}, sending ${statusCounts.sending ?? 0}, ` +
        `awaiting receipt ${statusCounts.ticket_accepted ?? 0}, retryable ${statusCounts.retryable_failure ?? 0}, ` +
        `permanent failures ${statusCounts.permanent_failure ?? 0}`,
    );
    console.log(`  dead tokens disabled: ${disabledDead.count ?? 0}`);
    if (oldestPending.data?.created_at) {
      console.log(`  oldest unsent delivery: ${oldestPending.data.created_at}`);
    }
    // Personalization (Phase C3) — aggregate counts only, never contents.
    // Deliberately NOT a head-only count: PostgREST answers HEAD on a missing
    // table with 204/no error, which would print a misleading "0" while the
    // migration is unapplied. A ranged select 404s honestly.
    const prefsTotal = await client
      .from('installation_preferences')
      .select('installation_id', { count: 'exact' })
      .limit(0);
    if (prefsTotal.error) {
      if (!/installation_preferences/.test(prefsTotal.error.message)) {
        console.error(`installation_preferences query failed: ${prefsTotal.error.message}`);
        process.exit(1);
      }
      console.log(
        '  preferences:         not installed (installation_preferences migration pending)',
      );
    } else {
      const prefsWithState = await client
        .from('installation_preferences')
        .select('installation_id', { count: 'exact' })
        .not('state_code', 'is', null)
        .limit(0);
      console.log(
        `  preferences:         ${prefsTotal.count ?? 0} installation(s), ${prefsWithState.count ?? 0} with a state`,
      );
    }
    for (const note of pushNotes) console.log(`    · ${note}`);
    console.log('');
  }

  // Deliverable notification flow (informational — C2 consumes these).
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const deliverable = await client
    .from('notification_events')
    .select('id', { count: 'exact', head: true })
    .is('suppressed', null)
    .gte('created_at', since);
  const suppressed = await client
    .from('notification_events')
    .select('id', { count: 'exact', head: true })
    .not('suppressed', 'is', null)
    .gte('created_at', since);
  console.log(`Notification ledger (last 7 days)`);
  console.log(`  deliverable events:  ${deliverable.count ?? 0}`);
  console.log(`  suppressed events:   ${suppressed.count ?? 0}\n`);

  if (unhealthy > 0) {
    console.error(`${unhealthy} job(s) UNHEALTHY.`);
    process.exit(1);
  }
  console.log('All jobs healthy.');
}

main().catch((error) => {
  console.error('Health check failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
