/**
 * FSIS attachment sync — reads the official PDFs a notice links for product
 * facts, and applies what verifies to the notice's record and case.
 *
 * Runs inside the labels job, AFTER the label sync (so a new label PDF's
 * pages are already rendered and captioned), which itself runs right after
 * FSIS ingestion in the scheduled workflow.
 *
 * Contract:
 *  - candidates are FSIS records already in our database whose summary
 *    links a label or product-list PDF; the scheduled job only ever sees the
 *    recent window — historical records are reached by the gated backfill
 *    CLI alone, never by a schedule;
 *  - every attachment has ONE row per (record, URL) in `fsis_attachments`,
 *    holding its content hash, verdict and extraction. A rerun with
 *    unchanged bytes rewrites nothing; changed bytes at the same URL update
 *    that row (keeping the previous hash) — never a second row, and never a
 *    second notice;
 *  - an attachment that cannot be fetched or read, or that does not verify,
 *    is recorded as `unreadable` / `needs_review` with its reasons and adds
 *    nothing. The notice itself is never withheld or altered for it;
 *  - the enrichment write touches the record's `normalized` block and the
 *    case's projection product fields only — never the timeline, the
 *    affected-product rows or `last_changed_at` — so it is structurally
 *    incapable of producing a notification (the store port enforces it).
 */

import type { Geography } from '../../domain/recall-types';
import type { AttachmentEnrichment } from '../../domain/source-record';
import { canonicalJson } from '../pipeline';
import {
  buildEnrichment,
  discoverFsisAttachments,
  labelPageCaptions,
  noticeProductNames,
  parseProductList,
  PRODUCT_LIST_PARSER_VERSION,
  readPdfLayout,
  type AttachmentReading,
  type PdfLayout,
  type ProductListParse,
} from './attachments';
import { failureBackoffMs, fetchLabelPdf, type LabelFailureState } from './label-sync';
import { sha256 } from './labels';

export interface AttachmentCandidate {
  sourceRecordId: string;
  recallCaseId: string;
  nativeId: string;
  publishedAt: string;
  summaryHtml: string | null;
  productLines: string[];
  geography: Geography;
  /** The enrichment block currently stored on the record, if any. */
  enrichment: AttachmentEnrichment | null;
}

/** One `fsis_attachments` row. */
export interface StoredAttachment {
  sourceRecordId: string;
  url: string;
  kind: 'labels' | 'product_list';
  linkText: string;
  sha256: string | null;
  previousSha256: string | null;
  status: 'verified' | 'needs_review' | 'unreadable';
  reviewReasons: string[];
  /** product_list: the parse; labels: the page captions. */
  extraction:
    | { kind: 'product_list'; parse: ProductListParse; parserVersion?: number }
    | { kind: 'labels'; captions: { page: number; caption: string | null }[] }
    | null;
  fetchedAt: string;
  revisedAt: string | null;
}

/** A rendered label page as stored in product_visuals. */
export interface LabelVisualPage {
  page: number;
  url: string;
  caption: string | null;
}

export type EnrichmentWriteResult = 'applied' | 'unchanged' | 'conflict';

/** Storage port: Supabase in production, an in-memory fake in tests. */
export interface AttachmentSyncStore {
  listCandidates(filter: {
    publishedSince: string | null;
    nativeIds?: string[];
  }): Promise<AttachmentCandidate[]>;
  listAttachments(sourceRecordIds: string[]): Promise<StoredAttachment[]>;
  upsertAttachment(row: StoredAttachment): Promise<void>;
  /** Current rendered pages per label URL, with the PDF revision they came from. */
  labelVisuals(urls: string[]): Promise<Map<string, { sha256: string; pages: LabelVisualPage[] }>>;
  setVisualCaptions(
    url: string,
    pdfSha: string,
    captions: { page: number; caption: string | null }[],
  ): Promise<number>;
  listFailures(): Promise<LabelFailureState[]>;
  recordFailure(state: LabelFailureState): Promise<void>;
  clearFailure(sourceUrl: string): Promise<void>;
  /**
   * Write the enrichment to the record's `normalized` and the case's
   * projection product fields ONLY (never timeline, products or
   * last_changed_at). 'conflict' = the case moved underneath; retry later.
   */
  applyEnrichment(
    candidate: AttachmentCandidate,
    enrichment: AttachmentEnrichment,
  ): Promise<EnrichmentWriteResult>;
}

export interface AttachmentSyncOptions {
  mode: 'recent' | 'full';
  now?: () => Date;
  /**
   * Report the plan and write nothing. Attachments never read before are
   * still fetched and read (agency GETs only) so the plan shows real values.
   */
  dryRun?: boolean;
  /** Restrict to these FSIS native ids (the targeted backfill). */
  nativeIds?: string[];
  /** Include records outside the recent window (backfill CLI only). */
  allHistory?: boolean;
  fetchPdf?: (url: string) => Promise<Uint8Array>;
  readLayout?: (bytes: Uint8Array) => Promise<PdfLayout>;
  maxPdfs?: number;
  fetchDelayMs?: number;
  recentDays?: number;
  log?: (line: string) => void;
}

export interface AttachmentPlanEntry {
  nativeId: string;
  recallCaseId: string;
  before: Pick<AttachmentEnrichment, 'productDescription' | 'brands'> & {
    tableRows: number;
  };
  after: Pick<AttachmentEnrichment, 'productDescription' | 'brands'> & {
    tableRows: number;
  };
  sources: AttachmentEnrichment['sources'];
  captionsToWrite: number;
  write: boolean;
}

export interface AttachmentSyncMetrics {
  mode: 'recent' | 'full';
  candidates: number;
  attachments: number;
  fetched: number;
  revised: number;
  unchanged: number;
  unreadable: number;
  needsReview: number;
  deferredByBackoff: number;
  capped: number;
  captionsWritten: number;
  enrichmentsApplied: number;
  enrichmentConflicts: number;
  plan: AttachmentPlanEntry[];
  [key: string]: unknown;
}

const DEFAULT_RECENT_DAYS = 45;
const DEFAULT_FETCH_DELAY_MS = 300;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Content of an enrichment that a consumer can see. */
function visible(enrichment: AttachmentEnrichment | null) {
  return {
    productDescription: enrichment?.productDescription ?? null,
    brands: enrichment?.brands ?? [],
    tableRows: (enrichment?.tables ?? []).reduce((n, t) => n + t.rows.length, 0),
  };
}

function hasContent(enrichment: AttachmentEnrichment): boolean {
  return (
    enrichment.productDescription !== null ||
    enrichment.brands.length > 0 ||
    enrichment.tables.length > 0
  );
}

export async function syncFsisAttachments(
  store: AttachmentSyncStore,
  options: AttachmentSyncOptions,
): Promise<AttachmentSyncMetrics> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((line: string) => console.log(line));
  const fetchPdf = options.fetchPdf ?? fetchLabelPdf;
  const readLayout = options.readLayout ?? readPdfLayout;
  const maxPdfs = options.maxPdfs ?? (options.mode === 'recent' ? 10 : 60);
  const delay = options.fetchDelayMs ?? DEFAULT_FETCH_DELAY_MS;
  const nowMs = now().getTime();
  const recentCutoff = new Date(nowMs - (options.recentDays ?? DEFAULT_RECENT_DAYS) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const candidates = await store.listCandidates({
    publishedSince: options.allHistory ? null : recentCutoff,
    nativeIds: options.nativeIds,
  });
  const stored = new Map(
    (await store.listAttachments(candidates.map((c) => c.sourceRecordId))).map((row) => [
      `${row.sourceRecordId}|${row.url}`,
      row,
    ]),
  );
  // The rows as loaded, before this run touched anything.
  const original = new Map(stored);
  const failures = new Map((await store.listFailures()).map((f) => [f.sourceUrl, f]));

  const metrics: AttachmentSyncMetrics = {
    mode: options.mode,
    candidates: 0,
    attachments: 0,
    fetched: 0,
    revised: 0,
    unchanged: 0,
    unreadable: 0,
    needsReview: 0,
    deferredByBackoff: 0,
    capped: 0,
    captionsWritten: 0,
    enrichmentsApplied: 0,
    enrichmentConflicts: 0,
    plan: [],
  };

  let fetchBudget = maxPdfs;
  const fetchOnce = async (url: string): Promise<Uint8Array> => {
    if (metrics.fetched > 0 && delay > 0) await sleep(delay);
    metrics.fetched += 1;
    return fetchPdf(url);
  };

  for (const candidate of candidates) {
    const attachments = discoverFsisAttachments(candidate.summaryHtml).filter(
      (a): a is typeof a & { kind: 'labels' | 'product_list' } =>
        a.kind === 'labels' || a.kind === 'product_list',
    );
    if (attachments.length === 0) continue;
    metrics.candidates += 1;
    metrics.attachments += attachments.length;

    const labelUrls = attachments.filter((a) => a.kind === 'labels').map((a) => a.url);
    const visuals = labelUrls.length > 0 ? await store.labelVisuals(labelUrls) : new Map();
    const readings: AttachmentReading[] = [];
    let captionsToWrite = 0;

    for (const attachment of attachments) {
      const key = `${candidate.sourceRecordId}|${attachment.url}`;
      const previous = stored.get(key) ?? null;
      const failure = failures.get(attachment.url);
      const backedOff =
        failure !== undefined &&
        nowMs - new Date(failure.lastAttemptAt).getTime() < failureBackoffMs(failure.attempts);

      if (attachment.kind === 'product_list') {
        // Fetch a list we have never read, one previously unreadable once
        // its backoff allows, and — in the daily sweep — re-verify the bytes
        // so a revision under the same URL is caught.
        // A reading by another parser version is read again in any mode,
        // dry runs included, so the plan shows what the current parser reads.
        const outdated =
          previous !== null && previous.status !== 'unreadable' && !isCurrentReading(previous);
        const needsFetch =
          previous === null ||
          previous.status === 'unreadable' ||
          outdated ||
          (options.mode === 'full' && !options.dryRun);
        let row = previous;
        if (needsFetch && backedOff) metrics.deferredByBackoff += 1;
        else if (needsFetch && options.dryRun && previous !== null && !outdated) {
          // dry run: plan from what is stored
        } else if (needsFetch && fetchBudget <= 0) metrics.capped += 1;
        else if (needsFetch) {
          fetchBudget -= 1;
          row = await readProductList(attachment, candidate, previous, fetchOnce, readLayout, now);
          if (options.dryRun) {
            // A dry run reads; it never records or clears failure state.
          } else if (row.status === 'unreadable') {
            await store.recordFailure({
              sourceUrl: attachment.url,
              attempts: (failure?.attempts ?? 0) + 1,
              lastAttemptAt: now().toISOString(),
              lastError: row.reviewReasons.join('; ').slice(0, 300),
            });
          } else if (failure) await store.clearFailure(attachment.url);
          // A re-read with a new parser version is a change even when the
          // verdict is not, so the version is recorded and not read again.
          const changed =
            previous === null ||
            previous.sha256 !== row.sha256 ||
            previous.status !== row.status ||
            canonicalJson(previous.extraction) !== canonicalJson(row.extraction);
          if (
            previous !== null &&
            previous.sha256 !== null &&
            row.sha256 !== null &&
            previous.sha256 !== row.sha256
          ) {
            metrics.revised += 1;
            log(
              `  ↻ ${candidate.nativeId}: product list revised at the same URL (${attachment.url})`,
            );
          }
          if (!changed) metrics.unchanged += 1;
          if (!options.dryRun && changed) await store.upsertAttachment(row);
          stored.set(key, row);
        }
        if (row === null) continue;
        if (row.status === 'unreadable') {
          metrics.unreadable += 1;
          readings.push({
            kind: 'product_list',
            url: attachment.url,
            linkText: attachment.linkText,
            sha256: row.sha256,
            unreadable: row.reviewReasons.join('; '),
          });
        } else if (row.extraction?.kind === 'product_list') {
          if (row.status === 'needs_review') metrics.needsReview += 1;
          readings.push({
            kind: 'product_list',
            url: attachment.url,
            linkText: attachment.linkText,
            sha256: row.sha256!,
            parse: row.extraction.parse,
          });
        }
        continue;
      }

      // Labels: the label sync owns fetching and rendering. Captions come
      // with each render; a page rendered before captions existed is
      // captioned here, from the same PDF revision, exactly once.
      const rendered = visuals.get(attachment.url);
      if (!rendered) continue; // not rendered (yet, or failed) — nothing to match
      let pages = rendered.pages;
      const uncaptioned = pages.some((p: LabelVisualPage) => p.caption === null);
      if (uncaptioned && !backedOff) {
        if (fetchBudget <= 0) metrics.capped += 1;
        else {
          fetchBudget -= 1;
          try {
            const bytes = await fetchOnce(attachment.url);
            const sha = sha256(bytes);
            if (sha !== rendered.sha256) {
              log(
                `  · ${candidate.nativeId}: label PDF changed since rendering; the label sync re-renders it first`,
              );
            } else {
              const captions = labelPageCaptions(await readLayout(bytes));
              const byPage = new Map(captions.map((c) => [c.page, c.caption]));
              pages = pages.map((p: LabelVisualPage) => ({
                ...p,
                caption: p.caption ?? byPage.get(p.page) ?? null,
              }));
              captionsToWrite += pages.filter((p: LabelVisualPage) => p.caption !== null).length;
              if (!options.dryRun) {
                metrics.captionsWritten += await store.setVisualCaptions(
                  attachment.url,
                  sha,
                  captions,
                );
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log(
              `  ✗ ${candidate.nativeId}: label captions unavailable — ${message} (${attachment.url})`,
            );
          }
        }
      }
      const captions = pages.map((p: LabelVisualPage) => ({ page: p.page, caption: p.caption }));
      readings.push({
        kind: 'labels',
        url: attachment.url,
        linkText: attachment.linkText,
        sha256: rendered.sha256,
        captions,
        renderUrls: new Map(pages.map((p: LabelVisualPage) => [p.page, p.url])),
      });
      const labelRow: StoredAttachment = {
        sourceRecordId: candidate.sourceRecordId,
        url: attachment.url,
        kind: 'labels',
        linkText: attachment.linkText,
        sha256: rendered.sha256,
        previousSha256:
          previous && previous.sha256 !== rendered.sha256
            ? previous.sha256
            : (previous?.previousSha256 ?? null),
        status: 'verified',
        reviewReasons: [],
        extraction: { kind: 'labels', captions },
        fetchedAt: previous?.fetchedAt ?? now().toISOString(),
        revisedAt:
          previous && previous.sha256 !== null && previous.sha256 !== rendered.sha256
            ? now().toISOString()
            : (previous?.revisedAt ?? null),
      };
      stored.set(key, labelRow);
    }

    const enrichment = buildEnrichment({
      noticeProductNames: noticeProductNames(candidate.productLines),
      geography: candidate.geography,
      readings,
    });

    // Persist each label attachment's verdict (from the enrichment).
    for (const source of enrichment.sources) {
      if (source.kind !== 'labels') continue;
      const key = `${candidate.sourceRecordId}|${source.url}`;
      const row = stored.get(key);
      if (!row) continue;
      const next: StoredAttachment = {
        ...row,
        status: source.status,
        reviewReasons: source.reviewReasons,
      };
      if (source.status === 'needs_review') metrics.needsReview += 1;
      // A rerun over unchanged bytes and captions rewrites nothing.
      if (!options.dryRun && canonicalJson(next) !== canonicalJson(original.get(key) ?? null)) {
        await store.upsertAttachment(next);
      }
    }

    const before = visible(candidate.enrichment);
    const after = visible(enrichment);
    const write =
      (hasContent(enrichment) || candidate.enrichment !== null) &&
      canonicalJson(candidate.enrichment) !== canonicalJson(enrichment);
    metrics.plan.push({
      nativeId: candidate.nativeId,
      recallCaseId: candidate.recallCaseId,
      before,
      after,
      sources: enrichment.sources,
      captionsToWrite,
      write,
    });
    // Reconcile whenever there is content: ingestion rewrites `normalized`
    // and the projection from the agency payload alone, so the store (which
    // returns 'unchanged' when both already match) is asked every run.
    if (options.dryRun || !(hasContent(enrichment) || candidate.enrichment !== null)) continue;
    const result = await store.applyEnrichment(candidate, enrichment);
    if (result === 'applied') {
      metrics.enrichmentsApplied += 1;
      log(
        `  ✓ ${candidate.nativeId}: product fields from ${enrichment.sources.filter((s) => s.status === 'verified').length} verified attachment(s)`,
      );
    } else if (result === 'conflict') {
      metrics.enrichmentConflicts += 1;
      log(`  · ${candidate.nativeId}: case changed during the write — retried next run`);
    }
  }

  return metrics;
}

/** A product-list reading the current parser made (either verdict). */
function isCurrentReading(row: StoredAttachment): boolean {
  return (
    row.extraction?.kind === 'product_list' &&
    row.extraction.parserVersion === PRODUCT_LIST_PARSER_VERSION
  );
}

async function readProductList(
  attachment: { url: string; linkText: string },
  candidate: AttachmentCandidate,
  previous: StoredAttachment | null,
  fetchOnce: (url: string) => Promise<Uint8Array>,
  readLayout: (bytes: Uint8Array) => Promise<PdfLayout>,
  now: () => Date,
): Promise<StoredAttachment> {
  const base = {
    sourceRecordId: candidate.sourceRecordId,
    url: attachment.url,
    kind: 'product_list' as const,
    linkText: attachment.linkText,
    fetchedAt: now().toISOString(),
  };
  let bytes: Uint8Array;
  try {
    bytes = await fetchOnce(attachment.url);
  } catch (error) {
    return {
      ...base,
      sha256: previous?.sha256 ?? null,
      previousSha256: previous?.previousSha256 ?? null,
      status: 'unreadable',
      reviewReasons: [
        `fetch failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      ],
      extraction: null,
      revisedAt: previous?.revisedAt ?? null,
    };
  }
  const sha = sha256(bytes);
  const revised = previous !== null && previous.sha256 !== null && previous.sha256 !== sha;
  // Unchanged bytes keep a reading only when the current parser made it: a
  // parser fix must reach lists already read (PHA-11142026 stayed "no table
  // header" after the continuation-page fix shipped, its bytes unchanged).
  if (previous !== null && previous.sha256 === sha && isCurrentReading(previous)) {
    return previous;
  }
  const revision = {
    sha256: sha,
    previousSha256: revised ? previous!.sha256 : (previous?.previousSha256 ?? null),
    revisedAt: revised ? now().toISOString() : (previous?.revisedAt ?? null),
  };
  try {
    const parse = parseProductList(await readLayout(bytes));
    return {
      ...base,
      ...revision,
      status: parse.status === 'verified' ? 'verified' : 'needs_review',
      reviewReasons: parse.status === 'verified' ? [] : parse.reasons,
      extraction: { kind: 'product_list', parse, parserVersion: PRODUCT_LIST_PARSER_VERSION },
    };
  } catch (error) {
    return {
      ...base,
      ...revision,
      status: 'unreadable',
      reviewReasons: [
        `PDF unreadable: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      ],
      extraction: null,
    };
  }
}
