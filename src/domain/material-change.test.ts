import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFixture } from '../server/fsis/fixtures';
import { parseFsisRecord } from '../server/fsis/parse';
import { detectChanges } from './material-change';
import { projectCase } from './projection';
import type { CaseProjection } from './recall-types';

/** Base projections come from real records; tests mutate copies to model transitions. */
function base(): CaseProjection {
  return projectCase([parseFsisRecord(loadFixture('recall-active-nationwide-017-2026'))]);
}

function withChanges(projection: CaseProjection, patch: Partial<CaseProjection>): CaseProjection {
  return { ...projection, ...patch };
}

test('product expansion is material', () => {
  const prev = base();
  const next = withChanges(prev, {
    affectedProducts: [
      ...prev.affectedProducts,
      {
        sourceNativeId: '017-2026-EXP',
        name: 'additional product line',
        rawText: 'additional product line',
        extractionConfidence: 'stated',
      },
    ],
  });
  const result = detectChanges(prev, next);
  assert.deepEqual(
    result.material.map((m) => m.ruleId),
    ['expansion_products'],
  );
});

test('products appearing where there were none is a broadening correction', () => {
  const prev = withChanges(base(), { affectedProducts: [] });
  const result = detectChanges(prev, base());
  assert.deepEqual(
    result.material.map((m) => m.ruleId),
    ['correction_broadened'],
  );
});

test('geography widening is material; narrowing is timeline-only', () => {
  const nationwide = base(); // 017-2026 is nationwide
  const states = withChanges(nationwide, {
    geography: { scope: 'states', states: ['Texas'], confidence: 'stated', sourceText: 'Texas' },
  });
  const widened = detectChanges(states, nationwide);
  assert.deepEqual(
    widened.material.map((m) => m.ruleId),
    ['expansion_geography'],
  );
  const narrowed = detectChanges(nationwide, states);
  assert.equal(narrowed.material.length, 0);
  assert.ok(narrowed.nonMaterial.some((n) => n.includes('narrowed')));
});

test('classification assignment, upgrade, and downgrade are all material (corrected founder rule)', () => {
  const unclassified = withChanges(base(), {
    classification: { value: 'not_yet_classified', sourceText: null },
  });
  const classIII = withChanges(base(), {
    classification: { value: 'class_III', sourceText: 'Marginal - Class III' },
  });
  const classII = withChanges(base(), {
    classification: { value: 'class_II', sourceText: 'Low - Class II' },
  });
  const classI = base(); // real record is Class I

  // Assignment: unclassified → any class, including the least severe.
  for (const target of [classI, classII, classIII]) {
    const assigned = detectChanges(unclassified, target);
    assert.deepEqual(
      assigned.material.map((m) => m.ruleId),
      ['classification_assigned'],
    );
  }

  // Upgrades (toward Class I).
  const upgraded = detectChanges(classII, classI);
  assert.deepEqual(
    upgraded.material.map((m) => m.ruleId),
    ['classification_upgraded'],
  );
  assert.deepEqual(
    detectChanges(classIII, classII).material.map((m) => m.ruleId),
    ['classification_upgraded'],
  );

  // Downgrades are material and notification-eligible too.
  const downgraded = detectChanges(classI, classII);
  assert.deepEqual(
    downgraded.material.map((m) => m.ruleId),
    ['classification_downgraded'],
  );
  assert.deepEqual(
    detectChanges(classII, classIII).material.map((m) => m.ruleId),
    ['classification_downgraded'],
  );

  // Distinct transitions must have distinct fingerprints (distinct dedup keys).
  assert.notEqual(downgraded.material[0].fingerprint, upgraded.material[0].fingerprint);
});

test('closure is dashboard-visible but never a notification', () => {
  const closed = withChanges(base(), { state: 'closed', closedYear: '2026' });
  const result = detectChanges(base(), closed);
  assert.equal(result.material.length, 0);
  assert.deepEqual(result.nonMaterial, ['Recall closed by the agency.']);
});

test('retraction is always material', () => {
  const retracted = withChanges(base(), { state: 'retracted' });
  const result = detectChanges(base(), retracted);
  assert.deepEqual(
    result.material.map((m) => m.ruleId),
    ['retraction'],
  );
});

test('illness reports appearing are material', () => {
  const withIllness = withChanges(base(), {
    illnessStatement: 'FSIS has received reports of illness.',
    reportsIllness: true,
  });
  const result = detectChanges(base(), withIllness);
  assert.deepEqual(
    result.material.map((m) => m.ruleId),
    ['health_impact'],
  );
});

test('substantive consumer-instruction changes are material', () => {
  const prev = base();
  assert.ok(prev.consumerAction !== null);
  const next = withChanges(prev, {
    consumerAction: 'Do not open the package. Destroy the product immediately.',
  });
  const result = detectChanges(prev, next);
  assert.deepEqual(
    result.material.map((m) => m.ruleId),
    ['instructions_changed'],
  );
});

test('contact/quantity/wording churn is never material and never notifies', () => {
  const next = withChanges(base(), {
    contactText: 'New media contact, (555) 000-0000',
    quantityText: '1,626 lbs',
    summaryText: base().summaryText + ' ',
  });
  const result = detectChanges(base(), next);
  assert.equal(result.material.length, 0);
  assert.equal(result.nonMaterial.length, 0);
});

test('identical projections produce no changes at all', () => {
  const result = detectChanges(base(), base());
  assert.equal(result.material.length, 0);
  assert.equal(result.nonMaterial.length, 0);
});
