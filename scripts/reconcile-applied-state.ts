/**
 * Applied-state reconciliation (O3-B2) — an explicit governed maintenance
 * command, never scheduled, and deliberately DISTINCT from the P2/P3 hazard
 * repairs: it corrects nothing. The dry run produces a complete census +
 * reviewable seeding PLAN; apply seeds ONLY the four applied-marker fields
 * for records the reviewed plan proved consistent, and refuses everything
 * else (drift, missing events, orphans, pending/degraded work) for
 * separately reviewed correction.
 *
 *   npm run reconcile:applied-state:dry                       # census + plan (writes the plan JSON only)
 *   npm run reconcile:applied-state:dry -- --json <path>      # plan to an explicit path (must not exist)
 *   npm run reconcile:applied-state -- --confirm \
 *       --plan <reviewed-plan.json> --digest <plan digest>    # APPLY (all four gates required)
 *
 * Apply gates (every one required, in addition to the reviewed plan file):
 *   --apply     the intent flag (the npm alias passes it);
 *   --confirm   the second acknowledgment, as in the repair commands;
 *   --plan      the REVIEWED plan file — immutable input, revalidated by digest;
 *   --digest    the plan digest the reviewer approved, printed by the dry run.
 * The engine additionally refuses a plan whose content was edited (its own
 * digest breaks) or that was produced at a different git commit.
 *
 * DURABLE LEDGER: the dry run always writes its plan (the ledger) — to
 * `--json <path>` (refused if the file exists: a reviewed ledger is never
 * silently overwritten) or to a timestamped file under ./.reports/. Apply
 * writes a separate timestamped apply-ledger the same way.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY (server-only secrets).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  applySeedPlan,
  auditAppliedState,
  PlanValidationError,
  PLAN_SCHEMA_VERSION,
  type ReconcilePlan,
} from '../src/server/applied-state-reconcile';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${flag} requires a value argument.`);
    process.exit(1);
  }
  return value;
}

function writeLedger(requestedPath: string | null, prefix: string, body: unknown): string {
  const target =
    requestedPath ??
    path.join('.reports', `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  if (requestedPath && existsSync(requestedPath)) {
    console.error(
      `Refusing to overwrite ${requestedPath} — a reviewed ledger is immutable; pick a new path.`,
    );
    process.exit(1);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`);
  return target;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const confirm = argv.includes('--confirm');
  const planPath = flagValue(argv, '--plan');
  const digest = flagValue(argv, '--digest');
  const jsonPath = flagValue(argv, '--json');

  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const store = new SupabaseStore(createSupabaseServerClient(url, secretKey));
  const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  if (!apply) {
    console.log(
      `\n${'═'.repeat(72)}\nApplied-state reconciliation — DRY RUN census (writes nothing to the database)\n${'═'.repeat(72)}\n`,
    );
    const plan = await auditAppliedState(store, { gitCommit });
    const s = plan.summary;
    console.log(`  records examined:      ${s.recordsExamined}`);
    console.log(`  cases examined:        ${s.casesExamined}`);
    console.log(`  snapshots examined:    ${s.snapshotsExamined}`);
    console.log(`  merged tombstones:     ${s.mergedTombstonesSkipped} (skipped by design)`);
    console.log('  classifications:');
    for (const [name, count] of Object.entries(s.classificationCounts).sort()) {
      console.log(`    ${name.padEnd(34)} ${count}`);
    }
    console.log(`  seedable (plan):       ${s.seedableCount}`);
    console.log(`  refused (governed):    ${s.refusedCount}`);
    console.log(
      `  notification events:   ${s.notificationEventsWritten} (audit writes none, ever)`,
    );
    console.log(`  network requests:      ${s.networkRequests}`);
    console.log(`  population verdict:    ${s.populationVerdict}`);
    const target = writeLedger(jsonPath, 'applied-state-plan', plan);
    console.log(`\n  plan/ledger written:   ${target}`);
    console.log(`  plan digest:           ${plan.planDigest}`);
    console.log(
      '\n  To seed the consistent legacy population after review:\n' +
        `    npm run reconcile:applied-state -- --confirm --plan ${target} --digest ${plan.planDigest}\n`,
    );
    return;
  }

  // ── Apply: every gate explicit; the plan is immutable reviewed input ───────
  if (!confirm || !planPath || !digest) {
    console.error(
      'APPLY REFUSED: apply requires ALL of --confirm, --plan <reviewed file>, and --digest <plan digest>.\n' +
        'Run the dry run first, review its plan, then pass that exact file and digest.',
    );
    process.exit(1);
  }
  let plan: ReconcilePlan;
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf8')) as ReconcilePlan;
  } catch (error) {
    console.error(
      `Could not read the plan at ${planPath}: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }

  console.log(
    `\n${'═'.repeat(72)}\nApplied-state reconciliation — PLAN-BOUND APPLY (marker seeding only)\n${'═'.repeat(72)}\n`,
  );
  console.log(`  plan:        ${planPath}`);
  console.log(`  plan schema: ${plan.schemaVersion} (supported: ${PLAN_SCHEMA_VERSION})`);
  console.log(`  seedable:    ${plan.seedable?.length ?? 0} entr(ies)\n`);
  try {
    const report = await applySeedPlan(store, plan, {
      expectedDigest: digest,
      currentGitCommit: gitCommit,
    });
    console.log(`  entries checked:     ${report.entriesChecked}`);
    console.log(`  markers seeded:      ${report.seeded}`);
    console.log(`  already seeded:      ${report.alreadySeeded} (idempotent rerun)`);
    console.log(`  conflicts (refused): ${report.conflicts}`);
    console.log(`  groups refused:      ${report.groupsRefused}`);
    console.log(
      `  notification events: ${report.notificationEventsWritten} (seeding writes none, ever)`,
    );
    for (const outcome of report.outcomes) {
      if (outcome.outcome === 'conflict') {
        console.log(
          `    ✖ ${outcome.entry.sourceSystem}/${outcome.entry.nativeId}: ${outcome.reason}`,
        );
      }
    }
    const target = writeLedger(jsonPath, 'applied-state-apply', report);
    console.log(`\n  apply ledger written: ${target}`);
    console.log(
      report.conflicts > 0
        ? '\n  Conflicts are governed refusals: rerun the dry run for a fresh plan of what remains.\n'
        : '\n  ✓ Applied. A rerun with the same plan is idempotent (already-seeded, zero writes).\n',
    );
  } catch (error) {
    if (error instanceof PlanValidationError) {
      console.error(`APPLY REFUSED: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error('Reconciliation failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
