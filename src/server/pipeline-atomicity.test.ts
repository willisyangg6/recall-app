/**
 * O3-B1 failure-injection matrix: every crash window O3-A proved silent must
 * now be pending-and-retryable, and the consumer transition (case + products
 * + events + markers) must be all-or-nothing. Each test asserts the durable
 * state AFTER the injected failure and AFTER the retry, against MemoryStore —
 * whose transactional ops stage every mutation and commit only past the last
 * failpoint, mirroring the SQL functions' single transactions.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFixture } from './fsis/fixtures';
import type { FsisRawRecord } from './fsis/parse';
import { runFsisIngest } from './pipeline';
import { MemoryStore, type TransactionStage } from './store/memory-store';

const NOW = () => new Date('2026-08-21T12:00:00Z');

function input(records: FsisRawRecord[], fetchedAt = NOW().toISOString()) {
  return {
    records,
    fetchedAt,
    sourceUrl: 'https://www.fsis.usda.gov/fsis/api/recall/v/1?field_translation_language=en',
  };
}

function derive(fixture: string, patch: Partial<FsisRawRecord>): FsisRawRecord {
  return { ...loadFixture(fixture), ...patch };
}

const RECALL = loadFixture('recall-active-nationwide-017-2026');
/** The O3-A reproduction edit: upstream adds an illness report (material). */
const RECALL_WITH_ILLNESS = derive('recall-active-nationwide-017-2026', {
  field_summary:
    String(RECALL.field_summary ?? '') +
    ' Three illnesses have been reported in connection with this product.',
});

/** Throw once at the named stage, then behave normally. */
function failOnceAt(store: MemoryStore, target: TransactionStage): () => number {
  let fired = 0;
  store.transactionFailpoint = (stage) => {
    if (stage === target && fired === 0) {
      fired += 1;
      store.transactionFailpoint = null;
      throw new Error(`injected failure at ${stage}`);
    }
  };
  return () => fired;
}

function materialEvents(store: MemoryStore) {
  return [...store.notifications.values()].filter((n) => n.kind === 'material_update');
}

function theCase(store: MemoryStore) {
  return [...store.cases.values()][0];
}

function theRecord(store: MemoryStore) {
  return [...store.sourceRecords.values()][0];
}

// ── The proven O3-A silent drop, at each prefix boundary ─────────────────────

test('snapshot archived, normalized write fails → pending, and the unchanged retry converges (the O3-A repro)', async () => {
  const store = new MemoryStore();
  await runFsisIngest(store, input([RECALL]), { now: NOW });
  assert.equal(theRecord(store).applyState, 'applied');

  // Crash between archive and the normalized write.
  const original = store.updateSourceRecordNormalized.bind(store);
  store.updateSourceRecordNormalized = async () => {
    store.updateSourceRecordNormalized = original;
    throw new Error('SupabaseStore.updateSourceRecordNormalized failed: connection reset');
  };
  const crashed = await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });

  // After the failure: archived but NOT applied — visibly pending, isolated.
  assert.equal(crashed.itemFailures.length, 1);
  assert.match(crashed.itemFailures[0].reason, /connection reset/);
  assert.equal(store.snapshots.length, 2);
  assert.equal(theRecord(store).applyState, 'pending');
  assert.equal(theCase(store).projection.reportsIllness, false); // stale, but honest
  assert.equal(materialEvents(store).length, 0);

  // The retry receives BYTE-IDENTICAL upstream content. Pre-O3 this was the
  // permanently silent drop (gate said unchanged, run said succeeded).
  const retry = await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });
  assert.equal(retry.unchanged, 0); // the gate refuses "unchanged" while pending
  assert.equal(retry.changedCases, 1);
  assert.equal(store.snapshots.length, 2); // no duplicate snapshot on re-apply
  assert.equal(theRecord(store).applyState, 'applied');
  assert.equal(theCase(store).projection.reportsIllness, true);
  const events = materialEvents(store);
  assert.equal(events.length, 1);
  assert.equal(events[0].triggerRuleId, 'health_impact');

  // And the run after that is a genuine no-op.
  const settled = await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });
  assert.equal(settled.unchanged, 1);
  assert.equal(materialEvents(store).length, 1);
});

test('normalized write succeeds, case transition fails → pending, retry converges without duplicates', async () => {
  const store = new MemoryStore();
  await runFsisIngest(store, input([RECALL]), { now: NOW });

  failOnceAt(store, 'transition:case');
  const crashed = await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });
  assert.equal(crashed.itemFailures.length, 1);
  assert.equal(theRecord(store).applyState, 'pending');
  assert.equal(theCase(store).projection.reportsIllness, false);
  assert.equal(materialEvents(store).length, 0);

  const retry = await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });
  assert.equal(retry.changedCases, 1);
  assert.equal(theRecord(store).applyState, 'applied');
  assert.equal(theCase(store).projection.reportsIllness, true);
  assert.equal(materialEvents(store).length, 1);
  assert.equal(store.snapshots.length, 2);
});

test('the case transition is all-or-nothing at every internal stage', async () => {
  for (const stage of [
    'transition:case',
    'transition:products',
    'transition:events',
    'transition:markers',
  ] as const) {
    const store = new MemoryStore();
    await runFsisIngest(store, input([RECALL]), { now: NOW });
    const caseBefore = structuredClone(theCase(store));
    const productsBefore = structuredClone([...store.products.values()][0]);
    const eventsBefore = store.notifications.size;

    failOnceAt(store, stage);
    const crashed = await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });
    assert.equal(crashed.itemFailures.length, 1, stage);

    // NOTHING from the transition committed: no case change, no product
    // change (in particular never an empty intermediate set), no event, no
    // marker completion — even when the failure hits AFTER the event stage.
    assert.deepEqual(theCase(store), caseBefore, stage);
    assert.deepEqual([...store.products.values()][0], productsBefore, stage);
    assert.equal(store.notifications.size, eventsBefore, stage);
    assert.equal(theRecord(store).applyState, 'pending', stage);

    // Retry commits the case and EXACTLY one event.
    await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });
    assert.equal(theCase(store).projection.reportsIllness, true, stage);
    assert.equal(materialEvents(store).length, 1, stage);
    assert.equal(theRecord(store).applyState, 'applied', stage);
  }
});

test('run bookkeeping fails after a fully committed item — the item never re-applies', async () => {
  const store = new MemoryStore();
  await runFsisIngest(store, input([RECALL]), { now: NOW });

  const original = store.finishIngestRun.bind(store);
  let failed = false;
  store.finishIngestRun = async (runId, patch) => {
    if (!failed) {
      failed = true;
      throw new Error('bookkeeping write lost');
    }
    return original(runId, patch);
  };
  // The item commits; only the run-completion write fails.
  await assert.rejects(
    () => runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW }),
    /bookkeeping write lost/,
  );
  assert.equal(theCase(store).projection.reportsIllness, true);
  assert.equal(theRecord(store).applyState, 'applied');
  assert.equal(materialEvents(store).length, 1);

  // The retry sees fully-applied-unchanged: no duplicate snapshot or event.
  const retry = await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });
  assert.equal(retry.unchanged, 1);
  assert.equal(store.snapshots.length, 2);
  assert.equal(materialEvents(store).length, 1);
});

// ── Founding: atomic, orphan-free, race-safe ─────────────────────────────────

test('a founding crash at every internal stage leaves NOTHING — no orphan case, ever', async () => {
  for (const stage of [
    'found:case',
    'found:record',
    'found:snapshot',
    'found:products',
    'found:initialEvent',
  ] as const) {
    const store = new MemoryStore();
    failOnceAt(store, stage);
    const crashed = await runFsisIngest(store, input([RECALL]), { now: NOW });
    assert.equal(crashed.itemFailures.length, 1, stage);
    assert.equal(store.cases.size, 0, `${stage}: no orphan case`);
    assert.equal(store.sourceRecords.size, 0, stage);
    assert.equal(store.snapshots.length, 0, stage);
    assert.equal(store.products.size, 0, stage);
    assert.equal(store.notifications.size, 0, stage);

    // The retry founds completely: one case, one record, one snapshot, one
    // initial event — never a duplicate from the interrupted attempt.
    const retry = await runFsisIngest(store, input([RECALL]), { now: NOW });
    assert.equal(retry.newCases, 1, stage);
    assert.equal(store.cases.size, 1, stage);
    assert.equal(
      [...store.notifications.values()].filter((n) => n.kind === 'initial').length,
      1,
      stage,
    );
  }
});

test('concurrent founding of the same record leaves exactly one case (identity race)', async () => {
  const store = new MemoryStore();
  const realFound = store.foundCase.bind(store);
  let raced = false;
  store.foundCase = async (found) => {
    if (!raced) {
      raced = true;
      // Another worker founds the identity between our gate read and our
      // founding transaction — our own attempt must then see record_exists.
      await realFound(found);
      return { status: 'record_exists' as const };
    }
    return realFound(found);
  };
  const summary = await runFsisIngest(store, input([RECALL]), { now: NOW });

  // The loser re-entered the existing-record path against the winner's rows.
  assert.equal(store.cases.size, 1);
  assert.equal(store.sourceRecords.size, 1);
  assert.equal([...store.notifications.values()].filter((n) => n.kind === 'initial').length, 1);
  assert.equal(summary.itemFailures.length, 0);
});

// ── Joining records (expansion/retraction) ───────────────────────────────────

test('a joining expansion that crashes BEFORE its snapshot converges with one expansion event', async () => {
  const april = () => new Date('2026-04-20T12:00:00Z');
  const store = new MemoryStore();
  await runFsisIngest(store, input([loadFixture('recall-closed-parent-005-2026')]), {
    now: april,
  });

  failOnceAt(store, 'archive:snapshot');
  const crashed = await runFsisIngest(
    store,
    input([
      loadFixture('recall-closed-parent-005-2026'),
      loadFixture('recall-closed-expansion-005-2026-exp'),
    ]),
    { now: april },
  );
  assert.equal(crashed.itemFailures.length, 1);
  // The record linked but nothing archived or applied: pending, visible.
  const expansion = await store.getSourceRecordByNativeId('fsis_api', '005-2026-EXP');
  assert.equal(expansion?.applyState, 'pending');
  assert.equal(store.snapshots.length, 1);
  assert.equal(materialEvents(store).length, 0);

  const retry = await runFsisIngest(
    store,
    input([
      loadFixture('recall-closed-parent-005-2026'),
      loadFixture('recall-closed-expansion-005-2026-exp'),
    ]),
    { now: april },
  );
  assert.equal(retry.itemFailures.length, 0);
  assert.equal(store.cases.size, 1);
  const updates = materialEvents(store);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].triggerRuleId, 'expansion_products');
  assert.equal(
    (await store.getSourceRecordByNativeId('fsis_api', '005-2026-EXP'))?.applyState,
    'applied',
  );
});

test('a joining expansion that crashes AFTER its snapshot still produces its forced expansion event on retry', async () => {
  // The J1/J2 window: the projection diff alone can miss an FSIS expansion
  // (products only in an attached PDF), so the retry must re-derive the
  // forced material change from the applying record itself.
  const april = () => new Date('2026-04-20T12:00:00Z');
  const store = new MemoryStore();
  await runFsisIngest(store, input([loadFixture('recall-closed-parent-005-2026')]), {
    now: april,
  });

  failOnceAt(store, 'transition:case');
  await runFsisIngest(
    store,
    input([
      loadFixture('recall-closed-parent-005-2026'),
      loadFixture('recall-closed-expansion-005-2026-exp'),
    ]),
    { now: april },
  );
  assert.equal(materialEvents(store).length, 0);
  assert.equal(
    (await store.getSourceRecordByNativeId('fsis_api', '005-2026-EXP'))?.applyState,
    'pending',
  );

  const retry = await runFsisIngest(
    store,
    input([
      loadFixture('recall-closed-parent-005-2026'),
      loadFixture('recall-closed-expansion-005-2026-exp'),
    ]),
    { now: april },
  );
  assert.equal(retry.itemFailures.length, 0);
  const updates = materialEvents(store);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].triggerRuleId, 'expansion_products');

  // A THIRD run repeats nothing (the forced change is introduce-once).
  await runFsisIngest(
    store,
    input([
      loadFixture('recall-closed-parent-005-2026'),
      loadFixture('recall-closed-expansion-005-2026-exp'),
    ]),
    { now: april },
  );
  assert.equal(materialEvents(store).length, 1);
});

test('a retraction after partial prior work retries into a retracted case with exactly one retraction event', async () => {
  const april = () => new Date('2026-04-08T12:00:00Z');
  const store = new MemoryStore();
  const retraction = loadFixture('pha-retraction-pha-04012026-01');
  const beforeRetraction = derive('pha-retraction-pha-04012026-01', {
    field_title: retraction.field_title.replace(
      /^FSIS Retracts Public Health Alert/,
      'FSIS Issues Public Health Alert',
    ),
    field_recall_date: '2026-04-01',
  });
  await runFsisIngest(store, input([beforeRetraction]), { now: april });

  failOnceAt(store, 'transition:case');
  await runFsisIngest(store, input([retraction]), { now: april });
  assert.equal(theCase(store).projection.state, 'active'); // stale but coherent
  assert.equal(materialEvents(store).length, 0);
  assert.equal(theRecord(store).applyState, 'pending');

  const retry = await runFsisIngest(store, input([retraction]), { now: april });
  assert.equal(retry.changedCases, 1);
  assert.equal(theCase(store).projection.state, 'retracted');
  const events = materialEvents(store);
  assert.equal(events.length, 1);
  assert.equal(events[0].triggerRuleId, 'retraction');
  assert.equal(events[0].suppressed, null);
});

// ── Concurrency: CAS and version ordering ────────────────────────────────────

test('a case CAS conflict re-reads, recomputes, and converges with the concurrent write intact', async () => {
  const store = new MemoryStore();
  await runFsisIngest(store, input([RECALL]), { now: NOW });

  const realApply = store.applyCaseTransition.bind(store);
  let interfered = false;
  store.applyCaseTransition = async (transition) => {
    if (!interfered) {
      interfered = true;
      // A concurrent writer (another record of the case, or enforcement)
      // moves the case between our read and our transition.
      const current = store.cases.get(transition.recallCaseId)!;
      current.lastChangedAt = '2026-08-21T11:59:59.000Z';
    }
    return realApply(transition);
  };
  const summary = await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });

  assert.equal(summary.changedCases, 1);
  assert.equal(summary.conflictsExhausted, 0);
  assert.equal(theCase(store).projection.reportsIllness, true);
  assert.equal(materialEvents(store).length, 1);
  assert.equal(theRecord(store).applyState, 'applied');
});

test('CAS exhaustion leaves the version pending and never claims success', async () => {
  const store = new MemoryStore();
  await runFsisIngest(store, input([RECALL]), { now: NOW });

  const realApply = store.applyCaseTransition.bind(store);
  store.applyCaseTransition = async () => ({ status: 'conflict' as const });
  const exhausted = await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });
  assert.equal(exhausted.conflictsExhausted, 1);
  assert.equal(exhausted.changedCases, 0);
  assert.equal(theRecord(store).applyState, 'pending');
  assert.equal(theCase(store).projection.reportsIllness, false);
  assert.equal(materialEvents(store).length, 0);

  // Once the contention clears, the next run converges.
  store.applyCaseTransition = realApply;
  const retry = await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });
  assert.equal(retry.changedCases, 1);
  assert.equal(theCase(store).projection.reportsIllness, true);
  assert.equal(materialEvents(store).length, 1);
});

test('an older delayed fetch loses to a newer archive before any write', async () => {
  const store = new MemoryStore();
  await runFsisIngest(store, input([RECALL], '2026-08-21T00:00:00.000Z'), { now: NOW });
  // Newer content, newer fetch — applies.
  await runFsisIngest(store, input([RECALL_WITH_ILLNESS], '2026-08-21T01:00:00.000Z'), {
    now: NOW,
  });
  assert.equal(theCase(store).projection.reportsIllness, true);
  const snapshotsBefore = store.snapshots.length;

  // A stale worker resurfaces with the OLD content and an OLDER fetch stamp.
  const stale = await runFsisIngest(store, input([RECALL], '2026-08-21T00:30:00.000Z'), {
    now: NOW,
  });
  assert.equal(stale.staleSkipped, 1);
  assert.equal(store.snapshots.length, snapshotsBefore); // nothing archived
  assert.equal(theCase(store).projection.reportsIllness, true); // nothing regressed
  assert.equal(theRecord(store).applyState, 'applied');
  assert.equal(materialEvents(store).length, 1); // no churned events
});

test('an older worker can never mark over or normalize over a newer applied version', async () => {
  const store = new MemoryStore();
  await runFsisIngest(store, input([RECALL]), { now: NOW });
  await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });
  const record = theRecord(store);
  const appliedSeq = record.appliedSnapshotSeq!;
  const normalizedBefore = structuredClone(record.normalized);

  // Marker with a lower sequence: refused, state intact.
  const marked = await store.markSourceRecordApplied({
    sourceRecordId: record.id,
    contentHash: 'stale-hash',
    snapshotSeq: appliedSeq - 1,
    state: 'applied',
    appliedAt: NOW().toISOString(),
  });
  assert.equal(marked, false);
  assert.equal(theRecord(store).appliedSnapshotSeq, appliedSeq);
  assert.equal(theRecord(store).appliedContentHash === 'stale-hash', false);

  // Normalized write tied to a lower sequence: refused, payload intact.
  const wrote = await store.updateSourceRecordNormalized(
    record.id,
    { ...normalizedBefore, title: 'STALE OVERWRITE' },
    NOW().toISOString(),
    appliedSeq - 1,
  );
  assert.equal(wrote, false);
  assert.deepEqual(theRecord(store).normalized, normalizedBefore);
});

test('a multi-source case reprojects deterministically when one contributor changes', async () => {
  const april = () => new Date('2026-04-20T12:00:00Z');
  const store = new MemoryStore();
  await runFsisIngest(
    store,
    input([
      loadFixture('recall-closed-parent-005-2026'),
      loadFixture('recall-closed-expansion-005-2026-exp'),
    ]),
    { now: april },
  );
  assert.equal(store.cases.size, 1);
  const identifiersBefore = theCase(store).projection.sourceIdentifiers.map((s) => s.id);

  // The PARENT changes in place; the reprojection must keep both records'
  // facts (deterministic order-independent projectCase over ALL records).
  const editedParent = derive('recall-closed-parent-005-2026', {
    field_qty_recovered: '999 lbs',
  });
  await runFsisIngest(
    store,
    input([editedParent, loadFixture('recall-closed-expansion-005-2026-exp')]),
    { now: april },
  );
  assert.equal(store.cases.size, 1);
  assert.deepEqual(
    theCase(store).projection.sourceIdentifiers.map((s) => s.id),
    identifiersBefore,
  );
});

// ── No-op retry and legacy behavior ──────────────────────────────────────────

test('a no-op retry is byte-identical durable state (cases, snapshots, products, events)', async () => {
  const store = new MemoryStore();
  await runFsisIngest(store, input([RECALL]), { now: NOW });
  const cases = structuredClone([...store.cases.values()]);
  const snapshots = structuredClone(store.snapshots);
  const products = structuredClone([...store.products.entries()]);
  const notifications = structuredClone([...store.notifications.entries()]);

  const retry = await runFsisIngest(store, input([RECALL]), { now: NOW });
  assert.equal(retry.unchanged, 1);
  assert.deepEqual([...store.cases.values()], cases);
  assert.deepEqual(store.snapshots, snapshots);
  assert.deepEqual([...store.products.entries()], products);
  assert.deepEqual([...store.notifications.entries()], notifications);
});

/** A pre-O3 row: no apply marker at all (the migration adds NULL columns). */
async function seedLegacyRecord(store: MemoryStore, raw: FsisRawRecord) {
  const scratch = new MemoryStore();
  await runFsisIngest(scratch, input([raw]), { now: NOW });
  // Copy the durable shapes across WITHOUT marker fields, as the additive
  // migration leaves every existing row.
  for (const [id, row] of scratch.cases) store.cases.set(id, structuredClone(row));
  for (const [key, row] of scratch.sourceRecords) {
    const legacy = structuredClone(row);
    delete legacy.applyState;
    delete legacy.appliedContentHash;
    delete legacy.appliedSnapshotSeq;
    delete legacy.appliedAt;
    store.sourceRecords.set(key, legacy);
  }
  for (const snapshot of scratch.snapshots) {
    await store.insertSnapshot(structuredClone(snapshot));
  }
  for (const [id, products] of scratch.products) store.products.set(id, structuredClone(products));
  for (const [key, event] of scratch.notifications) {
    store.notifications.set(key, structuredClone(event));
  }
}

test('legacy_unverified rows keep pre-O3 behavior on unchanged content — no replay, no marker seeding', async () => {
  const store = new MemoryStore();
  await seedLegacyRecord(store, RECALL);
  const snapshotsBefore = store.snapshots.length;
  const eventsBefore = store.notifications.size;
  const caseBefore = structuredClone(theCase(store));

  const summary = await runFsisIngest(store, input([RECALL]), { now: NOW });

  // Exactly the pre-O3 unchanged path: lastSeen evidence only. The record is
  // NOT treated as fresh pending work, NOT re-applied, NOT marker-seeded —
  // verified seeding belongs to the O3-B2 reconciliation alone.
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.newCases + summary.changedCases, 0);
  assert.equal(store.snapshots.length, snapshotsBefore);
  assert.equal(store.notifications.size, eventsBefore);
  assert.deepEqual(theCase(store), caseBefore);
  assert.equal(theRecord(store).applyState ?? null, null);
});

test('a legacy row graduates to a verified marker when its content actually changes', async () => {
  const store = new MemoryStore();
  await seedLegacyRecord(store, RECALL);

  const summary = await runFsisIngest(store, input([RECALL_WITH_ILLNESS]), { now: NOW });
  assert.equal(summary.changedCases, 1);
  const record = theRecord(store);
  assert.equal(record.applyState, 'applied');
  assert.equal(typeof record.appliedSnapshotSeq, 'number');
  assert.equal(theCase(store).projection.reportsIllness, true);
  assert.equal(materialEvents(store).length, 1);
});
