/**
 * Canonical recall domain types, per docs/recall-domain-architecture.md.
 *
 * These are storage-agnostic. The rule that governs every field: absence of
 * knowledge is explicit (`null` / 'unknown'), never an empty string, empty
 * array, or guessed default.
 */

import type { FoodCategoryId } from './food-category';

export type SourceAgency = 'FDA' | 'FSIS';

export type SourceSystem = 'fsis_api' | 'fda_announcement' | 'openfda_enforcement';

export type NoticeType = 'recall' | 'public_health_alert';

/** Consumer lifecycle states (architecture Part 2). */
export type LifecycleState = 'active' | 'closed' | 'retracted';

/** The three authoritative agency classes. Only an agency may assign one. */
export type OfficialClass = 'class_I' | 'class_II' | 'class_III';

export type ClassificationValue =
  | OfficialClass
  | 'not_yet_classified'
  | 'not_applicable_pha'
  /**
   * A CASE whose authoritative records carry more than one official class
   * (FDA classifies per product, not per announcement). It never appears on a
   * source record. The scalar deliberately refuses to name one class here:
   * every reader that assumes a case has a single class gets an unmistakable
   * value instead of a quietly-promoted "Class I".
   */
  | 'multiple_classes';

export interface Classification {
  value: ClassificationValue;
  /** Raw source wording, e.g. "High - Class I" — always displayed with the agency label. */
  sourceText: string | null;
  /**
   * Every DISTINCT authoritative class on this case, most severe first — the
   * canonical representation. A source record carries at most one and may omit
   * this; projections persisted before Phase B lack the key, so readers must
   * treat `undefined` as "derive from `value`" (src/domain/risk-tier.ts does).
   */
  officialClasses?: OfficialClass[];
}

export type HazardCategory =
  | 'allergen'
  | 'microbial_contamination'
  | 'foreign_material'
  | 'chemical_contamination'
  | 'product_integrity'
  | 'other_regulatory'
  | 'unknown';

/** Tri-state geography (architecture Part 5). `unknown` is not `nationwide` and not "none". */
export interface Geography {
  scope: 'states' | 'nationwide' | 'unknown';
  /** Non-empty iff scope = 'states'. */
  states: string[];
  confidence: 'stated' | 'inferred';
  /** The source distribution text this was derived from, when available. */
  sourceText: string | null;
}

export interface AffectedProduct {
  /** Source-record provenance (native id within the source system). */
  sourceNativeId: string;
  name: string;
  rawText: string;
  /** 'stated' = the source structured this line; 'extracted' = best-effort from prose. */
  extractionConfidence: 'stated' | 'extracted';
}

export interface SourceIdentifier {
  system: SourceSystem;
  id: string;
  /** Raw form before normalization (e.g. untrimmed FSIS number), when it differs. */
  rawId?: string;
  url?: string;
}

export type TimelineKind =
  'published' | 'expanded' | 'corrected' | 'classified' | 'closed' | 'retracted' | 'source_updated';

export interface TimelineEntry {
  /** Source-published date when available, else ingest time (ISO 8601). */
  occurredAt: string;
  kind: TimelineKind;
  summary: string;
  /** Snapshot ids that caused this entry — the audit chain back to raw bytes. */
  causedBySnapshotIds: string[];
  /** Layer-2 verdict: was this consumer-relevant (architecture Part 9)? */
  material: boolean;
  /** Material-change rule that fired, when material. */
  ruleId?: MaterialChangeRuleId;
  /**
   * Present ONLY on `corrected` entries appended by a governed historical
   * repair (O3-B5): the app corrected its own reading of the ORIGINAL
   * official notice. Never a new agency update — feed ordering, published
   * dates, and notification history are untouched, and
   * `notificationEventCreated` is pinned false. Readers that don't know
   * this block ignore it (JSONB forward compatibility).
   */
  repair?: {
    /** Deterministic dedup fingerprint — a rerun can never duplicate the entry. */
    fingerprint: string;
    derivationContract: string;
    wave: string;
    changedCategories: string[];
    consumerVisible: boolean;
    notificationEventCreated: false;
  };
}

/**
 * The canonical consumer projection of a recall case — the fields users see,
 * recomputed as a pure function of the case's linked source records
 * (architecture Part 8.4). Material-change detection diffs exactly this shape.
 */
export interface CaseProjection {
  sourceAgency: SourceAgency;
  noticeType: NoticeType;
  state: LifecycleState;
  /** FSIS closure has year granularity only; null when unknown/not closed. */
  closedYear: string | null;
  classification: Classification;
  title: string;
  summaryText: string;
  summaryHtml: string | null;
  reasonText: string | null;
  hazardCategory: HazardCategory;
  pathogenOrAllergen: string | null;
  recallingFirm: { displayName: string | null; rawVariants: string[] };
  brands: string[];
  /** Source-structured consumer product description (FDA listing provides one;
   * FSIS does not — null there). Projections persisted before this field
   * existed lack the key; readers must treat `undefined` as null. */
  productDescription: string | null;
  /** Source-stated retailers ("Sold at") — distinct from recalling firm and
   * brand; the future store-preference personalization signal. Projections
   * persisted before this field existed lack the key (readers default to [],
   * and the display layer re-derives from preserved source text). */
  retailerNames: string[];
  /**
   * Authoritative agency-hosted URL of the lead product photo, for feed-card
   * recognition. Kept as a single short string because a list card cannot
   * carry the announcement HTML the detail screen derives its gallery from.
   * Projections persisted before this field existed lack the key; cards
   * render cleanly without a thumbnail and gain one at the next ingest.
   */
  heroImageUrl: string | null;
  /**
   * What KIND of product was recalled (C10A) — the future Category filter's
   * only input. Derived deterministically from the case's own product text by
   * `deriveProductCategories`; never from the hazard, allergen, pathogen,
   * firm, brand or retailer.
   *
   * OPTIONAL ON PURPOSE. Projections persisted before this field existed lack
   * the key entirely, and absence means "not derived yet" — which is NOT the
   * same as `['other']`, the honest answer for a product we read and could not
   * name. Readers must go through `readProductCategories` (domain/projection),
   * which keeps that distinction; nothing may coalesce a missing key to a
   * category. Cases gain the field at their next legitimate re-projection, or
   * in bulk from the historical backfill.
   *
   * DISCOVERY ONLY. This never affects relevance, Affects Me, risk, ranking,
   * push eligibility, notification eligibility, or membership of the
   * unfiltered feed — see docs/recall-food-categories.md.
   */
  productCategories?: FoodCategoryId[];
  geography: Geography;
  affectedProducts: AffectedProduct[];
  quantityText: string | null;
  /** null = source silent (unknown); explicit "no illnesses reported" text is preserved verbatim. */
  illnessStatement: string | null;
  /** Deterministically derived: does the illness statement report actual illnesses? */
  reportsIllness: boolean;
  consumerAction: string | null;
  contactText: string | null;
  officialUrl: string;
  otherOfficialUrls: string[];
  sourceIdentifiers: SourceIdentifier[];
  /** ISO date the public was first told (earliest linked notice). */
  publishedAt: string;
  /** Max of source-published activity dates — never our fetch time. */
  lastPublicActivityAt: string;
}

export type MaterialChangeRuleId =
  | 'expansion_products'
  | 'expansion_geography'
  | 'correction_broadened'
  | 'classification_assigned'
  | 'classification_upgraded'
  | 'classification_downgraded'
  /**
   * The authoritative class SET changed in a way that "upgraded"/"downgraded"
   * cannot honestly describe (e.g. {Class I} → {Class I, Class II}). Ordering
   * between sets is not defined, so no direction is claimed.
   */
  | 'classification_changed'
  | 'health_impact'
  | 'instructions_changed'
  | 'retraction';

export interface MaterialChange {
  ruleId: MaterialChangeRuleId;
  summary: string;
  /** Deterministic fingerprint of the specific change, for notification dedup. */
  fingerprint: string;
}

export type NotificationKind = 'initial' | 'material_update';

export type NotificationSuppression = 'backfill' | 'coalesced';
