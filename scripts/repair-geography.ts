/**
 * Canonical geography repair — an explicit maintenance command, never
 * scheduled and deliberately separate from production ingestion.
 *
 *   npm run repair:geography:dry                                   # report only, writes nothing
 *   npm run repair:geography:dry -- --drift-audit                  # …plus what a re-projection would also change
 *   npm run repair:geography -- --apply --confirm --expect <n>     # APPLY (requires ALL THREE, typed)
 *   npm run repair:geography:dry                                   # verify: "would update" must be 0
 *   npm run repair:geography:rollback -- <ledger.json> --apply --confirm --expect <n>
 *   npm run repair:geography -- --help                             # the contract, at the terminal
 *
 * NO PACKAGE SCRIPT CARRIES `--apply`. It used to: `repair:geography` was
 * `tsx scripts/repair-geography.ts --apply`, so an operator who typed only
 * `--confirm --expect <n>` was applying without ever writing the word, and the
 * documented command did not match the documented contract. The flag is now
 * typed by a human or the run is a dry run.
 *
 * Re-derives `projection.geography` for every stored case using the same
 * canonical derivation `projectCase` now owns (domain/geography-evidence.ts),
 * from text already persisted with the case. No network, no re-crawl, no
 * re-parse of source payloads, and no repair-only parser.
 *
 * It writes exactly one field. It never creates a case, never writes a
 * notification event, never runs material-change detection, never adds a
 * timeline entry, and never re-dates or re-links anything. Re-running is safe
 * and expected: the dry run is the verification report, and after a successful
 * apply it should report "would update: 0".
 *
 * THREE acknowledgments are required before a single write is reachable:
 * `--apply` (the intent), `--confirm` (the repair:* house rule), and
 * `--expect <n>` (the correction count from the reviewed dry run). All three
 * are resolved and refused BEFORE a write-capable database client is
 * constructed — a missing or malformed one exits nonzero having opened no
 * connection at all. The whole corpus is then planned before any write is
 * constructed, so a corpus that has drifted since the review aborts the run
 * having written nothing. The same three govern a rollback.
 *
 * DURABLE LEDGER: an apply always leaves a complete machine-readable report
 * behind rather than trusting terminal scrollback, including the before/after
 * geography of every case written — which is the rollback data. `--json <path>`
 * writes it where you ask; with no `--json`, an apply writes a timestamped
 * report to ./.reports/ (git-ignored) and prints the path. A dry run writes one
 * only when `--json` is given.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Geography } from '../src/domain/recall-types';
import type { USStateCode } from '../src/domain/preferences';
import { evaluatePersonalRelevance } from '../src/lib/relevance';
import {
  auditGeographyReprojectionDrift,
  planCaseGeography,
  repairGeography,
  GEOGRAPHY_REPAIR_COMMAND,
  GEOGRAPHY_ROLLBACK_COMMAND,
  rollbackGeography,
  type GeographyCasePlan,
  type GeographyDriftRow,
  type GeographyRepairReport,
  type GeographyRollbackEntry,
} from '../src/server/geography-repair';
import {
  applyCommandLine,
  dryRunClosingLine,
  resolveFlagValue,
  resolvePositional,
  resolveRepairAuthorization,
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
} from '../src/server/repair-authorization';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

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

/**
 * Flags that consume the argument after them, so `--expect 61 ledger.json`
 * finds ledger.json rather than reading "61" as the ledger path.
 */
const VALUE_FLAGS = ['--json', '--expect'];

const HELP = `
Canonical geography repair (P2B7Q.2)

  npm run repair:geography:dry                                 dry run; writes nothing
  npm run repair:geography:dry -- --drift-audit                …and what a re-projection would also change
  npm run repair:geography:dry -- --json <path>                …and write the ledger where you want it
  ${applyCommandLine(GEOGRAPHY_REPAIR_COMMAND)}   APPLY — all three flags are required
  ${applyCommandLine(GEOGRAPHY_ROLLBACK_COMMAND)}

A production write needs every one of:
  --apply          the intent, typed by a human; no package script supplies it
  --confirm        the repair:* house rule
  --expect <n>     the correction count from the dry run you actually read

Omit any one and the command exits nonzero before opening a database
connection. --dry-run alongside --apply is refused rather than resolved. A
count that no longer matches the live corpus aborts the run with zero writes.
`;

function scopeLine(census: { nationwide: number; states: number; unknown: number }): string {
  return `nationwide ${census.nationwide}, states ${census.states}, unknown ${census.unknown}`;
}

function show(geography: Geography): string {
  return geography.scope === 'states' ? `states[${geography.states.join(', ')}]` : geography.scope;
}

function describe(plan: GeographyCasePlan): string {
  return `${show(plan.current)} → ${show(plan.next)}`;
}

function writeLedger(
  report: GeographyRepairReport,
  drift: GeographyDriftRow[],
  apply: boolean,
  jsonPath: string | null,
): void {
  let target = jsonPath;
  if (target === null) {
    if (!apply) return; // a dry run writes one only on request
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    mkdirSync('.reports', { recursive: true });
    target = path.join('.reports', `repair-geography-${stamp}.json`);
  }
  const parent = path.dirname(target);
  if (parent !== '' && parent !== '.') mkdirSync(parent, { recursive: true });
  writeFileSync(
    target,
    JSON.stringify(
      {
        operation: 'repair-geography',
        mode: apply ? 'apply' : 'dry-run',
        finishedAt: new Date().toISOString(),
        counts: {
          casesExamined: report.casesExamined,
          plannedCorrections: report.wouldUpdate,
          activePlannedCorrections: report.activeWouldUpdate,
          stateAdditions: report.stateAdditions,
          stateRemovals: report.stateRemovals,
          unknownToStates: report.unknownToStates,
          statesToUnknown: report.statesToUnknown,
          toNationwide: report.toNationwide,
          fromNationwide: report.fromNationwide,
          unchanged: report.unchanged,
          noEvidence: report.noEvidence,
          conflicts: report.conflicts.length,
          refusedContradictory: report.refused.length,
          appliedCaseWrites: report.caseWrites,
          verifiedWrites: report.verifiedWrites,
          verificationFailures: report.verificationFailures.length,
          conflictedWrites: report.concurrentlyModified.length,
          failures: report.failures.length,
          notificationEvents: report.notificationEvents,
          timelineEntries: report.timelineEntries,
          materialChanges: report.materialChanges,
          newCases: report.newCases,
          networkRequests: report.networkRequests,
        },
        // Restore data: replaying these previousValues through
        // updateCaseGeography returns the corpus to its pre-apply state.
        rollback: report.rollback,
        reprojectionDrift: drift,
        report,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\n  Durable ledger written to ${target}`);
}

async function runRollback(
  store: SupabaseStore,
  ledgerPath: string,
  mode: { apply: boolean; expectedUpdates: number | null },
): Promise<void> {
  // The mode arrives already resolved from the operator's own flags. It is
  // NOT synthesized here: this function used to append `--apply` itself, which
  // made a rollback write reachable without anyone typing the word.
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const entries: GeographyRollbackEntry[] = ledger.rollback ?? [];
  console.log(
    `\n${'═'.repeat(72)}\nGeography rollback — ${mode.apply ? 'APPLY' : 'DRY RUN, nothing will be written'}` +
      `\n${'═'.repeat(72)}\n\n  Ledger: ${ledgerPath}\n  Entries: ${entries.length}\n`,
  );
  const report = await rollbackGeography(store, entries, {
    apply: mode.apply,
    expectedUpdates: mode.expectedUpdates,
  });
  if (report.aborted) {
    console.log(
      `  ✗ ABORTED — ${report.aborted.reason}.` +
        `\n    authorized ${report.aborted.expected}, ledger ${report.aborted.actual}. Nothing was written.\n`,
    );
    process.exit(1);
  }
  console.log('  Restored:                       ', report.restored);
  console.log('  Verified from live state:       ', report.verified);
  console.log('  Skipped (row no longer as written):', report.skippedNotAsWritten.length);
  console.log('  Skipped (concurrent ingest):    ', report.concurrentlyModified.length);
  console.log('  Failures:                       ', report.failures.length);
  console.log(
    mode.apply
      ? '\n  Done.\n'
      : entries.length === 0
        ? '\n  Dry run complete — nothing was written.' +
          '\n  No apply needed: the ledger holds no entries to restore.\n'
        : '\n  Dry run complete — nothing was written. Restore with:' +
          `\n    ${applyCommandLine({ ...GEOGRAPHY_ROLLBACK_COMMAND, positional: ledgerPath }, entries.length)}\n`,
  );
}

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
  // client at all — proved structurally by repair-cli.test.ts.
  // `--rollback` selects the mode and carries NO authorization: a rollback
  // write needs the same three typed flags an apply needs, plus its ledger.
  const rollback = argv.includes('--rollback');
  const form = rollback ? GEOGRAPHY_ROLLBACK_COMMAND : GEOGRAPHY_REPAIR_COMMAND;
  const mode = resolveRepairAuthorization(
    argv.filter((arg) => arg !== '--rollback'),
    form,
  );
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
  const json = resolveFlagValue(argv, '--json');
  if (json.error) {
    console.error(json.error);
    process.exit(1);
  }
  const jsonPath = json.value;
  const wantsDriftAudit = argv.includes('--drift-audit');
  const ledgerPath = rollback ? resolvePositional(argv, VALUE_FLAGS) : null;
  if (rollback && ledgerPath === null) {
    console.error(
      'Rollback needs the apply ledger path:\n' +
        `  ${applyCommandLine(GEOGRAPHY_ROLLBACK_COMMAND)}`,
    );
    process.exit(1);
  }
  // A dry run that carries the apply acknowledgments but not the intent is
  // still a dry run, and says so — an operator must never believe they have
  // applied because they typed two thirds of the contract.
  if (!mode.apply && (argv.includes('--confirm') || mode.expectedUpdates !== null)) {
    console.log(DRY_RUN_DESPITE_ACKNOWLEDGMENTS);
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const store = new SupabaseStore(createSupabaseServerClient(url, secretKey));

  if (rollback) {
    await runRollback(store, ledgerPath!, mode);
    return;
  }

  console.log(
    `\n${'═'.repeat(72)}\nCanonical geography repair (P2B7Q.2) — ` +
      `${mode.apply ? 'APPLY' : 'DRY RUN, nothing will be written'}\n${'═'.repeat(72)}\n`,
  );
  if (mode.apply) {
    console.log(
      '  ⚠  THIS WRITES TO THE PRODUCTION DATABASE.\n' +
        `     It will correct projection.geography on exactly ${mode.expectedUpdates} case(s)\n` +
        '     and abort without writing anything if the live count differs.\n' +
        '     Nothing else is touched: no timeline, no dates, no material change,\n' +
        '     no notification-ledger row, and push stays inactive.\n',
    );
  }

  // Loaded once so the personalization effect below is measured against the
  // same rows the repair planned from.
  const before = await store.listCases();

  let lastPrinted = 0;
  const report = await repairGeography(store, {
    apply: mode.apply,
    expectedUpdates: mode.expectedUpdates,
    onProgress: (done, total) => {
      if (done === total || done - lastPrinted >= 250) {
        lastPrinted = done;
        process.stdout.write(`  … ${done}/${total} cases examined\r`);
      }
    },
  });
  process.stdout.write('\n\n');

  const drift = wantsDriftAudit
    ? await auditGeographyReprojectionDrift(
        store,
        report.plans.map((plan) => plan.recallCaseId),
      )
    : [];

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
    `  ${mode.apply ? 'Updated' : 'Would update'}:                    ${report.wouldUpdate} (active ${report.activeWouldUpdate})`,
  );
  console.log('      state additions:             ', report.stateAdditions);
  console.log('      state removals:              ', report.stateRemovals);
  console.log('      unknown → states:            ', report.unknownToStates);
  console.log('      states → unknown:            ', report.statesToUnknown);
  console.log('      → nationwide:                ', report.toNationwide);
  console.log('      nationwide →:                ', report.fromNationwide);
  console.log('  Unchanged (already correct):    ', report.unchanged);
  console.log('  No distribution evidence:       ', report.noEvidence);
  console.log('  Conflicts (left untouched):     ', report.conflicts.length);
  console.log('  Refused — notice contradicts itself:', report.refused.length);
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
  console.log('  Structural attestations (zero by construction):');
  console.log('      network requests:      ', report.networkRequests, '(stored data only)');
  console.log('      notification events:   ', report.notificationEvents);
  console.log('      timeline entries:      ', report.timelineEntries);
  console.log('      material changes:      ', report.materialChanges);
  console.log('      cases created:         ', report.newCases);
  console.log('      notifications sent:     0');
  console.log('      push deliveries changed:0');

  if (report.conflicts.length > 0) {
    console.log('\n  Conflicts — a stated state would be dropped, left for review:');
    for (const conflict of report.conflicts.slice(0, 20)) {
      console.log(
        `    · ${conflict.recallCaseId} (${conflict.sourceAgency}, ${conflict.lifecycle})  ${describe(conflict)}`,
      );
    }
  }

  if (report.refused.length > 0) {
    console.log('\n  Refused — the notice affirms and rules out the same place:');
    for (const refused of report.refused.slice(0, 20)) {
      console.log(`    · ${refused.recallCaseId} — ${refused.contradictedStates.join(', ')}`);
    }
  }

  console.log('\n  Corrections:');
  for (const plan of report.plans) {
    console.log(`    · ${plan.recallCaseId} (${plan.sourceAgency}, ${plan.lifecycle})`);
    console.log(
      `      ${describe(plan)}   [${plan.bases.join('+') || 'carried'}]` +
        `${plan.addedStates.length > 0 ? `  +${plan.addedStates.join(', ')}` : ''}`,
    );
    for (const removal of plan.removals) {
      console.log(`      − ${removal.state} (${removal.reason})`);
    }
    for (const sentence of plan.evidence) console.log(`      evidence: "${sentence}"`);
  }

  if (wantsDriftAudit) {
    const withOtherChanges = drift.filter(
      (row) => row.unavailable === null && row.otherFieldsChanged.length > 0,
    );
    const wouldNotify = drift.filter((row) => row.wouldRaiseGeographyExpansion);
    const fields = new Map<string, number>();
    for (const row of drift) {
      for (const key of row.otherFieldsChanged) fields.set(key, (fields.get(key) ?? 0) + 1);
    }
    console.log('\n  What a NORMAL re-projection would additionally do:');
    console.log(
      `      cases also changing other projected fields: ${withOtherChanges.length}/${drift.length}`,
    );
    for (const [key, count] of [...fields].sort((a, b) => b[1] - a[1])) {
      console.log(`          ${key}: ${count}`);
    }
    console.log(
      `      cases raising an expansion_geography notification: ${wouldNotify.length}` +
        ' (this repair raises 0)',
    );
  }

  if (mode.apply) {
    console.log('\n  Case writes applied:            ', report.caseWrites);
    console.log('  Writes verified from live state:', report.verifiedWrites);
    console.log('  Verification failures:          ', report.verificationFailures.length);
    for (const failure of report.verificationFailures) {
      console.log(
        `      ✗ ${failure.recallCaseId}: expected ${show(failure.expected)}, found ${failure.found ? show(failure.found) : 'nothing'}`,
      );
    }
  }

  if (report.aborted) {
    console.log(
      `\n  ✗ ABORTED — ${report.aborted.reason}.` +
        `\n    authorized ${report.aborted.expected}, live plan ${report.aborted.actual}.` +
        '\n    Nothing was written. Re-run the dry run, review the difference, and' +
        '\n    re-authorize with the new count.',
    );
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
            hazardCategory: entry.projection.hazardCategory,
            reasonText: entry.projection.reasonText,
          },
          { states: [code], allergens: [], retailers: [] },
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

  writeLedger(report, drift, mode.apply, jsonPath);

  if (report.notificationEvents !== 0 || report.newCases !== 0) {
    console.error('\n  SAFETY VIOLATION: a repair must never notify or create cases.');
    process.exit(1);
  }
  if (report.contradictionsAfter !== 0) {
    console.error('\n  SAFETY VIOLATION: geography contradictions must remain zero.');
    process.exit(1);
  }

  const drifted = report.aborted !== null;
  const unverified = mode.apply && report.verifiedWrites !== report.caseWrites;
  const failed = report.failures.length > 0;
  if (drifted || unverified || failed) {
    console.log('');
    process.exit(1);
  }
  console.log(
    mode.apply
      ? '\n  Done. Re-run the dry run to verify: "No apply needed".\n'
      : dryRunClosingLine(GEOGRAPHY_REPAIR_COMMAND, report.plannedChanges),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
