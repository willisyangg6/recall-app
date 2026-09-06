/**
 * O3-B1 enforcement atomicity: the two enforcement failure paths O3-A proved
 * (E2: a classification event describing a case version that was never
 * stored; E3: a permanently lost classification event after a crash between
 * the case write and the event insert) must now be structurally impossible —
 * the case transition and its events commit together, retries converge, and
 * a concurrent announcement write is never blindly overwritten.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectCase } from '../../domain/projection';
import type { NormalizedSourceRecord } from '../../domain/source-record';
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
  const recallCase = await store.insertCase({
    projection: projectCase([normalized]),
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

function classificationEvents(store: MemoryStore) {
  return [...store.notifications.values()].filter((n) => n.kind === 'material_update');
}

test('E2 reproduction converges: a crash after the enforcement snapshot can no longer emit an event for an unstored case', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const first = acceptedFor(rawEnforcement({}));
  await enrichCaseWithMatches(store, recallCase.id, first.accepted, first.rawByRecallNumber, {
    apply: true,
    now: NOW,
  });
  assert.equal(classificationEvents(store).length, 1); // classification_assigned

  // FDA corrects the record in place (Class II → Class I); the crash lands
  // in the E2 window — after the new snapshot is archived, before the
  // normalized write.
  const upgraded = acceptedFor(
    rawEnforcement({ classification: 'Class I', center_classification_date: '20260824' }),
  );
  const original = store.updateSourceRecordNormalized.bind(store);
  store.updateSourceRecordNormalized = async () => {
    store.updateSourceRecordNormalized = original;
    throw new Error('injected crash after enforcement snapshot');
  };
  await assert.rejects(
    () =>
      enrichCaseWithMatches(store, recallCase.id, upgraded.accepted, upgraded.rawByRecallNumber, {
        apply: true,
        now: NOW,
      }),
    /injected crash/,
  );
  // After the crash: archived + pending, and — the E2 fix — the case still
  // shows Class II with NO upgrade event. Pre-O3, the retry inserted the
  // upgrade event while skipping the case write (anyContentChange false).
  const linked = await store.getSourceRecordByNativeId('openfda_enforcement', 'F-1000-2026');
  assert.equal(linked?.applyState, 'pending');
  assert.equal(classificationEvents(store).length, 1);
  assert.equal((await store.getCase(recallCase.id))!.projection.classification.value, 'class_II');

  // The retry (same corpus, next daily run) commits case + event TOGETHER.
  const retry = await enrichCaseWithMatches(
    store,
    recallCase.id,
    upgraded.accepted,
    upgraded.rawByRecallNumber,
    { apply: true, now: NOW },
  );
  assert.deepEqual(retry?.materialChanges, ['classification_upgraded']);
  assert.equal((await store.getCase(recallCase.id))!.projection.classification.value, 'class_I');
  const events = classificationEvents(store);
  assert.equal(events.length, 2);
  assert.ok(events.some((e) => e.triggerRuleId === 'classification_upgraded'));
  assert.equal(
    (await store.getSourceRecordByNativeId('openfda_enforcement', 'F-1000-2026'))?.applyState,
    'applied',
  );
});

test('E3 reproduction converges: the event can no longer be lost between the case write and the insert', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(rawEnforcement({}));

  // The E3 window is INSIDE the transition now: an injected failure at the
  // event stage rolls back the case write too — all-or-nothing.
  let fired = false;
  store.transactionFailpoint = (stage) => {
    if (stage === 'transition:events' && !fired) {
      fired = true;
      store.transactionFailpoint = null;
      throw new Error('injected crash at the event stage');
    }
  };
  await assert.rejects(
    () =>
      enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
        apply: true,
        now: NOW,
      }),
    /injected crash/,
  );
  // Nothing committed: the case is still unclassified AND no event exists —
  // never one without the other.
  assert.equal(
    (await store.getCase(recallCase.id))!.projection.classification.value,
    'not_yet_classified',
  );
  assert.equal(classificationEvents(store).length, 0);

  // Retry: equality-on-retry can no longer lose the event, because equality
  // only ever holds AFTER the event committed with the case.
  const retry = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });
  assert.deepEqual(retry?.materialChanges, ['classification_assigned']);
  assert.equal((await store.getCase(recallCase.id))!.projection.classification.value, 'class_II');
  assert.equal(classificationEvents(store).length, 1);

  // And a further re-run is a pure no-op (dedup + fully-applied gate).
  const third = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });
  assert.deepEqual(third?.materialChanges, []);
  assert.equal(classificationEvents(store).length, 1);
});

test('enforcement overlapping a concurrent announcement write re-reads and keeps BOTH facts', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(rawEnforcement({}));

  // Between enrichment's case read and its transition, an announcement
  // ingest updates the case (new illness statement → new projection +
  // last_changed_at). The enrichment CAS must lose, re-read, and recompute —
  // never blindly overwrite the announcement's work.
  const realApply = store.applyCaseTransition.bind(store);
  let interfered = false;
  store.applyCaseTransition = async (transition) => {
    if (!interfered) {
      interfered = true;
      const current = store.cases.get(transition.recallCaseId)!;
      const announcementRecord = [...store.sourceRecords.values()].find(
        (r) => r.sourceSystem === 'fda_announcement',
      )!;
      announcementRecord.normalized = {
        ...announcementRecord.normalized,
        illnessStatement: 'Two illnesses have been reported.',
      };
      // The concurrent announcement writer read the case BEFORE the
      // enforcement record was linked, so its committed projection carries
      // the illness fact but not the classification.
      current.projection = projectCase([announcementRecord.normalized]);
      current.lastChangedAt = '2026-08-25T11:59:00.000Z';
    }
    return realApply(transition);
  };

  const outcome = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });

  assert.equal(outcome?.casExhausted, undefined);
  const updated = (await store.getCase(recallCase.id))!;
  // Both writers' facts survive: the announcement's illness statement AND
  // the enforcement classification.
  assert.equal(updated.projection.reportsIllness, true);
  assert.equal(updated.projection.classification.value, 'class_II');
  assert.equal(classificationEvents(store).length, 1);
});

test('CAS exhaustion leaves enforcement records pending and reports it — never a silent success', async () => {
  const store = new MemoryStore();
  const recallCase = await seedCase(store);
  const { accepted, rawByRecallNumber } = acceptedFor(rawEnforcement({}));

  const realApply = store.applyCaseTransition.bind(store);
  store.applyCaseTransition = async () => ({ status: 'conflict' as const });
  const outcome = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });
  assert.equal(outcome?.casExhausted, true);
  assert.equal(
    (await store.getSourceRecordByNativeId('openfda_enforcement', 'F-1000-2026'))?.applyState,
    'pending',
  );
  assert.equal(classificationEvents(store).length, 0);

  // The next daily run converges once contention clears.
  store.applyCaseTransition = realApply;
  const retry = await enrichCaseWithMatches(store, recallCase.id, accepted, rawByRecallNumber, {
    apply: true,
    now: NOW,
  });
  assert.equal(retry?.casExhausted, undefined);
  assert.equal((await store.getCase(recallCase.id))!.projection.classification.value, 'class_II');
  assert.equal(classificationEvents(store).length, 1);
});
