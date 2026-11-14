/**
 * Retailer notice monitoring — the private, server-only shapes.
 *
 * A retailer notice is a NOTICE a store published (Costco's member letters),
 * not a government record and not a recall case. In this slice it is stored
 * in its own private table and never projected into `recall_cases`, the feed,
 * or the notification ledger (docs/recall-retailer-notices.md).
 *
 * The rule that governs every field, as in the canonical domain types: what a
 * notice does not state is `null` / `[]`, never inferred — no nationwide
 * scope from a missing state list, no agency or classification from a
 * product type, no closure from a notice leaving the index.
 */

export type RetailerPublisher = 'costco';

/** One entry on the retailer's public index, exactly as published. */
export interface RetailerIndexEntry {
  publisher: RetailerPublisher;
  /** Stable CMS id of the index entry (Costco: the `blt…` text_builder uid). */
  nativeId: string;
  /** The label the retailer printed, e.g. "Recall Notice". Not a status. */
  indexLabel: string | null;
  indexTitle: string;
  documentUrl: string;
}

/** How the document's text was obtained. */
export type DocumentExtraction = 'text' | 'image_only' | 'failed';

/** What the document says it is. Never taken from the index label alone. */
export type NoticeKind = 'recall' | 'public_health_alert' | 'quality_notice' | 'unclear';

export type FoodStatus = 'food' | 'non_food' | 'unclear';

/**
 * A retailer + state pair. A state is only ever recorded together with the
 * retailer the document says sold there — never as a bare geography claim.
 */
export interface StateClaim {
  retailer: string;
  /** Full state name, the canonical form `Geography.states` uses. */
  state: string;
  basis: 'stated_state_list' | 'named_store_locations';
  /** The sentence the state was read from, verbatim. */
  evidence: string;
}

/**
 * A package description the document printed ("67oz, 20-count"). Evidence
 * only: it is NEVER a product identifier, and `verifiedInAgencyNotice` says
 * only whether the linked agency notice prints the same size token.
 */
export interface PackageClaim {
  text: string;
  sizeTokens: string[];
  /** null = no agency notice to check against (no link candidate). */
  verifiedInAgencyNotice: boolean | null;
  /** The size tokens the linked agency notice does not print. */
  unverifiedSizeTokens: string[];
}

/** Everything read from one document. Item numbers and UPCs never mix. */
export interface ParsedNotice {
  extraction: DocumentExtraction;
  /** Stated in the document, as ISO date — null when the document states none. */
  statedNoticeDate: string | null;
  statedNoticeDateText: string | null;
  recallingFirmText: string | null;
  recallingFirmEvidence: string | null;
  agenciesNamed: string[];
  noticeKind: NoticeKind;
  noticeKindEvidence: string | null;
  foodStatus: FoodStatus;
  foodEvidence: string[];
  /** The retailer's own item numbers (Costco "Item #"). Not UPCs. */
  retailerItemNumbers: string[];
  /** Barcodes the document labels as UPC. */
  upcs: string[];
  /** Lines carrying lot / date / code scope, verbatim. */
  codeEvidence: string[];
  packageClaims: PackageClaim[];
  stateClaims: StateClaim[];
  /** Raw scope phrase from the index title ("Select Locations in the Midwest"), never mapped. */
  indexScopeText: string | null;
}

/** The read-only slice of an agency case the matcher needs. */
export interface AgencyCaseView {
  id: string;
  sourceAgency: 'FDA' | 'FSIS';
  noticeType: 'recall' | 'public_health_alert';
  state: string;
  publishedAt: string;
  title: string;
  firm: string | null;
  brands: string[];
  /** Announcement / record text the codes and sizes are checked against. */
  text: string;
  retailerNames: string[];
  geography: { scope: 'states' | 'nationwide' | 'unknown'; states: string[] };
}

export type NoticeDecision = 'new_candidate' | 'link_candidate' | 'review' | 'excluded';

export type DecisionReason =
  | 'document_unreadable'
  | 'scanned_document'
  | 'non_food'
  | 'food_status_unclear'
  | 'quality_notice_not_recall'
  | 'notice_kind_unclear'
  | 'undated'
  | 'no_agency_match'
  | 'single_agency_match'
  | 'multiple_agency_candidates'
  | 'codes_not_in_agency_notice'
  | 'retailer_states_outside_agency_scope'
  // Flags: recorded with the decision, never decisive on their own.
  | 'retailer_notice_dated_before_agency'
  | 'package_claim_unverified'
  | 'retailer_label_differs_from_agency_status';

export interface NoticeDecisionResult {
  decision: NoticeDecision;
  reasons: DecisionReason[];
  linkCaseId: string | null;
  candidateCaseIds: string[];
  /** Days the agency published AFTER the retailer's stated date (positive = retailer first). */
  agencyLagDays: number | null;
}

/** The row stored in `retailer_notices` (camelCase mirror). */
export interface RetailerNoticeRow {
  publisher: RetailerPublisher;
  nativeId: string;
  indexLabel: string | null;
  indexTitle: string;
  indexUrl: string;
  documentUrl: string;
  firstSeenAt: string;
  lastSeenOnIndexAt: string;
  statedNoticeDate: string | null;
  statedNoticeDateText: string | null;
  recallingFirmText: string | null;
  agenciesNamed: string[];
  noticeKind: NoticeKind;
  foodStatus: FoodStatus;
  retailerItemNumbers: string[];
  upcs: string[];
  codeEvidence: string[];
  packageClaims: PackageClaim[];
  stateClaims: StateClaim[];
  indexScopeText: string | null;
  evidence: Record<string, string | string[] | null>;
  documentExtraction: DocumentExtraction;
  documentContentHash: string;
  decision: NoticeDecision;
  decisionReasons: DecisionReason[];
  linkCaseId: string | null;
  candidateCaseIds: string[];
  agencyLagDays: number | null;
  decidedAt: string;
  parserVersion: string;
}

/** One archived document version (append-only, hash-gated). */
export interface RetailerNoticeDocument {
  nativeId: string;
  publisher: RetailerPublisher;
  fetchedAt: string;
  documentUrl: string;
  contentHash: string;
  contentType: string | null;
  bytes: Uint8Array;
  extractedText: string | null;
  indexEntry: RetailerIndexEntry;
}
