/**
 * FSIS label PDFs → hosted product visuals.
 *
 *   npm run labels:fsis:dry                                      # plan; writes nothing
 *   npm run labels:fsis:dry -- --verify-revisions                # …and audit already-rendered PDFs
 *   npm run labels:fsis:dry -- --limit 8                         # …and render 8 locally to eyeball
 *   npm run labels:fsis -- --apply --confirm --expect <n>        # APPLY (all three, typed)
 *
 * This is the MANUAL historical backfill. The scheduled label work is a
 * different command and a different code path: `npm run jobs:labels`
 * (scripts/run-job.ts → src/server/fsis/label-sync.ts). Nothing in
 * .github/workflows reaches this file — enforced by mutation-cli.test.ts.
 *
 * NO PACKAGE SCRIPT CARRIES `--apply`. It used to: `labels:fsis` was
 * `tsx scripts/render-fsis-labels.ts --apply`, so the upload was a command an
 * operator could run without typing a single acknowledgment (P2B7T). All three
 * flags are typed by a human and refused before a write-capable client exists.
 *
 * `--expect <n>` IS THE NUMBER OF PDFs THIS RUN WOULD UPLOAD. P2B7T could only
 * bind it to the number of PDFs the pass would WALK, because fetch → hash →
 * check → render → upload were interleaved in one loop and the upload count
 * was never known until the run was over — an authorization for the wrong
 * quantity, since a corpus can be exactly the size you reviewed while the set
 * of documents needing work is entirely different. Planning is now a complete
 * separate phase (src/server/fsis/label-backfill.ts) and the count is final
 * before the first upload is reachable.
 *
 * The plan is cheap because `product_visuals` already answers most of it: a
 * PDF with NO rendered rows needs an upload and the database says so without
 * touching FSIS, which is the entire historical-backfill population. Only a
 * PDF that ALREADY has rows needs its bytes to decide — "was it revised in
 * place?" — and that audit is opt-in via `--verify-revisions`. Without it, a
 * plan makes no agency request at all and says plainly that it did not check.
 * (The daily scheduled `jobs:labels --full` sweep owns recent-window
 * re-verification, so the routine path is covered either way.)
 *
 * DRY RUN (default): builds exactly the plan an apply would execute and
 * reports it. `--limit <n>` additionally fetches and renders that many PDFs
 * locally for visual inspection, including the idempotency check (a second
 * render of the same bytes must produce identical content hashes). Nothing is
 * uploaded and nothing is written to the database.
 *
 * APPLY: requires the product_visuals migration (table + `product-visuals`
 * storage bucket). Uploads each rendered page to its content-addressed key and
 * inserts one product_visuals row per page — for exactly the entries the
 * reviewed plan authorized. Every entry is re-verified at the moment of
 * writing, against the sha it was planned with and against the freshest
 * product_visuals state, so uploads land AT or UNDER the authorized count and
 * never over it. Each shortfall is named in the report.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { NormalizedSourceRecord } from '../src/domain/source-record';
import {
  executeLabelBackfill,
  planLabelBackfill,
  type LabelBackfillPlan,
} from '../src/server/fsis/label-backfill';
import { SupabaseLabelStore } from '../src/server/fsis/label-store';
import {
  extractLabelPdfUrls,
  renderLabelPdf,
  sha256,
  MAX_PDF_BYTES,
} from '../src/server/fsis/labels';
import {
  applyCommandLine,
  dryRunClosingLine,
  resolveCountGate,
  resolveFlagValue,
  resolveRepairAuthorization,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
  type MutationCommandForm,
} from '../src/server/repair-authorization';

const COMMAND: MutationCommandForm = { script: 'labels:fsis' };

const HELP = `
FSIS label PDFs → hosted product visuals (MANUAL historical backfill)

  npm run labels:fsis:dry                        plan; writes nothing, fetches nothing
  npm run labels:fsis:dry -- --verify-revisions  …and audit already-rendered PDFs for in-place edits
  npm run labels:fsis:dry -- --limit 8           …and render 8 locally to eyeball
  ${applyCommandLine(COMMAND)}     APPLY — all three flags are required

A production write needs every one of:
  --apply          the intent, typed by a human; no package script supplies it
  --confirm        the repair:* house rule
  --expect <n>     the PLANNED UPLOAD count from the dry run you actually read —
                   the number of PDFs this run would write, not the number it walks

Optional:
  --verify-revisions   fetch and hash the already-rendered PDFs too, so a PDF
                       revised in place is planned as an upload. Without it the
                       plan makes no agency request and says it did not check.
  --limit <n>          dry run only: render this many PDFs locally (default 8;
                       0 plans without fetching anything).

Omit any of the three and the command exits nonzero before opening a database
connection or requesting a single PDF from FSIS. The whole plan is built before
the first upload, so a count that no longer matches aborts with zero uploads.

The SCHEDULED label work is a different command: npm run jobs:labels.
`;

const FETCH_DELAY_MS = 300;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

interface LabelSource {
  sourceRecordId: string;
  recallCaseId: string;
  nativeId: string;
  pdfUrl: string;
}

async function collectSources(client: SupabaseClient): Promise<LabelSource[]> {
  const out: LabelSource[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('source_records')
      .select('id, native_id, recall_case_id, normalized')
      .eq('source_system', 'fsis_api')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`source_records read failed: ${error.message}`);
    for (const row of data ?? []) {
      const normalized = row.normalized as NormalizedSourceRecord;
      for (const pdfUrl of extractLabelPdfUrls(normalized.summaryHtml)) {
        out.push({
          sourceRecordId: row.id as string,
          recallCaseId: row.recall_case_id as string,
          nativeId: row.native_id as string,
          pdfUrl,
        });
      }
    }
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** The agency port, shaped so a failure is data the plan can record. */
async function fetchPdfResult(url: string): Promise<{ bytes: Uint8Array } | { error: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'recall-app label renderer (contact: dev)' },
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (!response.ok) return { error: `HTTP ${response.status}` };
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return { error: `over size cap (${bytes.byteLength} bytes)` };
  }
  return { bytes };
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
  // requested no PDF from FSIS — proved structurally by mutation-cli.test.ts.
  const mode = resolveRepairAuthorization(argv, COMMAND);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
  const apply = mode.apply;
  const verifyRevisions = argv.includes('--verify-revisions');
  const limitFlag = resolveFlagValue(argv, '--limit');
  if (limitFlag.error) {
    console.error(limitFlag.error);
    process.exit(1);
  }
  if (limitFlag.value !== null && !/^\d+$/.test(limitFlag.value)) {
    console.error(`--limit must be a non-negative integer, got "${limitFlag.value}".`);
    process.exit(1);
  }
  // --limit bounds the dry run's LOCAL render sample only. It never bounds the
  // plan: a partial plan would produce a count that does not describe the
  // apply, which is the whole defect this command's contract was fixed for.
  const renderSample = limitFlag.value !== null ? Number(limitFlag.value) : 8;
  // Two thirds of the contract is still a dry run, and says so — an operator
  // must never believe they uploaded because they typed part of it.
  if (!apply && (argv.includes('--confirm') || mode.expectedUpdates !== null)) {
    console.log(DRY_RUN_DESPITE_ACKNOWLEDGMENTS);
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const labelStore = new SupabaseLabelStore(client);

  console.log(
    `\n${'═'.repeat(72)}\nFSIS label backfill — ` +
      `${apply ? 'APPLY' : 'DRY RUN, nothing will be uploaded'}\n${'═'.repeat(72)}\n`,
  );

  // ── PHASE 1: PLAN THE COMPLETE CORPUS. Finishes before a single page can
  // be uploaded, and yields the exact number of PDFs this run would write.
  const sources = await collectSources(client);
  const plan = await planLabelBackfill(sources, {
    visualShasByUrl: (urls) => labelStore.visualShasByUrl(urls),
    fetchPdf: fetchPdfResult,
    hash: sha256,
    verifyRevisions,
    delay: () => sleep(FETCH_DELAY_MS),
    onProgress: (done, total) => {
      if (done === total || done % 100 === 0) {
        process.stdout.write(`  … planned ${done}/${total} PDFs\r`);
      }
    },
  });
  process.stdout.write('\n');
  printPlan(plan, verifyRevisions);

  // ── THE GATE. A count that no longer matches the reviewed plan aborts here,
  // having uploaded nothing.
  const aborted = resolveCountGate(mode, plan.plannedUploads);
  if (aborted) {
    console.error(
      `\n  ✗ ABORTED — ${aborted.reason}.` +
        `\n    authorized ${aborted.expected}, live plan ${aborted.actual} upload(s).` +
        '\n    Nothing was rendered or uploaded. Re-run the dry run, review the' +
        '\n    difference, and re-authorize with the new count.\n',
    );
    process.exit(1);
  }

  if (!apply) {
    await renderLocalSample(plan, renderSample);
    console.log(dryRunClosingLine(COMMAND, plan.plannedUploads));
    return;
  }

  // ── PHASE 2: UPLOAD exactly what the reviewed plan authorized.
  const report = await executeLabelBackfill(plan.entries, {
    visualShasByUrl: (urls) => labelStore.visualShasByUrl(urls),
    fetchPdf: fetchPdfResult,
    hash: sha256,
    render: renderLabelPdf,
    storePages: (target, pages) => labelStore.storePages(target, pages),
    delay: () => sleep(FETCH_DELAY_MS),
    onProgress: (done, total) => process.stdout.write(`  … uploaded ${done}/${total}\r`),
  });
  process.stdout.write('\n');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  authorized uploads:      ${plan.plannedUploads}`);
  console.log(`  PDFs uploaded:           ${report.uploaded}`);
  console.log(`  pages stored:            ${report.pagesStored}`);
  console.log(`  skipped since the plan:  ${report.skipped}`);
  console.log(`  failures:                ${report.failures}`);
  for (const result of report.results) {
    if (result.outcome === 'uploaded') continue;
    console.log(`      · ${result.nativeId} ${result.outcome}: ${result.reason ?? ''}`);
  }
  if (report.uploaded > plan.plannedUploads) {
    console.error('\n  SAFETY VIOLATION: more uploads than were authorized.');
    process.exit(1);
  }
  console.log('\n  ✓ Applied. Re-run the dry run to verify: "No apply needed".\n');
}

/** The plan, printed the same way for a dry run and an apply. */
function printPlan(plan: LabelBackfillPlan, verifyRevisions: boolean): void {
  console.log(`  label PDF links:         ${plan.linksExamined}`);
  console.log(`  distinct PDFs:           ${plan.distinctPdfs}`);
  console.log(`  never rendered:          ${plan.unrendered}`);
  console.log(`  already have pages:      ${plan.alreadyHaveRows}`);
  console.log(
    `  inspected at FSIS:       ${plan.inspected}` +
      (verifyRevisions ? '' : '  (--verify-revisions not given: no agency request made)'),
  );
  console.log(`  fetch failures:          ${plan.fetchFailures.length}`);
  for (const failure of plan.fetchFailures.slice(0, 10)) {
    console.log(`      ✗ ${failure.pdfUrl} — ${failure.reason}`);
  }
  console.log('');
  console.log(`  PLANNED UPLOADS:         ${plan.plannedUploads}   ← this is --expect <n>`);
  console.log(`  already rendered:        ${plan.alreadyRendered}`);
  if (!verifyRevisions && plan.alreadyHaveRows > 0) {
    console.log(
      '\n  NOTE: this plan did NOT check whether an already-rendered PDF was' +
        '\n  revised in place. Add --verify-revisions for that audit (the daily' +
        '\n  scheduled `jobs:labels --full` sweep covers the recent window).',
    );
  }
}

/**
 * Dry run only: fetch and render a bounded sample locally so a human can look
 * at real output, including the idempotency check. Uploads nothing, and never
 * changes the plan or its count.
 */
async function renderLocalSample(plan: LabelBackfillPlan, limit: number): Promise<void> {
  const sample = plan.entries.filter((entry) => entry.outcome === 'upload').slice(0, limit);
  if (sample.length === 0) return;
  const outDir = join(process.cwd(), '.fsis-label-dryrun');
  mkdirSync(outDir, { recursive: true });
  console.log(`\n  Local render sample (${sample.length} of ${plan.plannedUploads} planned):`);

  let pagesRendered = 0;
  let totalBytes = 0;
  for (const entry of sample) {
    console.log(`\n  ${entry.nativeId}: ${entry.pdfUrl}`);
    await sleep(FETCH_DELAY_MS);
    const fetched = await fetchPdfResult(entry.pdfUrl);
    if ('error' in fetched) {
      console.log(`    ✗ ${fetched.error}`);
      continue;
    }
    const pdfHash = sha256(fetched.bytes);
    let pages;
    try {
      const result = await renderLabelPdf(fetched.bytes);
      pages = result.pages;
      console.log(`    duplicate/blank dropped: ${Math.min(result.numPages, 6) - pages.length}`);
    } catch (error) {
      console.log(`    ✗ render failed: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    pagesRendered += pages.length;
    for (const page of pages) totalBytes += page.bytes.byteLength;
    console.log(
      `    ✓ ${pages.length} page(s): ${pages
        .map((p) => `p${p.page} ${p.width}×${p.height} ${(p.bytes.byteLength / 1024).toFixed(0)}KB`)
        .join(', ')}`,
    );
    const again = (await renderLabelPdf(fetched.bytes)).pages;
    const stable =
      again.length === pages.length &&
      again.every((page, index) => page.contentHash === pages[index].contentHash);
    console.log(`    idempotent re-render: ${stable ? 'identical hashes ✓' : 'HASH DRIFT ✗'}`);
    for (const page of pages) {
      writeFileSync(join(outDir, `${pdfHash.slice(0, 12)}-p${page.page}.webp`), page.bytes);
    }
  }
  console.log(`\n  sample pages rendered:   ${pagesRendered}`);
  console.log(`  sample bytes:            ${(totalBytes / 1024).toFixed(0)}KB`);
  console.log(`  sample output:           ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
