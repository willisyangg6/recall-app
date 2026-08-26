import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFixture } from '../server/fsis/fixtures';
import { parseFsisRecord } from '../server/fsis/parse';
import { detectChanges, fingerprint } from './material-change';
import { projectCase } from './projection';
import type { CaseProjection, OfficialClass } from './recall-types';
import { classSetKey, consumerRiskTier } from './risk-tier';

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

/** A case projection carrying an authoritative class SET. */
function withClasses(classes: OfficialClass[]): CaseProjection {
  return withChanges(base(), {
    classification: {
      value:
        classes.length === 0
          ? 'not_yet_classified'
          : classes.length === 1
            ? classes[0]
            : 'multiple_classes',
      sourceText: null,
      officialClasses: classes,
    },
  });
}

test('classification changes are detected on the authoritative class SET', () => {
  const pending = withClasses([]);
  const one = withClasses(['class_I']);
  const mixed = withClasses(['class_I', 'class_II']);

  // pending → single, pending → mixed: one assignment each.
  assert.deepEqual(
    detectChanges(pending, one).material.map((m) => m.ruleId),
    ['classification_assigned'],
  );
  const assignedMixed = detectChanges(pending, mixed);
  assert.deepEqual(
    assignedMixed.material.map((m) => m.ruleId),
    ['classification_assigned'],
  );
  assert.match(assignedMixed.material[0].summary, /Class I and Class II/);

  // single → mixed and mixed → single are real regulatory changes, but no
  // direction is claimed between sets.
  assert.deepEqual(
    detectChanges(one, mixed).material.map((m) => m.ruleId),
    ['classification_changed'],
  );
  assert.deepEqual(
    detectChanges(mixed, one).material.map((m) => m.ruleId),
    ['classification_changed'],
  );
});

test('a changed class set is material even when the consumer tier is unchanged', () => {
  // {I, III} → {I, II} is High → High for consumers, and still an official
  // classification change: the SET is the authoritative fact.
  const before = withClasses(['class_I', 'class_III']);
  const after = withClasses(['class_I', 'class_II']);
  assert.equal(consumerRiskTier(before.classification), consumerRiskTier(after.classification));
  const changed = detectChanges(before, after);
  assert.deepEqual(
    changed.material.map((m) => m.ruleId),
    ['classification_changed'],
  );
});

test('one classification transition is exactly one material change', () => {
  // The consumer tier is derived, so it can never add a second event of its
  // own — Pending → Critical is one notification, not two.
  const transitions: [OfficialClass[], OfficialClass[]][] = [
    [[], ['class_I']],
    [[], ['class_I', 'class_II']],
    [['class_II'], ['class_I']],
    [['class_I'], ['class_I', 'class_II']],
    [['class_I', 'class_II'], ['class_I']],
    [['class_II', 'class_III'], ['class_II']],
    [
      ['class_I', 'class_III'],
      ['class_I', 'class_II'],
    ],
  ];
  for (const [from, to] of transitions) {
    const result = detectChanges(withClasses(from), withClasses(to));
    assert.equal(result.material.length, 1, `${classSetKey(from)} → ${classSetKey(to)}`);
    assert.ok(result.material[0].ruleId.startsWith('classification_'));
  }
});

test('an unchanged class set produces no classification event', () => {
  for (const classes of [[], ['class_I'], ['class_I', 'class_II']] as OfficialClass[][]) {
    const result = detectChanges(withClasses(classes), withClasses(classes));
    assert.equal(
      result.material.filter((m) => m.ruleId.startsWith('classification_')).length,
      0,
      classSetKey(classes),
    );
  }
});

test('single-class dedup keys are unchanged by the set migration', () => {
  // Already-ledgered assignments must not re-fire: the fingerprint of a
  // single-class transition has to be byte-identical to the pre-set version.
  assert.equal(
    detectChanges(withClasses([]), withClasses(['class_II'])).material[0].fingerprint,
    fingerprint('classified:class_II'),
  );
  assert.equal(
    detectChanges(withClasses(['class_II']), withClasses(['class_I'])).material[0].fingerprint,
    fingerprint('upgraded:class_II->class_I'),
  );
  assert.equal(
    detectChanges(withClasses(['class_I']), withClasses(['class_II'])).material[0].fingerprint,
    fingerprint('downgraded:class_I->class_II'),
  );
});

test('losing every official class is a data regression, never a notification', () => {
  const result = detectChanges(withClasses(['class_I', 'class_II']), withClasses([]));
  assert.equal(result.material.length, 0);
  assert.ok(result.nonMaterial.some((n) => n.includes('Classification changed')));
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
