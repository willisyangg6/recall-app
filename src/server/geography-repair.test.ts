/**
 * Historical geography repair: the safety invariants, proved against the store
 * port rather than the implementation. A projection repair is not a material
 * recall change, and everything below exists to keep it that way.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { projectCase } from '../domain/projection';
import type { CaseProjection, Geography, TimelineEntry } from '../domain/recall-types';
import {
  planCaseGeography,
  repairGeography,
  resolveGeographyRepairMode,
  rollbackGeography,
} from './geography-repair';
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

  const report = await repairGeography(store, { apply: false, expectedUpdates: null });

  assert.equal(report.wouldUpdate, 1);
  assert.equal(report.caseWrites, 0);
  assert.deepEqual(only(store), before, 'the dry run must not mutate the store');
});

test('an apply writes the geography and nothing else', async () => {
  const store = await storeWith(projection());
  const before = structuredClone(only(store));

  const report = await repairGeography(store, { apply: true, expectedUpdates: 1 });

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

  await repairGeography(store, { apply: true, expectedUpdates: 1 });

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

  const report = await repairGeography(store, { apply: true, expectedUpdates: 1 });

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

  await repairGeography(store, { apply: true, expectedUpdates: 1 });

  assert.deepEqual(only(store).projection.geography.states, ['Indiana', 'Ohio']);
  assert.equal(store.notifications.size, 0);
  assert.deepEqual(only(store).timeline, TIMELINE);
  assert.equal(only(store).lastChangedAt, '2026-01-06T00:00:00.000Z');
});

test('re-running after an apply is a no-op — the operation is idempotent', async () => {
  const store = await storeWith(projection());
  await repairGeography(store, { apply: true, expectedUpdates: 1 });
  const settled = structuredClone(only(store));

  const second = await repairGeography(store, { apply: true, expectedUpdates: 1 });

  assert.equal(second.wouldUpdate, 0);
  assert.equal(second.caseWrites, 0);
  assert.deepEqual(only(store), settled);
});

test('a case with no distribution evidence stays honestly unknown', async () => {
  const store = await storeWith(
    projection({ summaryText: 'The problem was found during a routine label review.' }),
  );

  const report = await repairGeography(store, { apply: true, expectedUpdates: 1 });

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

  const report = await repairGeography(store, { apply: true, expectedUpdates: 1 });

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
  const report = await repairGeography(store, { apply: true, expectedUpdates: 1 });
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
  await repairGeography(store, { apply: true, expectedUpdates: 1 });

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

  await repairGeography(store, { apply: true, expectedUpdates: 1 });

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

  const report = await repairGeography(store, { apply: true, expectedUpdates: 1 });

  assert.equal(report.caseWrites, 0, 'nothing is written while the row keeps moving');
  assert.deepEqual(report.concurrentlyModified, [only(store).id], 'the case is surfaced');
  assert.equal(only(store).projection.geography.scope, 'unknown', 'the case is left alone');
  assert.equal(report.failures.length, 0);
  assert.equal(store.notifications.size, 0);
});

test('a write the row refuses is reported, never re-derived and retried (P2B7Q.2)', async () => {
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

  // The apply writes ONLY what the reviewed dry run proposed. Re-deriving a
  // refused case mid-run and writing the new answer would put a value into
  // production that no operator reviewed and that the authorized count does
  // not describe — so the case is reported and left for the next run instead.
  const report = await repairGeography(store, { apply: true, expectedUpdates: 1 });
  assert.equal(report.caseWrites, 0);
  assert.deepEqual(report.concurrentlyModified, [only(store).id]);
  assert.equal(only(store).projection.geography.scope, 'unknown', 'the case is left alone');
  assert.deepEqual(report.rollback, [], 'nothing written means nothing to roll back');
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

// ── P2B7Q.2: the authorization guards, the ledger, and the rollback ─────────

test('the CLI contract: a dry run needs nothing, an apply needs all three flags', () => {
  assert.deepEqual(resolveGeographyRepairMode([]), {
    apply: false,
    expectedUpdates: null,
    error: null,
  });
  // Intent alone is not authorization.
  assert.match(resolveGeographyRepairMode(['--apply']).error ?? '', /--confirm/);
  assert.equal(resolveGeographyRepairMode(['--apply']).apply, false);
  // Nor is intent plus acknowledgment, without the reviewed count.
  assert.match(resolveGeographyRepairMode(['--apply', '--confirm']).error ?? '', /--expect <n>/);
  // A contradiction is refused, not resolved in either direction.
  assert.match(
    resolveGeographyRepairMode(['--apply', '--confirm', '--dry-run', '--expect', '3']).error ?? '',
    /contradict/,
  );
  // Malformed counts are refused, every shape of them.
  for (const bad of ['1.5', '-2', 'three', '0x3', '', ' ']) {
    const mode = resolveGeographyRepairMode(['--apply', '--confirm', '--expect', bad]);
    assert.equal(mode.apply, false, `--expect ${JSON.stringify(bad)} must be refused`);
    assert.ok(mode.error, `--expect ${JSON.stringify(bad)} must explain itself`);
  }
  // A missing value is not silently read as the next flag.
  assert.match(
    resolveGeographyRepairMode(['--apply', '--confirm', '--expect', '--json']).error ?? '',
    /--expect requires/,
  );
  // All three, with a well-formed count: authorized.
  assert.deepEqual(resolveGeographyRepairMode(['--apply', '--confirm', '--expect', '0']), {
    apply: true,
    expectedUpdates: 0,
    error: null,
  });
});

test('an apply with no authorized count writes nothing at all', async () => {
  const store = await storeWith(projection());
  const before = structuredClone(only(store));
  const report = await repairGeography(store, { apply: true, expectedUpdates: null });
  assert.ok(report.aborted);
  assert.match(report.aborted!.reason, /authorized correction count/);
  assert.equal(report.caseWrites, 0);
  assert.deepEqual(only(store), before);
});

test('a count that no longer matches the corpus aborts the WHOLE run, not a suffix', async () => {
  // Two correctable cases; the operator authorized one.
  const store = await storeWith(
    projection(),
    projection({
      summaryText: 'The product was distributed to retail stores in Maine and Vermont.',
      officialUrl: 'https://example.gov/002-2026',
      sourceIdentifiers: [{ system: 'fsis_api', id: '002-2026' }],
    }),
  );
  const before = [...store.cases.values()].map((row) => structuredClone(row));

  const report = await repairGeography(store, { apply: true, expectedUpdates: 1 });

  assert.ok(report.aborted);
  assert.equal(report.aborted!.expected, 1);
  assert.equal(report.aborted!.actual, 2);
  assert.equal(report.caseWrites, 0, 'a drifted corpus writes nothing, not a prefix');
  assert.deepEqual([...store.cases.values()], before);
});

test('the whole corpus is planned before the first write is constructed', async () => {
  const order: string[] = [];
  class TracingStore extends MemoryStore {
    override async listCases() {
      order.push('list');
      return super.listCases();
    }
    override async updateCaseGeography(
      id: string,
      geography: Geography,
      expectedLastChangedAt: string,
    ): Promise<boolean> {
      order.push(`write:${id}`);
      return super.updateCaseGeography(id, geography, expectedLastChangedAt);
    }
  }
  const store = new TracingStore();
  for (const value of [projection(), projection({ officialUrl: 'https://example.gov/002-2026' })]) {
    await store.insertCase({
      projection: value,
      timeline: TIMELINE,
      createdAt: '2026-01-05T00:00:00.000Z',
      lastChangedAt: '2026-01-06T00:00:00.000Z',
    });
  }

  const report = await repairGeography(store, { apply: true, expectedUpdates: 2 });

  assert.equal(report.caseWrites, 2);
  // One listing, then writes — never a write interleaved with planning.
  assert.equal(order[0], 'list');
  assert.deepEqual(
    order.slice(1).map((step) => step.split(':')[0]),
    ['write', 'write'],
  );
});

test('every write is re-read from live state and the ledger records the restore data', async () => {
  const store = await storeWith(projection());
  const row = only(store);
  const before = structuredClone(row.projection.geography);

  const report = await repairGeography(store, { apply: true, expectedUpdates: 1 });

  assert.equal(report.caseWrites, 1);
  assert.equal(report.verifiedWrites, 1, 'the write is confirmed by re-reading the row');
  assert.deepEqual(report.verificationFailures, []);
  assert.equal(report.rollback.length, 1);
  assert.equal(report.rollback[0].recallCaseId, row.id);
  assert.deepEqual(report.rollback[0].previousValue, before);
  assert.deepEqual(report.rollback[0].writtenValue.states, ['Indiana', 'Ohio']);
});

test('a repair writes no notification, no timeline entry and no material change', async () => {
  const store = await storeWith(projection());
  const timelineBefore = structuredClone(only(store).timeline);
  const changedAtBefore = only(store).lastChangedAt;

  const report = await repairGeography(store, { apply: true, expectedUpdates: 1 });

  assert.equal(report.notificationEvents, 0);
  assert.equal(report.timelineEntries, 0);
  assert.equal(report.materialChanges, 0);
  assert.equal(report.newCases, 0);
  assert.equal(report.networkRequests, 0);
  assert.equal(store.notifications.size, 0);
  assert.deepEqual(only(store).timeline, timelineBefore);
  assert.equal(only(store).lastChangedAt, changedAtBefore, 'public activity does not move');
});

test('the ledger replays backwards through the same store port', async () => {
  const store = await storeWith(projection());
  const original = structuredClone(only(store).projection.geography);

  const applied = await repairGeography(store, { apply: true, expectedUpdates: 1 });
  assert.deepEqual(only(store).projection.geography.states, ['Indiana', 'Ohio']);

  // A dry-run rollback reports what it would restore and writes nothing.
  const preview = await rollbackGeography(store, applied.rollback, {
    apply: false,
    expectedUpdates: 1,
  });
  assert.equal(preview.restored, 1);
  assert.deepEqual(only(store).projection.geography.states, ['Indiana', 'Ohio']);

  const undone = await rollbackGeography(store, applied.rollback, {
    apply: true,
    expectedUpdates: 1,
  });
  assert.equal(undone.restored, 1);
  assert.equal(undone.verified, 1);
  assert.deepEqual(only(store).projection.geography, original);
});

test('a rollback skips a row that no longer holds what the apply wrote', async () => {
  const store = await storeWith(projection());
  const applied = await repairGeography(store, { apply: true, expectedUpdates: 1 });
  const row = only(store);

  // Something else moved the row after the apply.
  await store.updateCaseGeography(
    row.id,
    { scope: 'nationwide', states: [], confidence: 'stated', sourceText: 'Nationwide' },
    row.lastChangedAt,
  );

  const undone = await rollbackGeography(store, applied.rollback, {
    apply: true,
    expectedUpdates: 1,
  });
  assert.equal(undone.restored, 0);
  assert.deepEqual(undone.skippedNotAsWritten, [row.id]);
  assert.equal(only(store).projection.geography.scope, 'nationwide', 'the newer value stands');
});

test('a rollback apply also needs an authorized entry count', async () => {
  const store = await storeWith(projection());
  const applied = await repairGeography(store, { apply: true, expectedUpdates: 1 });
  const report = await rollbackGeography(store, applied.rollback, {
    apply: true,
    expectedUpdates: null,
  });
  assert.ok(report.aborted);
  assert.equal(report.restored, 0);
  assert.deepEqual(only(store).projection.geography.states, ['Indiana', 'Ohio']);
});

test('the plan carries the evidence a reviewer needs, per case', async () => {
  const store = await storeWith(projection());
  const plan = planCaseGeography(only(store));
  assert.equal(plan.outcome, 'update');
  assert.deepEqual(plan.next.states, ['Indiana', 'Ohio']);
  assert.ok(
    plan.evidence.some((sentence) => sentence.includes('shipped to retail locations')),
    `the sentence that admitted the states is quoted: ${plan.evidence.join(' | ')}`,
  );
});

test('a state the notice rules out is removed with its reason, not silently', async () => {
  const store = await storeWith(
    projection({
      summaryText:
        'These items were shipped to retail locations in Ohio and Indiana.\n' +
        'Stores in Indiana are not impacted by this recall.',
      geography: {
        scope: 'states',
        states: ['Indiana', 'Ohio'],
        confidence: 'inferred',
        sourceText: null,
      },
    }),
  );
  const plan = planCaseGeography(only(store));
  assert.equal(plan.outcome, 'update');
  assert.deepEqual(plan.next.states, ['Ohio']);
  assert.deepEqual(plan.removals, [{ state: 'Indiana', reason: 'explicitly-excluded' }]);
  assert.deepEqual(plan.excludedStates, ['Indiana']);
});

test('the repair uses the canonical derivation, never a parser of its own', () => {
  const source = readFileSync('src/server/geography-repair.ts', 'utf8');
  assert.match(source, /import \{ evaluateGeographyEvidence/);
  // No regex over announcement prose may live in this file.
  const bodies = source.split('\n').filter((line) => !line.trim().startsWith('*'));
  for (const line of bodies) {
    assert.ok(
      !/\\b(?:distribut|sold|shipped)/.test(line),
      `the repair grew its own prose parser: ${line.trim()}`,
    );
  }
});

test('the write is guarded on the version the PLAN read, not on a fresh re-read', async () => {
  // An ingest lands between the plan and the write. Re-reading the row to get
  // a version the write will accept is exactly what a compare-and-set exists
  // to prevent: it would roll the newer data back under a value the operator
  // reviewed against older text.
  class IngestLandsAfterPlanningStore extends MemoryStore {
    override async listCases() {
      const rows = await super.listCases();
      const snapshot = rows.map((row) => structuredClone(row));
      for (const row of this.cases.values()) {
        row.lastChangedAt = '2026-02-01T00:00:00.000Z';
        row.projection = {
          ...row.projection,
          summaryText: 'These items were shipped to retail locations in Ohio, Indiana and Maine.',
        };
      }
      return snapshot;
    }
  }
  const store = new IngestLandsAfterPlanningStore();
  await store.insertCase({
    projection: projection(),
    timeline: TIMELINE,
    createdAt: '2026-01-05T00:00:00.000Z',
    lastChangedAt: '2026-01-06T00:00:00.000Z',
  });

  const report = await repairGeography(store, { apply: true, expectedUpdates: 1 });

  assert.equal(report.caseWrites, 0, 'the stale-version write must match no row');
  assert.deepEqual(report.concurrentlyModified, [only(store).id]);
  assert.deepEqual(report.rollback, []);
  assert.equal(only(store).projection.geography.scope, 'unknown', 'the newer row is untouched');
  assert.equal(only(store).lastChangedAt, '2026-02-01T00:00:00.000Z');
});
