/**
 * Incremental FSIS label-visual sync — the production counterpart of the
 * historical backfill in scripts/render-fsis-labels.ts.
 *
 * The backfill re-fetches every label PDF to verify it; that is right for a
 * one-time audit and wrong for a job that runs every 30 minutes against
 * ~3,000 already-rendered documents. This sync is incremental by
 * construction:
 *
 *  - candidates come from FSIS source records already in our database (no
 *    agency traffic to discover work);
 *  - only PDFs with NO product_visuals rows are fetched — new notices and
 *    previously failed documents. Rendered PDFs are never re-fetched, except
 *    a bounded recent-window re-verification in 'full' mode that catches the
 *    rare in-place PDF revision;
 *  - failures are recorded per URL with exponential backoff (6h·2^n, capped
 *    at 7 days), so a broken PDF is retried later instead of hammered every
 *    tick — and accumulating failures stay visible to ops:health;
 *  - rendering and storage stay content-addressed (labels.ts), so re-runs
 *    reproduce identical objects and never rewrite existing visuals.
 *
 * Rendering itself (renderLabelPdf) and key derivation are unchanged — one
 * implementation serves the backfill, this sync, and tests.
 */

import { extractLabelPdfUrls, sha256, type RenderedLabelPdf } from './labels';

export interface LabelCandidate {
  sourceRecordId: string;
  recallCaseId: string;
  nativeId: string;
  pdfUrl: string;
  /** ISO date of the owning record — bounds the recent/re-verify windows. */
  publishedAt: string;
}

export interface LabelFailureState {
  sourceUrl: string;
  attempts: number;
  lastAttemptAt: string;
  lastError: string | null;
}

export interface LabelStoreTarget {
  recallCaseId: string;
  sourceRecordId: string;
  pdfUrl: string;
  pdfSha: string;
}

/** Storage port: Supabase in production, an in-memory fake in tests. */
export interface LabelSyncStore {
  /** FSIS records whose summary links label PDFs (publishedAt ≥ bound if given). */
  listCandidates(publishedSince: string | null): Promise<LabelCandidate[]>;
  /** Which PDF revisions (sha256s) already have visuals rows, per URL. */
  visualShasByUrl(urls: string[]): Promise<Map<string, Set<string>>>;
  listFailures(): Promise<LabelFailureState[]>;
  recordFailure(state: LabelFailureState): Promise<void>;
  clearFailure(sourceUrl: string): Promise<void>;
  /** Upload rendered pages + insert rows + retire stale revisions. Returns pages stored. */
  storePages(target: LabelStoreTarget, pages: RenderedLabelPdf['pages']): Promise<number>;
}

export interface LabelSyncOptions {
  /**
   * 'recent': new/missing PDFs of recently published records only — runs on
   * every ingest tick, seconds when there is nothing to do.
   * 'full': every missing PDF plus failure retries plus recent-window
   * re-verification — the daily sweep.
   */
  mode: 'recent' | 'full';
  now?: () => Date;
  /** Report the worklist without fetching, rendering, or writing anything. */
  dryRun?: boolean;
  fetchPdf?: (url: string) => Promise<Uint8Array>;
  render?: (bytes: Uint8Array) => Promise<RenderedLabelPdf>;
  /** Politeness cap on PDFs fetched per run; the remainder logs and waits. */
  maxPdfs?: number;
  fetchDelayMs?: number;
  recentDays?: number;
  reverifyDays?: number;
}

export interface LabelSyncMetrics {
  mode: 'recent' | 'full';
  candidateUrls: number;
  missing: number;
  reverify: number;
  deferredByBackoff: number;
  capped: number;
  attempted: number;
  unchanged: number;
  rendered: number;
  pagesStored: number;
  failures: number;
  [key: string]: unknown;
}

const DEFAULT_RECENT_DAYS = 45;
const DEFAULT_FETCH_DELAY_MS = 300;
const BACKOFF_BASE_MS = 6 * 60 * 60 * 1000; // 6h, doubling per attempt
const BACKOFF_CAP_MS = 7 * 24 * 60 * 60 * 1000; // never parked forever: weekly retry floor

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function failureBackoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
}

/** Default PDF fetch — same UA and size cap the backfill uses. */
export async function fetchLabelPdf(url: string): Promise<Uint8Array> {
  const { MAX_PDF_BYTES } = await import('./labels');
  const response = await fetch(url, {
    headers: { 'User-Agent': 'recall-app label renderer (contact: dev)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(`over size cap (${bytes.byteLength} bytes)`);
  }
  return bytes;
}

export async function syncFsisLabels(
  store: LabelSyncStore,
  options: LabelSyncOptions,
): Promise<LabelSyncMetrics> {
  const now = options.now ?? (() => new Date());
  const recentDays = options.recentDays ?? DEFAULT_RECENT_DAYS;
  const reverifyDays = options.reverifyDays ?? DEFAULT_RECENT_DAYS;
  const maxPdfs = options.maxPdfs ?? (options.mode === 'recent' ? 10 : 150);
  const fetchPdf = options.fetchPdf ?? ((url: string) => fetchLabelPdf(url));
  const render =
    options.render ??
    (async (bytes: Uint8Array) => (await import('./labels')).renderLabelPdf(bytes));

  const nowMs = now().getTime();
  const isoDaysAgo = (days: number) => new Date(nowMs - days * 86_400_000).toISOString();
  const recentCutoff = isoDaysAgo(recentDays).slice(0, 10);
  const reverifyCutoff = isoDaysAgo(reverifyDays).slice(0, 10);

  const candidates = await store.listCandidates(options.mode === 'recent' ? recentCutoff : null);
  // One target per URL; the first owning record wins (multiple notices can
  // share one label PDF — one set of visuals either way).
  const byUrl = new Map<string, LabelCandidate>();
  for (const candidate of candidates) {
    if (!byUrl.has(candidate.pdfUrl)) byUrl.set(candidate.pdfUrl, candidate);
  }
  const urls = [...byUrl.keys()];
  const existing = await store.visualShasByUrl(urls);
  const failures = new Map(
    (await store.listFailures()).map((failure) => [failure.sourceUrl, failure]),
  );

  const metrics: LabelSyncMetrics = {
    mode: options.mode,
    candidateUrls: urls.length,
    missing: 0,
    reverify: 0,
    deferredByBackoff: 0,
    capped: 0,
    attempted: 0,
    unchanged: 0,
    rendered: 0,
    pagesStored: 0,
    failures: 0,
  };

  const worklist: { url: string; candidate: LabelCandidate; reverify: boolean }[] = [];
  for (const url of urls) {
    const candidate = byUrl.get(url)!;
    const shas = existing.get(url);
    const missing = !shas || shas.size === 0;
    // Re-verification (byte-change catch) is bounded to recently published
    // records and to the daily 'full' sweep — never a tick-cadence re-crawl.
    const reverify = !missing && options.mode === 'full' && candidate.publishedAt >= reverifyCutoff;
    if (!missing && !reverify) continue;
    if (missing) metrics.missing += 1;
    if (reverify) metrics.reverify += 1;

    const failure = failures.get(url);
    if (
      failure &&
      nowMs - new Date(failure.lastAttemptAt).getTime() < failureBackoffMs(failure.attempts)
    ) {
      metrics.deferredByBackoff += 1;
      continue;
    }
    worklist.push({ url, candidate, reverify });
  }

  const bounded = worklist.slice(0, maxPdfs);
  metrics.capped = worklist.length - bounded.length;
  if (metrics.capped > 0) {
    console.log(
      `  ${metrics.capped} PDF(s) beyond this run's cap of ${maxPdfs} — they will process on later runs.`,
    );
  }

  if (options.dryRun) {
    console.log(
      `  DRY RUN: would fetch ${bounded.length} PDF(s) (${metrics.missing} missing, ${metrics.reverify} re-verify, ${metrics.deferredByBackoff} deferred by backoff).`,
    );
    return metrics;
  }

  for (const work of bounded) {
    metrics.attempted += 1;
    if (metrics.attempted > 1 && (options.fetchDelayMs ?? DEFAULT_FETCH_DELAY_MS) > 0) {
      await sleep(options.fetchDelayMs ?? DEFAULT_FETCH_DELAY_MS);
    }
    const previous = failures.get(work.url);
    try {
      const bytes = await fetchPdf(work.url);
      const pdfSha = sha256(bytes);
      if (existing.get(work.url)?.has(pdfSha)) {
        // Already rendered for these exact bytes (re-verify found no change,
        // or a prior failure resolved out of band).
        metrics.unchanged += 1;
        if (previous) await store.clearFailure(work.url);
        continue;
      }
      const renderedPdf = await render(bytes);
      if (renderedPdf.pages.length === 0) {
        throw new Error(`rendered zero usable pages (${renderedPdf.numPages} in document)`);
      }
      const stored = await store.storePages(
        {
          recallCaseId: work.candidate.recallCaseId,
          sourceRecordId: work.candidate.sourceRecordId,
          pdfUrl: work.url,
          pdfSha,
        },
        renderedPdf.pages,
      );
      metrics.rendered += 1;
      metrics.pagesStored += stored;
      if (previous) await store.clearFailure(work.url);
      console.log(`  ✓ ${work.candidate.nativeId}: ${stored} page(s) from ${work.url}`);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      metrics.failures += 1;
      await store.recordFailure({
        sourceUrl: work.url,
        attempts: (previous?.attempts ?? 0) + 1,
        lastAttemptAt: now().toISOString(),
        lastError: message,
      });
      console.log(`  ✗ ${work.candidate.nativeId}: ${message} (${work.url})`);
    }
  }

  return metrics;
}

/** Re-exported so the store implementations share the one URL extractor. */
export { extractLabelPdfUrls };
