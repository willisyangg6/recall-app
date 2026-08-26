/**
 * Push delivery production job — the scheduled face of the push worker
 * (src/server/push/worker.ts), run through the C1 runner so manual and
 * scheduled execution share the same lease, run bookkeeping, and failure
 * semantics as every other job.
 *
 * Before the founder activates delivery (npm run push:activate) the body is a
 * cheap no-send no-op that still records healthy runs, so the job can ship
 * scheduled ahead of activation without ever sending.
 */

import type { PushStore, PushTransport } from '../push/types';
import { runPushDelivery } from '../push/worker';
import { runJob, type JobContext, type JobReport, type JobSpec } from './runner';

export const PUSH_JOB: JobSpec = {
  jobName: 'push_delivery',
  sourceSystem: 'push_delivery',
  // Comfortably longer than a healthy run (seconds to a few minutes),
  // shorter than two scheduler ticks — same recovery math as fda/fsis.
  leaseTtlSeconds: 25 * 60,
};

export interface PushJobOptions {
  pushStore: PushStore;
  transport: PushTransport;
  dryRun: boolean;
}

export async function runPushJob(ctx: JobContext, options: PushJobOptions): Promise<JobReport> {
  return runJob(PUSH_JOB, ctx, async () => {
    console.log(
      `Push delivery${options.dryRun ? ' (dry run — nothing written, nothing sent)' : ''}…`,
    );
    const result = await runPushDelivery(options.pushStore, {
      transport: options.transport,
      dryRun: options.dryRun,
      now: ctx.now,
    });
    return {
      pipelineRunId: null,
      outcome: result.outcome,
      metrics: { ...result.metrics, itemsSeen: result.metrics.eventsExamined ?? 0 },
      error: result.error,
    };
  });
}
