/**
 * Source/job health — read-only, answerable from the database alone:
 *
 *   npm run ops:health
 *
 * For each production job: last run, last success, and a status derived from
 * job-specific freshness expectations (FDA/FSIS tick every 30 minutes; the
 * enforcement source itself updates weekly; labels sweep daily). Exits
 * non-zero when anything is UNHEALTHY, so it can gate other automation.
 *
 * Requires SUPABASE_URL / SUPABASE_SECRET_KEY (server-only). Prints no secrets.
 */

import { createClient } from '@supabase/supabase-js';

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
    const lastRun = runs[0] ?? null;
    const lastSuccess =
      runs.find((run) => run.outcome === 'succeeded' || run.outcome === 'partial') ?? null;

    const notes: string[] = [];
    let status = 'healthy';

    if (!lastSuccess) {
      status = 'UNHEALTHY';
      notes.push(lastRun ? 'no successful run recorded' : 'never ran');
    } else if (hoursAgo(lastSuccess.started_at) > spec.staleAfterHours) {
      status = 'UNHEALTHY';
      notes.push(
        `no success in ${hoursAgo(lastSuccess.started_at).toFixed(1)}h (threshold ${spec.staleAfterHours}h)`,
      );
    }
    if (lastRun && lastRun.outcome === 'failed' && status === 'healthy') {
      status = 'degraded';
      notes.push(`latest run FAILED: ${lastRun.error ?? 'no error recorded'}`);
    }
    if (lastRun && lastRun.outcome === 'partial' && status === 'healthy') {
      status = 'degraded';
      notes.push('latest run partial (item-level failures — see run metrics)');
    }

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
      `  last run:            ${lastRun ? `${lastRun.started_at} (${lastRun.outcome ?? 'running'}${lastRun.version ? `, ${lastRun.version}` : ''})` : '—'}`,
    );
    console.log(`  last successful run: ${lastSuccess ? lastSuccess.started_at : '—'}`);
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
