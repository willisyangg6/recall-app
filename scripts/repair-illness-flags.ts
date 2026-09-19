/**
 * Stale illness-flag correction (P2B7L) — an explicit maintenance command,
 * never scheduled and deliberately separate from production ingestion.
 *
 *   npm run repair:illness-flags:dry                            # report only, writes nothing
 *   npm run repair:illness-flags:dry -- --drift-audit           # …plus what a re-projection would also change
 *   npm run repair:illness-flags -- --confirm --expect <n>      # APPLY (requires ALL THREE)
 *   npm run repair:illness-flags:dry                            # verify: "would change" must be 0
 *
 * Re-derives `projection.reportsIllness` for every stored case from the
 * `projection.summaryText` already persisted beside it, through the canonical
 * `deriveIllnessStatus` / `statusReportsIllness` that `projectCase` and Recall
 * Detail both call, and corrects exactly that one Boolean. No network, no
 * re-crawl, no snapshot changes, no timeline/date changes, no material-change
 * detection, no notification-ledger rows, no push — see
 * src/server/illness-repair.ts for the full safety contract.
 *
 * THREE acknowledgments are required before a single write is reachable:
 * `--apply` (the intent), `--confirm` (the repair:* house rule), and
 * `--expect <n>` (the correction count from the reviewed dry run). If the live
 * corpus has drifted from that count the run aborts having written nothing and
 * exits nonzero — the operator re-reviews rather than the command guessing
 * which of the two numbers was meant.
 *
 * DURABLE LEDGER: an apply always leaves a complete machine-readable report
 * behind rather than trusting terminal scrollback, including the before/after
 * value of every case written — which is the rollback data. `--json <path>`
 * writes it where you ask; with no `--json`, an apply writes a timestamped
 * report to ./.reports/ (git-ignored) and prints the path. A dry run writes one
 * only when `--json` is given.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  auditReprojectionDrift,
  repairIllnessFlags,
  resolveIllnessRepairMode,
  type IllnessFlagCasePlan,
  type IllnessRepairReport,
  type ReprojectionDriftRow,
} from '../src/server/illness-repair';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

function jsonPathFromArgv(argv: string[]): string | null {
  const index = argv.indexOf('--json');
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    console.error('--json requires a file path argument.');
    process.exit(1);
  }
  return value;
}

/** A bounded quote of the official sentence the classifier read. */
function quote(sentence: string): string {
  const clean = sentence.replace(/\s+/g, ' ').trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
}

function describe(plan: IllnessFlagCasePlan, drift: ReprojectionDriftRow | undefined): void {
  const count =
    plan.illnesses === null
      ? plan.statusKind
      : `${plan.statusKind} (${plan.approximate ? '~' : ''}${plan.illnesses})`;
  console.log(
    `    · case ${plan.recallCaseId} — ${plan.sourceAgency}, ${plan.lifecycle}` +
      `\n        reportsIllness ${plan.storedValue} → ${plan.derivedValue}   [${count}]`,
  );
  for (const sentence of plan.evidence) console.log(`        evidence: "${quote(sentence)}"`);
  if (plan.evidence.length === 0) {
    console.log('        evidence: none — the notice establishes no illness status');
  }
  if (drift) {
    if (drift.unavailable !== null) {
      console.log(`        re-projection drift: unavailable (${drift.unavailable})`);
    } else if (drift.otherFieldsChanged.length === 0) {
      console.log('        re-projection drift: no other projected field would change');
    } else {
      console.log(
        `        re-projection drift: would ALSO change ${drift.otherFieldsChanged.join(', ')}`,
      );
    }
    if (drift.wouldRaiseHealthImpact) {
      console.log('        via the pipeline this case would raise a health_impact notification');
    }
  }
}

function writeLedger(
  report: IllnessRepairReport,
  drift: ReprojectionDriftRow[],
  apply: boolean,
  jsonPath: string | null,
): void {
  let target = jsonPath;
  if (target === null) {
    if (!apply) return; // a dry run writes one only on request
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    mkdirSync('.reports', { recursive: true });
    target = path.join('.reports', `repair-illness-flags-${stamp}.json`);
  }
  const parent = path.dirname(target);
  if (parent !== '' && parent !== '.') mkdirSync(parent, { recursive: true });
  writeFileSync(
    target,
    JSON.stringify(
      {
        operation: 'repair-illness-flags',
        mode: apply ? 'apply' : 'dry-run',
        finishedAt: new Date().toISOString(),
        counts: {
          casesExamined: report.casesExamined,
          plannedCorrections: report.wouldUpdate,
          trueToFalse: report.trueToFalse,
          falseToTrue: report.falseToTrue,
          unchanged: report.unchanged,
          refusedNoEvidence: report.noEvidence,
          refusedMissingFlag: report.missingFlag,
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
        // updateCaseReportsIllness returns the corpus to its pre-apply state.
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

async function main(): Promise<void> {
  loadDotEnv();
  const argv = process.argv.slice(2);
  const mode = resolveIllnessRepairMode(argv);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }
  const jsonPath = jsonPathFromArgv(argv);
  const wantsDriftAudit = argv.includes('--drift-audit');

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const store = new SupabaseStore(createSupabaseServerClient(url, secretKey));

  console.log(
    `\n${'═'.repeat(72)}\nStale illness-flag correction (P2B7L) — ` +
      `${mode.apply ? 'APPLY' : 'DRY RUN, nothing will be written'}\n${'═'.repeat(72)}\n`,
  );
  if (mode.apply) {
    console.log(
      '  ⚠  THIS WRITES TO THE PRODUCTION DATABASE.\n' +
        `     It will correct projection.reportsIllness on exactly ${mode.expectedUpdates} case(s)\n` +
        '     and abort without writing anything if the live count differs.\n' +
        '     Nothing else is touched: no timeline, no dates, no material change,\n' +
        '     no notification-ledger row, and push stays inactive.\n',
    );
  }

  let lastPrinted = 0;
  const report = await repairIllnessFlags(store, {
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
    ? await auditReprojectionDrift(
        store,
        report.plans.map((plan) => plan.recallCaseId),
      )
    : [];
  const driftById = new Map(drift.map((row) => [row.recallCaseId, row]));

  console.log('  Cases examined:                 ', report.casesExamined);
  console.log(
    `                                   (active ${report.active}, inactive ${report.inactive};` +
      ` FDA ${report.fda}, FSIS ${report.fsis})`,
  );
  console.log('  Stored flag already correct:    ', report.unchanged);
  console.log('');
  console.log(
    `  Stale values that ${mode.apply ? 'change' : 'would change'}:    ${report.wouldUpdate}` +
      ` (true→false ${report.trueToFalse}, false→true ${report.falseToTrue})`,
  );
  console.log(
    `      of which active:             ${report.activeWouldUpdate}` +
      ` (true→false ${report.activeTrueToFalse}, false→true ${report.activeFalseToTrue})`,
  );
  console.log('');
  console.log('  REFUSED — no prose to classify: ', report.noEvidence);
  console.log('  REFUSED — no stored flag:       ', report.missingFlag);
  for (const refused of report.refused.slice(0, 10)) {
    console.log(`      ✗ case ${refused.recallCaseId} (${refused.outcome})`);
  }
  console.log('  Plan failures:                  ', report.failures.length);
  for (const failure of report.failures.slice(0, 10)) {
    console.log(`      ✗ ${failure.recallCaseId} — ${failure.reason}`);
  }

  console.log('\n  Corrections:');
  for (const plan of report.plans) describe(plan, driftById.get(plan.recallCaseId));

  if (wantsDriftAudit) {
    const withOtherChanges = drift.filter(
      (row) => row.unavailable === null && row.otherFieldsChanged.length > 0,
    );
    const wouldNotify = drift.filter((row) => row.wouldRaiseHealthImpact);
    console.log('\n  What a NORMAL re-projection would additionally do:');
    console.log(
      `      cases also changing other projected fields: ${withOtherChanges.length}/${drift.length}`,
    );
    console.log(
      `      cases raising a health_impact notification: ${wouldNotify.length}` +
        ' (this repair raises 0)',
    );
  }

  console.log('\n  Structural attestations (zero by construction):');
  console.log('      network requests:      ', report.networkRequests);
  console.log('      notification events:   ', report.notificationEvents);
  console.log('      timeline entries:      ', report.timelineEntries);
  console.log('      material changes:      ', report.materialChanges);
  console.log('      cases created:         ', report.newCases);

  if (mode.apply) {
    console.log('\n  Case writes applied:            ', report.caseWrites);
    console.log('  Writes verified from live state:', report.verifiedWrites);
    console.log('  Verification failures:          ', report.verificationFailures.length);
    for (const failure of report.verificationFailures) {
      console.log(
        `      ✗ ${failure.recallCaseId}: expected ${failure.expected}, found ${failure.found}`,
      );
    }
    console.log('  Skipped (concurrent ingest):    ', report.concurrentlyModified.length);
    for (const id of report.concurrentlyModified.slice(0, 10)) console.log(`      ↻ ${id}`);
  }

  if (report.aborted) {
    console.log(
      `\n  ✗ ABORTED — ${report.aborted.reason}.` +
        `\n    authorized ${report.aborted.expected}, live plan ${report.aborted.actual}.` +
        '\n    Nothing was written. Re-run the dry run, review the difference, and' +
        '\n    re-authorize with the new count.',
    );
  }

  writeLedger(report, drift, mode.apply, jsonPath);

  const drifted = report.aborted !== null;
  const unverified = mode.apply && report.verifiedWrites !== report.caseWrites;
  const failed = report.failures.length > 0;
  if (drifted || unverified || failed) {
    console.log('');
    process.exit(1);
  }
  console.log(
    mode.apply
      ? '\n  Done. Re-run the dry run to verify: "would change" must now be 0.\n'
      : '\n  Dry run complete. Nothing was written.\n',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
