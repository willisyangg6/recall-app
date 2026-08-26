/**
 * Postgres-backed RecallStore via Supabase. Server-side only: constructed with
 * the secret (service-role) key, which must never reach the mobile bundle.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type {
  AffectedProduct,
  CaseProjection,
  SourceSystem,
  TimelineEntry,
} from '../../domain/recall-types';
import type { NormalizedSourceRecord } from '../../domain/source-record';
import type {
  IngestRunPatch,
  IngestRunSource,
  JobRunAnnotation,
  JobRunRow,
  NotificationEventInput,
  RecallCaseRow,
  RecallStore,
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
    // backfill must see every record, not the first page of them.
    const pageSize = 1000;
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
    const { data, error } = await this.client
      .from('source_records')
      .insert({
        source_system: row.sourceSystem,
        native_id: row.nativeId,
        recall_case_id: row.recallCaseId,
        link_method: row.linkMethod,
        normalized: row.normalized,
        source_url: row.sourceUrl,
        first_seen_at: row.firstSeenAt,
        last_seen_at: row.lastSeenAt,
      })
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
