/**
 * Supabase-backed AttachmentSyncStore. Server-side only (service-role client).
 *
 * Candidate discovery is a database read, never agency traffic. Failure
 * state shares `product_visual_failures` (one row per source URL) with the
 * label sync, so ops:health sees one backlog of unreadable FSIS documents.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CaseProjection, Geography } from '../../domain/recall-types';
import type { AttachmentEnrichment, NormalizedSourceRecord } from '../../domain/source-record';
import { canonicalJson } from '../pipeline';
import { SupabaseStore } from '../store/supabase-store';
import { enrichedProjection, enrichNormalized } from './attachment-projection';
import type {
  AttachmentCandidate,
  AttachmentSyncStore,
  EnrichmentWriteResult,
  LabelVisualPage,
  StoredAttachment,
} from './attachment-sync';
import { SupabaseLabelStore } from './label-store';
import type { LabelFailureState } from './label-sync';

export class SupabaseAttachmentStore implements AttachmentSyncStore {
  private readonly labels: SupabaseLabelStore;
  private readonly recall: SupabaseStore;

  constructor(private readonly client: SupabaseClient) {
    this.labels = new SupabaseLabelStore(client);
    this.recall = new SupabaseStore(client);
  }

  private fail(operation: string, error: { message: string } | null): never {
    throw new Error(
      `SupabaseAttachmentStore.${operation} failed: ${error?.message ?? 'unknown error'}`,
    );
  }

  async listCandidates(filter: {
    publishedSince: string | null;
    nativeIds?: string[];
  }): Promise<AttachmentCandidate[]> {
    const out: AttachmentCandidate[] = [];
    const pageSize = 200;
    for (let from = 0; ; from += pageSize) {
      let query = this.client
        .from('source_records')
        .select(
          'id, native_id, recall_case_id, publishedAt:normalized->>publishedAt, ' +
            'summaryHtml:normalized->>summaryHtml, productLines:normalized->productLines, ' +
            'geography:normalized->geography, enrichment:normalized->attachmentEnrichment',
        )
        .eq('source_system', 'fsis_api')
        .like('normalized->>summaryHtml', '%.pdf%')
        .order('id')
        .range(from, from + pageSize - 1);
      if (filter.publishedSince)
        query = query.gte('normalized->>publishedAt', filter.publishedSince);
      if (filter.nativeIds) query = query.in('native_id', filter.nativeIds);
      const { data, error } = await query;
      if (error) this.fail('listCandidates', error);
      for (const raw of data ?? []) {
        const row = raw as unknown as {
          id: string;
          native_id: string;
          recall_case_id: string;
          publishedAt: string | null;
          summaryHtml: string | null;
          productLines: string[] | null;
          geography: Geography;
          enrichment: AttachmentEnrichment | null;
        };
        out.push({
          sourceRecordId: row.id,
          recallCaseId: row.recall_case_id,
          nativeId: row.native_id,
          publishedAt: row.publishedAt ?? '',
          summaryHtml: row.summaryHtml,
          productLines: row.productLines ?? [],
          geography: row.geography,
          enrichment: row.enrichment ?? null,
        });
      }
      if (!data || data.length < pageSize) break;
    }
    return out;
  }

  async listAttachments(sourceRecordIds: string[]): Promise<StoredAttachment[]> {
    const out: StoredAttachment[] = [];
    for (let i = 0; i < sourceRecordIds.length; i += 100) {
      const { data, error } = await this.client
        .from('fsis_attachments')
        .select(
          'source_record_id, url, kind, link_text, sha256, previous_sha256, status, review_reasons, extraction, fetched_at, revised_at',
        )
        .in('source_record_id', sourceRecordIds.slice(i, i + 100));
      if (error) {
        // Pre-migration tolerance (reads only), as in listFailures: before
        // 20261116000000 lands there are no stored attachments. Writes stay
        // loud — upsertAttachment fails the run if the table is missing.
        if (/fsis_attachments/.test(error.message)) return [];
        this.fail('listAttachments', error);
      }
      for (const row of data ?? []) {
        out.push({
          sourceRecordId: row.source_record_id as string,
          url: row.url as string,
          kind: row.kind as StoredAttachment['kind'],
          linkText: row.link_text as string,
          sha256: (row.sha256 as string | null) ?? null,
          previousSha256: (row.previous_sha256 as string | null) ?? null,
          status: row.status as StoredAttachment['status'],
          reviewReasons: (row.review_reasons as string[] | null) ?? [],
          extraction: (row.extraction as StoredAttachment['extraction']) ?? null,
          fetchedAt: row.fetched_at as string,
          revisedAt: (row.revised_at as string | null) ?? null,
        });
      }
    }
    return out;
  }

  async upsertAttachment(row: StoredAttachment): Promise<void> {
    const { error } = await this.client.from('fsis_attachments').upsert(
      {
        source_record_id: row.sourceRecordId,
        url: row.url,
        kind: row.kind,
        link_text: row.linkText,
        sha256: row.sha256,
        previous_sha256: row.previousSha256,
        status: row.status,
        review_reasons: row.reviewReasons,
        extraction: row.extraction,
        fetched_at: row.fetchedAt,
        revised_at: row.revisedAt,
      },
      { onConflict: 'source_record_id,url' },
    );
    if (error) this.fail('upsertAttachment', error);
  }

  async labelVisuals(
    urls: string[],
  ): Promise<Map<string, { sha256: string; pages: LabelVisualPage[] }>> {
    const out = new Map<string, { sha256: string; pages: LabelVisualPage[] }>();
    const read = (columns: string) =>
      this.client.from('product_visuals').select(columns).in('source_url', urls).order('page');
    let { data, error } = await read('source_url, source_sha256, page, url, caption');
    if (error && /caption/.test(error.message)) {
      // Pre-migration tolerance (reads only): no caption column yet means
      // no page has a caption.
      ({ data, error } = await read('source_url, source_sha256, page, url'));
    }
    if (error) this.fail('labelVisuals', error);
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const url = row.source_url as string;
      // Stale revisions are deleted by the label sync; one sha per URL.
      const entry = out.get(url) ?? { sha256: row.source_sha256 as string, pages: [] };
      entry.pages.push({
        page: row.page as number,
        url: row.url as string,
        caption: (row.caption as string | null) ?? null,
      });
      out.set(url, entry);
    }
    return out;
  }

  async setVisualCaptions(
    url: string,
    pdfSha: string,
    captions: { page: number; caption: string | null }[],
  ): Promise<number> {
    let written = 0;
    for (const { page, caption } of captions) {
      if (caption === null) continue;
      const { data, error } = await this.client
        .from('product_visuals')
        .update({ caption })
        .eq('source_url', url)
        .eq('source_sha256', pdfSha)
        .eq('page', page)
        .is('caption', null)
        .select('id');
      if (error) this.fail('setVisualCaptions', error);
      written += data?.length ?? 0;
    }
    return written;
  }

  listFailures(): Promise<LabelFailureState[]> {
    return this.labels.listFailures();
  }

  recordFailure(state: LabelFailureState): Promise<void> {
    return this.labels.recordFailure(state);
  }

  clearFailure(sourceUrl: string): Promise<void> {
    return this.labels.clearFailure(sourceUrl);
  }

  async applyEnrichment(
    candidate: AttachmentCandidate,
    enrichment: AttachmentEnrichment,
  ): Promise<EnrichmentWriteResult> {
    const records = await this.recall.getSourceRecordsForCase(candidate.recallCaseId);
    const record = records.find((r) => r.id === candidate.sourceRecordId);
    if (!record) return 'conflict';
    // The enrichment was built from this summary; a newer agency version
    // must be re-read first.
    if (record.normalized.summaryHtml !== candidate.summaryHtml) return 'conflict';

    const enriched = enrichNormalized(record.normalized, enrichment);
    let normalizedWritten = false;
    if (canonicalJson(enriched) !== canonicalJson(record.normalized)) {
      // Guarded on the applied snapshot: an ingest that applied a newer
      // version in between makes this match no row.
      let update = this.client
        .from('source_records')
        .update({ normalized: enriched as unknown as NormalizedSourceRecord })
        .eq('id', record.id);
      update =
        record.appliedSnapshotSeq == null
          ? update.is('applied_snapshot_seq', null)
          : update.eq('applied_snapshot_seq', record.appliedSnapshotSeq);
      const { data, error } = await update.select('id');
      if (error) this.fail('applyEnrichment(normalized)', error);
      if ((data?.length ?? 0) === 0) return 'conflict';
      normalizedWritten = true;
    }

    const current = await this.recall.getCase(candidate.recallCaseId);
    if (!current) return 'conflict';
    const projection: CaseProjection = enrichedProjection(
      current.projection,
      records.map((r) => ({ id: r.id, normalized: r.normalized })),
      record.id,
      enriched,
    );
    if (canonicalJson(projection) === canonicalJson(current.projection)) {
      return normalizedWritten ? 'applied' : 'unchanged';
    }
    // Projection column only, conditional on last_changed_at — timeline,
    // products and last_changed_at stay byte-identical (no notification).
    const { data, error } = await this.client
      .from('recall_cases')
      .update({ projection })
      .eq('id', current.id)
      .eq('last_changed_at', current.lastChangedAt)
      .select('id');
    if (error) this.fail('applyEnrichment(projection)', error);
    return (data?.length ?? 0) > 0 ? 'applied' : 'conflict';
  }
}
