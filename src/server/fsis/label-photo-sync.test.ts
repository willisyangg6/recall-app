/**
 * The label-photo sync (docs/recall-imagery.md §16): incremental reads,
 * one copy of each photograph per case, and the card image rule — which may
 * fill an empty hero or replace its own earlier choice, and nothing else.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LabelPhoto, LabelPhotoExtraction, LabelPhotoSource } from './label-photos';
import {
  isLabelPhotoUrl,
  labelPhotoKey,
  selectCardPhoto,
  syncFsisLabelPhotos,
  type CaseHeroState,
  type LabelPhotoCandidate,
  type LabelPhotoSyncStore,
  type LabelSourceState,
  type StoredLabelPhoto,
} from './label-photo-sync';

const BUCKET = 'https://project.supabase.co/storage/v1/object/public/product-visuals/';
const NOW = new Date('2026-11-22T15:00:00Z');
const PDF =
  'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2026-11/Recall_028-2026-product-labels.pdf';
const JPG = 'https://www.fsis.usda.gov/sites/default/files/import/019-2016-label.jpg';

class MemoryPhotoStore implements LabelPhotoSyncStore {
  candidates: LabelPhotoCandidate[] = [];
  states = new Map<string, LabelSourceState>();
  photos: StoredLabelPhoto[] = [];
  heroes = new Map<string, CaseHeroState>();
  heroWrites: { caseId: string; url: string | null }[] = [];
  async listCandidates(publishedSince: string | null) {
    return this.candidates.filter((c) => !publishedSince || c.publishedAt >= publishedSince);
  }
  async listSourceStates(caseIds: string[]) {
    return [...this.states.values()].filter((s) => caseIds.includes(s.recallCaseId));
  }
  async listPhotos(caseIds: string[]) {
    return this.photos.filter((p) => caseIds.includes(p.recallCaseId));
  }
  async storePhotos(
    target: { recallCaseId: string; sourceRecordId: string; sourceUrl: string; sourceSha: string },
    photos: (LabelPhoto & { position: number })[],
  ) {
    const stored = photos.map((photo): StoredLabelPhoto => ({
      recallCaseId: target.recallCaseId,
      sourceUrl: target.sourceUrl,
      page: photo.page,
      imageIndex: photo.index,
      position: photo.position,
      url: BUCKET + labelPhotoKey(target.sourceSha, photo.page, photo.index),
      width: photo.width,
      height: photo.height,
      contentHash: photo.contentHash,
      dHash: photo.dHash,
      kind: photo.kind,
      caption: photo.caption,
    }));
    this.photos.push(...stored);
    return stored;
  }
  async recordSource(state: LabelSourceState) {
    this.states.set(`${state.recallCaseId}|${state.sourceUrl}`, state);
  }
  async getCaseHero(caseId: string) {
    return this.heroes.get(caseId) ?? null;
  }
  async setCaseHero(caseId: string, url: string | null, expected: string) {
    const hero = this.heroes.get(caseId);
    if (!hero || hero.lastChangedAt !== expected) return false;
    hero.heroImageUrl = url;
    this.heroWrites.push({ caseId, url });
    return true;
  }
}

function photo(overrides: Partial<LabelPhoto> & { dHash: string }): LabelPhoto {
  return {
    page: 1,
    index: 0,
    bytes: Buffer.from('x'),
    width: 800,
    height: 800,
    contentHash: overrides.dHash.repeat(4),
    kind: 'product',
    caption: null,
    box: { x: 0, y: 0, w: 1, h: 1 },
    ...overrides,
  };
}

const extraction = (photos: LabelPhoto[], panel = 0): LabelPhotoExtraction => ({
  photos,
  numPages: 1,
  dropped: { panel, tooSmall: 0, duplicate: 0, overCap: 0 },
});

function fsisCase(store: MemoryPhotoStore, id: string, html: string, hero: string | null = null) {
  store.candidates.push({
    sourceRecordId: `r-${id}`,
    recallCaseId: id,
    nativeId: `native-${id}`,
    summaryHtml: html,
    publishedAt: '2026-11-20',
  });
  store.heroes.set(id, { sourceAgency: 'FSIS', heroImageUrl: hero, lastChangedAt: 't0' });
}

test('a new label PDF becomes stored photos and the case card image, once', async () => {
  const store = new MemoryPhotoStore();
  fsisCase(store, 'c1', `<a href="${PDF}">view labels</a>`);
  const reads: string[] = [];
  const readSource = async (source: LabelPhotoSource) => {
    reads.push(source.url);
    return {
      sourceSha: 'a'.repeat(64),
      extraction: extraction([
        photo({ index: 0, width: 849, height: 913, dHash: '0000000000000000' }),
        photo({ index: 1, width: 945, height: 632, dHash: 'ffffffffffffffff' }),
        photo({ index: 2, width: 527, height: 284, dHash: '0f0f0f0f0f0f0f0f' }),
      ]),
    };
  };
  const first = await syncFsisLabelPhotos(store, { mode: 'recent', now: () => NOW, readSource });
  assert.equal(first.photosStored, 3);
  assert.equal(first.heroesSet, 1);
  const hero = store.heroes.get('c1')!.heroImageUrl!;
  assert.ok(isLabelPhotoUrl(hero));
  assert.match(hero, /p1-0\.webp$/, 'the largest photo on the first page');

  const second = await syncFsisLabelPhotos(store, { mode: 'recent', now: () => NOW, readSource });
  assert.deepEqual(reads, [PDF], 'a read source is never fetched again');
  assert.equal(second.heroesSet, 0);
  assert.equal(second.heroesUnchanged, 1);
});

test('the card image never replaces an agency photo or anything this sync did not write', async () => {
  const store = new MemoryPhotoStore();
  fsisCase(store, 'c1', `<a href="${PDF}">view labels</a>`, 'https://www.fda.gov/files/x.jpg');
  fsisCase(
    store,
    'c2',
    `<a href="${PDF}">view labels</a>`,
    `${BUCKET}fsis-labels/${'b'.repeat(20)}/p1.webp`,
  );
  store.heroes.get('c2')!.heroImageUrl = `${BUCKET}fsis-labels/${'b'.repeat(20)}/p1.webp`;
  const readSource = async () => ({
    sourceSha: 'a'.repeat(64),
    extraction: extraction([photo({ dHash: '0000000000000000' })]),
  });
  await syncFsisLabelPhotos(store, { mode: 'recent', now: () => NOW, readSource });
  assert.deepEqual(store.heroWrites, []);
});

test('a re-projection that cleared the card image is repaired on the next run', async () => {
  const store = new MemoryPhotoStore();
  fsisCase(store, 'c1', `<a href="${PDF}">view labels</a>`);
  const readSource = async () => ({
    sourceSha: 'a'.repeat(64),
    extraction: extraction([photo({ dHash: '0000000000000000' })]),
  });
  await syncFsisLabelPhotos(store, { mode: 'recent', now: () => NOW, readSource });
  const chosen = store.heroes.get('c1')!.heroImageUrl;
  store.heroes.set('c1', { sourceAgency: 'FSIS', heroImageUrl: null, lastChangedAt: 't1' });
  await syncFsisLabelPhotos(store, { mode: 'recent', now: () => NOW, readSource });
  assert.equal(store.heroes.get('c1')!.heroImageUrl, chosen);
});

test('a stale compare-and-set loses: an ingest in between is never rolled back', async () => {
  const store = new MemoryPhotoStore();
  fsisCase(store, 'c1', `<a href="${PDF}">view labels</a>`);
  store.setCaseHero = async () => false;
  const metrics = await syncFsisLabelPhotos(store, {
    mode: 'recent',
    now: () => NOW,
    readSource: async () => ({
      sourceSha: 'a'.repeat(64),
      extraction: extraction([photo({ dHash: '0000000000000000' })]),
    }),
  });
  assert.equal(metrics.heroConflicts, 1);
});

test('the same photograph in two documents is stored once', async () => {
  const store = new MemoryPhotoStore();
  fsisCase(store, 'c1', `<a href="${PDF}">view labels</a> <a href="${JPG}">Label</a>`);
  const readSource = async (source: LabelPhotoSource) => ({
    sourceSha: (source.kind === 'pdf' ? 'a' : 'b').repeat(64),
    // The JPG is the PDF's photo re-encoded: 2 bits apart.
    extraction: extraction([
      photo({ dHash: source.kind === 'pdf' ? '0000000000000000' : '0000000000000003' }),
    ]),
  });
  const metrics = await syncFsisLabelPhotos(store, { mode: 'recent', now: () => NOW, readSource });
  assert.equal(store.photos.length, 1);
  assert.equal(metrics.duplicatesAcrossSources, 1);
});

test('a document with no photograph is remembered; a failure backs off', async () => {
  const store = new MemoryPhotoStore();
  fsisCase(store, 'c1', `<a href="${PDF}">view labels</a>`);
  fsisCase(store, 'c2', `<a href="${JPG}">Label</a>`);
  let reads = 0;
  const readSource = async (source: LabelPhotoSource) => {
    reads += 1;
    if (source.kind === 'image') throw new Error('fetch failed');
    return { sourceSha: 'a'.repeat(64), extraction: extraction([], 4) };
  };
  const first = await syncFsisLabelPhotos(store, { mode: 'recent', now: () => NOW, readSource });
  assert.equal(first.emptySources, 1);
  assert.equal(first.droppedPanels, 4);
  assert.equal(first.failures, 1);
  await syncFsisLabelPhotos(store, {
    mode: 'recent',
    now: () => new Date(NOW.getTime() + 60_000),
    readSource,
  });
  assert.equal(reads, 2, 'neither is fetched again a minute later');
  assert.equal(store.heroWrites.length, 0, 'no photograph, no card image');
});

test('only FSIS cases are touched, and a dry run writes nothing', async () => {
  const store = new MemoryPhotoStore();
  fsisCase(store, 'c1', `<a href="${PDF}">view labels</a>`);
  store.heroes.set('c1', { sourceAgency: 'FDA', heroImageUrl: null, lastChangedAt: 't0' });
  fsisCase(store, 'c2', `<a href="${PDF}">view labels</a>`);
  const metrics = await syncFsisLabelPhotos(store, {
    mode: 'recent',
    now: () => NOW,
    dryRun: true,
    readSource: async () => {
      throw new Error('a dry run reads nothing');
    },
  });
  assert.equal(metrics.pending, 2);
  assert.equal(store.photos.length, 0);
  assert.equal(store.states.size, 0);
  assert.deepEqual(store.heroWrites, []);
});

test('card image rule: largest product photo on the earliest page; details never; none without products', () => {
  const stored = (o: Partial<StoredLabelPhoto>): StoredLabelPhoto => ({
    recallCaseId: 'c1',
    sourceUrl: PDF,
    page: 1,
    imageIndex: 0,
    position: 0,
    url: 'u',
    width: 100,
    height: 100,
    contentHash: 'h',
    dHash: '0',
    kind: 'product',
    caption: null,
    ...o,
  });
  assert.equal(
    selectCardPhoto([
      stored({ url: 'strip', width: 2000, height: 500, kind: 'detail' }),
      stored({ url: 'small', position: 1, width: 300, height: 300 }),
      stored({ url: 'big', position: 2, width: 900, height: 900 }),
      stored({ url: 'page2', position: 3, page: 2, width: 2000, height: 2000 }),
    ])?.url,
    'big',
  );
  assert.equal(selectCardPhoto([stored({ kind: 'detail' })]), null);
  assert.equal(selectCardPhoto([]), null);
});
