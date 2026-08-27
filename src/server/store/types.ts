/**
 * Storage port for the ingestion pipeline. Two implementations:
 * - MemoryStore: deterministic tests, and --dry-run ingestion
 * - SupabaseStore: the durable Postgres-backed store
 *
 * The pipeline only ever talks to this interface; idempotency guarantees
 * (snapshot hash-gating, native-id upserts, notification dedup keys) are
 * enforced through it.
 */

import type {
  AffectedProduct,
  CaseProjection,
  NotificationKind,
  NotificationSuppression,
  SourceSystem,
  TimelineEntry,
} from '../../domain/recall-types';
import type { NormalizedSourceRecord } from '../../domain/source-record';

export type LinkMethod = 'self' | 'expansion_prefix' | 'retraction_reference' | 'enforcement_match';

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
}

export interface RecallCaseRow {
  id: string;
  projection: CaseProjection;
  timeline: TimelineEntry[];
  createdAt: string;
  lastChangedAt: string;
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
  replaceProducts(recallCaseId: string, products: AffectedProduct[]): Promise<void>;

  /** Returns false (and stores nothing) when the dedup key already exists. */
  insertNotificationIfAbsent(event: NotificationEventInput): Promise<boolean>;
  /** Delivered-eligible (unsuppressed) material_update events since `sinceIso`, for 24h coalescing. */
  countRecentMaterialUpdates(recallCaseId: string, sinceIso: string): Promise<number>;
}
