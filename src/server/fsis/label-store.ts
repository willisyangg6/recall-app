/**
 * Supabase-backed LabelSyncStore. Server-side only (service-role client).
 *
 * Candidate discovery is a database read, never agency traffic: FSIS records
 * whose stored summary HTML links a label PDF. The SQL-side pre-filter
 * (contains "label" and ".pdf") is a superset guarantee — every URL
 * extractLabelPdfUrls can accept contains both substrings — and keeps the
 * scan's egress to the label-bearing rows; the authoritative extraction stays
 * the shared extractLabelPdfUrls.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { labelAssetKey, type RenderedLabelPdf } from './labels';
import {
  extractLabelPdfUrls,
  type LabelCandidate,
  type LabelFailureState,
  type LabelStoreTarget,
  type LabelSyncStore,
} from './label-sync';

export class SupabaseLabelStore implements LabelSyncStore {
  constructor(private readonly client: SupabaseClient) {}

  private fail(operation: string, error: { message: string } | null): never {
    throw new Error(`SupabaseLabelStore.${operation} failed: ${error?.message ?? 'unknown error'}`);
  }

  async listCandidates(publishedSince: string | null): Promise<LabelCandidate[]> {
    const out: LabelCandidate[] = [];
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      let query = this.client
        .from('source_records')
        .select(
          'id, native_id, recall_case_id, publishedAt:normalized->>publishedAt, summaryHtml:normalized->>summaryHtml',
        )
        .eq('source_system', 'fsis_api')
        .ilike('normalized->>summaryHtml', '%label%')
        .like('normalized->>summaryHtml', '%.pdf%')
        .order('id')
        .range(from, from + pageSize - 1);
      if (publishedSince) query = query.gte('normalized->>publishedAt', publishedSince);
      const { data, error } = await query;
      if (error) this.fail('listCandidates', error);
      for (const row of data ?? []) {
        const record = row as unknown as {
          id: string;
          native_id: string;
          recall_case_id: string;
          publishedAt: string | null;
          summaryHtml: string | null;
        };
        for (const pdfUrl of extractLabelPdfUrls(record.summaryHtml)) {
          out.push({
            sourceRecordId: record.id,
            recallCaseId: record.recall_case_id,
            nativeId: record.native_id,
            pdfUrl,
            publishedAt: record.publishedAt ?? '',
          });
        }
      }
      if (!data || data.length < pageSize) break;
    }
    return out;
  }

  async visualShasByUrl(urls: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    const chunkSize = 100;
    for (let i = 0; i < urls.length; i += chunkSize) {
      const chunk = urls.slice(i, i + chunkSize);
      const { data, error } = await this.client
        .from('product_visuals')
        .select('source_url, source_sha256')
        .in('source_url', chunk);
      if (error) this.fail('visualShasByUrl', error);
      for (const row of data ?? []) {
        const url = row.source_url as string;
        if (!out.has(url)) out.set(url, new Set());
        out.get(url)!.add(row.source_sha256 as string);
      }
    }
    return out;
  }

  async listFailures(): Promise<LabelFailureState[]> {
    const { data, error } = await this.client
      .from('product_visual_failures')
      .select('source_url, attempts, last_attempt_at, last_error')
      .limit(1000);
    if (error) {
      // Pre-migration tolerance (reads only): before the job_operations
      // migration lands there is no failure state to consult. Writes stay
      // loud — recordFailure fails the run if the table is missing.
      if (/product_visual_failures/.test(error.message)) {
        console.warn(
          '  product_visual_failures not present yet (job_operations migration pending) — assuming no recorded failures.',
        );
        return [];
      }
      this.fail('listFailures', error);
    }
    return (data ?? []).map((row) => ({
      sourceUrl: row.source_url as string,
      attempts: row.attempts as number,
      lastAttemptAt: row.last_attempt_at as string,
      lastError: (row.last_error as string | null) ?? null,
    }));
  }

  async recordFailure(state: LabelFailureState): Promise<void> {
    const { error } = await this.client.from('product_visual_failures').upsert(
      {
        source_url: state.sourceUrl,
        attempts: state.attempts,
        last_attempt_at: state.lastAttemptAt,
        last_error: state.lastError,
      },
      { onConflict: 'source_url' },
    );
    if (error) this.fail('recordFailure', error);
  }

  async clearFailure(sourceUrl: string): Promise<void> {
    const { error } = await this.client
      .from('product_visual_failures')
      .delete()
      .eq('source_url', sourceUrl);
    if (error) this.fail('clearFailure', error);
  }

  async storePages(target: LabelStoreTarget, pages: RenderedLabelPdf['pages']): Promise<number> {
    for (const page of pages) {
      const key = labelAssetKey(target.pdfSha, page.page);
      const upload = await this.client.storage
        .from('product-visuals')
        .upload(key, page.bytes, { contentType: 'image/webp', upsert: false });
      // Content-addressed keys: "already exists" means an identical object.
      if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) {
        this.fail(`storePages(upload ${key})`, upload.error);
      }
      const publicUrl = this.client.storage.from('product-visuals').getPublicUrl(key)
        .data.publicUrl;
      const inserted = await this.client.from('product_visuals').upsert(
        {
          recall_case_id: target.recallCaseId,
          source_record_id: target.sourceRecordId,
          source_url: target.pdfUrl,
          source_sha256: target.pdfSha,
          page: page.page,
          url: publicUrl,
          role: 'package_label',
          width: page.width,
          height: page.height,
          content_hash: page.contentHash,
        },
        { onConflict: 'source_url,source_sha256,page' },
      );
      if (inserted.error) this.fail('storePages(insert)', inserted.error);
    }
    // Stale revisions of this URL are superseded; drop their rows (the
    // objects remain content-addressed in storage for audit).
    const stale = await this.client
      .from('product_visuals')
      .delete()
      .eq('source_url', target.pdfUrl)
      .neq('source_sha256', target.pdfSha);
    if (stale.error) this.fail('storePages(stale cleanup)', stale.error);
    return pages.length;
  }
}
