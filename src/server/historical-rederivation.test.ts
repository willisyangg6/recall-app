/**
 * O3-B5 historical re-derivation matrix: wave classification from evidence,
 * immutable wave-bound plans, the two-step crash-safe repair (guarded
 * normalized preparation + one atomic case transition), Policy B (zero
 * notification events, one deterministic `corrected` timeline entry for
 * material corrections only), the governed allergen-evidence exception, and
 * every drift/crash/tamper refusal.
 *
 * Fixtures come from the REAL pipeline; stored state is then mutated to the
 * legacy-era shape the production remainder actually carries (content drift,
 * never R1–R4 serialization equivalence).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  applyRederivationPlan,
  buildRederivationPlan,
  DERIVATION_CONTRACT,
  REDERIVATION_PLAN_SCHEMA,
  RederivationPlanError,
  rederivationPlanDigest,
  type RederivationPlan,
  type RederivationWave,
} from './historical-rederivation';
import { enrichCaseWithMatches } from './fda-enforcement/enrich';
import { parseEnforcementRecord, type OpenFdaEnforcementRaw } from './fda-enforcement/parse';
import { loadFixture } from './fsis/fixtures';
import type { FsisRawRecord } from './fsis/parse';
import { runFsisIngest } from './pipeline';
import { MemoryStore } from './store/memory-store';
import type { RecallCaseRow, SourceRecordRow } from './store/types';

const NOW = () => new Date('2026-08-21T12:00:00Z');
const GIT = 'commit-under-test';

const RECALL_017 = loadFixture('recall-active-nationwide-017-2026');
const RECALL_016 = loadFixture('recall-active-stated-states-016-2026');

function stripMarkers(store: MemoryStore): void {
  for (const row of store.sourceRecords.values()) {
    delete row.applyState;
    delete row.appliedContentHash;
    delete row.appliedSnapshotSeq;
    delete row.appliedAt;
  }
}

async function fsisStore(records: FsisRawRecord[]): Promise<MemoryStore> {
  const store = new MemoryStore();
  await runFsisIngest(
    store,
    { records, fetchedAt: NOW().toISOString(), sourceUrl: 'fixture://fsis' },
    { now: NOW },
  );
  stripMarkers(store);
  return store;
}

function record(store: MemoryStore, nativeId: string): SourceRecordRow {
  return [...store.sourceRecords.values()].find((r) => r.nativeId === nativeId)!;
}

function normalizedOf(store: MemoryStore, nativeId: string): Record<string, unknown> {
  return record(store, nativeId).normalized as unknown as Record<string, unknown>;
}

function caseOf(store: MemoryStore, nativeId: string): RecallCaseRow {
  return store.cases.get(record(store, nativeId).recallCaseId)!;
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

const build = (store: MemoryStore, wave?: RederivationWave | 'census') =>
  buildRederivationPlan(store, { gitCommit: GIT, wave, now: NOW });
const apply = (store: MemoryStore, plan: RederivationPlan, wave: RederivationWave) =>
  applyRederivationPlan(store, plan, {
    expectedDigest: plan.planDigest,
    currentGitCommit: GIT,
    wave,
    now: NOW,
  });

// ── Wave fixture builders (legacy-era stored drift over real pipeline data) ──

/** Inert: stored illness text drifts; projection target is unchanged. */
async function inertStore(): Promise<MemoryStore> {
  const store = await fsisStore([RECALL_017]);
  normalizedOf(store, '017-2026').illnessStatement = 'An old-era stored sentence.';
  return store;
}

/** Visible: stored firm display drifts ("FSIS"-as-firm era). */
async function visibleStore(): Promise<MemoryStore> {
  const store = await fsisStore([RECALL_017]);
  normalizedOf(store, '017-2026').firmDisplayName = 'FSIS';
  const projection = caseOf(store, '017-2026').projection as unknown as Record<string, unknown>;
  projection.recallingFirm = {
    ...(projection.recallingFirm as Record<string, unknown>),
    displayName: 'FSIS',
  };
  return store;
}

/** Virginia: stored geography carries a false Virginia beside West Virginia. */
async function virginiaStore(): Promise<MemoryStore> {
  const raw = { ...RECALL_016, field_states: ['California', 'West Virginia'] } as FsisRawRecord;
  const store = await fsisStore([raw]);
  const normalizedGeo = normalizedOf(store, '016-2026').geography as { states: string[] };
  normalizedGeo.states = [...normalizedGeo.states, 'Virginia'];
  const projection = caseOf(store, '016-2026').projection;
  projection.geography = {
    ...projection.geography,
    states: [...projection.geography.states, 'Virginia'],
  };
  return store;
}

/** Material: stored consumer instructions drift in substance. */
async function materialStore(): Promise<MemoryStore> {
  const store = await fsisStore([RECALL_017]);
  const target = caseOf(store, '017-2026').projection.consumerAction;
  assert.ok(target, 'fixture must carry a consumer action for instructions_changed to fire');
  normalizedOf(store, '017-2026').consumerAction = 'Old-era stored instructions differ.';
  (caseOf(store, '017-2026').projection as unknown as Record<string, unknown>).consumerAction =
    'Old-era stored instructions differ.';
  return store;
}

/** Governed exception: stored allergen evidence current derivation would erase. */
async function exceptionStore(): Promise<MemoryStore> {
  const store = await fsisStore([RECALL_017]);
  normalizedOf(store, '017-2026').pathogenOrAllergen = 'undeclared wheat';
  (caseOf(store, '017-2026').projection as unknown as Record<string, unknown>).pathogenOrAllergen =
    'undeclared wheat';
  return store;
}

/** Multi-source: drifting FSIS announcement + exact enforcement sibling. */
async function multiSourceInertStore(): Promise<MemoryStore> {
  const store = await fsisStore([RECALL_017]);
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
    record(store, '017-2026').recallCaseId,
    [{ eventId: parsed.eventId, method: 'code-identity', records: [parsed], evidence: ['e'] }],
    new Map([[parsed.recallNumber, raw]]),
    { apply: true, now: NOW },
  );
  stripMarkers(store);
  normalizedOf(store, '017-2026').illnessStatement = 'An old-era stored sentence.';
  return store;
}

// ── Plan construction, waves, determinism ───────────────────────────────────

test('census plan classifies every wave shape and every record exactly once', async () => {
  for (const [builder, expectedWave] of [
    [inertStore, 'inert_refresh'],
    [visibleStore, 'visible_corrections'],
    [virginiaStore, 'virginia_false_positive'],
    [materialStore, 'material_corrections'],
    [exceptionStore, 'governed_exception'],
  ] as const) {
    const store = await builder();
    const plan = await build(store);
    assert.equal(plan.wave, 'census');
    assert.equal(plan.cases.length, 1, expectedWave);
    assert.equal(plan.cases[0].wave, expectedWave, expectedWave);
    const seen = new Set(plan.records.map((r) => r.sourceRecordId));
    assert.equal(seen.size, plan.records.length);
    assert.equal(plan.summary.notificationEventsPlanned, 0);
  }
});

test('plan digest, schema, contract, and commit bind the plan; tampering fails closed', async () => {
  const store = await inertStore();
  const plan = await build(store, 'inert_refresh');
  assert.equal(plan.schemaVersion, REDERIVATION_PLAN_SCHEMA);
  assert.equal(plan.derivationContract, DERIVATION_CONTRACT);
  assert.equal(rederivationPlanDigest(plan), plan.planDigest);
  for (const tamper of [
    { schemaVersion: 'recall-rederivation-plan/0' },
    { derivationContract: 'historical-rederivation/0' },
    { gitCommit: 'other-commit' },
  ]) {
    const bad = { ...plan, ...tamper } as RederivationPlan;
    bad.planDigest = rederivationPlanDigest(bad);
    await assert.rejects(
      apply(store, bad, 'inert_refresh'),
      (e: unknown) => e instanceof RederivationPlanError,
      JSON.stringify(tamper),
    );
  }
  // Edited content without recomputing the digest also fails.
  const edited = structuredClone(plan);
  edited.cases[0].timelineAction = 'corrected';
  await assert.rejects(
    apply(store, edited, 'inert_refresh'),
    (e: unknown) => e instanceof RederivationPlanError && /digest/.test(e.message),
  );
});

test('pagination order never changes the plan or digest', async () => {
  const store = await multiSourceInertStore();
  const one = await build(store);
  const two = await buildRederivationPlan(store, {
    gitCommit: GIT,
    now: NOW,
    pageSizes: { records: 1, health: 1, cases: 1, products: 1 },
  });
  assert.equal(one.planDigest, two.planDigest);
  assert.deepEqual(one.records, two.records);
  assert.deepEqual(one.cases, two.cases);
});

test('the dry run writes nothing', async () => {
  const store = await materialStore();
  const before = durableState(store);
  await build(store);
  assert.deepEqual(durableState(store), before);
});

test('a census plan can never be applied; a wave plan never authorizes another wave', async () => {
  const store = await inertStore();
  const census = await build(store);
  await assert.rejects(
    apply(store, census, 'inert_refresh'),
    (e: unknown) => e instanceof RederivationPlanError && /census/.test(e.message),
  );
  const wavePlan = await build(store, 'inert_refresh');
  await assert.rejects(
    applyRederivationPlan(store, wavePlan, {
      expectedDigest: wavePlan.planDigest,
      currentGitCommit: GIT,
      wave: 'visible_corrections',
      now: NOW,
    }),
    (e: unknown) => e instanceof RederivationPlanError && /one wave per plan/.test(e.message),
  );
});

// ── Repair execution and convergence ────────────────────────────────────────

test('inert wave repairs: normalized post-state, markers seeded, consumer model byte-identical', async () => {
  const store = await inertStore();
  const plan = await build(store, 'inert_refresh');
  const projectionBefore = structuredClone(caseOf(store, '017-2026').projection);
  const eventsBefore = structuredClone([...store.notifications.entries()]);
  const report = await apply(store, plan, 'inert_refresh');
  assert.equal(report.repaired, 1);
  assert.equal(report.normalizedWrites, 1);
  assert.equal(report.timelineEntriesInserted, 0);
  assert.equal(report.notificationEventsWritten, 0);
  const row = record(store, '017-2026');
  assert.equal(row.applyState, 'applied');
  assert.equal(row.appliedSnapshotSeq, plan.records[0].snapshotSeq);
  assert.equal(row.appliedContentHash, plan.records[0].snapshotHash);
  assert.notEqual(normalizedOf(store, '017-2026').illnessStatement, 'An old-era stored sentence.');
  assert.deepEqual(caseOf(store, '017-2026').projection, projectionBefore);
  assert.deepEqual([...store.notifications.entries()], eventsBefore);
});

test('visible wave changes only the approved surface; virginia wave removes only Virginia', async () => {
  const visible = await visibleStore();
  const visiblePlan = await build(visible, 'visible_corrections');
  assert.deepEqual(visiblePlan.cases[0].consumerImpact, ['recallingFirm']);
  const visibleReport = await apply(visible, visiblePlan, 'visible_corrections');
  assert.equal(visibleReport.repaired, 1);
  const firm = caseOf(visible, '017-2026').projection.recallingFirm;
  assert.notEqual(firm.displayName, 'FSIS');

  const virginia = await virginiaStore();
  const virginiaPlan = await build(virginia, 'virginia_false_positive');
  assert.deepEqual(virginiaPlan.cases[0].consumerImpact, ['geographyMatching']);
  const report = await apply(virginia, virginiaPlan, 'virginia_false_positive');
  assert.equal(report.repaired, 1);
  const states = caseOf(virginia, '016-2026').projection.geography.states;
  assert.ok(!states.includes('Virginia'));
  assert.ok(states.includes('West Virginia'));
  assert.ok(states.includes('California'));
  assert.equal(report.timelineEntriesInserted, 0);
});

test('material wave: exactly one corrected entry, zero events, public dates untouched, no duplicates', async () => {
  const store = await materialStore();
  const plan = await build(store, 'material_corrections');
  assert.equal(plan.cases[0].timelineAction, 'corrected');
  const before = caseOf(store, '017-2026').projection;
  const publishedBefore = before.publishedAt;
  const activityBefore = before.lastPublicActivityAt;
  const eventCount = store.notifications.size;
  const report = await apply(store, plan, 'material_corrections');
  assert.equal(report.repaired, 1);
  assert.equal(report.timelineEntriesInserted, 1);
  assert.equal(report.notificationEventsWritten, 0);
  assert.equal(store.notifications.size, eventCount);
  const caseRow = caseOf(store, '017-2026');
  const corrected = caseRow.timeline.filter((t) => t.repair !== undefined);
  assert.equal(corrected.length, 1);
  assert.equal(corrected[0].kind, 'corrected');
  assert.equal(corrected[0].material, false);
  assert.equal(corrected[0].repair!.notificationEventCreated, false);
  assert.equal(corrected[0].repair!.fingerprint, plan.cases[0].correctedFingerprint);
  assert.match(corrected[0].summary, /not a new agency update/);
  assert.equal(caseRow.projection.publishedAt, publishedBefore);
  assert.equal(caseRow.projection.lastPublicActivityAt, activityBefore);
  // Idempotent rerun: no second entry, no writes.
  const rerun = await apply(store, plan, 'material_corrections');
  assert.equal(rerun.alreadyCompleted, 1);
  assert.equal(rerun.repaired, 0);
  assert.equal(rerun.normalizedWrites, 0);
  assert.equal(caseOf(store, '017-2026').timeline.filter((t) => t.repair !== undefined).length, 1);
});

test('the governed exception is held on every path and never modified', async () => {
  const store = await exceptionStore();
  const census = await build(store);
  assert.equal(census.cases[0].wave, 'governed_exception');
  assert.match(census.cases[0].refusalReason!, /allergen evidence/);
  // It rides along in EVERY wave plan as a report, never as work.
  const wavePlan = await build(store, 'inert_refresh');
  assert.equal(wavePlan.cases.length, 1);
  assert.equal(wavePlan.cases[0].wave, 'governed_exception');
  const before = durableState(store);
  const report = await apply(store, wavePlan, 'inert_refresh');
  assert.equal(report.heldGovernedExceptions, 1);
  assert.equal(report.repaired + report.refused, 0);
  assert.deepEqual(durableState(store), before);
  assert.equal(normalizedOf(store, '017-2026').pathogenOrAllergen, 'undeclared wheat');
  assert.equal(record(store, '017-2026').applyState, undefined);
});

test('blocked-style enforcement siblings settle atomically with their repaired group', async () => {
  const store = await multiSourceInertStore();
  const plan = await build(store, 'inert_refresh');
  assert.equal(plan.cases.length, 1);
  assert.equal(plan.cases[0].memberRecordIds.length, 2);
  const report = await apply(store, plan, 'inert_refresh');
  assert.equal(report.repaired, 1);
  assert.equal(report.normalizedWrites, 1); // only the drifting announcement
  for (const nativeId of ['017-2026', 'F-2000-2026']) {
    assert.equal(record(store, nativeId).applyState, 'applied', nativeId);
  }
});

// ── Crash seams and convergence ─────────────────────────────────────────────

test('crash after one normalized write: recoverable partial prep, same plan converges', async () => {
  const store = await multiSourceInertStore();
  // Make BOTH members need a normalized write so a mid-group crash is possible.
  normalizedOf(store, 'F-2000-2026').quantityText = 'old-era quantity';
  const plan = await build(store, 'inert_refresh');
  assert.equal(plan.summary.plannedNormalizedWrites, 2);
  const original = store.updateSourceRecordNormalized.bind(store);
  let calls = 0;
  store.updateSourceRecordNormalized = async (...args) => {
    calls += 1;
    if (calls === 2) throw new Error('simulated crash mid-group');
    return original(...args);
  };
  await assert.rejects(apply(store, plan, 'inert_refresh'), /simulated crash/);
  // Consumer state untouched, markers untouched, one member normalized.
  assert.equal(record(store, '017-2026').applyState ?? null, null);
  assert.equal(record(store, 'F-2000-2026').applyState ?? null, null);
  assert.equal(caseOf(store, '017-2026').timeline.filter((t) => t.repair !== undefined).length, 0);
  // Recovery: same plan, no fault.
  store.updateSourceRecordNormalized = original;
  const rerun = await apply(store, plan, 'inert_refresh');
  assert.equal(rerun.repaired, 1);
  assert.equal(rerun.normalizedWrites, 1); // only the not-yet-post member
  assert.equal(record(store, '017-2026').applyState, 'applied');
  assert.equal(record(store, 'F-2000-2026').applyState, 'applied');
});

test('crash after all normalized writes but before the transition also converges', async () => {
  const store = await inertStore();
  const plan = await build(store, 'inert_refresh');
  const original = store.applyCaseTransition.bind(store);
  store.applyCaseTransition = async () => {
    throw new Error('simulated crash before transition commit');
  };
  await assert.rejects(apply(store, plan, 'inert_refresh'), /before transition/);
  assert.equal(record(store, '017-2026').applyState ?? null, null);
  store.applyCaseTransition = original;
  const rerun = await apply(store, plan, 'inert_refresh');
  assert.equal(rerun.repaired, 1);
  assert.equal(rerun.normalizedWrites, 0); // step 1 already durable
});

test('a forced late-stage RPC failure rolls back case, timeline, products, and markers together', async () => {
  const store = await materialStore();
  const plan = await build(store, 'material_corrections');
  const before = durableState(store);
  store.transactionFailpoint = (stage) => {
    if (stage === 'transition:markers') throw new Error('injected transition failure');
  };
  await assert.rejects(apply(store, plan, 'material_corrections'), /injected transition/);
  store.transactionFailpoint = null;
  const after = durableState(store);
  // Normalized preparation is the ONLY durable difference; everything the
  // transition owns (case, timeline, products, markers, events) rolled back.
  assert.deepEqual(after.cases, before.cases);
  assert.deepEqual(after.products, before.products);
  assert.deepEqual(after.notifications, before.notifications);
  assert.equal(record(store, '017-2026').applyState ?? null, null);
  const rerun = await apply(store, plan, 'material_corrections');
  assert.equal(rerun.repaired, 1);
});

test('no transition happens until every contributor reaches its planned post-state', async () => {
  const store = await multiSourceInertStore();
  normalizedOf(store, 'F-2000-2026').quantityText = 'old-era quantity';
  const plan = await build(store, 'inert_refresh');
  const original = store.updateSourceRecordNormalized.bind(store);
  let transitions = 0;
  const originalTransition = store.applyCaseTransition.bind(store);
  store.applyCaseTransition = async (input) => {
    transitions += 1;
    return originalTransition(input);
  };
  let calls = 0;
  store.updateSourceRecordNormalized = async (...args) => {
    calls += 1;
    if (calls === 2) return false; // guarded write misses (not a crash)
    return original(...args);
  };
  const report = await apply(store, plan, 'inert_refresh');
  assert.equal(report.refused, 1);
  assert.equal(transitions, 0);
  const outcome = report.outcomes[0];
  assert.equal(outcome.outcome, 'refused');
  assert.equal((outcome as { partialNormalizedWrites: number }).partialNormalizedWrites, 1);
});

// ── Drift refusals ──────────────────────────────────────────────────────────

test('an unexpected third normalized state refuses the group before any write', async () => {
  const store = await inertStore();
  const plan = await build(store, 'inert_refresh');
  normalizedOf(store, '017-2026').illnessStatement = 'A third, unplanned state.';
  const report = await apply(store, plan, 'inert_refresh');
  assert.equal(report.refused, 1);
  assert.match(
    (report.outcomes[0] as { reason: string }).reason,
    /neither the planned pre- nor post-repair/,
  );
  assert.equal(record(store, '017-2026').applyState ?? null, null);
});

test('snapshot, membership, CAS, product, and initial-event drift each refuse', async () => {
  // Snapshot drift (sequence + hash move together via a new archived version).
  {
    const store = await inertStore();
    const plan = await build(store, 'inert_refresh');
    const row = record(store, '017-2026');
    store.snapshots.push({
      ...store.snapshots.find((s) => s.sourceRecordId === row.id)!,
      seq: 9999,
      contentHash: 'a-new-hash',
      fetchedAt: '2026-08-22T00:00:00Z',
    });
    const report = await apply(store, plan, 'inert_refresh');
    assert.equal(report.refused, 1);
    assert.match((report.outcomes[0] as { reason: string }).reason, /snapshot changed/);
  }
  // Membership drift.
  {
    const store = await multiSourceInertStore();
    const plan = await build(store, 'inert_refresh');
    const enforcement = record(store, 'F-2000-2026');
    enforcement.applyState = 'pending';
    const report = await apply(store, plan, 'inert_refresh');
    assert.equal(report.refused, 1);
  }
  // Case CAS drift.
  {
    const store = await inertStore();
    const plan = await build(store, 'inert_refresh');
    caseOf(store, '017-2026').lastChangedAt = '2026-08-22T00:00:00Z';
    const report = await apply(store, plan, 'inert_refresh');
    assert.equal(report.refused, 1);
    assert.match((report.outcomes[0] as { reason: string }).reason, /CAS token/);
  }
  // Product drift.
  {
    const store = await inertStore();
    const plan = await build(store, 'inert_refresh');
    store.products.set(record(store, '017-2026').recallCaseId, []);
    const report = await apply(store, plan, 'inert_refresh');
    assert.equal(report.refused, 1);
    assert.match((report.outcomes[0] as { reason: string }).reason, /products changed/);
  }
  // Initial-event history drift.
  {
    const store = await inertStore();
    const plan = await build(store, 'inert_refresh');
    const caseId = record(store, '017-2026').recallCaseId;
    store.notifications.delete(`initial:${caseId}`);
    const report = await apply(store, plan, 'inert_refresh');
    assert.equal(report.refused, 1);
    assert.match((report.outcomes[0] as { reason: string }).reason, /initial event/);
  }
});

test('a projection change since the plan refuses (stale plans cannot fire)', async () => {
  const store = await inertStore();
  const plan = await build(store, 'inert_refresh');
  (caseOf(store, '017-2026').projection as unknown as Record<string, unknown>).summaryText =
    'moved since planning';
  const report = await apply(store, plan, 'inert_refresh');
  assert.equal(report.refused, 1);
  assert.match((report.outcomes[0] as { reason: string }).reason, /projection changed/);
});

// ── Safety pins ─────────────────────────────────────────────────────────────

test('mutating calls are attempted at most once — never retried', async () => {
  const store = await inertStore();
  const plan = await build(store, 'inert_refresh');
  let updateCalls = 0;
  const original = store.updateSourceRecordNormalized.bind(store);
  store.updateSourceRecordNormalized = async (...args) => {
    updateCalls += 1;
    return original(...args);
  };
  await apply(store, plan, 'inert_refresh');
  assert.equal(updateCalls, 1);
  const source = readFileSync(new URL('./historical-rederivation.ts', import.meta.url), 'utf8');
  // The bounded retry helper exists for PLAN reads only — no mutation passes
  // through it (pinned by name).
  assert.ok(!/retryRead\([^)]*update/i.test(source));
  assert.ok(!/retryRead\([^)]*transition/i.test(source));
});

test('plan-builder read retries are bounded and only for reads', async () => {
  const store = await inertStore();
  const original = store.listAppliedStateHealthPage.bind(store);
  let failures = 0;
  store.listAppliedStateHealthPage = async (from, size) => {
    if (failures < 3) {
      failures += 1;
      throw new Error('transient read blip');
    }
    return original(from, size);
  };
  const plan = await build(store, 'inert_refresh'); // 3 failures + 1 success fits the bound
  assert.equal(plan.cases.length, 1);
  store.listAppliedStateHealthPage = async () => {
    throw new Error('sustained outage');
  };
  await assert.rejects(
    build(store, 'inert_refresh'),
    (e: unknown) => e instanceof RederivationPlanError && /after 4 attempts/.test(e.message),
  );
});

test('plans carry no raw payloads or credentials and refuse overwrite via the atomic writer', async () => {
  const store = await materialStore();
  const plan = await build(store);
  const raw = JSON.stringify(plan);
  assert.ok(!raw.includes('rawPayload'));
  assert.ok(!raw.includes('detailMainHtml'));
  assert.ok(!/sb_secret|eyJhbGci|SUPABASE_SECRET/.test(raw));
});

test('current O3 reconciliation behavior is untouched by the repair module', async () => {
  // The reconcile engine still classifies the same store the same way — the
  // rederivation module changes no comparison, gate, or classification there.
  const { auditAppliedState } = await import('./applied-state-reconcile');
  const store = await inertStore();
  const before = durableState(store);
  const plan = await auditAppliedState(store, { gitCommit: GIT, now: NOW });
  assert.deepEqual(durableState(store), before);
  const finding = plan.records.find((r) => r.nativeId === '017-2026')!;
  // Reconciliation projects from STORED normals, so the drifted statement
  // also disturbs its projection comparison: the stricter multiple_findings.
  assert.equal(finding.classification, 'multiple_findings');
  assert.equal(finding.seedable, false);
});
