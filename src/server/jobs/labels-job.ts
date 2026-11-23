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
import { syncFsisAttachments, type AttachmentSyncStore } from '../fsis/attachment-sync';
import { syncFsisLabelPhotos, type LabelPhotoSyncStore } from '../fsis/label-photo-sync';
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
  /** Absent = attachments are not read this run (tests of the label sync alone). */
  attachmentStore?: AttachmentSyncStore;
  /** Absent = label photos are not read this run (docs/recall-imagery.md §16). */
  photoStore?: LabelPhotoSyncStore;
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
    // Attachments read AFTER rendering, so a new label PDF's pages (and
    // their printed captions) exist before products are matched to them.
    const { attachmentStore } = options;
    const attachments = attachmentStore
      ? await syncFsisAttachments(attachmentStore, {
          mode: options.mode,
          dryRun: options.dryRun,
          now: ctx.now,
        })
      : null;
    if (attachments) {
      console.log(
        `  attachment sync: ${attachments.candidates} notice(s), ${attachments.fetched} fetched, ` +
          `${attachments.revised} revised, ${attachments.enrichmentsApplied} applied, ` +
          `${attachments.needsReview} need review, ${attachments.unreadable} unreadable.`,
      );
    }
    // Photos last: they read every label source the notice links (PDFs,
    // image files, label pages) and set each case's card image.
    const { photoStore } = options;
    const photos = photoStore
      ? await syncFsisLabelPhotos(photoStore, {
          mode: options.mode,
          dryRun: options.dryRun,
          now: ctx.now,
        })
      : null;
    if (photos) {
      console.log(
        `  label photos: ${photos.cases} case(s), ${photos.pending} source(s) pending, ` +
          `${photos.read} read, ${photos.photosStored} photo(s) stored, ` +
          `${photos.droppedPanels} panel(s) dropped, ${photos.failures} failed; ` +
          `card images ${photos.heroesSet} set, ${photos.heroesUnchanged} unchanged, ` +
          `${photos.heroConflicts} conflict(s).`,
      );
    }
    const { plan: _plan, ...attachmentMetrics } = attachments ?? { plan: [] };
    void _plan;
    return {
      pipelineRunId: null,
      outcome: metrics.failures > 0 || (photos?.failures ?? 0) > 0 ? 'partial' : 'succeeded',
      metrics: {
        ...metrics,
        itemsSeen: metrics.candidateUrls,
        ...(attachments ? { attachments: attachmentMetrics } : {}),
        ...(photos ? { labelPhotos: photos } : {}),
      },
    };
  });
}
