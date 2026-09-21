/**
 * FDA announcement ↔ enforcement reconciliation — manual CLI over the
 * canonical run in src/server/fda-enforcement/reconcile.ts (the scheduled
 * enforcement job runs the same function).
 *
 *   npm run reconcile:fda-enforcement                                   # DRY RUN (default)
 *   npm run reconcile:fda-enforcement -- --apply --confirm --expect <n> # perform the writes
 *   npm run reconcile:fda-enforcement -- --file <p>                     # offline corpus
 *                                                                       # (bulk-export JSON)
 *
 * Dry-run reports everything an apply would do — matches, evidence,
 * classifications, notifications and their suppression — and writes nothing.
 *
 * This MANUAL command needs the same three typed flags every other mutation
 * CLI needs (P2B7T); they are resolved and refused before a write-capable
 * client is constructed. `--expect <n>` is the proposed classification-change
 * count the dry run printed. An apply runs the engine twice: once read-only to
 * re-plan the corpus against the authorized count, and — only if they match —
 * once to write. A mismatch writes nothing, notifies nobody, and exits 1.
 *
 * The SCHEDULED job (`npm run jobs:enforcement`) calls the same engine through
 * run-job.ts and is deliberately untouched by this gate: it is the pipeline's
 * normal unattended operation, governed by the job lease, not a hand-run
 * maintenance write.
 */

import {
  downloadEnforcementCorpus,
  loadEnforcementCorpusFromFile,
  reconcileFdaEnforcement,
} from '../src/server/fda-enforcement/reconcile';
import {
  applyCommandLine,
  dryRunClosingLine,
  resolveCountGate,
  resolveFlagValue,
  resolveRepairAuthorization,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
  type MutationCommandForm,
} from '../src/server/repair-authorization';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const COMMAND: MutationCommandForm = { script: 'reconcile:fda-enforcement' };

const HELP = `
FDA announcement ↔ enforcement reconciliation (manual CLI)

  npm run reconcile:fda-enforcement                     dry run; writes nothing
  npm run reconcile:fda-enforcement -- --file <path>    …against an offline corpus
  ${applyCommandLine(COMMAND)}   APPLY — all three flags are required

A production write needs every one of:
  --apply          the intent, typed by a human; no package script supplies it
  --confirm        the repair:* house rule
  --expect <n>     the proposed classification-change count from the dry run

Omit any one and the command exits nonzero before opening a database
connection. The corpus is re-planned read-only against that count before the
first write; a mismatch writes nothing and notifies nobody.
`;

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  // ── The authorization contract is resolved FIRST, and nothing below runs
  // until it passes. A refusal here has opened no database connection and has
  // made no openFDA request — proved structurally by mutation-cli.test.ts.
  const mode = resolveRepairAuthorization(argv, COMMAND);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
  const file = resolveFlagValue(argv, '--file');
  if (file.error) {
    console.error(file.error);
    process.exit(1);
  }
  const corpusFile = file.value;
  const apply = mode.apply;
  // Two thirds of the contract is still a dry run, and says so — an operator
  // must never believe they applied because they typed part of it.
  if (!apply && (argv.includes('--confirm') || mode.expectedUpdates !== null)) {
    console.log(DRY_RUN_DESPITE_ACKNOWLEDGMENTS);
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createSupabaseServerClient(url, secretKey);
  const store = new SupabaseStore(client);

  const corpus = corpusFile
    ? loadEnforcementCorpusFromFile(corpusFile)
    : await downloadEnforcementCorpus();

  // Plan the COMPLETE corpus read-only first — the engine's dry run is its own
  // preview of the apply — and only then compare against what was authorized.
  const planned = await reconcileFdaEnforcement(client, store, { apply: false, corpus });
  const plannedChanges = planned.classificationChanges.length;
  const aborted = resolveCountGate(mode, plannedChanges);
  if (aborted) {
    console.error(
      `\n  ✗ ABORTED — ${aborted.reason}.` +
        `\n    authorized ${aborted.expected}, live plan ${aborted.actual}.` +
        '\n    Nothing was written, and no notification was created. Re-run the dry' +
        '\n    run, review the difference, and re-authorize with the new count.\n',
    );
    process.exit(1);
  }
  if (!apply) {
    console.log(dryRunClosingLine(COMMAND, plannedChanges));
    return;
  }

  await reconcileFdaEnforcement(client, store, { apply: true, corpus });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
