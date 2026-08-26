/**
 * Historical retailer repair: the safety invariants, proved against the store
 * port rather than the implementation. A projection repair is not a material
 * recall change, and everything below exists to keep it that way.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectCase } from '../domain/projection';
import type { CaseProjection, Geography, TimelineEntry } from '../domain/recall-types';
import { backfillRetailerNames, planCaseRetailers } from './retailer-backfill';
import { MemoryStore } from './store/memory-store';
import type { RecallCaseRow } from './store/types';

const GEO: Geography = { scope: 'unknown', states: [], confidence: 'stated', sourceText: null };

const TIMELINE: TimelineEntry[] = [
  {
    occurredAt: '2026-01-05',
    kind: 'published',
    summary: 'Recall published by FSIS.',
    causedBySnapshotIds: [],
    material: false,
  },
];

function projection(overrides: Partial<CaseProjection> = {}): CaseProjection {
  return {
    sourceAgency: 'FSIS',
    noticeType: 'recall',
    state: 'active',
    closedYear: null,
    classification: {
      value: 'class_I',
      sourceText: 'High - Class I',
      officialClasses: ['class_I'],
    },
    title: 'Firm Recalls Product',
    summaryText: 'The product was shipped to Costco stores in California.',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
    recallingFirm: { displayName: 'A Firm', rawVariants: ['A Firm'] },
    brands: [],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    geography: GEO,
    affectedProducts: [],
    quantityText: null,
    illnessStatement: null,
    reportsIllness: false,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://example.gov/001-2026',
    otherOfficialUrls: [],
    sourceIdentifiers: [{ system: 'fsis_api', id: '001-2026' }],
    publishedAt: '2026-01-05',
    lastPublicActivityAt: '2026-01-05',
    ...overrides,
  };
}

async function storeWith(...projections: CaseProjection[]): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const value of projections) {
    await store.insertCase({
      projection: value,
      timeline: TIMELINE,
      createdAt: '2026-01-05T00:00:00.000Z',
      lastChangedAt: '2026-01-06T00:00:00.000Z',
    });
  }
  return store;
}

const only = (store: MemoryStore): RecallCaseRow => [...store.cases.values()][0];

test('a dry run writes nothing but reports exactly what an apply would do', async () => {
  const store = await storeWith(projection());
  const before = structuredClone(only(store));

  const report = await backfillRetailerNames(store, { apply: false });

  assert.equal(report.wouldUpdate, 1);
  assert.equal(report.caseWrites, 0);
  assert.deepEqual(only(store), before, 'the dry run must not mutate the store');
});

test('an apply writes the retailer names and nothing else', async () => {
  const store = await storeWith(projection());
  const before = structuredClone(only(store));

  const report = await backfillRetailerNames(store, { apply: true });

  assert.equal(report.caseWrites, 1);
  const after = only(store);
  assert.deepEqual(after.projection.retailerNames, ['Costco']);
  // Every other projection field is byte-identical.
  assert.deepEqual(
    { ...after.projection, retailerNames: [] },
    { ...before.projection, retailerNames: [] },
  );
});

test('identity, lineage, dates and material timestamps are untouched by a repair', async () => {
  const store = await storeWith(projection());
  const before = structuredClone(only(store));

  await backfillRetailerNames(store, { apply: true });

  const after = only(store);
  assert.equal(after.id, before.id, 'case identity');
  assert.deepEqual(after.projection.sourceIdentifiers, before.projection.sourceIdentifiers);
  assert.equal(after.projection.publishedAt, before.projection.publishedAt);
  assert.equal(after.projection.lastPublicActivityAt, before.projection.lastPublicActivityAt);
  assert.deepEqual(after.projection.classification, before.projection.classification);
  assert.deepEqual(after.projection.geography, before.projection.geography);
  assert.deepEqual(after.projection.affectedProducts, before.projection.affectedProducts);
  assert.equal(after.projection.heroImageUrl, before.projection.heroImageUrl);
  // Repair bookkeeping: a maintenance pass is not public activity.
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.lastChangedAt, before.lastChangedAt, 'lastChangedAt must not move');
  assert.deepEqual(after.timeline, before.timeline, 'no timeline entry is appended');
});

test('a repair creates no RecallCase and no NotificationEvent', async () => {
  const store = await storeWith(projection(), projection({ summaryText: 'No retailer named.' }));

  const report = await backfillRetailerNames(store, { apply: true });

  assert.equal(store.cases.size, 2, 'no case is created, merged, or split');
  assert.equal(store.notifications.size, 0, 'no notification event is ever written');
  assert.equal(report.newCases, 0);
  assert.equal(report.notificationEvents, 0);
});

test('re-running after an apply is a no-op — the operation is idempotent', async () => {
  const store = await storeWith(projection());

  const first = await backfillRetailerNames(store, { apply: true });
  assert.equal(first.caseWrites, 1);
  const afterFirst = structuredClone(only(store));

  const second = await backfillRetailerNames(store, { apply: true });
  assert.equal(second.wouldUpdate, 0, 'nothing left to update');
  assert.equal(second.caseWrites, 0);
  assert.equal(second.unchanged, 1);
  assert.deepEqual(only(store), afterFirst, 'a second apply changes nothing');

  // And the dry run is the verification report: zero remaining writes.
  const verify = await backfillRetailerNames(store, { apply: false });
  assert.equal(verify.wouldUpdate, 0);
});

test('a case whose source names no retailer is left alone', async () => {
  const store = await storeWith(
    projection({ summaryText: 'Products were sold only in the state of Texas at retail level.' }),
  );
  const before = structuredClone(only(store));

  const report = await backfillRetailerNames(store, { apply: true });

  assert.equal(report.noEvidence, 1);
  assert.equal(report.caseWrites, 0);
  assert.deepEqual(only(store), before);
});

test('valid stored evidence is never erased by a derivation that finds nothing', async () => {
  const store = await storeWith(
    projection({ retailerNames: ['Publix'], summaryText: 'No retailer is named here.' }),
  );

  const report = await backfillRetailerNames(store, { apply: true });

  assert.equal(report.caseWrites, 0);
  assert.deepEqual(only(store).projection.retailerNames, ['Publix']);
  assert.equal(report.unchanged, 1);
});

test('stored evidence the contract rejects is reported as a conflict, and the case is untouched', async () => {
  const store = await storeWith(
    projection({
      retailerNames: ['Mexico'],
      summaryText: 'The product was shipped to Costco stores in California.',
    }),
  );
  const before = structuredClone(only(store));

  const report = await backfillRetailerNames(store, { apply: true });

  assert.equal(report.conflicts.length, 1);
  assert.deepEqual(report.conflicts[0].rejectedCarried, ['Mexico']);
  assert.equal(report.caseWrites, 0, 'a conflict is reviewed by a human, never overwritten');
  assert.deepEqual(only(store), before);
});

test('the report separates active from inactive and FDA from FSIS', async () => {
  const store = await storeWith(
    projection({ state: 'active', sourceAgency: 'FSIS' }),
    projection({ state: 'closed', sourceAgency: 'FDA' }),
    projection({ state: 'active', sourceAgency: 'FDA', summaryText: 'No retailer named.' }),
  );

  const report = await backfillRetailerNames(store, { apply: false });

  assert.equal(report.casesExamined, 3);
  assert.equal(report.active, 2);
  assert.equal(report.inactive, 1);
  assert.equal(report.fda, 2);
  assert.equal(report.fsis, 1);
  assert.equal(report.wouldUpdate, 2);
  assert.equal(report.activeGainingRetailers, 1);
});

test('the plan is pure: it reaches no network and no store', () => {
  // planCaseRetailers is synchronous by construction — it cannot await a
  // fetch or a query, which is what makes "network requests: 0" structural
  // rather than a promise in a comment.
  const plan = planCaseRetailers({
    id: 'case-1',
    projection: projection(),
    timeline: TIMELINE,
    createdAt: '2026-01-05T00:00:00.000Z',
    lastChangedAt: '2026-01-06T00:00:00.000Z',
  });
  assert.equal(plan.outcome, 'update');
  assert.deepEqual(plan.next, ['Costco']);
  assert.equal(plan.active, true);
});

test('the backfill reports zero network requests because it performs none', async () => {
  const store = await storeWith(projection());
  const report = await backfillRetailerNames(store, { apply: false });
  assert.equal(report.networkRequests, 0);
});

test('the repair and normal projection run the SAME derivation, not two parsers', async () => {
  const summaryText =
    'The products were shipped to Kroger and Fred Meyer retail stores in Oregon, and sold at Costco Wholesale locations.';
  // What normal ingestion would persist for this text.
  const projected = projectCase([
    {
      sourceSystem: 'fsis_api',
      sourceAgency: 'FSIS',
      nativeId: '001-2026',
      rawNativeId: '001-2026',
      noticeType: 'recall',
      lifecycle: 'active',
      closedYear: null,
      classification: { value: 'class_I', sourceText: null },
      expansionOfNativeId: null,
      isRetractionNotice: false,
      retractsNativeIds: [],
      title: 'Firm Recalls Product',
      summaryText,
      summaryHtml: null,
      reasonText: null,
      hazardCategory: 'unknown',
      pathogenOrAllergen: null,
      firmDisplayName: 'A Firm',
      firmRawVariants: ['A Firm'],
      geography: GEO,
      productLines: [],
      quantityText: null,
      illnessStatement: null,
      consumerAction: null,
      contactText: null,
      officialUrl: 'https://example.gov/001-2026',
      publishedAt: '2026-01-05',
      lastModifiedAt: null,
    },
  ]);
  // What the historical repair would write for the same text.
  const store = await storeWith(projection({ summaryText }));
  await backfillRetailerNames(store, { apply: true });

  assert.deepEqual(only(store).projection.retailerNames, projected.retailerNames);
  assert.ok(projected.retailerNames.length > 0, 'the fixture must actually carry evidence');
});

// ── Concurrency with live scheduled ingestion ───────────────────────────────
//
// The FDA and FSIS jobs tick every 30 minutes; a repair over ~1,900 cases
// takes minutes. So the interleave below is not hypothetical, and the
// single-threaded tests above cannot see it: the repair reads every case up
// front, and a plain updateCase would write the whole row back from that
// stale copy — rolling back the projection, the timeline, and
// last_changed_at together.

/** What a scheduled ingest does to a case it re-projects (pipeline.ts). */
function simulateIngest(store: MemoryStore, id: string): RecallCaseRow {
  const row = store.cases.get(id)!;
  row.projection = {
    ...row.projection,
    // A material change: the agency widened the affected area.
    geography: {
      scope: 'states',
      states: ['California', 'Nevada'],
      confidence: 'stated',
      sourceText: 'CA and NV',
    },
    title: 'Firm Expands Recall of Product',
    lastPublicActivityAt: '2026-02-01',
  };
  row.timeline = [
    ...row.timeline,
    {
      occurredAt: '2026-02-01',
      kind: 'expanded',
      summary: 'Affected area widened (California, Nevada).',
      causedBySnapshotIds: ['snap-2'],
      material: true,
      ruleId: 'expansion_geography',
    },
  ];
  row.lastChangedAt = '2026-02-01T00:00:00.000Z';
  return row;
}

/**
 * A store that lets an ingest land in the window between the repair's read
 * and its write — the exact interleave a lease-free backfill must survive.
 */
class IngestDuringWriteStore extends MemoryStore {
  ingested: string[] = [];

  override async updateCaseRetailerNames(
    id: string,
    retailerNames: string[],
    expectedLastChangedAt: string,
  ): Promise<boolean> {
    if (!this.ingested.includes(id)) {
      this.ingested.push(id);
      simulateIngest(this, id);
    }
    return super.updateCaseRetailerNames(id, retailerNames, expectedLastChangedAt);
  }
}

test('an ingest landing mid-run is never rolled back by the repair', async () => {
  const store = new MemoryStore();
  await store.insertCase({
    projection: projection(),
    timeline: TIMELINE,
    createdAt: '2026-01-05T00:00:00.000Z',
    lastChangedAt: '2026-01-06T00:00:00.000Z',
  });
  const id = only(store).id;

  // 1. The repair reads every case up front.
  const stale = structuredClone(only(store));
  // 2. Scheduled ingestion materially updates the same case.
  simulateIngest(store, id);
  const afterIngest = structuredClone(only(store));

  // 3. The repair now tries to write what it planned from the stale read.
  const wrote = await store.updateCaseRetailerNames(id, ['Costco'], stale.lastChangedAt);

  // 4. The write is refused, and every ingest change survives intact.
  assert.equal(wrote, false, 'a stale-version write must not be applied');
  const after = only(store);
  assert.deepEqual(after.projection.geography, afterIngest.projection.geography);
  assert.equal(after.projection.title, afterIngest.projection.title);
  assert.deepEqual(after.timeline, afterIngest.timeline, 'the material timeline entry survives');
  assert.equal(after.lastChangedAt, '2026-02-01T00:00:00.000Z', 'last_changed_at is not rewound');
  assert.deepEqual(after.projection.retailerNames, [], 'nothing was patched');
});

test('a full run interleaved with ingestion keeps the newer data and re-derives from it', async () => {
  const store = new IngestDuringWriteStore();
  await store.insertCase({
    projection: projection(),
    timeline: TIMELINE,
    createdAt: '2026-01-05T00:00:00.000Z',
    lastChangedAt: '2026-01-06T00:00:00.000Z',
  });

  const report = await backfillRetailerNames(store, { apply: true });

  const after = only(store);
  // The ingest's changes stand.
  assert.equal(after.projection.title, 'Firm Expands Recall of Product');
  assert.deepEqual(after.projection.geography.states, ['California', 'Nevada']);
  assert.equal(after.lastChangedAt, '2026-02-01T00:00:00.000Z');
  assert.equal(after.timeline.length, 2, 'the material timeline entry survives');
  // The retry re-derived from the NEWER projection and patched only the names.
  assert.equal(report.caseWrites, 1);
  assert.deepEqual(after.projection.retailerNames, ['Costco']);
  // And no case or notification was created along the way.
  assert.equal(store.cases.size, 1);
  assert.equal(store.notifications.size, 0);
  assert.equal(report.newCases, 0);
  assert.equal(report.notificationEvents, 0);
});

test('a case that keeps moving is surfaced as concurrently modified, not overwritten', async () => {
  // Ingest lands before EVERY write attempt, so the retry cannot win either.
  class AlwaysMovingStore extends MemoryStore {
    private tick = 0;
    override async updateCaseRetailerNames(
      id: string,
      retailerNames: string[],
      expectedLastChangedAt: string,
    ): Promise<boolean> {
      this.tick += 1;
      const row = this.cases.get(id)!;
      row.lastChangedAt = `2026-03-0${this.tick}T00:00:00.000Z`;
      return super.updateCaseRetailerNames(id, retailerNames, expectedLastChangedAt);
    }
  }
  const store = new AlwaysMovingStore();
  await store.insertCase({
    projection: projection(),
    timeline: TIMELINE,
    createdAt: '2026-01-05T00:00:00.000Z',
    lastChangedAt: '2026-01-06T00:00:00.000Z',
  });

  const report = await backfillRetailerNames(store, { apply: true });

  assert.equal(report.caseWrites, 0, 'nothing is written while the row keeps moving');
  assert.deepEqual(report.concurrentlyModified, [only(store).id], 'the case is surfaced');
  assert.deepEqual(only(store).projection.retailerNames, [], 'the case is left alone');
  assert.equal(report.failures.length, 0);
  assert.equal(store.notifications.size, 0);
});

test('a rerun after a concurrent skip enriches the case from its latest state', async () => {
  const store = new MemoryStore();
  await store.insertCase({
    projection: projection(),
    timeline: TIMELINE,
    createdAt: '2026-01-05T00:00:00.000Z',
    lastChangedAt: '2026-01-06T00:00:00.000Z',
  });
  const id = only(store).id;
  // The case moved and was skipped; now it is quiet again.
  simulateIngest(store, id);

  const rerun = await backfillRetailerNames(store, { apply: true });

  assert.equal(rerun.caseWrites, 1);
  assert.deepEqual(rerun.concurrentlyModified, []);
  assert.deepEqual(only(store).projection.retailerNames, ['Costco']);
  // Still built on the newer projection, which is untouched apart from names.
  assert.equal(only(store).projection.title, 'Firm Expands Recall of Product');
  assert.equal(only(store).lastChangedAt, '2026-02-01T00:00:00.000Z');

  // And a third run is a no-op — idempotency survives the concurrency guard.
  const third = await backfillRetailerNames(store, { apply: true });
  assert.equal(third.caseWrites, 0);
  assert.equal(third.wouldUpdate, 0);
  assert.equal(third.unchanged, 1);
});

test('the guarded write patches ONLY retailerNames, leaving every sibling field', async () => {
  const store = await storeWith(projection({ heroImageUrl: 'https://example.gov/photo.jpg' }));
  const before = structuredClone(only(store));

  const applied = await store.updateCaseRetailerNames(before.id, ['Costco'], before.lastChangedAt);

  assert.equal(applied, true);
  const after = only(store);
  assert.deepEqual(
    { ...after.projection, retailerNames: [] },
    { ...before.projection, retailerNames: [] },
    'no sibling projection field moved',
  );
  assert.deepEqual(after.timeline, before.timeline);
  assert.equal(after.lastChangedAt, before.lastChangedAt);
  assert.equal(after.createdAt, before.createdAt);
});
