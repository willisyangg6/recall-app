import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  allergenDisplayPhrase,
  extractAllergenEvidence,
  extractChemicalAgent,
  extractForeignMaterialEvidence,
  extractPathogenOrAllergen,
  normalizedAllergenTokens,
  statesUndeclaredAllergen,
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

// ── Allergen-governed "including" lists (P2d-A follow-up, from production
// record 111-2015's archived official wording) ──────────────────────────────

test('an allergen-governed "including" list is collected whole (archived 111-2015 wording)', () => {
  // Verified against the archived production snapshot for FSIS 111-2015.
  const wording =
    'These products were also missing the ingredient statement and contained undeclared ' +
    "allergens, including eggs, milk, and wheat, the U.S. Department of Agriculture's Food " +
    'Safety and Inspection Service (FSIS) announced today.';
  assert.deepEqual(extractAllergenEvidence(wording), ['eggs', 'milk', 'wheat']);
  assert.equal(extractPathogenOrAllergen(wording), 'undeclared eggs, milk, and wheat');
});

test('"including" without the allergen governor never interprets a list', () => {
  // A general ingredient enumeration.
  assert.equal(
    extractAllergenEvidence('made with quality ingredients, including milk, cream, and sugar')
      .length,
    0,
  );
  // Facility / allergen-control prose (no reason construction at all).
  assert.equal(
    extractAllergenEvidence('produced in a facility that handles many allergens, including peanuts')
      .length,
    0,
  );
  // A list merely discussing allergens as examples.
  assert.equal(
    extractAllergenEvidence(
      'a variety of allergens, including milk and peanuts, can cause reactions',
    ).length,
    0,
  );
  // Negated construction: the existing negation gate still refuses it.
  assert.equal(
    extractAllergenEvidence('the product contains no undeclared allergens, including milk').length,
    0,
  );
  // "including" with no explicit allergen governor ends the run.
  assert.equal(extractAllergenEvidence('undeclared including milk').length, 0);
  assert.equal(
    extractAllergenEvidence('undeclared ingredients, including preservatives and milk').length,
    0,
  );
  // An unsupported token inside a governed list still ends it (existing contract).
  assert.deepEqual(
    extractAllergenEvidence('contained undeclared allergens, including milk, carmine, and wheat'),
    ['milk'],
  );
});

// ── Grammatical-alias deduplication (P2d-A follow-up, from the first P2d-B
// production dry run's "undeclared peanut and peanuts" values) ───────────────

test('singular/plural aliases of one allergen collapse to the first-seen form', () => {
  // Two constructions naming the same allergen in different number.
  assert.equal(
    extractPathogenOrAllergen(
      'recalled due to undeclared peanut. The products may contain peanuts, known allergens, ' +
        'which are not declared on the product label.',
    ),
    'undeclared peanut',
  );
  assert.equal(
    extractPathogenOrAllergen(
      'due to undeclared egg. The product contains eggs, a known allergen, which is not declared.',
    ),
    'undeclared egg',
  );
  // The two-token vocabulary pair dedups the same way.
  assert.equal(
    extractPathogenOrAllergen(
      'due to undeclared tree nuts. The product contains tree nut, a known allergen.',
    ),
    'undeclared tree nuts',
  );
});

test('genuinely distinct allergens and supported subtypes are all preserved', () => {
  // Distinct families stay distinct.
  assert.equal(
    extractPathogenOrAllergen(
      'due to undeclared milk. The product contains eggs, a known allergen.',
    ),
    'undeclared milk and eggs',
  );
  // Distinct tree-nut types are NOT collapsed just because personalization
  // later groups them under one family token.
  assert.equal(
    extractPathogenOrAllergen('due to undeclared almonds and walnuts'),
    'undeclared almonds and walnuts',
  );
  // A subtype and its family word are distinct source statements.
  assert.equal(
    extractPathogenOrAllergen(
      'due to undeclared shellfish. The product contains shrimp, a known allergen.',
    ),
    'undeclared shellfish and shrimp',
  );
  // Pathogen normalization is untouched by alias deduplication.
  assert.equal(
    extractPathogenOrAllergen('Listeria monocytogenes and Listeria were both referenced'),
    'Listeria monocytogenes',
  );
});

// ── Foreign-material evidence (P2e-B) ────────────────────────────────────────

test('packaging prose is never foreign-material evidence', () => {
  for (const text of [
    '9.75-oz. plastic bowls containing Taylor Farms American Style Pasta Salad',
    '4.2-lb. plastic bags containing “Ling Ling POTSTICKERS”',
    '1.5-lb. clear plastic containers with safety lids',
    '20-oz. plastic wrapped tray packages containing sausage links',
    '12-inch, 25-oz. plastic-wrapped “KETTLE RIVER Chicken Alfredo Pizza”',
    '1-lb. plastic vacuum-packed packages containing beef',
    '10-lb. white cardboard box cases containing a plastic bag of sausage',
    'Product is packed in plastic overwrap and shipped in plastic tubs.',
    '16-oz. glass jars and 2-liter plastic bottles of the beverage',
    'The pouches are sealed with a metal clip and packed in wood crates.',
  ]) {
    assert.deepEqual(extractForeignMaterialEvidence(text), { stated: false, material: null }, text);
  }
});

test('stated contamination is foreign-material evidence, with the material named', () => {
  const cases: [string, string | null][] = [
    // The agency's generic wording, with no material named.
    ['Recalled Due to Possible Foreign Matter Contamination', null],
    ['The products may contain foreign material.', null],
    ['because of a possible foreign contaminant', null],
    // Material named as the contaminant.
    ['products that may be contaminated with foreign material, specifically glass', 'glass'],
    [
      'contaminated with extraneous materials, specifically clear flexible and hard plastic',
      'plastic',
    ],
    ['a Taylor Farms employee discovered pieces of glass in product', 'glass'],
    ['the likely source of the glass contamination', 'glass'],
    ['four consumer complaints regarding glass found in product', 'glass'],
    ['the salad dressing may contain hard plastic', 'plastic'],
    ['because of a possible plastic foreign contaminant', 'plastic'],
    ['The product may contain plastic pieces.', 'plastic'],
    ['may contain plastic fragments', 'plastic'],
    ['consumer reported glass shards in the jar', 'glass'],
    ['may be contaminated with metal fragments', 'metal'],
    ['small metal shavings were discovered', 'metal'],
    ['may contain bone fragments', 'bone'],
    ['pieces of rubber were found in the product', 'rubber'],
    ['wood splinters in the product', 'wood'],
  ];
  for (const [text, material] of cases) {
    assert.deepEqual(extractForeignMaterialEvidence(text), { stated: true, material }, text);
  }
});

test('the real contaminant wins over packaging that names another material', () => {
  // PHA-10092020-01: glass contamination, sold in plastic bowls.
  const notice =
    'FSIS Issues Public Health Alert Due to Possible Foreign Matter Contamination. ' +
    'The products may be contaminated with extraneous material, specifically glass. ' +
    '10-oz. plastic bowl package containing “MEAL SIMPLE SPAGHETTI”.';
  assert.deepEqual(extractForeignMaterialEvidence(notice), { stated: true, material: 'glass' });
});

test('undeclared-allergen evidence is delegated to the one extractor', () => {
  assert.equal(
    statesUndeclaredAllergen('The product contains soy, a known allergen, which is not declared.'),
    true,
  );
  assert.equal(statesUndeclaredAllergen('undeclared milk and wheat'), true);
  // The same negatives the extractor already refuses.
  assert.equal(statesUndeclaredAllergen('Consumers allergic to milk should read labels.'), false);
  assert.equal(statesUndeclaredAllergen('made in a facility that also processes peanuts'), false);
  assert.equal(statesUndeclaredAllergen('contains no milk, a known allergen'), false);
  assert.equal(statesUndeclaredAllergen('an undeclared allergen'), false);
});

// ── Chemical-agent evidence extraction (P3B) ─────────────────────────────────

test('the historical chemical-agent list still matches anywhere the word appears, unchanged', () => {
  // CHEMICAL_AGENTS is deliberately permissive/bare — predates the evidence
  // gate below, and this milestone leaves that behavior exactly as it was.
  assert.equal(extractChemicalAgent('Testing found elevated levels of lead.'), 'lead');
  assert.equal(extractChemicalAgent('a footnote mentions mercury in passing'), 'mercury');
  assert.equal(
    extractChemicalAgent('may have become contaminated with cesium-137 (Cs-137)'),
    'Cesium-137',
  );
});

test('asbestos is recovered only from a bounded contamination construction', () => {
  // The verified official Dynarex Dynacare Baby Powder wording (P3B).
  assert.equal(
    extractChemicalAgent(
      'because they have the potential to be contaminated with asbestos. Asbestos is a ' +
        'naturally occurring mineral that is often found near talc, an ingredient in many baby powders.',
    ),
    'asbestos',
  );
  assert.equal(
    extractChemicalAgent('The firm initiated the recall due to potential asbestos contamination.'),
    'asbestos',
  );
  assert.equal(
    extractChemicalAgent('Testing revealed the lot was contaminated with asbestos.'),
    'asbestos',
  );
});

test('asbestos is never invented from a mention that does not state contamination', () => {
  assert.equal(
    extractChemicalAgent(
      'The product is labeled asbestos-free and has passed independent testing.',
    ),
    null,
  );
  assert.equal(
    extractChemicalAgent('Laboratory testing confirmed the product contains no asbestos.'),
    null,
  );
  assert.equal(extractChemicalAgent('Testing found no asbestos in the recalled lots.'), null);
  // Hypothetical/educational discussion never connected to the recalled product.
  assert.equal(
    extractChemicalAgent(
      'Asbestos is a naturally occurring mineral once widely used in insulation and building materials.',
    ),
    null,
  );
  // Facility prose that mentions asbestos without connecting it to the product.
  assert.equal(
    extractChemicalAgent(
      'The manufacturing facility completed an unrelated asbestos remediation project last year.',
    ),
    null,
  );
  // A bare occurrence outside any contamination construction.
  assert.equal(
    extractChemicalAgent('See the appendix for general information about asbestos.'),
    null,
  );
});
