/**
 * The shared, quirk-free shape every source adapter must produce
 * (architecture Part 8: "parse + normalize → NormalizedSourceRecord").
 * Nothing downstream of an adapter may know a source-specific field name.
 */

import type {
  AttachmentTable,
  Classification,
  Geography,
  HazardCategory,
  LifecycleState,
  NoticeType,
  SourceAgency,
  SourceSystem,
} from './recall-types';

export interface NormalizedSourceRecord {
  sourceSystem: SourceSystem;
  sourceAgency: SourceAgency;
  /** Normalized identity within the source system (e.g. trimmed FSIS recall number). */
  nativeId: string;
  /** The identity exactly as the source served it, kept for traceability. */
  rawNativeId: string;
  noticeType: NoticeType;
  /** Lifecycle as this record states it (retraction detection folded in). */
  lifecycle: LifecycleState;
  /** Year-granularity closure when the source provides no closure date. */
  closedYear: string | null;
  classification: Classification;
  /** Set when this record is an expansion of another record (e.g. FSIS "005-2026-EXP"). */
  expansionOfNativeId: string | null;
  /**
   * True when the record's own text declares it an expansion of an existing
   * recall without naming a linkable identity ("Lidl US Expands Recall of…").
   * The pipeline then SEARCHES for the parent under an evidence gate instead
   * of founding a duplicate case. Absent on records normalized before this
   * field existed; absence means unknown, never true.
   */
  declaresExpansion?: boolean;
  /**
   * True when the record's body opens with FDA's editorial revision note
   * ("…the recalling firm updated their press release to…"): a corrected
   * re-publication of an existing announcement, under a fresh slug whenever
   * the correction changed the title. The pipeline searches for the original
   * under an evidence gate, exactly as for a declared expansion. Absent on
   * records normalized before this field existed; absence means unknown.
   */
  declaresRevision?: boolean;
  /** True when this record announces the retraction of a notice. */
  isRetractionNotice: boolean;
  /** Native ids referenced by a retraction notice, excluding this record's own. */
  retractsNativeIds: string[];
  title: string;
  summaryText: string;
  summaryHtml: string | null;
  reasonText: string | null;
  hazardCategory: HazardCategory;
  pathogenOrAllergen: string | null;
  firmDisplayName: string | null;
  firmRawVariants: string[];
  /** Source-structured brand names (FDA listing/detail); omitted by adapters
   * recorded before this field existed — readers must default to []. */
  brands?: string[];
  /** Source-structured product description (FDA); omitted = null. */
  productDescription?: string | null;
  /** Source-stated retailer names ("sold at BJ's Wholesale Club stores") —
   * a consumer role distinct from the recalling firm and brand. Never
   * inferred from retail footprint; omitted by older adapters = []. */
  retailerNames?: string[];
  /** Lead product photo URL for feed cards; omitted = none available. */
  heroImageUrl?: string | null;
  /** Product/label image URLs when trivially present in the official notice
   * (FDA detail pages); URL capture only — no image pipeline. */
  imageUrls?: string[];
  /**
   * What the notice's official attachment PDFs verifiably add (FSIS only):
   * written by the attachment sync, never by the adapter, and re-attached by
   * re-derivation exactly as the enforcement match block is. Its values are
   * ALSO applied to `productDescription`, `brands` and
   * `attachmentTables` (see `applyAttachmentEnrichment`), which is what
   * `projectCase` reads. Absent = no verified attachment data.
   */
  attachmentEnrichment?: AttachmentEnrichment;
  /** Verified attachment product tables (copied from `attachmentEnrichment`). */
  attachmentTables?: AttachmentTable[];
  geography: Geography;
  /** Source-structured product lines (raw text preserved per line). */
  productLines: string[];
  quantityText: string | null;
  illnessStatement: string | null;
  consumerAction: string | null;
  contactText: string | null;
  officialUrl: string;
  /** ISO date the source published this record. */
  publishedAt: string;
  /** ISO date the source last modified this record, when stated. */
  lastModifiedAt: string | null;
}

/** One official attachment the enrichment read, with its verdict. */
export interface AttachmentSource {
  url: string;
  kind: 'labels' | 'product_list';
  /** The notice's own link text ("View product labels."). */
  linkText: string;
  sha256: string;
  status: 'verified' | 'needs_review' | 'unreadable';
  /** Why a human should look; empty when verified. */
  reviewReasons: string[];
}

/**
 * The verified product facts official attachments add to a notice, with
 * their provenance. Values are null/empty whenever they could not be
 * verified — the notice itself is never withheld for want of them.
 */
export interface AttachmentEnrichment {
  version: 1;
  /** Verified product name (or the multi-product name), or null. */
  productDescription: string | null;
  /** Verified brand names printed in the attachment. */
  brands: string[];
  tables: AttachmentTable[];
  sources: AttachmentSource[];
}

/**
 * Apply a stored enrichment block to a freshly parsed record. Pure: the
 * adapter's own values win wherever it states them (an FDA-style structured
 * description or brand list is never overwritten), and an absent block
 * returns the record unchanged.
 */
export function applyAttachmentEnrichment(
  record: NormalizedSourceRecord,
  enrichment: AttachmentEnrichment | undefined,
): NormalizedSourceRecord {
  if (!enrichment) return record;
  const out: NormalizedSourceRecord = { ...record, attachmentEnrichment: enrichment };
  if ((record.productDescription ?? null) === null && enrichment.productDescription !== null) {
    out.productDescription = enrichment.productDescription;
  }
  if ((record.brands ?? []).length === 0 && enrichment.brands.length > 0) {
    out.brands = enrichment.brands;
  }
  if (enrichment.tables.length > 0) out.attachmentTables = enrichment.tables;
  return out;
}

/**
 * Undo a previously applied enrichment block, returning the record as the
 * adapter produced it — so a revised enrichment replaces the old values
 * instead of being refused by `applyAttachmentEnrichment`'s "adapter wins"
 * rule. Only values still equal to what the block set are removed.
 */
export function withoutAttachmentEnrichment(
  record: NormalizedSourceRecord,
): NormalizedSourceRecord {
  const previous = record.attachmentEnrichment;
  if (!previous) return record;
  const out: NormalizedSourceRecord = { ...record };
  delete out.attachmentEnrichment;
  delete out.attachmentTables;
  if (
    previous.productDescription !== null &&
    out.productDescription === previous.productDescription
  ) {
    delete out.productDescription;
  }
  if (
    previous.brands.length > 0 &&
    JSON.stringify(out.brands ?? []) === JSON.stringify(previous.brands)
  ) {
    delete out.brands;
  }
  return out;
}
