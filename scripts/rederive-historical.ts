/**
 * Governed historical re-derivation CLI (O3-B5) — wave-based repair of the
 * legacy population reconciliation could not certify. NOT scheduled, NOT a
 * generic repair: dry-run first, immutable digest-bound plans, exactly one
 * wave per plan, zero notification events, and the allergen-evidence hold
 * (the FSIS 083-2016 shape) is reported on every run and never appliable.
 *
 *   npm run rederive:historical:dry -- --json <path>              # full census plan (never appliable)
 *   npm run rederive:historical:dry -- --wave <wave> --json <p>   # wave-bound plan (the reviewable input)
 *   npm run rederive:historical -- --apply --confirm --expect <n> \
 *       --wave <wave> --plan <reviewed-plan.json> --digest <digest>   # APPLY one wave
 *
 * NO PACKAGE SCRIPT CARRIES `--apply`. It used to: `rederive:historical` was
 * `tsx scripts/rederive-historical.ts --apply`, so an operator who typed only
 * `--confirm --wave … --plan … --digest …` was applying without ever writing
 * the word. The flag is now typed by a human or the run is a dry run (P2B7T).
 *
 * This command keeps its own, STRONGER gates on top of the three shared ones:
 * the reviewed plan file and its digest pin the exact contents of the apply,
 * not merely how many rows it touches. `--expect <n>` is the shared
 * planned-write count, checked against the reviewed plan before a single row
 * is written.
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
import {
  applyCommandLine,
  resolveFlagValue,
  resolveRepairAuthorization,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
  type MutationCommandForm,
} from '../src/server/repair-authorization';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const COMMAND: MutationCommandForm = {
  script: 'rederive:historical',
  extraApplyFlags: ['--wave <wave>', '--plan <reviewed-plan.json>', '--digest <plan digest>'],
};

const HELP = `
Governed historical re-derivation (O3-B5)

  npm run rederive:historical:dry -- --json <path>              full census plan; never appliable
  npm run rederive:historical:dry -- --wave <wave> --json <p>   wave-bound plan — the reviewable input
  ${applyCommandLine(COMMAND)}

A production write needs every one of:
  --apply          the intent, typed by a human; no package script supplies it
  --confirm        the repair:* house rule
  --expect <n>     the planned normalized-write count from the reviewed plan
  --wave <wave>    ${APPLIABLE_WAVES.join(' | ')}
  --plan <file>    the reviewed plan file
  --digest <d>     that plan's digest

Every flag is resolved and refused BEFORE a database connection is opened. A
plan whose planned-write count differs from --expect is refused with zero
writes.
`;

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

/** A value flag, refused rather than guessed — resolved before any I/O. */
function flagValue(argv: string[], flag: string): string | null {
  const resolved = resolveFlagValue(argv, flag);
  if (resolved.error) {
    console.error(resolved.error);
    process.exit(1);
  }
  return resolved.value;
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

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  // ── EVERY flag, count, mode and path is resolved and refused HERE, before
  // any credential is read and before any client exists. A refusal below has
  // opened no database connection — proved structurally by mutation-cli.test.ts.
  const mode = resolveRepairAuthorization(argv, COMMAND);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
  const apply = mode.apply;
  const planPath = flagValue(argv, '--plan');
  const digest = flagValue(argv, '--digest');
  const jsonPath = flagValue(argv, '--json');
  const wave = parseWave(flagValue(argv, '--wave'));
  if (apply && (!planPath || !digest || !wave)) {
    console.error(
      'APPLY REFUSED: apply requires ALL of --apply, --confirm, --expect <n>, ' +
        '--wave <wave>, --plan <reviewed file>, and --digest <plan digest>.\n' +
        `  ${applyCommandLine(COMMAND)}\nNothing was written.`,
    );
    process.exit(1);
  }
  if (!apply && (argv.includes('--confirm') || mode.expectedUpdates !== null)) {
    console.log(DRY_RUN_DESPITE_ACKNOWLEDGMENTS);
  }

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
        s.plannedNormalizedWrites === 0
          ? '\n  No apply needed: this wave plans no normalized writes.\n'
          : '\n  To apply after review:\n    ' +
              applyCommandLine(COMMAND, s.plannedNormalizedWrites, [
                `--wave ${plan.wave}`,
                `--plan ${target}`,
                `--digest ${plan.planDigest}`,
              ]) +
              '\n',
      );
    }
    return;
  }

  let plan: RederivationPlan;
  try {
    plan = JSON.parse(readFileSync(planPath!, 'utf8')) as RederivationPlan;
  } catch (error) {
    console.error(`Could not read the plan: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  // The shared count gate, checked against the REVIEWED plan before a single
  // row is written. The digest below pins the plan's contents; this pins the
  // number the operator actually read and authorized.
  const plannedWrites = plan.summary?.plannedNormalizedWrites ?? -1;
  if (plannedWrites !== mode.expectedUpdates) {
    console.error(
      `APPLY REFUSED: --expect ${mode.expectedUpdates} does not match the reviewed ` +
        `plan's ${plannedWrites} planned normalized write(s).\nNothing was written.`,
    );
    process.exit(1);
  }
  console.log(
    `\n${'═'.repeat(72)}\nHistorical re-derivation — WAVE-BOUND APPLY\n${'═'.repeat(72)}\n`,
  );
  console.log(`  plan:        ${planPath!}`);
  console.log(`  plan schema: ${plan.schemaVersion} (supported: ${REDERIVATION_PLAN_SCHEMA})`);
  console.log(`  contract:    ${plan.derivationContract} (supported: ${DERIVATION_CONTRACT})`);
  console.log(`  wave:        ${plan.wave} (requested: ${wave!})\n`);
  try {
    const report = await applyRederivationPlan(store, plan, {
      expectedDigest: digest!,
      currentGitCommit: gitCommit,
      wave: wave!,
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
    const target = writeLedger(jsonPath, `rederivation-apply-${wave!}`, report);
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
