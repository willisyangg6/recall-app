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
