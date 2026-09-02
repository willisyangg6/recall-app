import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  allergenDisplayPhrase,
  extractAllergenEvidence,
  extractPathogenOrAllergen,
  normalizedAllergenTokens,
} from './hazard';

test('allergen values normalize to canonical personalization tokens (founder Part 10)', () => {
  assert.deepEqual(normalizedAllergenTokens('undeclared eggs'), ['egg']);
  assert.deepEqual(normalizedAllergenTokens('undeclared soybean'), ['soy']);
  assert.deepEqual(normalizedAllergenTokens('undeclared milk and sesame'), ['milk', 'sesame']);
  assert.deepEqual(normalizedAllergenTokens('undeclared tree nuts'), ['tree nuts']);
  // Specific nuts collapse into the tree-nut family token.
  assert.deepEqual(normalizedAllergenTokens('undeclared cashews and pistachios'), ['tree nuts']);
  assert.deepEqual(normalizedAllergenTokens('undeclared gluten'), ['gluten']);
  // Shrimp is a crustacean shellfish in FDA's own taxonomy — same family token.
  assert.deepEqual(normalizedAllergenTokens('undeclared shrimp'), ['shellfish']);
  assert.deepEqual(normalizedAllergenTokens('undeclared crustacean shellfish and milk'), [
    'milk',
    'shellfish',
  ]);
  // Pathogens and null produce no allergen tokens.
  assert.deepEqual(normalizedAllergenTokens('Salmonella'), []);
  assert.deepEqual(normalizedAllergenTokens(null), []);
  // Unknown words are dropped, never guessed into a family.
  assert.deepEqual(normalizedAllergenTokens('undeclared quinoa'), []);
});

test('allergen display phrases use label vocabulary', () => {
  assert.equal(allergenDisplayPhrase('soybean'), 'soy');
  assert.equal(allergenDisplayPhrase('eggs'), 'egg');
  assert.equal(allergenDisplayPhrase('milk and sesame'), 'milk and sesame');
  assert.equal(allergenDisplayPhrase('cashews, pistachios and/or hazelnut'), 'tree nuts');
});

// ── Evidence-gated allergen extraction (P2d-A) ───────────────────────────────
// Positive wordings below are verbatim from recorded official FSIS/FDA
// notices in the fixture corpora; each comment names the record.

test('the FSIS "known allergen" apposition states the recall reason (recorded wordings)', () => {
  // PHA-07292026-01 (Steak Burrito).
  assert.equal(
    extractPathogenOrAllergen(
      'The product contains egg, a known allergen, which is not declared on the product label.',
    ),
    'undeclared egg',
  );
  // 009-2026: two allergens in one apposition.
  assert.equal(
    extractPathogenOrAllergen(
      'The product labeled as pasta salad may actually contain chicken salad, which contains egg and milk, known allergens, that are not declared on the product label.',
    ),
    'undeclared egg and milk',
  );
  // PHA-06252026-02: the source plural is preserved (normalization is downstream).
  assert.equal(
    extractPathogenOrAllergen(
      'The product contains eggs, a known allergen, which is not declared on the product label.',
    ),
    'undeclared eggs',
  );
  // 006-2025: parenthetical species note does not block the named family.
  assert.equal(
    extractPathogenOrAllergen(
      'The product’s individually-wrapped Caesar dressing packet contains fish (anchovies), a known allergen, which is not declared on the product label.',
    ),
    'undeclared fish',
  );
  // PHA-04092026-01: "may contain" wording.
  assert.equal(
    extractPathogenOrAllergen(
      'The products may contain sesame, a known allergen, which is not declared on the product label.',
    ),
    'undeclared sesame',
  );
  // PHA-02122025-01: the allergen arrives via a named component.
  assert.equal(
    extractPathogenOrAllergen(
      'The products were produced using an egg wash, which contains egg, a known allergen, that is not declared on the product label.',
    ),
    'undeclared egg',
  );
  // 074-2017-EXP: an unsupported substance (MSG) is never guessed into the
  // vocabulary; the supported allergen is still extracted.
  assert.equal(
    extractPathogenOrAllergen(
      'In addition, the products may contain soy, a known allergen, and Monosodium Glutamate (MSG) which are not declared on the finished product label.',
    ),
    'undeclared soy',
  );
});

test('"undeclared <allergen list>" wordings (recorded)', () => {
  // PHA-02012023-01: generic statement narrowed by "specifically".
  assert.equal(
    extractPathogenOrAllergen(
      'chocolate wafers that have been recalled due to an undeclared allergen, specifically peanut residue.',
    ),
    'undeclared peanut',
  );
  // Troemner (FDA): full multi-allergen list.
  assert.equal(
    extractPathogenOrAllergen('because it may contain undeclared milk, wheat, and soy.'),
    'undeclared milk, wheat, and soy',
  );
  // Lee K of NY (FDA): list inside a title parenthetical.
  assert.equal(
    extractPathogenOrAllergen(
      'Allergy Alert on Undeclared Allergen (Milk and Shrimp) in “Stewed Aged Kimchi w/Mackerel”',
    ),
    'undeclared milk and shrimp',
  );
  assert.equal(extractPathogenOrAllergen('may contain undeclared milk'), 'undeclared milk');
  // The list ends at the first non-vocabulary word: a product name mentioning
  // a declared allergen is never collected.
  assert.equal(
    extractPathogenOrAllergen(
      'Issues Allergy Alert on Undeclared Sesame in Steam Buns with Egg Custard Added',
    ),
    'undeclared sesame',
  );
  assert.equal(
    extractPathogenOrAllergen(
      'Allergy Alert on Undeclared Wheat Contamination in “Gluten Free Coconut Flour Tortillas”',
    ),
    'undeclared wheat',
  );
});

test('"does not declare" labeling-failure statement (recorded FDA wording)', () => {
  assert.equal(
    extractPathogenOrAllergen(
      'the finished product label does not declare soy, an allergen presents in the Rice & Pigeon Peas',
    ),
    'undeclared soy',
  );
  assert.equal(
    extractPathogenOrAllergen('because the label does not declare wheat.'),
    'undeclared wheat',
  );
});

test('non-evidence never extracts: negations, ingredient lists, boilerplate, control-program prose', () => {
  // Negated statements.
  assert.equal(extractPathogenOrAllergen('This product contains no milk.'), null);
  assert.equal(
    extractPathogenOrAllergen('The reformulated product contains no milk, a known allergen.'),
    null,
  );
  // An ingredient list names allergens without stating them as the reason.
  assert.equal(
    extractPathogenOrAllergen(
      'Ingredients: enriched flour (wheat), sugar, eggs, milk, soy lecithin.',
    ),
    null,
  );
  // Generic allergen language with no named allergen.
  assert.equal(
    extractPathogenOrAllergen('recalled due to misbranding and an undeclared allergen.'),
    null,
  );
  // Allergen-control-program / facility prose.
  assert.equal(
    extractPathogenOrAllergen(
      'The product was made in a facility that also processes peanuts, a known allergen.',
    ),
    null,
  );
  // Recorded FSIS boilerplate (018-2026): inspection-warning prose.
  assert.equal(
    extractPathogenOrAllergen(
      'Food produced without inspection may contain undeclared allergens, harmful bacteria, or other contaminants that could make consumers sick.',
    ),
    null,
  );
  // Another product's allergen in adjacent prose, with no reason construction.
  assert.equal(
    extractAllergenEvidence('The same lot also includes Cheddar Bites, which contain milk.').length,
    0,
  );
});

test('a named pathogen keeps precedence over allergen wording (existing semantics)', () => {
  assert.equal(
    extractPathogenOrAllergen(
      'recalled for Listeria monocytogenes contamination; the label also omits undeclared milk',
    ),
    'Listeria monocytogenes',
  );
  assert.equal(extractPathogenOrAllergen('possible Salmonella contamination'), 'Salmonella');
});
