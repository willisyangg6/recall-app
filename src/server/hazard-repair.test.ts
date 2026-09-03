/**
 * Historical hazard-category correction (P2e-B): the safety invariants,
 * proved against the store port. The repair writes exactly four fields —
 * `normalized.hazardCategory`/`pathogenOrAllergen` and the same pair inside
 * `projection` — and everything below exists to keep it that way.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { projectCase } from '../domain/projection';
import type { CaseProjection, TimelineEntry } from '../domain/recall-types';
import type { NormalizedSourceRecord } from '../domain/source-record';
import {
  ALLOWED_TRANSITIONS,
  classifyPopulation,
  planRecord,
  repairHazards,
  resolveRepairMode,
} from './hazard-repair';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';
import { MemoryStore } from './store/memory-store';
import type { RecallStore, SourceRecordRow } from './store/types';

const BENCHMARK: FsisRawRecord[] = JSON.parse(
  readFileSync('src/server/fsis/fixtures/benchmark-records.json', 'utf8'),
);

/** A recorded undeclared-allergen recall FSIS filed as "Misbranding" only. */
const LABELING_ONLY: FsisRawRecord = {
  ...BENCHMARK.find((r) => r.field_recall_number === '038-2025')!,
  // The audited shape: FSIS states the allergen in prose but omits
  // "Unreported Allergens" from the structured reason.
  field_recall_reason: ['Misbranding'],
};

/** A recorded genuine foreign-material recall — must never be touched. */
const GLASS_CONTAMINATION = BENCHMARK.find((r) => r.field_recall_number === '005-2026')!;

const TIMELINE: TimelineEntry[] = [
  {
    occurredAt: '2026-07-29',
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
    createdAt: '2026-07-29T00:00:00.000Z',
    lastChangedAt: '2026-07-30T00:00:00.000Z',
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
      firstSeenAt: '2026-07-29T00:00:00.000Z',
      lastSeenAt: '2026-07-30T00:00:00.000Z',
    });
    if (entry.withSnapshot !== false) {
      await store.insertSnapshot({
        sourceRecordId: row.id,
        fetchedAt: '2026-07-29T00:00:00.000Z',
        contentHash: `hash-${entry.stored.nativeId}`,
        rawPayload: entry.rawPayload,
        sourceUrl: entry.stored.officialUrl,
      });
    }
    records.push(row);
  }
  return { caseId: recallCase.id, records };
}

/**
 * The audited shape: a record stored as an OLD parser left it
 * (`other_regulatory`, no agent) whose archived snapshot the corrected parser
 * reads as an allergen recall.
 */
async function staleCategoryStore(): Promise<{
  store: MemoryStore;
  caseId: string;
  recordId: string;
}> {
  const store = new MemoryStore();
  const stored: NormalizedSourceRecord = {
    ...parseFsisRecord(LABELING_ONLY),
    hazardCategory: 'other_regulatory',
    pathogenOrAllergen: null,
  };
  const { caseId, records } = await seedCase(store, [{ stored, rawPayload: LABELING_ONLY }]);
  return { store, caseId, recordId: records[0].id };
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
    }),
  );
}

// ── CLI contract ─────────────────────────────────────────────────────────────

test('no-flag execution is a dry run, and --apply alone is refused', () => {
  assert.deepEqual(resolveRepairMode([]), { apply: false, error: null });
  const refused = resolveRepairMode(['--apply']);
  assert.equal(refused.apply, false);
  assert.match(refused.error!, /--confirm/);
  assert.deepEqual(resolveRepairMode(['--apply', '--confirm']), { apply: true, error: null });
  assert.deepEqual(resolveRepairMode(['--confirm']), { apply: false, error: null });
});

test('the approved transition table is exactly the P2e-A + expanded P2e-B set', () => {
  assert.deepEqual(ALLOWED_TRANSITIONS.map(([from, to]) => `${from} → ${to}`).sort(), [
    'foreign_material → allergen',
    'foreign_material → unknown',
    'other_regulatory → allergen',
    'unknown → allergen',
    'unknown → foreign_material',
    'unknown → microbial_contamination',
  ]);
});

// ── Dry-run behavior ─────────────────────────────────────────────────────────

test('a dry run performs zero writes and leaves the store byte-identical', async () => {
  const { store } = await staleCategoryStore();
  const before = snapshotState(store);

  const mutators = new Set([
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
  const guarded = new Proxy(store, {
    get(target, property, receiver) {
      if (typeof property === 'string' && mutators.has(property)) {
        return () => {
          throw new Error(`dry run reached write method ${property}`);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as RecallStore;

  const report = await repairHazards(guarded, { apply: false });
  assert.equal(report.recordWouldChange, 1);
  assert.equal(report.caseWouldChange, 1);
  assert.equal(report.sourceRecordWrites, 0);
  assert.equal(report.caseWrites, 0);
  assert.equal(report.networkRequests, 0);
  assert.deepEqual(snapshotState(store), before);
});

// ── Apply behavior ───────────────────────────────────────────────────────────

test('an apply corrects the hazard pair and nothing else', async () => {
  const { store, caseId, recordId } = await staleCategoryStore();
  const before = snapshotState(store);

  const report = await repairHazards(store, { apply: true });
  assert.equal(report.sourceRecordWrites, 1);
  assert.equal(report.caseWrites, 1);
  assert.equal(report.notificationEvents, 0);
  assert.equal(report.newCases, 0);
  assert.equal(report.skippedConflicts.length, 0);
  assert.deepEqual(report.transitionCounts, { 'other_regulatory → allergen': 1 });

  const row = [...store.sourceRecords.values()].find((r) => r.id === recordId)!;
  assert.equal(row.normalized.hazardCategory, 'allergen');
  assert.equal(row.normalized.pathogenOrAllergen, 'undeclared soy');
  const kase = store.cases.get(caseId)!;
  assert.equal(kase.projection.hazardCategory, 'allergen');
  assert.equal(kase.projection.pathogenOrAllergen, 'undeclared soy');

  // Everything else — every other normalized field, every other projection
  // field, the timeline, the dates, the snapshots, the ledger — byte-identical.
  const after = snapshotState(store);
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
  assert.deepEqual(blank(after), blank(before));
  assert.equal(store.cases.get(caseId)!.lastChangedAt, '2026-07-30T00:00:00.000Z');
  assert.equal(store.notifications.size, 0);
});

test('a completed repair is idempotent — the rerun is a no-op', async () => {
  const { store } = await staleCategoryStore();
  await repairHazards(store, { apply: true });
  const settled = snapshotState(store);

  const rerun = await repairHazards(store, { apply: true });
  assert.equal(rerun.recordWouldChange, 0);
  assert.equal(rerun.caseWouldChange, 0);
  assert.equal(rerun.sourceRecordWrites, 0);
  assert.equal(rerun.caseWrites, 0);
  assert.deepEqual(snapshotState(store), settled);
});

// ── Refusals ─────────────────────────────────────────────────────────────────

test('an unreviewed category transition is refused, never written', async () => {
  const store = new MemoryStore();
  // Stored as a pathogen recall; the snapshot says foreign material. That
  // move was never source-reviewed, so it is reported and left alone.
  const stored: NormalizedSourceRecord = {
    ...parseFsisRecord(GLASS_CONTAMINATION),
    hazardCategory: 'microbial_contamination',
    pathogenOrAllergen: 'Listeria',
  };
  await seedCase(store, [{ stored, rawPayload: GLASS_CONTAMINATION }]);
  const before = snapshotState(store);

  const report = await repairHazards(store, { apply: true });
  assert.equal(report.recordWouldChange, 0);
  assert.equal(report.sourceRecordWrites, 0);
  assert.equal(report.caseWrites, 0);
  assert.equal(report.refusedTransitions.length, 1);
  assert.equal(report.refusedTransitions[0].storedHazardCategory, 'microbial_contamination');
  assert.equal(report.refusedTransitions[0].correctedHazardCategory, 'foreign_material');
  assert.deepEqual(snapshotState(store), before);
});

test('an agent-only difference on a non-allergen record is refused (083-2016)', async () => {
  const store = new MemoryStore();
  // The audited mixed-hazard exclusion: the category is correct, and the
  // stored agent is a truthful-but-incomplete pre-P2d artifact the corrected
  // parser no longer derives. Replacing real information with null would
  // LOSE information, so this repair never touches it.
  const stored: NormalizedSourceRecord = {
    ...parseFsisRecord({
      ...GLASS_CONTAMINATION,
      field_recall_reason: ['Produced Without Benefit of Inspection'],
    }),
    hazardCategory: 'other_regulatory',
    pathogenOrAllergen: 'undeclared wheat',
  };
  await seedCase(store, [
    {
      stored,
      rawPayload: {
        ...GLASS_CONTAMINATION,
        field_recall_reason: ['Produced Without Benefit of Inspection'],
      },
    },
  ]);
  const before = snapshotState(store);

  const report = await repairHazards(store, { apply: true });
  assert.equal(report.sourceRecordWrites, 0);
  assert.equal(report.caseWrites, 0);
  assert.equal(report.refusedAgentOnly.length, 1);
  assert.equal(report.refusedAgentOnly[0].storedPathogenOrAllergen, 'undeclared wheat');
  assert.deepEqual(snapshotState(store), before);
});

test('a genuine foreign-material recall is left exactly as it is', async () => {
  const store = new MemoryStore();
  const stored = parseFsisRecord(GLASS_CONTAMINATION);
  assert.equal(stored.hazardCategory, 'foreign_material');
  await seedCase(store, [{ stored, rawPayload: GLASS_CONTAMINATION }]);
  const before = snapshotState(store);

  const report = await repairHazards(store, { apply: true });
  assert.equal(report.recordWouldChange, 0);
  assert.equal(report.refusedTransitions.length, 0);
  assert.equal(report.refusedAgentOnly.length, 0);
  assert.deepEqual(snapshotState(store), before);
});

test('a generic foreign-matter notice with no named material is accepted (expanded scope)', async () => {
  const store = new MemoryStore();
  // The 20-record family from the production dry run: FSIS states the
  // hazard only in its generic title form, naming no specific material — the
  // old bare-keyword scan (metal/plastic/glass/wood/rubber/bone fragment)
  // could never match this, so it was stored `unknown`.
  const raw: FsisRawRecord = {
    ...GLASS_CONTAMINATION,
    field_recall_number: '900-2020',
    field_title: 'Example Co. Recalls Beef Products Due to Possible Foreign Matter Contamination',
    field_summary:
      'WASHINGTON, Jan. 1, 2020 – Example Co. is recalling beef products because they ' +
      'may be contaminated with foreign material, the U.S. Department of Agriculture’s ' +
      'Food Safety and Inspection Service (FSIS) announced today.',
    field_recall_reason: ['Product Contamination'],
  };
  const stored: NormalizedSourceRecord = {
    ...parseFsisRecord(raw),
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
  };
  const { caseId, records } = await seedCase(store, [{ stored, rawPayload: raw }]);

  const report = await repairHazards(store, { apply: true });
  assert.equal(report.recordWouldChange, 1);
  assert.equal(report.refusedTransitions.length, 0);
  assert.deepEqual(report.transitionCounts, { 'unknown → foreign_material': 1 });
  const row = [...store.sourceRecords.values()].find((r) => r.id === records[0].id)!;
  assert.equal(row.normalized.hazardCategory, 'foreign_material');
  assert.equal(row.normalized.pathogenOrAllergen, null);
  assert.equal(store.cases.get(caseId)!.projection.hazardCategory, 'foreign_material');
});

test('a packaging-only false positive reverts to unknown (expanded scope)', async () => {
  const store = new MemoryStore();
  // The 7-record family: the old scan matched a bare packaging word with no
  // contamination construction anywhere in the text — no genuine
  // foreign-material evidence, no pathogen, no allergen.
  const raw: FsisRawRecord = {
    ...GLASS_CONTAMINATION,
    field_recall_number: '900-2021',
    field_title: 'Example Co. Recalls Beef Products Due to Product Contamination',
    field_summary:
      'WASHINGTON, Jan. 1, 2021 – Example Co. is recalling beef products, the U.S. ' +
      'Department of Agriculture’s Food Safety and Inspection Service (FSIS) announced ' +
      'today. The following products, packaged in 10-oz. plastic bowls, are subject to ' +
      'recall.',
    field_recall_reason: ['Product Contamination'],
  };
  const stored: NormalizedSourceRecord = {
    ...parseFsisRecord(raw),
    hazardCategory: 'foreign_material',
    pathogenOrAllergen: null,
  };
  const { caseId, records } = await seedCase(store, [{ stored, rawPayload: raw }]);

  const report = await repairHazards(store, { apply: true });
  assert.equal(report.recordWouldChange, 1);
  assert.equal(report.refusedTransitions.length, 0);
  assert.deepEqual(report.transitionCounts, { 'foreign_material → unknown': 1 });
  const row = [...store.sourceRecords.values()].find((r) => r.id === records[0].id)!;
  assert.equal(row.normalized.hazardCategory, 'unknown');
  assert.equal(store.cases.get(caseId)!.projection.hazardCategory, 'unknown');
});

test('two source records for one case moving unknown -> foreign_material together correct one case (007-2020 shape)', async () => {
  const store = new MemoryStore();
  const base: FsisRawRecord = {
    ...GLASS_CONTAMINATION,
    field_title:
      'Example Co. Recalls Frozen Bowl Products Due to Possible Foreign Matter Contamination',
    field_summary:
      'Example Co. is recalling frozen bowl products because they may be contaminated ' +
      'with foreign material, the U.S. Department of Agriculture’s Food Safety and ' +
      'Inspection Service (FSIS) announced today.',
    field_recall_reason: ['Product Contamination'],
  };
  const original: FsisRawRecord = { ...base, field_recall_number: '900-2022' };
  const expansion: FsisRawRecord = {
    ...base,
    field_recall_number: '900-2022-EXP',
    field_recall_date: '2020-02-01',
  };
  const storedOf = (raw: FsisRawRecord): NormalizedSourceRecord => ({
    ...parseFsisRecord(raw),
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
  });
  const { caseId } = await seedCase(store, [
    { stored: storedOf(original), rawPayload: original },
    { stored: storedOf(expansion), rawPayload: expansion },
  ]);

  const report = await repairHazards(store, { apply: true });
  assert.equal(report.recordWouldChange, 2);
  assert.equal(report.caseWouldChange, 1);
  assert.deepEqual(report.multiSourceChangedCases, [caseId]);
  assert.equal(store.cases.get(caseId)!.projection.hazardCategory, 'foreign_material');
});

test('a record with no archived snapshot is reported, never guessed', async () => {
  const store = new MemoryStore();
  const stored: NormalizedSourceRecord = {
    ...parseFsisRecord(LABELING_ONLY),
    hazardCategory: 'other_regulatory',
    pathogenOrAllergen: null,
  };
  await seedCase(store, [{ stored, rawPayload: LABELING_ONLY, withSnapshot: false }]);
  const before = snapshotState(store);

  const report = await repairHazards(store, { apply: true });
  assert.equal(report.missingSnapshots.length, 1);
  assert.equal(report.sourceRecordWrites, 0);
  assert.deepEqual(snapshotState(store), before);
});

test('an unreadable archived payload is a reported parse failure, not a write', () => {
  const record = {
    id: 'r1',
    sourceSystem: 'fsis_api',
    nativeId: '999-2099',
    recallCaseId: 'c1',
    normalized: { hazardCategory: 'unknown', pathogenOrAllergen: null },
  } as unknown as SourceRecordRow;
  // Shaped like an FSIS record so the adapter is entered, but unparseable.
  const plan = planRecord(record, { field_recall_number: '   ' });
  assert.equal(plan.outcome, 'parse-failed');
  assert.equal(plan.correctedHazardCategory, 'unknown');
});

// ── Multi-source and concurrency ─────────────────────────────────────────────

test('a multi-source case takes its projection from projectCase, not one record', async () => {
  const store = new MemoryStore();
  const older: NormalizedSourceRecord = {
    ...parseFsisRecord(LABELING_ONLY),
    nativeId: '038-2025',
    hazardCategory: 'other_regulatory',
    pathogenOrAllergen: null,
    publishedAt: '2025-11-01',
  };
  const newer: NormalizedSourceRecord = {
    ...parseFsisRecord(LABELING_ONLY),
    nativeId: '038-2025-EXP',
    hazardCategory: 'other_regulatory',
    pathogenOrAllergen: null,
    publishedAt: '2025-12-01',
  };
  const { caseId } = await seedCase(store, [
    { stored: older, rawPayload: LABELING_ONLY },
    { stored: newer, rawPayload: LABELING_ONLY },
  ]);

  const report = await repairHazards(store, { apply: true });
  assert.equal(report.recordWouldChange, 2);
  assert.equal(report.caseWouldChange, 1);
  assert.deepEqual(report.multiSourceChangedCases, [caseId]);
  // Exactly what a full re-projection of the corrected records produces.
  const corrected = [...store.sourceRecords.values()].map((r) => r.normalized);
  const expected = projectCase(corrected);
  const kase = store.cases.get(caseId)!;
  assert.equal(kase.projection.hazardCategory, expected.hazardCategory);
  assert.equal(kase.projection.pathogenOrAllergen, expected.pathogenOrAllergen);
});

test('concurrently changed rows fail compare-and-swap and are skipped', async () => {
  const { store, caseId } = await staleCategoryStore();
  class IngestDuringWriteStore extends MemoryStore {
    async updateSourceRecordHazard(
      id: string,
      hazard: { hazardCategory: never; pathogenOrAllergen: string | null },
      expected: { hazardCategory: string; pathogenOrAllergen: string | null },
    ): Promise<boolean> {
      for (const row of store.sourceRecords.values()) {
        if (row.id === id) {
          row.normalized = { ...row.normalized, hazardCategory: 'allergen' };
        }
      }
      return super.updateSourceRecordHazard.call(store, id, hazard, expected);
    }
    async updateCaseHazard(
      id: string,
      hazard: { hazardCategory: never; pathogenOrAllergen: string | null },
      expectedLastChangedAt: string,
    ): Promise<boolean> {
      store.cases.get(id)!.lastChangedAt = '2026-08-01T00:00:00.000Z';
      return super.updateCaseHazard.call(store, id, hazard, expectedLastChangedAt);
    }
  }
  const racing = new IngestDuringWriteStore();
  const proxied = new Proxy(store, {
    get(target, property, receiver) {
      if (property === 'updateSourceRecordHazard' || property === 'updateCaseHazard') {
        return (racing as unknown as Record<string, unknown>)[property as string];
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as RecallStore;

  const report = await repairHazards(proxied, { apply: true });
  assert.equal(report.sourceRecordWrites, 0);
  assert.equal(report.caseWrites, 0);
  assert.equal(report.skippedConflicts.length, 2);
  assert.deepEqual(report.skippedConflicts.map((s) => s.kind).sort(), ['case', 'record']);
  // The newer data stands — never overwritten by the stale plan.
  assert.equal(store.cases.get(caseId)!.projection.hazardCategory, 'other_regulatory');
});

test('an interrupted apply resumes cleanly on the next run', async () => {
  const { store, caseId, recordId } = await staleCategoryStore();
  class CrashingStore extends MemoryStore {
    async updateCaseHazard(): Promise<boolean> {
      throw new Error('simulated crash mid-batch');
    }
  }
  const crashing = new Proxy(store, {
    get(target, property, receiver) {
      if (property === 'updateCaseHazard') return CrashingStore.prototype.updateCaseHazard;
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as RecallStore;

  await assert.rejects(repairHazards(crashing, { apply: true }), /simulated crash/);
  // Partial state: the record is corrected, the projection is not yet.
  const row = [...store.sourceRecords.values()].find((r) => r.id === recordId)!;
  assert.equal(row.normalized.hazardCategory, 'allergen');
  assert.equal(store.cases.get(caseId)!.projection.hazardCategory, 'other_regulatory');

  // The rerun decides from current state and finishes exactly the remainder.
  const resumed = await repairHazards(store, { apply: true });
  assert.equal(resumed.sourceRecordWrites, 0);
  assert.equal(resumed.caseWrites, 1);
  assert.equal(store.cases.get(caseId)!.projection.hazardCategory, 'allergen');
});

test('pre-existing projection drift is reported, not silently absorbed', async () => {
  const store = new MemoryStore();
  const stored = parseFsisRecord(GLASS_CONTAMINATION);
  await seedCase(store, [{ stored, rawPayload: GLASS_CONTAMINATION }], {
    // A projection that disagrees with its own stored record.
    hazardCategory: 'unknown',
  });
  const report = await repairHazards(store, { apply: false });
  assert.equal(report.preexistingProjectionDrift.length, 1);
  assert.equal(report.preexistingProjectionDrift[0].stored.hazardCategory, 'unknown');
  assert.equal(report.preexistingProjectionDrift[0].recomputed.hazardCategory, 'foreign_material');
});

test('every P2d-corrected record stays exactly as P2d left it', async () => {
  const store = new MemoryStore();
  // A record in its post-P2d state: allergen category, canonical agent.
  const settled = parseFsisRecord({
    ...LABELING_ONLY,
    field_recall_reason: ['Misbranding', 'Unreported Allergens'],
  });
  assert.equal(settled.hazardCategory, 'allergen');
  assert.equal(settled.pathogenOrAllergen, 'undeclared soy');
  await seedCase(store, [
    {
      stored: settled,
      rawPayload: {
        ...LABELING_ONLY,
        field_recall_reason: ['Misbranding', 'Unreported Allergens'],
      },
    },
  ]);
  const before = snapshotState(store);

  const report = await repairHazards(store, { apply: true });
  assert.equal(report.recordWouldChange, 0);
  assert.equal(report.caseWouldChange, 0);
  assert.equal(report.refusedTransitions.length, 0);
  assert.equal(report.refusedAgentOnly.length, 0);
  assert.deepEqual(snapshotState(store), before);
});

test('an allergen record whose agent alone drifts is refused, never rewritten', async () => {
  const store = new MemoryStore();
  // P2d owns the agent inside the allergen category and has already run; a
  // difference here is drift for a human, not a write for this repair.
  const stored: NormalizedSourceRecord = {
    ...parseFsisRecord({
      ...LABELING_ONLY,
      field_recall_reason: ['Misbranding', 'Unreported Allergens'],
    }),
    pathogenOrAllergen: 'undeclared soy and milk',
  };
  await seedCase(store, [
    {
      stored,
      rawPayload: {
        ...LABELING_ONLY,
        field_recall_reason: ['Misbranding', 'Unreported Allergens'],
      },
    },
  ]);
  const before = snapshotState(store);

  const report = await repairHazards(store, { apply: true });
  assert.equal(report.sourceRecordWrites, 0);
  assert.equal(report.caseWrites, 0);
  assert.equal(report.refusedAgentOnly.length, 1);
  assert.deepEqual(snapshotState(store), before);
});

test('the population guard accepts the reviewed set and the settled set only', () => {
  // Exactly what the founder has approved: P2e-A's 22 plus the 27 expanded
  // foreign-material corrections, 48 unique cases (one multi-source case
  // carries two of the 27 records).
  assert.equal(classifyPopulation(49, 48), 'approved');
  // Already applied — this is the post-apply verification result, and it must
  // NOT read as a failure.
  assert.equal(classifyPopulation(0, 0), 'settled');
  // The pre-expansion population is no longer approved on its own: the
  // founder decision to expand scope is load-bearing, not cosmetic — running
  // the OLD narrower guard against today's rules must send 22/22 to review,
  // not silently accept a stale approval.
  assert.equal(classifyPopulation(22, 22), 'needs-review');
  // Anything else is a corpus that moved: review before applying.
  assert.equal(classifyPopulation(48, 48), 'needs-review');
  assert.equal(classifyPopulation(50, 48), 'needs-review');
  assert.equal(classifyPopulation(49, 47), 'needs-review');
  assert.equal(classifyPopulation(5, 0), 'needs-review');
  assert.equal(classifyPopulation(0, 3), 'needs-review');
});
