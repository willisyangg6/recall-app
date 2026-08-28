/**
 * Conservative allergen-only classification (C5.2B).
 *
 * This is the only rule in the product that can REMOVE a recall from Affects
 * Me, so the tests below are mostly about what it refuses to claim.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyAllergenOnly, isKnownAllergenMismatch, type HazardFacts } from './allergen-only';

function facts(overrides: Partial<HazardFacts> = {}): HazardFacts {
  return {
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'undeclared milk',
    reasonText: 'Unreported Allergens',
    ...overrides,
  };
}

test('a named allergen-only recall is identified, with canonical tokens', () => {
  assert.deepEqual(classifyAllergenOnly(facts()), { kind: 'identified', tokens: ['milk'] });
  // Source vocabulary is normalized by the existing canonical mapper.
  assert.deepEqual(
    classifyAllergenOnly(facts({ pathogenOrAllergen: 'undeclared cashews and soybeans' })),
    { kind: 'identified', tokens: ['soy', 'tree nuts'] },
  );
});

test('every non-allergen hazard category is a general hazard', () => {
  for (const category of [
    'microbial_contamination',
    'foreign_material',
    'chemical_contamination',
    'product_integrity',
    'other_regulatory',
    'unknown',
  ]) {
    assert.deepEqual(
      classifyAllergenOnly(facts({ hazardCategory: category })),
      { kind: 'not_allergen_only' },
      category,
    );
  }
  // Including a value this codebase has never produced: an unrecognized
  // category can only ever fall through to the safe answer.
  assert.deepEqual(classifyAllergenOnly(facts({ hazardCategory: 'something_new' })), {
    kind: 'not_allergen_only',
  });
});

test('a MIXED recall is never allergen-only, however it was categorized', () => {
  // FSIS returns 'allergen' as soon as it sees "Unreported Allergens", so a
  // reasons array carrying a second hazard would arrive here mislabelled.
  assert.deepEqual(
    classifyAllergenOnly(facts({ reasonText: 'Product Contamination, Unreported Allergens' })),
    { kind: 'not_allergen_only' },
  );
  assert.deepEqual(
    classifyAllergenOnly(facts({ reasonText: 'Unreported Allergens, Insanitary Conditions' })),
    { kind: 'not_allergen_only' },
  );
  // A stated pathogen anywhere in the canonical fields does the same.
  assert.deepEqual(
    classifyAllergenOnly(facts({ reasonText: 'Undeclared milk and possible Salmonella' })),
    { kind: 'not_allergen_only' },
  );
  assert.deepEqual(classifyAllergenOnly(facts({ pathogenOrAllergen: 'Listeria monocytogenes' })), {
    kind: 'not_allergen_only',
  });
});

test('"Misbranding" and "Mislabeling" are how an allergen is reported, not a second hazard', () => {
  assert.deepEqual(
    classifyAllergenOnly(facts({ reasonText: 'Misbranding, Unreported Allergens' })),
    { kind: 'identified', tokens: ['milk'] },
  );
});

test('an unnamed allergen is UNIDENTIFIED — never a mismatch', () => {
  // "undeclared allergen" with no name could be the user's own.
  for (const agent of [null, 'undeclared allergen', 'undeclared allergens', 'undeclared yellow']) {
    assert.deepEqual(
      classifyAllergenOnly(facts({ pathogenOrAllergen: agent })),
      { kind: 'unidentified' },
      String(agent),
    );
  }
});

test('a known mismatch needs identification AND no selected allergen', () => {
  const milk = facts();
  assert.equal(isKnownAllergenMismatch(milk, ['peanut']), true);
  assert.equal(isKnownAllergenMismatch(milk, ['milk']), false);
  assert.equal(isKnownAllergenMismatch(milk, ['peanut', 'milk']), false);
  // No selection at all: nothing can match, so an allergen-only recall is not
  // this person's information.
  assert.equal(isKnownAllergenMismatch(milk, []), true);
  // Unidentified never produces a mismatch, whatever is selected.
  assert.equal(
    isKnownAllergenMismatch(facts({ pathogenOrAllergen: 'undeclared allergen' }), ['peanut']),
    false,
  );
  // A general hazard never produces one either.
  assert.equal(
    isKnownAllergenMismatch(facts({ hazardCategory: 'microbial_contamination' }), ['peanut']),
    false,
  );
});

test('a non-selectable substance is withheld by the same rule, with no special case', () => {
  // Sulfites and gluten are real, identified allergen hazards that the
  // supported preference vocabulary cannot express. They can match nothing,
  // so they are withheld from Affects Me and stay in All Recalls.
  for (const agent of ['undeclared sulfites', 'undeclared gluten']) {
    const verdict = classifyAllergenOnly(facts({ pathogenOrAllergen: agent }));
    assert.equal(verdict.kind, 'identified', agent);
    assert.equal(isKnownAllergenMismatch(facts({ pathogenOrAllergen: agent }), ['milk']), true);
    // Even a user who selected everything selectable cannot match them.
    assert.equal(
      isKnownAllergenMismatch(facts({ pathogenOrAllergen: agent }), [
        'peanut',
        'tree nuts',
        'milk',
        'egg',
        'wheat',
        'soy',
        'sesame',
        'fish',
        'shellfish',
      ]),
      true,
      agent,
    );
  }
});

test('one selectable allergen alongside a non-selectable one still matches', () => {
  const both = facts({ pathogenOrAllergen: 'undeclared sulfites and milk' });
  assert.deepEqual(classifyAllergenOnly(both), {
    kind: 'identified',
    tokens: ['milk', 'sulfites'],
  });
  assert.equal(isKnownAllergenMismatch(both, ['milk']), false);
  assert.equal(isKnownAllergenMismatch(both, ['peanut']), true);
});
