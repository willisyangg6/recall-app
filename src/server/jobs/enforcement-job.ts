/**
 * FDA enforcement production job. openFDA updates WEEKLY, so the job runs
 * daily but works cheaply: one manifest request (api.fda.gov/download.json)
 * reads the export date, and the full corpus download + reconciliation runs
 * only when that date moved past the last completed reconciliation. The
 * matcher, thresholds, and enrichment are exactly Phase B's — this module
 * adds only the gate and run bookkeeping.
 *
 * Hard gate carried into production: a run that would leave any mixed-class
 * case exposed as a single scalar class FAILS, loudly.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchEnforcementBulkUrl } from '../fda-enforcement/fetch';
import {
  downloadEnforcementCorpus,
  reconcileFdaEnforcement,
  type EnforcementCorpus,
  type ReconcileStats,
} from '../fda-enforcement/reconcile';
import type { RecallStore } from '../store/types';
import { latestJobMetric, runJob, type JobContext, type JobReport, type JobSpec } from './runner';

export const ENFORCEMENT_JOB: JobSpec = {
  jobName: 'fda_enforcement',
  sourceSystem: 'openfda_enforcement',
  leaseTtlSeconds: 110 * 60, // a full reconcile is minutes; recover well inside a day
};

export interface EnforcementJobOptions {
  /** Reconcile with apply=false (reads the live DB, writes nothing). */
  dryRun?: boolean;
  /** Run the full reconciliation even when the export date is unchanged. */
  force?: boolean;
  /** The store reconciliation writes through (normally the same Supabase store). */
  dataStore: RecallStore;
  client: SupabaseClient;
  fetchManifest?: typeof fetchEnforcementBulkUrl;
  downloadCorpus?: () => Promise<EnforcementCorpus>;
  reconcile?: typeof reconcileFdaEnforcement;
}

export async function runEnforcementJob(
  ctx: JobContext,
  options: EnforcementJobOptions,
): Promise<JobReport> {
  return runJob(ENFORCEMENT_JOB, ctx, async () => {
    const fetchManifest = options.fetchManifest ?? fetchEnforcementBulkUrl;

    console.log('Checking openFDA bulk-export manifest…');
    const manifest = await fetchManifest();
    console.log(
      `  export date ${manifest.exportDate}, ${manifest.totalRecords} records in the corpus.`,
    );

    // SOURCE EMPTY vs SOURCE FAILED: the corpus is ~29k records and only
    // grows. A manifest naming half of that is corruption, not history.
    const previousTotal = await latestJobMetric(ctx.store, ENFORCEMENT_JOB.jobName, 'totalRecords');
    if (typeof previousTotal === 'number' && manifest.totalRecords < Math.ceil(previousTotal / 2)) {
      throw new Error(
        `openFDA manifest implausibly small: ${manifest.totalRecords} records vs ${previousTotal} previously. ` +
          'Treating as SOURCE FAILURE; nothing reconciled.',
      );
    }

    // Weekly-update gate: completedExportDate is recorded only by a
    // successful APPLIED reconciliation, so a failed or dry run can never
    // make a real update look already-processed.
    const lastCompleted = await latestJobMetric(
      ctx.store,
      ENFORCEMENT_JOB.jobName,
      'completedExportDate',
    );
    if (!options.force && lastCompleted === manifest.exportDate) {
      console.log(
        `  export ${manifest.exportDate} already reconciled — nothing to do (source updates weekly).`,
      );
      return {
        pipelineRunId: null,
        outcome: 'succeeded',
        metrics: {
          skipped: 'source_unchanged',
          checkedExportDate: manifest.exportDate,
          totalRecords: manifest.totalRecords,
        },
      };
    }

    const corpus = options.downloadCorpus
      ? await options.downloadCorpus()
      : await downloadEnforcementCorpus();
    const reconcile = options.reconcile ?? reconcileFdaEnforcement;
    const stats: ReconcileStats = await reconcile(options.client, options.dataStore, {
      apply: !options.dryRun,
      corpus,
    });

    const failedGate = stats.mixedExposedAsScalar > 0;
    return {
      pipelineRunId: null,
      outcome: failedGate ? 'failed' : 'succeeded',
      error: failedGate
        ? `HARD GATE: ${stats.mixedExposedAsScalar} mixed-class case(s) exposed as a scalar class`
        : undefined,
      metrics: {
        // Recorded only when the reconciliation actually applied — a dry run
        // must not stop the next scheduled run from doing the real work.
        ...(options.dryRun || failedGate
          ? { checkedExportDate: manifest.exportDate }
          : { completedExportDate: manifest.exportDate }),
        totalRecords: manifest.totalRecords,
        itemsSeen: corpus.records.length,
        matched: stats.matched,
        ambiguous: stats.ambiguous,
        candidate: stats.candidate,
        unmatched: stats.unmatched,
        acceptedEvents: stats.acceptedEvents,
        conflicts: stats.conflicts,
        assignments: stats.assignments,
        reclassifications: stats.reclassifications,
        notifications: stats.notifications,
        mixedClassCases: stats.mixedClassCases,
        mixedExposedAsScalar: stats.mixedExposedAsScalar,
        tiers: stats.tiers,
      },
    };
  });
}
