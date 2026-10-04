/**
 * The per-event policy table (event-eligibility.ts), row by row: a new
 * recall only for an active, unmerged case; a retraction only for a
 * retracted one; every other important update only for an active one; an
 * event on an absorbed duplicate re-pointed at its survivor unless the
 * survivor already carries it; an unresolvable chain never sends.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CaseProjection, LifecycleState } from '../../domain/recall-types';
import { decideDelivery, isRetraction, requiredDestinationState } from './event-eligibility';
import type { CaseLink, DeliverableEvent } from './types';

function projection(title: string, state: LifecycleState = 'active'): CaseProjection {
  return {
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state,
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    title,
    summaryText: '',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'peanut',
    recallingFirm: { displayName: 'Acme', rawVariants: [] },
    brands: [],
    productDescription: title,
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
    affectedProducts: [],
    quantityText: null,
    illnessStatement: null,
    reportsIllness: false,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://example.gov',
    otherOfficialUrls: [],
    sourceIdentifiers: [],
    publishedAt: '2026-09-01',
    lastPublicActivityAt: '2026-09-01',
  };
}

const CASE = '11111111-0000-4000-8000-00000000cccc';
const SURVIVOR = '22222222-0000-4000-8000-00000000cccc';

function link(id: string, state: LifecycleState, mergedInto: string | null = null): CaseLink {
  return { id, state, mergedInto, projection: projection(`Case ${id.slice(0, 8)}`, state) };
}

function event(
  overrides: Partial<DeliverableEvent> & { kind: DeliverableEvent['kind']; triggerRuleId: string },
): DeliverableEvent {
  return {
    id: '00000001-0000-4000-8000-000000000000',
    recallCaseId: CASE,
    materialChangeRef: overrides.kind === 'initial' ? null : 'fp',
    payloadSummary: 'summary',
    createdAt: '2026-09-01T00:00:00.000Z',
    caseState: 'active',
    mergedInto: null,
    projection: projection('Trail Mix'),
    ...overrides,
  };
}

const INITIAL = event({ kind: 'initial', triggerRuleId: 'new_case' });
const RETRACTION = event({ kind: 'material_update', triggerRuleId: 'retraction' });
const IMPORTANT_UPDATES = [
  'expansion_products',
  'expansion_geography',
  'correction_broadened',
  'classification_assigned',
  'classification_upgraded',
  'classification_downgraded',
  'classification_changed',
  'health_impact',
  'instructions_changed',
] as const;

test('only the retraction rule is a retraction, and it alone requires a retracted destination', () => {
  assert.equal(isRetraction(RETRACTION), true);
  assert.equal(requiredDestinationState(RETRACTION), 'retracted');
  assert.equal(isRetraction(INITIAL), false);
  for (const rule of IMPORTANT_UPDATES) {
    const update = event({ kind: 'material_update', triggerRuleId: rule });
    assert.equal(isRetraction(update), false, rule);
    assert.equal(requiredDestinationState(update), 'active', rule);
  }
  // The `initial` kind never reads as a retraction, whatever its trigger says.
  assert.equal(isRetraction(event({ kind: 'initial', triggerRuleId: 'retraction' })), false);
});

test('a new recall delivers only for an active case; closed and retracted cases are not news', () => {
  const active = decideDelivery(INITIAL, {
    destination: link(CASE, 'active'),
    survivorHasTwin: false,
  });
  assert.equal(active.kind, 'deliver');
  if (active.kind === 'deliver') {
    assert.equal(active.rerouted, false);
    assert.equal(active.event, INITIAL, 'an unmerged event is handed back as is');
  }
  for (const state of ['closed', 'retracted'] as const) {
    assert.deepEqual(
      decideDelivery(INITIAL, { destination: link(CASE, state), survivorHasTwin: false }),
      { kind: 'skip', reason: 'lifecycle' },
      state,
    );
  }
});

test('a retraction delivers for the retracted case and never for one that is not retracted', () => {
  const retracted = decideDelivery(RETRACTION, {
    destination: link(CASE, 'retracted'),
    survivorHasTwin: false,
  });
  assert.equal(retracted.kind, 'deliver');
  for (const state of ['active', 'closed'] as const) {
    assert.deepEqual(
      decideDelivery(RETRACTION, { destination: link(CASE, state), survivorHasTwin: false }),
      { kind: 'skip', reason: 'lifecycle' },
      state,
    );
  }
});

test('every supported important update delivers for an active case and for no other state', () => {
  for (const rule of IMPORTANT_UPDATES) {
    const update = event({ kind: 'material_update', triggerRuleId: rule });
    assert.equal(
      decideDelivery(update, { destination: link(CASE, 'active'), survivorHasTwin: false }).kind,
      'deliver',
      rule,
    );
    for (const state of ['closed', 'retracted'] as const) {
      assert.deepEqual(
        decideDelivery(update, { destination: link(CASE, state), survivorHasTwin: false }),
        { kind: 'skip', reason: 'lifecycle' },
        `${rule} on a ${state} case`,
      );
    }
  }
});

test('on an absorbed duplicate: the initial is dropped, an update is re-pointed at the survivor', () => {
  const absorbed = { ...INITIAL, caseState: 'active' as const, mergedInto: SURVIVOR };
  assert.deepEqual(
    decideDelivery(absorbed, { destination: link(SURVIVOR, 'active'), survivorHasTwin: false }),
    { kind: 'skip', reason: 'merged_duplicate' },
  );

  const update = event({
    kind: 'material_update',
    triggerRuleId: 'expansion_products',
    mergedInto: SURVIVOR,
  });
  const survivor = link(SURVIVOR, 'active');
  const decision = decideDelivery(update, { destination: survivor, survivorHasTwin: false });
  assert.equal(decision.kind, 'deliver');
  if (decision.kind === 'deliver') {
    assert.equal(decision.rerouted, true);
    // The alert names, and its tap opens, the surviving case — the card the
    // Feed actually lists — formatted from THAT case's projection.
    assert.equal(decision.event.recallCaseId, SURVIVOR);
    assert.equal(decision.event.projection, survivor.projection);
    assert.equal(decision.event.id, update.id, 'the ledger row is the same event');
    assert.equal(decision.event.triggerRuleId, 'expansion_products');
  }
  // When the survivor carries the same change itself, the re-pointed copy
  // would be a second alert for one change: dropped.
  assert.deepEqual(decideDelivery(update, { destination: survivor, survivorHasTwin: true }), {
    kind: 'skip',
    reason: 'merged_duplicate',
  });
  // And the survivor's lifecycle still governs the re-pointed update.
  assert.deepEqual(
    decideDelivery(update, { destination: link(SURVIVOR, 'closed'), survivorHasTwin: false }),
    { kind: 'skip', reason: 'lifecycle' },
  );
});

test('a retraction on an absorbed duplicate follows the survivor: sent only if the survivor is retracted', () => {
  const retraction = { ...RETRACTION, mergedInto: SURVIVOR };
  const sent = decideDelivery(retraction, {
    destination: link(SURVIVOR, 'retracted'),
    survivorHasTwin: false,
  });
  assert.equal(sent.kind, 'deliver');
  if (sent.kind === 'deliver') assert.equal(sent.event.recallCaseId, SURVIVOR);
  assert.deepEqual(
    decideDelivery(retraction, { destination: link(SURVIVOR, 'active'), survivorHasTwin: false }),
    { kind: 'skip', reason: 'lifecycle' },
  );
  assert.deepEqual(
    decideDelivery(retraction, { destination: link(SURVIVOR, 'retracted'), survivorHasTwin: true }),
    { kind: 'skip', reason: 'merged_duplicate' },
  );
});

test('no canonical destination, no alert: a missing or still-merged resolution never sends', () => {
  assert.deepEqual(decideDelivery(INITIAL, { destination: null, survivorHasTwin: false }), {
    kind: 'skip',
    reason: 'unresolved',
  });
  // A destination that is itself a tombstone is a resolver bug, refused here too.
  assert.deepEqual(
    decideDelivery(INITIAL, {
      destination: link(SURVIVOR, 'active', '33333333-0000-4000-8000-00000000cccc'),
      survivorHasTwin: false,
    }),
    { kind: 'skip', reason: 'unresolved' },
  );
});
