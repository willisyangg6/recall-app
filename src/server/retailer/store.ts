/**
 * Persistence for retailer notices.
 *
 * The store's WRITE surface is exactly two private tables —
 * `retailer_notices` and `retailer_notice_documents` — and nothing else. It
 * READS agency cases from `recall_cases` (select only) to propose matches.
 * There is deliberately no method that can reach `recall_cases` writes,
 * `source_records`, `affected_products` or `notification_events`, and
 * `store.test.ts` pins that against a recording client: in this slice a
 * retailer notice cannot change the feed or create an alert.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AgencyCaseView,
  RetailerNoticeDocument,
  RetailerNoticeRow,
  RetailerPublisher,
} from './types';

/** The only tables this module may write. */
export const RETAILER_WRITE_TABLES = ['retailer_notices', 'retailer_notice_documents'] as const;

export interface StoredNotice {
  row: RetailerNoticeRow;
  /** Content hashes already archived for this notice. */
  archivedHashes: Set<string>;
}

export interface RetailerNoticeStore {
  listNotices(publisher: RetailerPublisher): Promise<Map<string, StoredNotice>>;
  /** Agency cases published on or after `fromIso` (read-only). */
  listAgencyCases(fromIso: string): Promise<AgencyCaseView[]>;
  /** Insert or update by (publisher, native_id). Returns the notice id. */
  upsertNotice(row: RetailerNoticeRow): Promise<string>;
  /** Append a document version; a (notice, hash) already archived is a no-op. */
  archiveDocument(noticeId: string, document: RetailerNoticeDocument): Promise<void>;
}

// ── In-memory (tests, offline dry runs) ─────────────────────────────────────

export class MemoryRetailerNoticeStore implements RetailerNoticeStore {
  readonly notices = new Map<string, { id: string; row: RetailerNoticeRow }>();
  readonly documents: { noticeId: string; document: RetailerNoticeDocument }[] = [];
  private nextId = 1;

  constructor(private readonly agencyCases: readonly AgencyCaseView[] = []) {}

  async listNotices(publisher: RetailerPublisher): Promise<Map<string, StoredNotice>> {
    const out = new Map<string, StoredNotice>();
    for (const { id, row } of this.notices.values()) {
      if (row.publisher !== publisher) continue;
      const archivedHashes = new Set(
        this.documents.filter((d) => d.noticeId === id).map((d) => d.document.contentHash),
      );
      out.set(row.nativeId, { row: structuredClone(row), archivedHashes });
    }
    return out;
  }

  async listAgencyCases(fromIso: string): Promise<AgencyCaseView[]> {
    return this.agencyCases.filter((agencyCase) => agencyCase.publishedAt >= fromIso.slice(0, 10));
  }

  async upsertNotice(row: RetailerNoticeRow): Promise<string> {
    const key = `${row.publisher}:${row.nativeId}`;
    const existing = this.notices.get(key);
    const id = existing?.id ?? `notice-${this.nextId++}`;
    this.notices.set(key, { id, row: structuredClone(row) });
    return id;
  }

  async archiveDocument(noticeId: string, document: RetailerNoticeDocument): Promise<void> {
    const duplicate = this.documents.some(
      (d) => d.noticeId === noticeId && d.document.contentHash === document.contentHash,
    );
    if (!duplicate) this.documents.push({ noticeId, document });
  }
}

// ── Supabase (service role) ─────────────────────────────────────────────────

interface NoticeDbRow {
  id: string;
  publisher: RetailerPublisher;
  native_id: string;
  index_label: string | null;
  index_title: string;
  index_url: string;
  document_url: string;
  first_seen_at: string;
  last_seen_on_index_at: string;
  stated_notice_date: string | null;
  stated_notice_date_text: string | null;
  recalling_firm_text: string | null;
  agencies_named: string[];
  notice_kind: RetailerNoticeRow['noticeKind'];
  food_status: RetailerNoticeRow['foodStatus'];
  retailer_item_numbers: string[];
  upcs: string[];
  code_evidence: string[];
  package_claims: RetailerNoticeRow['packageClaims'];
  state_claims: RetailerNoticeRow['stateClaims'];
  index_scope_text: string | null;
  evidence: RetailerNoticeRow['evidence'];
  document_extraction: RetailerNoticeRow['documentExtraction'];
  document_content_hash: string;
  decision: RetailerNoticeRow['decision'];
  decision_reasons: RetailerNoticeRow['decisionReasons'];
  link_case_id: string | null;
  candidate_case_ids: string[];
  agency_lag_days: number | null;
  decided_at: string;
  parser_version: string;
}

function toDb(row: RetailerNoticeRow): Omit<NoticeDbRow, 'id'> {
  return {
    publisher: row.publisher,
    native_id: row.nativeId,
    index_label: row.indexLabel,
    index_title: row.indexTitle,
    index_url: row.indexUrl,
    document_url: row.documentUrl,
    first_seen_at: row.firstSeenAt,
    last_seen_on_index_at: row.lastSeenOnIndexAt,
    stated_notice_date: row.statedNoticeDate,
    stated_notice_date_text: row.statedNoticeDateText,
    recalling_firm_text: row.recallingFirmText,
    agencies_named: row.agenciesNamed,
    notice_kind: row.noticeKind,
    food_status: row.foodStatus,
    retailer_item_numbers: row.retailerItemNumbers,
    upcs: row.upcs,
    code_evidence: row.codeEvidence,
    package_claims: row.packageClaims,
    state_claims: row.stateClaims,
    index_scope_text: row.indexScopeText,
    evidence: row.evidence,
    document_extraction: row.documentExtraction,
    document_content_hash: row.documentContentHash,
    decision: row.decision,
    decision_reasons: row.decisionReasons,
    link_case_id: row.linkCaseId,
    candidate_case_ids: row.candidateCaseIds,
    agency_lag_days: row.agencyLagDays,
    decided_at: row.decidedAt,
    parser_version: row.parserVersion,
  };
}

function fromDb(db: NoticeDbRow): RetailerNoticeRow {
  return {
    publisher: db.publisher,
    nativeId: db.native_id,
    indexLabel: db.index_label,
    indexTitle: db.index_title,
    indexUrl: db.index_url,
    documentUrl: db.document_url,
    firstSeenAt: new Date(db.first_seen_at).toISOString(),
    lastSeenOnIndexAt: new Date(db.last_seen_on_index_at).toISOString(),
    statedNoticeDate: db.stated_notice_date,
    statedNoticeDateText: db.stated_notice_date_text,
    recallingFirmText: db.recalling_firm_text,
    agenciesNamed: db.agencies_named,
    noticeKind: db.notice_kind,
    foodStatus: db.food_status,
    retailerItemNumbers: db.retailer_item_numbers,
    upcs: db.upcs,
    codeEvidence: db.code_evidence,
    packageClaims: db.package_claims,
    stateClaims: db.state_claims,
    indexScopeText: db.index_scope_text,
    evidence: db.evidence,
    documentExtraction: db.document_extraction,
    documentContentHash: db.document_content_hash,
    decision: db.decision,
    decisionReasons: db.decision_reasons,
    linkCaseId: db.link_case_id,
    candidateCaseIds: db.candidate_case_ids,
    agencyLagDays: db.agency_lag_days,
    decidedAt: new Date(db.decided_at).toISOString(),
    parserVersion: db.parser_version,
  };
}

interface AgencyDbRow {
  id: string;
  source_agency: 'FDA' | 'FSIS';
  notice_type: 'recall' | 'public_health_alert';
  state: string;
  published_at: string;
  title: string;
  firm: string | null;
  brands: string[] | null;
  summary: string | null;
  product_description: string | null;
  retailer_names: string[] | null;
  geography: AgencyCaseView['geography'] | null;
  affected_products: { name: string | null; raw_text: string | null }[] | null;
}

export const AGENCY_CASE_SELECT = [
  'id',
  'source_agency',
  'notice_type',
  'state',
  'published_at',
  'title',
  'firm:projection->recallingFirm->>displayName',
  'brands:projection->brands',
  'summary:projection->>summaryText',
  'product_description:projection->>productDescription',
  'retailer_names:projection->retailerNames',
  'geography:projection->geography',
  'affected_products(name,raw_text)',
].join(',');

export function toAgencyCaseView(row: AgencyDbRow): AgencyCaseView {
  const products = (row.affected_products ?? [])
    .map((product) => `${product.name ?? ''} ${product.raw_text ?? ''}`.trim())
    .filter(Boolean);
  return {
    id: row.id,
    sourceAgency: row.source_agency,
    noticeType: row.notice_type,
    state: row.state,
    publishedAt: row.published_at,
    title: row.title,
    firm: row.firm,
    brands: row.brands ?? [],
    text: [row.summary ?? '', row.product_description ?? '', ...products].join('\n'),
    retailerNames: row.retailer_names ?? [],
    geography: {
      scope: row.geography?.scope ?? 'unknown',
      states: row.geography?.states ?? [],
    },
  };
}

const PAGE = 500;

/** bytea over PostgREST travels as a `\x…` hex string. */
function toByteaHex(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString('hex')}`;
}

export class SupabaseRetailerNoticeStore implements RetailerNoticeStore {
  constructor(private readonly client: SupabaseClient) {}

  async listNotices(publisher: RetailerPublisher): Promise<Map<string, StoredNotice>> {
    const out = new Map<string, StoredNotice>();
    const { data, error } = await this.client
      .from('retailer_notices')
      .select('*, retailer_notice_documents(content_hash)')
      .eq('publisher', publisher);
    if (error) throw new Error(`retailer_notices read failed: ${error.message}`);
    for (const raw of (data ?? []) as (NoticeDbRow & {
      retailer_notice_documents: { content_hash: string }[] | null;
    })[]) {
      out.set(raw.native_id, {
        row: fromDb(raw),
        archivedHashes: new Set((raw.retailer_notice_documents ?? []).map((d) => d.content_hash)),
      });
    }
    return out;
  }

  async listAgencyCases(fromIso: string): Promise<AgencyCaseView[]> {
    const out: AgencyCaseView[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client
        .from('recall_cases')
        .select(AGENCY_CASE_SELECT)
        .gte('published_at', fromIso.slice(0, 10))
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`recall_cases read failed: ${error.message}`);
      const rows = (data ?? []) as unknown as AgencyDbRow[];
      out.push(...rows.map(toAgencyCaseView));
      if (rows.length < PAGE) return out;
    }
  }

  async upsertNotice(row: RetailerNoticeRow): Promise<string> {
    const { data, error } = await this.client
      .from('retailer_notices')
      .upsert(toDb(row), { onConflict: 'publisher,native_id' })
      .select('id')
      .single();
    if (error || !data) throw new Error(`retailer_notices upsert failed: ${error?.message}`);
    return (data as { id: string }).id;
  }

  async archiveDocument(noticeId: string, document: RetailerNoticeDocument): Promise<void> {
    const { error } = await this.client.from('retailer_notice_documents').upsert(
      {
        notice_id: noticeId,
        fetched_at: document.fetchedAt,
        document_url: document.documentUrl,
        content_hash: document.contentHash,
        content_type: document.contentType,
        byte_length: document.bytes.byteLength,
        document_bytes: toByteaHex(document.bytes),
        extracted_text: document.extractedText,
        index_entry: document.indexEntry,
      },
      { onConflict: 'notice_id,content_hash', ignoreDuplicates: true },
    );
    if (error) throw new Error(`retailer_notice_documents insert failed: ${error.message}`);
  }
}
