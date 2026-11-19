/**
 * The retailer notice monitor: fetch a retailer's public index and each linked
 * document, archive changed documents, read them, and record a decision per
 * notice in the private retailer tables. Costco was the first source; every
 * source runs this same pipeline from its spec ([sources.ts](./sources.ts)).
 *
 * TWO PHASES. `planRetailerRun` reads everything (the retailer + the store)
 * and returns the complete set of writes without performing any; the CLI
 * gates that count (`--apply --confirm --expect <n>`); `applyRetailerPlan`
 * then writes exactly the plan. A dry run is the plan, printed.
 *
 * IDEMPOTENT. Notices upsert on (publisher, native_id); documents are
 * hash-gated per notice; `first_seen_at` is never moved once recorded. A
 * second run over unchanged sources inserts nothing and only advances
 * `last_seen_on_index_at`.
 *
 * DISAPPEARANCE MEANS NOTHING. A notice that leaves the index keeps its row
 * exactly as it was. Nothing here closes, retracts or ages a notice, and an
 * index that parses to zero entries fails the run rather than reading as
 * "everything was withdrawn".
 */

import { createHash } from 'node:crypto';

import { safeFetchBinary } from '../safe-fetch';

import { decideNotice, MATCH_WINDOW_DAYS } from './decide';
import { parseLetter } from './letter';
import { extractPdfText, MAX_NOTICE_PDF_BYTES } from './pdf-text';
import { COSTCO_SOURCE, type RetailerSourceSpec } from './sources';
import type { RetailerNoticeStore, StoredNotice } from './store';
import type {
  ParsedNotice,
  RetailerIndexEntry,
  RetailerNoticeDocument,
  RetailerNoticeRow,
} from './types';

/** Same honest client identity as the FDA adapter (recall-source-contract §3.1). */
export const RETAILER_USER_AGENT = 'lotly-recall-ingest/1.0';
const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
/** With no dated notice to anchor the window, look this far back. */
const FALLBACK_LOOKBACK_DAYS = 400;

export interface FetchedDocument {
  bytes: Uint8Array;
  contentType: string | null;
}

export interface RetailerSource {
  fetchIndexHtml(): Promise<string>;
  fetchDocument(url: string): Promise<FetchedDocument>;
}

/** The Costco name for the same interface (kept for the job and the tests). */
export type CostcoSource = RetailerSource;

export function liveRetailerSource(
  spec: RetailerSourceSpec,
  fetchImpl: typeof fetch = fetch,
): RetailerSource {
  return {
    async fetchIndexHtml() {
      const response = await fetchImpl(spec.indexUrl, {
        headers: { 'User-Agent': RETAILER_USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const host = new URL(response.url || spec.indexUrl).hostname;
      if (!spec.indexHosts.includes(host)) throw new Error(`index redirected off-site to ${host}`);
      if (!response.ok) throw new Error(`index HTTP ${response.status}`);
      const type = response.headers.get('content-type') ?? '';
      if (!type.includes('text/html')) throw new Error(`index content-type ${type || 'missing'}`);
      const text = await response.text();
      if (text.length > MAX_INDEX_BYTES) throw new Error(`index is ${text.length} bytes`);
      return text;
    },
    async fetchDocument(url: string) {
      const result = await safeFetchBinary(url, {
        approvedHosts: [...spec.documentHosts],
        kind: 'pdf',
        maxBytes: MAX_NOTICE_PDF_BYTES,
        timeoutMs: TIMEOUT_MS,
        headers: { 'User-Agent': RETAILER_USER_AGENT },
        fetchImpl,
      });
      return { bytes: result.bytes, contentType: result.contentType };
    },
  };
}

export function liveCostcoSource(fetchImpl: typeof fetch = fetch): RetailerSource {
  return liveRetailerSource(COSTCO_SOURCE, fetchImpl);
}

export type PlannedChange = 'insert' | 'update' | 'touch';

export interface PlannedNotice {
  entry: RetailerIndexEntry;
  parsed: ParsedNotice;
  row: RetailerNoticeRow;
  change: PlannedChange;
  /** Present only when this content hash is not yet archived for the notice. */
  document: RetailerNoticeDocument | null;
}

export interface RetailerPlan {
  publisher: RetailerSourceSpec['publisher'];
  fetchedAt: string;
  indexEntries: number;
  planned: PlannedNotice[];
  /** Documents that could not be fetched this run; their rows are untouched. */
  failures: { nativeId: string; title: string; error: string }[];
  /** Stored notices absent from today's index — reported, never modified. */
  notOnIndex: string[];
  agencyCasesConsidered: number;
  /** Rows upserted + documents archived: the count `--expect` must match. */
  plannedWrites: number;
}

/** The Costco name for the same plan (kept for the job and the tests). */
export type CostcoPlan = RetailerPlan;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * JSON with object keys sorted. Postgres jsonb stores keys in its own order,
 * so a row read back from the database must compare equal to the same row
 * planned in memory.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}

/** Everything that defines a notice's content, minus our own timestamps. */
function contentKey(row: RetailerNoticeRow): string {
  const { firstSeenAt: _f, lastSeenOnIndexAt: _l, decidedAt: _d, ...content } = row;
  return stableJson(content);
}

function decisionKey(row: RetailerNoticeRow): string {
  return stableJson([row.decision, row.decisionReasons, row.linkCaseId, row.candidateCaseIds]);
}

function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export type TextExtractor = typeof extractPdfText;

export async function planRetailerRun(
  spec: RetailerSourceSpec,
  store: RetailerNoticeStore,
  source: RetailerSource,
  now: () => Date,
  extract: TextExtractor = extractPdfText,
): Promise<RetailerPlan> {
  const fetchedAt = now().toISOString();
  const entries = spec.parseIndex(await source.fetchIndexHtml());
  if (entries.length === 0) {
    throw new Error(
      `${spec.displayName} index parsed to zero notices: page shape changed; nothing was written`,
    );
  }
  const existing = await store.listNotices(spec.publisher);

  // Fetch + read every document first (sequential: a handful of small PDFs).
  const read: {
    entry: RetailerIndexEntry;
    fetched: FetchedDocument;
    hash: string;
    text: string;
    parsed: ParsedNotice;
  }[] = [];
  const failures: RetailerPlan['failures'] = [];
  for (const entry of entries) {
    try {
      const fetched = await source.fetchDocument(entry.documentUrl);
      const extracted = await extract(fetched.bytes);
      read.push({
        entry,
        fetched,
        hash: sha256(fetched.bytes),
        text: extracted.text,
        parsed: parseLetter(entry, extracted.extraction, extracted.text),
      });
    } catch (error) {
      failures.push({
        nativeId: entry.nativeId,
        title: entry.indexTitle,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const dated = read
    .map((item) => item.parsed.statedNoticeDate)
    .filter((date): date is string => date !== null)
    .sort();
  const fromIso = dated.length
    ? daysBefore(dated[0], MATCH_WINDOW_DAYS)
    : daysBefore(fetchedAt, FALLBACK_LOOKBACK_DAYS);
  const agencyCases = await store.listAgencyCases(fromIso);

  const planned: PlannedNotice[] = [];
  for (const { entry, fetched, hash, text, parsed } of read) {
    const stored: StoredNotice | undefined = existing.get(entry.nativeId);
    const { result, packageClaims } = decideNotice(entry, parsed, text, agencyCases);
    const row: RetailerNoticeRow = {
      publisher: spec.publisher,
      nativeId: entry.nativeId,
      indexLabel: entry.indexLabel,
      indexTitle: entry.indexTitle,
      indexUrl: spec.indexUrl,
      documentUrl: entry.documentUrl,
      firstSeenAt: stored?.row.firstSeenAt ?? fetchedAt,
      lastSeenOnIndexAt: fetchedAt,
      statedNoticeDate: parsed.statedNoticeDate,
      statedNoticeDateText: parsed.statedNoticeDateText,
      recallingFirmText: parsed.recallingFirmText,
      agenciesNamed: parsed.agenciesNamed,
      noticeKind: parsed.noticeKind,
      foodStatus: parsed.foodStatus,
      retailerItemNumbers: parsed.retailerItemNumbers,
      upcs: parsed.upcs,
      codeEvidence: parsed.codeEvidence,
      packageClaims,
      stateClaims: parsed.stateClaims,
      indexScopeText: parsed.indexScopeText,
      evidence: {
        statedNoticeDate: parsed.statedNoticeDateText,
        recallingFirm: parsed.recallingFirmEvidence,
        noticeKind: parsed.noticeKindEvidence,
        foodSignals: parsed.foodEvidence,
      },
      documentExtraction: parsed.extraction,
      documentContentHash: hash,
      decision: result.decision,
      decisionReasons: result.reasons,
      linkCaseId: result.linkCaseId,
      candidateCaseIds: result.candidateCaseIds,
      agencyLagDays: result.agencyLagDays,
      decidedAt: fetchedAt,
      parserVersion: spec.parserVersion,
    };
    if (stored && decisionKey(stored.row) === decisionKey(row))
      row.decidedAt = stored.row.decidedAt;

    const change: PlannedChange = !stored
      ? 'insert'
      : contentKey(stored.row) === contentKey(row)
        ? 'touch'
        : 'update';
    const document: RetailerNoticeDocument | null = stored?.archivedHashes.has(hash)
      ? null
      : {
          publisher: spec.publisher,
          nativeId: entry.nativeId,
          fetchedAt,
          documentUrl: entry.documentUrl,
          contentHash: hash,
          contentType: fetched.contentType,
          bytes: fetched.bytes,
          extractedText: parsed.extraction === 'text' ? text : null,
          indexEntry: entry,
        };
    planned.push({ entry, parsed, row, change, document });
  }

  const onIndex = new Set(entries.map((entry) => entry.nativeId));
  return {
    publisher: spec.publisher,
    fetchedAt,
    indexEntries: entries.length,
    planned,
    failures,
    notOnIndex: [...existing.keys()].filter((nativeId) => !onIndex.has(nativeId)).sort(),
    agencyCasesConsidered: agencyCases.length,
    plannedWrites: planned.length + planned.filter((item) => item.document).length,
  };
}

export function planCostcoRun(
  store: RetailerNoticeStore,
  source: RetailerSource,
  now: () => Date,
  extract: TextExtractor = extractPdfText,
): Promise<RetailerPlan> {
  return planRetailerRun(COSTCO_SOURCE, store, source, now, extract);
}

/** Write exactly the plan: one upsert per notice, then its new document. */
export async function applyRetailerPlan(
  store: RetailerNoticeStore,
  plan: RetailerPlan,
): Promise<number> {
  let writes = 0;
  for (const item of plan.planned) {
    const noticeId = await store.upsertNotice(item.row);
    writes += 1;
    if (item.document) {
      await store.archiveDocument(noticeId, item.document);
      writes += 1;
    }
  }
  return writes;
}

export const applyCostcoPlan = applyRetailerPlan;
