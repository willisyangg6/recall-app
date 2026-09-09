/**
 * Enforcement enrichment safety: classification arrives ONLY through an
 * accepted authoritative match, the announcement's voice and dates survive
 * untouched, notifications follow the ledger's dedup/backfill semantics,
 * and re-runs are no-ops. All against MemoryStore, which mirrors the SQL
 * constraints.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fingerprint } from '../../domain/material-change';
import { projectCase } from '../../domain/projection';
import { consumerRiskTier } from '../../domain/risk-tier';
import type { NormalizedSourceRecord } from '../../domain/source-record';
import { riskView } from '../../lib/risk-display';
import { MemoryStore } from '../store/memory-store';
import { enrichCaseWithMatches } from './enrich';
import type { AcceptedMatch } from './match';
import { parseEnforcementRecord, type OpenFdaEnforcementRaw } from './parse';

const NOW = () => new Date('2026-08-25T12:00:00Z');

function announcement(overrides: Partial<NormalizedSourceRecord>): NormalizedSourceRecord {
  return {
    sourceSystem: 'fda_announcement',
    sourceAgency: 'FDA',
    nativeId: 'acme-foods-recalls-widget-snacks',
    rawNativeId: '/safety/x',
    noticeType: 'recall',
    lifecycle: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    expansionOfNativeId: null,
    isRetractionNotice: false,
    retractsNativeIds: [],
    title: 'Acme Foods Recalls Widget Snacks Due to Undeclared Peanuts',
    summaryText:
      'Acme Foods is recalling Widget Snacks 16 oz with UPC 012345678905 because they may contain undeclared peanuts.',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'undeclared peanuts',
    firmDisplayName: 'Acme Foods',
    firmRawVariants: ['Acme Foods'],
    brands: [],
    productDescription: null,
    imageUrls: [],
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    retailerNames: [],
    heroImageUrl: null,
    productLines: [],
    quantityText: null,
    illnessStatement: null,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fda.gov/x',
    publishedAt: '2026-08-01',
    lastModifiedAt: null,
    ...overrides,
  };
}

function rawEnforcement(overrides: Partial<OpenFdaEnforcementRaw>): OpenFdaEnforcementRaw {
  return {
    recall_number: 'F-1000-2026',
    event_id: '99900',
    classification: 'Class II',
    status: 'Ongoing',
    recalling_firm: 'Acme Foods LLC',
    product_description: 'Widget Snacks 16 oz bag UPC 012345678905',
    code_info: 'Lot 12345',
    reason_for_recall: 'Undeclared peanuts',
    recall_initiation_date: '20260728',
    center_classification_date: '20260818',
    report_date: '20260820',
    ...overrides,
  };
}

async function seedCase(store: MemoryStore) {
  const normalized = announcement({});
  const projection = projectCase([normalized]);
  const recallCase = await store.insertCase({
    projection,
    timeline: [
      {
        occurredAt: normalized.publishedAt,
        kind: 'published',
        summary: 'Recall published by FDA.',
        causedBySnapshotIds: [],
        material: false,
      },
    ],
    createdAt: '2026-08-01T00:00:00.000Z',
    lastChangedAt: '2026-08-01T00:00:00.000Z',
  });
  await store.insertSourceRecord({
    sourceSystem: 'fda_announcement',
    nativeId: normalized.nativeId,
    recallCaseId: recallCase.id,
    linkMethod: 'self',
    normalized,
    sourceUrl: normalized.officialUrl,
    firstSeenAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-08-01T00:00:00.000Z',
  });
  return recallCase;
}

function acceptedFor(raw: OpenFdaEnforcementRaw): {
  accepted: AcceptedMatch[];
  rawByRecallNumber: Map<string, OpenFdaEnforcementRaw>;
} {
  const record = parseEnforcementRecord(raw);
  return {
    accepted: [
      {
        eventId: record.eventId,
        method: 'code-identity',
        records: [record],
        evidence: ['same normalized recalling firm', 'exact UPC overlap: 012345678905'],
      },
    ],
    rawByRecallNumber: new Map([[record.recallNumber, raw]]),
  };
}

test('a fresh classification assignment enriches the case and notifies', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(rawEnforcement({}));

  const outcome = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  assert.equal(outcome?.classificationBefore, 'not_yet_classified');
  assert.equal(outcome?.classificationAfter, 'class_II');
  assert.deepEqual(outcome?.materialChanges, ['classification_assigned']);
  // Classified 7 days before NOW — recent, so the notification delivers.
  assert.deepEqual(outcome?.notifications, [
    { ruleId: 'classification_assigned', suppressed: null },
  ]);

  const updated = (await store.getCase(recallCase.id))!;
  assert.equal(updated.projection.classification.value, 'class_II');
  assert.equal(updated.projection.classification.sourceText, 'Class II');
  // The voice, dates, and identity are untouched by enrichment.
  assert.equal(
    updated.projection.title,
    'Acme Foods Recalls Widget Snacks Due to Undeclared Peanuts',
  );
  assert.equal(updated.projection.publishedAt, '2026-08-01');
  assert.equal(updated.projection.lastPublicActivityAt, '2026-08-01');
  assert.ok(updated.projection.sourceIdentifiers.every((s) => s.system === 'fda_announcement'));
  // Timeline entry is dated by FDA's classification date, not by the run.
  const entry = updated.timeline.at(-1)!;
  assert.equal(entry.kind, 'classified');
  assert.equal(entry.occurredAt, '2026-08-18');
  // The enforcement record is linked with the honest method and provenance.
  const linked = await store.getSourceRecordByNativeId('openfda_enforcement', 'F-1000-2026');
  assert.equal(linked?.linkMethod, 'enforcement_match');
  assert.equal(linked?.recallCaseId, recallCase.id);
  const provenance = (
    linked?.normalized as unknown as {
      enforcement: { match: { method: string; matcherVersion: string; evidence: string[] } };
    }
  ).enforcement.match;
  assert.equal(provenance.method, 'code-identity');
  assert.match(provenance.matcherVersion, /fda-enforcement-match/);
  assert.ok(provenance.evidence.length >= 2);
  assert.equal(store.snapshots.length, 1);
});

test('a historical classification is ledgered but suppressed as backfill', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(
    rawEnforcement({ center_classification_date: '20260601', report_date: '20260610' }),
  );

  const outcome = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  assert.deepEqual(outcome?.notifications, [
    { ruleId: 'classification_assigned', suppressed: 'backfill' },
  ]);
  const events = [...store.notifications.values()];
  assert.equal(events.length, 1);
  assert.equal(events[0].suppressed, 'backfill');
  // The classification itself still lands — suppression is delivery-only.
  assert.equal((await store.getCase(recallCase.id))!.projection.classification.value, 'class_II');
});

test('re-running the same enrichment is a complete no-op', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(rawEnforcement({}));
  await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });
  const casesAfter = structuredClone([...store.cases.values()]);
  const snapshotCount = store.snapshots.length;
  const notificationCount = store.notifications.size;

  const second = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  assert.deepEqual([...store.cases.values()], casesAfter);
  assert.equal(store.snapshots.length, snapshotCount);
  assert.equal(store.notifications.size, notificationCount);
  assert.equal(second?.recordsLinked, 0);
  assert.equal(second?.recordsAlreadyLinked, 1);
  assert.deepEqual(second?.materialChanges, []);
});

test('an official reclassification re-notifies through the ledger', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const first = acceptedFor(rawEnforcement({}));
  await enrichCaseWithMatches(store, recallCase.id, first.accepted, first.rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  // FDA corrects the record in place: Class II → Class I.
  const upgraded = acceptedFor(
    rawEnforcement({ classification: 'Class I', center_classification_date: '20260824' }),
  );
  const outcome = await enrichCaseWithMatches(
    store,
    recallCase.id,
    upgraded.accepted,
    upgraded.rawByRecallNumber,
    { apply: true, now: NOW },
  );

  assert.deepEqual(outcome?.materialChanges, ['classification_upgraded']);
  assert.deepEqual(outcome?.notifications, [
    { ruleId: 'classification_upgraded', suppressed: null },
  ]);
  assert.equal((await store.getCase(recallCase.id))!.projection.classification.value, 'class_I');
  // The changed payload produced a second snapshot on the SAME record.
  assert.equal(store.sourceRecords.size, 2);
  assert.equal(store.snapshots.length, 2);
  assert.equal(store.notifications.size, 2);
});

test('a recall_number already linked to another case is a conflict, never re-linked', async () => {
  const store = new MemoryStore();
  const caseA = await seedCase(store);
  const other = await store.insertCase({
    projection: projectCase([announcement({ nativeId: 'other-case' })]),
    timeline: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    lastChangedAt: '2026-08-01T00:00:00.000Z',
  });
  const { accepted, rawByRecallNumber } = acceptedFor(rawEnforcement({}));
  const record = accepted[0].records[0];
  await store.insertSourceRecord({
    sourceSystem: 'openfda_enforcement',
    nativeId: record.recallNumber,
    recallCaseId: other.id,
    linkMethod: 'enforcement_match',
    normalized: announcement({ nativeId: record.recallNumber }),
    sourceUrl: 'https://www.fda.gov/x',
    firstSeenAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-08-01T00:00:00.000Z',
  });

  const outcome = await enrichCaseWithMatches(store, caseA.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  assert.deepEqual(outcome?.conflicts, ['F-1000-2026']);
  assert.equal(outcome?.recordsLinked, 0);
  // Case A is untouched — still unclassified.
  assert.equal(
    (await store.getCase(caseA.id))!.projection.classification.value,
    'not_yet_classified',
  );
  // A conflict-only case has nothing left to propose.
  assert.deepEqual(outcome?.classificationChanges, []);
});

test('enrichment never creates cases and dry-run writes nothing', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const before = structuredClone([...store.cases.values()]);
  const { accepted, rawByRecallNumber } = acceptedFor(rawEnforcement({}));

  const outcome = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: false,
    now: NOW,
  });

  // The dry-run still REPORTS the full plan…
  assert.equal(outcome?.recordsLinked, 1);
  assert.equal(outcome?.classificationAfter, 'class_II');
  assert.deepEqual(outcome?.notifications, [
    { ruleId: 'classification_assigned', suppressed: null },
  ]);
  // …while writing nothing at all.
  assert.deepEqual([...store.cases.values()], before);
  assert.equal(store.cases.size, 1);
  assert.equal(store.sourceRecords.size, 1);
  assert.equal(store.snapshots.length, 0);
  assert.equal(store.notifications.size, 0);
});

test('mixed classifications are preserved as a set and never collapse to one class', async () => {
  // Measured: 175 of 7,837 events genuinely mix classes (different products,
  // different risk). The case carries the DISTINCT set; the scalar refuses to
  // name a single class, so nothing downstream can read a mixed case as
  // uniformly Class I. Each record keeps its own official class.
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const rawII = rawEnforcement({});
  const rawI = rawEnforcement({
    recall_number: 'F-1001-2026',
    classification: 'Class I',
    product_description: 'Widget Snacks Family Size 32 oz bag UPC 012345678905',
  });
  const recordII = parseEnforcementRecord(rawII);
  const recordI = parseEnforcementRecord(rawI);
  const accepted: AcceptedMatch[] = [
    {
      eventId: '99900',
      method: 'code-identity',
      records: [recordII, recordI],
      evidence: ['same normalized recalling firm', 'exact UPC overlap: 012345678905'],
    },
  ];
  const rawByRecallNumber = new Map([
    ['F-1000-2026', rawII],
    ['F-1001-2026', rawI],
  ]);

  const outcome = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  const updated = (await store.getCase(recallCase.id))!;
  assert.equal(updated.projection.classification.value, 'multiple_classes');
  assert.deepEqual(updated.projection.classification.officialClasses, ['class_I', 'class_II']);
  // No source wording can describe a set, so none is invented.
  assert.equal(updated.projection.classification.sourceText, null);
  // Consumer semantics: mixed Class I is High, not Critical.
  assert.deepEqual(outcome?.officialClassesAfter, ['class_I', 'class_II']);
  assert.equal(outcome?.riskTierAfter, 'high');
  assert.equal(consumerRiskTier(updated.projection.classification), 'high');
  assert.equal(
    riskView(updated.projection.classification, 'FDA').official?.text,
    'Class I and Class II',
  );
  // Exactly one authoritative event for the transition.
  assert.deepEqual(outcome?.materialChanges, ['classification_assigned']);
  const linkedII = await store.getSourceRecordByNativeId('openfda_enforcement', 'F-1000-2026');
  const linkedI = await store.getSourceRecordByNativeId('openfda_enforcement', 'F-1001-2026');
  assert.equal(linkedII?.normalized.classification.value, 'class_II');
  assert.equal(linkedI?.normalized.classification.value, 'class_I');
});

test('a single official class still exposes a scalar and its own source wording', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const raw = rawEnforcement({});
  const record = parseEnforcementRecord(raw);
  await enrichCaseWithMatches(
    store,
    recallCase.id,
    [{ eventId: '99900', method: 'code-identity', records: [record], evidence: ['e'] }],
    new Map([['F-1000-2026', raw]]),
    { apply: true, now: NOW },
  );
  const updated = (await store.getCase(recallCase.id))!;
  assert.equal(updated.projection.classification.value, 'class_II');
  assert.deepEqual(updated.projection.classification.officialClasses, ['class_II']);
  assert.equal(updated.projection.classification.sourceText, 'Class II');
  assert.equal(consumerRiskTier(updated.projection.classification), 'moderate');
});

test('a historical MIXED classification is suppressed exactly like a single one', async () => {
  // Mixed-class handling must not open a path around backfill suppression:
  // the set is what changed, and its age is what decides delivery.
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const rawII = rawEnforcement({
    center_classification_date: '20260601',
    report_date: '20260610',
  });
  const rawI = rawEnforcement({
    recall_number: 'F-1001-2026',
    classification: 'Class I',
    center_classification_date: '20260601',
    report_date: '20260610',
    product_description: 'Widget Snacks Family Size 32 oz bag UPC 012345678905',
  });
  const outcome = await enrichCaseWithMatches(
    store,
    recallCase.id,
    [
      {
        eventId: '99900',
        method: 'code-identity',
        records: [parseEnforcementRecord(rawII), parseEnforcementRecord(rawI)],
        evidence: ['same normalized recalling firm', 'exact UPC overlap: 012345678905'],
      },
    ],
    new Map([
      ['F-1000-2026', rawII],
      ['F-1001-2026', rawI],
    ]),
    { apply: true, now: NOW },
  );

  assert.deepEqual(outcome?.officialClassesAfter, ['class_I', 'class_II']);
  assert.equal(outcome?.riskTierAfter, 'high');
  // One event, suppressed — a mixed set is not a second notification either.
  assert.deepEqual(outcome?.notifications, [
    { ruleId: 'classification_assigned', suppressed: 'backfill' },
  ]);
  assert.equal([...store.notifications.values()].length, 1);
});

test('a first-time Class I assignment is enumerated in the preview', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(
    rawEnforcement({ classification: 'Class I' }),
  );

  const outcome = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  assert.equal(outcome?.classificationChanges.length, 1);
  const entry = outcome!.classificationChanges[0];
  assert.equal(entry.caseId, recallCase.id);
  assert.equal(entry.announcementRecallNumber, 'acme-foods-recalls-widget-snacks');
  assert.equal(entry.classificationBefore, 'not_yet_classified');
  assert.deepEqual(entry.officialClassesAfter, ['class_I']);
  assert.equal(entry.riskTierAfter, 'critical');
  assert.equal(entry.changeKind, 'first_assignment');
  assert.equal(entry.ruleId, 'classification_assigned');
  assert.deepEqual(entry.acceptedEventIds, ['99900']);
  assert.equal(entry.enforcementRecallNumberCount, 1);
  assert.deepEqual(entry.enforcementRecallNumbersSample, ['F-1000-2026']);
  assert.deepEqual(entry.matchMethods, ['code-identity']);
  assert.ok(entry.evidence.length >= 2);
  assert.equal(entry.mixedClass, false);
  assert.equal(entry.timelineKind, 'classified');
  const expectedFingerprint = fingerprint('classified:class_I');
  assert.equal(entry.fingerprint, expectedFingerprint);
  assert.equal(
    entry.dedupKey,
    `mu:${recallCase.id}:classification_assigned:${expectedFingerprint}`,
  );
  assert.equal(entry.eventAlreadyExists, false);
  assert.equal(entry.suppressed, null);
});

test('a first-time Class II assignment is enumerated in the preview', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(rawEnforcement({})); // Class II

  const outcome = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  assert.equal(outcome?.classificationChanges.length, 1);
  const entry = outcome!.classificationChanges[0];
  assert.deepEqual(entry.officialClassesAfter, ['class_II']);
  assert.equal(entry.riskTierAfter, 'moderate');
  assert.equal(entry.changeKind, 'first_assignment');
});

test('a genuine reclassification is labeled distinctly from a first assignment', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const first = acceptedFor(rawEnforcement({}));
  await enrichCaseWithMatches(store, recallCase.id, first.accepted, first.rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  const upgraded = acceptedFor(
    rawEnforcement({ classification: 'Class I', center_classification_date: '20260824' }),
  );
  const outcome = await enrichCaseWithMatches(
    store,
    recallCase.id,
    upgraded.accepted,
    upgraded.rawByRecallNumber,
    { apply: true, now: NOW },
  );

  assert.equal(outcome?.classificationChanges.length, 1);
  const entry = outcome!.classificationChanges[0];
  assert.equal(entry.changeKind, 'reclassification');
  assert.equal(entry.ruleId, 'classification_upgraded');
  assert.equal(entry.classificationBefore, 'class_II');
  assert.deepEqual(entry.officialClassesAfter, ['class_I']);
});

test('an unchanged classification (re-run) produces an empty preview', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(rawEnforcement({}));
  await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  const second = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  assert.deepEqual(second?.classificationChanges, []);
});

test('mixed official classes are represented honestly in the preview', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const rawII = rawEnforcement({});
  const rawI = rawEnforcement({
    recall_number: 'F-1001-2026',
    classification: 'Class I',
    product_description: 'Widget Snacks Family Size 32 oz bag UPC 012345678905',
  });
  const accepted: AcceptedMatch[] = [
    {
      eventId: '99900',
      method: 'code-identity',
      records: [parseEnforcementRecord(rawII), parseEnforcementRecord(rawI)],
      evidence: ['same normalized recalling firm', 'exact UPC overlap: 012345678905'],
    },
  ];
  const rawByRecallNumber = new Map([
    ['F-1000-2026', rawII],
    ['F-1001-2026', rawI],
  ]);

  const outcome = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  assert.equal(outcome?.classificationChanges.length, 1);
  const entry = outcome!.classificationChanges[0];
  assert.equal(entry.mixedClass, true);
  assert.deepEqual(entry.officialClassesAfter, ['class_I', 'class_II']);
  assert.equal(entry.riskTierAfter, 'high');
  assert.equal(entry.enforcementRecallNumberCount, 2);
  assert.deepEqual(entry.enforcementRecallNumbersSample.sort(), ['F-1000-2026', 'F-1001-2026']);
});

test('the preview carries no raw payload text, addresses, or credentials', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(rawEnforcement({}));

  const outcome = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  const entry = outcome!.classificationChanges[0];
  const serialized = JSON.stringify(entry);
  // The enforcement fixture's raw product/reason text never appears — only
  // the bounded, human-authored evidence lines from match.ts.
  assert.ok(!serialized.includes('Widget Snacks 16 oz bag'));
  assert.ok(!serialized.includes('Undeclared peanuts'));
  assert.ok(!serialized.includes('Lot 12345'));
});

test('dry-run produces an identical preview to apply planning, and calls no mutating store method', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(
    rawEnforcement({ classification: 'Class I' }),
  );

  const mutatingMethods = [
    'insertSourceRecord',
    'updateSourceRecord',
    'updateSourceRecordNormalized',
    'archiveSnapshot',
    'markSourceRecordApplied',
    'applyCaseTransition',
    'insertNotificationIfAbsent',
  ] as const;
  const calls: string[] = [];
  const guarded = new Proxy(store, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && (mutatingMethods as readonly string[]).includes(prop)) {
        calls.push(prop);
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const dryRun = await enrichCaseWithMatches(guarded, recallCase.id, accepted, rawByRecallNumber, {
    apply: false,
    now: NOW,
  });

  assert.deepEqual(calls, []);

  const storeForApply = new MemoryStore();
  const caseForApply = await seedCase(storeForApply);
  const applyPlan = await enrichCaseWithMatches(
    storeForApply,
    caseForApply.id,
    accepted,
    rawByRecallNumber,
    { apply: true, now: NOW },
  );

  assert.equal(dryRun?.classificationChanges.length, 1);
  // caseId and dedupKey differ only because the two runs used different
  // seeded cases — every other field, including the fingerprint and the
  // dedup key's rule/fingerprint suffix, must be identical.
  const strip = ({ caseId, dedupKey, ...rest }: (typeof dryRun.classificationChanges)[number]) =>
    rest;
  assert.deepEqual(
    dryRun!.classificationChanges.map(strip),
    applyPlan!.classificationChanges.map(strip),
  );
  assert.equal(
    dryRun!.classificationChanges[0].dedupKey,
    `mu:${recallCase.id}:classification_assigned:${dryRun!.classificationChanges[0].fingerprint}`,
  );
  assert.equal(
    applyPlan!.classificationChanges[0].dedupKey,
    `mu:${caseForApply.id}:classification_assigned:${applyPlan!.classificationChanges[0].fingerprint}`,
  );
});

test('an already-ledgered dedup key is identified as already existing', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(
    rawEnforcement({ classification: 'Class I' }),
  );
  const materialChangeRef = fingerprint('classified:class_I');
  const dedupKey = `mu:${recallCase.id}:classification_assigned:${materialChangeRef}`;
  // Simulate a ledger row that already exists for this exact dedup key,
  // independent of whatever the case's own classification says.
  await store.insertNotificationIfAbsent({
    recallCaseId: recallCase.id,
    kind: 'material_update',
    triggerRuleId: 'classification_assigned',
    dedupKey,
    materialChangeRef,
    payloadSummary: 'The agency classified this recall (Class I).',
    suppressed: null,
    sourceSnapshotIds: [],
    createdAt: '2026-08-20T00:00:00.000Z',
  });

  const outcome = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: false,
    now: NOW,
  });

  assert.equal(outcome?.classificationChanges[0]?.dedupKey, dedupKey);
  assert.equal(outcome?.classificationChanges[0]?.eventAlreadyExists, true);
});
