/**
 * Storage port for the ingestion pipeline. Two implementations:
 * - MemoryStore: deterministic tests, and --dry-run ingestion
 * - SupabaseStore: the durable Postgres-backed store
 *
 * The pipeline only ever talks to this interface; idempotency guarantees
 * (snapshot hash-gating, native-id upserts, notification dedup keys) are
 * enforced through it.
 */

import type { FoodCategoryId } from '../../domain/food-category';
import type {
  AffectedProduct,
  CaseProjection,
  Geography,
  HazardCategory,
  NotificationKind,
  NotificationSuppression,
  SourceSystem,
  TimelineEntry,
} from '../../domain/recall-types';
import type { NormalizedSourceRecord } from '../../domain/source-record';

export type LinkMethod = 'self' | 'expansion_prefix' | 'retraction_reference' | 'enforcement_match';

/**
 * Applied-version marker states (O3-B1). `null`/absent = legacy_unverified:
 * the row predates the marker and its application state is UNKNOWN — never
 * assumed applied (that assumption was the O3-A defect) and never treated as
 * fresh pending work (which would replay the corpus). 'superseded' is derived
 * (applied seq < latest seq), deliberately not stored.
 */
export type ApplyState = 'pending' | 'applied' | 'applied_degraded';

export interface SourceRecordRow {
  id: string;
  sourceSystem: SourceSystem;
  nativeId: string;
  recallCaseId: string;
  linkMethod: LinkMethod;
  normalized: NormalizedSourceRecord;
  sourceUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** O3 applied-version marker; optional so legacy rows and constructors predating O3 stay valid. */
  applyState?: ApplyState | null;
  appliedContentHash?: string | null;
  appliedSnapshotSeq?: number | null;
  appliedAt?: string | null;
}

/**
 * The identity-only slice of a source record (C8): enough to hash-gate an
 * unchanged record and to resolve which case a record belongs to, WITHOUT
 * transferring the normalized payload (whose summaryHtml dominates row
 * size). Measured live: a full FDA source-record row averages ~19 KB while
 * this slice is ~0.1 KB, and the ingest hot path reads one row per feed
 * item (~700–1,200 per changed run) — this slice is what makes a changed
 * tick cost kilobytes instead of megabytes.
 */
export interface SourceRecordLink {
  id: string;
  recallCaseId: string;
}

/**
 * The gate slice (O3-B1): the C8 identity slice plus the applied-version
 * marker — everything the per-item unchanged gate needs, still without the
 * normalized payload (~60 extra bytes on the ~0.1 KB slice).
 */
export interface SourceRecordGate {
  id: string;
  recallCaseId: string;
  applyState: ApplyState | null;
  appliedContentHash: string | null;
  appliedSnapshotSeq: number | null;
}

/** Identity of a record's newest archived snapshot (single-row read). */
export interface SnapshotMeta {
  id: string;
  seq: number;
  contentHash: string;
  fetchedAt: string;
}

export type ArchiveSnapshotResult =
  /** A genuinely new version was archived and the record set pending — one transaction. */
  | { status: 'archived'; snapshotId: string; snapshotSeq: number }
  /** The latest archived snapshot already carries this hash; nothing written. */
  | { status: 'duplicate'; snapshotId: string; snapshotSeq: number }
  /** The incoming fetch is OLDER than the newest archived one — stale worker, no write. */
  | { status: 'stale' };

/** One record's applied-marker completion, carried by a case transition. */
export interface AppliedMarker {
  sourceRecordId: string;
  contentHash: string;
  snapshotSeq: number;
  state: Extract<ApplyState, 'applied' | 'applied_degraded'>;
  appliedAt: string;
}

/**
 * One atomic consumer transition (O3-B1): case projection + timeline +
 * last_changed_at (CAS on `expectedLastChangedAt`), the complete
 * affected-product set, the notification events this transition produces,
 * and the applied markers of every source version it carries — all-or-
 * nothing. Event dedup collisions are idempotent success; a CAS miss writes
 * nothing and reports 'conflict'.
 */
export interface CaseTransitionInput {
  recallCaseId: string;
  expectedLastChangedAt: string;
  projection: CaseProjection;
  timeline: TimelineEntry[];
  lastChangedAt: string;
  products: AffectedProduct[];
  events: NotificationEventInput[];
  markers: AppliedMarker[];
}

export type CaseTransitionResult =
  { status: 'applied'; insertedDedupKeys: string[] } | { status: 'conflict' };

/** Atomic founding (O3-B1): case + record + snapshot + products + initial event + marker. */
export interface FoundCaseInput {
  caseRow: Omit<RecallCaseRow, 'id'>;
  record: {
    sourceSystem: SourceSystem;
    nativeId: string;
    linkMethod: LinkMethod;
    normalized: NormalizedSourceRecord;
    sourceUrl: string;
    firstSeenAt: string;
    lastSeenAt: string;
    applyState: Extract<ApplyState, 'applied' | 'applied_degraded'>;
    appliedContentHash: string;
    appliedAt: string;
  };
  /** `id` is app-generated so the founding timeline can reference it in-transaction. */
  snapshot: {
    id: string;
    fetchedAt: string;
    contentHash: string;
    rawPayload: unknown;
    sourceUrl: string;
  };
  products: AffectedProduct[];
  /**
   * The initial event minus its case-dependent fields: dedup_key is built
   * server-side as `initial:{caseId}` and sourceSnapshotIds is the founding
   * snapshot — both anchored inside the transaction.
   */
  initialEvent: {
    triggerRuleId: string;
    payloadSummary: string;
    suppressed: NotificationSuppression | null;
    createdAt: string;
  } | null;
}

export type FoundCaseResult =
  | {
      status: 'founded';
      caseId: string;
      recordId: string;
      snapshotSeq: number;
      initialInserted: boolean;
    }
  /** The identity already exists (prior founding or a concurrent winner) — nothing written. */
  | { status: 'record_exists' };

export interface RecallCaseRow {
  id: string;
  projection: CaseProjection;
  timeline: TimelineEntry[];
  createdAt: string;
  lastChangedAt: string;
}

/**
 * One rendered page of an official label document (a product_visuals row).
 * Detail-screen evidence; under the C9 frozen policy these never become
 * card heroes automatically (professional hero sourcing is C9.1).
 */
export interface CaseVisualRow {
  recallCaseId: string;
  /** The official source document (provenance). */
  sourceUrl: string;
  sourceSha256: string;
  page: number;
  /** Public URL of the hosted rendered image. */
  url: string;
  role: string;
  width: number | null;
  height: number | null;
  contentHash: string;
}

export interface NotificationEventInput {
  recallCaseId: string;
  kind: NotificationKind;
  triggerRuleId: string;
  dedupKey: string;
  materialChangeRef: string | null;
  payloadSummary: string;
  suppressed: NotificationSuppression | null;
  sourceSnapshotIds: string[];
  createdAt: string;
}

export interface IngestRunPatch {
  finishedAt: string;
  /**
   * `null` records a run that started and finished having deliberately done
   * no work — today only a lease skip. The column is nullable and its CHECK
   * passes on NULL, so this needs no migration, and every reader that asks
   * for a successful outcome (`succeeded` / `partial`) correctly excludes it.
   */
  outcome: 'succeeded' | 'failed' | null;
  itemsSeen: number;
  itemsChanged: number;
  quarantined: { rawNativeId: string | null; reason: string }[];
  error: string | null;
}

/**
 * What a run row can record beyond the domain SourceSystems: the FSIS label
 * and push-delivery jobs produce no source records, but their runs live in
 * the same ledger.
 */
export type IngestRunSource = SourceSystem | 'fsis_labels' | 'push_delivery';

export type JobRunOutcome = 'succeeded' | 'partial' | 'failed';

/** Job-level facts attached to an ingest run by the production job runner. */
export interface JobRunAnnotation {
  jobName: string;
  /** Compact operational facts (counts, hashes) — never logs. */
  metrics: Record<string, unknown>;
  /** Code version (git SHA or 'local') for correlating a bad run with code. */
  version: string;
  /** Overrides the pipeline-recorded outcome (e.g. downgrade to 'partial'). */
  outcome?: JobRunOutcome;
}

export interface JobRunRow {
  id: string;
  jobName: string | null;
  sourceSystem: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: JobRunOutcome | null;
  metrics: Record<string, unknown> | null;
  version: string | null;
  error: string | null;
}

export interface RecallStore {
  createIngestRun(sourceSystem: IngestRunSource, startedAt: string): Promise<string>;
  finishIngestRun(runId: string, patch: IngestRunPatch): Promise<void>;
  /** Attach job-level facts to a run (the production runner's bookkeeping). */
  annotateIngestRun(runId: string, annotation: JobRunAnnotation): Promise<void>;
  /** Newest-first runs of one production job — skip gates and health read these. */
  listRecentJobRuns(jobName: string, limit: number): Promise<JobRunRow[]>;

  /**
   * Job mutual exclusion. Acquire succeeds when the lease is free, expired,
   * or already held by this holder; a crashed holder's lease expires after
   * `ttlSeconds`, so a stuck job can never block ingestion permanently.
   * Manual and scheduled execution go through the same lease.
   */
  acquireJobLease(jobName: string, holder: string, ttlSeconds: number): Promise<boolean>;
  /** Releases only if still held by `holder`; otherwise a no-op. */
  releaseJobLease(jobName: string, holder: string): Promise<void>;

  getSourceRecordByNativeId(
    sourceSystem: SourceSystem,
    nativeId: string,
  ): Promise<SourceRecordRow | null>;
  /**
   * The identity slice alone — for the per-item hash gate and retraction
   * targeting, which need the record id and its case but never the
   * normalized payload. Callers that will read `normalized` (the expansion
   * evidence guard) must use `getSourceRecordByNativeId` instead.
   */
  getSourceRecordLinkByNativeId(
    sourceSystem: SourceSystem,
    nativeId: string,
  ): Promise<SourceRecordLink | null>;
  /**
   * Records of one source published on/after `publishedAfterIso` — the
   * candidate pool a declared-expansion record searches for its parent.
   * Bounded by the caller's window; never a full-table scan in practice.
   */
  listSourceRecordsSince(
    sourceSystem: SourceSystem,
    publishedAfterIso: string,
  ): Promise<SourceRecordRow[]>;
  /**
   * Every record of one source, paginated. Used by maintenance backfills that
   * must visit records normal incremental ingestion deliberately skips; the
   * ingestion path itself never enumerates a whole source.
   */
  listSourceRecords(sourceSystem: SourceSystem): Promise<SourceRecordRow[]>;
  insertSourceRecord(row: Omit<SourceRecordRow, 'id'>): Promise<SourceRecordRow>;
  updateSourceRecord(
    id: string,
    patch: Partial<
      Pick<SourceRecordRow, 'normalized' | 'recallCaseId' | 'linkMethod' | 'lastSeenAt'>
    >,
  ): Promise<void>;
  getSourceRecordsForCase(recallCaseId: string): Promise<SourceRecordRow[]>;

  getLatestSnapshotHash(sourceRecordId: string): Promise<string | null>;
  /**
   * The newest preserved raw payload for a record — the archived source bytes
   * (architecture Part 12). Lets a backfill re-derive a field the parser has
   * since learned to extract without re-fetching the agency page.
   */
  getLatestSnapshotPayload(sourceRecordId: string): Promise<unknown | null>;
  insertSnapshot(snapshot: {
    sourceRecordId: string;
    fetchedAt: string;
    contentHash: string;
    rawPayload: unknown;
    sourceUrl: string;
  }): Promise<string>;

  // ── O3-B1 applied-version contract ─────────────────────────────────────────

  /**
   * The gate slice: identity + applied marker, one narrow read per feed item
   * (the O3 successor to getSourceRecordLinkByNativeId on the ingest path).
   */
  getSourceRecordGateByNativeId(
    sourceSystem: SourceSystem,
    nativeId: string,
  ): Promise<SourceRecordGate | null>;
  /** Newest archived snapshot's identity (id, seq, hash, fetchedAt) — one row. */
  getLatestSnapshotMeta(sourceRecordId: string): Promise<SnapshotMeta | null>;
  /**
   * Atomic archive-and-pending (archive_snapshot RPC): rejects an older
   * fetch before any write, refuses to duplicate the current version unless
   * `allowSameHash` (FDA degraded-detail completion re-archiving a richer
   * payload of unchanged content), and sets the record pending in the same
   * transaction.
   */
  archiveSnapshot(input: {
    sourceRecordId: string;
    fetchedAt: string;
    contentHash: string;
    rawPayload: unknown;
    sourceUrl: string;
    allowSameHash?: boolean;
  }): Promise<ArchiveSnapshotResult>;
  /**
   * Monotonic conditional normalized write (O3-B1): lands only while the
   * record's applied seq is null or ≤ `expectedSnapshotSeq`, so a stale
   * worker can never overwrite normalization derived from a newer snapshot.
   * Returns false on the monotonic miss; the caller skips, never retries
   * with stale data.
   */
  updateSourceRecordNormalized(
    id: string,
    normalized: NormalizedSourceRecord,
    lastSeenAt: string,
    expectedSnapshotSeq: number,
  ): Promise<boolean>;
  /** One atomic consumer transition (apply_case_transition RPC). */
  applyCaseTransition(input: CaseTransitionInput): Promise<CaseTransitionResult>;
  /** Atomic founding (found_recall_case RPC). */
  foundCase(input: FoundCaseInput): Promise<FoundCaseResult>;
  /**
   * Marker-only completion for a retry whose recomputed projection already
   * equals the stored case (everything durable was applied by the
   * interrupted attempt — under this contract, projection-current implies
   * products- and events-current, because they only ever commit together).
   * Sequence-monotonic like the in-transaction marker update.
   */
  markSourceRecordApplied(marker: AppliedMarker): Promise<boolean>;

  getCase(id: string): Promise<RecallCaseRow | null>;
  /**
   * Every RecallCase, paginated. Used by maintenance repairs that must visit
   * cases whatever source records they carry (retailer enrichment covers FDA
   * and FSIS alike); the ingestion path itself never enumerates the table.
   */
  listCases(): Promise<RecallCaseRow[]>;
  insertCase(row: Omit<RecallCaseRow, 'id'>): Promise<RecallCaseRow>;
  updateCase(
    id: string,
    patch: Pick<RecallCaseRow, 'projection' | 'timeline' | 'lastChangedAt'>,
  ): Promise<void>;
  /**
   * Compare-and-set ONE projection field: `retailerNames`.
   *
   * Maintenance repairs run for minutes against a corpus that scheduled
   * ingestion is writing to every 30 minutes, and `updateCase` replaces the
   * whole row from whatever the caller last read — so a repair that read a
   * case before an ingest and wrote it after would silently roll back the
   * projection, the timeline, and `last_changed_at` together.
   *
   * This writes the projection column only, and only while the row still
   * carries `expectedLastChangedAt` — the value every real projection write
   * moves (pipeline.reprojectCase sets it to now). Returns false when a
   * concurrent write moved it; the caller reports that case rather than
   * overwriting the newer data.
   */
  updateCaseRetailerNames(
    id: string,
    retailerNames: string[],
    expectedLastChangedAt: string,
  ): Promise<boolean>;
  /**
   * The same narrow contract for `projection.geography` (C5.2A). A separate
   * method rather than a generic field patch on purpose: these are the only
   * projection fields a maintenance repair is allowed to write, and a
   * caller cannot reach any other one through this port.
   */
  updateCaseGeography(
    id: string,
    geography: Geography,
    expectedLastChangedAt: string,
  ): Promise<boolean>;
  /**
   * The same narrow contract for `projection.productCategories` (C10A).
   *
   * A discovery-only write: timeline and `last_changed_at` stay byte-identical,
   * so it can never fire a notification, re-date a case, or appear as public
   * activity. `detectChanges` does not diff this field under any rule, so a
   * category-only difference is structurally incapable of being material even
   * if it went through the pipeline — and this path does not.
   */
  updateCaseProductCategories(
    id: string,
    productCategories: FoodCategoryId[],
    expectedLastChangedAt: string,
  ): Promise<boolean>;
  /**
   * The same narrow contract for `projection.pathogenOrAllergen` (P2d-B).
   *
   * A correction-only write for the historical allergen repair: timeline and
   * `last_changed_at` stay byte-identical, so it can never fire a
   * notification, re-date a case, or appear as public activity.
   * `detectChanges` has no hazard rule, so a hazard-agent difference is
   * structurally incapable of being material even if it went through the
   * pipeline — and this path does not.
   */
  updateCasePathogenOrAllergen(
    id: string,
    pathogenOrAllergen: string | null,
    expectedLastChangedAt: string,
  ): Promise<boolean>;
  /**
   * Compare-and-swap ONE field inside `normalized`: `pathogenOrAllergen`
   * (P2d-B). Unlike the projection CAS methods, source records carry no
   * version column an ingest reliably moves (`last_seen_at` moves on every
   * unchanged run), so the guard is the corrected field itself: the write
   * lands only while the row still holds `expectedCurrent` — the value the
   * reviewed dry-run observed. A concurrent re-parse (which computes its own,
   * already-corrected value) makes the write match no row; the caller reports
   * a skip instead of overwriting fresher data.
   */
  updateSourceRecordPathogenOrAllergen(
    id: string,
    pathogenOrAllergen: string | null,
    expectedCurrent: string | null,
  ): Promise<boolean>;
  /**
   * Compare-and-swap the case's canonical HAZARD pair — `hazardCategory` and
   * `pathogenOrAllergen` — together (P2e-B).
   *
   * One method rather than two because the pair is one fact: a category
   * corrected without its agent, or the reverse, would leave the projection
   * internally inconsistent for as long as the second write took, and a
   * crash between them would persist that state. Same correction-only
   * contract as the P2d-B port above: timeline and `last_changed_at` stay
   * byte-identical, so it can never fire a notification, re-date a case, or
   * appear as public activity. The generated `hazard_category` column
   * follows the projection JSON automatically and is never written directly.
   */
  updateCaseHazard(
    id: string,
    hazard: { hazardCategory: HazardCategory; pathogenOrAllergen: string | null },
    expectedLastChangedAt: string,
  ): Promise<boolean>;
  /**
   * The same pair inside `normalized`, guarded the way P2d-B guards a source
   * record: on the corrected fields themselves, because source records carry
   * no version column an ingest reliably moves. The write lands only while
   * the row still holds BOTH values the reviewed dry run observed; a
   * concurrent re-parse (which computes its own corrected values) makes it
   * match no row, and the caller reports a skip.
   */
  updateSourceRecordHazard(
    id: string,
    hazard: { hazardCategory: HazardCategory; pathogenOrAllergen: string | null },
    expected: { hazardCategory: string; pathogenOrAllergen: string | null },
  ): Promise<boolean>;
  /**
   * The same narrow contract for `projection.heroImageUrl` (C9). An
   * image-only write: timeline and `last_changed_at` stay byte-identical,
   * so it can never fire a notification, re-date a case, or appear as
   * public activity — and the C8 manifest still detects it, because the
   * sync token hashes projection content at read time.
   *
   * RESERVED INFRASTRUCTURE: under the C9 frozen policy nothing calls
   * this in production — ordinary FSIS label renders are detail evidence,
   * never automatic card heroes. It is the write path C9.1's
   * professional-quality hero sourcing will use, and its semantics are
   * pinned by tests now so that milestone inherits them proven.
   */
  updateCaseHeroImage(
    id: string,
    heroImageUrl: string | null,
    expectedLastChangedAt: string,
  ): Promise<boolean>;
  /**
   * A case's rendered label-document pages, in stable (page, source_url)
   * order. Read-only; rows are written exclusively by the FSIS label
   * sync. Like `updateCaseHeroImage`, this is C9.1's read seam — no
   * production caller exists under the frozen policy.
   */
  listCaseVisuals(recallCaseId: string): Promise<CaseVisualRow[]>;
  replaceProducts(recallCaseId: string, products: AffectedProduct[]): Promise<void>;

  /** Returns false (and stores nothing) when the dedup key already exists. */
  insertNotificationIfAbsent(event: NotificationEventInput): Promise<boolean>;
  /** Delivered-eligible (unsuppressed) material_update events since `sinceIso`, for 24h coalescing. */
  countRecentMaterialUpdates(recallCaseId: string, sinceIso: string): Promise<number>;
}
