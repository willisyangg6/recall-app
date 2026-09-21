/**
 * Historical product-category enrichment — an explicit maintenance command,
 * never scheduled and deliberately separate from production ingestion.
 *
 *   npm run backfill:product-categories:dry                                 # report only, writes nothing
 *   npm run backfill:product-categories -- --apply --confirm --expect <n>   # APPLY (all three, typed)
 *
 * NO PACKAGE SCRIPT CARRIES `--apply`. It used to: `backfill:product-categories`
 * was `tsx scripts/backfill-product-categories.ts --apply`, so the apply was a
 * command an operator could run without typing a single acknowledgment. All
 * three flags are now typed by a human, resolved and refused BEFORE a
 * write-capable database client is constructed, and the whole corpus is
 * planned before the first write (P2B7T).
 *
 * This backfill is DONE (C10B). It remains executable, and gated, rather than
 * deleted so the derivation stays verifiable by dry run.
 *
 * Re-derives `projection.productCategories` for every stored case using the
 * same canonical derivation `projectCase` now owns, from text already
 * persisted with the case. No network, no re-crawl, no re-parse.
 *
 * It writes exactly one field. It never creates a case, never writes a
 * notification event, never runs material-change detection, and never
 * re-dates, re-links or re-orders anything. Re-running is safe and expected:
 * the dry run is the verification report, and after a successful apply it
 * should report "would update: 0".
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import { backfillProductCategories } from '../src/server/category-backfill';
import { FOOD_CATEGORIES, foodCategoryLabel } from '../src/domain/food-category';
import {
  applyCommandLine,
  dryRunClosingLine,
  resolveRepairAuthorization,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
  type MutationCommandForm,
} from '../src/server/repair-authorization';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const COMMAND: MutationCommandForm = { script: 'backfill:product-categories' };

const HELP = `
Historical product-category enrichment (C10A/C10B — already applied)

  npm run backfill:product-categories:dry                       dry run; writes nothing
  ${applyCommandLine(COMMAND)}   APPLY — all three flags are required

A production write needs every one of:
  --apply          the intent, typed by a human; no package script supplies it
  --confirm        the repair:* house rule
  --expect <n>     the planned-change count from the dry run you actually read

Omit any one and the command exits nonzero before opening a database
connection. A count that no longer matches the live corpus aborts the run with
zero writes.
`;

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);

async function main(): Promise<void> {
  loadDotEnv();
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  // ── The authorization contract is resolved FIRST, and nothing below runs
  // until it passes. A refusal here has opened no database connection, so a
  // missing --apply, --confirm or --expect cannot reach a write-capable
  // client at all — proved structurally by mutation-cli.test.ts.
  const mode = resolveRepairAuthorization(argv, COMMAND);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
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
  const store = new SupabaseStore(createSupabaseServerClient(url, secretKey));

  console.log(
    `\n${'═'.repeat(72)}\nProduct-category enrichment — ${apply ? 'APPLY' : 'DRY RUN, nothing will be written'}\n${'═'.repeat(72)}\n`,
  );

  let lastPrinted = 0;
  const report = await backfillProductCategories(store, {
    apply,
    expectedUpdates: mode.expectedUpdates,
    onProgress: (done, total) => {
      if (done === total || done - lastPrinted >= 250) {
        lastPrinted = done;
        process.stdout.write(`  …${done}/${total}\r`);
      }
    },
  });
  process.stdout.write('\n');

  console.log(`\nCORPUS`);
  console.log(`  cases examined:        ${report.casesExamined}`);
  console.log(`  active / inactive:     ${report.active} / ${report.inactive}`);
  console.log(`  FDA / FSIS:            ${report.fda} / ${report.fsis}`);
  console.log(`  already carrying:      ${report.currentlyBearing}`);

  console.log(`\nPLAN`);
  console.log(`  would update:          ${report.wouldUpdate}`);
  console.log(`  of those, over an existing list: ${report.updatesOverExisting}`);
  console.log(`  unchanged:             ${report.unchanged}`);
  console.log(`  case writes performed: ${report.caseWrites}`);

  console.log(`\nWHAT THIS OPERATION CANNOT DO (all zero by construction)`);
  console.log(`  network requests:      ${report.networkRequests}`);
  console.log(`  notification events:   ${report.notificationEvents}`);
  console.log(`  new cases:             ${report.newCases}`);
  console.log(`  timeline writes:       ${report.timelineWrites}`);

  console.log(`\nRESULTING DISTRIBUTION (all cases · active cases)`);
  for (const category of FOOD_CATEGORIES) {
    const all = report.distribution[category.id] ?? 0;
    const active = report.activeDistribution[category.id] ?? 0;
    console.log(
      `  ${foodCategoryLabel(category.id).padEnd(21)} ${String(all).padStart(5)} ${pct(all, report.casesExamined).padStart(7)}` +
        `   ·  ${String(active).padStart(4)} ${pct(active, report.active).padStart(7)}`,
    );
  }
  console.log(
    `  ${'(multi-category)'.padEnd(21)} ${String(report.multiCategory).padStart(5)} ${pct(report.multiCategory, report.casesExamined).padStart(7)}` +
      `   ·  ${String(report.activeMultiCategory).padStart(4)} ${pct(report.activeMultiCategory, report.active).padStart(7)}`,
  );

  if (report.concurrentlyModified.length > 0) {
    console.log(
      `\nCONCURRENTLY MODIFIED (${report.concurrentlyModified.length}) — newer data left untouched, a later run picks them up`,
    );
    for (const id of report.concurrentlyModified.slice(0, 10)) console.log(`  · ${id}`);
  }

  if (report.failures.length > 0) {
    console.log(`\nFAILURES (${report.failures.length})`);
    for (const failure of report.failures.slice(0, 10)) {
      console.log(`  · ${failure.recallCaseId}: ${failure.reason}`);
    }
  }

  if (report.examples.length > 0) {
    console.log(`\nEXAMPLE PLANNED WRITES`);
    for (const example of report.examples) {
      const current = example.current === null ? '(not derived)' : JSON.stringify(example.current);
      console.log(`  · ${example.recallCaseId}  ${current} → ${JSON.stringify(example.next)}`);
    }
  }

  if (report.aborted) {
    console.log(
      `\n  ✗ ABORTED — ${report.aborted.reason}.` +
        `\n    authorized ${report.aborted.expected}, live plan ${report.aborted.actual}.` +
        '\n    Nothing was written. Re-run the dry run, review the difference, and' +
        '\n    re-authorize with the new count.\n',
    );
    process.exit(1);
  }

  console.log(
    apply
      ? '\n  Applied. Re-run the dry run to verify: "No apply needed".\n'
      : dryRunClosingLine(COMMAND, report.plannedChanges),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
