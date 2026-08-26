/**
 * FSIS product-visuals production job — the scheduled face of the
 * incremental label sync (src/server/fsis/label-sync.ts).
 *
 * 'recent' runs on every ingest tick: new label PDFs of recently published
 * notices get their visuals within one tick, and the run is seconds of
 * database reads when there is nothing to do. 'full' runs daily: every
 * missing PDF, failure retries with backoff, and the bounded recent-window
 * byte re-verification.
 *
 * Item failures (one PDF failing to fetch or render) are recorded per URL
 * and downgrade the run to 'partial' — they never fail the job, because the
 * other PDFs still processed and the failed one retries later.
 */

import type { LabelSyncOptions, LabelSyncStore } from '../fsis/label-sync';
import { syncFsisLabels } from '../fsis/label-sync';
import { runJob, type JobContext, type JobReport, type JobSpec } from './runner';

export function labelsJobSpec(mode: 'recent' | 'full'): JobSpec {
  return {
    jobName: 'fsis_labels',
    sourceSystem: 'fsis_labels',
    // The full sweep can render a large backlog; recent runs are bounded small.
    leaseTtlSeconds: mode === 'full' ? 110 * 60 : 25 * 60,
  };
}

export interface LabelsJobOptions extends Omit<LabelSyncOptions, 'now'> {
  labelStore: LabelSyncStore;
}

export async function runLabelsJob(ctx: JobContext, options: LabelsJobOptions): Promise<JobReport> {
  return runJob(labelsJobSpec(options.mode), ctx, async () => {
    console.log(
      `FSIS label sync (${options.mode}${options.dryRun ? ', dry run — nothing written' : ''})…`,
    );
    const { labelStore, ...syncOptions } = options;
    const metrics = await syncFsisLabels(labelStore, { ...syncOptions, now: ctx.now });
    console.log(
      `  label sync: ${metrics.candidateUrls} candidate URL(s), ${metrics.missing} missing, ` +
        `${metrics.rendered} rendered (${metrics.pagesStored} pages), ${metrics.unchanged} unchanged, ` +
        `${metrics.failures} failed, ${metrics.deferredByBackoff} deferred, ${metrics.capped} capped.`,
    );
    return {
      pipelineRunId: null,
      outcome: metrics.failures > 0 ? 'partial' : 'succeeded',
      metrics: { ...metrics, itemsSeen: metrics.candidateUrls },
    };
  });
}
