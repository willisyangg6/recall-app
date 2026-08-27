/**
 * Historical geography repair: the safety invariants, proved against the store
 * port rather than the implementation. A projection repair is not a material
 * recall change, and everything below exists to keep it that way.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectCase } from '../domain/projection';
import type { CaseProjection, Geography, TimelineEntry } from '../domain/recall-types';
import { planCaseGeography, repairGeography } from './geography-repair';
import { MemoryStore } from './store/memory-store';
import type { RecallCaseRow } from './store/types';

const UNKNOWN: Geography = { scope: 'unknown', states: [], confidence: 'stated', sourceText: null };

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
    summaryText: 'These items were shipped to retail locations in Ohio and Indiana.',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'undeclared milk',
    recallingFirm: { displayName: 'A Firm', rawVariants: ['A Firm'] },
    brands: [],
    productDescription: null,
    retailerNames: ['Costco'],
    heroImageUrl: 'https://www.fda.gov/photo.jpg',
    geography: UNKNOWN,
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

  const report = await repairGeography(store, { apply: false });

  assert.equal(report.wouldUpdate, 1);
  assert.equal(report.caseWrites, 0);
  assert.deepEqual(only(store), before, 'the dry run must not mutate the store');
});

test('an apply writes the geography and nothing else', async () => {
  const store = await storeWith(projection());
  const before = structuredClone(only(store));

  const report = await repairGeography(store, { apply: true });

  assert.equal(report.caseWrites, 1);
  const after = only(store);
  assert.deepEqual(after.projection.geography.states, ['Indiana', 'Ohio']);
  // Every other projection field is byte-identical.
  assert.deepEqual(
    { ...after.projection, geography: UNKNOWN },
    { ...before.projection, geography: UNKNOWN },
  );
});

test('identity, lineage, dates and material timestamps are untouched by a repair', async () => {
  const store = await storeWith(projection());
  const before = structuredClone(only(store));

  await repairGeography(store, { apply: true });

  const after = only(store);
  assert.equal(after.id, before.id, 'case identity');
  assert.deepEqual(after.projection.sourceIdentifiers, before.projection.sourceIdentifiers);
  assert.equal(after.projection.title, before.projection.title);
  assert.equal(after.projection.publishedAt, before.projection.publishedAt);
  assert.equal(after.projection.lastPublicActivityAt, before.projection.lastPublicActivityAt);
  assert.deepEqual(after.projection.classification, before.projection.classification);
  assert.deepEqual(after.projection.retailerNames, before.projection.retailerNames);
  assert.equal(after.projection.pathogenOrAllergen, before.projection.pathogenOrAllergen);
  assert.equal(after.projection.heroImageUrl, before.projection.heroImageUrl);
  assert.deepEqual(after.projection.affectedProducts, before.projection.affectedProducts);
  // Repair bookkeeping: a maintenance pass is not public activity.
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.lastChangedAt, before.lastChangedAt, 'lastChangedAt must not move');
  assert.deepEqual(after.timeline, before.timeline, 'no timeline entry is appended');
});

test('a repair creates no RecallCase and no NotificationEvent', async () => {
  const store = await storeWith(
    projection(),
    projection({ summaryText: 'The problem was found during a label review.' }),
  );

  const report = await repairGeography(store, { apply: true });

  assert.equal(store.cases.size, 2, 'no case is created, merged, or split');
  assert.equal(store.notifications.size, 0, 'no notification event is ever written');
  assert.equal(report.newCases, 0);
  assert.equal(report.notificationEvents, 0);
});

test('a geography WIDENING is repaired without announcing an expansion', async () => {
  // detectChanges would call this `expansion_geography` and notify. The repair
  // does not go through that path at all, which is the whole point: finding
  // evidence an older parser could not read is not the agency saying the
  // recall grew.
  const store = await storeWith(
    projection({
      geography: { scope: 'states', states: ['Ohio'], confidence: 'stated', sourceText: 'Ohio' },
    }),
  );

  await repairGeography(store, { apply: true });

  assert.deepEqual(only(store).projection.geography.states, ['Indiana', 'Ohio']);
  assert.equal(store.notifications.size, 0);
  assert.deepEqual(only(store).timeline, TIMELINE);
  assert.equal(only(store).lastChangedAt, '2026-01-06T00:00:00.000Z');
});

test('re-running after an apply is a no-op — the operation is idempotent', async () => {
  const store = await storeWith(projection());
  await repairGeography(store, { apply: true });
  const settled = structuredClone(only(store));

  const second = await repairGeography(store, { apply: true });

  assert.equal(second.wouldUpdate, 0);
  assert.equal(second.caseWrites, 0);
  assert.deepEqual(only(store), settled);
});

test('a case with no distribution evidence stays honestly unknown', async () => {
  const store = await storeWith(
    projection({ summaryText: 'The problem was found during a routine label review.' }),
  );

  const report = await repairGeography(store, { apply: true });

  assert.equal(report.noEvidence, 1);
  assert.equal(report.caseWrites, 0);
  assert.equal(only(store).projection.geography.scope, 'unknown');
});

test('nationwide is never narrowed, and a stated state is never dropped', async () => {
  const store = await storeWith(
    projection({
      geography: {
        scope: 'nationwide',
        states: [],
        confidence: 'stated',
        sourceText: 'Nationwide',
      },
    }),
  );

  const report = await repairGeography(store, { apply: true });

  assert.equal(report.caseWrites, 0);
  assert.equal(only(store).projection.geography.scope, 'nationwide');
  assert.equal(report.conflicts.length, 0);
});

test('no stored state is ever dropped, whatever shape the stored geography is in', async () => {
  // The planner carries a second, independent guard on top of the
  // derivation's own widening rule: any state that would disappear for a
  // reason other than a proven containment artifact turns the case into a
  // reported conflict and leaves it untouched. This asserts the invariant
  // across the stored shapes that reach it, including contradictory rows.
  const stored: Geography[] = [
    { scope: 'states', states: ['Ohio', 'Texas'], confidence: 'stated', sourceText: 'OH, TX' },
    { scope: 'states', states: ['Alaska'], confidence: 'inferred', sourceText: null },
    { scope: 'nationwide', states: [], confidence: 'stated', sourceText: 'Nationwide' },
    // A corrupt row: scope and list disagree.
    { scope: 'unknown', states: ['Hawaii'], confidence: 'stated', sourceText: null },
  ];
  for (const geography of stored) {
    const plan = planCaseGeography({
      id: 'x',
      projection: projection({ geography }),
      timeline: TIMELINE,
      createdAt: '2026-01-05T00:00:00.000Z',
      lastChangedAt: '2026-01-06T00:00:00.000Z',
    });
    const kept = plan.outcome === 'conflict' ? plan.current : plan.next;
    for (const state of geography.states) {
      assert.ok(kept.states.includes(state), `${state} survived (${geography.scope})`);
    }
    assert.deepEqual(plan.removedStates, [], JSON.stringify(geography));
    // And the result can never contradict itself.
    assert.equal(kept.scope === 'states', kept.states.length > 0, JSON.stringify(kept));
  }
});

test('the plan is pure: it reaches no network and no store', async () => {
  const row: RecallCaseRow = {
    id: 'case-1',
    projection: projection(),
    timeline: TIMELINE,
    createdAt: '2026-01-05T00:00:00.000Z',
    lastChangedAt: '2026-01-06T00:00:00.000Z',
  };
  const first = planCaseGeography(row);
  const second = planCaseGeography(structuredClone(row));
  assert.deepEqual(first, second);
  assert.equal(first.outcome, 'update');
});

test('the repair reports zero network requests because it performs none', async () => {
  const store = await storeWith(projection());
  const report = await repairGeography(store, { apply: true });
  assert.equal(report.networkRequests, 0);
});

test('the repair and normal projection run the SAME derivation, not two parsers', async () => {
  const record = {
    sourceSystem: 'fsis_api' as const,
    sourceAgency: 'FSIS' as const,
    nativeId: '001-2026',
    rawNativeId: '001-2026',
    noticeType: 'recall' as const,
    lifecycle: 'active' as const,
    closedYear: null,
    classification: { value: 'class_I' as const, sourceText: 'High - Class I' },
    expansionOfNativeId: null,
    isRetractionNotice: false,
    retractsNativeIds: [],
    title: 'Firm Recalls Product',
    summaryText: 'These items were shipped to retail locations in Ohio and Indiana.',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen' as const,
    pathogenOrAllergen: 'undeclared milk',
    firmDisplayName: 'A Firm',
    firmRawVariants: ['A Firm'],
    geography: UNKNOWN,
    productLines: [],
    quantityText: null,
    illnessStatement: null,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://example.gov/001-2026',
    publishedAt: '2026-01-05',
    lastModifiedAt: null,
  };
  const projected = projectCase([record]);

  const store = await storeWith(projection());
  await repairGeography(store, { apply: true });

  assert.deepEqual(
    only(store).projection.geography.states,
    projected.geography.states,
    'a repaired case holds what a full re-projection would have produced',
  );
});

// ── Concurrency with live ingestion ─────────────────────────────────────────

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
    summaryText: 'These items were shipped to retail locations in California and Nevada.',
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

test('an ingest landing mid-run is never rolled back by the repair', async () => {
  const store = await storeWith(projection());
  const id = only(store).id;

  // 1. The repair reads every case up front.
  const stale = structuredClone(only(store));
  // 2. Scheduled ingestion materially updates the same case.
  simulateIngest(store, id);
  const afterIngest = structuredClone(only(store));

  // 3. The repair now tries to write what it planned from the stale read.
  const wrote = await store.updateCaseGeography(
    id,
    { scope: 'states', states: ['Indiana', 'Ohio'], confidence: 'inferred', sourceText: null },
    stale.lastChangedAt,
  );

  // 4. The write is refused, and every ingest change survives intact.
  assert.equal(wrote, false, 'a stale-version write must not be applied');
  const after = only(store);
  assert.deepEqual(after.projection.geography, afterIngest.projection.geography);
  assert.equal(after.projection.title, afterIngest.projection.title);
  assert.deepEqual(after.timeline, afterIngest.timeline, 'the material timeline entry survives');
  assert.equal(after.lastChangedAt, '2026-02-01T00:00:00.000Z', 'last_changed_at is not rewound');
});

test('a full run interleaved with ingestion keeps the newer data and re-derives from it', async () => {
  class IngestDuringWriteStore extends MemoryStore {
    ingested: string[] = [];
    override async updateCaseGeography(
      id: string,
      geography: Geography,
      expectedLastChangedAt: string,
    ): Promise<boolean> {
      if (!this.ingested.includes(id)) {
        this.ingested.push(id);
        simulateIngest(this, id);
      }
      return super.updateCaseGeography(id, geography, expectedLastChangedAt);
    }
  }
  const store = new IngestDuringWriteStore();
  await store.insertCase({
    projection: projection(),
    timeline: TIMELINE,
    createdAt: '2026-01-05T00:00:00.000Z',
    lastChangedAt: '2026-01-06T00:00:00.000Z',
  });

  await repairGeography(store, { apply: true });

  const after = only(store);
  // The ingest's changes stand.
  assert.equal(after.projection.title, 'Firm Expands Recall of Product');
  assert.equal(after.lastChangedAt, '2026-02-01T00:00:00.000Z');
  assert.equal(after.timeline.length, 2, 'the material timeline entry survives');
  // The retry re-derived from the NEWER text — never the stale plan.
  assert.deepEqual(after.projection.geography.states, ['California', 'Nevada']);
  assert.equal(store.cases.size, 1);
  assert.equal(store.notifications.size, 0);
});

test('a case that keeps moving is surfaced as concurrently modified, not overwritten', async () => {
  // Ingest lands before EVERY write attempt, so the retry cannot win either.
  class AlwaysMovingStore extends MemoryStore {
    private tick = 0;
    override async updateCaseGeography(
      id: string,
      geography: Geography,
      expectedLastChangedAt: string,
    ): Promise<boolean> {
      this.tick += 1;
      this.cases.get(id)!.lastChangedAt = `2026-03-0${this.tick}T00:00:00.000Z`;
      return super.updateCaseGeography(id, geography, expectedLastChangedAt);
    }
  }
  const store = new AlwaysMovingStore();
  await store.insertCase({
    projection: projection(),
    timeline: TIMELINE,
    createdAt: '2026-01-05T00:00:00.000Z',
    lastChangedAt: '2026-01-06T00:00:00.000Z',
  });

  const report = await repairGeography(store, { apply: true });

  assert.equal(report.caseWrites, 0, 'nothing is written while the row keeps moving');
  assert.deepEqual(report.concurrentlyModified, [only(store).id], 'the case is surfaced');
  assert.equal(only(store).projection.geography.scope, 'unknown', 'the case is left alone');
  assert.equal(report.failures.length, 0);
  assert.equal(store.notifications.size, 0);
});

test('a rerun after a concurrent skip repairs the case from its latest state', async () => {
  class SkipOnceStore extends MemoryStore {
    skipped = false;
    override async updateCaseGeography(
      id: string,
      geography: Geography,
      expectedLastChangedAt: string,
    ): Promise<boolean> {
      if (!this.skipped) {
        this.skipped = true;
        return false;
      }
      return super.updateCaseGeography(id, geography, expectedLastChangedAt);
    }
  }
  const store = new SkipOnceStore();
  await store.insertCase({
    projection: projection(),
    timeline: TIMELINE,
    createdAt: '2026-01-05T00:00:00.000Z',
    lastChangedAt: '2026-01-06T00:00:00.000Z',
  });

  // First attempt is refused; the retry (against unchanged data) succeeds.
  const report = await repairGeography(store, { apply: true });
  assert.equal(report.caseWrites, 1);
  assert.deepEqual(only(store).projection.geography.states, ['Indiana', 'Ohio']);
});

test('the guarded write patches ONLY geography, leaving every sibling field', async () => {
  const store = await storeWith(projection());
  const row = only(store);
  const before = structuredClone(row);

  const wrote = await store.updateCaseGeography(
    row.id,
    { scope: 'nationwide', states: [], confidence: 'stated', sourceText: 'Nationwide' },
    row.lastChangedAt,
  );

  assert.equal(wrote, true);
  const after = only(store);
  assert.equal(after.projection.geography.scope, 'nationwide');
  assert.deepEqual(
    { ...after.projection, geography: null },
    { ...before.projection, geography: null },
  );
  assert.equal(after.lastChangedAt, before.lastChangedAt);
  assert.deepEqual(after.timeline, before.timeline);
});
