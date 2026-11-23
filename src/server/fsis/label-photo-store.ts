/**
 * Supabase-backed LabelPhotoSyncStore. Server-side only (service-role
 * client). Candidates are a database read, never agency traffic: FSIS records
 * whose stored summary HTML mentions pictures at all (a superset pre-filter;
 * `discoverLabelPhotoSources` is the authoritative rule).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { SupabaseStore } from '../store/supabase-store';
import {
  labelPhotoKey,
  type CaseHeroState,
  type LabelPhotoCandidate,
  type LabelPhotoSyncStore,
  type LabelSourceState,
  type StoredLabelPhoto,
} from './label-photo-sync';
import type { LabelPhoto } from './label-photos';

const BUCKET = 'product-visuals';
const PHOTO_COLUMNS =
  'recall_case_id, source_url, page, image_index, position, url, width, height, content_hash, dhash, kind, caption';

function toPhoto(row: Record<string, unknown>): StoredLabelPhoto {
  return {
    recallCaseId: row.recall_case_id as string,
    sourceUrl: row.source_url as string,
    page: row.page as number,
    imageIndex: row.image_index as number,
    position: row.position as number,
    url: row.url as string,
    width: row.width as number,
    height: row.height as number,
    contentHash: row.content_hash as string,
    dHash: row.dhash as string,
    kind: row.kind as StoredLabelPhoto['kind'],
    caption: (row.caption as string | null) ?? null,
  };
}

export class SupabaseLabelPhotoStore implements LabelPhotoSyncStore {
  private readonly cases: SupabaseStore;

  constructor(private readonly client: SupabaseClient) {
    this.cases = new SupabaseStore(client);
  }

  private fail(operation: string, error: { message: string } | null): never {
    throw new Error(
      `SupabaseLabelPhotoStore.${operation} failed: ${error?.message ?? 'unknown error'}`,
    );
  }

  async listCandidates(publishedSince: string | null): Promise<LabelPhotoCandidate[]> {
    const out: LabelPhotoCandidate[] = [];
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      let query = this.client
        .from('source_records')
        .select(
          'id, native_id, recall_case_id, publishedAt:normalized->>publishedAt, summaryHtml:normalized->>summaryHtml',
        )
        .eq('source_system', 'fsis_api')
        .or(
          [
            'normalized->>summaryHtml.ilike.*label*',
            'normalized->>summaryHtml.ilike.*photo*',
            'normalized->>summaryHtml.ilike.*image*',
            'normalized->>summaryHtml.ilike.*picture*',
            'normalized->>summaryHtml.ilike.*<img*',
          ].join(','),
        )
        .not('recall_case_id', 'is', null)
        .order('id')
        .range(from, from + pageSize - 1);
      if (publishedSince) query = query.gte('normalized->>publishedAt', publishedSince);
      const { data, error } = await query;
      if (error) this.fail('listCandidates', error);
      for (const row of (data ?? []) as unknown as {
        id: string;
        native_id: string;
        recall_case_id: string;
        publishedAt: string | null;
        summaryHtml: string | null;
      }[]) {
        out.push({
          sourceRecordId: row.id,
          recallCaseId: row.recall_case_id,
          nativeId: row.native_id,
          summaryHtml: row.summaryHtml,
          publishedAt: row.publishedAt ?? '',
        });
      }
      if (!data || data.length < pageSize) break;
    }
    return out;
  }

  private async inChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += 200) out.push(...(await read(ids.slice(i, i + 200))));
    return out;
  }

  async listSourceStates(caseIds: string[]): Promise<LabelSourceState[]> {
    return this.inChunks(caseIds, async (chunk) => {
      const { data, error } = await this.client
        .from('fsis_label_photo_sources')
        .select('*')
        .in('recall_case_id', chunk);
      if (error) this.fail('listSourceStates', error);
      return (data ?? []).map((row) => ({
        recallCaseId: row.recall_case_id as string,
        sourceUrl: row.source_url as string,
        sourceKind: row.source_kind as LabelSourceState['sourceKind'],
        sourceSha256: (row.source_sha256 as string | null) ?? null,
        status: row.status as LabelSourceState['status'],
        photos: row.photos as number,
        dropped: (row.dropped as Record<string, number>) ?? {},
        attempts: row.attempts as number,
        lastError: (row.last_error as string | null) ?? null,
        processedAt: row.processed_at as string,
      }));
    });
  }

  async listPhotos(caseIds: string[]): Promise<StoredLabelPhoto[]> {
    return this.inChunks(caseIds, async (chunk) => {
      const { data, error } = await this.client
        .from('fsis_label_photos')
        .select(PHOTO_COLUMNS)
        .in('recall_case_id', chunk)
        .order('position');
      if (error) this.fail('listPhotos', error);
      return (data ?? []).map((row) => toPhoto(row as Record<string, unknown>));
    });
  }

  async storePhotos(
    target: { recallCaseId: string; sourceRecordId: string; sourceUrl: string; sourceSha: string },
    photos: (LabelPhoto & { position: number })[],
  ): Promise<StoredLabelPhoto[]> {
    const stored: StoredLabelPhoto[] = [];
    for (const photo of photos) {
      const key = labelPhotoKey(target.sourceSha, photo.page, photo.index);
      const upload = await this.client.storage
        .from(BUCKET)
        .upload(key, photo.bytes, { contentType: 'image/webp', upsert: false });
      // Content-addressed keys: "already exists" means an identical object.
      if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) {
        this.fail(`storePhotos(upload ${key})`, upload.error);
      }
      const url = this.client.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
      const { data, error } = await this.client
        .from('fsis_label_photos')
        .upsert(
          {
            recall_case_id: target.recallCaseId,
            source_record_id: target.sourceRecordId,
            source_url: target.sourceUrl,
            source_sha256: target.sourceSha,
            page: photo.page,
            image_index: photo.index,
            position: photo.position,
            url,
            width: photo.width,
            height: photo.height,
            content_hash: photo.contentHash,
            dhash: photo.dHash,
            kind: photo.kind,
            caption: photo.caption,
          },
          { onConflict: 'source_url,source_sha256,page,image_index' },
        )
        .select(PHOTO_COLUMNS);
      if (error) {
        // The same photograph already stored for this case from another
        // revision or document: one copy per case.
        if (/fsis_label_photos_recall_case_id_content_hash_key/.test(error.message)) continue;
        this.fail('storePhotos(insert)', error);
      }
      for (const row of data ?? []) stored.push(toPhoto(row as Record<string, unknown>));
    }
    const stale = await this.client
      .from('fsis_label_photos')
      .delete()
      .eq('recall_case_id', target.recallCaseId)
      .eq('source_url', target.sourceUrl)
      .neq('source_sha256', target.sourceSha);
    if (stale.error) this.fail('storePhotos(stale cleanup)', stale.error);
    return stored;
  }

  async recordSource(state: LabelSourceState): Promise<void> {
    const { error } = await this.client.from('fsis_label_photo_sources').upsert(
      {
        recall_case_id: state.recallCaseId,
        source_url: state.sourceUrl,
        source_kind: state.sourceKind,
        source_sha256: state.sourceSha256,
        status: state.status,
        photos: state.photos,
        dropped: state.dropped,
        attempts: state.attempts,
        last_error: state.lastError,
        processed_at: state.processedAt,
      },
      { onConflict: 'recall_case_id,source_url' },
    );
    if (error) this.fail('recordSource', error);
  }

  async getCaseHero(recallCaseId: string): Promise<CaseHeroState | null> {
    const row = await this.cases.getCase(recallCaseId);
    if (!row) return null;
    return {
      sourceAgency: row.projection.sourceAgency,
      heroImageUrl: row.projection.heroImageUrl ?? null,
      lastChangedAt: row.lastChangedAt,
    };
  }

  setCaseHero(
    recallCaseId: string,
    heroImageUrl: string | null,
    expectedLastChangedAt: string,
  ): Promise<boolean> {
    return this.cases.updateCaseHeroImage(recallCaseId, heroImageUrl, expectedLastChangedAt);
  }
}
