/**
 * Historical FDA contaminant-category correction (P3B): the safety
 * invariants, proved against the store port. The repair writes exactly four
 * fields — `normalized.hazardCategory`/`pathogenOrAllergen` and the same pair
 * inside `projection` — and everything below exists to keep it that way.
 *
 * The three production shapes are seeded from
 * `fda/fixtures/hazard-metal-or-chemical-notices.json` (bounded official
 * excerpts with their own provenance) assembled into archived listing
 * payloads: the packaging clause in the product field, the hazard statement
 * in the reason field — the arrangement the live announcements have, and the
 * one that made packaging decide the hazard. No test keys on a native id.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';

import { projectCase } from '../domain/projection';
import type { CaseProjection, TimelineEntry } from '../domain/recall-types';
import type { NormalizedSourceRecord } from '../domain/source-record';
import {
  ALLOWED_AGENT_TRANSITIONS,
  ALLOWED_TRANSITIONS,
  TARGET_FDA_CATEGORY,
  archivedCategory,
  classifyPopulation,
  inGovernedCategory,
  planRecord,
  repairFdaContaminants,
  resolveRepairMode,
} from './fda-contaminant-repair';
import { parseFdaAnnouncement, type FdaListingItem } from './fda/parse';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';
import { MemoryStore } from './store/memory-store';
import type { RecallStore, SourceRecordRow } from './store/types';

interface PinnedNotice {
  product: string;
  nativeId: string;
  officialUrl: string;
  fdaReasonCategory: string;
  storedHazardCategory: string;
  storedPathogenOrAllergen: string | null;
  expectedHazardCategory: string;
  expectedPathogenOrAllergen: string | null;
  packagingExcerpt: string;
  hazardExcerpt: string;
}

const PINNED: PinnedNotice[] = JSON.parse(
  readFileSync('src/server/fda/fixtures/hazard-metal-or-chemical-notices.json', 'utf8'),
);

/** A recorded real announcement in the governed category, for scope tests. */
const RECORDED: { path: string; listing: FdaListingItem; mainHtml: string }[] = JSON.parse(
  gunzipSync(readFileSync('src/server/fda/fixtures/qa-corpus.json.gz')).toString('utf8'),
);
const recordedInCategory = (fragment: string) => {
  const entry = RECORDED.find(
    (e) =>
      e.path.includes(fragment) &&
      inGovernedCategory(e.listing.field_recall_reason as string | null),
  );
  assert.ok(entry, `recorded fixture missing: ${fragment}`);
  return entry!;
};

/** A recorded FSIS record — a sibling this repair must never touch. */
const FSIS_RECORDS: FsisRawRecord[] = JSON.parse(
  readFileSync('src/server/fsis/fixtures/benchmark-records.json', 'utf8'),
);
const FSIS_GLASS = FSIS_RECORDS.find((r) => r.field_recall_number === '005-2026')!;

/** One pinned notice, assembled into the archived listing payload shape. */
function archivedPayload(notice: PinnedNotice, index: number) {
  const path = `/safety/recalls-market-withdrawals-safety-alerts/${notice.nativeId}`;
  const listing: FdaListingItem = {
    path,
    field_change_date_2: `${String((index % 12) + 1).padStart(2, '0')}/15/2026`,
    field_brand_name: '',
    field_product_description: `The product, ${notice.packagingExcerpt}`,
    field_recall_reason_description: `The firm has stated that the product ${notice.hazardExcerpt}.`,
    field_recall_reason: notice.fdaReasonCategory,
    field_company_name: `Recalling Firm ${index + 1}`,
    term_node_tid: '',
    field_regulated_product_field: 'Food &amp; Beverages',
    'all-terms-rewrite': 'Food &amp; Beverages, ',
    changed: '<time datetime="2026-02-01T11:20:32-05:00">Sun, 02/01/2026 - 11:20</time>\n',
  } as FdaListingItem;
  return { payload: { listing, detailMainHtml: null, path }, path };
}

const TIMELINE: TimelineEntry[] = [
  {
    occurredAt: '2026-02-01',
    kind: 'published',
    summary: 'Notice published.',
    causedBySnapshotIds: [],
    material: false,
  },
];

async function seedCase(
  store: MemoryStore,
  entries: { stored: NormalizedSourceRecord; rawPayload: unknown; withSnapshot?: boolean }[],
  projectionOverrides: Partial<CaseProjection> = {},
): Promise<{ caseId: string; records: SourceRecordRow[] }> {
  const recallCase = await store.insertCase({
    projection: { ...projectCase(entries.map((e) => e.stored)), ...projectionOverrides },
    timeline: TIMELINE,
    createdAt: '2026-02-01T00:00:00.000Z',
    lastChangedAt: '2026-02-02T00:00:00.000Z',
  });
  const records: SourceRecordRow[] = [];
  for (const entry of entries) {
    const row = await store.insertSourceRecord({
      sourceSystem: entry.stored.sourceSystem,
      nativeId: entry.stored.nativeId,
      recallCaseId: recallCase.id,
      linkMethod: 'self',
      normalized: entry.stored,
      sourceUrl: entry.stored.officialUrl,
      firstSeenAt: '2026-02-01T00:00:00.000Z',
      lastSeenAt: '2026-02-02T00:00:00.000Z',
    });
    if (entry.withSnapshot !== false) {
      await store.insertSnapshot({
        sourceRecordId: row.id,
        fetchedAt: '2026-02-01T00:00:00.000Z',
        contentHash: `hash-${entry.stored.nativeId}`,
        rawPayload: entry.rawPayload,
        sourceUrl: entry.stored.officialUrl,
      });
    }
    records.push(row);
  }
  return { caseId: recallCase.id, records };
}

/** One pinned notice as production stores it today: the defective pair. */
function defectiveRecord(notice: PinnedNotice, index: number) {
  const { payload } = archivedPayload(notice, index);
  const reparsed = parseFdaAnnouncement(payload);
  const stored: NormalizedSourceRecord = {
    ...reparsed,
    hazardCategory: notice.storedHazardCategory as NormalizedSourceRecord['hazardCategory'],
    pathogenOrAllergen: notice.storedPathogenOrAllergen,
  };
  return { stored, rawPayload: payload, reparsed };
}

/** The reviewed production population: 3 defective records across 3 cases. */
async function productionShapedStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const [index, notice] of PINNED.entries()) {
    const { stored, rawPayload } = defectiveRecord(notice, index);
    await seedCase(store, [{ stored, rawPayload }], { state: 'active' });
  }
  return store;
}

/** Deep, JSON-faithful snapshot of everything the store holds. */
function snapshotState(store: MemoryStore) {
  return JSON.parse(
    JSON.stringify({
      sourceRecords: [...store.sourceRecords.values()],
      snapshots: store.snapshots,
      cases: [...store.cases.values()],
      notifications: [...store.notifications.values()],
      ingestRuns: [...store.ingestRuns.values()],
      products: [...store.products.entries()],
    }),
  );
}

const MUTATORS = new Set([
  'insertSourceRecord',
  'updateSourceRecord',
  'updateSourceRecordPathogenOrAllergen',
  'updateSourceRecordHazard',
  'insertCase',
  'updateCase',
  'updateCaseRetailerNames',
  'updateCaseGeography',
  'updateCaseProductCategories',
  'updateCaseHeroImage',
  'updateCasePathogenOrAllergen',
  'updateCaseHazard',
  'insertSnapshot',
  'insertNotificationIfAbsent',
  'replaceProducts',
  'createIngestRun',
  'finishIngestRun',
  'annotateIngestRun',
  'acquireJobLease',
]);

/** A store that throws the moment any write method is reached. */
function writeProofStore(store: MemoryStore): RecallStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (typeof property === 'string' && MUTATORS.has(property)) {
        return () => {
          throw new Error(`reached write method ${property}`);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as RecallStore;
}

// ── Contract ─────────────────────────────────────────────────────────────────

test('no-flag execution is a dry run, and --apply alone is refused', () => {
  assert.deepEqual(resolveRepairMode([]), { apply: false, error: null });
  const refused = resolveRepairMode(['--apply']);
  assert.equal(refused.apply, false);
  assert.match(refused.error!, /--confirm/);
  assert.match(refused.error!, /repair:fda-contaminants/);
  assert.deepEqual(resolveRepairMode(['--apply', '--confirm']), { apply: true, error: null });
  assert.deepEqual(resolveRepairMode(['--confirm']), { apply: false, error: null });
});

test('the approved transition tables are exactly the reviewed P3B set', () => {
  assert.deepEqual(
    ALLOWED_TRANSITIONS.map(([from, to]) => `${from} → ${to}`),
    ['foreign_material → chemical_contamination'],
  );
  assert.deepEqual(
    ALLOWED_AGENT_TRANSITIONS.map(([from, to]) => `${from ?? '(null)'} → ${to ?? '(null)'}`),
    ['(null) → asbestos', '(null) → Cesium-137'],
  );
});

test('any agent transition outside the reviewed set is not in the allowlist', () => {
  // The only two writable agent moves are `null → asbestos` (Dynarex) and
  // `null → Cesium-137` (both AquaStar shrimp notices) — nothing else,
  // including `null → null` (no longer approved now that Dynarex's own
  // source names a real agent) and any move that would REPLACE a stored
  // agent.
  const isAllowed = (from: string | null, to: string | null) =>
    ALLOWED_AGENT_TRANSITIONS.some(([a, b]) => a === from && b === to);
  assert.equal(isAllowed(null, 'asbestos'), true);
  assert.equal(isAllowed(null, 'Cesium-137'), true);
  assert.equal(isAllowed(null, null), false);
  assert.equal(isAllowed(null, 'lead'), false);
  assert.equal(isAllowed('lead', 'asbestos'), false);
  assert.equal(isAllowed('asbestos', null), false);
});

test('scope is decided by the archived official category alone', () => {
  const governed = recordedInCategory('palermo-villa');
  assert.equal(
    archivedCategory({ listing: governed.listing, detailMainHtml: null, path: governed.path }),
    TARGET_FDA_CATEGORY,
  );
  assert.equal(inGovernedCategory(TARGET_FDA_CATEGORY), true);
  assert.equal(inGovernedCategory('Potential Foreign Material'), false);
  assert.equal(inGovernedCategory('Undeclared Milk'), false);
  assert.equal(inGovernedCategory(null), false);
});

test('the population guard admits only the reviewed set', () => {
  assert.equal(classifyPopulation(3, 3), 'approved');
  assert.equal(classifyPopulation(0, 0), 'settled');
  assert.equal(classifyPopulation(4, 4), 'needs-review');
  assert.equal(classifyPopulation(3, 2), 'needs-review');
  assert.equal(classifyPopulation(2, 3), 'needs-review');
});

// ── Dry-run behavior ─────────────────────────────────────────────────────────

test('a dry run performs zero writes and leaves the store byte-identical', async () => {
  const store = await productionShapedStore();
  const before = snapshotState(store);

  const report = await repairFdaContaminants(writeProofStore(store), { apply: false });
  assert.equal(report.recordWouldChange, 3);
  assert.equal(report.caseWouldChange, 3);
  assert.equal(report.population, 'approved');
  assert.equal(report.applyBlockedReason, null);
  assert.equal(report.sourceRecordWrites, 0);
  assert.equal(report.caseWrites, 0);
  assert.equal(report.networkRequests, 0);
  assert.deepEqual(snapshotState(store), before);
});

test('the dry run reports exactly the reviewed transitions', async () => {
  const store = await productionShapedStore();
  const report = await repairFdaContaminants(store, { apply: false });
  assert.deepEqual(report.transitionCounts, { 'foreign_material → chemical_contamination': 3 });
  assert.deepEqual(report.agentTransitionCounts, {
    '(null) → Cesium-137': 2,
    '(null) → asbestos': 1,
  });
  assert.equal(report.affectsMe.activeCasesChanged, 3);
  assert.equal(report.affectsMe.activeCasesEnteringAllergen, 0);
  // Every proposed correction carries a bounded excerpt of the official text.
  for (const plan of report.ledger) {
    for (const record of plan.recordWrites) assert.ok(record.evidenceExcerpt);
  }
});

// ── Apply behavior ───────────────────────────────────────────────────────────

test('an apply corrects the hazard pair and nothing else', async () => {
  const store = await productionShapedStore();
  const before = snapshotState(store);

  const report = await repairFdaContaminants(store, { apply: true });
  assert.equal(report.sourceRecordWrites, 3);
  assert.equal(report.caseWrites, 3);
  assert.equal(report.notificationEvents, 0);
  assert.equal(report.newCases, 0);
  assert.equal(report.skippedConflicts.length, 0);

  const agents = [...store.sourceRecords.values()]
    .map((r) => r.normalized.pathogenOrAllergen)
    .sort((a, b) => String(a).localeCompare(String(b)));
  assert.deepEqual(agents, ['asbestos', 'Cesium-137', 'Cesium-137']);
  for (const record of store.sourceRecords.values()) {
    assert.equal(record.normalized.hazardCategory, 'chemical_contamination');
  }
  for (const row of store.cases.values()) {
    assert.equal(row.projection.hazardCategory, 'chemical_contamination');
    // Dates never move: no re-dating, no public activity, no notification.
    assert.equal(row.lastChangedAt, '2026-02-02T00:00:00.000Z');
  }
  assert.equal(store.notifications.size, 0);

  // Everything else — every other normalized field, every other projection
  // field, the timeline, the dates, the snapshots, the ledger — byte-identical.
  const blank = (state: ReturnType<typeof snapshotState>) => {
    for (const record of state.sourceRecords) {
      record.normalized.hazardCategory = null;
      record.normalized.pathogenOrAllergen = null;
    }
    for (const row of state.cases) {
      row.projection.hazardCategory = null;
      row.projection.pathogenOrAllergen = null;
    }
    return state;
  };
  assert.deepEqual(blank(snapshotState(store)), blank(before));
});

test('only the four permitted fields ever enter a write payload', async () => {
  const store = await productionShapedStore();
  const recordPayloads: unknown[] = [];
  const casePayloads: unknown[] = [];
  const observed = new Proxy(store, {
    get(target, property, receiver) {
      if (property === 'updateSourceRecordHazard') {
        return (id: string, hazard: unknown, expected: unknown) => {
          recordPayloads.push(hazard);
          return store.updateSourceRecordHazard(id, hazard as never, expected as never);
        };
      }
      if (property === 'updateCaseHazard') {
        return (id: string, hazard: unknown, expectedLastChangedAt: string) => {
          casePayloads.push(hazard);
          return store.updateCaseHazard(id, hazard as never, expectedLastChangedAt);
        };
      }
      if (typeof property === 'string' && MUTATORS.has(property)) {
        return () => {
          throw new Error(`reached write method ${property}`);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as RecallStore;

  await repairFdaContaminants(observed, { apply: true });
  assert.equal(recordPayloads.length, 3);
  assert.equal(casePayloads.length, 3);
  for (const payload of [...recordPayloads, ...casePayloads]) {
    assert.deepEqual(Object.keys(payload as object).sort(), [
      'hazardCategory',
      'pathogenOrAllergen',
    ]);
  }
});

test('a completed repair is idempotent — the rerun is a settled no-op', async () => {
  const store = await productionShapedStore();
  await repairFdaContaminants(store, { apply: true });
  const settled = snapshotState(store);

  const rerun = await repairFdaContaminants(store, { apply: true });
  assert.equal(rerun.recordWouldChange, 0);
  assert.equal(rerun.caseWouldChange, 0);
  assert.equal(rerun.population, 'settled');
  assert.equal(rerun.applyBlockedReason, null);
  assert.equal(rerun.sourceRecordWrites, 0);
  assert.equal(rerun.caseWrites, 0);
  assert.deepEqual(snapshotState(store), settled);
});

test('an interrupted repair resumes: the remaining rows are corrected', async () => {
  const store = await productionShapedStore();
  // Correct one record+case out of band, exactly as a crashed apply would
  // have left it (the genuinely correct value — Dynarex's own agent is
  // asbestos, not null), then let the repair finish the rest.
  const first = [...store.sourceRecords.values()][0];
  await store.updateSourceRecordHazard(
    first.id,
    { hazardCategory: 'chemical_contamination', pathogenOrAllergen: 'asbestos' },
    { hazardCategory: 'foreign_material', pathogenOrAllergen: null },
  );
  const partial = await repairFdaContaminants(store, { apply: false });
  // Two records remain — not the reviewed population, so the apply refuses
  // until a human re-reviews. The refusal is the safety property; the
  // remaining work is still fully described in the ledger.
  assert.equal(partial.recordWouldChange, 2);
  assert.equal(partial.population, 'needs-review');
  assert.match(partial.applyBlockedReason!, /approved exactly 3 record/);
});

// ── Scope ────────────────────────────────────────────────────────────────────

test('FSIS records and other FDA categories are never planned', async () => {
  const store = new MemoryStore();
  // An FSIS glass contamination — a different agency entirely.
  await seedCase(store, [{ stored: parseFsisRecord(FSIS_GLASS), rawPayload: FSIS_GLASS }]);
  // A real FDA allergen announcement, stored deliberately wrong. Out of the
  // governed category, so this repair must not even look at its values.
  const allergen = RECORDED.find((e) => e.listing.field_recall_reason === 'Milk')!;
  const allergenPayload = {
    listing: allergen.listing,
    detailMainHtml: allergen.mainHtml,
    path: allergen.path,
  };
  await seedCase(store, [
    {
      stored: { ...parseFdaAnnouncement(allergenPayload), hazardCategory: 'foreign_material' },
      rawPayload: allergenPayload,
    },
  ]);
  const before = snapshotState(store);

  const report = await repairFdaContaminants(writeProofStore(store), { apply: true });
  assert.equal(report.inScopeRecords, 0);
  assert.equal(report.recordWouldChange, 0);
  assert.equal(report.population, 'settled');
  assert.deepEqual(snapshotState(store), before);
});

test('a genuine foreign-material recall inside the governed category is left alone', async () => {
  const store = new MemoryStore();
  // Recorded real announcement: its own title states a plastic contaminant,
  // so the shared evidence owner accepts it and the category stays.
  const genuine = recordedInCategory('palermo-villa');
  const payload = {
    listing: genuine.listing,
    detailMainHtml: genuine.mainHtml,
    path: genuine.path,
  };
  const stored = parseFdaAnnouncement(payload);
  assert.equal(stored.hazardCategory, 'foreign_material');
  await seedCase(store, [{ stored, rawPayload: payload }]);
  const before = snapshotState(store);

  const report = await repairFdaContaminants(writeProofStore(store), { apply: true });
  assert.equal(report.inScopeRecords, 1);
  assert.equal(report.recordWouldChange, 0);
  assert.deepEqual(snapshotState(store), before);
});

// ── Refusals: every one blocks the WHOLE apply, before any row is touched ────

test('an unreviewed category transition refuses the entire apply', async () => {
  const store = await productionShapedStore();
  // A fourth in-scope record whose stored category is chemical while its
  // snapshot reads foreign material — the opposite direction, never reviewed.
  const genuine = recordedInCategory('palermo-villa');
  const payload = {
    listing: genuine.listing,
    detailMainHtml: genuine.mainHtml,
    path: genuine.path,
  };
  await seedCase(store, [
    {
      stored: {
        ...parseFdaAnnouncement(payload),
        hazardCategory: 'chemical_contamination',
        pathogenOrAllergen: null,
      },
      rawPayload: payload,
    },
  ]);
  const before = snapshotState(store);

  const report = await repairFdaContaminants(writeProofStore(store), { apply: true });
  assert.equal(report.refusedTransitions.length, 1);
  assert.equal(report.refusedTransitions[0].correctedHazardCategory, 'foreign_material');
  assert.match(report.applyBlockedReason!, /category transition nobody reviewed/);
  assert.deepEqual(snapshotState(store), before);
});

test('an unreviewed agent transition refuses the entire apply', async () => {
  const store = await productionShapedStore();
  // The category move is the approved one, but a stored agent would be
  // OVERWRITTEN — losing information nobody reviewed losing.
  const notice = PINNED[1];
  const { payload } = archivedPayload(notice, 9);
  await seedCase(store, [
    {
      stored: {
        ...parseFdaAnnouncement(payload),
        nativeId: `${notice.nativeId}-variant`,
        hazardCategory: 'foreign_material',
        pathogenOrAllergen: 'lead',
      },
      rawPayload: payload,
    },
  ]);
  const before = snapshotState(store);

  const report = await repairFdaContaminants(writeProofStore(store), { apply: true });
  assert.equal(report.refusedAgentTransitions.length, 1);
  assert.equal(report.refusedAgentTransitions[0].storedPathogenOrAllergen, 'lead');
  assert.match(report.applyBlockedReason!, /agent along a transition nobody reviewed/);
  assert.deepEqual(snapshotState(store), before);
});

test('a missing snapshot refuses the entire apply', async () => {
  const store = await productionShapedStore();
  const { stored, rawPayload } = defectiveRecord(PINNED[0], 7);
  await seedCase(store, [
    {
      stored: { ...stored, nativeId: `${stored.nativeId}-nosnapshot` },
      rawPayload,
      withSnapshot: false,
    },
  ]);
  const before = snapshotState(store);

  const report = await repairFdaContaminants(writeProofStore(store), { apply: true });
  assert.equal(report.missingSnapshots.length, 1);
  assert.match(report.applyBlockedReason!, /no readable archived snapshot/);
  assert.deepEqual(snapshotState(store), before);
});

test('a snapshot the canonical adapter cannot parse refuses the entire apply', async () => {
  const store = await productionShapedStore();
  const { stored } = defectiveRecord(PINNED[0], 8);
  // In the governed category, but with no derivable title or publish date —
  // the canonical adapter throws, and a throw is never guessed past.
  const broken = {
    listing: {
      path: '/safety/recalls-market-withdrawals-safety-alerts/unparseable-notice',
      field_recall_reason: TARGET_FDA_CATEGORY,
      field_company_name: '',
      field_product_description: '',
      field_change_date_2: '',
    } as unknown as FdaListingItem,
    detailMainHtml: null,
    path: '/safety/recalls-market-withdrawals-safety-alerts/unparseable-notice',
  };
  await seedCase(store, [
    { stored: { ...stored, nativeId: 'unparseable-notice' }, rawPayload: broken },
  ]);
  const before = snapshotState(store);

  const report = await repairFdaContaminants(writeProofStore(store), { apply: true });
  assert.equal(report.parseFailures.length, 1);
  assert.match(report.applyBlockedReason!, /failed the canonical adapter/);
  assert.deepEqual(snapshotState(store), before);
});

test('a population that is not the reviewed one refuses the entire apply', async () => {
  const store = new MemoryStore();
  const { stored, rawPayload } = defectiveRecord(PINNED[0], 0);
  await seedCase(store, [{ stored, rawPayload }], { state: 'active' });
  const before = snapshotState(store);

  const report = await repairFdaContaminants(writeProofStore(store), { apply: true });
  assert.equal(report.recordWouldChange, 1);
  assert.equal(report.population, 'needs-review');
  assert.match(report.applyBlockedReason!, /approved exactly 3 record and 3 case corrections/);
  assert.deepEqual(snapshotState(store), before);
});

// ── Concurrency ──────────────────────────────────────────────────────────────

test('a row that changed since the plan read is skipped and reported', async () => {
  const store = await productionShapedStore();
  const target = [...store.sourceRecords.values()][0];
  const conflicting = new Proxy(store, {
    get(t, property, receiver) {
      if (property === 'updateSourceRecordHazard') {
        return async (id: string, hazard: never, expected: never) => {
          if (id === target.id) {
            // A concurrent re-parse landed between the plan and the write.
            await store.updateSourceRecordHazard(
              id,
              { hazardCategory: 'chemical_contamination', pathogenOrAllergen: 'lead' },
              { hazardCategory: 'foreign_material', pathogenOrAllergen: null },
            );
          }
          return store.updateSourceRecordHazard(id, hazard, expected);
        };
      }
      return Reflect.get(t, property, receiver);
    },
  }) as unknown as RecallStore;

  const report = await repairFdaContaminants(conflicting, { apply: true });
  assert.equal(report.sourceRecordWrites, 2);
  assert.equal(report.skippedConflicts.length, 1);
  assert.equal(report.skippedConflicts[0].kind, 'record');
  assert.equal(report.skippedConflicts[0].id, target.id);
});

// ── Projection ownership ─────────────────────────────────────────────────────

test('a multi-source case is reconstructed by projectCase, never patched', async () => {
  const store = new MemoryStore();
  // Two of the reviewed notices stand alone; the third shares its case with
  // an FSIS sibling, so the corrected projection must come from the
  // projection owner over BOTH records.
  for (const [index, notice] of PINNED.slice(0, 2).entries()) {
    const { stored, rawPayload } = defectiveRecord(notice, index);
    await seedCase(store, [{ stored, rawPayload }], { state: 'active' });
  }
  const { stored, rawPayload } = defectiveRecord(PINNED[2], 2);
  const sibling = parseFsisRecord(FSIS_GLASS);
  const { caseId } = await seedCase(
    store,
    [
      { stored, rawPayload },
      { stored: sibling, rawPayload: FSIS_GLASS },
    ],
    { state: 'active' },
  );

  const report = await repairFdaContaminants(store, { apply: true });
  assert.equal(report.recordWouldChange, 3);
  assert.equal(report.multiSourceChangedCases.length <= 1, true);
  // Whatever the projection owner decides for the mixed case, the repair
  // wrote exactly that — never an assumed value copied from one record.
  const rows = [...store.sourceRecords.values()].filter((r) => r.recallCaseId === caseId);
  const expected = projectCase(rows.map((r) => r.normalized));
  const written = store.cases.get(caseId)!.projection;
  assert.equal(written.hazardCategory, expected.hazardCategory);
  assert.equal(written.pathogenOrAllergen ?? null, expected.pathogenOrAllergen ?? null);
  // The FSIS sibling's own normalized values are untouched.
  const fsisRow = rows.find((r) => r.sourceSystem === 'fsis_api')!;
  assert.deepEqual(fsisRow.normalized, sibling);
});

// ── Record-level planning ────────────────────────────────────────────────────

test('planRecord is pure and echoes stored values for anything out of scope', () => {
  const fsisStored = parseFsisRecord(FSIS_GLASS);
  const row: SourceRecordRow = {
    id: 'r1',
    sourceSystem: 'fsis_api',
    nativeId: fsisStored.nativeId,
    recallCaseId: 'c1',
    linkMethod: 'self',
    normalized: fsisStored,
    sourceUrl: fsisStored.officialUrl,
    firstSeenAt: '2026-02-01T00:00:00.000Z',
    lastSeenAt: '2026-02-01T00:00:00.000Z',
  };
  const plan = planRecord(row, FSIS_GLASS);
  assert.equal(plan.outcome, 'out-of-scope');
  assert.equal(plan.correctedHazardCategory, plan.storedHazardCategory);
  assert.equal(plan.correctedPathogenOrAllergen, plan.storedPathogenOrAllergen);
});
