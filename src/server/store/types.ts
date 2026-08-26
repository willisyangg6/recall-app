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
  outcome: 'succeeded' | 'failed';
  itemsSeen: number;
  itemsChanged: number;
  quarantined: { rawNativeId: string | null; reason: string }[];
  error: string | null;
}

export interface RecallStore {
  createIngestRun(sourceSystem: SourceSystem, startedAt: string): Promise<string>;
  finishIngestRun(runId: string, patch: IngestRunPatch): Promise<void>;

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
  insertCase(row: Omit<RecallCaseRow, 'id'>): Promise<RecallCaseRow>;
  updateCase(
    id: string,
    patch: Pick<RecallCaseRow, 'projection' | 'timeline' | 'lastChangedAt'>,
  ): Promise<void>;
  replaceProducts(recallCaseId: string, products: AffectedProduct[]): Promise<void>;

  /** Returns false (and stores nothing) when the dedup key already exists. */
  insertNotificationIfAbsent(event: NotificationEventInput): Promise<boolean>;
  /** Delivered-eligible (unsuppressed) material_update events since `sinceIso`, for 24h coalescing. */
  countRecentMaterialUpdates(recallCaseId: string, sinceIso: string): Promise<number>;
}
