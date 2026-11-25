/**
 * FSIS label-photo sync (docs/recall-imagery.md §16): every announcement's
 * linked label documents → the product photographs inside them, stored per
 * case in document order, and the case's card image chosen from them.
 *
 * Shared rules, no per-recall code:
 *
 *  - **Sources** are what the announcement itself links or embeds as
 *    pictures (`discoverLabelPhotoSources`): label PDFs, image files, and
 *    linked label pages' own images. Lists of distribution are never read.
 *  - **Photos** come from `extractLabelPhotos` / `extractImageFilePhoto`:
 *    placed images only, nutrition/ingredient panels and slivers dropped,
 *    each with its own printed caption. The same photograph in two documents
 *    (exact bytes, or a re-encoding within NEAR_DUPLICATE_BITS) is stored once.
 *  - **Card image** (`selectCardPhoto`): the largest product photograph on
 *    the first page that has one, in the announcement's own document order —
 *    the agency's lead label. Written as `projection.heroImageUrl` through
 *    the compare-and-set seam that changes no timeline, date or alert
 *    (`updateCaseHeroImage`), and only over an empty hero or an earlier label
 *    photo — never over any other image. Re-asserted every run, so a
 *    re-projection that clears it is repaired within the same tick.
 *
 * Incremental like the label render sync: a source is read once per
 * revision; a source that yielded nothing is remembered, so it is not
 * fetched every tick; failures back off (6 h·2^n, capped at 7 days).
 */

import { FSIS_HOSTS, resolveOfficialUrl } from '../../lib/official-urls';
import { failureBackoffMs } from './label-sync';
import {
  discoverLabelPhotoSources,
  hashDistance,
  NEAR_DUPLICATE_BITS,
  type LabelPhoto,
  type LabelPhotoExtraction,
  type LabelPhotoKind,
  type LabelPhotoSource,
  type LabelSourceKind,
} from './label-photos';
import { sha256 } from './labels';

/** Storage key prefix of every crop; a hero under it is ours to replace. */
export const LABEL_PHOTO_PREFIX = 'fsis-label-photos/';

export function labelPhotoKey(sourceSha: string, page: number, index: number): string {
  return `${LABEL_PHOTO_PREFIX}${sourceSha.slice(0, 20)}/p${page}-${index}.webp`;
}

/** Is this stored hero one this sync wrote (and may therefore replace)? */
export function isLabelPhotoUrl(url: string | null): boolean {
  return url !== null && url.includes(`/${LABEL_PHOTO_PREFIX}`);
}

export interface LabelPhotoCandidate {
  sourceRecordId: string;
  recallCaseId: string;
  nativeId: string;
  summaryHtml: string | null;
  publishedAt: string;
}

export interface StoredLabelPhoto {
  recallCaseId: string;
  sourceUrl: string;
  page: number;
  imageIndex: number;
  position: number;
  url: string;
  width: number;
  height: number;
  contentHash: string;
  dHash: string;
  kind: LabelPhotoKind;
  caption: string | null;
}

export interface LabelSourceState {
  recallCaseId: string;
  sourceUrl: string;
  sourceKind: LabelSourceKind;
  sourceSha256: string | null;
  status: 'done' | 'failed';
  photos: number;
  dropped: Record<string, number>;
  attempts: number;
  lastError: string | null;
  processedAt: string;
}

export interface CaseHeroState {
  sourceAgency: string;
  heroImageUrl: string | null;
  lastChangedAt: string;
}

/** Storage port: Supabase in production, in-memory in tests. */
export interface LabelPhotoSyncStore {
  listCandidates(publishedSince: string | null): Promise<LabelPhotoCandidate[]>;
  listSourceStates(caseIds: string[]): Promise<LabelSourceState[]>;
  listPhotos(caseIds: string[]): Promise<StoredLabelPhoto[]>;
  /** Upload + insert; retire this source's rows from any other revision. Returns rows stored. */
  storePhotos(
    target: { recallCaseId: string; sourceRecordId: string; sourceUrl: string; sourceSha: string },
    photos: (LabelPhoto & { position: number })[],
  ): Promise<StoredLabelPhoto[]>;
  recordSource(state: LabelSourceState): Promise<void>;
  getCaseHero(recallCaseId: string): Promise<CaseHeroState | null>;
  setCaseHero(
    recallCaseId: string,
    heroImageUrl: string | null,
    expectedLastChangedAt: string,
  ): Promise<boolean>;
}

/** What a source fetch returns: the bytes it judged, and the photos read from them. */
export interface SourceRead {
  sourceSha: string;
  extraction: LabelPhotoExtraction;
}

export interface LabelPhotoSyncOptions {
  mode: 'recent' | 'full';
  now?: () => Date;
  dryRun?: boolean;
  /** Read one source into photos (production: fetch + extract). */
  readSource?: (source: LabelPhotoSource) => Promise<SourceRead>;
  maxSources?: number;
  recentDays?: number;
}

export interface LabelPhotoSyncMetrics {
  mode: 'recent' | 'full';
  cases: number;
  sources: number;
  pending: number;
  deferredByBackoff: number;
  capped: number;
  read: number;
  photosStored: number;
  duplicatesAcrossSources: number;
  droppedPanels: number;
  droppedSmall: number;
  emptySources: number;
  failures: number;
  heroesSet: number;
  heroesUnchanged: number;
  heroConflicts: number;
  [key: string]: unknown;
}

const DEFAULT_RECENT_DAYS = 45;
/** Photos of one source occupy positions [index·SOURCE_SPAN, (index+1)·SOURCE_SPAN). */
const SOURCE_SPAN = 1000;

/**
 * The case's card image: the largest product photograph on the earliest page
 * (in document order) that has one. Detail strips never qualify. Null when
 * the documents hold no product photograph.
 */
export function selectCardPhoto(photos: readonly StoredLabelPhoto[]): StoredLabelPhoto | null {
  const products = photos.filter((photo) => photo.kind === 'product');
  if (products.length === 0) return null;
  const pageKey = (p: StoredLabelPhoto) => Math.floor(p.position / SOURCE_SPAN) * 10_000 + p.page;
  const first = Math.min(...products.map(pageKey));
  return products
    .filter((photo) => pageKey(photo) === first)
    .reduce((best, photo) =>
      photo.width * photo.height > best.width * best.height ? photo : best,
    );
}

export async function syncFsisLabelPhotos(
  store: LabelPhotoSyncStore,
  options: LabelPhotoSyncOptions,
): Promise<LabelPhotoSyncMetrics> {
  const now = options.now ?? (() => new Date());
  const nowMs = now().getTime();
  const recentCutoff = new Date(nowMs - (options.recentDays ?? DEFAULT_RECENT_DAYS) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const maxSources = options.maxSources ?? (options.mode === 'recent' ? 12 : 120);
  const resolve = (raw: string) =>
    resolveOfficialUrl(raw, { approvedHosts: FSIS_HOSTS })?.url ?? null;
  const readSource = options.readSource ?? defaultReadSource;

  const candidates = await store.listCandidates(options.mode === 'recent' ? recentCutoff : null);
  // Per case: its records' sources, oldest record first, each in the
  // announcement's own order; one entry per URL.
  const byCase = new Map<string, { record: LabelPhotoCandidate; source: LabelPhotoSource }[]>();
  for (const record of [...candidates].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) {
    const list = byCase.get(record.recallCaseId) ?? [];
    for (const source of discoverLabelPhotoSources(record.summaryHtml, resolve)) {
      if (!list.some((entry) => entry.source.url === source.url)) list.push({ record, source });
    }
    byCase.set(record.recallCaseId, list);
  }
  // Newest case first: the capped daily sweep reaches the recalls shoppers
  // see first, and the historical tail last (Grace, 2026-10-06, was last of
  // ~1,000 pending sources in oldest-first order).
  const newest = new Map<string, string>();
  for (const record of candidates) {
    const seen = newest.get(record.recallCaseId) ?? '';
    if (record.publishedAt > seen) newest.set(record.recallCaseId, record.publishedAt);
  }
  const caseIds = [...byCase.keys()]
    .filter((id) => (byCase.get(id) ?? []).length > 0)
    .sort((a, b) => (newest.get(b) ?? '').localeCompare(newest.get(a) ?? ''));
  const states = new Map(
    (await store.listSourceStates(caseIds)).map((s) => [`${s.recallCaseId}|${s.sourceUrl}`, s]),
  );
  const photosByCase = new Map<string, StoredLabelPhoto[]>();
  for (const photo of await store.listPhotos(caseIds)) {
    const list = photosByCase.get(photo.recallCaseId) ?? [];
    list.push(photo);
    photosByCase.set(photo.recallCaseId, list);
  }

  const metrics: LabelPhotoSyncMetrics = {
    mode: options.mode,
    cases: caseIds.length,
    sources: 0,
    pending: 0,
    deferredByBackoff: 0,
    capped: 0,
    read: 0,
    photosStored: 0,
    duplicatesAcrossSources: 0,
    droppedPanels: 0,
    droppedSmall: 0,
    emptySources: 0,
    failures: 0,
    heroesSet: 0,
    heroesUnchanged: 0,
    heroConflicts: 0,
  };

  type Work = {
    caseId: string;
    record: LabelPhotoCandidate;
    source: LabelPhotoSource;
    sourceIndex: number;
    previous: LabelSourceState | undefined;
  };
  const worklist: Work[] = [];
  for (const caseId of caseIds) {
    for (const [sourceIndex, { record, source }] of byCase.get(caseId)!.entries()) {
      metrics.sources += 1;
      const previous = states.get(`${caseId}|${source.url}`);
      if (previous?.status === 'done') continue;
      if (
        previous?.status === 'failed' &&
        nowMs - new Date(previous.processedAt).getTime() < failureBackoffMs(previous.attempts)
      ) {
        metrics.deferredByBackoff += 1;
        continue;
      }
      metrics.pending += 1;
      worklist.push({ caseId, record, source, sourceIndex, previous });
    }
  }
  const bounded = worklist.slice(0, maxSources);
  metrics.capped = worklist.length - bounded.length;

  if (!options.dryRun) {
    for (const work of bounded) {
      metrics.read += 1;
      const processedAt = now().toISOString();
      try {
        const { sourceSha, extraction } = await readSource(work.source);
        metrics.droppedPanels += extraction.dropped.panel;
        metrics.droppedSmall += extraction.dropped.tooSmall;
        // The same photograph already stored from another of this case's
        // documents is that photo, not a second one.
        const existing = (photosByCase.get(work.caseId) ?? []).filter(
          (photo) => photo.sourceUrl !== work.source.url,
        );
        const fresh = extraction.photos.filter((photo) => {
          const duplicate = existing.some(
            (stored) =>
              stored.contentHash === photo.contentHash ||
              hashDistance(stored.dHash, photo.dHash) <= NEAR_DUPLICATE_BITS,
          );
          if (duplicate) metrics.duplicatesAcrossSources += 1;
          return !duplicate;
        });
        const stored = await store.storePhotos(
          {
            recallCaseId: work.caseId,
            sourceRecordId: work.record.sourceRecordId,
            sourceUrl: work.source.url,
            sourceSha,
          },
          fresh.map((photo, order) => ({
            ...photo,
            position: work.sourceIndex * SOURCE_SPAN + order,
          })),
        );
        metrics.photosStored += stored.length;
        if (stored.length === 0) metrics.emptySources += 1;
        photosByCase.set(work.caseId, [...existing, ...stored]);
        await store.recordSource({
          recallCaseId: work.caseId,
          sourceUrl: work.source.url,
          sourceKind: work.source.kind,
          sourceSha256: sourceSha,
          status: 'done',
          photos: stored.length,
          dropped: { ...extraction.dropped },
          attempts: 0,
          lastError: null,
          processedAt,
        });
        console.log(
          `  ✓ ${work.record.nativeId}: ${stored.length} photo(s) from ${work.source.url}`,
        );
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        metrics.failures += 1;
        await store.recordSource({
          recallCaseId: work.caseId,
          sourceUrl: work.source.url,
          sourceKind: work.source.kind,
          sourceSha256: null,
          status: 'failed',
          photos: 0,
          dropped: {},
          attempts: (work.previous?.attempts ?? 0) + 1,
          lastError: message,
          processedAt,
        });
        console.log(`  ✗ ${work.record.nativeId}: ${message} (${work.source.url})`);
      }
    }
  }

  // Card images: asserted for every case in scope, every run.
  for (const caseId of caseIds) {
    const choice = selectCardPhoto(photosByCase.get(caseId) ?? []);
    const hero = await store.getCaseHero(caseId);
    if (!hero || hero.sourceAgency !== 'FSIS') continue;
    // Only an empty hero or an earlier label photo is ours to set.
    if (hero.heroImageUrl !== null && !isLabelPhotoUrl(hero.heroImageUrl)) continue;
    const next = choice?.url ?? null;
    if (hero.heroImageUrl === next) {
      if (next !== null) metrics.heroesUnchanged += 1;
      continue;
    }
    if (options.dryRun) {
      metrics.heroesSet += 1;
      continue;
    }
    if (await store.setCaseHero(caseId, next, hero.lastChangedAt)) metrics.heroesSet += 1;
    else metrics.heroConflicts += 1;
  }
  return metrics;
}

// ── Production source reading ───────────────────────────────────────────────

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_IMAGES = 8;

async function defaultReadSource(source: LabelPhotoSource): Promise<SourceRead> {
  const { safeFetchBinary } = await import('../safe-fetch');
  const { extractImageFilePhoto, extractLabelPhotos, pageImageSources } =
    await import('./label-photos');
  const headers = { 'User-Agent': 'recall-app label renderer (contact: dev)' };
  if (source.kind === 'pdf') {
    const { fetchLabelPdf } = await import('./label-sync');
    const bytes = await fetchLabelPdf(source.url);
    return { sourceSha: sha256(bytes), extraction: await extractLabelPhotos(bytes) };
  }
  if (source.kind === 'image') {
    const { bytes } = await safeFetchBinary(source.url, {
      approvedHosts: FSIS_HOSTS,
      kind: 'image',
      maxBytes: MAX_IMAGE_BYTES,
      headers,
    });
    return { sourceSha: sha256(bytes), extraction: await extractImageFilePhoto(bytes) };
  }
  // A linked label page: its own <img> tags, each read as an image file.
  const page = await safeFetchBinary(source.url, {
    approvedHosts: FSIS_HOSTS,
    kind: 'html',
    maxBytes: MAX_PAGE_BYTES,
    headers,
  });
  const resolve = (raw: string) =>
    resolveOfficialUrl(raw, { approvedHosts: FSIS_HOSTS, baseUrl: page.finalUrl })?.url ?? null;
  const photos: LabelPhoto[] = [];
  const dropped = { panel: 0, tooSmall: 0, duplicate: 0, overCap: 0 };
  const html = new TextDecoder().decode(page.bytes);
  for (const [index, url] of pageImageSources(html, resolve).slice(0, MAX_PAGE_IMAGES).entries()) {
    const { bytes } = await safeFetchBinary(url, {
      approvedHosts: FSIS_HOSTS,
      kind: 'image',
      maxBytes: MAX_IMAGE_BYTES,
      headers,
    });
    const one = await extractImageFilePhoto(bytes);
    dropped.tooSmall += one.dropped.tooSmall;
    for (const photo of one.photos) {
      if (photos.some((p) => hashDistance(p.dHash, photo.dHash) <= NEAR_DUPLICATE_BITS)) {
        dropped.duplicate += 1;
        continue;
      }
      photos.push({ ...photo, page: 1, index });
    }
  }
  return {
    sourceSha: sha256(page.bytes),
    extraction: { photos, numPages: 1, dropped },
  };
}
