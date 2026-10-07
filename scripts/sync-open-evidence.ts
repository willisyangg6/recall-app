/**
 * FDA open-evidence sync — manual CLI over the same runner the scheduled
 * enforcement job uses (src/server/fda-enforcement/open-evidence-sync.ts).
 *
 *   npm run open-evidence:sync                                      # DRY RUN (default)
 *   npm run open-evidence:sync -- --apply --confirm --expect <n>    # write the planned values
 *   npm run open-evidence:sync -- --clear                           # dry run of the rollback
 *   npm run open-evidence:sync -- --clear --apply --confirm --expect <n>
 *   npm run open-evidence:sync -- --file <export.json> --export-date <YYYY-MM-DD> --manifest-total <n>
 *
 * Writes exactly one column, `recall_cases.fda_ongoing_as_of`, compare-and-set
 * per row. Never projection, timeline, last_changed_at, affected products,
 * source records or the notification ledger — so it cannot re-date a recall,
 * move it in the feed, or send a push. `--expect <n>` is the planned write
 * count from the reviewed dry run; the corpus is re-planned read-only against
 * it before the first write.
 */

import {
  describeOpenEvidence,
  runOpenEvidenceSync,
  SupabaseOpenEvidenceStore,
  type OpenEvidenceCorpus,
} from '../src/server/fda-enforcement/open-evidence-sync';
import {
  downloadEnforcementCorpus,
  loadEnforcementCorpusFromFile,
} from '../src/server/fda-enforcement/reconcile';
import { latestJobMetric } from '../src/server/jobs/runner';
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

const COMMAND: MutationCommandForm = { script: 'open-evidence:sync' };

const HELP = `
FDA open-evidence sync (manual CLI) — writes only recall_cases.fda_ongoing_as_of

  npm run open-evidence:sync                     dry run; writes nothing
  npm run open-evidence:sync -- --clear          dry run of the rollback (every value to null)
  npm run open-evidence:sync -- --file <path> --export-date <YYYY-MM-DD> --manifest-total <n>
                                                 …against an offline bulk-export file
  ${applyCommandLine(COMMAND)}   APPLY — all three flags are required

A production write needs every one of:
  --apply          the intent, typed by a human; no package script supplies it
  --confirm        the repair:* house rule
  --expect <n>     the planned write count from the dry run you read

An export that is not provably complete (record count ≠ manifest total, empty,
under half the previous total, or undated) writes nothing.
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

  // ── Every refusal happens here, before any credential, client or download.
  const mode = resolveRepairAuthorization(argv, COMMAND);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
  const file = resolveFlagValue(argv, '--file');
  const exportDate = resolveFlagValue(argv, '--export-date');
  const manifestTotal = resolveFlagValue(argv, '--manifest-total');
  for (const flag of [file, exportDate, manifestTotal]) {
    if (flag.error) {
      console.error(flag.error);
      process.exit(1);
    }
  }
  if (file.value !== null && (exportDate.value === null || manifestTotal.value === null)) {
    console.error(
      '--file needs --export-date <YYYY-MM-DD> and --manifest-total <n>: a file carries no ' +
        'manifest, so its completeness cannot be proved otherwise.\nNothing was written.',
    );
    process.exit(1);
  }
  if (manifestTotal.value !== null && !/^\d+$/.test(manifestTotal.value)) {
    console.error(`--manifest-total must be a non-negative integer.\nNothing was written.`);
    process.exit(1);
  }
  const clear = argv.includes('--clear');
  const apply = mode.apply;
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
  const evidenceStore = new SupabaseOpenEvidenceStore(client);

  let corpus: OpenEvidenceCorpus;
  if (clear) {
    corpus = { records: [], exportDate: null, totalRecords: 0 };
  } else if (file.value !== null) {
    const loaded = loadEnforcementCorpusFromFile(file.value);
    corpus = {
      records: loaded.records,
      exportDate: exportDate.value,
      totalRecords: Number(manifestTotal.value),
    };
  } else {
    corpus = await downloadEnforcementCorpus();
  }
  const previous = await latestJobMetric(
    new SupabaseStore(client),
    'fda_enforcement',
    'totalRecords',
  );
  const previousTotal = typeof previous === 'number' ? previous : null;

  // Plan read-only first, then hold the plan to the authorized count.
  const planned = await runOpenEvidenceSync(evidenceStore, corpus, {
    apply: false,
    previousTotal,
    clear,
  });
  console.log(`\n  ${describeOpenEvidence(planned)}`);
  if (planned.status === 'skipped') {
    console.log('\n  Nothing was written.\n');
    process.exit(apply ? 1 : 0);
  }
  for (const write of planned.writes.slice(0, 20)) {
    console.log(`    · ${write.caseId}: ${write.before ?? 'null'} → ${write.after ?? 'null'}`);
  }
  if (planned.writes.length > 20) console.log(`    … and ${planned.writes.length - 20} more`);

  const aborted = resolveCountGate(mode, planned.writes.length);
  if (aborted) {
    console.error(
      `\n  ✗ ABORTED — ${aborted.reason}.` +
        `\n    authorized ${aborted.expected}, live plan ${aborted.actual}.` +
        '\n    Nothing was written. Re-run the dry run, review the difference, and' +
        '\n    re-authorize with the new count.\n',
    );
    process.exit(1);
  }
  if (!apply) {
    // The printed apply repeats every mode flag this dry run used, so the
    // command an operator copies plans exactly what they just reviewed.
    const modeFlags = [
      ...(clear ? ['--clear'] : []),
      ...(file.value !== null
        ? [
            '--file',
            file.value,
            '--export-date',
            exportDate.value!,
            '--manifest-total',
            manifestTotal.value!,
          ]
        : []),
    ];
    console.log(
      dryRunClosingLine(
        COMMAND,
        planned.writes.length,
        modeFlags.length > 0 ? modeFlags : undefined,
      ),
    );
    return;
  }

  const result = await runOpenEvidenceSync(evidenceStore, corpus, {
    apply: true,
    previousTotal,
    clear,
  });
  console.log(`\n  ${describeOpenEvidence(result)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
