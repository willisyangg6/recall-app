/**
 * Historical product-category enrichment — an explicit maintenance command,
 * never scheduled and deliberately separate from production ingestion.
 *
 *   npm run backfill:product-categories:dry    # report only, writes nothing
 *   npm run backfill:product-categories        # apply the category writes
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
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const apply = process.argv.includes('--apply');

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

  console.log(
    apply
      ? `\nApplied. Re-run the dry run to verify — expect "would update: 0".\n`
      : `\nDry run only. Nothing was written.\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
