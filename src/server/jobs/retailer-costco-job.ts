/**
 * Scheduled retailer notice monitors, Costco and ALDI
 * (docs/recall-retailer-notices.md).
 *
 * The same plan and apply as the manual `retailer:monitor` command, run
 * unattended through the job runner: one lease, one ingest_runs row, and a
 * non-zero exit when the run fails. It writes only the private
 * retailer_notices and retailer_notice_documents tables (plus the runner's
 * own lease and run bookkeeping). It never writes the feed, the case tables
 * or the notification ledger, so it cannot change what shoppers see or send
 * an alert.
 *
 * Outcomes:
 * - failed: the index could not be fetched or parsed to any entry, a
 *   database read or write failed, or anything else threw. The workflow goes
 *   red. Nothing already stored is changed or removed.
 * - partial: the run completed, but one or more letters could not be
 *   fetched. Those notices are skipped this run (their stored rows are
 *   untouched) and retried on the next.
 * - succeeded: every letter on the index was read.
 */

import {
  applyRetailerPlan,
  planRetailerRun,
  type CostcoPlan,
  type CostcoSource,
  type TextExtractor,
} from '../retailer/costco-monitor';
import { extractPdfText } from '../retailer/pdf-text';
import { ALDI_SOURCE, COSTCO_SOURCE, type RetailerSourceSpec } from '../retailer/sources';
import type { RetailerNoticeStore } from '../retailer/store';
import { runJob, type JobContext, type JobReport, type JobSpec } from './runner';

export const RETAILER_COSTCO_JOB: JobSpec = {
  jobName: 'retailer_costco',
  sourceSystem: 'retailer_costco',
  // A healthy run is ~1 minute (one index + ~21 letters, sequential). The
  // schedule is every two hours, so a crashed run's lease is long gone by
  // the next tick.
  leaseTtlSeconds: 1800,
};

export interface RetailerCostcoJobOptions {
  dryRun: boolean;
  store: RetailerNoticeStore;
  source: CostcoSource;
  extract?: TextExtractor;
}

/** Compact, display-safe facts for ingest_runs.metrics and the run log. */
export function retailerRunMetrics(
  plan: CostcoPlan,
  written: number | null,
): Record<string, unknown> {
  const tally = (pick: (item: CostcoPlan['planned'][number]) => string) =>
    plan.planned.reduce<Record<string, number>>((counts, item) => {
      counts[pick(item)] = (counts[pick(item)] ?? 0) + 1;
      return counts;
    }, {});
  return {
    itemsSeen: plan.indexEntries,
    fetchedAt: plan.fetchedAt,
    documentsRead: plan.planned.length,
    documentFailures: plan.failures.map(({ nativeId, error }) => ({ nativeId, error })),
    agencyCasesConsidered: plan.agencyCasesConsidered,
    decisions: tally((item) => item.row.decision),
    changes: tally((item) => item.change),
    documentsArchived: plan.planned.filter((item) => item.document).length,
    // Inserted or changed notices only; a `touch` is last-seen bookkeeping.
    newOrChanged: plan.planned
      .filter((item) => item.change !== 'touch')
      .map((item) => ({
        nativeId: item.row.nativeId,
        change: item.change,
        decision: item.row.decision,
        title: item.row.indexTitle.slice(0, 120),
      })),
    reviewQueue: plan.planned
      .filter((item) => item.row.decision === 'review')
      .map((item) => ({
        nativeId: item.row.nativeId,
        title: item.row.indexTitle.slice(0, 120),
        reasons: item.row.decisionReasons,
      })),
    notOnIndex: plan.notOnIndex,
    plannedWrites: plan.plannedWrites,
    written,
  };
}

/** The scheduled ALDI monitor: the same job on the ALDI spec. */
export const RETAILER_ALDI_JOB: JobSpec = {
  jobName: 'retailer_aldi',
  sourceSystem: 'retailer_aldi',
  leaseTtlSeconds: 1800,
};

/** One retailer's monitor as a scheduled job (Costco, ALDI). */
export async function runRetailerNoticeJob(
  job: JobSpec,
  spec: RetailerSourceSpec,
  ctx: JobContext,
  options: RetailerCostcoJobOptions,
): Promise<JobReport> {
  return runJob(job, ctx, async () => {
    const plan = await planRetailerRun(
      spec,
      options.store,
      options.source,
      ctx.now,
      options.extract ?? extractPdfText,
    );
    const written = options.dryRun ? null : await applyRetailerPlan(options.store, plan);
    const metrics = retailerRunMetrics(plan, written);
    const name = spec.displayName;
    const noun = spec.publisher === 'costco' ? 'letter' : 'document';

    console.log(`[${job.jobName}] ${JSON.stringify(metrics)}`);
    // GitHub annotations: visible on the run page without opening the log.
    for (const failure of plan.failures) {
      console.log(`::warning::${name} ${noun} not fetched (${failure.nativeId}): ${failure.error}`);
    }
    const newOrChanged = (metrics.newOrChanged as unknown[]).length;
    const review = (metrics.reviewQueue as unknown[]).length;
    if (newOrChanged > 0) {
      console.log(`::notice::${name} notices new or changed this run: ${newOrChanged}`);
    }
    if (review > 0) console.log(`::notice::${name} notices awaiting manual review: ${review}`);

    return {
      pipelineRunId: null,
      outcome: plan.failures.length > 0 ? 'partial' : 'succeeded',
      metrics,
      ...(plan.failures.length > 0
        ? { error: `${plan.failures.length} ${name} ${noun}(s) could not be fetched` }
        : {}),
    };
  });
}

export function runRetailerCostcoJob(
  ctx: JobContext,
  options: RetailerCostcoJobOptions,
): Promise<JobReport> {
  return runRetailerNoticeJob(RETAILER_COSTCO_JOB, COSTCO_SOURCE, ctx, options);
}

export function runRetailerAldiJob(
  ctx: JobContext,
  options: RetailerCostcoJobOptions,
): Promise<JobReport> {
  return runRetailerNoticeJob(RETAILER_ALDI_JOB, ALDI_SOURCE, ctx, options);
}
