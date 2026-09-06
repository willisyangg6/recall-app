/**
 * Postgres-backed RecallStore via Supabase. Server-side only: constructed with
 * the secret (service-role) key, which must never reach the mobile bundle.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { FoodCategoryId } from '../../domain/food-category';
import type {
  AffectedProduct,
  CaseProjection,
  Geography,
  HazardCategory,
  SourceSystem,
  TimelineEntry,
} from '../../domain/recall-types';
import type { NormalizedSourceRecord } from '../../domain/source-record';
import type {
  AppliedMarker,
  ApplyState,
  ArchiveSnapshotResult,
  CaseTransitionInput,
  CaseTransitionResult,
  CaseVisualRow,
  FoundCaseInput,
  FoundCaseResult,
  IngestRunPatch,
  IngestRunSource,
  JobRunAnnotation,
  JobRunRow,
  NotificationEventInput,
  RecallCaseRow,
  RecallStore,
  SnapshotMeta,
  SourceRecordGate,
  SourceRecordLink,
  SourceRecordRow,
} from './types';

const UNIQUE_VIOLATION = '23505';

export function createSupabaseServerClient(url: string, secretKey: string): SupabaseClient {
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class SupabaseStore implements RecallStore {
  constructor(private readonly client: SupabaseClient) {}

  private fail(operation: string, error: { message: string } | null): never {
    throw new Error(`SupabaseStore.${operation} failed: ${error?.message ?? 'unknown error'}`);
  }

  async createIngestRun(sourceSystem: IngestRunSource, startedAt: string): Promise<string> {
    const { data, error } = await this.client
      .from('ingest_runs')
      .insert({ source_system: sourceSystem, started_at: startedAt })
      .select('id')
      .single();
    if (error || !data) this.fail('createIngestRun', error);
    return data.id as string;
  }

  async finishIngestRun(runId: string, patch: IngestRunPatch): Promise<void> {
    const { error } = await this.client
      .from('ingest_runs')
      .update({
        finished_at: patch.finishedAt,
        outcome: patch.outcome,
        items_seen: patch.itemsSeen,
        items_changed: patch.itemsChanged,
        quarantined: patch.quarantined,
        error: patch.error,
      })
      .eq('id', runId);
    if (error) this.fail('finishIngestRun', error);
  }

  async annotateIngestRun(runId: string, annotation: JobRunAnnotation): Promise<void> {
    const update: Record<string, unknown> = {
      job_name: annotation.jobName,
      metrics: annotation.metrics,
      version: annotation.version,
    };
    if (annotation.outcome) update.outcome = annotation.outcome;
    const { error } = await this.client.from('ingest_runs').update(update).eq('id', runId);
    if (error) this.fail('annotateIngestRun', error);
  }

  async listRecentJobRuns(jobName: string, limit: number): Promise<JobRunRow[]> {
    const { data, error } = await this.client
      .from('ingest_runs')
      .select(
        'id, job_name, source_system, started_at, finished_at, outcome, metrics, version, error',
      )
      .eq('job_name', jobName)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error || !data) this.fail('listRecentJobRuns', error);
    return data.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      jobName: (row.job_name as string | null) ?? null,
      sourceSystem: row.source_system as string,
      startedAt: row.started_at as string,
      finishedAt: (row.finished_at as string | null) ?? null,
      outcome: (row.outcome as JobRunRow['outcome']) ?? null,
      metrics: (row.metrics as Record<string, unknown> | null) ?? null,
      version: (row.version as string | null) ?? null,
      error: (row.error as string | null) ?? null,
    }));
  }

  async acquireJobLease(jobName: string, holder: string, ttlSeconds: number): Promise<boolean> {
    const { data, error } = await this.client.rpc('acquire_job_lease', {
      p_job_name: jobName,
      p_holder: holder,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) this.fail('acquireJobLease', error);
    return data === true;
  }

  async releaseJobLease(jobName: string, holder: string): Promise<void> {
    const { error } = await this.client.rpc('release_job_lease', {
      p_job_name: jobName,
      p_holder: holder,
    });
    if (error) this.fail('releaseJobLease', error);
  }

  private toSourceRecordRow(data: Record<string, unknown>): SourceRecordRow {
    return {
      id: data.id as string,
      sourceSystem: data.source_system as SourceSystem,
      nativeId: data.native_id as string,
      recallCaseId: data.recall_case_id as string,
      linkMethod: data.link_method as SourceRecordRow['linkMethod'],
      normalized: data.normalized as NormalizedSourceRecord,
      sourceUrl: data.source_url as string,
      firstSeenAt: data.first_seen_at as string,
      lastSeenAt: data.last_seen_at as string,
      applyState: (data.apply_state as ApplyState | null | undefined) ?? null,
      appliedContentHash: (data.applied_content_hash as string | null | undefined) ?? null,
      appliedSnapshotSeq: (data.applied_snapshot_seq as number | null | undefined) ?? null,
      appliedAt: (data.applied_at as string | null | undefined) ?? null,
    };
  }

  async getSourceRecordByNativeId(
    sourceSystem: SourceSystem,
    nativeId: string,
  ): Promise<SourceRecordRow | null> {
    const { data, error } = await this.client
      .from('source_records')
      .select('*')
      .eq('source_system', sourceSystem)
      .eq('native_id', nativeId)
      .maybeSingle();
    if (error) this.fail('getSourceRecordByNativeId', error);
    return data ? this.toSourceRecordRow(data) : null;
  }

  async getSourceRecordLinkByNativeId(
    sourceSystem: SourceSystem,
    nativeId: string,
  ): Promise<SourceRecordLink | null> {
    // Identity columns only — never `normalized`, whose summaryHtml makes a
    // full row ~100× this response. The ingest hot path calls this once per
    // feed item, so the column list here is what a changed tick's egress
    // scales by (C8).
    const { data, error } = await this.client
      .from('source_records')
      .select('id, recall_case_id')
      .eq('source_system', sourceSystem)
      .eq('native_id', nativeId)
      .maybeSingle();
    if (error) this.fail('getSourceRecordLinkByNativeId', error);
    return data ? { id: data.id as string, recallCaseId: data.recall_case_id as string } : null;
  }

  async listSourceRecordsSince(
    sourceSystem: SourceSystem,
    publishedAfterIso: string,
  ): Promise<SourceRecordRow[]> {
    // publishedAt lives inside the normalized payload; ISO strings compare
    // lexicographically, and the caller passes a date-only lower bound so a
    // date-only publishedAt on the boundary day still qualifies.
    const { data, error } = await this.client
      .from('source_records')
      .select('*')
      .eq('source_system', sourceSystem)
      .gte('normalized->>publishedAt', publishedAfterIso.slice(0, 10));
    if (error || !data) this.fail('listSourceRecordsSince', error);
    return data.map((row) => this.toSourceRecordRow(row));
  }

  async listSourceRecords(sourceSystem: SourceSystem): Promise<SourceRecordRow[]> {
    // Paginated: PostgREST caps an unbounded select, and a maintenance
    // backfill must see every record, not the first page of them. 500, not
    // 1000: a 1000-row page of `source_records` (normalized JSON, FDA rows
    // carrying summaryHtml) timed out mid-transfer against production on
    // 2026-09-02, the same class of stall `listCases` was already halved to
    // 500 for. Ordering, filtering, and completeness are unchanged — only
    // the page boundary moves, so a maintenance repair still sees every row.
    const pageSize = 500;
    const rows: SourceRecordRow[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.client
        .from('source_records')
        .select('*')
        .eq('source_system', sourceSystem)
        .order('id')
        .range(from, from + pageSize - 1);
      if (error || !data) this.fail('listSourceRecords', error);
      rows.push(...data.map((row) => this.toSourceRecordRow(row)));
      if (data.length < pageSize) return rows;
    }
  }

  async insertSourceRecord(row: Omit<SourceRecordRow, 'id'>): Promise<SourceRecordRow> {
    const insert: Record<string, unknown> = {
      source_system: row.sourceSystem,
      native_id: row.nativeId,
      recall_case_id: row.recallCaseId,
      link_method: row.linkMethod,
      normalized: row.normalized,
      source_url: row.sourceUrl,
      first_seen_at: row.firstSeenAt,
      last_seen_at: row.lastSeenAt,
    };
    // O3: ingest inserts declare 'pending' explicitly; omitting the field
    // (legacy-era callers, tests predating O3) leaves the column NULL.
    if (row.applyState !== undefined) insert.apply_state = row.applyState;
    const { data, error } = await this.client
      .from('source_records')
      .insert(insert)
      .select('*')
      .single();
    if (error || !data) this.fail('insertSourceRecord', error);
    return this.toSourceRecordRow(data);
  }

  async updateSourceRecord(
    id: string,
    patch: Partial<
      Pick<SourceRecordRow, 'normalized' | 'recallCaseId' | 'linkMethod' | 'lastSeenAt'>
    >,
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.normalized !== undefined) update.normalized = patch.normalized;
    if (patch.recallCaseId !== undefined) update.recall_case_id = patch.recallCaseId;
    if (patch.linkMethod !== undefined) update.link_method = patch.linkMethod;
    if (patch.lastSeenAt !== undefined) update.last_seen_at = patch.lastSeenAt;
    const { error } = await this.client.from('source_records').update(update).eq('id', id);
    if (error) this.fail('updateSourceRecord', error);
  }

  async getSourceRecordsForCase(recallCaseId: string): Promise<SourceRecordRow[]> {
    const { data, error } = await this.client
      .from('source_records')
      .select('*')
      .eq('recall_case_id', recallCaseId);
    if (error || !data) this.fail('getSourceRecordsForCase', error);
    return data.map((row: Record<string, unknown>) => this.toSourceRecordRow(row));
  }

  async getLatestSnapshotHash(sourceRecordId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('source_snapshots')
      .select('content_hash')
      .eq('source_record_id', sourceRecordId)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) this.fail('getLatestSnapshotHash', error);
    return (data?.content_hash as string | undefined) ?? null;
  }

  async getLatestSnapshotPayload(sourceRecordId: string): Promise<unknown | null> {
    const { data, error } = await this.client
      .from('source_snapshots')
      .select('raw_payload')
      .eq('source_record_id', sourceRecordId)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) this.fail('getLatestSnapshotPayload', error);
    return data?.raw_payload ?? null;
  }

  async insertSnapshot(snapshot: {
    sourceRecordId: string;
    fetchedAt: string;
    contentHash: string;
    rawPayload: unknown;
    sourceUrl: string;
  }): Promise<string> {
    const { data, error } = await this.client
      .from('source_snapshots')
      .insert({
        source_record_id: snapshot.sourceRecordId,
        fetched_at: snapshot.fetchedAt,
        content_hash: snapshot.contentHash,
        raw_payload: snapshot.rawPayload,
        source_url: snapshot.sourceUrl,
      })
      .select('id')
      .single();
    if (error || !data) this.fail('insertSnapshot', error);
    return data.id as string;
  }

  // ── O3-B1 applied-version contract ─────────────────────────────────────────

  async getSourceRecordGateByNativeId(
    sourceSystem: SourceSystem,
    nativeId: string,
  ): Promise<SourceRecordGate | null> {
    // The C8 identity slice plus the applied marker — still never
    // `normalized`. This is the one read every feed item pays on a changed
    // run, so the column list stays the egress budget.
    const { data, error } = await this.client
      .from('source_records')
      .select('id, recall_case_id, apply_state, applied_content_hash, applied_snapshot_seq')
      .eq('source_system', sourceSystem)
      .eq('native_id', nativeId)
      .maybeSingle();
    if (error) this.fail('getSourceRecordGateByNativeId', error);
    if (!data) return null;
    return {
      id: data.id as string,
      recallCaseId: data.recall_case_id as string,
      applyState: (data.apply_state as ApplyState | null) ?? null,
      appliedContentHash: (data.applied_content_hash as string | null) ?? null,
      appliedSnapshotSeq: (data.applied_snapshot_seq as number | null) ?? null,
    };
  }

  async getLatestSnapshotMeta(sourceRecordId: string): Promise<SnapshotMeta | null> {
    const { data, error } = await this.client
      .from('source_snapshots')
      .select('id, seq, content_hash, fetched_at')
      .eq('source_record_id', sourceRecordId)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) this.fail('getLatestSnapshotMeta', error);
    if (!data) return null;
    return {
      id: data.id as string,
      seq: Number(data.seq),
      contentHash: data.content_hash as string,
      fetchedAt: data.fetched_at as string,
    };
  }

  async archiveSnapshot(input: {
    sourceRecordId: string;
    fetchedAt: string;
    contentHash: string;
    rawPayload: unknown;
    sourceUrl: string;
    allowSameHash?: boolean;
  }): Promise<ArchiveSnapshotResult> {
    const { data, error } = await this.client.rpc('archive_snapshot', {
      p_source_record_id: input.sourceRecordId,
      p_fetched_at: input.fetchedAt,
      p_content_hash: input.contentHash,
      p_raw_payload: input.rawPayload,
      p_source_url: input.sourceUrl,
      p_allow_same_hash: input.allowSameHash ?? false,
    });
    if (error) this.fail('archiveSnapshot', error);
    const result = data as Record<string, unknown> | null;
    const status = result?.status;
    if (status === 'stale') return { status: 'stale' };
    if (status === 'archived' || status === 'duplicate') {
      return {
        status,
        snapshotId: result!.snapshot_id as string,
        snapshotSeq: Number(result!.snapshot_seq),
      };
    }
    // 'missing_record' or an unrecognized payload: the record vanished under
    // us or the function drifted — both are hard faults, never silent skips.
    this.fail('archiveSnapshot', { message: `unexpected result ${JSON.stringify(result)}` });
  }

  async updateSourceRecordNormalized(
    id: string,
    normalized: NormalizedSourceRecord,
    lastSeenAt: string,
    expectedSnapshotSeq: number,
  ): Promise<boolean> {
    // Monotonic predicate: the write lands only while the applied seq has
    // not moved past the snapshot this normalization was derived from — a
    // stale worker matches no row and reports false instead of regressing.
    const { data, error } = await this.client
      .from('source_records')
      .update({ normalized, last_seen_at: lastSeenAt })
      .eq('id', id)
      .or(`applied_snapshot_seq.is.null,applied_snapshot_seq.lte.${expectedSnapshotSeq}`)
      .select('id');
    if (error) this.fail('updateSourceRecordNormalized', error);
    return (data?.length ?? 0) > 0;
  }

  async applyCaseTransition(input: CaseTransitionInput): Promise<CaseTransitionResult> {
    const { data, error } = await this.client.rpc('apply_case_transition', {
      p_case_id: input.recallCaseId,
      p_expected_last_changed_at: input.expectedLastChangedAt,
      p_projection: input.projection,
      p_timeline: input.timeline,
      p_last_changed_at: input.lastChangedAt,
      p_products: input.products.map((product) => ({
        sourceNativeId: product.sourceNativeId,
        name: product.name,
        rawText: product.rawText,
        extractionConfidence: product.extractionConfidence,
      })),
      p_events: input.events.map((event) => ({
        kind: event.kind,
        triggerRuleId: event.triggerRuleId,
        dedupKey: event.dedupKey,
        materialChangeRef: event.materialChangeRef,
        payloadSummary: event.payloadSummary,
        suppressed: event.suppressed,
        sourceSnapshotIds: event.sourceSnapshotIds,
        createdAt: event.createdAt,
      })),
      p_markers: input.markers.map((marker) => ({
        sourceRecordId: marker.sourceRecordId,
        contentHash: marker.contentHash,
        snapshotSeq: marker.snapshotSeq,
        state: marker.state,
        appliedAt: marker.appliedAt,
      })),
    });
    if (error) this.fail('applyCaseTransition', error);
    const result = data as Record<string, unknown> | null;
    if (result?.status === 'conflict') return { status: 'conflict' };
    if (result?.status === 'applied') {
      return {
        status: 'applied',
        insertedDedupKeys: (result.inserted_dedup_keys as string[] | null) ?? [],
      };
    }
    this.fail('applyCaseTransition', { message: `unexpected result ${JSON.stringify(result)}` });
  }

  async foundCase(input: FoundCaseInput): Promise<FoundCaseResult> {
    const { data, error } = await this.client.rpc('found_recall_case', {
      p_case: {
        projection: input.caseRow.projection,
        timeline: input.caseRow.timeline,
        createdAt: input.caseRow.createdAt,
        lastChangedAt: input.caseRow.lastChangedAt,
      },
      p_record: {
        sourceSystem: input.record.sourceSystem,
        nativeId: input.record.nativeId,
        linkMethod: input.record.linkMethod,
        normalized: input.record.normalized,
        sourceUrl: input.record.sourceUrl,
        firstSeenAt: input.record.firstSeenAt,
        lastSeenAt: input.record.lastSeenAt,
        applyState: input.record.applyState,
        appliedContentHash: input.record.appliedContentHash,
        appliedAt: input.record.appliedAt,
      },
      p_snapshot: {
        id: input.snapshot.id,
        fetchedAt: input.snapshot.fetchedAt,
        contentHash: input.snapshot.contentHash,
        rawPayload: input.snapshot.rawPayload,
        sourceUrl: input.snapshot.sourceUrl,
      },
      p_products: input.products.map((product) => ({
        sourceNativeId: product.sourceNativeId,
        name: product.name,
        rawText: product.rawText,
        extractionConfidence: product.extractionConfidence,
      })),
      p_initial_event: input.initialEvent
        ? {
            triggerRuleId: input.initialEvent.triggerRuleId,
            payloadSummary: input.initialEvent.payloadSummary,
            suppressed: input.initialEvent.suppressed,
            createdAt: input.initialEvent.createdAt,
          }
        : null,
    });
    if (error) this.fail('foundCase', error);
    const result = data as Record<string, unknown> | null;
    if (result?.status === 'record_exists') return { status: 'record_exists' };
    if (result?.status === 'founded') {
      return {
        status: 'founded',
        caseId: result.case_id as string,
        recordId: result.record_id as string,
        snapshotSeq: Number(result.snapshot_seq),
        initialInserted: result.initial_inserted === true,
      };
    }
    this.fail('foundCase', { message: `unexpected result ${JSON.stringify(result)}` });
  }

  async markSourceRecordApplied(marker: AppliedMarker): Promise<boolean> {
    const { data, error } = await this.client
      .from('source_records')
      .update({
        apply_state: marker.state,
        applied_content_hash: marker.contentHash,
        applied_snapshot_seq: marker.snapshotSeq,
        applied_at: marker.appliedAt,
      })
      .eq('id', marker.sourceRecordId)
      .or(`applied_snapshot_seq.is.null,applied_snapshot_seq.lte.${marker.snapshotSeq}`)
      .select('id');
    if (error) this.fail('markSourceRecordApplied', error);
    return (data?.length ?? 0) > 0;
  }

  private toCaseRow(data: Record<string, unknown>): RecallCaseRow {
    return {
      id: data.id as string,
      projection: data.projection as CaseProjection,
      timeline: data.timeline as TimelineEntry[],
      createdAt: data.created_at as string,
      lastChangedAt: data.last_changed_at as string,
    };
  }

  async getCase(id: string): Promise<RecallCaseRow | null> {
    const { data, error } = await this.client
      .from('recall_cases')
      .select('id, projection, timeline, created_at, last_changed_at')
      .eq('id', id)
      .maybeSingle();
    if (error) this.fail('getCase', error);
    return data ? this.toCaseRow(data) : null;
  }

  async listCases(): Promise<RecallCaseRow[]> {
    // Paginated for the same reason listSourceRecords is: PostgREST caps an
    // unbounded select, and a maintenance repair must see every case. The
    // page is half the size used for source records because a case row
    // carries its whole projection, announcement HTML included — a
    // 1000-row page was large enough for the transfer to stall and drop.
    const pageSize = 500;
    const rows: RecallCaseRow[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.client
        .from('recall_cases')
        .select('id, projection, timeline, created_at, last_changed_at')
        .order('id')
        .range(from, from + pageSize - 1);
      if (error || !data) this.fail('listCases', error);
      rows.push(...data.map((row) => this.toCaseRow(row)));
      if (data.length < pageSize) return rows;
    }
  }

  async insertCase(row: Omit<RecallCaseRow, 'id'>): Promise<RecallCaseRow> {
    const { data, error } = await this.client
      .from('recall_cases')
      .insert({
        projection: row.projection,
        timeline: row.timeline,
        created_at: row.createdAt,
        last_changed_at: row.lastChangedAt,
      })
      .select('id, projection, timeline, created_at, last_changed_at')
      .single();
    if (error || !data) this.fail('insertCase', error);
    return this.toCaseRow(data);
  }

  async updateCase(
    id: string,
    patch: Pick<RecallCaseRow, 'projection' | 'timeline' | 'lastChangedAt'>,
  ): Promise<void> {
    const { error } = await this.client
      .from('recall_cases')
      .update({
        projection: patch.projection,
        timeline: patch.timeline,
        last_changed_at: patch.lastChangedAt,
      })
      .eq('id', id);
    if (error) this.fail('updateCase', error);
  }

  async updateCaseRetailerNames(
    id: string,
    retailerNames: string[],
    expectedLastChangedAt: string,
  ): Promise<boolean> {
    // Re-read immediately before the write, so the merge happens against the
    // freshest projection rather than one the caller may have loaded minutes
    // ago. This is what keeps a concurrently-written field (an image
    // backfill's heroImageUrl) from being rolled back by our own merge.
    const current = await this.getCase(id);
    if (!current || current.lastChangedAt !== expectedLastChangedAt) return false;
    // The `last_changed_at` predicate makes the write itself conditional, so
    // an ingest landing between that read and this update loses nothing: the
    // update matches no row and we report a conflict instead.
    const { data, error } = await this.client
      .from('recall_cases')
      .update({ projection: { ...current.projection, retailerNames } })
      .eq('id', id)
      .eq('last_changed_at', expectedLastChangedAt)
      .select('id');
    if (error) this.fail('updateCaseRetailerNames', error);
    return (data?.length ?? 0) > 0;
  }

  async updateCaseGeography(
    id: string,
    geography: Geography,
    expectedLastChangedAt: string,
  ): Promise<boolean> {
    // Identical contract to updateCaseRetailerNames above: re-read so the
    // merge happens against the freshest projection, then make the write
    // itself conditional on `last_changed_at`, so an ingest landing in
    // between loses nothing — the update matches no row and we report a
    // conflict rather than rolling its work back.
    const current = await this.getCase(id);
    if (!current || current.lastChangedAt !== expectedLastChangedAt) return false;
    const { data, error } = await this.client
      .from('recall_cases')
      .update({ projection: { ...current.projection, geography } })
      .eq('id', id)
      .eq('last_changed_at', expectedLastChangedAt)
      .select('id');
    if (error) this.fail('updateCaseGeography', error);
    return (data?.length ?? 0) > 0;
  }

  async updateCaseProductCategories(
    id: string,
    productCategories: FoodCategoryId[],
    expectedLastChangedAt: string,
  ): Promise<boolean> {
    // Identical contract to updateCaseRetailerNames: re-read so the merge
    // happens against the freshest projection, then make the write itself
    // conditional on `last_changed_at`, so an ingest landing in between loses
    // nothing — the update matches no row and the caller reports a conflict
    // rather than rolling newer data back. `timeline` and `last_changed_at`
    // are not in the payload at all.
    const current = await this.getCase(id);
    if (!current || current.lastChangedAt !== expectedLastChangedAt) return false;
    const { data, error } = await this.client
      .from('recall_cases')
      .update({ projection: { ...current.projection, productCategories } })
      .eq('id', id)
      .eq('last_changed_at', expectedLastChangedAt)
      .select('id');
    if (error) this.fail('updateCaseProductCategories', error);
    return (data?.length ?? 0) > 0;
  }

  async updateCasePathogenOrAllergen(
    id: string,
    pathogenOrAllergen: string | null,
    expectedLastChangedAt: string,
  ): Promise<boolean> {
    // Identical contract to updateCaseRetailerNames: re-read so the merge
    // happens against the freshest projection, then make the write itself
    // conditional on `last_changed_at`, so an ingest landing in between loses
    // nothing — the update matches no row and the caller reports a conflict
    // rather than rolling newer data back. `timeline` and `last_changed_at`
    // are not in the payload at all.
    const current = await this.getCase(id);
    if (!current || current.lastChangedAt !== expectedLastChangedAt) return false;
    const { data, error } = await this.client
      .from('recall_cases')
      .update({ projection: { ...current.projection, pathogenOrAllergen } })
      .eq('id', id)
      .eq('last_changed_at', expectedLastChangedAt)
      .select('id');
    if (error) this.fail('updateCasePathogenOrAllergen', error);
    return (data?.length ?? 0) > 0;
  }

  async updateCaseHazard(
    id: string,
    hazard: { hazardCategory: HazardCategory; pathogenOrAllergen: string | null },
    expectedLastChangedAt: string,
  ): Promise<boolean> {
    // Identical contract to updateCasePathogenOrAllergen, writing the hazard
    // PAIR in one statement so the projection is never briefly inconsistent.
    // `timeline` and `last_changed_at` are not in the payload at all, and the
    // generated `hazard_category` column follows the projection by itself.
    const current = await this.getCase(id);
    if (!current || current.lastChangedAt !== expectedLastChangedAt) return false;
    const { data, error } = await this.client
      .from('recall_cases')
      .update({ projection: { ...current.projection, ...hazard } })
      .eq('id', id)
      .eq('last_changed_at', expectedLastChangedAt)
      .select('id');
    if (error) this.fail('updateCaseHazard', error);
    return (data?.length ?? 0) > 0;
  }

  async updateSourceRecordHazard(
    id: string,
    hazard: { hazardCategory: HazardCategory; pathogenOrAllergen: string | null },
    expected: { hazardCategory: string; pathogenOrAllergen: string | null },
  ): Promise<boolean> {
    // As updateSourceRecordPathogenOrAllergen, but guarded on BOTH observed
    // values: a concurrent re-parse that corrected either one makes the
    // predicate match no row, and the caller reports a skip rather than
    // overwriting fresher data.
    const { data: fresh, error: readError } = await this.client
      .from('source_records')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (readError) this.fail('updateSourceRecordHazard', readError);
    if (!fresh) return false;
    const row = this.toSourceRecordRow(fresh);
    if (row.normalized.hazardCategory !== expected.hazardCategory) return false;
    if ((row.normalized.pathogenOrAllergen ?? null) !== expected.pathogenOrAllergen) return false;
    let query = this.client
      .from('source_records')
      .update({ normalized: { ...row.normalized, ...hazard } })
      .eq('id', id)
      .eq('normalized->>hazardCategory', expected.hazardCategory);
    query =
      expected.pathogenOrAllergen === null
        ? query.is('normalized->>pathogenOrAllergen', null)
        : query.eq('normalized->>pathogenOrAllergen', expected.pathogenOrAllergen);
    const { data, error } = await query.select('id');
    if (error) this.fail('updateSourceRecordHazard', error);
    return (data?.length ?? 0) > 0;
  }

  async updateSourceRecordPathogenOrAllergen(
    id: string,
    pathogenOrAllergen: string | null,
    expectedCurrent: string | null,
  ): Promise<boolean> {
    // Re-read so the one-field merge happens against the freshest normalized
    // payload, then guard the write on the field itself (source records have
    // no version column a real re-parse reliably moves — `last_seen_at` moves
    // on every unchanged tick). A concurrent ingest re-parse writes its own,
    // already-corrected value, so the predicate matches no row and the caller
    // reports a skip instead of overwriting fresher data.
    const { data: fresh, error: readError } = await this.client
      .from('source_records')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (readError) this.fail('updateSourceRecordPathogenOrAllergen', readError);
    if (!fresh) return false;
    const row = this.toSourceRecordRow(fresh);
    if ((row.normalized.pathogenOrAllergen ?? null) !== expectedCurrent) return false;
    let query = this.client
      .from('source_records')
      .update({ normalized: { ...row.normalized, pathogenOrAllergen } })
      .eq('id', id);
    query =
      expectedCurrent === null
        ? query.is('normalized->>pathogenOrAllergen', null)
        : query.eq('normalized->>pathogenOrAllergen', expectedCurrent);
    const { data, error } = await query.select('id');
    if (error) this.fail('updateSourceRecordPathogenOrAllergen', error);
    return (data?.length ?? 0) > 0;
  }

  async updateCaseHeroImage(
    id: string,
    heroImageUrl: string | null,
    expectedLastChangedAt: string,
  ): Promise<boolean> {
    // Identical contract to updateCaseRetailerNames: re-read so the merge
    // happens against the freshest projection, then make the write itself
    // conditional on `last_changed_at`, so an ingest landing in between
    // loses nothing — the update matches no row and the caller reports a
    // conflict rather than rolling newer data back.
    const current = await this.getCase(id);
    if (!current || current.lastChangedAt !== expectedLastChangedAt) return false;
    const { data, error } = await this.client
      .from('recall_cases')
      .update({ projection: { ...current.projection, heroImageUrl } })
      .eq('id', id)
      .eq('last_changed_at', expectedLastChangedAt)
      .select('id');
    if (error) this.fail('updateCaseHeroImage', error);
    return (data?.length ?? 0) > 0;
  }

  async listCaseVisuals(recallCaseId: string): Promise<CaseVisualRow[]> {
    const { data, error } = await this.client
      .from('product_visuals')
      .select(
        'recall_case_id, source_url, source_sha256, page, url, role, width, height, content_hash',
      )
      .eq('recall_case_id', recallCaseId)
      .order('page')
      .order('source_url');
    if (error) {
      // Pre-migration tolerance, mirroring SupabaseLabelStore.listFailures:
      // a deployment without the visuals table simply has no candidates.
      if (/product_visuals/.test(error.message)) return [];
      this.fail('listCaseVisuals', error);
    }
    return (data ?? []).map((row) => ({
      recallCaseId: row.recall_case_id as string,
      sourceUrl: row.source_url as string,
      sourceSha256: row.source_sha256 as string,
      page: row.page as number,
      url: row.url as string,
      role: row.role as string,
      width: (row.width as number | null) ?? null,
      height: (row.height as number | null) ?? null,
      contentHash: row.content_hash as string,
    }));
  }

  async replaceProducts(recallCaseId: string, products: AffectedProduct[]): Promise<void> {
    const { error: deleteError } = await this.client
      .from('affected_products')
      .delete()
      .eq('recall_case_id', recallCaseId);
    if (deleteError) this.fail('replaceProducts(delete)', deleteError);
    if (products.length === 0) return;
    const { error } = await this.client.from('affected_products').insert(
      products.map((product, ordinal) => ({
        recall_case_id: recallCaseId,
        ordinal,
        source_native_id: product.sourceNativeId,
        name: product.name,
        raw_text: product.rawText,
        extraction_confidence: product.extractionConfidence,
      })),
    );
    if (error) this.fail('replaceProducts(insert)', error);
  }

  async insertNotificationIfAbsent(event: NotificationEventInput): Promise<boolean> {
    const { error } = await this.client.from('notification_events').insert({
      recall_case_id: event.recallCaseId,
      kind: event.kind,
      trigger_rule_id: event.triggerRuleId,
      dedup_key: event.dedupKey,
      material_change_ref: event.materialChangeRef,
      payload_summary: event.payloadSummary,
      suppressed: event.suppressed,
      source_snapshot_ids: event.sourceSnapshotIds,
      created_at: event.createdAt,
    });
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return false;
      this.fail('insertNotificationIfAbsent', error);
    }
    return true;
  }

  async countRecentMaterialUpdates(recallCaseId: string, sinceIso: string): Promise<number> {
    const { count, error } = await this.client
      .from('notification_events')
      .select('id', { count: 'exact', head: true })
      .eq('recall_case_id', recallCaseId)
      .eq('kind', 'material_update')
      .is('suppressed', null)
      .gte('created_at', sinceIso);
    if (error) this.fail('countRecentMaterialUpdates', error);
    return count ?? 0;
  }
}
