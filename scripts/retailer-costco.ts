/**
 * Costco notice monitor — private retailer_notices tables only
 * (docs/recall-retailer-notices.md).
 *
 *   npm run retailer:costco                              # dry run (default)
 *   npm run retailer:costco -- --report <file.json>      # dry run + JSON report
 *   npm run retailer:costco -- --apply --confirm --expect <n>
 *
 * Reads: Costco's public index and member letters (one request each,
 * sequential), and recall_cases (SELECT only) to propose matches.
 * Writes (apply only): retailer_notices and retailer_notice_documents.
 * Never writes recall_cases, affected_products, source_records or
 * notification_events — a retailer notice cannot change the feed or send an
 * alert in this slice.
 *
 * A dry run against a database where the migration is not yet applied plans
 * as a first run (every notice an insert) and says so.
 */

import { writeFileSync } from 'node:fs';

import {
  DRY_RUN_DESPITE_ACKNOWLEDGMENTS,
  applyCommandLine,
  dryRunClosingLine,
  resolveCountGate,
  resolveFlagValue,
  resolveRepairAuthorization,
  type MutationCommandForm,
} from '../src/server/repair-authorization';
import {
  applyCostcoPlan,
  liveCostcoSource,
  planCostcoRun,
  type CostcoPlan,
} from '../src/server/retailer/costco-monitor';
import {
  SupabaseRetailerNoticeStore,
  type RetailerNoticeStore,
  type StoredNotice,
} from '../src/server/retailer/store';
import { createSupabaseServerClient } from '../src/server/store/supabase-store';

const FORM: MutationCommandForm = { script: 'retailer:costco' };

const HELP = `Costco notice monitor (private retailer tables only).

  npm run retailer:costco                          dry run: fetch, read, decide, write nothing
  npm run retailer:costco -- --report <file>       also write the dry-run report as JSON
  ${applyCommandLine(FORM)}

Writes only retailer_notices and retailer_notice_documents. Never the feed,
the case tables, or the notification ledger.`;

/** A store whose notice tables may not exist yet (dry run before the migration). */
function tolerateMissingNoticeTables(store: RetailerNoticeStore): {
  store: RetailerNoticeStore;
  missing: () => boolean;
} {
  let missing = false;
  return {
    missing: () => missing,
    store: {
      listAgencyCases: (fromIso) => store.listAgencyCases(fromIso),
      upsertNotice: (row) => store.upsertNotice(row),
      archiveDocument: (id, document) => store.archiveDocument(id, document),
      async listNotices(publisher) {
        try {
          return await store.listNotices(publisher);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/retailer_notices|schema cache|does not exist/i.test(message)) throw error;
          missing = true;
          return new Map<string, StoredNotice>();
        }
      },
    },
  };
}

function summarize(plan: CostcoPlan): Record<string, unknown> {
  const count = (pick: (item: CostcoPlan['planned'][number]) => string) =>
    plan.planned.reduce<Record<string, number>>((tally, item) => {
      tally[pick(item)] = (tally[pick(item)] ?? 0) + 1;
      return tally;
    }, {});
  return {
    fetchedAt: plan.fetchedAt,
    indexEntries: plan.indexEntries,
    documentsRead: plan.planned.length,
    documentFailures: plan.failures,
    agencyCasesConsidered: plan.agencyCasesConsidered,
    decisions: count((item) => item.row.decision),
    changes: count((item) => item.change),
    documentsToArchive: plan.planned.filter((item) => item.document).length,
    notOnIndex: plan.notOnIndex,
    plannedWrites: plan.plannedWrites,
  };
}

function reportRows(plan: CostcoPlan): Record<string, unknown>[] {
  return plan.planned.map(({ row, change, document }) => ({
    nativeId: row.nativeId,
    change,
    newDocument: document !== null,
    indexLabel: row.indexLabel,
    indexTitle: row.indexTitle,
    documentUrl: row.documentUrl,
    statedNoticeDate: row.statedNoticeDate,
    firstSeenAt: row.firstSeenAt,
    recallingFirm: row.recallingFirmText,
    agenciesNamed: row.agenciesNamed,
    noticeKind: row.noticeKind,
    foodStatus: row.foodStatus,
    extraction: row.documentExtraction,
    retailerItemNumbers: row.retailerItemNumbers,
    upcs: row.upcs,
    stateClaims: row.stateClaims.map((claim) => `${claim.retailer}:${claim.state}`),
    indexScopeText: row.indexScopeText,
    packageClaims: row.packageClaims,
    codeEvidence: row.codeEvidence,
    decision: row.decision,
    reasons: row.decisionReasons,
    linkCaseId: row.linkCaseId,
    candidateCaseIds: row.candidateCaseIds,
    agencyLagDays: row.agencyLagDays,
  }));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  // Authorization resolves from argv alone, before any credential or network.
  const auth = resolveRepairAuthorization(argv, FORM);
  const reportFlag = resolveFlagValue(argv, '--report');
  const refusal = auth.error ?? reportFlag.error;
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }

  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may come from elsewhere.
  }
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY. Nothing was written.');
    process.exit(1);
  }

  const wrapped = tolerateMissingNoticeTables(
    new SupabaseRetailerNoticeStore(createSupabaseServerClient(url, secretKey)),
  );
  const plan = await planCostcoRun(wrapped.store, liveCostcoSource(), () => new Date());
  const summary = summarize(plan);

  console.log(`\nCostco notice monitor — ${auth.apply ? 'APPLY' : 'dry run'}`);
  if (wrapped.missing()) {
    if (auth.apply) {
      console.error(
        '\n  APPLY REFUSED: retailer_notices does not exist (migration not applied). Nothing was written.',
      );
      process.exit(1);
    }
    console.log(
      '  retailer_notices is not present (migration not applied): planned as a first run.',
    );
  }
  console.log(JSON.stringify(summary, null, 2));
  for (const row of reportRows(plan)) {
    console.log(
      `  ${String(row.decision).padEnd(14)} ${String(row.statedNoticeDate ?? 'undated').padEnd(10)} ` +
        `${String(row.indexTitle).slice(0, 70).padEnd(70)} ${(row.reasons as string[]).join(',')}`,
    );
  }

  if (reportFlag.value) {
    writeFileSync(
      reportFlag.value,
      `${JSON.stringify({ summary, notices: reportRows(plan) }, null, 2)}\n`,
    );
    console.log(`\n  Report written to ${reportFlag.value}`);
  }

  const gate = resolveCountGate(auth, plan.plannedWrites);
  if (gate) {
    console.error(
      `\n  APPLY REFUSED: ${gate.reason} (expected ${gate.expected}, planned ${gate.actual}). ` +
        'Nothing was written.',
    );
    process.exit(1);
  }
  if (!auth.apply) {
    if (argv.includes('--confirm') || argv.includes('--expect')) {
      console.log(DRY_RUN_DESPITE_ACKNOWLEDGMENTS);
    }
    console.log(dryRunClosingLine(FORM, plan.plannedWrites));
    return;
  }
  const written = await applyCostcoPlan(wrapped.store, plan);
  console.log(`\n  Applied: ${written} writes to retailer_notices / retailer_notice_documents.`);
}

main().catch((error) => {
  console.error('Costco monitor failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
