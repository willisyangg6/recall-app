/**
 * The FDA hero-image backfill is a maintenance write path against live
 * consumer data, so its safety properties are pinned as hard assertions:
 * it fills a missing image from preserved source bytes, leaves imageless
 * recalls alone, never touches the ledger or case identity, and converges —
 * a second run must be a complete no-op.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectCase } from '../../domain/projection';
import type { NormalizedSourceRecord } from '../../domain/source-record';
import { MemoryStore } from '../store/memory-store';
import { backfillFdaHeroImages } from './image-backfill';
import { parseFdaAnnouncement } from './parse';

/** A detail region in the shape FDA serves, with product photos. */
function detailHtml(options: { images: string[]; title?: string }): string {
  const title = options.title ?? 'Acme Foods Recalls Widget Snacks Due to Undeclared Peanuts';
  const imgs = options.images
    .map(
      (file, index) =>
        `<img src="/files/styles/recall_image_small/public/${file}?itok=abc" alt="Product photo ${index + 1}" width="480" height="360">`,
    )
    .join('\n');
  return `
    <h1>${title}</h1>
    <dl class="lcds-description-list--grid">
      <dt>Company Announcement Date</dt><dd><time datetime="2026-03-04T12:00:00Z">March 04, 2026</time></dd>
      <dt>FDA Publish Date</dt><dd><time datetime="2026-03-04T12:00:00Z">March 04, 2026</time></dd>
      <dt>Product Type</dt><dd><div class="field--item">Food &amp; Beverages</div></dd>
      <dt>Reason for Announcement</dt><dd><div class="field--item">Undeclared peanuts</div></dd>
      <dt>Company Name</dt><dd><div class="field--item">Acme Foods</div></dd>
      <dt>Brand Name</dt><dd><div class="field--item">Acme</div></dd>
      <dt>Product Description</dt><dd><div class="field--item">Widget Snacks</div></dd>
    </dl>
    <h2>Company Announcement</h2>
    <p>Acme Foods of Springfield, IL is recalling Widget Snacks because they may
    contain undeclared peanuts. The product was sold in retail stores with UPC
    012345678905 and best by date March 4, 2027.</p>
    ${imgs}`;
}

/** A listing row in the shape the FDA listing JSON serves. */
function listingItem(path: string) {
  return {
    path,
    field_change_date_2: '03/04/2026',
    field_brand_name: '<a href="/x">Acme</a>',
    field_product_description: 'Widget Snacks',
    field_recall_reason_description: 'Undeclared peanuts',
    field_recall_reason: 'Peanuts',
    field_company_name: 'Acme Foods',
    field_regulated_product_field: 'Food &amp; Beverages',
    changed: '<time datetime="2026-03-04T12:00:00Z">March 04, 2026</time>',
  };
}

function rawPayload(path: string, html: string | null) {
  // A record whose detail fetch failed still carries its listing row — that
  // is the only way a stored payload legitimately lacks detail HTML.
  return {
    listing: html === null ? listingItem(path) : null,
    detailMainHtml: html,
    path,
    rssTitle: null,
  };
}

/** Seed a store with one FDA case whose record was parsed WITHOUT images. */
async function seedCase(
  store: MemoryStore,
  options: { path: string; html: string | null; storeHero?: boolean },
) {
  const parsed = parseFdaAnnouncement(rawPayload(options.path, options.html));
  // Model a record ingested before the parser extracted photos: identical in
  // every way except the image fields.
  const normalized: NormalizedSourceRecord = options.storeHero
    ? parsed
    : { ...parsed, heroImageUrl: null, imageUrls: [] };
  const projection = projectCase([normalized]);
  const recallCase = await store.insertCase({
    projection,
    timeline: [
      {
        occurredAt: normalized.publishedAt,
        kind: 'published',
        summary: 'Recall published by FDA.',
        causedBySnapshotIds: [],
        material: false,
      },
    ],
    createdAt: '2026-03-05T00:00:00.000Z',
    lastChangedAt: '2026-03-05T00:00:00.000Z',
  });
  const record = await store.insertSourceRecord({
    sourceSystem: 'fda_announcement',
    nativeId: normalized.nativeId,
    recallCaseId: recallCase.id,
    linkMethod: 'self',
    normalized,
    sourceUrl: normalized.officialUrl,
    firstSeenAt: '2026-03-05T00:00:00.000Z',
    lastSeenAt: '2026-03-05T00:00:00.000Z',
  });
  await store.insertSnapshot({
    sourceRecordId: record.id,
    fetchedAt: '2026-03-05T00:00:00.000Z',
    contentHash: `hash-${options.path}`,
    rawPayload: rawPayload(options.path, options.html),
    sourceUrl: normalized.officialUrl,
  });
  return { recallCase, record };
}

test('an existing case gains its hero image from the preserved snapshot', async () => {
  const store = new MemoryStore();
  const { recallCase, record } = await seedCase(store, {
    path: '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-widget-snacks',
    html: detailHtml({ images: ['widget-front.jpg', 'widget-label.jpg'] }),
  });
  assert.equal((await store.getCase(recallCase.id))!.projection.heroImageUrl, null);

  const report = await backfillFdaHeroImages(store, { apply: true });

  const expected =
    'https://www.fda.gov/files/styles/recall_image_small/public/widget-front.jpg?itok=abc';
  assert.equal((await store.getCase(recallCase.id))!.projection.heroImageUrl, expected);
  // The record's own payload is updated too, so the projection stays a pure
  // function of its records and a later re-projection cannot erase this.
  const stored = [...store.sourceRecords.values()].find((row) => row.id === record.id)!;
  assert.equal(stored.normalized.heroImageUrl, expected);
  assert.equal(stored.normalized.imageUrls?.length, 2);
  assert.equal(report.eligible, 1);
  assert.equal(report.caseWrites, 1);
  assert.equal(report.sourceRecordWrites, 1);
  assert.equal(report.networkRequests, 0);
});

test('a case whose source publishes no photo is left completely untouched', async () => {
  const store = new MemoryStore();
  const { recallCase, record } = await seedCase(store, {
    path: '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-plain-snacks',
    html: detailHtml({ images: [] }),
  });
  const before = structuredClone(await store.getCase(recallCase.id));
  const recordBefore = structuredClone(
    [...store.sourceRecords.values()].find((row) => row.id === record.id),
  );

  const report = await backfillFdaHeroImages(store, { apply: true });

  assert.deepEqual(await store.getCase(recallCase.id), before);
  assert.deepEqual(
    [...store.sourceRecords.values()].find((row) => row.id === record.id),
    recordBefore,
  );
  assert.equal(report.eligible, 0);
  assert.equal(report.caseWrites, 0);
  assert.equal(report.sourceRecordWrites, 0);
  assert.equal(report.recordsWithoutSourceImage, 1);
  assert.equal(report.casesWithoutSourceImage, 1);
});

test('a correct existing hero image is never rewritten', async () => {
  const store = new MemoryStore();
  const { recallCase } = await seedCase(store, {
    path: '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-widget-snacks',
    html: detailHtml({ images: ['widget-front.jpg'] }),
    storeHero: true,
  });
  const before = structuredClone(await store.getCase(recallCase.id));

  const report = await backfillFdaHeroImages(store, { apply: true });

  assert.deepEqual(await store.getCase(recallCase.id), before);
  assert.equal(report.alreadyPopulated, 1);
  assert.equal(report.caseWrites, 0);
  assert.equal(report.sourceRecordWrites, 0);
});

test('a dry run writes nothing at all', async () => {
  const store = new MemoryStore();
  const { recallCase } = await seedCase(store, {
    path: '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-widget-snacks',
    html: detailHtml({ images: ['widget-front.jpg'] }),
  });
  const before = structuredClone(await store.getCase(recallCase.id));
  const recordsBefore = structuredClone([...store.sourceRecords.values()]);

  const report = await backfillFdaHeroImages(store, { apply: false });

  assert.deepEqual(await store.getCase(recallCase.id), before);
  assert.deepEqual([...store.sourceRecords.values()], recordsBefore);
  // …but it still reports exactly what an apply would do.
  assert.equal(report.eligible, 1);
  assert.equal(report.caseWrites, 1);
  assert.equal(report.sourceRecordWrites, 1);
});

test('re-running is idempotent: the second pass is a complete no-op', async () => {
  const store = new MemoryStore();
  await seedCase(store, {
    path: '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-widget-snacks',
    html: detailHtml({ images: ['widget-front.jpg'] }),
  });
  await backfillFdaHeroImages(store, { apply: true });
  const afterFirst = structuredClone([...store.cases.values()]);

  const second = await backfillFdaHeroImages(store, { apply: true });

  assert.deepEqual([...store.cases.values()], afterFirst);
  assert.equal(second.eligible, 0);
  assert.equal(second.caseWrites, 0);
  assert.equal(second.sourceRecordWrites, 0);
  assert.equal(second.alreadyPopulated, 1);
});

test('the backfill never creates cases, records, snapshots, or notifications', async () => {
  const store = new MemoryStore();
  await seedCase(store, {
    path: '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-widget-snacks',
    html: detailHtml({ images: ['widget-front.jpg'] }),
  });
  await seedCase(store, {
    path: '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-plain-snacks',
    html: detailHtml({ images: [] }),
  });
  const counts = {
    cases: store.cases.size,
    records: store.sourceRecords.size,
    snapshots: store.snapshots.length,
    notifications: store.notifications.size,
    products: store.products.size,
    runs: store.ingestRuns.size,
  };

  const report = await backfillFdaHeroImages(store, { apply: true });

  assert.equal(store.cases.size, counts.cases);
  assert.equal(store.sourceRecords.size, counts.records);
  assert.equal(store.snapshots.length, counts.snapshots);
  assert.equal(store.notifications.size, 0);
  assert.equal(store.products.size, counts.products);
  // No ingest run is opened either — this is not ingestion.
  assert.equal(store.ingestRuns.size, counts.runs);
  assert.equal(report.notificationEvents, 0);
  assert.equal(report.newCases, 0);
});

test('identity, lineage, dates, and the timeline survive the write untouched', async () => {
  const store = new MemoryStore();
  const { recallCase, record } = await seedCase(store, {
    path: '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-widget-snacks',
    html: detailHtml({ images: ['widget-front.jpg'] }),
  });
  const caseBefore = structuredClone(await store.getCase(recallCase.id))!;
  const recordBefore = structuredClone(
    [...store.sourceRecords.values()].find((row) => row.id === record.id),
  )!;

  await backfillFdaHeroImages(store, { apply: true });

  const caseAfter = (await store.getCase(recallCase.id))!;
  const recordAfter = [...store.sourceRecords.values()].find((row) => row.id === record.id)!;
  // The projection differs in heroImageUrl and nothing else.
  assert.deepEqual(
    { ...caseAfter.projection, heroImageUrl: null },
    { ...caseBefore.projection, heroImageUrl: null },
  );
  assert.deepEqual(caseAfter.timeline, caseBefore.timeline);
  assert.equal(caseAfter.lastChangedAt, caseBefore.lastChangedAt);
  assert.equal(caseAfter.createdAt, caseBefore.createdAt);
  // The record differs in image fields and nothing else — identity, lineage
  // flags, dates, and link method are all preserved.
  assert.deepEqual(
    { ...recordAfter.normalized, heroImageUrl: null, imageUrls: [] },
    { ...recordBefore.normalized, heroImageUrl: null, imageUrls: [] },
  );
  assert.equal(recordAfter.linkMethod, recordBefore.linkMethod);
  assert.equal(recordAfter.nativeId, recordBefore.nativeId);
  assert.equal(recordAfter.recallCaseId, recordBefore.recallCaseId);
  assert.equal(recordAfter.firstSeenAt, recordBefore.firstSeenAt);
  assert.equal(recordAfter.lastSeenAt, recordBefore.lastSeenAt);
});

test('FSIS records are never visited', async () => {
  const store = new MemoryStore();
  const fsisCase = await store.insertCase({
    projection: projectCase([
      {
        ...parseFdaAnnouncement(
          rawPayload(
            '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-widget-snacks',
            detailHtml({ images: ['widget-front.jpg'] }),
          ),
        ),
        sourceSystem: 'fsis_api',
        sourceAgency: 'FSIS',
        heroImageUrl: null,
        imageUrls: [],
      },
    ]),
    timeline: [],
    createdAt: '2026-03-05T00:00:00.000Z',
    lastChangedAt: '2026-03-05T00:00:00.000Z',
  });
  const normalized = {
    ...parseFdaAnnouncement(
      rawPayload(
        '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-widget-snacks',
        detailHtml({ images: ['widget-front.jpg'] }),
      ),
    ),
    sourceSystem: 'fsis_api' as const,
    sourceAgency: 'FSIS' as const,
    heroImageUrl: null,
    imageUrls: [],
  };
  const record = await store.insertSourceRecord({
    sourceSystem: 'fsis_api',
    nativeId: '010-2026',
    recallCaseId: fsisCase.id,
    linkMethod: 'self',
    normalized,
    sourceUrl: 'https://www.fsis.usda.gov/x',
    firstSeenAt: '2026-03-05T00:00:00.000Z',
    lastSeenAt: '2026-03-05T00:00:00.000Z',
  });
  await store.insertSnapshot({
    sourceRecordId: record.id,
    fetchedAt: '2026-03-05T00:00:00.000Z',
    contentHash: 'fsis-hash',
    rawPayload: rawPayload('/x', detailHtml({ images: ['widget-front.jpg'] })),
    sourceUrl: 'https://www.fsis.usda.gov/x',
  });
  const before = structuredClone(await store.getCase(fsisCase.id));

  const report = await backfillFdaHeroImages(store, { apply: true });

  assert.deepEqual(await store.getCase(fsisCase.id), before);
  assert.equal(report.casesExamined, 0);
  assert.equal(report.recordsExamined, 0);
});

test('a snapshot without detail HTML is reported, never guessed at', async () => {
  const store = new MemoryStore();
  const { recallCase } = await seedCase(store, {
    path: '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-listing-only',
    html: null,
  });
  const before = structuredClone(await store.getCase(recallCase.id));

  const report = await backfillFdaHeroImages(store, { apply: true });

  assert.deepEqual(await store.getCase(recallCase.id), before);
  assert.equal(report.recordsMissingSnapshotHtml, 1);
  assert.equal(report.caseWrites, 0);
  assert.equal(report.parseFailures.length, 0);
});

test('a merged multi-record case resolves its hero by projection precedence', async () => {
  // The Momchipz shape: a correction joined to the recall it corrects. The
  // newest record's image must win, exactly as a real re-projection decides.
  const store = new MemoryStore();
  const original = parseFdaAnnouncement(
    rawPayload(
      '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-widget-snacks',
      detailHtml({ images: ['old-photo.jpg'] }),
    ),
  );
  const correction = parseFdaAnnouncement(
    rawPayload(
      '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-widget-snacks-corrected',
      detailHtml({
        images: ['new-photo.jpg'],
        title: 'Acme Foods Recalls Widget Snacks Due to Undeclared Peanuts and Milk',
      }),
    ),
  );
  const strippedOriginal = { ...original, heroImageUrl: null, imageUrls: [] };
  const strippedCorrection = {
    ...correction,
    publishedAt: '2026-03-09',
    heroImageUrl: null,
    imageUrls: [],
  };
  const recallCase = await store.insertCase({
    projection: projectCase([strippedOriginal, strippedCorrection]),
    timeline: [],
    createdAt: '2026-03-05T00:00:00.000Z',
    lastChangedAt: '2026-03-05T00:00:00.000Z',
  });
  for (const [index, normalized] of [strippedOriginal, strippedCorrection].entries()) {
    const record = await store.insertSourceRecord({
      sourceSystem: 'fda_announcement',
      nativeId: normalized.nativeId,
      recallCaseId: recallCase.id,
      linkMethod: index === 0 ? 'self' : 'expansion_prefix',
      normalized,
      sourceUrl: normalized.officialUrl,
      firstSeenAt: '2026-03-05T00:00:00.000Z',
      lastSeenAt: '2026-03-05T00:00:00.000Z',
    });
    await store.insertSnapshot({
      sourceRecordId: record.id,
      fetchedAt: '2026-03-05T00:00:00.000Z',
      contentHash: `hash-${index}`,
      rawPayload: rawPayload(
        `/safety/recalls-market-withdrawals-safety-alerts/${normalized.nativeId}`,
        detailHtml({ images: [index === 0 ? 'old-photo.jpg' : 'new-photo.jpg'] }),
      ),
      sourceUrl: normalized.officialUrl,
    });
  }

  const report = await backfillFdaHeroImages(store, { apply: true });

  assert.equal(report.casesExamined, 1);
  assert.equal(report.caseWrites, 1);
  assert.equal(report.sourceRecordWrites, 2);
  assert.match(
    (await store.getCase(recallCase.id))!.projection.heroImageUrl!,
    /new-photo\.jpg/,
    'the newest record supplies the case hero, per projectCase precedence',
  );
});

test('an unreadable snapshot is reported as undetermined, never as "no photo"', async () => {
  // Absence of evidence is not evidence of absence: a case we could not check
  // must never be counted as one whose source publishes no photo.
  const store = new MemoryStore();
  await seedCase(store, {
    path: '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-listing-only',
    html: null,
  });
  await seedCase(store, {
    path: '/safety/recalls-market-withdrawals-safety-alerts/acme-foods-recalls-plain-snacks',
    html: detailHtml({ images: [] }),
  });

  const report = await backfillFdaHeroImages(store, { apply: false });

  assert.equal(report.casesUndetermined, 1);
  assert.equal(report.casesWithoutSourceImage, 1);
});
