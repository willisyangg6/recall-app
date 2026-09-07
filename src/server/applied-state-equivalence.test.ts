/**
 * O3-B4B legacy-equivalence contract (legacy-equivalence/1): the four
 * founder-accepted rules — R1/R2 (stored-null declares* vs derived false),
 * R3 (stored-null retailerNames vs derived [] at BOTH boundaries), R4
 * (legacy classification lacking officialClasses with identical semantics
 * through the domain accessors) — and nothing else.
 *
 * The matrix pins: every positive equivalence, every affirmative-evidence
 * counterexample, strict comparison for every non-legacy apply_state, group
 * release/refusal, determinism, contract-version binding between plan
 * generation and apply, and that comparison mutates and notifies nothing.
 * Fixtures come from the REAL pipeline, then stored state is mutated to the
 * documented pre-era shape (exactly what the production legacy rows carry).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  applySeedPlan,
  auditAppliedState,
  LEGACY_EQUIVALENCE_CONTRACT,
  normalizedLegacyEquivalence,
  planContentDigest,
  PlanValidationError,
  projectionLegacyEquivalence,
  type ReconcilePlan,
} from './applied-state-reconcile';
import { enrichCaseWithMatches } from './fda-enforcement/enrich';
import { parseEnforcementRecord, type OpenFdaEnforcementRaw } from './fda-enforcement/parse';
import { loadDetailPage, loadListingItem } from './fda/fixtures';
import { runFdaIngest } from './fda/ingest';
import { slugFromPath } from './fda/parse';
import { loadFixture } from './fsis/fixtures';
import { runFsisIngest } from './pipeline';
import { MemoryStore } from './store/memory-store';
import type { RecallCaseRow, SourceRecordRow } from './store/types';

const NOW = () => new Date('2026-08-21T12:00:00Z');
const GIT = 'commit-under-test';

const RECALL = loadFixture('recall-active-nationwide-017-2026');
const PRINCE =
  'prince-bakery-inc-issues-allergy-alert-undeclared-milk-and-sesame-prince-bakery-breads';

function stripMarkers(store: MemoryStore): void {
  for (const row of store.sourceRecords.values()) {
    delete row.applyState;
    delete row.appliedContentHash;
    delete row.appliedSnapshotSeq;
    delete row.appliedAt;
  }
}

async function fdaStore(strip = true): Promise<MemoryStore> {
  const store = new MemoryStore();
  await runFdaIngest(
    store,
    {
      listing: { items: [loadListingItem(PRINCE)], fetchedAt: NOW().toISOString() },
      rss: { items: [] },
      fetchDetail: async (url) => loadDetailPage(slugFromPath(url)),
    },
    { now: NOW },
  );
  if (strip) stripMarkers(store);
  return store;
}

async function fsisStore(strip = true): Promise<MemoryStore> {
  const store = new MemoryStore();
  await runFsisIngest(
    store,
    {
      records: [RECALL],
      fetchedAt: NOW().toISOString(),
      sourceUrl: 'https://www.fsis.usda.gov/fsis/api/recall/v/1?field_translation_language=en',
    },
    { now: NOW },
  );
  if (strip) stripMarkers(store);
  return store;
}

/** Announcement + enforcement record sharing one case (multi-source group). */
async function multiSourceStore(): Promise<MemoryStore> {
  const store = await fsisStore(false);
  const announcementCase = [...store.cases.values()][0];
  const raw: OpenFdaEnforcementRaw = {
    recall_number: 'F-2000-2026',
    event_id: '88800',
    classification: 'Class I',
    status: 'Ongoing',
    recalling_firm: 'Fixture Firm',
    product_description: 'Fixture product',
    code_info: 'Lot 1',
    reason_for_recall: 'Fixture reason',
    recall_initiation_date: '20260810',
    center_classification_date: '20260818',
    report_date: '20260820',
  };
  const parsed = parseEnforcementRecord(raw);
  await enrichCaseWithMatches(
    store,
    announcementCase.id,
    [{ eventId: parsed.eventId, method: 'code-identity', records: [parsed], evidence: ['e'] }],
    new Map([[parsed.recallNumber, raw]]),
    { apply: true, now: NOW },
  );
  stripMarkers(store);
  return store;
}

const audit = (store: MemoryStore) => auditAppliedState(store, { gitCommit: GIT, now: NOW });

function record(store: MemoryStore, nativeId: string): SourceRecordRow {
  return [...store.sourceRecords.values()].find((r) => r.nativeId === nativeId)!;
}

function normalizedOf(store: MemoryStore, nativeId: string): Record<string, unknown> {
  return record(store, nativeId).normalized as unknown as Record<string, unknown>;
}

function caseOf(store: MemoryStore, nativeId: string): RecallCaseRow {
  return store.cases.get(record(store, nativeId).recallCaseId)!;
}

function only(plan: ReconcilePlan, nativeId: string) {
  const finding = plan.records.find((r) => r.nativeId === nativeId);
  assert.ok(finding, `no finding for ${nativeId}`);
  return finding!;
}

function durableState(store: MemoryStore) {
  return structuredClone({
    records: [...store.sourceRecords.values()],
    cases: [...store.cases.values()],
    snapshots: store.snapshots,
    products: [...store.products.entries()],
    notifications: [...store.notifications.entries()],
  });
}

// ── R1/R2: declaresRevision / declaresExpansion ─────────────────────────────

test('R1: legacy-null declaresRevision vs derived false certifies as equivalent', async () => {
  const store = await fdaStore();
  normalizedOf(store, PRINCE).declaresRevision = null;
  const plan = await audit(store);
  const finding = only(plan, PRINCE);
  assert.equal(finding.classification, 'equivalent_legacy_seedable');
  assert.equal(finding.seedable, true);
  assert.deepEqual(finding.equivalencesUsed, ['R1']);
  assert.deepEqual(finding.fieldDiffs, []);
  assert.deepEqual(plan.seedable[0]?.equivalencesUsed, ['R1']);
  assert.equal(plan.summary.classificationCounts.equivalent_legacy_seedable, 1);
});

test('R1 counterexample: null vs derived TRUE is affirmative evidence, never equivalent', () => {
  assert.equal(normalizedLegacyEquivalence('declaresRevision', null, true), null);
  assert.equal(normalizedLegacyEquivalence('declaresRevision', undefined, true), null);
  // Non-legacy direction: a stored affirmative value never reads as default.
  assert.equal(normalizedLegacyEquivalence('declaresRevision', true, false), null);
  assert.equal(normalizedLegacyEquivalence('declaresRevision', false, true), null);
});

test('R2: legacy-null declaresExpansion vs derived false certifies as equivalent', async () => {
  const store = await fdaStore();
  normalizedOf(store, PRINCE).declaresExpansion = null;
  const plan = await audit(store);
  const finding = only(plan, PRINCE);
  assert.equal(finding.classification, 'equivalent_legacy_seedable');
  assert.deepEqual(finding.equivalencesUsed, ['R2']);
});

test('R2 counterexample: null vs derived TRUE stays a real difference', () => {
  assert.equal(normalizedLegacyEquivalence('declaresExpansion', null, true), null);
  // And an unrelated field never matches any rule.
  assert.equal(normalizedLegacyEquivalence('title', null, false), null);
  assert.equal(normalizedLegacyEquivalence('illnessStatement', null, 'text'), null);
});

// ── R3: retailerNames at both boundaries ────────────────────────────────────

test('R3 normalized: legacy-null retailerNames vs derived [] certifies as equivalent', async () => {
  const store = await fdaStore();
  normalizedOf(store, PRINCE).retailerNames = null;
  const plan = await audit(store);
  const finding = only(plan, PRINCE);
  assert.equal(finding.classification, 'equivalent_legacy_seedable');
  assert.deepEqual(finding.equivalencesUsed, ['R3-normalized']);
});

test('R3 projection: legacy-null projection retailerNames vs derived [] certifies', async () => {
  const store = await fsisStore();
  const caseRow = caseOf(store, '017-2026');
  (caseRow.projection as unknown as Record<string, unknown>).retailerNames = null;
  const plan = await audit(store);
  const finding = only(plan, '017-2026');
  assert.equal(finding.classification, 'equivalent_legacy_seedable');
  assert.deepEqual(finding.equivalencesUsed, ['R3-projection']);
});

test('R3 counterexample: a nonempty derived retailer list stays a real difference', () => {
  assert.equal(normalizedLegacyEquivalence('retailerNames', null, ['Costco']), null);
  assert.equal(projectionLegacyEquivalence('retailerNames', null, ['Costco']), null);
  // Empty vs nonempty is a difference in both directions.
  assert.equal(normalizedLegacyEquivalence('retailerNames', [], ['Costco']), null);
  assert.equal(projectionLegacyEquivalence('retailerNames', ['Costco'], []), null);
});

test('R3 preservation: a stored affirmative retailer value is never treated as empty', async () => {
  const store = await fdaStore();
  normalizedOf(store, PRINCE).retailerNames = ['Costco'];
  const plan = await audit(store);
  const finding = only(plan, PRINCE);
  // The stored value also flows into the recomputed projection, so the
  // refusal is the stricter multiple_findings — never an equivalence.
  assert.equal(finding.classification, 'multiple_findings');
  assert.equal(finding.seedable, false);
  assert.deepEqual(finding.equivalencesUsed, []);
  assert.ok(finding.fieldDiffs.some((d) => d.field === 'normalized.retailerNames'));
});

// ── R4: officialClasses through the domain accessors ────────────────────────

test('R4: a legacy classification missing officialClasses with identical semantics certifies', async () => {
  const store = await fsisStore();
  const caseRow = caseOf(store, '017-2026');
  const classification = caseRow.projection.classification as unknown as Record<string, unknown>;
  assert.ok('officialClasses' in classification, 'fixture must carry the modern shape');
  delete classification.officialClasses;
  const plan = await audit(store);
  const finding = only(plan, '017-2026');
  assert.equal(finding.classification, 'equivalent_legacy_seedable');
  assert.deepEqual(finding.equivalencesUsed, ['R4']);
});

test('R4 counterexample: a genuinely NEW official class is never equivalent', () => {
  // Legacy scalar names no class (fallback []) but derivation now carries one.
  assert.equal(
    projectionLegacyEquivalence(
      'classification',
      { value: 'not_yet_classified', sourceText: null },
      { value: 'not_yet_classified', sourceText: null, officialClasses: ['class_I'] },
    ),
    null,
  );
});

test('R4 counterexample: a different severity, tier, or class set is never equivalent', () => {
  // Same scalar, but the set says the agency classified products differently:
  // legacy fallback {class_I} (critical) vs {class_I, class_II} (high).
  assert.equal(
    projectionLegacyEquivalence(
      'classification',
      { value: 'class_I', sourceText: 'High - Class I' },
      { value: 'class_I', sourceText: 'High - Class I', officialClasses: ['class_I', 'class_II'] },
    ),
    null,
  );
  // A different scalar value is caught by the identical-fields gate.
  assert.equal(
    projectionLegacyEquivalence(
      'classification',
      { value: 'class_I', sourceText: 'x' },
      { value: 'class_II', sourceText: 'x', officialClasses: ['class_II'] },
    ),
    null,
  );
  // A stored shape that already HAS the set never uses the legacy rule.
  assert.equal(
    projectionLegacyEquivalence(
      'classification',
      { value: 'class_I', sourceText: 'x', officialClasses: [] },
      { value: 'class_I', sourceText: 'x', officialClasses: ['class_I'] },
    ),
    null,
  );
});

test('R4 positive at the accessor level: identical semantics through the legacy fallback', () => {
  assert.equal(
    projectionLegacyEquivalence(
      'classification',
      { value: 'class_I', sourceText: 'High - Class I' },
      { value: 'class_I', sourceText: 'High - Class I', officialClasses: ['class_I'] },
    ),
    'R4',
  );
  assert.equal(
    projectionLegacyEquivalence(
      'classification',
      { value: 'not_yet_classified', sourceText: null },
      { value: 'not_yet_classified', sourceText: null, officialClasses: [] },
    ),
    'R4',
  );
});

// ── Combinations ────────────────────────────────────────────────────────────

test('multiple accepted equivalences certify one record with every rule tagged', async () => {
  const store = await fdaStore();
  const normalized = normalizedOf(store, PRINCE);
  normalized.declaresRevision = null;
  normalized.declaresExpansion = null;
  normalized.retailerNames = null;
  const caseRow = caseOf(store, PRINCE);
  (caseRow.projection as unknown as Record<string, unknown>).retailerNames = null;
  delete (caseRow.projection.classification as unknown as Record<string, unknown>).officialClasses;
  const plan = await audit(store);
  const finding = only(plan, PRINCE);
  assert.equal(finding.classification, 'equivalent_legacy_seedable');
  assert.deepEqual(finding.equivalencesUsed, ['R1', 'R2', 'R3-normalized', 'R3-projection', 'R4']);
  assert.equal(plan.summary.seedableCount, 1);
});

test('an accepted equivalence beside one real drift still refuses the record', async () => {
  const store = await fdaStore();
  const normalized = normalizedOf(store, PRINCE);
  normalized.declaresRevision = null;
  normalized.title = 'A different stored title';
  const plan = await audit(store);
  const finding = only(plan, PRINCE);
  // The drifted title also flows into the recomputed projection, so this is
  // the stricter multiple_findings refusal.
  assert.equal(finding.classification, 'multiple_findings');
  assert.equal(finding.seedable, false);
  // The rule fired (documented) but certifies nothing beside real drift.
  assert.deepEqual(finding.equivalencesUsed, ['R1']);
  assert.ok(finding.fieldDiffs.some((d) => d.field === 'normalized.title'));
  assert.ok(!finding.fieldDiffs.some((d) => d.field === 'normalized.declaresRevision'));
  assert.equal(plan.summary.seedableCount, 0);
});

// ── Marker-state gating: only apply_state IS NULL compares under the rules ──

test('an applied record stays strictly checked — the same pair is drift there', async () => {
  const store = await fdaStore(false); // markers kept: the O3-applied state
  normalizedOf(store, PRINCE).declaresRevision = null;
  const plan = await audit(store);
  const finding = only(plan, PRINCE);
  assert.equal(finding.classification, 'normalized_drift');
  assert.equal(finding.seedable, false);
  assert.deepEqual(finding.equivalencesUsed, []);
  assert.ok(finding.fieldDiffs.some((d) => d.field === 'normalized.declaresRevision'));
});

test('a pending record stays strictly checked', async () => {
  const store = await fdaStore();
  const row = record(store, PRINCE);
  row.applyState = 'pending';
  normalizedOf(store, PRINCE).declaresRevision = null;
  const plan = await audit(store);
  const finding = only(plan, PRINCE);
  assert.equal(finding.classification, 'pending_current_version');
  assert.equal(finding.seedable, false);
  assert.deepEqual(finding.equivalencesUsed, []);
  assert.ok(finding.fieldDiffs.some((d) => d.field === 'normalized.declaresRevision'));
});

test('an applied_degraded record stays strictly checked', async () => {
  const store = await fdaStore(false);
  const row = record(store, PRINCE);
  row.applyState = 'applied_degraded'; // marker fields stay consistent
  normalizedOf(store, PRINCE).declaresRevision = null;
  const plan = await audit(store);
  const finding = only(plan, PRINCE);
  assert.equal(finding.classification, 'normalized_drift');
  assert.deepEqual(finding.equivalencesUsed, []);
});

test('the modern O3 path is untouched: a fresh ingest audits as applied-consistent with no equivalences', async () => {
  const store = await fdaStore(false);
  const plan = await audit(store);
  const finding = only(plan, PRINCE);
  assert.equal(finding.classification, 'already_applied_consistent');
  assert.deepEqual(finding.equivalencesUsed, []);
  assert.equal(plan.summary.populationVerdict, 'fully_consistent');
  assert.equal(plan.summary.seedableCount, 0);
});

// ── Multi-source groups ─────────────────────────────────────────────────────

test('a multi-source group certifies when its only relaxation is an accepted equivalence', async () => {
  const store = await multiSourceStore();
  const caseRow = caseOf(store, '017-2026');
  delete (caseRow.projection.classification as unknown as Record<string, unknown>).officialClasses;
  const plan = await audit(store);
  assert.equal(only(plan, '017-2026').classification, 'equivalent_legacy_seedable');
  assert.equal(only(plan, 'F-2000-2026').classification, 'equivalent_legacy_seedable');
  assert.deepEqual(only(plan, 'F-2000-2026').equivalencesUsed, ['R4']);
  assert.equal(plan.summary.seedableCount, 2);
});

test('one real sibling mismatch still blocks the whole group', async () => {
  const store = await multiSourceStore();
  const caseRow = caseOf(store, '017-2026');
  delete (caseRow.projection.classification as unknown as Record<string, unknown>).officialClasses;
  // A stored affirmative declaresRevision (true) against a derivation that
  // carries no such declaration is REAL record-level drift — the reversed
  // direction of R1 — and it never feeds the projection, so the case itself
  // stays clean and the sibling gate is what refuses the group.
  normalizedOf(store, '017-2026').declaresRevision = true;
  const plan = await audit(store);
  assert.equal(only(plan, '017-2026').classification, 'normalized_drift');
  const blocked = only(plan, 'F-2000-2026');
  assert.equal(blocked.classification, 'case_blocked_by_sibling');
  assert.equal(blocked.seedable, false);
  assert.equal(plan.summary.seedableCount, 0);
});

// ── No broad consumer-inert rule ────────────────────────────────────────────

test('a consumer-inert but non-equivalent difference remains refused (illness text)', async () => {
  const store = await fsisStore();
  normalizedOf(store, '017-2026').illnessStatement = 'A different stored sentence.';
  const plan = await audit(store);
  const finding = only(plan, '017-2026');
  // Refused (the statement also reaches the recomputed projection).
  assert.equal(finding.classification, 'multiple_findings');
  assert.equal(finding.seedable, false);
  assert.deepEqual(finding.equivalencesUsed, []);
});

test('geography, instructions, firm, hazard, status, and products all stay strict', async () => {
  const mutations: [string, (store: MemoryStore) => void, string][] = [
    [
      'geography',
      (s) => {
        normalizedOf(s, '017-2026').geography = {
          scope: 'states',
          states: ['Texas'],
          confidence: 'stated',
          sourceText: 'Texas',
        };
      },
      'multiple_findings',
    ],
    [
      'consumerAction',
      (s) => {
        normalizedOf(s, '017-2026').consumerAction = 'Different instructions.';
      },
      'multiple_findings',
    ],
    [
      'firmDisplayName',
      (s) => {
        normalizedOf(s, '017-2026').firmDisplayName = 'Some Other Firm';
      },
      'multiple_findings',
    ],
    [
      'pathogenOrAllergen',
      (s) => {
        normalizedOf(s, '017-2026').pathogenOrAllergen = 'peanut';
      },
      'multiple_findings',
    ],
    [
      'case status',
      (s) => {
        (caseOf(s, '017-2026').projection as unknown as Record<string, unknown>).state = 'closed';
      },
      'case_projection_drift',
    ],
    [
      'products',
      (s) => {
        s.products.set(record(s, '017-2026').recallCaseId, []);
      },
      'affected_products_drift',
    ],
  ];
  for (const [label, mutate, expected] of mutations) {
    const store = await fsisStore();
    mutate(store);
    const plan = await audit(store);
    const finding = only(plan, '017-2026');
    assert.equal(finding.classification, expected, `${label} must stay strict`);
    assert.equal(finding.seedable, false, `${label} must not be seedable`);
    assert.deepEqual(finding.equivalencesUsed, [], `${label} must use no equivalence`);
  }
});

// ── Determinism, contract binding, and apply revalidation ───────────────────

test('page-size boundaries never change the plan or its digest (equivalences included)', async () => {
  const store = await multiSourceStore();
  const caseRow = caseOf(store, '017-2026');
  delete (caseRow.projection.classification as unknown as Record<string, unknown>).officialClasses;
  const one = await audit(store);
  const two = await auditAppliedState(store, {
    gitCommit: GIT,
    now: NOW,
    pageSizes: {
      records: 1,
      health: 1,
      cases: 1,
      caseTokens: 1,
      products: 1,
      initialEvents: 1,
      payloadChunk: 1,
    },
  });
  assert.equal(one.planDigest, two.planDigest);
  assert.deepEqual(one.records, two.records);
  assert.deepEqual(one.seedable, two.seedable);
});

test('plan generation and apply share one equivalence contract; a mismatch fails closed', async () => {
  const store = await multiSourceStore();
  const caseRow = caseOf(store, '017-2026');
  delete (caseRow.projection.classification as unknown as Record<string, unknown>).officialClasses;
  const plan = await audit(store);
  assert.equal(plan.equivalenceContract, LEGACY_EQUIVALENCE_CONTRACT);

  // A plan claiming a DIFFERENT contract version is refused even with a
  // self-consistent digest — generation/apply comparison skew is impossible.
  const skewed = { ...plan, equivalenceContract: 'legacy-equivalence/0' };
  skewed.planDigest = planContentDigest(skewed);
  await assert.rejects(
    applySeedPlan(store, skewed, { expectedDigest: skewed.planDigest, currentGitCommit: GIT }),
    (error: unknown) =>
      error instanceof PlanValidationError && /equivalence contract/.test(error.message),
  );

  // The genuine plan applies, seeding exactly the audited entries.
  const report = await applySeedPlan(store, plan, {
    expectedDigest: plan.planDigest,
    currentGitCommit: GIT,
    now: NOW,
  });
  assert.equal(report.seeded, plan.seedable.length);
  assert.equal(report.conflicts, 0);
  for (const entry of plan.seedable) {
    const row = record(store, entry.nativeId);
    assert.equal(row.applyState, 'applied');
    assert.equal(row.appliedContentHash, entry.snapshotHash);
    assert.equal(row.appliedSnapshotSeq, entry.snapshotSeq);
    assert.ok(row.appliedAt);
  }
});

test('an old plan/1 artifact can never be reinterpreted under the new rules', async () => {
  const store = await fsisStore();
  const plan = await audit(store);
  const legacyShaped = {
    ...plan,
    schemaVersion: 'recall-applied-state-plan/1',
  } as unknown as ReconcilePlan;
  legacyShaped.planDigest = planContentDigest(legacyShaped);
  await assert.rejects(
    applySeedPlan(store, legacyShaped, {
      expectedDigest: legacyShaped.planDigest,
      currentGitCommit: GIT,
    }),
    (error: unknown) => error instanceof PlanValidationError && /plan schema/.test(error.message),
  );
});

// ── Comparison side effects: none ───────────────────────────────────────────

test('equivalence comparison mutates nothing — legacy nulls stay null after the audit', async () => {
  const store = await fdaStore();
  const normalized = normalizedOf(store, PRINCE);
  normalized.declaresRevision = null;
  normalized.retailerNames = null;
  const caseRow = caseOf(store, PRINCE);
  delete (caseRow.projection.classification as unknown as Record<string, unknown>).officialClasses;
  const before = durableState(store);
  await audit(store);
  assert.deepEqual(durableState(store), before);
  assert.equal(normalized.declaresRevision, null);
  assert.equal(normalized.retailerNames, null);
  assert.equal(
    'officialClasses' in (caseRow.projection.classification as unknown as Record<string, unknown>),
    false,
  );
});

test('equivalence comparison never touches notification or material-change machinery', async () => {
  const store = await fdaStore();
  normalizedOf(store, PRINCE).declaresRevision = null;
  const eventsBefore = structuredClone([...store.notifications.entries()]);
  const plan = await audit(store);
  assert.deepEqual([...store.notifications.entries()], eventsBefore);
  assert.equal(plan.summary.notificationEventsWritten, 0);
  assert.equal(plan.summary.deliveriesWritten, 0);
  // The reconciler has no path into the change detector at all.
  const source = readFileSync(new URL('./applied-state-reconcile.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('material-change'));
  assert.ok(!source.includes('detectChanges'));
});
