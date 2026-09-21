/**
 * The historical FSIS label backfill, planned in full before a single page is
 * uploaded (P2B7T addendum).
 *
 * WHY THIS MODULE EXISTS. `scripts/render-fsis-labels.ts` used to interleave
 * fetch → hash → check → render → upload in one loop, so the number of uploads
 * a run would perform was never knowable until the run was over. The P2B7T
 * gate could therefore only bind `--expect <n>` to the number of PDFs the pass
 * would WALK, not the number it would WRITE — an authorization for the wrong
 * quantity. Everything here exists so `--expect` can name the real mutation
 * count: the plan is complete, and the count is final, before the first
 * upload is reachable.
 *
 * WHAT MAKES AN EXACT PLAN CHEAP. `visualShasByUrl` answers, from the database
 * alone, which PDF revisions already have `product_visuals` rows. A URL with
 * NO rows needs an upload and we know it without touching FSIS — and that is
 * the entire historical-backfill population. Only a URL that ALREADY has rows
 * requires its bytes to decide, because the question there is "did this PDF
 * change in place?". That audit is opt-in (`verifyRevisions`), it is the only
 * thing in either phase that talks to an agency, and the count reported is
 * always the count for the plan that actually ran.
 *
 * WHAT THIS MODULE NEVER DOES. It holds no credentials, opens no connection
 * and knows no flags. Fetching, hashing, rendering and storage all arrive as
 * ports, which is what lets the whole contract be proved against fixtures with
 * no agency request and no production row — see label-backfill.test.ts.
 */

import type { RenderedLabelPdf } from './labels';

/** One (source record → label PDF) link discovered in the corpus. */
export interface LabelBackfillSource {
  sourceRecordId: string;
  recallCaseId: string;
  nativeId: string;
  pdfUrl: string;
}

export type LabelPlanOutcome =
  /** No rows for these bytes: this entry is an authorized upload. */
  | 'upload'
  /** `product_visuals` already holds this revision. Nothing to do. */
  | 'already-rendered'
  /** Could not be inspected, so it is deliberately NOT planned as an upload. */
  | 'fetch-failed';

export interface LabelPlanEntry {
  sourceRecordId: string;
  recallCaseId: string;
  nativeId: string;
  pdfUrl: string;
  /**
   * The bytes this entry was planned against, when the plan needed them. Null
   * for a URL with no rows at all, which is decided from the database without
   * fetching. A non-null sha is re-verified before the upload, so a PDF that
   * changes between the review and the write is skipped rather than written
   * under a revision nobody reviewed.
   */
  pdfSha: string | null;
  outcome: LabelPlanOutcome;
  reason: string | null;
}

export interface LabelBackfillPlan {
  /** (record → PDF) links discovered, before de-duplication by URL. */
  linksExamined: number;
  distinctPdfs: number;
  /** URLs with no `product_visuals` rows at all — from the database alone. */
  unrendered: number;
  /** URLs that already hold at least one rendered revision. */
  alreadyHaveRows: number;
  /** URLs actually fetched during planning (0 unless `verifyRevisions`). */
  inspected: number;
  entries: LabelPlanEntry[];
  /**
   * THE AUTHORIZED NUMBER. `--expect <n>` is compared against this, and it is
   * final before `executeLabelBackfill` is reachable.
   */
  plannedUploads: number;
  alreadyRendered: number;
  fetchFailures: { pdfUrl: string; reason: string }[];
  /** True when the in-place-revision audit ran, so a report can say which plan this is. */
  verifiedRevisions: boolean;
}

export interface LabelPlanDeps {
  /** Which PDF revisions already have visuals rows, per URL. Database only. */
  visualShasByUrl(urls: string[]): Promise<Map<string, Set<string>>>;
  /** Agency fetch. Called ONLY for URLs that already have rows, and only when verifying. */
  fetchPdf(url: string): Promise<{ bytes: Uint8Array } | { error: string }>;
  hash(bytes: Uint8Array): string;
  /**
   * Fetch and hash the already-rendered URLs too, to catch a PDF revised in
   * place. Off by default: the scheduled `jobs:labels --full` sweep already
   * owns recent-window re-verification, so this is the deep audit, not the
   * routine one.
   */
  verifyRevisions: boolean;
  onProgress?: (done: number, total: number) => void;
  delay?: (url: string) => Promise<void>;
}

/** De-duplicate by URL, keeping the first link and a deterministic order. */
function distinctByUrl(sources: readonly LabelBackfillSource[]): LabelBackfillSource[] {
  const seen = new Set<string>();
  const out: LabelBackfillSource[] = [];
  for (const source of sources) {
    if (seen.has(source.pdfUrl)) continue;
    seen.add(source.pdfUrl);
    out.push(source);
  }
  return out;
}

/**
 * Decide, for every distinct label PDF, whether this run would upload it —
 * and finish deciding before any caller can write anything.
 */
export async function planLabelBackfill(
  sources: readonly LabelBackfillSource[],
  deps: LabelPlanDeps,
): Promise<LabelBackfillPlan> {
  const distinct = distinctByUrl(sources);
  const shas = await deps.visualShasByUrl(distinct.map((source) => source.pdfUrl));

  const plan: LabelBackfillPlan = {
    linksExamined: sources.length,
    distinctPdfs: distinct.length,
    unrendered: 0,
    alreadyHaveRows: 0,
    inspected: 0,
    entries: [],
    plannedUploads: 0,
    alreadyRendered: 0,
    fetchFailures: [],
    verifiedRevisions: deps.verifyRevisions,
  };

  let done = 0;
  for (const source of distinct) {
    done += 1;
    deps.onProgress?.(done, distinct.length);
    const known = shas.get(source.pdfUrl);

    // ── No rows at all: an upload, decided with no agency traffic. This is
    // the whole historical-backfill population.
    if (known === undefined || known.size === 0) {
      plan.unrendered += 1;
      plan.entries.push({
        ...source,
        pdfSha: null,
        outcome: 'upload',
        reason: 'no rendered pages',
      });
      continue;
    }

    plan.alreadyHaveRows += 1;
    if (!deps.verifyRevisions) {
      plan.entries.push({
        ...source,
        pdfSha: null,
        outcome: 'already-rendered',
        reason: 'has rendered pages; in-place revision not checked in this plan',
      });
      continue;
    }

    // ── Already rendered, and the operator asked whether it changed in place.
    // This is the only fetch either phase makes for such a URL.
    await deps.delay?.(source.pdfUrl);
    const fetched = await deps.fetchPdf(source.pdfUrl);
    plan.inspected += 1;
    if ('error' in fetched) {
      plan.fetchFailures.push({ pdfUrl: source.pdfUrl, reason: fetched.error });
      plan.entries.push({
        ...source,
        pdfSha: null,
        outcome: 'fetch-failed',
        reason: fetched.error,
      });
      continue;
    }
    const sha = deps.hash(fetched.bytes);
    plan.entries.push(
      known.has(sha)
        ? {
            ...source,
            pdfSha: sha,
            outcome: 'already-rendered',
            reason: 'these bytes are rendered',
          }
        : {
            ...source,
            pdfSha: sha,
            outcome: 'upload',
            reason: 'revised in place since last render',
          },
    );
  }

  plan.plannedUploads = plan.entries.filter((entry) => entry.outcome === 'upload').length;
  plan.alreadyRendered = plan.entries.filter(
    (entry) => entry.outcome === 'already-rendered',
  ).length;
  return plan;
}

export type LabelUploadOutcome =
  | 'uploaded'
  /** The PDF's bytes moved between the reviewed plan and this write. */
  | 'changed-since-plan'
  /** Something else rendered this revision after the plan was made. */
  | 'already-rendered-since-plan'
  | 'fetch-failed'
  | 'render-failed';

export interface LabelUploadResult {
  pdfUrl: string;
  nativeId: string;
  outcome: LabelUploadOutcome;
  pagesStored: number;
  reason: string | null;
}

export interface LabelExecuteDeps {
  visualShasByUrl(urls: string[]): Promise<Map<string, Set<string>>>;
  fetchPdf(url: string): Promise<{ bytes: Uint8Array } | { error: string }>;
  hash(bytes: Uint8Array): string;
  render(bytes: Uint8Array): Promise<RenderedLabelPdf>;
  storePages(
    target: { recallCaseId: string; sourceRecordId: string; pdfUrl: string; pdfSha: string },
    pages: RenderedLabelPdf['pages'],
  ): Promise<number>;
  onProgress?: (done: number, total: number) => void;
  delay?: (url: string) => Promise<void>;
}

export interface LabelExecuteReport {
  results: LabelUploadResult[];
  uploaded: number;
  pagesStored: number;
  skipped: number;
  failures: number;
}

/**
 * Upload exactly the entries the reviewed plan authorized, and nothing else.
 *
 * Every entry is re-checked at the moment of writing — against the sha it was
 * planned with, and against the freshest `product_visuals` state — so the
 * number of uploads can only come in AT or UNDER the authorized count, never
 * over it. Each shortfall is named in the results rather than absorbed.
 */
export async function executeLabelBackfill(
  authorized: readonly LabelPlanEntry[],
  deps: LabelExecuteDeps,
): Promise<LabelExecuteReport> {
  const entries = authorized.filter((entry) => entry.outcome === 'upload');
  const report: LabelExecuteReport = {
    results: [],
    uploaded: 0,
    pagesStored: 0,
    skipped: 0,
    failures: 0,
  };
  if (entries.length === 0) return report;

  // One batched read of the freshest state, so the idempotency guard below
  // costs a single query rather than one per PDF.
  const fresh = await deps.visualShasByUrl(entries.map((entry) => entry.pdfUrl));

  let done = 0;
  for (const entry of entries) {
    done += 1;
    deps.onProgress?.(done, entries.length);
    const record = (outcome: LabelUploadOutcome, pagesStored: number, reason: string | null) => {
      report.results.push({
        pdfUrl: entry.pdfUrl,
        nativeId: entry.nativeId,
        outcome,
        pagesStored,
        reason,
      });
      if (outcome === 'uploaded') {
        report.uploaded += 1;
        report.pagesStored += pagesStored;
      } else if (outcome === 'fetch-failed' || outcome === 'render-failed') {
        report.failures += 1;
      } else {
        report.skipped += 1;
      }
    };

    await deps.delay?.(entry.pdfUrl);
    const fetched = await deps.fetchPdf(entry.pdfUrl);
    if ('error' in fetched) {
      record('fetch-failed', 0, fetched.error);
      continue;
    }
    const sha = deps.hash(fetched.bytes);

    // Compare-and-set on the bytes themselves: an entry planned against a
    // specific revision is written only if the PDF is still that revision.
    if (entry.pdfSha !== null && sha !== entry.pdfSha) {
      record(
        'changed-since-plan',
        0,
        `planned ${entry.pdfSha.slice(0, 12)}, found ${sha.slice(0, 12)}`,
      );
      continue;
    }
    if (fresh.get(entry.pdfUrl)?.has(sha)) {
      record('already-rendered-since-plan', 0, 'these bytes gained rows after the plan');
      continue;
    }

    let rendered: RenderedLabelPdf;
    try {
      rendered = await deps.render(fetched.bytes);
    } catch (error) {
      record('render-failed', 0, error instanceof Error ? error.message : String(error));
      continue;
    }
    const stored = await deps.storePages(
      {
        recallCaseId: entry.recallCaseId,
        sourceRecordId: entry.sourceRecordId,
        pdfUrl: entry.pdfUrl,
        pdfSha: sha,
      },
      rendered.pages,
    );
    record('uploaded', stored, null);
  }
  return report;
}
