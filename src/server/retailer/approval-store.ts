/**
 * Storage for the approval step (approval.ts). Writes only
 * retailer_notice_approvals; reads retailer_notices, retailer_notice_documents
 * and recall_cases (to confirm an agency case exists).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ApprovalRow,
  NewApprovalRow,
  NoticeForReview,
  RetailerApprovalStore,
} from './approval';
import type { RetailerNoticeRow, RetailerPublisher } from './types';

export const APPROVAL_WRITE_TABLES = ['retailer_notice_approvals'] as const;

/** The existing public bucket product images are served from (FSIS labels use it too). */
export const PRODUCT_VISUALS_BUCKET = 'product-visuals';

/** The review facts of a monitor row, as the approval step checks them. */
export function noticeForReview(id: string, row: RetailerNoticeRow): NoticeForReview {
  return {
    id,
    publisher: row.publisher,
    nativeId: row.nativeId,
    documentContentHash: row.documentContentHash,
    decision: row.decision,
    noticeKind: row.noticeKind,
    foodStatus: row.foodStatus,
    documentExtraction: row.documentExtraction,
    statedNoticeDate: row.statedNoticeDate,
    retailerItemNumbers: row.retailerItemNumbers,
    upcs: row.upcs,
    statedStates: row.stateClaims.map((claim) => claim.state),
  };
}

/** In-memory store for tests: notices and documents are seeded directly. */
export class MemoryApprovalStore implements RetailerApprovalStore {
  readonly notices = new Map<string, NoticeForReview>();
  readonly documents = new Map<string, Uint8Array>();
  readonly approvals: ApprovalRow[] = [];
  readonly agencyCases = new Set<string>();
  readonly uploads = new Map<string, Uint8Array>();
  private nextId = 1;

  seedNotice(notice: NoticeForReview, documents: { hash: string; bytes: Uint8Array }[]): void {
    this.notices.set(`${notice.publisher}:${notice.nativeId}`, notice);
    for (const { hash, bytes } of documents) this.documents.set(`${notice.id}:${hash}`, bytes);
  }

  async getNoticeForReview(publisher: RetailerPublisher, nativeId: string) {
    return this.notices.get(`${publisher}:${nativeId}`) ?? null;
  }

  async getDocumentBytes(noticeId: string, contentHash: string) {
    return this.documents.get(`${noticeId}:${contentHash}`) ?? null;
  }

  async listApprovals(noticeId: string) {
    return this.approvals.filter((approval) => approval.noticeId === noticeId);
  }

  async insertApproval(row: NewApprovalRow): Promise<string> {
    if (this.approvals.some((a) => a.noticeId === row.noticeId && a.withdrawnAt === null)) {
      throw new Error(
        'duplicate key value violates unique constraint "retailer_notice_approvals_one_live"',
      );
    }
    const id = `approval-${this.nextId++}`;
    this.approvals.push({
      ...row,
      id,
      withdrawnAt: null,
      withdrawnReason: null,
      agencyCaseId: null,
      agencyMatchConfirmedAt: null,
    });
    return id;
  }

  async withdrawApproval(id: string, reason: string, at: string) {
    const approval = this.approvals.find((a) => a.id === id && a.withdrawnAt === null);
    if (!approval) throw new Error(`no live approval ${id}`);
    approval.withdrawnAt = at;
    approval.withdrawnReason = reason;
  }

  async confirmAgencyMatch(id: string, agencyCaseId: string, at: string) {
    const approval = this.approvals.find((a) => a.id === id && a.withdrawnAt === null);
    if (!approval) throw new Error(`no live approval ${id}`);
    approval.agencyCaseId = agencyCaseId;
    approval.agencyMatchConfirmedAt = at;
  }

  async agencyCaseExists(caseId: string) {
    return this.agencyCases.has(caseId);
  }

  async uploadImage(path: string, bytes: Uint8Array) {
    this.uploads.set(path, bytes);
  }
}

interface ApprovalDbRow {
  id: string;
  notice_id: string;
  document_content_hash: string;
  fields_version: number;
  fields: unknown;
  field_evidence: unknown;
  review_notes: string | null;
  approved_by: string;
  approved_at: string;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
  agency_case_id: string | null;
  agency_match_confirmed_at: string | null;
}

function fromDb(row: ApprovalDbRow): ApprovalRow {
  return {
    id: row.id,
    noticeId: row.notice_id,
    documentContentHash: row.document_content_hash,
    fieldsVersion: row.fields_version,
    fields: row.fields,
    fieldEvidence: row.field_evidence,
    reviewNotes: row.review_notes,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    withdrawnAt: row.withdrawn_at,
    withdrawnReason: row.withdrawn_reason,
    agencyCaseId: row.agency_case_id,
    agencyMatchConfirmedAt: row.agency_match_confirmed_at,
  };
}

/** PostgREST returns bytea as `\x` + hex. */
function fromByteaHex(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value.replace(/^\\x/, ''), 'hex'));
}

export class SupabaseApprovalStore implements RetailerApprovalStore {
  constructor(private readonly client: SupabaseClient) {}

  async getNoticeForReview(publisher: RetailerPublisher, nativeId: string) {
    const { data, error } = await this.client
      .from('retailer_notices')
      .select(
        'id, publisher, native_id, document_content_hash, decision, notice_kind, food_status, ' +
          'document_extraction, stated_notice_date, retailer_item_numbers, upcs, state_claims',
      )
      .eq('publisher', publisher)
      .eq('native_id', nativeId)
      .maybeSingle();
    if (error) throw new Error(`retailer_notices read failed: ${error.message}`);
    if (!data) return null;
    const row = data as unknown as {
      id: string;
      publisher: RetailerPublisher;
      native_id: string;
      document_content_hash: string | null;
      decision: string;
      notice_kind: string;
      food_status: string;
      document_extraction: string;
      stated_notice_date: string | null;
      retailer_item_numbers: string[];
      upcs: string[];
      state_claims: { state: string }[];
    };
    return {
      id: row.id,
      publisher: row.publisher,
      nativeId: row.native_id,
      documentContentHash: row.document_content_hash,
      decision: row.decision,
      noticeKind: row.notice_kind,
      foodStatus: row.food_status,
      documentExtraction: row.document_extraction,
      statedNoticeDate: row.stated_notice_date,
      retailerItemNumbers: row.retailer_item_numbers,
      upcs: row.upcs,
      statedStates: row.state_claims.map((claim) => claim.state),
    };
  }

  async getDocumentBytes(noticeId: string, contentHash: string) {
    const { data, error } = await this.client
      .from('retailer_notice_documents')
      .select('document_bytes')
      .eq('notice_id', noticeId)
      .eq('content_hash', contentHash)
      .maybeSingle();
    if (error) throw new Error(`retailer_notice_documents read failed: ${error.message}`);
    const bytes = (data as { document_bytes: string | null } | null)?.document_bytes;
    return bytes ? fromByteaHex(bytes) : null;
  }

  async listApprovals(noticeId: string) {
    const { data, error } = await this.client
      .from('retailer_notice_approvals')
      .select('*')
      .eq('notice_id', noticeId)
      .order('approved_at', { ascending: true });
    if (error) throw new Error(`retailer_notice_approvals read failed: ${error.message}`);
    return ((data ?? []) as ApprovalDbRow[]).map(fromDb);
  }

  async insertApproval(row: NewApprovalRow): Promise<string> {
    const { data, error } = await this.client
      .from('retailer_notice_approvals')
      .insert({
        notice_id: row.noticeId,
        document_content_hash: row.documentContentHash,
        fields_version: row.fieldsVersion,
        fields: row.fields,
        field_evidence: row.fieldEvidence,
        review_notes: row.reviewNotes,
        approved_by: row.approvedBy,
        approved_at: row.approvedAt,
      })
      .select('id')
      .single();
    if (error) throw new Error(`retailer_notice_approvals insert failed: ${error.message}`);
    return (data as { id: string }).id;
  }

  async withdrawApproval(id: string, reason: string, at: string) {
    const { error, count } = await this.client
      .from('retailer_notice_approvals')
      .update({ withdrawn_at: at, withdrawn_reason: reason }, { count: 'exact' })
      .eq('id', id)
      .is('withdrawn_at', null);
    if (error) throw new Error(`retailer_notice_approvals withdraw failed: ${error.message}`);
    if (count !== 1) throw new Error(`approval ${id} was not live (updated ${count})`);
  }

  async confirmAgencyMatch(id: string, agencyCaseId: string, at: string) {
    const { error, count } = await this.client
      .from('retailer_notice_approvals')
      .update({ agency_case_id: agencyCaseId, agency_match_confirmed_at: at }, { count: 'exact' })
      .eq('id', id)
      .is('withdrawn_at', null);
    if (error) throw new Error(`retailer_notice_approvals update failed: ${error.message}`);
    if (count !== 1) throw new Error(`approval ${id} was not live (updated ${count})`);
  }

  async agencyCaseExists(caseId: string) {
    const { data, error } = await this.client
      .from('recall_cases')
      .select('id')
      .eq('id', caseId)
      .maybeSingle();
    if (error) throw new Error(`recall_cases read failed: ${error.message}`);
    return data !== null;
  }

  async uploadImage(path: string, bytes: Uint8Array) {
    const { error } = await this.client.storage
      .from(PRODUCT_VISUALS_BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    // Content-addressed keys: "already exists" means an identical object.
    if (error && !/already exists|duplicate/i.test(error.message)) {
      throw new Error(`photo upload failed: ${error.message}`);
    }
  }
}
