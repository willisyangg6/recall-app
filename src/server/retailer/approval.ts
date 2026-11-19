/**
 * The private approval step for retailer notices
 * (docs/recall-retailer-notices.md, "Approval and the client read path").
 *
 * A reviewer approves ONE archived letter: the approval records that letter's
 * exact SHA-256, the shopper-facing fields they approved, and the verbatim
 * excerpt and PDF page behind each field. Nothing is shown to a shopper unless
 * an approval's hash equals the notice's CURRENT document hash, so a revised
 * letter goes back to review automatically: the read path
 * (consumer_retailer_notices()) stops returning it the moment the monitor
 * archives a new hash.
 *
 * Everything here is a plan first. `planApproval`, `planWithdrawal` and
 * `planAgencyMatch` read and decide; `applyApprovalPlan` is the only writer,
 * and the CLI reaches it only through the shared three-flag contract.
 *
 * Writes only retailer_notice_approvals. Reads retailer_notices,
 * retailer_notice_documents and (to confirm an agency match exists)
 * recall_cases. Never writes a case, a source record or the notification
 * ledger, so an approval can neither change the agency feed nor send an alert.
 */

import {
  PACKAGE_CHECK_KEYS,
  RETAILER_NOTICE_FIELDS_VERSION,
  readRetailerNoticeFields,
  type RetailerNoticeFields,
} from '../../lib/retailer-notice-fields';
import type { FoodCategoryId } from '../../domain/food-category';
import { categoriesForCase } from '../../domain/food-category-matcher';
import { STATE_TO_POSTAL } from '../../domain/us-geography';
import { stableJson } from './costco-monitor';
import { embeddedJpegImages, type PdfEmbeddedJpeg } from './pdf-images';
import { isRetailerPublisher, RETAILER_SOURCES } from './sources';
import {
  planRetailerNoticeEvents,
  sameRecallAgencyCases,
  type LedgeredNoticeEvent,
  type RetailerMatchEvidence,
  type RetailerNoticeEventInput,
  type RetailerNoticeSubject,
} from './notice-events';
import type { AgencyCaseView, RetailerPublisher } from './types';

/** One verbatim excerpt and the PDF page (1-based) it is printed on. */
export interface FieldEvidence {
  excerpt: string;
  page: number;
}

/** Every field an approval can carry evidence for, by path. */
export const EVIDENCE_KEYS = [
  'productName',
  'size',
  'firmName',
  'whatHappened',
  'whyRecalled',
  'reason.agent',
  'whereSold.states',
  'whereSold.purchaseWindow',
  ...PACKAGE_CHECK_KEYS.map((key) => `packageChecks.${key}` as const),
  'instructions',
  'contact',
] as const;
export type EvidenceKey = (typeof EVIDENCE_KEYS)[number];

export interface ApprovalRequest {
  publisher: RetailerPublisher;
  noticeNativeId: string;
  /** The SHA-256 of the archived letter the reviewer read. */
  documentContentHash: string;
  approvedBy: string;
  fields: RetailerNoticeFields;
  evidence: Partial<Record<EvidenceKey, FieldEvidence[]>>;
  reviewNotes: string | null;
}

/** The facts of a stored notice the approval step checks against. */
export interface NoticeForReview {
  id: string;
  publisher: RetailerPublisher;
  nativeId: string;
  documentContentHash: string | null;
  decision: string;
  noticeKind: string;
  foodStatus: string;
  documentExtraction: string;
  statedNoticeDate: string | null;
  retailerItemNumbers: string[];
  upcs: string[];
  /** States the letter itself lists for this retailer (state_claims). */
  statedStates: string[];
}

export interface ApprovalRow {
  id: string;
  noticeId: string;
  documentContentHash: string;
  fieldsVersion: number;
  fields: unknown;
  fieldEvidence: unknown;
  /**
   * The shared server-side classifier's categories for the approved product
   * (`categoriesForCase`, the same derivation agency cases store), or null
   * for an approval written before it existed. Derived, never reviewed.
   */
  productCategories: FoodCategoryId[] | null;
  reviewNotes: string | null;
  approvedBy: string;
  approvedAt: string;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  agencyCaseId: string | null;
  agencyMatchConfirmedAt: string | null;
}

export type NewApprovalRow = Omit<
  ApprovalRow,
  'id' | 'withdrawnAt' | 'withdrawnReason' | 'agencyCaseId' | 'agencyMatchConfirmedAt'
>;

export type ApprovalWrite =
  | { kind: 'withdraw'; approvalId: string; reason: string; at: string }
  | { kind: 'insert'; row: NewApprovalRow }
  | { kind: 'confirm_agency_match'; approvalId: string; agencyCaseId: string; at: string }
  /** The verified photo bytes, to their content-addressed product-visuals key. */
  | { kind: 'upload_image'; path: string; bytes: Uint8Array }
  /** The alert ledger row the approval publishes (notice-events.ts). */
  | { kind: 'notification_event'; event: RetailerNoticeEventInput };

export interface ApprovalPlan {
  /** Why the request cannot be applied. Non-empty means nothing is written. */
  problems: string[];
  writes: ApprovalWrite[];
  /** Human-readable account of each write, for the dry run. */
  summary: string[];
}

export interface RetailerApprovalStore {
  getNoticeForReview(
    publisher: RetailerPublisher,
    nativeId: string,
  ): Promise<NoticeForReview | null>;
  /** The archived letter's bytes for this exact hash, or null if none is archived. */
  getDocumentBytes(noticeId: string, contentHash: string): Promise<Uint8Array | null>;
  /**
   * What the monitor matched this letter on — its index entry and extracted
   * text — or null when no text was archived for this hash.
   */
  getMatchEvidence(noticeId: string, contentHash: string): Promise<RetailerMatchEvidence | null>;
  /** Agency cases published on or after `fromIso`, in the monitor's own view (read-only). */
  listAgencyCases(fromIso: string): Promise<AgencyCaseView[]>;
  /** The notice's ledgered notification events, oldest first. */
  listNoticeEvents(noticeId: string): Promise<LedgeredNoticeEvent[]>;
  /** Ledger one event; a dedup key already present is a no-op. */
  insertNoticeEvent(event: RetailerNoticeEventInput): Promise<void>;
  listApprovals(noticeId: string): Promise<ApprovalRow[]>;
  insertApproval(row: NewApprovalRow): Promise<string>;
  withdrawApproval(id: string, reason: string, at: string): Promise<void>;
  confirmAgencyMatch(id: string, agencyCaseId: string, at: string): Promise<void>;
  agencyCaseExists(caseId: string): Promise<boolean>;
  /** Store a verified photo at its content-addressed key (idempotent). */
  uploadImage(path: string, bytes: Uint8Array): Promise<void>;
}

/** The monitor's same-recall window around a letter's date (decide.ts MATCH_WINDOW_DAYS). */
const AGENCY_MATCH_LOOKBACK_DAYS = 60;

const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Numbers, dates, times, codes and email addresses in a value. A reviewer may
 * phrase prose in their own words, but every one of these must be printed in
 * the field's own evidence: an approval can never introduce a code, date or
 * contact the letter does not print.
 */
export function factTokens(value: string): string[] {
  return (value.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+|[A-Za-z]*\d(?:[\w/:.-]|,(?=\d))*/g) ?? []).map(
    (token) =>
      // Sentence punctuation is not part of a code: "10/31/2026." is 10/31/2026.
      token.replace(/[.:-]+$/, ''),
  );
}

/** Values the card shows as printed, so each must appear verbatim in its evidence. */
const VERBATIM_KEYS = new Set<EvidenceKey>([
  'productName',
  'reason.agent',
  'size',
  'firmName',
  'whereSold.states',
  ...PACKAGE_CHECK_KEYS.map((key) => `packageChecks.${key}` as const),
]);

/**
 * A warehouse list names states by postal code ("Missoula, MT"). A state is
 * printed in such an excerpt when its own code follows a comma, as in a
 * "City, ST" pair; any other spelling is still refused.
 */
function citesPostal(cited: string, state: string): boolean {
  const postal = STATE_TO_POSTAL[state];
  return postal !== undefined && new RegExp(`,\\s*${postal}\\b`).test(cited);
}

/** The value(s) an approval shows for an evidence key; [] when the field is absent. */
export function fieldValues(fields: RetailerNoticeFields, key: EvidenceKey): string[] {
  switch (key) {
    case 'productName':
      return [fields.productName];
    case 'size':
      return fields.size === null ? [] : [fields.size];
    case 'firmName':
      return [fields.firmName];
    case 'whatHappened':
      return [fields.whatHappened];
    case 'whyRecalled':
      return [fields.whyRecalled];
    case 'reason.agent':
      return fields.reason.agent === null ? [] : [fields.reason.agent];
    case 'whereSold.states':
      return fields.whereSold.states;
    case 'whereSold.purchaseWindow':
      return fields.whereSold.purchaseWindow === null ? [] : [fields.whereSold.purchaseWindow];
    case 'instructions':
      return fields.instructions;
    case 'contact':
      return fields.contact === null ? [] : [fields.contact];
    default:
      return fields.packageChecks[
        key.slice('packageChecks.'.length) as keyof RetailerNoticeFields['packageChecks']
      ];
  }
}

/** The strict reader for a reviewer's approval file. */
export function readApprovalRequest(value: unknown): ApprovalRequest | { error: string } {
  if (typeof value !== 'object' || value === null) return { error: 'not a JSON object' };
  const raw = value as Record<string, unknown>;
  if (typeof raw.publisher !== 'string' || !isRetailerPublisher(raw.publisher)) {
    return { error: `publisher must be one of ${Object.keys(RETAILER_SOURCES).join(', ')}` };
  }
  const publisher = raw.publisher;
  if (typeof raw.noticeNativeId !== 'string' || raw.noticeNativeId === '') {
    return { error: 'noticeNativeId is required' };
  }
  if (typeof raw.documentContentHash !== 'string' || !HASH.test(raw.documentContentHash)) {
    return { error: 'documentContentHash must be a 64-character lowercase SHA-256' };
  }
  if (typeof raw.approvedBy !== 'string' || raw.approvedBy.trim() === '') {
    return { error: 'approvedBy is required' };
  }
  const fields = readRetailerNoticeFields(raw.fields);
  if (!fields || stableJson(fields) !== stableJson(raw.fields)) {
    return { error: 'fields do not match the version-1 shape exactly' };
  }
  if (fields.retailer !== RETAILER_SOURCES[publisher].displayName) {
    return {
      error: `fields.retailer must be "${RETAILER_SOURCES[publisher].displayName}" for ${publisher}`,
    };
  }
  if (typeof raw.evidence !== 'object' || raw.evidence === null || Array.isArray(raw.evidence)) {
    return { error: 'evidence must be an object keyed by field' };
  }
  const evidence: Partial<Record<EvidenceKey, FieldEvidence[]>> = {};
  for (const [key, entries] of Object.entries(raw.evidence as Record<string, unknown>)) {
    if (!(EVIDENCE_KEYS as readonly string[]).includes(key)) {
      return { error: `unknown evidence key "${key}"` };
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return { error: `evidence.${key} must be a non-empty list` };
    }
    const list: FieldEvidence[] = [];
    for (const entry of entries) {
      const item = entry as Record<string, unknown>;
      if (typeof item?.excerpt !== 'string' || item.excerpt.trim() === '') {
        return { error: `evidence.${key} has an empty excerpt` };
      }
      if (typeof item.page !== 'number' || !Number.isInteger(item.page) || item.page < 1) {
        return { error: `evidence.${key} has an invalid page` };
      }
      list.push({ excerpt: item.excerpt, page: item.page });
    }
    evidence[key as EvidenceKey] = list;
  }
  if (raw.reviewNotes !== null && typeof raw.reviewNotes !== 'string') {
    return { error: 'reviewNotes must be a string or null' };
  }
  return {
    publisher,
    noticeNativeId: raw.noticeNativeId,
    documentContentHash: raw.documentContentHash,
    approvedBy: raw.approvedBy.trim(),
    fields,
    evidence,
    reviewNotes: (raw.reviewNotes as string | null) ?? null,
  };
}

/** Why this notice could not be shown even if approved (mirrors the read path). */
function visibilityProblems(notice: NoticeForReview): string[] {
  const problems: string[] = [];
  if (notice.decision !== 'new_candidate') {
    problems.push(
      `the monitor classes this notice "${notice.decision}", not a standalone new candidate`,
    );
  }
  if (notice.noticeKind !== 'recall')
    problems.push(`notice kind is "${notice.noticeKind}", not a recall`);
  if (notice.foodStatus !== 'food') problems.push(`food status is "${notice.foodStatus}"`);
  if (notice.documentExtraction !== 'text') {
    problems.push(`the letter was read as "${notice.documentExtraction}", not text`);
  }
  if (!notice.statedNoticeDate) problems.push('the letter states no date');
  return problems;
}

/** Every check between the request, the stored notice and the archived letter. */
/**
 * The approved photo must be an image embedded in THIS letter: the same PDF
 * object, size and SHA-256, at the path that names this letter's hash. A
 * revised letter has a new hash, so an old path can never be re-approved
 * for it, and the old approval stops being shown the moment the letter
 * changes.
 */
export function imageProblems(
  request: ApprovalRequest,
  images: PdfEmbeddedJpeg[] | null,
): { problems: string[]; image: PdfEmbeddedJpeg | null } {
  const approved = request.fields.image;
  if (approved === null) return { problems: [], image: null };
  if (images === null) {
    return {
      problems: ["the letter's images cannot be read, so no photo can be approved"],
      image: null,
    };
  }
  const found = images.find((image) => image.objectNumber === approved.pdfObject) ?? null;
  if (!found)
    return {
      problems: [`the letter has no JPEG in PDF object ${approved.pdfObject}`],
      image: null,
    };
  const problems: string[] = [];
  if (found.width !== approved.width || found.height !== approved.height) {
    problems.push(
      `PDF object ${approved.pdfObject} is ${found.width}×${found.height}, not ${approved.width}×${approved.height}`,
    );
  }
  const expected = `retailer-notices/${request.documentContentHash}/${found.sha256}.jpg`;
  if (approved.path !== expected) {
    problems.push(`the photo path must be ${expected} (this letter and this exact image)`);
  }
  return { problems, image: problems.length === 0 ? found : null };
}

export function checkApproval(
  request: ApprovalRequest,
  notice: NoticeForReview,
  pageTexts: string[] | null,
): string[] {
  const problems = visibilityProblems(notice);
  const { fields } = request;

  if (notice.documentContentHash !== request.documentContentHash) {
    problems.push(
      `the reviewed letter ${request.documentContentHash.slice(0, 12)}… is not the notice's ` +
        `current letter ${notice.documentContentHash?.slice(0, 12) ?? 'none'}…: review the current letter`,
    );
  }
  if (pageTexts === null) {
    problems.push('no readable archived letter has the reviewed hash');
    return problems;
  }

  const items = new Set(notice.retailerItemNumbers);
  for (const item of fields.packageChecks.retailerItemNumbers) {
    if (!items.has(item))
      problems.push(`retailer item number ${item} is not one the letter states`);
  }
  const upcs = new Set(notice.upcs);
  for (const upc of fields.packageChecks.upcs) {
    if (!upcs.has(upc)) problems.push(`UPC ${upc} is not one the letter labels as a UPC`);
  }
  const states = new Set(notice.statedStates);
  for (const state of fields.whereSold.states) {
    if (!states.has(state)) problems.push(`state "${state}" is not one the letter lists`);
  }

  const pages = pageTexts.map(collapse);
  for (const key of EVIDENCE_KEYS) {
    const values = fieldValues(fields, key);
    const evidence = request.evidence[key] ?? [];
    if (values.length === 0) {
      if (evidence.length > 0)
        problems.push(`evidence.${key} is given for a field that is not shown`);
      continue;
    }
    if (evidence.length === 0) {
      problems.push(`${key} has no supporting excerpt`);
      continue;
    }
    for (const { excerpt, page } of evidence) {
      const printed = pages[page - 1];
      if (printed === undefined) {
        problems.push(`evidence.${key} cites page ${page}; the letter has ${pages.length}`);
      } else if (!printed.includes(collapse(excerpt))) {
        problems.push(`evidence.${key} is not printed on page ${page}: "${excerpt.slice(0, 60)}"`);
      }
    }
    const cited = evidence.map(({ excerpt }) => collapse(excerpt)).join(' ');
    for (const value of values) {
      if (VERBATIM_KEYS.has(key)) {
        if (
          !cited.includes(collapse(value)) &&
          !(key === 'whereSold.states' && citesPostal(cited, value))
        ) {
          problems.push(`${key} "${value}" is not printed in its excerpt`);
        }
        continue;
      }
      for (const token of factTokens(value)) {
        if (!cited.includes(token)) {
          problems.push(`${key} introduces "${token}", which its excerpt does not print`);
        }
      }
    }
  }
  return problems;
}

function liveApproval(approvals: ApprovalRow[]): ApprovalRow | null {
  return approvals.find((approval) => approval.withdrawnAt === null) ?? null;
}

async function noticeOrProblem(
  store: RetailerApprovalStore,
  publisher: RetailerPublisher,
  nativeId: string,
): Promise<NoticeForReview | string> {
  const notice = await store.getNoticeForReview(publisher, nativeId);
  return notice ?? `no ${publisher} notice has native id ${nativeId}`;
}

/** Plan an approval: at most one withdrawal of a superseded approval, then one insert. */
/**
 * The approved product through the SAME category derivation an agency case
 * gets (domain/food-category-matcher). The approved product name is the
 * structured product description, the path FDA's own description takes; no
 * category is chosen by hand and no product name is special-cased.
 */
export function retailerProductCategories(fields: RetailerNoticeFields): FoodCategoryId[] {
  return categoriesForCase({
    sourceAgency: 'FDA',
    title: fields.productName,
    productDescription: fields.productName,
  }).categories;
}

export async function planApproval(
  store: RetailerApprovalStore,
  request: ApprovalRequest,
  now: () => Date,
  readPages: (bytes: Uint8Array) => Promise<string[] | null>,
  readImages: (bytes: Uint8Array) => PdfEmbeddedJpeg[] | null = embeddedJpegImages,
): Promise<ApprovalPlan> {
  const notice = await noticeOrProblem(store, request.publisher, request.noticeNativeId);
  if (typeof notice === 'string') return { problems: [notice], writes: [], summary: [] };
  const bytes = await store.getDocumentBytes(notice.id, request.documentContentHash);
  const pageTexts = bytes ? await readPages(bytes) : null;
  const photo = imageProblems(request, bytes ? readImages(bytes) : null);
  const problems = [...checkApproval(request, notice, pageTexts), ...photo.problems];
  if (problems.length > 0) return { problems, writes: [], summary: [] };

  // One recall, one card, one new-recall alert: an agency case the monitor's
  // own matcher calls the same recall means the notice is no longer
  // standalone, even if the stored decision predates that case.
  const evidence = await store.getMatchEvidence(notice.id, request.documentContentHash);
  if (evidence) {
    const from = new Date(
      Date.parse(`${evidence.statedNoticeDate}T00:00:00Z`) -
        AGENCY_MATCH_LOOKBACK_DAYS * 86_400_000,
    ).toISOString();
    const same = sameRecallAgencyCases(evidence, await store.listAgencyCases(from));
    if (same.length > 0) {
      return {
        problems: [
          `agency case ${same.map((c) => c.id).join(', ')} is the same recall: confirm the agency match instead of approving`,
        ],
        writes: [],
        summary: [],
      };
    }
  }

  const at = now().toISOString();
  const approvals = await store.listApprovals(notice.id);
  const live = liveApproval(approvals);
  const row: NewApprovalRow = {
    noticeId: notice.id,
    documentContentHash: request.documentContentHash,
    fieldsVersion: RETAILER_NOTICE_FIELDS_VERSION,
    fields: request.fields,
    fieldEvidence: request.evidence,
    productCategories: retailerProductCategories(request.fields),
    reviewNotes: request.reviewNotes,
    approvedBy: request.approvedBy,
    approvedAt: at,
  };
  if (
    live &&
    live.agencyCaseId === null &&
    live.documentContentHash === row.documentContentHash &&
    stableJson(live.fields) === stableJson(row.fields) &&
    stableJson(live.fieldEvidence) === stableJson(row.fieldEvidence) &&
    stableJson(live.productCategories) === stableJson(row.productCategories) &&
    live.reviewNotes === row.reviewNotes
  ) {
    return { problems: [], writes: [], summary: ['already approved exactly as requested'] };
  }
  const writes: ApprovalWrite[] = [];
  const summary: string[] = [];
  if (live) {
    const reason =
      live.documentContentHash !== row.documentContentHash
        ? 'superseded: the letter was revised and re-reviewed'
        : 'superseded by a revised approval';
    writes.push({ kind: 'withdraw', approvalId: live.id, reason, at });
    summary.push(`withdraw approval ${live.id} (${reason})`);
  }
  if (photo.image && request.fields.image) {
    writes.push({
      kind: 'upload_image',
      path: request.fields.image.path,
      bytes: photo.image.bytes,
    });
    summary.push(
      `store photo (PDF object ${photo.image.objectNumber}, ${photo.image.width}×${photo.image.height}) at ${request.fields.image.path}`,
    );
  }
  writes.push({ kind: 'insert', row });
  summary.push(
    `approve ${request.noticeNativeId} for letter ${row.documentContentHash} by ${row.approvedBy}`,
  );

  // The alert ledger (notice-events.ts): one initial per notice ever, old
  // letters suppressed as backfill, and a revised letter diffed against the
  // approval it supersedes by the shared material-change rules.
  const subjectOf = (fields: RetailerNoticeFields): RetailerNoticeSubject => ({
    noticeId: notice.id,
    documentUrl: '',
    statedNoticeDate: notice.statedNoticeDate ?? at.slice(0, 10),
    fields,
  });
  const previousRow =
    [...approvals].sort((a, b) => b.approvedAt.localeCompare(a.approvedAt))[0] ?? null;
  const previousFields = previousRow ? readRetailerNoticeFields(previousRow.fields) : null;
  const events = planRetailerNoticeEvents({
    subject: subjectOf(request.fields),
    previous: previousFields ? subjectOf(previousFields) : null,
    history: await store.listNoticeEvents(notice.id),
    now: now(),
  });
  for (const event of events) {
    writes.push({ kind: 'notification_event', event });
    summary.push(
      `ledger ${event.kind} alert (${event.triggerRuleId})${event.suppressed ? `, suppressed: ${event.suppressed}` : ', deliverable to matching shoppers'}`,
    );
  }
  return { problems: [], writes, summary };
}

/** Plan withdrawing the live approval, which hides the notice. */
export async function planWithdrawal(
  store: RetailerApprovalStore,
  publisher: RetailerPublisher,
  nativeId: string,
  reason: string,
  now: () => Date,
): Promise<ApprovalPlan> {
  const notice = await noticeOrProblem(store, publisher, nativeId);
  if (typeof notice === 'string') return { problems: [notice], writes: [], summary: [] };
  if (reason.trim() === '') return { problems: ['a reason is required'], writes: [], summary: [] };
  const live = liveApproval(await store.listApprovals(notice.id));
  if (!live)
    return { problems: [], writes: [], summary: ['no live approval: nothing to withdraw'] };
  return {
    problems: [],
    writes: [
      { kind: 'withdraw', approvalId: live.id, reason: reason.trim(), at: now().toISOString() },
    ],
    summary: [`withdraw approval ${live.id} (${reason.trim()})`],
  };
}

/**
 * Plan confirming that an agency case is the same recall, which hides the
 * retailer notice so the recall is shown once, as the agency's.
 */
export async function planAgencyMatch(
  store: RetailerApprovalStore,
  publisher: RetailerPublisher,
  nativeId: string,
  agencyCaseId: string,
  now: () => Date,
): Promise<ApprovalPlan> {
  if (!UUID.test(agencyCaseId)) {
    return { problems: ['the agency case id must be a uuid'], writes: [], summary: [] };
  }
  const notice = await noticeOrProblem(store, publisher, nativeId);
  if (typeof notice === 'string') return { problems: [notice], writes: [], summary: [] };
  if (!(await store.agencyCaseExists(agencyCaseId))) {
    return { problems: [`no agency case ${agencyCaseId} exists`], writes: [], summary: [] };
  }
  const live = liveApproval(await store.listApprovals(notice.id));
  if (!live) {
    return {
      problems: [],
      writes: [],
      summary: ['no live approval: the notice is already hidden'],
    };
  }
  if (live.agencyCaseId === agencyCaseId) {
    return { problems: [], writes: [], summary: ['this agency match is already confirmed'] };
  }
  if (live.agencyCaseId !== null) {
    return {
      problems: [`a different agency case ${live.agencyCaseId} is already confirmed`],
      writes: [],
      summary: [],
    };
  }
  return {
    problems: [],
    writes: [
      { kind: 'confirm_agency_match', approvalId: live.id, agencyCaseId, at: now().toISOString() },
    ],
    summary: [`confirm agency case ${agencyCaseId} for ${nativeId}; the notice is hidden`],
  };
}

/** The only writer. Applies a problem-free plan in order; returns writes made. */
export async function applyApprovalPlan(
  store: RetailerApprovalStore,
  plan: ApprovalPlan,
): Promise<number> {
  if (plan.problems.length > 0) throw new Error('refusing to apply a plan with problems');
  for (const write of plan.writes) {
    if (write.kind === 'withdraw')
      await store.withdrawApproval(write.approvalId, write.reason, write.at);
    else if (write.kind === 'insert') await store.insertApproval(write.row);
    else if (write.kind === 'upload_image') await store.uploadImage(write.path, write.bytes);
    else if (write.kind === 'notification_event') await store.insertNoticeEvent(write.event);
    else await store.confirmAgencyMatch(write.approvalId, write.agencyCaseId, write.at);
  }
  return plan.writes.length;
}
