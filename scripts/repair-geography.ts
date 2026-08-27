/**
 * Historical geography repair — an explicit maintenance command, never
 * scheduled and deliberately separate from production ingestion.
 *
 *   npm run repair:geography:dry    # report only, writes nothing
 *   npm run repair:geography        # apply the geography writes
 *
 * Re-derives `projection.geography` for every stored case using the same
 * canonical derivation `projectCase` now owns, from text already persisted
 * with the case. No network, no re-crawl, no re-parse of source payloads.
 *
 * It writes exactly one field. It never creates a case, never writes a
 * notification event, never runs material-change detection, and never re-dates
 * or re-links anything. Re-running is safe and expected: the dry run is the
 * verification report, and after a successful apply it should report
 * "would update: 0".
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import type { USStateCode } from '../src/domain/preferences';
import { evaluatePersonalRelevance } from '../src/lib/relevance';
import {
  planCaseGeography,
  repairGeography,
  type GeographyCasePlan,
} from '../src/server/geography-repair';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const apply = process.argv.includes('--apply');

/** Representative profiles, mirroring the personalization QA report. */
const PROFILES: [USStateCode, string][] = [
  ['WA', 'Washington'],
  ['VA', 'Virginia'],
  ['TX', 'Texas'],
  ['NY', 'New York'],
];

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

function scopeLine(census: { nationwide: number; states: number; unknown: number }): string {
  return `nationwide ${census.nationwide}, states ${census.states}, unknown ${census.unknown}`;
}

function describe(plan: GeographyCasePlan): string {
  const show = (geography: GeographyCasePlan['current']) =>
    geography.scope === 'states' ? `states[${geography.states.join(', ')}]` : geography.scope;
  return `${show(plan.current)} → ${show(plan.next)}`;
}

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
    `\n${'═'.repeat(72)}\nGeography repair — ${apply ? 'APPLY' : 'DRY RUN, nothing will be written'}\n${'═'.repeat(72)}\n`,
  );

  // Loaded once so the personalization effect below is measured against the
  // same rows the repair planned from.
  const before = await store.listCases();

  let lastPrinted = 0;
  const report = await repairGeography(store, {
    apply,
    onProgress: (done, total) => {
      if (done === total || done - lastPrinted >= 250) {
        lastPrinted = done;
        process.stdout.write(`  … ${done}/${total} cases examined\r`);
      }
    },
  });
  process.stdout.write('\n\n');

  console.log('  Cases examined:                 ', report.casesExamined);
  console.log(`      active / inactive:           ${report.active} / ${report.inactive}`);
  console.log(`      FDA / FSIS:                  ${report.fda} / ${report.fsis}`);
  console.log('');
  console.log(`  Geography before:                ${scopeLine(report.before)}`);
  console.log(`  Geography after:                 ${scopeLine(report.after)}`);
  console.log(`      active before:               ${scopeLine(report.activeBefore)}`);
  console.log(`      active after:                ${scopeLine(report.activeAfter)}`);
  console.log('');
  console.log(
    `  Unknown → known (safely correctable): ${report.safelyCorrectable} (active ${report.activeSafelyCorrectable})`,
  );
  console.log(
    `  Remaining unknown (honest):           ${report.remainingUnknown} (active ${report.activeRemainingUnknown})`,
  );
  console.log('');
  console.log(
    `  ${apply ? 'Updated' : 'Would update'}:                    ${report.wouldUpdate} (active ${report.activeWouldUpdate})`,
  );
  console.log('      state additions:             ', report.stateAdditions);
  console.log('      state removals:              ', report.stateRemovals);
  console.log('  Unchanged (already correct):    ', report.unchanged);
  console.log('  No distribution evidence:       ', report.noEvidence);
  console.log('  Conflicts (left untouched):     ', report.conflicts.length);
  console.log(
    '  Changed by ingest mid-run:      ',
    report.concurrentlyModified.length,
    '(newer data kept; rerun picks them up)',
  );
  console.log('  Failures:                       ', report.failures.length);
  for (const failure of report.failures.slice(0, 10)) {
    console.log(`      ✗ ${failure.recallCaseId} — ${failure.reason}`);
  }
  console.log('');
  console.log(
    `  scope/state-list contradictions: ${report.contradictionsBefore} → ${report.contradictionsAfter} (gate: 0)`,
  );
  console.log(
    '  Table fragments NOT interpreted: ',
    report.unresolvedTokens.length === 0 ? '—' : report.unresolvedTokens.join(', '),
  );
  console.log('');
  console.log('  Network requests:               ', report.networkRequests, '(stored data only)');
  console.log(`  DB writes ${apply ? 'performed' : 'that WOULD occur'}:`);
  console.log(
    '      recall_cases (geography):    ',
    apply ? report.caseWrites : report.wouldUpdate,
  );
  console.log('      NotificationEvents:           ', report.notificationEvents);
  console.log('      new RecallCases:              ', report.newCases);
  console.log('      notifications sent:           0');
  console.log('      push deliveries changed:      0');

  if (report.conflicts.length > 0) {
    console.log('\n  Conflicts — a stated state would be dropped, left for review:');
    for (const conflict of report.conflicts.slice(0, 20)) {
      console.log(
        `    · ${conflict.recallCaseId} (${conflict.sourceAgency}, ${conflict.lifecycle})  ${describe(conflict)}`,
      );
    }
  }

  if (report.examples.length > 0) {
    console.log(`\n  Examples${apply ? '' : ' of the updates that would be written'}:`);
    for (const example of report.examples) {
      console.log(`    · ${example.recallCaseId} (${example.sourceAgency}, ${example.lifecycle})`);
      console.log(
        `      ${describe(example)}   [${example.bases.join('+') || 'carried'}]` +
          `${example.removedStates.length > 0 ? `  removed ${example.removedStates.join(', ')}` : ''}`,
      );
    }
  }

  // What this changes for a person: geographic relevance per profile over
  // ACTIVE cases, recomputed from the same pure planner the report used, so
  // the preview covers every planned update rather than a sample.
  const activeBeforeRows = before.filter((row) => row.projection.state === 'active');
  const planned = activeBeforeRows.map((row) => {
    const plan = planCaseGeography(row);
    return {
      projection: row.projection,
      after: plan.outcome === 'conflict' ? plan.current : plan.next,
    };
  });
  console.log('\n  Effect on representative profiles (active cases):');
  for (const [code, stateName] of PROFILES) {
    const census = (which: 'before' | 'after') => {
      let matches = 0;
      let unknown = 0;
      let excluded = 0;
      for (const entry of planned) {
        const relevance = evaluatePersonalRelevance(
          {
            geography: which === 'after' ? entry.after : entry.projection.geography,
            pathogenOrAllergen: entry.projection.pathogenOrAllergen,
            retailerNames: entry.projection.retailerNames ?? [],
          },
          { state: code, allergens: [], retailers: [] },
        );
        if (relevance.geographic === 'matches') matches += 1;
        else if (relevance.geographic === 'unknown') unknown += 1;
        else excluded += 1;
      }
      return `matches ${matches}, unknown ${unknown}, excluded ${excluded}`;
    };
    console.log(`      ${stateName.padEnd(12)} before: ${census('before')}`);
    console.log(`      ${' '.repeat(12)} after:  ${census('after')}`);
  }

  if (report.notificationEvents !== 0 || report.newCases !== 0) {
    console.error('\n  SAFETY VIOLATION: a repair must never notify or create cases.');
    process.exit(1);
  }
  if (report.contradictionsAfter !== 0) {
    console.error('\n  SAFETY VIOLATION: geography contradictions must remain zero.');
    process.exit(1);
  }
  console.log(
    apply
      ? '\n  ✓ Applied. Re-run at any time — the operation is idempotent.\n'
      : '\n  Dry run complete — nothing was written. Apply with: npm run repair:geography\n',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
