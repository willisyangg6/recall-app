/**
 * Production job entry point — the ONE orchestration layer for scheduled and
 * manual execution alike (both obey the same job lease and record the same
 * run bookkeeping):
 *
 *   npm run jobs:fda                       # FDA announcements ingest
 *   npm run jobs:fsis                      # FSIS recalls/PHAs ingest
 *   npm run jobs:labels                    # FSIS label visuals (recent window)
 *   npm run jobs:labels -- --full          # daily full sweep + failure retries
 *   npm run jobs:enforcement               # openFDA reconcile (weekly-gated)
 *   npm run jobs:push                      # push delivery + receipt processing
 *
 * Flags:
 *   --dry-run   fda/fsis: full pipeline in memory, nothing persisted.
 *               labels/enforcement/push: read the live DB, write nothing
 *               (push additionally sends nothing to Expo).
 *   --force     ignore the unchanged-source skip gate.
 *
 * Persistent modes need SUPABASE_URL and SUPABASE_SECRET_KEY in .env locally,
 * or in the environment (GitHub Actions repo secrets in production). Secrets
 * are never printed. A failed job exits non-zero so the scheduler shows red.
 */

import { hostname } from 'node:os';

import { runEnforcementJob } from '../src/server/jobs/enforcement-job';
import { runFdaJob } from '../src/server/jobs/fda-job';
import { runFsisJob } from '../src/server/jobs/fsis-job';
import { runLabelsJob } from '../src/server/jobs/labels-job';
import { runPushJob } from '../src/server/jobs/push-job';
import type { JobContext, JobReport } from '../src/server/jobs/runner';
import { SupabaseLabelStore } from '../src/server/fsis/label-store';
import { ExpoPushTransport } from '../src/server/push/expo-transport';
import { SupabasePushStore } from '../src/server/push/push-store';
import { MemoryStore } from '../src/server/store/memory-store';
import { withReadRetry } from '../src/server/store/read-retry';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const JOB_NAMES = ['fda', 'fsis', 'labels', 'enforcement', 'push'] as const;
type JobArg = (typeof JOB_NAMES)[number];

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file — environment variables may be set another way.
  }
}

function requireSupabaseEnv(): { url: string; secretKey: string } {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error(
      'Missing SUPABASE_URL and/or SUPABASE_SECRET_KEY.\n' +
        'Copy .env.example to .env and fill in your Supabase project values,\n' +
        'or (fda/fsis only) run with --dry-run to test the pipeline without a database.',
    );
    process.exit(1);
  }
  return { url, secretKey };
}

/**
 * Every scheduled job reads through this wrapper, so a transient Supabase or
 * edge fault costs one bounded retry instead of the whole run — the
 * 2026-09-09 `getLatestSnapshotMeta` HTML 502 failure mode.
 *
 * Reads only: withReadRetry's allowlist is asserted disjoint from every
 * mutating store method, so writes stay single-attempt (see
 * src/server/store/read-retry.ts).
 */
function readRetrying(store: SupabaseStore): SupabaseStore {
  return withReadRetry(store, { warn: (line) => console.error(line) });
}

async function main(): Promise<void> {
  const [, , jobArg, ...flags] = process.argv;
  if (!JOB_NAMES.includes(jobArg as JobArg)) {
    console.error(`Usage: run-job.ts <${JOB_NAMES.join('|')}> [--dry-run] [--force] [--full]`);
    process.exit(1);
  }
  const job = jobArg as JobArg;
  const dryRun = flags.includes('--dry-run');
  const force = flags.includes('--force');
  const labelsMode: 'recent' | 'full' = flags.includes('--full') ? 'full' : 'recent';

  const version = process.env.GITHUB_SHA?.slice(0, 12) ?? 'local';
  const ctx: JobContext = {
    // Dry runs keep lease/run bookkeeping in memory: a simulation must not
    // write operational state (and must work before the ops migration lands).
    store: new MemoryStore(),
    now: () => new Date(),
    version,
    holder: `${hostname()}:${process.pid}:${version}`,
  };

  let report: JobReport;
  if (job === 'fda' || job === 'fsis') {
    if (!dryRun) {
      const env = requireSupabaseEnv();
      ctx.store = readRetrying(
        new SupabaseStore(createSupabaseServerClient(env.url, env.secretKey)),
      );
    }
    report =
      job === 'fda'
        ? await runFdaJob(ctx, { dryRun, force })
        : await runFsisJob(ctx, { dryRun, force });
  } else {
    const env = requireSupabaseEnv();
    const client = createSupabaseServerClient(env.url, env.secretKey);
    const supabaseStore = readRetrying(new SupabaseStore(client));
    if (!dryRun) ctx.store = supabaseStore;
    report =
      job === 'labels'
        ? await runLabelsJob(ctx, {
            mode: labelsMode,
            dryRun,
            labelStore: new SupabaseLabelStore(client),
          })
        : job === 'push'
          ? await runPushJob(ctx, {
              dryRun,
              pushStore: new SupabasePushStore(client),
              // EXPO_ACCESS_TOKEN is optional (enhanced push security);
              // server-only, never printed, never in the app bundle.
              transport: new ExpoPushTransport({ accessToken: process.env.EXPO_ACCESS_TOKEN }),
            })
          : await runEnforcementJob(ctx, {
              dryRun,
              force,
              client,
              dataStore: supabaseStore,
            });
  }

  console.log(
    `\n[${report.jobName}] ${report.outcome}${report.error ? ` — ${report.error}` : ''}` +
      `${dryRun ? ' (dry run)' : ''}`,
  );
  if (report.outcome === 'failed') process.exit(1);
}

main().catch((error) => {
  console.error('Job failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
