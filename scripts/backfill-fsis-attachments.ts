/**
 * FSIS attachment backfill — read the official PDFs linked by EXISTING FSIS
 * notices for verified product facts, and caption their already-rendered
 * label pages.
 *
 *   npm run backfill:fsis-attachments:dry -- --native-id PHA-11142026,PHA-11062026-01
 *   npm run backfill:fsis-attachments -- --native-id <ids> --apply --confirm --expect <n>
 *   npm run backfill:fsis-attachments:dry -- --all-history      # plan the whole corpus
 *
 * The scheduled labels job already does this for the recent window; this CLI
 * is the ONLY path to older notices, and it is gated by the shared
 * authorization contract (repair-authorization.ts): a dry run by default, an
 * apply only with --apply, --confirm and the reviewed --expect count.
 *
 * The dry run fetches and reads the PDFs (agency GETs only) so the plan
 * shows real before/after values, and it writes NOTHING: no attachment
 * rows, no captions, no normalized record, no projection. It ends with a
 * read-only census of the other FSIS notices whose attachments the same
 * rule would read.
 *
 * Whatever is applied touches the record's attachment block and the case's
 * product fields only — never the timeline, the affected-product rows or
 * `last_changed_at` — so it cannot notify.
 */

import {
  applyCommandLine,
  dryRunClosingLine,
  resolveFlagValue,
  resolveRepairAuthorization,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
  type MutationCommandForm,
} from '../src/server/repair-authorization';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';
import { SupabaseAttachmentStore } from '../src/server/fsis/attachment-store';
import { syncFsisAttachments } from '../src/server/fsis/attachment-sync';
import { discoverFsisAttachments } from '../src/server/fsis/attachments';

const COMMAND: MutationCommandForm = {
  script: 'backfill:fsis-attachments',
  extraApplyFlags: ['--native-id <ids>'],
};

const HELP = `
FSIS attachment backfill

  npm run backfill:fsis-attachments:dry -- --native-id <ids>     dry run; writes nothing
  ${applyCommandLine(COMMAND)}   APPLY

  --native-id <ids>   comma-separated FSIS recall numbers (e.g. PHA-11142026)
  --all-history       every FSIS notice instead (dry run recommended first)

A production write needs every one of --apply, --confirm and --expect <n>
(the planned-write count from the dry run you actually read). Omit any one
and the command exits nonzero before opening a database connection.
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

  // The authorization contract is resolved FIRST; nothing below runs until
  // it passes, so a refusal has opened no connection.
  const mode = resolveRepairAuthorization(argv, COMMAND);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
  const ids = resolveFlagValue(argv, '--native-id');
  if (ids.error) {
    console.error(ids.error);
    process.exit(1);
  }
  const allHistory = argv.includes('--all-history');
  const nativeIds = ids.value
    ? ids.value
        .split(',')
        .map((id) => id.trim().toUpperCase())
        .filter((id) => id !== '')
    : undefined;
  if (!nativeIds && !allHistory) {
    console.error(
      'Name the notices with --native-id <ids>, or pass --all-history.\nNothing was written.',
    );
    process.exit(1);
  }
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
  const store = new SupabaseAttachmentStore(client);

  console.log(
    `\n${'═'.repeat(72)}\nFSIS attachment backfill — ${apply ? 'APPLY' : 'DRY RUN, nothing will be written'}\n${'═'.repeat(72)}\n`,
  );

  const plan = await syncFsisAttachments(store, {
    mode: 'full',
    dryRun: true,
    nativeIds,
    allHistory: true,
    maxPdfs: 500,
    log: (line) => console.log(line),
  });
  const writes = plan.plan.filter((entry) => entry.write || entry.captionsToWrite > 0);
  for (const entry of plan.plan) {
    console.log(`\n  ${entry.nativeId}  (case ${entry.recallCaseId})`);
    console.log(`    before: ${JSON.stringify(entry.before)}`);
    console.log(`    after:  ${JSON.stringify(entry.after)}`);
    console.log(`    label-page captions to write: ${entry.captionsToWrite}`);
    for (const source of entry.sources) {
      const reasons =
        source.reviewReasons.length > 0 ? ` — ${source.reviewReasons.join('; ')}` : '';
      console.log(
        `    ${source.status.padEnd(12)} ${source.kind.padEnd(12)} "${source.linkText}" ${source.url}${reasons}`,
      );
    }
    console.log(`    ${entry.write ? 'WOULD WRITE' : 'no enrichment change'}`);
  }

  if (!apply) {
    await census(client, new Set(plan.plan.map((entry) => entry.nativeId)));
    console.log(
      dryRunClosingLine(
        COMMAND,
        writes.length,
        nativeIds ? [`--native-id ${nativeIds.join(',')}`] : ['--all-history'],
      ),
    );
    return;
  }

  if (mode.expectedUpdates !== writes.length) {
    console.error(
      `\n  The plan now has ${writes.length} write(s); you reviewed ${mode.expectedUpdates}. ` +
        'The corpus moved — re-run the dry run. Nothing was written.',
    );
    process.exit(1);
  }
  const applied = await syncFsisAttachments(store, {
    mode: 'full',
    nativeIds,
    allHistory: true,
    maxPdfs: 500,
    log: (line) => console.log(line),
  });
  console.log(
    `\n  Applied: ${applied.enrichmentsApplied} enrichment(s), ${applied.captionsWritten} caption(s); ` +
      `${applied.enrichmentConflicts} conflict(s) left for the next run.`,
  );
}

/**
 * Read-only: how many OTHER FSIS notices link attachments the same rule
 * reads — the scope a historical rollout would touch.
 */
async function census(
  client: ReturnType<typeof createSupabaseServerClient>,
  exclude: Set<string>,
): Promise<void> {
  const counts = {
    notices: 0,
    active: 0,
    productList: 0,
    labels: 0,
    both: 0,
    productListActive: 0,
  };
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('source_records')
      .select('native_id, summaryHtml:normalized->>summaryHtml, recall_cases!inner(state)')
      .eq('source_system', 'fsis_api')
      .like('normalized->>summaryHtml', '%.pdf%')
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`census failed: ${error.message}`);
    for (const row of data ?? []) {
      const record = row as unknown as {
        native_id: string;
        summaryHtml: string | null;
        recall_cases: { state: string } | { state: string }[];
      };
      if (exclude.has(record.native_id)) continue;
      const kinds = new Set(discoverFsisAttachments(record.summaryHtml).map((a) => a.kind));
      const list = kinds.has('product_list');
      const labels = kinds.has('labels');
      if (!list && !labels) continue;
      const state = Array.isArray(record.recall_cases)
        ? record.recall_cases[0]?.state
        : record.recall_cases.state;
      counts.notices += 1;
      if (state === 'active') counts.active += 1;
      if (list) counts.productList += 1;
      if (labels) counts.labels += 1;
      if (list && labels) counts.both += 1;
      if (list && state === 'active') counts.productListActive += 1;
    }
    if (!data || data.length < pageSize) break;
  }
  console.log('\n  Census (read-only) — OTHER FSIS notices linking attachments this rule reads:');
  console.log(
    `    notices with a product-list or label PDF:   ${counts.notices} (${counts.active} active)`,
  );
  console.log(
    `    with a product-list PDF:                    ${counts.productList} (${counts.productListActive} active)`,
  );
  console.log(`    with a label PDF:                           ${counts.labels}`);
  console.log(`    with both:                                  ${counts.both}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
