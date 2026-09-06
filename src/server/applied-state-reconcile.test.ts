/**
 * O3-B2 reconciliation matrix: the census classifies every record and case,
 * proves the "consistent and seedable" contract, refuses every mismatch, and
 * the plan-bound apply seeds ONLY the four marker fields under every gate.
 * Fixtures come from the REAL pipeline (runFsisIngest / runFdaIngest /
 * enrichCaseWithMatches) so "consistent" means consistent with the canonical
 * derivation, then markers are stripped to reproduce the pre-O3 population.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applySeedPlan,
  auditAppliedState,
  planContentDigest,
  PlanValidationError,
  PLAN_SCHEMA_VERSION,
  type ReconcilePlan,
} from './applied-state-reconcile';
import { enrichCaseWithMatches } from './fda-enforcement/enrich';
import { parseEnforcementRecord, type OpenFdaEnforcementRaw } from './fda-enforcement/parse';
import { loadDetailPage, loadListingItem } from './fda/fixtures';
import { runFdaIngest } from './fda/ingest';
import { slugFromPath } from './fda/parse';
import { loadFixture } from './fsis/fixtures';
import type { FsisRawRecord } from './fsis/parse';
import { runFsisIngest } from './pipeline';
import { MemoryStore } from './store/memory-store';
import type { RecallStore, SourceRecordRow } from './store/types';

const NOW = () => new Date('2026-08-21T12:00:00Z');
const APRIL = () => new Date('2026-04-20T12:00:00Z');
const GIT = 'commit-under-test';

const RECALL = loadFixture('recall-active-nationwide-017-2026');
const PARENT = loadFixture('recall-closed-parent-005-2026');
const EXPANSION = loadFixture('recall-closed-expansion-005-2026-exp');

function fsisInput(records: FsisRawRecord[]) {
  return {
    records,
    fetchedAt: NOW().toISOString(),
    sourceUrl: 'https://www.fsis.usda.gov/fsis/api/recall/v/1?field_translation_language=en',
  };
}

/** The pre-O3 population: real-pipeline state with the markers stripped. */
function stripMarkers(store: MemoryStore): void {
  for (const row of store.sourceRecords.values()) {
    delete row.applyState;
    delete row.appliedContentHash;
    delete row.appliedSnapshotSeq;
    delete row.appliedAt;
  }
}

async function legacyFsisStore(records: FsisRawRecord[], now = NOW): Promise<MemoryStore> {
  const store = new MemoryStore();
  await runFsisIngest(store, { ...fsisInput(records), fetchedAt: now().toISOString() }, { now });
  stripMarkers(store);
  return store;
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

function record(store: MemoryStore, nativeId: string): SourceRecordRow {
  return [...store.sourceRecords.values()].find((r) => r.nativeId === nativeId)!;
}

const audit = (store: RecallStore) => auditAppliedState(store, { gitCommit: GIT, now: NOW });

function only(plan: ReconcilePlan, nativeId: string) {
  const finding = plan.records.find((r) => r.nativeId === nativeId);
  assert.ok(finding, `no finding for ${nativeId}`);
  return finding!;
}

// ── Census basics ────────────────────────────────────────────────────────────

test('the audit (default dry run) performs zero writes of any kind', async () => {
  const store = await legacyFsisStore([RECALL, PARENT]);
  const before = durableState(store);
  const plan = await audit(store);
  assert.deepEqual(durableState(store), before);
  assert.equal(plan.summary.notificationEventsWritten, 0);
  assert.equal(plan.summary.deliveriesWritten, 0);
  assert.equal(plan.summary.networkRequests, 0);
  assert.equal(plan.summary.appliedMarkerWrites, 0);
});

test('a consistent single-source legacy record is seedable with a complete precondition set', async () => {
  const store = await legacyFsisStore([RECALL]);
  const plan = await audit(store);
  const finding = only(plan, '017-2026');
  assert.equal(finding.classification, 'consistent_legacy_seedable');
  assert.equal(finding.seedable, true);
  assert.equal(finding.consumerVisibleDiff, false);
  assert.equal(finding.notificationDiff, false);
  assert.equal(finding.requiresSeparateReview, false);
  assert.equal(plan.summary.seedableCount, 1);
  assert.equal(plan.summary.populationVerdict, 'seedable_after_review');
  const entry = plan.seedable[0];
  for (const key of [
    'sourceRecordId',
    'recallCaseId',
    'snapshotHash',
    'normalizedFingerprint',
    'caseLastChangedAt',
    'projectionFingerprint',
    'productsFingerprint',
    'membershipFingerprint',
  ] as const) {
    assert.equal(typeof entry[key], 'string', key);
  }
  assert.equal(entry.initialEventDedupKey, `initial:${entry.recallCaseId}`);
});

test('a consistent multi-source case certifies every contributor together', async () => {
  const store = await legacyFsisStore([PARENT, EXPANSION], APRIL);
  const plan = await audit(store);
  assert.equal(store.cases.size, 1);
  assert.equal(plan.summary.seedableCount, 2);
  assert.equal(only(plan, '005-2026').classification, 'consistent_legacy_seedable');
  assert.equal(only(plan, '005-2026-EXP').classification, 'consistent_legacy_seedable');
  // Both entries carry the SAME membership fingerprint — the group contract.
  assert.equal(plan.seedable[0].membershipFingerprint, plan.seedable[1].membershipFingerprint);
});

test('one inconsistent sibling blocks certification of the whole case', async () => {
  const store = await legacyFsisStore([PARENT, EXPANSION], APRIL);
  record(store, '005-2026-EXP').applyState = 'pending'; // sibling mid-retry
  const plan = await audit(store);
  assert.equal(plan.summary.seedableCount, 0);
  assert.equal(only(plan, '005-2026-EXP').classification, 'pending_current_version');
  const blocked = only(plan, '005-2026');
  assert.equal(blocked.classification, 'case_blocked_by_sibling');
  assert.equal(blocked.seedable, false);
  assert.ok(blocked.reasons.some((r) => /sibling 005-2026-EXP/.test(r)));
});

test('results are deterministic regardless of database pagination order', async () => {
  const store = await legacyFsisStore([RECALL, PARENT, EXPANSION]);
  const forward = await audit(store);
  // O3-B3A: the audit reads via page methods; serve the same rows in a
  // different stable order through the SAME pagination contract.
  const reversed: RecallStore = Object.create(store);
  reversed.listSourceRecordsPage = async (system, from, size) => {
    const all = await store.listSourceRecordsPage(system, 0, 10_000);
    return all.sort((a, b) => b.id.localeCompare(a.id)).slice(from, from + size);
  };
  reversed.listAppliedStateHealthPage = async (from, size) => {
    const all = await store.listAppliedStateHealthPage(0, 10_000);
    return all.sort((a, b) => b.id.localeCompare(a.id)).slice(from, from + size);
  };
  reversed.listCaseAuditPage = async (from, size) => {
    const all = await store.listCaseAuditPage(0, 10_000);
    return all.sort((a, b) => b.id.localeCompare(a.id)).slice(from, from + size);
  };
  const backward = await audit(reversed);
  assert.equal(forward.planDigest, backward.planDigest);
  assert.deepEqual(forward.records, backward.records);
  assert.deepEqual(forward.seedable, backward.seedable);
});

test('the FDA announcement path re-derives through the FDA parser', async () => {
  const store = new MemoryStore();
  const PRINCE =
    'prince-bakery-inc-issues-allergy-alert-undeclared-milk-and-sesame-prince-bakery-breads';
  await runFdaIngest(
    store,
    {
      listing: { items: [loadListingItem(PRINCE)], fetchedAt: NOW().toISOString() },
      rss: { items: [] },
      fetchDetail: async (url) => loadDetailPage(slugFromPath(url)),
    },
    { now: NOW },
  );
  stripMarkers(store);
  const plan = await audit(store);
  assert.equal(only(plan, PRINCE).classification, 'consistent_legacy_seedable');
});

test('the enforcement path copies stored match provenance before comparing (pinned contract)', async () => {
  // Build a real enforcement enrichment (announcement case + matched record),
  // then strip markers: the audit must re-derive with the STORED provenance
  // block and find the record consistent.
  const store = new MemoryStore();
  await runFsisIngest(store, fsisInput([RECALL]), { now: NOW });
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
  const plan = await audit(store);
  assert.equal(only(plan, 'F-2000-2026').classification, 'consistent_legacy_seedable');
  assert.equal(only(plan, '017-2026').classification, 'consistent_legacy_seedable');
});

// ── Refusal classifications ──────────────────────────────────────────────────

test('normalized drift refuses with smallest-useful-field diffs and no repair', async () => {
  const store = await legacyFsisStore([RECALL]);
  const row = record(store, '017-2026');
  row.normalized = { ...row.normalized, quantityText: 'TAMPERED lbs' };
  // Keep the case aligned to the tampered record so ONLY normalized drifts.
  const { projectCase } = await import('../domain/projection');
  const projection = projectCase([row.normalized]);
  const caseRow = store.cases.get(row.recallCaseId)!;
  caseRow.projection = projection;
  store.products.set(row.recallCaseId, projection.affectedProducts);

  const before = durableState(store);
  const plan = await audit(store);
  const finding = only(plan, '017-2026');
  assert.equal(finding.classification, 'normalized_drift');
  assert.equal(finding.seedable, false);
  assert.equal(finding.requiresSeparateReview, true);
  assert.ok(finding.fieldDiffs.some((d) => d.field === 'normalized.quantityText'));
  assert.ok(finding.fieldDiffs.every((d) => d.stored.length <= 121 && d.derived.length <= 121));
  assert.equal(plan.summary.populationVerdict, 'historical_mismatches_present');
  assert.deepEqual(durableState(store), before); // refusal repaired nothing
});

test('case projection drift refuses every contributor of the case', async () => {
  const store = await legacyFsisStore([RECALL]);
  const caseRow = [...store.cases.values()][0];
  caseRow.projection = { ...caseRow.projection, title: 'TAMPERED TITLE' };
  const plan = await audit(store);
  const finding = only(plan, '017-2026');
  assert.equal(finding.classification, 'case_projection_drift');
  assert.equal(finding.consumerVisibleDiff, true);
  assert.ok(finding.fieldDiffs.some((d) => d.field === 'projection.title'));
  assert.equal(plan.summary.seedableCount, 0);
});

test('generated-column drift is caught even when the projection matches', async () => {
  const store = await legacyFsisStore([RECALL]);
  const wrapped: RecallStore = Object.create(store);
  wrapped.getCaseGeneratedColumns = async (id) => {
    const generated = await store.getCaseGeneratedColumns(id);
    return generated ? { ...generated, hazardCategory: 'TAMPERED' } : null;
  };
  const plan = await audit(wrapped);
  const finding = only(plan, '017-2026');
  assert.equal(finding.classification, 'case_projection_drift');
  assert.ok(finding.reasons.some((r) => /generated read-model columns/.test(r)));
  assert.ok(finding.fieldDiffs.some((d) => d.field === 'generated.hazardCategory'));
});

test('affected-product drift refuses (rows disagree with the stored projection)', async () => {
  const store = await legacyFsisStore([RECALL]);
  const caseId = [...store.cases.keys()][0];
  store.products.set(caseId, []);
  const plan = await audit(store);
  const finding = only(plan, '017-2026');
  assert.equal(finding.classification, 'affected_products_drift');
  assert.equal(finding.consumerVisibleDiff, true);
});

test('a missing initial event refuses with notification-ledger difference flagged', async () => {
  const store = await legacyFsisStore([RECALL]);
  const caseId = [...store.cases.keys()][0];
  store.notifications.delete(`initial:${caseId}`);
  const plan = await audit(store);
  const finding = only(plan, '017-2026');
  assert.equal(finding.classification, 'missing_initial_event');
  assert.equal(finding.notificationDiff, true);
  assert.equal(finding.requiresSeparateReview, true);
  // The audit REPORTS the missing event; it must never insert one.
  assert.equal(store.notifications.has(`initial:${caseId}`), false);
});

test('an orphan case is enumerated as a case finding, never touched', async () => {
  const store = await legacyFsisStore([RECALL]);
  await store.insertCase({
    projection: { title: 'Orphan' } as never,
    timeline: [],
    createdAt: NOW().toISOString(),
    lastChangedAt: NOW().toISOString(),
  });
  const casesBefore = store.cases.size;
  const plan = await audit(store);
  assert.equal(plan.caseFindings.length, 1);
  assert.equal(plan.caseFindings[0].classification, 'orphan_case');
  assert.equal(plan.caseFindings[0].requiresSeparateReview, true);
  assert.equal(store.cases.size, casesBefore); // not deleted, merged, or repaired
  assert.equal(plan.summary.populationVerdict, 'historical_mismatches_present');
});

test('a merged tombstone with no records is skipped by design, not an orphan', async () => {
  const store = await legacyFsisStore([RECALL]);
  const survivor = [...store.cases.keys()][0];
  const absorbed = await store.insertCase({
    projection: { title: 'Absorbed' } as never,
    timeline: [],
    createdAt: NOW().toISOString(),
    lastChangedAt: NOW().toISOString(),
  });
  store.cases.get(absorbed.id)!.mergedInto = survivor;
  const plan = await audit(store);
  assert.equal(plan.caseFindings.length, 0);
  assert.equal(plan.summary.mergedTombstonesSkipped, 1);
});

test('a missing snapshot refuses', async () => {
  const store = await legacyFsisStore([RECALL]);
  store.snapshots.length = 0;
  const plan = await audit(store);
  assert.equal(only(plan, '017-2026').classification, 'missing_snapshot');
});

test('an archived payload that no longer parses refuses as snapshot_parse_failure', async () => {
  const store = await legacyFsisStore([RECALL]);
  store.snapshots[0].rawPayload = { corrupted: true };
  const plan = await audit(store);
  const finding = only(plan, '017-2026');
  assert.equal(finding.classification, 'snapshot_parse_failure');
  assert.ok(finding.reasons[0].includes('does not re-derive'));
});

test('an unsupported source system is enumerated and refused', async () => {
  const store = await legacyFsisStore([RECALL]);
  const caseId = [...store.cases.keys()][0];
  await store.insertSourceRecord({
    sourceSystem: 'mystery_feed' as never,
    nativeId: 'MYSTERY-1',
    recallCaseId: caseId,
    linkMethod: 'self',
    normalized: record(store, '017-2026').normalized,
    sourceUrl: 'u',
    firstSeenAt: NOW().toISOString(),
    lastSeenAt: NOW().toISOString(),
  });
  const plan = await audit(store);
  const finding = only(plan, 'MYSTERY-1');
  assert.equal(finding.classification, 'unsupported_source_system');
  assert.equal(finding.requiresSeparateReview, true);
  // Its case is NOT flagged orphan merely because the audit skipped the record.
  assert.equal(plan.caseFindings.length, 0);
});

test('pending and applied_degraded records are reported, never competed with', async () => {
  const store = await legacyFsisStore([RECALL, PARENT]);
  const pending = record(store, '017-2026');
  pending.applyState = 'pending';
  const degraded = record(store, '005-2026');
  const meta = store.snapshots.find((s) => s.sourceRecordId === degraded.id)!;
  degraded.applyState = 'applied_degraded';
  degraded.appliedContentHash = meta.contentHash;
  degraded.appliedSnapshotSeq = meta.seq;
  degraded.appliedAt = NOW().toISOString();

  const before = durableState(store);
  const plan = await audit(store);
  assert.equal(only(plan, '017-2026').classification, 'pending_current_version');
  assert.equal(only(plan, '017-2026').requiresSeparateReview, false);
  assert.equal(only(plan, '005-2026').classification, 'applied_degraded');
  assert.equal(plan.summary.seedableCount, 0);
  assert.deepEqual(durableState(store), before); // reconciliation is not an ingest worker
});

test('an already-applied consistent record verifies without any rewrite', async () => {
  const store = new MemoryStore();
  await runFsisIngest(store, fsisInput([RECALL]), { now: NOW }); // real O3 markers
  const before = durableState(store);
  const plan = await audit(store);
  const finding = only(plan, '017-2026');
  assert.equal(finding.classification, 'already_applied_consistent');
  assert.equal(finding.seedable, false);
  assert.equal(plan.summary.populationVerdict, 'fully_consistent');
  assert.deepEqual(durableState(store), before);
});

test('a malformed applied marker (null fields or non-latest snapshot) refuses loudly', async () => {
  const store = new MemoryStore();
  await runFsisIngest(store, fsisInput([RECALL, PARENT]), { now: NOW });
  const nullFields = record(store, '017-2026');
  nullFields.appliedSnapshotSeq = null;
  const staleMarker = record(store, '005-2026');
  staleMarker.appliedSnapshotSeq = staleMarker.appliedSnapshotSeq! + 99;

  const plan = await audit(store);
  assert.equal(only(plan, '017-2026').classification, 'applied_marker_inconsistent');
  assert.match(only(plan, '017-2026').reasons[0], /null marker fields/);
  assert.equal(only(plan, '005-2026').classification, 'applied_marker_inconsistent');
  assert.match(only(plan, '005-2026').reasons[0], /does not match the latest snapshot/);
});

test('multiple distinct findings never collapse into one bucket', async () => {
  const store = await legacyFsisStore([RECALL]);
  const row = record(store, '017-2026');
  row.normalized = { ...row.normalized, quantityText: 'TAMPERED' }; // drift #1 (+projection dep)
  const caseId = row.recallCaseId;
  store.notifications.delete(`initial:${caseId}`); // drift #2
  const plan = await audit(store);
  const finding = only(plan, '017-2026');
  assert.equal(finding.classification, 'multiple_findings');
  assert.ok(finding.reasons.length >= 2);
  assert.equal(finding.notificationDiff, true);
});

// ── Plan-bound apply ─────────────────────────────────────────────────────────

async function seedablePlan(store: MemoryStore): Promise<ReconcilePlan> {
  return audit(store);
}

test('apply seeds ONLY the four marker fields; everything else is byte-identical', async () => {
  const store = await legacyFsisStore([RECALL]);
  const plan = await seedablePlan(store);
  const before = durableState(store);

  const report = await applySeedPlan(store, plan, {
    expectedDigest: plan.planDigest,
    currentGitCommit: GIT,
    now: NOW,
  });
  assert.equal(report.seeded, 1);
  assert.equal(report.conflicts, 0);
  assert.equal(report.notificationEventsWritten, 0);
  assert.equal(report.deliveriesWritten, 0);

  const after = durableState(store);
  // The four marker fields changed…
  const seeded = after.records[0];
  assert.equal(seeded.applyState, 'applied');
  assert.equal(seeded.appliedContentHash, plan.seedable[0].snapshotHash);
  assert.equal(seeded.appliedSnapshotSeq, plan.seedable[0].snapshotSeq);
  assert.equal(seeded.appliedAt, NOW().toISOString());
  // …and NOTHING else did: strip them and the states are deep-equal.
  const strip = (rows: SourceRecordRow[]) =>
    rows.map(({ applyState, appliedContentHash, appliedSnapshotSeq, appliedAt, ...rest }) => rest);
  assert.deepEqual(strip(after.records), strip(before.records));
  assert.deepEqual(after.cases, before.cases); // projection, timeline, last_changed_at untouched
  assert.deepEqual(after.snapshots, before.snapshots);
  assert.deepEqual(after.products, before.products);
  assert.deepEqual(after.notifications, before.notifications); // zero events, ever
});

test('apply validates schema, digest, confirmed digest, and git commit — each gate alone refuses', async () => {
  const store = await legacyFsisStore([RECALL]);
  const plan = await seedablePlan(store);

  await assert.rejects(
    () =>
      applySeedPlan(
        store,
        { ...plan, schemaVersion: 'bogus/9' },
        {
          expectedDigest: plan.planDigest,
          currentGitCommit: GIT,
        },
      ),
    PlanValidationError,
  );
  // Tampered content breaks the plan's own digest.
  const tampered = structuredClone(plan);
  tampered.seedable[0].snapshotHash = 'tampered';
  await assert.rejects(
    () =>
      applySeedPlan(store, tampered, {
        expectedDigest: tampered.planDigest,
        currentGitCommit: GIT,
      }),
    /altered after review/,
  );
  // Wrong confirmed digest.
  await assert.rejects(
    () => applySeedPlan(store, plan, { expectedDigest: 'wrong', currentGitCommit: GIT }),
    /confirmed digest does not match/,
  );
  // Wrong git commit.
  await assert.rejects(
    () =>
      applySeedPlan(store, plan, { expectedDigest: plan.planDigest, currentGitCommit: 'other' }),
    /produced at commit/,
  );
  // Nothing was seeded by any refused attempt.
  assert.equal(record(store, '017-2026').applyState ?? null, null);
});

test('every post-plan change is a recorded conflict, never a silent re-plan', async () => {
  const scenarios: {
    name: string;
    mutate: (store: MemoryStore, plan: ReconcilePlan) => Promise<void> | void;
    reason: RegExp;
  }[] = [
    {
      name: 'snapshot changed',
      mutate: async (store, plan) => {
        await store.insertSnapshot({
          sourceRecordId: plan.seedable[0].sourceRecordId,
          fetchedAt: NOW().toISOString(),
          contentHash: 'newer-hash',
          rawPayload: {},
          sourceUrl: 'u',
        });
      },
      reason: /latest snapshot changed/,
    },
    {
      name: 'case changed',
      mutate: (store, plan) => {
        store.cases.get(plan.seedable[0].recallCaseId)!.lastChangedAt = '2026-08-22T00:00:00.000Z';
      },
      reason: /case moved/,
    },
    {
      name: 'products changed',
      mutate: (store, plan) => {
        store.products.set(plan.seedable[0].recallCaseId, []);
      },
      reason: /affected products changed/,
    },
    {
      name: 'event state changed',
      mutate: (store, plan) => {
        store.notifications.delete(plan.seedable[0].initialEventDedupKey);
      },
      reason: /initial event is no longer present/,
    },
    {
      name: 'membership changed',
      mutate: async (store, plan) => {
        await store.insertSourceRecord({
          sourceSystem: 'fsis_api',
          nativeId: 'NEW-SIBLING',
          recallCaseId: plan.seedable[0].recallCaseId,
          linkMethod: 'expansion_prefix',
          normalized: record(store, '017-2026').normalized,
          sourceUrl: 'u',
          firstSeenAt: NOW().toISOString(),
          lastSeenAt: NOW().toISOString(),
          applyState: 'pending',
        });
      },
      reason: /membership changed/,
    },
  ];
  for (const scenario of scenarios) {
    const store = await legacyFsisStore([RECALL]);
    const plan = await seedablePlan(store);
    await scenario.mutate(store, plan);
    const report = await applySeedPlan(store, plan, {
      expectedDigest: plan.planDigest,
      currentGitCommit: GIT,
      now: NOW,
    });
    assert.equal(report.seeded, 0, scenario.name);
    assert.equal(report.conflicts, 1, scenario.name);
    assert.match((report.outcomes[0] as { reason: string }).reason, scenario.reason, scenario.name);
    assert.equal(record(store, '017-2026').applyState ?? null, null, scenario.name);
  }
});

test('a write-time CAS miss is recorded and never overwritten', async () => {
  const store = await legacyFsisStore([RECALL]);
  const plan = await seedablePlan(store);
  const realSeed = store.seedLegacyAppliedMarker.bind(store);
  store.seedLegacyAppliedMarker = async (marker) => {
    // An ingest touches the record between the recheck and the write.
    record(store, '017-2026').applyState = 'pending';
    return realSeed(marker);
  };
  const report = await applySeedPlan(store, plan, {
    expectedDigest: plan.planDigest,
    currentGitCommit: GIT,
    now: NOW,
  });
  assert.equal(report.seeded, 0);
  assert.equal(report.conflicts, 1);
  assert.match((report.outcomes[0] as { reason: string }).reason, /no longer legacy-unverified/);
  assert.equal(record(store, '017-2026').applyState, 'pending'); // live state wins
});

test('one failed group member refuses the whole multi-source group', async () => {
  const store = await legacyFsisStore([PARENT, EXPANSION], APRIL);
  const plan = await audit(store);
  assert.equal(plan.seedable.length, 2);
  // After the plan, one sibling's snapshot moves.
  await store.insertSnapshot({
    sourceRecordId: plan.seedable[1].sourceRecordId,
    fetchedAt: APRIL().toISOString(),
    contentHash: 'moved',
    rawPayload: {},
    sourceUrl: 'u',
  });
  const report = await applySeedPlan(store, plan, {
    expectedDigest: plan.planDigest,
    currentGitCommit: GIT,
    now: APRIL,
  });
  assert.equal(report.seeded, 0);
  assert.equal(report.groupsRefused, 1);
  assert.equal(report.conflicts, 2); // both members refused — no partial certification
  assert.ok(
    report.outcomes.some(
      (o) => o.outcome === 'conflict' && /sibling/.test((o as { reason: string }).reason),
    ),
  );
  for (const nativeId of ['005-2026', '005-2026-EXP']) {
    assert.equal(record(store, nativeId).applyState ?? null, null, nativeId);
  }
});

test('rerunning apply is idempotent (already-seeded, zero writes) and the post-apply dry run settles', async () => {
  const store = await legacyFsisStore([RECALL, PARENT, EXPANSION]);
  const plan = await seedablePlan(store);
  const first = await applySeedPlan(store, plan, {
    expectedDigest: plan.planDigest,
    currentGitCommit: GIT,
    now: NOW,
  });
  assert.equal(first.seeded, 3);

  const before = durableState(store);
  const second = await applySeedPlan(store, plan, {
    expectedDigest: plan.planDigest,
    currentGitCommit: GIT,
    now: NOW,
  });
  assert.equal(second.seeded, 0);
  assert.equal(second.alreadySeeded, 3);
  assert.equal(second.conflicts, 0);
  assert.deepEqual(durableState(store), before);

  const settled = await audit(store);
  assert.equal(settled.summary.seedableCount, 0);
  assert.equal(
    settled.records.filter((r) => r.classification === 'already_applied_consistent').length,
    3,
  );
  assert.equal(settled.summary.populationVerdict, 'fully_consistent');
});
