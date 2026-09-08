/**
 * Governed historical re-derivation CLI (O3-B5) — wave-based repair of the
 * legacy population reconciliation could not certify. NOT scheduled, NOT a
 * generic repair: dry-run first, immutable digest-bound plans, exactly one
 * wave per plan, zero notification events, and the allergen-evidence hold
 * (the FSIS 083-2016 shape) is reported on every run and never appliable.
 *
 *   npm run rederive:historical:dry -- --json <path>              # full census plan (never appliable)
 *   npm run rederive:historical:dry -- --wave <wave> --json <p>   # wave-bound plan (the reviewable input)
 *   npm run rederive:historical -- --confirm --wave <wave> \
 *       --plan <reviewed-plan.json> --digest <plan digest>        # APPLY one wave (all gates required)
 *
 * Waves: inert_refresh | visible_corrections | virginia_false_positive |
 * material_corrections. A census plan or a plan for a different wave fails
 * closed. Needs SUPABASE_URL and SUPABASE_SECRET_KEY (server-only secrets).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  APPLIABLE_WAVES,
  applyRederivationPlan,
  buildRederivationPlan,
  DERIVATION_CONTRACT,
  REDERIVATION_PLAN_SCHEMA,
  RederivationPlanError,
  writeJsonFileAtomically,
  type RederivationPlan,
  type RederivationWave,
} from '../src/server/historical-rederivation';
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
  try {
    writeJsonFileAtomically(target, body);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  return target;
}

function parseWave(raw: string | null): RederivationWave | null {
  if (raw === null) return null;
  if ((APPLIABLE_WAVES as string[]).includes(raw)) return raw as RederivationWave;
  console.error(`--wave must be one of: ${APPLIABLE_WAVES.join(', ')}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const confirm = argv.includes('--confirm');
  const planPath = flagValue(argv, '--plan');
  const digest = flagValue(argv, '--digest');
  const jsonPath = flagValue(argv, '--json');
  const wave = parseWave(flagValue(argv, '--wave'));

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
      `\n${'═'.repeat(72)}\nHistorical re-derivation — DRY RUN plan (writes nothing to the database)\n${'═'.repeat(72)}\n`,
    );
    const plan = await buildRederivationPlan(store, { gitCommit, wave: wave ?? 'census' });
    const s = plan.summary;
    console.log(`  wave:                  ${plan.wave}`);
    console.log(`  records examined:      ${s.recordsExamined}`);
    console.log(`  groups examined:       ${s.groupsExamined}`);
    console.log('  wave populations:');
    for (const [name, counts] of Object.entries(s.waveCounts).sort()) {
      console.log(
        `    ${name.padEnd(28)} ${String(counts.groups).padStart(4)} groups  ${String(counts.records).padStart(5)} records`,
      );
    }
    console.log(`  planned normalized writes: ${s.plannedNormalizedWrites}`);
    console.log(`  planned timeline entries:  ${s.plannedTimelineEntries} (kind 'corrected')`);
    console.log(`  notification events:       ${s.notificationEventsPlanned} (always zero)`);
    const target = writeLedger(jsonPath, 'rederivation-plan', plan);
    console.log(`\n  plan written:          ${target}`);
    console.log(`  plan digest:           ${plan.planDigest}`);
    console.log(`  derivation contract:   ${plan.derivationContract}`);
    if (plan.wave === 'census') {
      console.log('\n  A census plan is NEVER appliable — generate a wave-bound plan to apply.\n');
    } else {
      console.log(
        `\n  To apply after review:\n    npm run rederive:historical -- --confirm --wave ${plan.wave} --plan ${target} --digest ${plan.planDigest}\n`,
      );
    }
    return;
  }

  if (!confirm || !planPath || !digest || !wave) {
    console.error(
      'APPLY REFUSED: apply requires ALL of --confirm, --wave <wave>, --plan <reviewed file>, and --digest <plan digest>.',
    );
    process.exit(1);
  }
  let plan: RederivationPlan;
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf8')) as RederivationPlan;
  } catch (error) {
    console.error(`Could not read the plan: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  console.log(
    `\n${'═'.repeat(72)}\nHistorical re-derivation — WAVE-BOUND APPLY\n${'═'.repeat(72)}\n`,
  );
  console.log(`  plan:        ${planPath}`);
  console.log(`  plan schema: ${plan.schemaVersion} (supported: ${REDERIVATION_PLAN_SCHEMA})`);
  console.log(`  contract:    ${plan.derivationContract} (supported: ${DERIVATION_CONTRACT})`);
  console.log(`  wave:        ${plan.wave} (requested: ${wave})\n`);
  try {
    const report = await applyRederivationPlan(store, plan, {
      expectedDigest: digest,
      currentGitCommit: gitCommit,
      wave,
    });
    console.log(`  groups checked:        ${report.groupsChecked}`);
    console.log(`  repaired:              ${report.repaired}`);
    console.log(`  already completed:     ${report.alreadyCompleted} (idempotent rerun)`);
    console.log(`  refused (governed):    ${report.refused}`);
    console.log(`  governed exceptions:   ${report.heldGovernedExceptions} (held, never applied)`);
    console.log(`  normalized writes:     ${report.normalizedWrites}`);
    console.log(`  timeline entries:      ${report.timelineEntriesInserted} (kind 'corrected')`);
    console.log(`  notification events:   ${report.notificationEventsWritten} (always zero)`);
    for (const outcome of report.outcomes) {
      if (outcome.outcome === 'refused') {
        console.log(`    ✖ ${outcome.recallCaseId}: ${outcome.reason}`);
      }
    }
    const target = writeLedger(jsonPath, `rederivation-apply-${wave}`, report);
    console.log(`\n  apply ledger written:  ${target}`);
    console.log(
      report.refused > 0
        ? '\n  Refusals are governed outcomes — rerun the dry run for a fresh wave plan of what remains.\n'
        : '\n  ✓ Applied. A rerun with the same plan is idempotent (already-completed, zero writes).\n',
    );
  } catch (error) {
    if (error instanceof RederivationPlanError) {
      console.error(`APPLY REFUSED: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error('Re-derivation failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
