/**
 * The shared, quirk-free shape every source adapter must produce
 * (architecture Part 8: "parse + normalize → NormalizedSourceRecord").
 * Nothing downstream of an adapter may know a source-specific field name.
 */

import type {
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
