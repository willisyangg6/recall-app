/**
 * Historical allergen-agent correction (P2d-B): the safety invariants, proved
 * against the store port. The repair writes exactly two fields —
 * `normalized.pathogenOrAllergen` and `projection.pathogenOrAllergen` — and
 * everything below exists to keep it that way.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { projectCase } from '../domain/projection';
import type { TimelineEntry } from '../domain/recall-types';
import type { NormalizedSourceRecord } from '../domain/source-record';
import { repairAllergens, resolveRepairMode } from './allergen-repair';
import type { FdaListingItem } from './fda/parse';
import { parseFdaAnnouncement } from './fda/parse';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';
import { MemoryStore } from './store/memory-store';
import type { RecallStore, SourceRecordRow } from './store/types';

const BENCHMARK: FsisRawRecord[] = JSON.parse(
  readFileSync('src/server/fsis/fixtures/benchmark-records.json', 'utf8'),
);

/** The recorded Steak Burrito PHA — P2d-A's motivating null → egg correction. */
const STEAK_BURRITO = BENCHMARK.find((r) => r.field_recall_number === 'PHA-07292026-01')!;

function loadFsisFixture(name: string): FsisRawRecord {
  return JSON.parse(readFileSync(`src/server/fsis/fixtures/${name}.json`, 'utf8'));
}

/** Synthetic listing in the recorded Lee K of NY shape: the category names
 * only the shellfish while the reason states milk too. */
const LEE_K_LISTING: FdaListingItem = {
  path: '/safety/recalls-market-withdrawals-safety-alerts/lee-k-ny-undeclared-milk-and-shrimp',
  field_change_date_2: '08/15/2026',
  field_brand_name: 'Lee K',
  field_product_description: 'Stewed Aged Kimchi',
  field_recall_reason_description: 'Undeclared Milk and Shrimp',
  field_recall_reason: 'Crustacean Shellfish',
  field_company_name: 'Lee K of NY Inc.',
  field_regulated_product_field: 'Food &amp; Beverages',
  changed: '<time datetime="2026-08-15T12:00:00Z">08/15/2026</time>',
};

const TIMELINE: TimelineEntry[] = [
  {
    occurredAt: '2026-07-29',
    kind: 'published',
    summary: 'Notice published.',
    causedBySnapshotIds: [],
    material: false,
  },
];

interface SeededRecord {
  row: SourceRecordRow;
  stored: NormalizedSourceRecord;
}

/**
 * Seed one case the way production holds it: a stored normalized record (as
 * an OLD extractor left it), the projection computed from that stored record,
 * and the archived raw snapshot the canonical parser can re-read.
 */
async function seedCase(
  store: MemoryStore,
  entries: {
    stored: NormalizedSourceRecord;
    rawPayload: unknown;
    withSnapshot?: boolean;
  }[],
  projectionOverrides: Partial<import('../domain/recall-types').CaseProjection> = {},
): Promise<{ caseId: string; records: SeededRecord[] }> {
  const recallCase = await store.insertCase({
    projection: { ...projectCase(entries.map((e) => e.stored)), ...projectionOverrides },
    timeline: TIMELINE,
    createdAt: '2026-07-29T00:00:00.000Z',
    lastChangedAt: '2026-07-30T00:00:00.000Z',
  });
  const records: SeededRecord[] = [];
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
    records.push({ row, stored: entry.stored });
  }
  return { caseId: recallCase.id, records };
}

/** The Steak Burrito store: stored null (old extractor), snapshot says egg. */
async function burritoStore(): Promise<{ store: MemoryStore; caseId: string; recordId: string }> {
  const store = new MemoryStore();
  const stored = { ...parseFsisRecord(STEAK_BURRITO), pathogenOrAllergen: null };
  const { caseId, records } = await seedCase(store, [{ stored, rawPayload: STEAK_BURRITO }]);
  return { store, caseId, recordId: records[0].row.id };
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
  // The acknowledgment alone never applies either.
  assert.deepEqual(resolveRepairMode(['--confirm']), { apply: false, error: null });
});

// ── Dry-run behavior ─────────────────────────────────────────────────────────

test('a dry run performs zero writes and leaves the store byte-identical', async () => {
  const { store } = await burritoStore();
  const before = snapshotState(store);

  // Every mutating port method trips this guard; reads pass through.
  const mutators = new Set([
    'insertSourceRecord',
    'updateSourceRecord',
    'updateSourceRecordPathogenOrAllergen',
    'insertCase',
    'updateCase',
    'updateCaseRetailerNames',
    'updateCaseGeography',
    'updateCaseProductCategories',
    'updateCaseHeroImage',
    'updateCasePathogenOrAllergen',
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

  const report = await repairAllergens(guarded, { apply: false });
  assert.equal(report.recordWouldChange, 1);
  assert.equal(report.caseWouldChange, 1);
  assert.equal(report.sourceRecordWrites, 0);
  assert.equal(report.caseWrites, 0);
  assert.equal(report.notificationEvents, 0);
  assert.equal(report.networkRequests, 0);
  assert.deepEqual(snapshotState(store), before);
});

test('Steak Burrito produces the expected null → undeclared egg correction', async () => {
  const { store } = await burritoStore();
  const report = await repairAllergens(store, { apply: false });

  assert.equal(report.ledger.length, 1);
  const plan = report.ledger[0];
  const record = plan.records[0];
  assert.equal(record.outcome, 'update');
  assert.equal(record.storedValue, null);
  assert.equal(record.correctedValue, 'undeclared egg');
  assert.equal(record.storedHazardCategory, 'allergen');
  assert.equal(plan.currentProjectionValue, null);
  assert.equal(plan.correctedProjectionValue, 'undeclared egg');
  assert.equal(plan.caseWriteNeeded, true);
  // Bounded evidence quotes the official apposition, never a whole document.
  assert.match(record.evidenceExcerpt!, /contains egg/i);
  assert.ok(record.evidenceExcerpt!.length < 300);
  assert.deepEqual(report.beforeAfter, { '(null) → undeclared egg': 1 });
  assert.deepEqual(report.familyCounts, { egg: 1 });
  // Affects Me: an active allergen-only case moves unidentified → identified.
  assert.equal(report.affectsMe.activeCasesChanged, 1);
  assert.deepEqual(report.affectsMe.tokensGained, { egg: 1 });
  assert.equal(report.affectsMe.unidentifiedToIdentified, 1);
});

test('a corrected FDA multi-allergen record preserves every supported allergen', async () => {
  const store = new MemoryStore();
  const rawPayload = { listing: LEE_K_LISTING, detailMainHtml: null, path: LEE_K_LISTING.path };
  const stored = {
    ...parseFdaAnnouncement({ listing: LEE_K_LISTING, detailMainHtml: null }),
    // As the pre-P2d-A derivation left it: category token only, milk dropped.
    pathogenOrAllergen: 'undeclared crustacean shellfish',
  };
  await seedCase(store, [{ stored, rawPayload }]);

  const report = await repairAllergens(store, { apply: false });
  const record = report.ledger[0].records[0];
  assert.equal(record.outcome, 'update');
  assert.equal(record.correctedValue, 'undeclared crustacean shellfish and milk');
  assert.equal(
    report.ledger[0].correctedProjectionValue,
    'undeclared crustacean shellfish and milk',
  );
  assert.deepEqual(report.ledger[0].tokensAfter, ['milk', 'shellfish']);
});

test('unchanged, pathogen, and negative records propose nothing', async () => {
  const store = new MemoryStore();
  // Already correct: stored exactly equals the canonical re-derivation.
  await seedCase(store, [{ stored: parseFsisRecord(STEAK_BURRITO), rawPayload: STEAK_BURRITO }]);
  // Pathogen record, stored as parsed ("Listeria monocytogenes").
  const outbreak = loadFsisFixture('recall-illness-outbreak-023-2024');
  const outbreakParsed = parseFsisRecord(outbreak);
  assert.equal(outbreakParsed.pathogenOrAllergen, 'Listeria monocytogenes');
  await seedCase(store, [{ stored: outbreakParsed, rawPayload: outbreak }]);
  // Negative record: no agent stated, none extracted.
  const negative = loadFsisFixture('recall-active-nationwide-017-2026');
  const negativeParsed = parseFsisRecord(negative);
  assert.equal(negativeParsed.pathogenOrAllergen, null);
  await seedCase(store, [{ stored: negativeParsed, rawPayload: negative }]);

  const report = await repairAllergens(store, { apply: false });
  assert.equal(report.casesExamined, 3);
  assert.equal(report.recordWouldChange, 0);
  assert.equal(report.caseWouldChange, 0);
  assert.equal(report.ledger.length, 0);
  assert.equal(report.changesOutsideAllergenCategory.length, 0);
  assert.equal(report.pathogenValueChanges.length, 0);
});

test('the Yellow 5/Yellow 6 fallback quirk stays outside this repair', async () => {
  const store = new MemoryStore();
  const listing = {
    ...LEE_K_LISTING,
    path: '/safety/recalls-market-withdrawals-safety-alerts/yellow-co-cheese-crackers',
    field_recall_reason: 'Potential or Undeclared Allergen',
    field_recall_reason_description: 'Undeclared FD&C Yellow 5 and Yellow 6',
  };
  const parsed = parseFdaAnnouncement({ listing, detailMainHtml: null });
  // The pre-existing fallback quirk ("undeclared fd") is deliberately NOT in
  // scope: stored already equals the canonical derivation, so the repair
  // proposes nothing and the quirk is neither fixed nor worsened here.
  assert.equal(parsed.pathogenOrAllergen, 'undeclared fd');
  await seedCase(store, [
    { stored: parsed, rawPayload: { listing, detailMainHtml: null, path: listing.path } },
  ]);

  const report = await repairAllergens(store, { apply: false });
  assert.equal(report.recordWouldChange, 0);
  assert.equal(report.caseWouldChange, 0);
});

// ── Drift layers ─────────────────────────────────────────────────────────────

test('normalized-only drift is reported without a projection write', async () => {
  const store = new MemoryStore();
  const stored = { ...parseFsisRecord(STEAK_BURRITO), pathogenOrAllergen: null };
  // The projection already holds the corrected value (however it got there);
  // only the record's normalized payload is stale.
  await seedCase(store, [{ stored, rawPayload: STEAK_BURRITO }], {
    pathogenOrAllergen: 'undeclared egg',
  });

  const report = await repairAllergens(store, { apply: false });
  assert.equal(report.recordWouldChange, 1);
  assert.equal(report.caseWouldChange, 0);
  assert.equal(report.ledger.length, 1);
  assert.equal(report.ledger[0].caseWriteNeeded, false);
  // The stored projection disagreeing with its own stored records is surfaced.
  assert.equal(report.preexistingProjectionDrift.length, 1);
});

test('projection-only drift is reported without a record write', async () => {
  const store = new MemoryStore();
  const stored = parseFsisRecord(STEAK_BURRITO); // record already correct
  await seedCase(store, [{ stored, rawPayload: STEAK_BURRITO }], {
    pathogenOrAllergen: null, // stale projection
  });

  const report = await repairAllergens(store, { apply: false });
  assert.equal(report.recordWouldChange, 0);
  assert.equal(report.caseWouldChange, 1);
  assert.equal(report.ledger.length, 1);
  assert.equal(report.ledger[0].recordWrites.length, 0);
  assert.equal(report.ledger[0].correctedProjectionValue, 'undeclared egg');
});

test('both-layer drift proposes both writes for the same case', async () => {
  const { store } = await burritoStore();
  const report = await repairAllergens(store, { apply: false });
  assert.equal(report.recordWouldChange, 1);
  assert.equal(report.caseWouldChange, 1);
  assert.equal(report.ledger[0].recordWrites.length, 1);
  assert.equal(report.ledger[0].caseWriteNeeded, true);
});

// ── Refusals ─────────────────────────────────────────────────────────────────

test('a missing snapshot is reported and never guessed', async () => {
  const store = new MemoryStore();
  const stored = { ...parseFsisRecord(STEAK_BURRITO), pathogenOrAllergen: null };
  await seedCase(store, [{ stored, rawPayload: STEAK_BURRITO, withSnapshot: false }]);

  const report = await repairAllergens(store, { apply: true });
  assert.equal(report.missingSnapshots.length, 1);
  assert.equal(report.missingSnapshots[0].nativeId, 'PHA-07292026-01');
  assert.equal(report.snapshotCoverage.fsis.missing, 1);
  assert.equal(report.recordWouldChange, 0);
  assert.equal(report.sourceRecordWrites, 0);
  assert.equal(report.caseWrites, 0);
  assert.equal(store.sourceRecords.values().next().value!.normalized.pathogenOrAllergen, null);
});

test('a value change outside allergen-category records is refused and reported', async () => {
  const store = new MemoryStore();
  const outbreak = loadFsisFixture('recall-illness-outbreak-023-2024');
  // Doctored stored value on a microbial record: the re-parse disagrees, and
  // the repair must refuse to touch a pathogen record.
  const stored = { ...parseFsisRecord(outbreak), pathogenOrAllergen: 'Listeria' };
  await seedCase(store, [{ stored, rawPayload: outbreak }]);

  const report = await repairAllergens(store, { apply: true });
  assert.equal(report.changesOutsideAllergenCategory.length, 1);
  assert.equal(report.pathogenValueChanges.length, 1);
  assert.equal(report.recordWouldChange, 0);
  assert.equal(report.sourceRecordWrites, 0);
  assert.equal(
    store.sourceRecords.values().next().value!.normalized.pathogenOrAllergen,
    'Listeria',
  );
});

test('a re-parse that moves the hazard category itself is refused', async () => {
  const store = new MemoryStore();
  // Snapshot re-parses to allergen; the stored row claims another category.
  const stored = {
    ...parseFsisRecord(STEAK_BURRITO),
    hazardCategory: 'other_regulatory' as const,
    pathogenOrAllergen: null,
  };
  await seedCase(store, [{ stored, rawPayload: STEAK_BURRITO }]);

  const report = await repairAllergens(store, { apply: true });
  assert.equal(report.categoryConflicts.length, 1);
  assert.equal(report.categoryConflicts[0].correctedHazardCategory, 'allergen');
  assert.equal(report.recordWouldChange, 0);
  assert.equal(report.sourceRecordWrites, 0);
  const row = store.sourceRecords.values().next().value!;
  assert.equal(row.normalized.hazardCategory, 'other_regulatory');
  assert.equal(row.normalized.pathogenOrAllergen, null);
});

// ── Apply behavior ───────────────────────────────────────────────────────────

test('an apply writes the two allowed fields and nothing else, byte for byte', async () => {
  const { store, caseId, recordId } = await burritoStore();
  const before = snapshotState(store);

  const report = await repairAllergens(store, { apply: true });
  assert.equal(report.sourceRecordWrites, 1);
  assert.equal(report.caseWrites, 1);
  assert.equal(report.skippedConflicts.length, 0);
  assert.equal(store.notifications.size, 0, 'no notification event is ever written');

  const after = snapshotState(store);
  // Raw snapshots, hashes, and the notification ledger are byte-identical.
  assert.deepEqual(after.snapshots, before.snapshots);
  assert.deepEqual(after.notifications, before.notifications);
  assert.deepEqual(after.ingestRuns, before.ingestRuns);
  // The record differs in exactly one field.
  const recordBefore = before.sourceRecords.find((r: SourceRecordRow) => r.id === recordId);
  const recordAfter = after.sourceRecords.find((r: SourceRecordRow) => r.id === recordId);
  assert.equal(recordAfter.normalized.pathogenOrAllergen, 'undeclared egg');
  recordAfter.normalized.pathogenOrAllergen = recordBefore.normalized.pathogenOrAllergen;
  assert.deepEqual(recordAfter, recordBefore);
  // The case differs in exactly one projection field — timeline, dates,
  // classification, title, and every sibling stay untouched.
  const caseBefore = before.cases.find((c: { id: string }) => c.id === caseId);
  const caseAfter = after.cases.find((c: { id: string }) => c.id === caseId);
  assert.equal(caseAfter.projection.pathogenOrAllergen, 'undeclared egg');
  caseAfter.projection.pathogenOrAllergen = caseBefore.projection.pathogenOrAllergen;
  assert.deepEqual(caseAfter, caseBefore);
});

test('re-running the apply is idempotent, and the dry run verifies it', async () => {
  const { store } = await burritoStore();
  const first = await repairAllergens(store, { apply: true });
  assert.equal(first.sourceRecordWrites + first.caseWrites, 2);

  const verify = await repairAllergens(store, { apply: false });
  assert.equal(verify.recordWouldChange, 0);
  assert.equal(verify.caseWouldChange, 0);

  const second = await repairAllergens(store, { apply: true });
  assert.equal(second.sourceRecordWrites, 0);
  assert.equal(second.caseWrites, 0);
});

test('concurrently changed rows fail compare-and-swap and are skipped', async () => {
  const { store, caseId } = await burritoStore();
  // An ingest lands between the plan and each write: the record's value moves
  // and the case's last_changed_at moves. Both writes must lose.
  class IngestDuringWriteStore extends MemoryStore {
    async updateSourceRecordPathogenOrAllergen(
      id: string,
      value: string | null,
      expected: string | null,
    ): Promise<boolean> {
      for (const row of store.sourceRecords.values()) {
        if (row.id === id)
          row.normalized = { ...row.normalized, pathogenOrAllergen: 'undeclared egg and milk' };
      }
      return super.updateSourceRecordPathogenOrAllergen.call(store, id, value, expected);
    }
    async updateCasePathogenOrAllergen(
      id: string,
      value: string | null,
      expectedLastChangedAt: string,
    ): Promise<boolean> {
      store.cases.get(id)!.lastChangedAt = '2026-08-01T00:00:00.000Z';
      return super.updateCasePathogenOrAllergen.call(store, id, value, expectedLastChangedAt);
    }
  }
  const racing = new IngestDuringWriteStore();
  const proxied = new Proxy(store, {
    get(target, property, receiver) {
      if (
        property === 'updateSourceRecordPathogenOrAllergen' ||
        property === 'updateCasePathogenOrAllergen'
      ) {
        return (racing as unknown as Record<string, unknown>)[property as string];
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as RecallStore;

  const report = await repairAllergens(proxied, { apply: true });
  assert.equal(report.sourceRecordWrites, 0);
  assert.equal(report.caseWrites, 0);
  assert.equal(report.skippedConflicts.length, 2);
  assert.deepEqual(report.skippedConflicts.map((s) => s.kind).sort(), ['case', 'record']);
  // The newer data stands — never overwritten by the stale plan.
  const row = [...store.sourceRecords.values()][0];
  assert.equal(row.normalized.pathogenOrAllergen, 'undeclared egg and milk');
  assert.equal(store.cases.get(caseId)!.projection.pathogenOrAllergen, null);
});

test('an interrupted apply resumes cleanly on the next run', async () => {
  const { store } = await burritoStore();
  // Crash after the record write, before the case write.
  class CrashingStore extends MemoryStore {
    async updateCasePathogenOrAllergen(): Promise<boolean> {
      throw new Error('simulated crash mid-batch');
    }
  }
  const crashing = new Proxy(store, {
    get(target, property, receiver) {
      if (property === 'updateCasePathogenOrAllergen') {
        return CrashingStore.prototype.updateCasePathogenOrAllergen;
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as RecallStore;

  await assert.rejects(repairAllergens(crashing, { apply: true }), /simulated crash/);
  // Partial state: the record is corrected, the projection is not yet.
  const row = [...store.sourceRecords.values()][0];
  assert.equal(row.normalized.pathogenOrAllergen, 'undeclared egg');
  assert.equal([...store.cases.values()][0].projection.pathogenOrAllergen, null);

  // The rerun decides from current state and finishes exactly the remainder.
  const resumed = await repairAllergens(store, { apply: true });
  assert.equal(resumed.sourceRecordWrites, 0);
  assert.equal(resumed.caseWrites, 1);
  assert.equal([...store.cases.values()][0].projection.pathogenOrAllergen, 'undeclared egg');

  const verify = await repairAllergens(store, { apply: false });
  assert.equal(verify.recordWouldChange + verify.caseWouldChange, 0);
});

test('notification and material-change writers are structurally unreachable', async () => {
  const { store } = await burritoStore();
  const armed = new Proxy(store, {
    get(target, property, receiver) {
      if (property === 'insertNotificationIfAbsent') {
        return () => {
          throw new Error('the repair must never write a notification');
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as RecallStore;

  const report = await repairAllergens(armed, { apply: true });
  assert.equal(report.notificationEvents, 0);
  assert.equal(report.newCases, 0);
  assert.equal(store.notifications.size, 0);

  // Structural guard: the module never imports material-change detection or
  // the ingestion pipeline, so a hazard correction cannot re-enter either.
  const source = readFileSync('src/server/allergen-repair.ts', 'utf8');
  const imports = source.match(/^import[^;]+;/gms) ?? [];
  assert.ok(!imports.some((line) => line.includes('material-change')));
  assert.ok(!imports.some((line) => line.includes('./pipeline')));
  assert.ok(!source.includes('insertNotification'));
});

test('a multi-source case resolves its projection by canonical precedence', async () => {
  const store = new MemoryStore();
  const fsisStored = { ...parseFsisRecord(STEAK_BURRITO), pathogenOrAllergen: null };
  const fdaStored = {
    ...parseFdaAnnouncement({ listing: LEE_K_LISTING, detailMainHtml: null }),
    pathogenOrAllergen: null,
  };
  // Both notices stale, one case: the corrected projection must come from
  // projectCase over the corrected records (newest non-null wins), and the
  // case must be flagged as reached by more than one source record.
  const { caseId } = await seedCase(store, [
    { stored: fsisStored, rawPayload: STEAK_BURRITO },
    {
      stored: fdaStored,
      rawPayload: { listing: LEE_K_LISTING, detailMainHtml: null, path: LEE_K_LISTING.path },
    },
  ]);

  const report = await repairAllergens(store, { apply: false });
  assert.equal(report.recordWouldChange, 2);
  assert.deepEqual(report.multiSourceChangedCases, [caseId]);
  const expected = projectCase([
    parseFsisRecord(STEAK_BURRITO),
    parseFdaAnnouncement({ listing: LEE_K_LISTING, detailMainHtml: null }),
  ]).pathogenOrAllergen;
  assert.equal(report.ledger[0].correctedProjectionValue, expected);
});

// ── P2d-A follow-up fixes, proven at the repair layer ────────────────────────

/** Minimal FSIS raw record; hazard-relevant fields carry the given wording. */
function fsisRaw(number: string, title: string, summary: string): FsisRawRecord {
  return {
    field_title: title,
    field_recall_number: number,
    field_recall_type: 'Closed Recall',
    field_recall_classification: 'Class I',
    field_risk_level: 'High - Class I',
    field_recall_reason: ['Misbranding', 'Unreported Allergens'],
    field_recall_date: '2015-08-12',
    field_last_modified_date: '',
    field_closed_year: '2015',
    field_states: [],
    field_product_items: [],
    field_establishment: ['Pleasant House Bakery'],
    field_summary: `<p>${summary}</p>`,
    field_qty_recovered: '',
    field_company_media_contact: [],
    field_recall_url: 'https://www.fsis.usda.gov/recalls-alerts/example',
    field_archive_recall: 'True',
    field_related_to_outbreak: 'False',
    langcode: 'English',
  };
}

test('111-2015 proposes the complete supported allergen list, never null', async () => {
  // The archived official wording (verified against the production snapshot):
  // an allergen-governed "including" list. The stored value is the OLD
  // extractor's partial catch; the correction must complete it, not lose it.
  const raw = fsisRaw(
    '111-2015',
    'Pleasant House Bakery Recalls Steak and Chicken Products Distributed Without the Benefit of Inspection and Due to Undeclared Allergens',
    'These products were also missing the ingredient statement and contained undeclared ' +
      "allergens, including eggs, milk, and wheat, the U.S. Department of Agriculture's Food " +
      'Safety and Inspection Service (FSIS) announced today.',
  );
  const store = new MemoryStore();
  const stored = { ...parseFsisRecord(raw), pathogenOrAllergen: 'undeclared milk' };
  await seedCase(store, [{ stored, rawPayload: raw }]);

  const report = await repairAllergens(store, { apply: false });
  const record = report.ledger[0].records[0];
  assert.equal(record.outcome, 'update');
  assert.equal(record.storedValue, 'undeclared milk');
  assert.equal(record.correctedValue, 'undeclared eggs, milk, and wheat');
  assert.equal(report.ledger[0].correctedProjectionValue, 'undeclared eggs, milk, and wheat');
  assert.notEqual(record.correctedValue, null, 'a stored extraction must never regress to null');
});

test('no proposed canonical value contains duplicate singular/plural families', async () => {
  // Both evidence constructions name the same allergen in different number —
  // the first production dry run proposed "undeclared peanut and peanuts"
  // here. With alias deduplication the stored value is already canonical, so
  // the repair proposes nothing.
  const raw = fsisRaw(
    '089-2014',
    'Firm Recalls Snack Products Due to Misbranding and an Undeclared Peanut Allergen',
    'The firm recalled products due to undeclared peanut. The products may contain peanuts, ' +
      'known allergens, which are not declared on the product label.',
  );
  const store = new MemoryStore();
  const stored = { ...parseFsisRecord(raw), pathogenOrAllergen: 'undeclared peanut' };
  await seedCase(store, [{ stored, rawPayload: raw }]);

  const report = await repairAllergens(store, { apply: false });
  assert.equal(report.recordWouldChange, 0);
  assert.equal(report.caseWouldChange, 0);
  // And a stale stored duplicate is corrected TO the deduplicated form.
  const store2 = new MemoryStore();
  const stored2 = { ...parseFsisRecord(raw), pathogenOrAllergen: 'undeclared peanut and peanuts' };
  await seedCase(store2, [{ stored: stored2, rawPayload: raw }]);
  const report2 = await repairAllergens(store2, { apply: false });
  const record2 = report2.ledger[0].records[0];
  assert.equal(record2.correctedValue, 'undeclared peanut');
  for (const plan of report2.ledger) {
    for (const record of plan.records) {
      const words = (record.correctedValue ?? '').replace(/^undeclared\s+/, '').split(/,? and |, /);
      assert.equal(new Set(words.map((w) => w.replace(/s$/, ''))).size, words.length);
    }
  }
});
