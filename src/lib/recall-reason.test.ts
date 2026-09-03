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

// ── P2e-B: packaging prose is never the hazard ──────────────────────────────

/**
 * 115-2017 (Taylor Farms Florida) as the corrected canonical parser now
 * normalizes it: FSIS filed it under "Product Contamination", but the notice
 * is an undeclared-anchovy recall whose only material word is the packaging
 * ("9.75-oz. plastic bowls"). Before P2e-B the stored category was
 * `foreign_material` and both surfaces rendered "Potential plastic
 * contamination." — a hazard the source never states.
 */
const ANCHOVY_NOTICE: ReasonEvidence = {
  reasonText: 'Product Contamination',
  hazardCategory: 'allergen',
  pathogenOrAllergen: 'undeclared fish',
  title:
    'Taylor Farms Florida Recalls Salad with Chicken Products Due to Misbranding and Undeclared Allergens',
  summaryText:
    'The products contain fish (anchovies), a known allergen, which is not declared on the ' +
    'product label. The following products are subject to recall: 9.75-oz. plastic bowls ' +
    'containing Taylor Farms American Style Pasta Salad.',
};

test('a contamination-filed allergen recall renders its allergen, not its packaging', () => {
  assert.deepEqual(interpretReason(ANCHOVY_NOTICE), { family: 'allergen', raw: 'fish' });
});

test('the pre-P2e-B category would have named the packaging material; the evidence rule does not', () => {
  // The stored (wrong) category, with the identical source text: even asked
  // for a foreign-material family, no material may be named from packaging.
  assert.deepEqual(interpretReason({ ...ANCHOVY_NOTICE, hazardCategory: 'foreign_material' }), {
    family: 'foreign_material',
    material: null,
  });
});

test('a genuine contaminant is named over packaging that mentions another material', () => {
  // PHA-10092020-01: glass contamination sold in plastic bowls.
  assert.deepEqual(
    interpretReason(
      evidence({
        reasonText: 'Product Contamination, Unfit for Human Consumption',
        hazardCategory: 'foreign_material',
        title: 'FSIS Issues Public Health Alert Due to Possible Foreign Matter Contamination',
        summaryText:
          'The products may be contaminated with extraneous material, specifically glass. ' +
          '10-oz. plastic bowl package containing “MEAL SIMPLE SPAGHETTI”.',
      }),
    ),
    { family: 'foreign_material', material: 'glass' },
  );
});

test('the FDA reason taxonomy label never names a contaminant', () => {
  // "Potential Metal or Chemical Contaminant" is a category name, not a
  // statement about this product — whose own title says plastic.
  assert.deepEqual(
    interpretReason(
      evidence({
        reasonText: 'Potential Metal or Chemical Contaminant',
        hazardCategory: 'foreign_material',
        title:
          'Palermo Villa, Inc. Issues Recall for Frozen Pizzas Due to Possible Plastic Contaminant',
        summaryText: 'issuing a recall because of a possible plastic foreign contaminant.',
      }),
    ),
    { family: 'foreign_material', material: 'plastic' },
  );
  // With no notice text of its own (Home), the line degrades to the generic
  // form rather than asserting the label's first material.
  assert.deepEqual(
    interpretReason(
      evidence({
        reasonText: 'Potential Metal or Chemical Contaminant',
        hazardCategory: 'foreign_material',
      }),
    ),
    { family: 'foreign_material', material: null },
  );
});

// ── P3A: Home/Detail semantic parity, proven corpus-wide ────────────────────

/**
 * The two surfaces' evidence, built from ONE canonical projection. Home gets
 * exactly what a feed row carries; Detail additionally gets the announcement
 * body. Nothing else differs, so any divergence below is a real parity defect.
 */
function surfaces(projection: {
  reasonText: string | null;
  hazardCategory: string;
  pathogenOrAllergen: string | null;
  title: string;
  summaryText: string;
}) {
  const home: ReasonEvidence = {
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    title: projection.title,
  };
  return {
    home: interpretReason(home),
    detail: interpretReason({ ...home, summaryText: projection.summaryText }),
  };
}

/** The agent/material/allergen each family names, or null when it names none. */
function namedAgent(reason: ReturnType<typeof interpretReason>): string | null {
  switch (reason.family) {
    case 'pathogen':
      return reason.pathogen;
    case 'foreign_material':
      return reason.material;
    case 'chemical':
      return reason.agent;
    case 'allergen':
      return reason.raw;
    default:
      return null;
  }
}

test('P3A: more evidence refines an interpretation — it never contradicts one', () => {
  // The structural guarantee. Detail's haystack is Home's plus an APPENDED
  // summary, so Home can name nothing Detail would not, and the family and
  // allergen list — decided by structured fields alone — are always identical.
  const cases = [
    // Named in the title: BOTH surfaces say plastic (recorded Palermo Villa).
    {
      reasonText: 'Potential Metal or Chemical Contaminant',
      hazardCategory: 'foreign_material',
      pathogenOrAllergen: null,
      title: 'Palermo Villa, Inc. Issues Recall Due to Possible Plastic Contaminant',
      summaryText: 'a possible plastic foreign contaminant was found in the product.',
      expect: { home: 'plastic', detail: 'plastic' },
    },
    // Stated only in the body (recorded FSIS 005-2026 / PHA-10092020-01
    // shape): Home stays honestly generic, Detail names glass. Both are true,
    // and neither names a material the other rules out.
    {
      reasonText: 'Product Contamination',
      hazardCategory: 'foreign_material',
      pathogenOrAllergen: null,
      title: 'Recalls Chicken Fried Rice Products Due to Possible Foreign Matter Contamination',
      summaryText: 'The products may contain pieces of glass.',
      expect: { home: null, detail: 'glass' },
    },
    // Genuinely generic on both: nothing invents a material.
    {
      reasonText: 'Product Contamination',
      hazardCategory: 'foreign_material',
      pathogenOrAllergen: null,
      title: 'Recalls Sausage Products Due to Possible Foreign Matter Contamination',
      summaryText: 'due to possible foreign matter contamination.',
      expect: { home: null, detail: null },
    },
    // Packaging-only material words (the 115-2017 / PHA-10092020-01 false
    // positive class): NEITHER surface may name a contaminant.
    {
      reasonText: 'Product Contamination',
      hazardCategory: 'foreign_material',
      pathogenOrAllergen: null,
      title: 'Recalls Ready-To-Eat Products',
      summaryText: 'The products were packaged in 10-oz. plastic bowl packages.',
      expect: { home: null, detail: null },
    },
  ];
  for (const scenario of cases) {
    const { home, detail } = surfaces(scenario);
    assert.equal(home.family, detail.family, scenario.title);
    assert.equal(namedAgent(home), scenario.expect.home, `home: ${scenario.title}`);
    assert.equal(namedAgent(detail), scenario.expect.detail, `detail: ${scenario.title}`);
    // The invariant: null, or identical — never a third thing.
    const named = namedAgent(home);
    assert.ok(named === null || named === namedAgent(detail), `contradiction: ${scenario.title}`);
  }
});

test('P3A: 115-2017 reads as undeclared fish on both surfaces, never as plastic', () => {
  // The corrected anchovy recall: filed under the contamination enum, but its
  // canonical hazard is allergen — and its only material word is packaging.
  const { home, detail } = surfaces({
    reasonText: 'Product Contamination',
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'undeclared fish',
    title: 'Recalls Chicken Products Due to Misbranding and an Undeclared Allergen',
    summaryText: 'The products were packaged in 9.75-oz. plastic bowls and contain anchovy.',
  });
  assert.deepEqual(home, { family: 'allergen', raw: 'fish' });
  assert.deepEqual(detail, { family: 'allergen', raw: 'fish' });
});

test('P3A: pathogen, allergen, inspection, import, processing and misbranding are unchanged', () => {
  // Families decided by structured fields alone are identical on both
  // surfaces for every notice — the announcement body cannot move them.
  const structured = [
    { hazardCategory: 'microbial_contamination', pathogenOrAllergen: 'Listeria monocytogenes' },
    { hazardCategory: 'allergen', pathogenOrAllergen: 'undeclared milk and soy' },
    { reasonText: 'Produced without benefit of inspection', hazardCategory: 'unknown' },
    { reasonText: 'Import violation', hazardCategory: 'unknown' },
    { reasonText: 'Processing defect', hazardCategory: 'unknown' },
    { reasonText: 'Misbranding', hazardCategory: 'unknown' },
    { reasonText: 'Mislabeling', hazardCategory: 'unknown' },
    { reasonText: 'Insanitary conditions', hazardCategory: 'unknown' },
    { hazardCategory: 'chemical_contamination', pathogenOrAllergen: 'lead' },
  ];
  for (const fields of structured) {
    const { home, detail } = surfaces({
      reasonText: null,
      pathogenOrAllergen: null,
      title: 'A recall notice',
      summaryText: 'The firm announced a recall. Products shipped in plastic and glass containers.',
      ...fields,
    });
    assert.equal(home.family, detail.family, JSON.stringify(fields));
    assert.deepEqual(home, detail, JSON.stringify(fields));
  }
});
