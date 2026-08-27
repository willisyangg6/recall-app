import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFixture } from './fsis/fixtures';
import type { FsisRawRecord } from './fsis/parse';
import { runFsisIngest } from './pipeline';
import { MemoryStore } from './store/memory-store';

const NOW = () => new Date('2026-08-21T12:00:00Z');

function input(records: FsisRawRecord[]) {
  return {
    records,
    fetchedAt: NOW().toISOString(),
    sourceUrl: 'https://www.fsis.usda.gov/fsis/api/recall/v/1?field_translation_language=en',
  };
}

/**
 * Derive a "before" variant of a real record to model a source transition.
 * Derivations are subtractive/synthetic test inputs only — never displayed or
 * persisted as recall data outside these tests.
 */
function derive(fixture: string, patch: Partial<FsisRawRecord>): FsisRawRecord {
  return { ...loadFixture(fixture), ...patch };
}

test('fresh ingest creates cases, records, snapshots, and initial notifications', async () => {
  const store = new MemoryStore();
  const records = [
    loadFixture('recall-active-nationwide-017-2026'),
    loadFixture('recall-active-stated-states-016-2026'),
    loadFixture('pha-active-nationwide-pha-08082026-01'),
  ];
  const summary = await runFsisIngest(store, input(records), { now: NOW });

  assert.equal(summary.newCases, 3);
  assert.equal(summary.quarantined.length, 0);
  assert.equal(store.cases.size, 3);
  assert.equal(store.sourceRecords.size, 3);
  assert.equal(store.snapshots.length, 3);
  // All three published within 30 days of NOW → real initial notifications.
  assert.equal(summary.notifications.initial, 3);
  assert.equal(summary.notifications.suppressed, 0);

  // The PHA stays a distinctly labeled notice type, never relabeled as a recall.
  const pha = [...store.cases.values()].find(
    (c) => c.projection.noticeType === 'public_health_alert',
  );
  assert.ok(pha);
  assert.equal(pha.projection.classification.value, 'not_applicable_pha');
});

test('repeat identical ingestion is fully idempotent', async () => {
  const store = new MemoryStore();
  const records = [
    loadFixture('recall-active-nationwide-017-2026'),
    loadFixture('pha-active-nationwide-pha-08082026-01'),
  ];
  await runFsisIngest(store, input(records), { now: NOW });
  const secondSummary = await runFsisIngest(store, input(records), { now: NOW });

  assert.equal(secondSummary.unchanged, 2);
  assert.equal(secondSummary.newCases, 0);
  assert.equal(secondSummary.changedCases, 0);
  assert.equal(store.cases.size, 2);
  assert.equal(store.sourceRecords.size, 2);
  assert.equal(store.snapshots.length, 2); // hash-gated: no duplicate snapshots
  assert.equal(store.notifications.size, 2); // no duplicate notification events
});

test('old records at discovery get backfill-suppressed initial notifications', async () => {
  const store = new MemoryStore();
  const summary = await runFsisIngest(
    store,
    input([loadFixture('recall-closed-dirty-number-034-2024')]), // published 2024-12-20
    { now: NOW },
  );
  assert.equal(summary.newCases, 1);
  assert.equal(summary.notifications.initial, 0);
  assert.equal(summary.notifications.suppressed, 1);
  const event = [...store.notifications.values()][0];
  assert.equal(event.kind, 'initial');
  assert.equal(event.suppressed, 'backfill');
});

test('an in-place source change snapshots but does not notify without a material diff', async () => {
  const store = new MemoryStore();
  const original = loadFixture('recall-active-nationwide-017-2026');
  await runFsisIngest(store, input([original]), { now: NOW });

  // FSIS updates quantity-recovered in place (source contract §4.1) — a Layer-1
  // change with no consumer-relevant meaning.
  const edited = derive('recall-active-nationwide-017-2026', {
    field_qty_recovered: '1,626 lbs',
  });
  const summary = await runFsisIngest(store, input([edited]), { now: NOW });

  assert.equal(store.snapshots.length, 2); // new snapshot: the source did change
  assert.equal(summary.changedCases, 1);
  assert.equal(
    [...store.notifications.values()].filter((n) => n.kind === 'material_update').length,
    0,
  );
  // The change is still auditable on the timeline.
  const recallCase = [...store.cases.values()][0];
  assert.ok(recallCase.timeline.some((t) => t.kind === 'source_updated' && !t.material));
});

test('an expansion record joins its parent case and produces one material notification', async () => {
  // Clock chosen so the expansion's last activity (2026-04-15) is recent.
  const april = () => new Date('2026-04-20T12:00:00Z');
  const store = new MemoryStore();
  await runFsisIngest(store, input([loadFixture('recall-closed-parent-005-2026')]), {
    now: april,
  });
  const summary = await runFsisIngest(
    store,
    input([
      loadFixture('recall-closed-parent-005-2026'),
      loadFixture('recall-closed-expansion-005-2026-exp'),
    ]),
    { now: april },
  );

  // One coherent case, two government records — not two cards.
  assert.equal(store.cases.size, 1);
  assert.equal(store.sourceRecords.size, 2);
  const expansionRecord = await store.getSourceRecordByNativeId('fsis_api', '005-2026-EXP');
  assert.equal(expansionRecord?.linkMethod, 'expansion_prefix');

  const updates = [...store.notifications.values()].filter((n) => n.kind === 'material_update');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].triggerRuleId, 'expansion_products');
  assert.equal(updates[0].suppressed, null);
  assert.equal(summary.notifications.materialUpdate, 1);

  // Re-running the same feed must not repeat the logical event.
  await runFsisIngest(
    store,
    input([
      loadFixture('recall-closed-parent-005-2026'),
      loadFixture('recall-closed-expansion-005-2026-exp'),
    ]),
    { now: april },
  );
  assert.equal(
    [...store.notifications.values()].filter((n) => n.kind === 'material_update').length,
    1,
  );
});

test('closure updates lifecycle without notifying', async () => {
  const store = new MemoryStore();
  // Subtractive derivation: the same real record before FSIS closed it.
  const whileActive = derive('recall-closed-parent-005-2026', {
    field_recall_type: 'Active Recall',
    field_closed_year: '',
    field_archive_recall: 'False',
  });
  await runFsisIngest(store, input([whileActive]), { now: NOW });
  assert.equal([...store.cases.values()][0].projection.state, 'active');

  await runFsisIngest(store, input([loadFixture('recall-closed-parent-005-2026')]), { now: NOW });
  const recallCase = [...store.cases.values()][0];
  assert.equal(recallCase.projection.state, 'closed');
  assert.equal(recallCase.projection.closedYear, '2026');
  assert.ok(recallCase.timeline.some((t) => t.kind === 'closed' && !t.material));
  assert.equal(
    [...store.notifications.values()].filter((n) => n.kind === 'material_update').length,
    0,
  );
});

test('classification assignment is material and notification-eligible', async () => {
  const store = new MemoryStore();
  // Derived pre-classification state of a real record (blank classification).
  const unclassified = derive('recall-active-nationwide-017-2026', {
    field_recall_classification: '',
    field_risk_level: '',
  });
  await runFsisIngest(store, input([unclassified]), { now: NOW });
  assert.equal([...store.cases.values()][0].projection.classification.value, 'not_yet_classified');

  const summary = await runFsisIngest(
    store,
    input([loadFixture('recall-active-nationwide-017-2026')]),
    { now: NOW },
  );
  assert.equal([...store.cases.values()][0].projection.classification.value, 'class_I');
  assert.equal(summary.notifications.materialUpdate, 1);
  const update = [...store.notifications.values()].find((n) => n.kind === 'material_update');
  assert.equal(update?.triggerRuleId, 'classification_assigned');
});

test('classification upgrade (Class III → Class I) is material', async () => {
  const store = new MemoryStore();
  const classIII = derive('recall-active-nationwide-017-2026', {
    field_recall_classification: 'Class III',
    field_risk_level: 'Marginal - Class III',
  });
  await runFsisIngest(store, input([classIII]), { now: NOW });
  const summary = await runFsisIngest(
    store,
    input([loadFixture('recall-active-nationwide-017-2026')]),
    { now: NOW },
  );
  assert.equal(summary.notifications.materialUpdate, 1);
  const update = [...store.notifications.values()].find((n) => n.kind === 'material_update');
  assert.equal(update?.triggerRuleId, 'classification_upgraded');
});

test('classification downgrade (Class I → Class II) is material and notification-eligible', async () => {
  const store = new MemoryStore();
  await runFsisIngest(store, input([loadFixture('recall-active-nationwide-017-2026')]), {
    now: NOW,
  }); // real record is Class I
  const downgraded = derive('recall-active-nationwide-017-2026', {
    field_recall_classification: 'Class II',
    field_risk_level: 'Low - Class II',
  });
  const summary = await runFsisIngest(store, input([downgraded]), { now: NOW });

  assert.equal(summary.notifications.materialUpdate, 1);
  const update = [...store.notifications.values()].find((n) => n.kind === 'material_update');
  assert.equal(update?.triggerRuleId, 'classification_downgraded');
  assert.equal(update?.suppressed, null);
});

test('coalescing marks delivery-suppressed but keeps the classification event in the ledger', async () => {
  const store = new MemoryStore();
  const unclassified = derive('recall-active-nationwide-017-2026', {
    field_recall_classification: '',
    field_risk_level: '',
  });
  await runFsisIngest(store, input([unclassified]), { now: NOW });

  // First material change today: classification assigned (Class I) — delivered.
  await runFsisIngest(store, input([loadFixture('recall-active-nationwide-017-2026')]), {
    now: NOW,
  });
  // Second material change within 24h: classification changed to Class II.
  const downgraded = derive('recall-active-nationwide-017-2026', {
    field_recall_classification: 'Class II',
    field_risk_level: 'Low - Class II',
  });
  const summary = await runFsisIngest(store, input([downgraded]), { now: NOW });

  // The 24h rate guard coalesces delivery… (summary counts it as suppressed)
  assert.equal(summary.notifications.materialUpdate, 0);
  assert.equal(summary.notifications.suppressed, 1);
  // …but the underlying classification-change event MUST remain auditable.
  const events = [...store.notifications.values()].filter((n) => n.kind === 'material_update');
  assert.deepEqual(events.map((e) => e.triggerRuleId).sort(), [
    'classification_assigned',
    'classification_downgraded',
  ]);
  const coalesced = events.find((e) => e.triggerRuleId === 'classification_downgraded');
  assert.equal(coalesced?.suppressed, 'coalesced');
});

test('a PHA retraction retracts the case and always notifies', async () => {
  // Clock near the real retraction date (2026-04-06) so it is not backfill.
  const april = () => new Date('2026-04-08T12:00:00Z');
  const store = new MemoryStore();
  // Derived pre-retraction state of the real record: FSIS mutated this record
  // in place when it retracted the alert (observed live; contract §4.1).
  const retraction = loadFixture('pha-retraction-pha-04012026-01');
  const beforeRetraction = derive('pha-retraction-pha-04012026-01', {
    field_title: retraction.field_title.replace(
      /^FSIS Retracts Public Health Alert/,
      'FSIS Issues Public Health Alert',
    ),
    field_recall_date: '2026-04-01',
  });
  await runFsisIngest(store, input([beforeRetraction]), { now: april });
  assert.equal([...store.cases.values()][0].projection.state, 'active');

  const summary = await runFsisIngest(store, input([retraction]), { now: april });
  const recallCase = [...store.cases.values()][0];
  assert.equal(recallCase.projection.state, 'retracted');
  assert.equal(summary.notifications.materialUpdate, 1);
  const update = [...store.notifications.values()].find((n) => n.kind === 'material_update');
  assert.equal(update?.triggerRuleId, 'retraction');
  assert.equal(update?.suppressed, null);
});

test('unparseable records are quarantined without aborting the run', async () => {
  const store = new MemoryStore();
  const broken = derive('recall-active-stated-states-016-2026', { field_recall_number: '' });
  const summary = await runFsisIngest(
    store,
    input([broken, loadFixture('recall-active-nationwide-017-2026')]),
    { now: NOW },
  );
  assert.equal(summary.quarantined.length, 1);
  assert.equal(summary.newCases, 1); // the healthy record still ingested
  const run = [...store.ingestRuns.values()][0];
  assert.equal(run.outcome, 'succeeded');
  assert.equal(run.quarantined?.length, 1);
});

test('an empty structured state field is recovered from the notice’s own prose', async () => {
  const store = new MemoryStore();
  // 006-2025 carries `field_states: []`, yet its summary says the items "were
  // distributed to vending machines in office buildings in the state of
  // Washington". Reading only the structured field left a Washington shopper
  // looking at "Distribution not specified" about a recall in their state.
  await runFsisIngest(store, input([loadFixture('recall-closed-unknown-geography-006-2025')]), {
    now: NOW,
  });
  const projection = [...store.cases.values()][0].projection;
  assert.equal(projection.geography.scope, 'states');
  assert.deepEqual(projection.geography.states, ['Washington']);
});

test('unknown geography survives the whole pipeline honestly', async () => {
  const store = new MemoryStore();
  // The same record with every distribution statement removed: no structured
  // states, no prose, no table. Unknown is then the only honest answer, and
  // it must never be rounded to nationwide or to an empty state list.
  const silent = derive('recall-closed-unknown-geography-006-2025', {
    field_summary:
      '<p>LPK1, a Renton, Wash. establishment, is recalling approximately 303 pounds ' +
      'of ready-to-eat chicken Caesar wrap products due to misbranding and an ' +
      'undeclared allergen.</p>',
  });
  await runFsisIngest(store, input([silent]), { now: NOW });
  const projection = [...store.cases.values()][0].projection;
  assert.equal(projection.geography.scope, 'unknown');
  assert.deepEqual(projection.geography.states, []);
});

test('a declared FDA expansion joins its parent case through the evidence search', async () => {
  const { runSourceIngest } = await import('./pipeline');
  const { isExpansionOfSameEvent } = await import('./duplicates');
  const base = (overrides: Record<string, unknown>) => ({
    sourceSystem: 'fda_announcement' as const,
    sourceAgency: 'FDA' as const,
    rawNativeId: '/safety/x',
    noticeType: 'recall' as const,
    lifecycle: 'active' as const,
    closedYear: null,
    classification: { value: 'not_yet_classified' as const, sourceText: null },
    expansionOfNativeId: null,
    isRetractionNotice: false,
    retractsNativeIds: [],
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen' as const,
    pathogenOrAllergen: 'undeclared milk',
    firmDisplayName: 'Fayus, Inc.',
    firmRawVariants: ['Fayus, Inc.'],
    brands: [],
    productDescription: null,
    imageUrls: [],
    geography: {
      scope: 'unknown' as const,
      states: [],
      confidence: 'inferred' as const,
      sourceText: null,
    },
    retailerNames: [],
    heroImageUrl: null,
    productLines: [],
    quantityText: null,
    illnessStatement: null,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fda.gov/x',
    lastModifiedAt: null,
    ...overrides,
  });
  const original = base({
    nativeId: 'fayus-inc-recalls-ola-ola-pounded-yam',
    title:
      'Fayus Inc., dba Yusol International Foods Recalls OLA-OLA POUNDED YAM Due to Undeclared Milk Allergen',
    summaryText:
      'Fayus Inc. is voluntarily recalling OLA-OLA POUNDED YAM because the product may contain undeclared milk in the form of sodium caseinate, which is not declared on the label. The recall is being initiated as a result of an internal investigation discovering that some packaged OLA-OLA POUNDED YAM had been distributed in packaging that did not disclose the presence of sodium caseinate derived from milk. Consumers who have purchased the product are urged to return it to the place of purchase.',
    publishedAt: '2026-07-07',
    declaresExpansion: false,
  });
  const expansion = base({
    nativeId: 'fayus-inc-expands-recall-ola-ola-pounded-yam',
    title:
      'Fayus Inc., dba Yusol International Foods Expands Recall of OLA-OLA POUNDED YAM Due to Undeclared Milk Allergen',
    summaryText:
      'Fayus Inc. is expanding its recall of OLA-OLA POUNDED YAM to include product sizes 2lbs, 4lbs, 5lbs, and 10lbs due to product labeling omission of an undeclared milk allergen for sodium caseinate, a milk derivative. The recall was initiated, and later expanded, as a result of an internal investigation discovering that some packaged OLA-OLA POUNDED YAM had been distributed in packaging that did not disclose the presence of sodium caseinate derived from milk. Consumers who have purchased the product are urged to return it to the place of purchase.',
    publishedAt: '2026-07-17',
    declaresExpansion: true,
  });

  const store = new MemoryStore();
  const ingest = (items: unknown[]) =>
    runSourceIngest(
      store,
      {
        sourceSystem: 'fda_announcement',
        items: items.map((normalized) => ({ raw: normalized, normalized })) as never,
        quarantined: [],
        itemsSeen: items.length,
        fetchedAt: NOW().toISOString(),
      },
      { now: NOW, expansionReferenceGuard: isExpansionOfSameEvent },
    );

  await ingest([original]);
  const first = await ingest([expansion]);
  // One real-world recall, one case: the expansion joined its parent.
  assert.equal(first.newCases, 0);
  assert.equal(store.cases.size, 1);
  const linked = await store.getSourceRecordByNativeId(
    'fda_announcement',
    'fayus-inc-expands-recall-ola-ola-pounded-yam',
  );
  assert.equal(linked?.linkMethod, 'expansion_prefix');
  // The merged case speaks with the expansion's voice and keeps the original
  // announce date.
  const recallCase = await store.getCase(linked!.recallCaseId);
  assert.match(recallCase!.projection.title, /Expands Recall/);
  assert.equal(recallCase!.projection.publishedAt, '2026-07-07');

  // Ambiguity founds a separate case: with TWO qualifying parent cases, the
  // lineage is not decidable and nothing is guessed.
  const store2 = new MemoryStore();
  const originalB = base({
    nativeId: 'fayus-inc-recalls-ola-ola-pounded-yam-second',
    title:
      'Fayus Inc., dba Yusol International Foods Recalls OLA-OLA POUNDED YAM Due to Undeclared Milk Allergen',
    summaryText: (original as unknown as { summaryText: string }).summaryText,
    publishedAt: '2026-07-08',
    declaresExpansion: false,
  });
  await runSourceIngest(
    store2,
    {
      sourceSystem: 'fda_announcement',
      items: [original, originalB].map((normalized) => ({ raw: normalized, normalized })) as never,
      quarantined: [],
      itemsSeen: 2,
      fetchedAt: NOW().toISOString(),
    },
    { now: NOW, expansionReferenceGuard: isExpansionOfSameEvent },
  );
  assert.equal(store2.cases.size, 2);
  await runSourceIngest(
    store2,
    {
      sourceSystem: 'fda_announcement',
      items: [{ raw: expansion, normalized: expansion }] as never,
      quarantined: [],
      itemsSeen: 1,
      fetchedAt: NOW().toISOString(),
    },
    { now: NOW, expansionReferenceGuard: isExpansionOfSameEvent },
  );
  assert.equal(store2.cases.size, 3);
  const ambiguous = await store2.getSourceRecordByNativeId(
    'fda_announcement',
    'fayus-inc-expands-recall-ola-ola-pounded-yam',
  );
  assert.equal(ambiguous?.linkMethod, 'self');
});

test('a declared FDA revision joins the recall it corrects — one case, one initial notification', async () => {
  const { runSourceIngest } = await import('./pipeline');
  const { isExpansionOfSameEvent, isRevisionOfSameEvent } = await import('./duplicates');
  // The live Momchipz shape (verified 2026-08-25): FDA republished the
  // announcement under a fresh slug because the corrected title renamed the
  // allergen (gluten → wheat); the new body opens with an editorial revision
  // note; the old slug left the listing and 301-redirects to the new one.
  const glutenBody =
    'August 14, 2026, Exotique Foods Inc in Ontario, Canada is recalling Momchipz Veggie Chips Broccoli Florets & Cauliflower because it may contain undeclared gluten. People who have an allergy or severe sensitivity to gluten run the risk of serious or life-threatening allergic reaction if they consume this product. The Momchipz Veggie Chips Broccoli Florets & Cauliflower was sold to 49 U.S. customers through Amazon.com between March 2026 and June 2026 Product information as follows: Brand: Momchipz Product: Veggie Chips – Broccoli Florets & Cauliflower Size: 3oz (85 g) UPC: 6 28634 44216 6 Best Before: 2026 AUGUST 31 No illnesses have been reported to date. This recall was initiated based on a retail sample result provided by the Canadian Food Inspection Agency.';
  const base = (overrides: Record<string, unknown>) => ({
    sourceSystem: 'fda_announcement' as const,
    sourceAgency: 'FDA' as const,
    rawNativeId: '/safety/x',
    noticeType: 'recall' as const,
    lifecycle: 'active' as const,
    closedYear: null,
    classification: { value: 'not_yet_classified' as const, sourceText: null },
    expansionOfNativeId: null,
    isRetractionNotice: false,
    retractsNativeIds: [],
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen' as const,
    firmDisplayName: 'Exotique Foods Inc',
    firmRawVariants: ['Exotique Foods Inc'],
    brands: [],
    productDescription: null,
    imageUrls: [],
    geography: {
      scope: 'unknown' as const,
      states: [],
      confidence: 'inferred' as const,
      sourceText: null,
    },
    retailerNames: [],
    heroImageUrl: null,
    productLines: [],
    quantityText: null,
    illnessStatement: null,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fda.gov/x',
    lastModifiedAt: null,
    ...overrides,
  });
  const original = base({
    nativeId:
      'exotique-foods-inc-recalls-momchipz-veggie-chips-broccoli-florets-cauliflower-due-undeclared-gluten',
    title:
      'Exotique Foods Inc Recalls Momchipz Veggie Chips Broccoli Florets & Cauliflower Due to Undeclared Gluten',
    summaryText: glutenBody,
    pathogenOrAllergen: 'undeclared gluten',
    publishedAt: '2026-08-19',
    declaresExpansion: false,
    declaresRevision: false,
  });
  const revision = base({
    nativeId:
      'exotique-foods-inc-recalls-momchipz-veggie-chips-broccoli-florets-cauliflower-due-undeclared-wheat',
    title:
      'Exotique Foods Inc Recalls Momchipz Veggie Chips Broccoli Florets & Cauliflower Due to Undeclared Wheat',
    summaryText:
      '“On 8/24/2026, the recalling firm updated their press release to correctly identify wheat, rather than gluten, as the allergen.” ' +
      glutenBody.replace(/gluten/g, 'wheat'),
    pathogenOrAllergen: 'undeclared wheat',
    publishedAt: '2026-08-24',
    declaresExpansion: false,
    declaresRevision: true,
  });

  const LATER = () => new Date('2026-08-25T12:00:00Z');
  const store = new MemoryStore();
  type Rec = Parameters<typeof isExpansionOfSameEvent>[0];
  const guard = (child: Rec, parent: Rec) =>
    isExpansionOfSameEvent(child, parent) || isRevisionOfSameEvent(child, parent);
  const ingest = (items: unknown[]) =>
    runSourceIngest(
      store,
      {
        sourceSystem: 'fda_announcement',
        items: items.map((normalized) => ({ raw: normalized, normalized })) as never,
        quarantined: [],
        itemsSeen: items.length,
        fetchedAt: LATER().toISOString(),
      },
      { now: LATER, expansionReferenceGuard: guard },
    );

  await ingest([original]);
  const second = await ingest([revision]);
  // One real-world recall, one case: the correction joined the original.
  assert.equal(second.newCases, 0);
  assert.equal(store.cases.size, 1);
  const linked = await store.getSourceRecordByNativeId(
    'fda_announcement',
    'exotique-foods-inc-recalls-momchipz-veggie-chips-broccoli-florets-cauliflower-due-undeclared-wheat',
  );
  assert.equal(linked?.linkMethod, 'expansion_prefix');
  // The merged case speaks with the corrected voice, keeps the original
  // announce date, and names the corrected allergen.
  const recallCase = await store.getCase(linked!.recallCaseId);
  assert.match(recallCase!.projection.title, /Undeclared Wheat/);
  assert.equal(recallCase!.projection.publishedAt, '2026-08-19');
  assert.equal(recallCase!.projection.pathogenOrAllergen, 'undeclared wheat');
  // Exactly ONE initial notification ever — the correction is an update to
  // the recall the user already heard about, never a second "new recall".
  const initials = [...store.notifications.values()].filter((n) => n.kind === 'initial');
  assert.equal(initials.length, 1);
  assert.match(initials[0].payloadSummary, /Undeclared Gluten/);
});
