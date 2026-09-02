/**
 * The bounded typed-reason interpretation (P2a): every supported family, the
 * free-text grammar gate, and the singular/plural product agreement. Detail's
 * What Happened clause and Home's concise line both render from this one
 * interpretation — the family tests here are what keeps the two surfaces
 * structurally unable to disagree.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { interpretReason, pluralProductPhrase, type ReasonEvidence } from './recall-reason';

function evidence(overrides: Partial<ReasonEvidence>): ReasonEvidence {
  return {
    reasonText: null,
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
    ...overrides,
  };
}

test('pathogen family: stated organism, FSIS enum, and organism-less contamination', () => {
  assert.deepEqual(
    interpretReason(
      evidence({
        hazardCategory: 'microbial_contamination',
        pathogenOrAllergen: 'Listeria monocytogenes',
      }),
    ),
    { family: 'pathogen', pathogen: 'Listeria monocytogenes' },
  );
  // The FSIS enum string with no organism stays the honest generic form.
  assert.deepEqual(interpretReason(evidence({ reasonText: 'Product Contamination' })), {
    family: 'pathogen',
    pathogen: null,
  });
});

test('an organism-less microbial hazard prefers the source’s own safe wording', () => {
  // Recorded shapes: "Potential mold growth contamination" (Authentik),
  // "Potential Cronobacter sakazakii contamination" (Nutramigen). The
  // specific noun phrase beats a generic "may be contaminated".
  assert.deepEqual(
    interpretReason(
      evidence({
        hazardCategory: 'microbial_contamination',
        reasonText: 'Potential mold growth contamination',
      }),
    ),
    { family: 'verbatim', noun: 'Potential mold growth contamination' },
  );
  // …but a reason the grammar gate rejects falls back to the generic family
  // rather than rendering broken grammar (recorded Saputo shape).
  assert.deepEqual(
    interpretReason(
      evidence({
        hazardCategory: 'microbial_contamination',
        reasonText: 'Not fully pasteurized',
      }),
    ),
    { family: 'pathogen', pathogen: null },
  );
});

test('allergen family from the FSIS enum and the structured hazard slot', () => {
  assert.deepEqual(
    interpretReason(
      evidence({
        reasonText: 'Misbranding and Unreported Allergens',
        pathogenOrAllergen: 'undeclared milk',
      }),
    ),
    { family: 'allergen', raw: 'milk' },
  );
  assert.deepEqual(
    interpretReason(
      evidence({ hazardCategory: 'allergen', pathogenOrAllergen: 'undeclared milk' }),
    ),
    { family: 'allergen', raw: 'milk' },
  );
  // No allergen is ever invented: an unnamed one stays null.
  assert.deepEqual(interpretReason(evidence({ hazardCategory: 'allergen' })), {
    family: 'allergen',
    raw: null,
  });
});

test('foreign material, chemical, and the FSIS process families', () => {
  assert.deepEqual(
    interpretReason(
      evidence({ hazardCategory: 'foreign_material', summaryText: 'may contain metal pieces' }),
    ),
    { family: 'foreign_material', material: 'metal' },
  );
  assert.deepEqual(
    interpretReason(
      evidence({ hazardCategory: 'chemical_contamination', pathogenOrAllergen: 'lead' }),
    ),
    { family: 'chemical', agent: 'lead' },
  );
  assert.equal(
    interpretReason(evidence({ reasonText: 'Produced Without Benefit of Inspection' })).family,
    'inspection',
  );
  assert.equal(
    interpretReason(evidence({ reasonText: 'Unfit for Human Consumption' })).family,
    'unfit',
  );
  assert.equal(
    interpretReason(evidence({ reasonText: 'Insanitary Conditions' })).family,
    'insanitary',
  );
  assert.equal(interpretReason(evidence({ reasonText: 'Processing Defect' })).family, 'processing');
  assert.deepEqual(interpretReason(evidence({ reasonText: 'Mislabeling' })), {
    family: 'mislabeled',
    word: 'mislabeled',
  });
});

test('import family carries the source-stated origin and legality', () => {
  assert.deepEqual(
    interpretReason(
      evidence({
        reasonText: 'Import Violation',
        title: 'Products Imported From Ecuador',
        summaryText: 'The products were illegally imported and Ecuador is ineligible to export.',
      }),
    ),
    { family: 'import', country: 'Ecuador', illegal: true, ineligible: true },
  );
});

test('nutrition family from the source’s infant-formula wording', () => {
  assert.equal(
    interpretReason(
      evidence({
        reasonText: 'Product does not provide sufficient nutrition when used as an infant formula',
      }),
    ).family,
    'nutrition',
  );
});

test('unapproved-ingredient family: the recorded Kofinas reason, verbatim slots', () => {
  assert.deepEqual(
    interpretReason(
      evidence({
        hazardCategory: 'other_regulatory',
        reasonText: 'Contains garlic essential oil not approved for culinary use',
      }),
    ),
    { family: 'unapproved', ingredient: 'garlic essential oil', use: 'culinary use' },
  );
});

test('declared contents and the gated verbatim fallback', () => {
  assert.deepEqual(
    interpretReason(evidence({ reasonText: 'Product contains toxic yellow oleander.' })),
    { family: 'contents', contents: 'toxic yellow oleander' },
  );
  assert.deepEqual(interpretReason(evidence({ reasonText: 'Due to Elevated Levels of Lead' })), {
    family: 'verbatim',
    noun: 'Elevated Levels of Lead',
  });
});

test('the grammar gate rejects every clause shape that produced broken output', () => {
  // Each of these, glued onto "because of", produced the malformed corpus
  // families the audit documented. None may reach the verbatim family.
  for (const clause of [
    'Product did not meet standards',
    'Cans may contain undeclared milk',
    'Glass prone to breakage, causing product to spill',
    'Product is adulterated',
    'Not fully pasteurized',
  ]) {
    const typed = interpretReason(evidence({ reasonText: clause }));
    assert.notEqual(typed.family, 'verbatim', `gate missed: ${clause}`);
  }
  // A bare "Contains X" is a declared-contents statement, not raw glue.
  assert.equal(
    interpretReason(evidence({ reasonText: 'Contains undeclared peanuts' })).family,
    'contents',
  );
});

test('singular/plural product agreement is conservative', () => {
  assert.equal(pluralProductPhrase('Chocolatey Eyeballs'), true);
  assert.equal(pluralProductPhrase('Ready-to-Eat Chicken Products'), true);
  assert.equal(pluralProductPhrase('Garlic Mediterranean Infused Extra Virgin Olive Oil'), false);
  // Mass nouns with -ss/-us/-is endings never read plural.
  assert.equal(pluralProductPhrase('Classic Hummus'), false);
  assert.equal(pluralProductPhrase('Swiss Cheese Bliss'), false);
});
