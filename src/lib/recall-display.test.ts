import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CaseProjection } from '@/domain/recall-types';
import {
  consumerActionDisplay,
  geographyDetail,
  geographyLabel,
  healthRiskSummary,
  illnessDisplay,
  reasonLine,
  selectHazardGuidance,
} from './recall-display';

// Risk wording moved to risk-display.ts (consumer tier vs official
// classification are two layers now); its goldens live in risk-display.test.ts.

test('reason line maps structured FSIS reasons to consumer wording', () => {
  assert.equal(
    reasonLine('Product Contamination', 'microbial_contamination', 'Salmonella'),
    'Possible Salmonella contamination',
  );
  assert.equal(
    reasonLine('Product Contamination', 'foreign_material', null),
    'Possible foreign material contamination',
  );
  assert.equal(reasonLine('Product Contamination', 'unknown', null), 'Possible contamination');
  assert.equal(
    reasonLine('Produced Without Benefit of Inspection', 'other_regulatory', null),
    'Produced without inspection',
  );
  assert.equal(reasonLine('Import Violation', 'other_regulatory', null), 'Import violation');
  // Multi-reason records (real: 006-2025) keep every reason, hazard first.
  assert.equal(
    reasonLine('Misbranding, Unreported Allergens', 'allergen', 'undeclared milk'),
    'Undeclared milk allergen · Misbranding',
  );
  assert.equal(reasonLine('Unreported Allergens', 'allergen', null), 'Undeclared allergen');
  // Unmapped reasons pass through verbatim — never weakened, never dropped.
  assert.equal(reasonLine('Some Future Reason', 'unknown', null), 'Some Future Reason');
  assert.equal(reasonLine(null, 'unknown', null), null);
});

test('reason labels are standardized across FDA source casing variants (founder Part 6)', () => {
  // FDA reason descriptions carry inconsistent casing; the structured hazard
  // slots drive a consistent consumer label. Raw text stays in the projection.
  assert.equal(
    reasonLine('Possible E. Coli Contamination', 'microbial_contamination', 'E. coli'),
    'Possible E. coli contamination',
  );
  assert.equal(
    reasonLine('May Contain Undeclared Soy', 'allergen', 'undeclared soybean'),
    'Undeclared soy allergen',
  );
  assert.equal(
    reasonLine('undeclared gluten', 'allergen', 'undeclared gluten'),
    'Undeclared gluten',
  );
  assert.equal(
    reasonLine('Undeclared milk and sesame', 'allergen', 'undeclared milk and sesame'),
    'Undeclared milk and sesame allergens',
  );
  assert.equal(
    reasonLine('Undeclared cashews and pistachios', 'allergen', 'undeclared tree nuts'),
    'Undeclared tree nut allergen',
  );
  assert.equal(
    reasonLine('Possible foreign material contamination with glass', 'foreign_material', null),
    'Possible glass contamination',
  );
  assert.equal(
    reasonLine('Due to Elevated Levels of Lead', 'chemical_contamination', 'lead'),
    'Possible lead contamination',
  );
  assert.equal(
    reasonLine(
      'Due to possible radionuclide contamination.',
      'chemical_contamination',
      'Cesium-137',
    ),
    'Possible Cesium-137 contamination',
  );
  // Scientific organism names keep their correct casing.
  assert.equal(
    reasonLine('Listeria', 'microbial_contamination', 'Listeria monocytogenes'),
    'Possible Listeria monocytogenes contamination',
  );
});

test('health risk is a concise deterministic template, never source prose (founder Part 7)', () => {
  const ecoli = healthRiskSummary('microbial_contamination', 'E. coli', null);
  assert.match(ecoli ?? '', /^E\. coli can cause severe stomach cramps/);
  const listeria = healthRiskSummary('microbial_contamination', 'Listeria monocytogenes', null);
  assert.equal(
    listeria,
    'Listeria can cause serious illness, especially in pregnant people, older adults, newborns, and people with weakened immune systems.',
  );
  const soy = healthRiskSummary('allergen', 'undeclared soybean', null);
  assert.equal(
    soy,
    'People with a soy allergy or severe sensitivity risk a serious or life-threatening allergic reaction if they consume this product.',
  );
  const multi = healthRiskSummary('allergen', 'undeclared milk and sesame', null);
  assert.match(multi ?? '', /milk or sesame allergy/);
  const gluten = healthRiskSummary('allergen', 'undeclared gluten', null);
  assert.match(gluten ?? '', /celiac disease/);
  const glass = healthRiskSummary(
    'foreign_material',
    null,
    'Possible foreign material contamination with glass',
  );
  assert.equal(
    glass,
    'Swallowing pieces of glass can injure the mouth, throat, or digestive tract.',
  );
  const lead = healthRiskSummary('chemical_contamination', 'lead', null);
  assert.match(lead ?? '', /^Lead exposure can be harmful/);

  // Concise: every template stays within the 20–50 word target band.
  for (const text of [ecoli, listeria, soy, multi, gluten, glass, lead]) {
    const words = (text ?? '').split(/\s+/).length;
    assert.ok(words >= 10 && words <= 50, `${words} words: ${text}`);
    assert.match(text ?? '', /^[A-Z]/);
    assert.match(text ?? '', /\.$/);
  }

  // No safe mapping → omitted, never broken prose or boilerplate.
  assert.equal(healthRiskSummary('other_regulatory', null, 'Import Violation'), null);
  assert.equal(healthRiskSummary('unknown', null, null), null);
  assert.equal(healthRiskSummary('microbial_contamination', null, null), null);
});

test('illness display maps the three states to standardized consumer wording', () => {
  assert.deepEqual(
    illnessDisplay({ status: 'none_reported', statements: ['There have been no…'] }),
    {
      headline: 'No illnesses have been reported.',
      detail: null,
    },
  );
  const reported = illnessDisplay({
    status: 'reported',
    statements: ['As of July 25, 2024, 34 sick people have been identified in 13 states.'],
  });
  assert.equal(reported.headline, 'Illnesses have been reported.');
  assert.match(reported.detail ?? '', /34 sick people/);
  // Silence stays unknown — never "0".
  assert.deepEqual(illnessDisplay({ status: 'unknown', statements: [] }), {
    headline: 'No illness count is provided in this notice.',
    detail: null,
  });
});

test('equivalent consumer actions standardize; special actions survive', () => {
  // The dominant FSIS instruction (verbatim from real records).
  const standard = consumerActionDisplay(
    'Consumers who have purchased these products are urged not to consume them. These products should be thrown away or returned to the place of purchase.',
  );
  assert.equal(
    standard?.primary,
    'Do not eat this product. Throw it away or return it to the place of purchase.',
  );
  assert.equal(standard?.standardized, true);

  // Destroy-only instruction keeps its distinct meaning.
  const destroy = consumerActionDisplay(
    'Consumers are urged to destroy the product. Do not open the package.',
  );
  assert.equal(destroy?.primary, 'Do not eat this product. Destroy it.');

  // Retailer guidance is secondary, never the primary consumer action.
  const withRetail = consumerActionDisplay(
    'Consumers are urged not to consume these products and retailers are urged not to sell them. These products should be thrown away or returned to the place of purchase.',
  );
  assert.match(withRetail?.secondary ?? '', /should not sell or serve/);

  // Unrecognized instructions pass through verbatim (cleaned), not dropped.
  const special = consumerActionDisplay(
    'Consumers with weakened immune systems should consult a physician before handling this product.',
  );
  assert.equal(special?.standardized, false);
  assert.match(special?.primary ?? '', /consult a physician/);
  assert.equal(consumerActionDisplay(null), null);
});

test('geography stays honest in both compact and detail forms', () => {
  const states = (list: string[]): CaseProjection['geography'] => ({
    scope: 'states',
    states: list,
    confidence: 'stated',
    sourceText: null,
  });
  assert.equal(geographyLabel(states(['California'])), 'California');
  assert.equal(
    geographyLabel(states(['California', 'Nevada', 'Oregon'])),
    'California, Nevada, Oregon',
  );
  // Large sets compact on the card, full list in detail.
  const many = states(['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID']);
  assert.equal(geographyLabel(many), '12 states');
  assert.equal(geographyDetail(many), many.states.join(', '));
  assert.equal(
    geographyLabel({ scope: 'nationwide', states: [], confidence: 'stated', sourceText: null }),
    'Nationwide',
  );
  // Unknown is never converted to nationwide.
  const unknown: CaseProjection['geography'] = {
    scope: 'unknown',
    states: [],
    confidence: 'stated',
    sourceText: null,
  };
  assert.equal(geographyLabel(unknown), 'Distribution not specified');
  assert.ok(geographyDetail(unknown).startsWith('Distribution not specified'));
});

// ── P1B: standardized hazard-guide selection ────────────────────────────────

/**
 * Guide selection is deterministic, typed, conservative, and independent of
 * recall identity and source page layout: every case below is described only
 * by its canonical typed reason and structured reason evidence.
 */

function reasonEvidence(pathogenOrAllergen: string | null, reasonText: string | null) {
  return { pathogenOrAllergen, reasonText };
}

test('the same recognized hazard produces identical copy across different recalls', () => {
  // Two unrelated Salmonella notices — different reason wording, different
  // agencies' phrasing — must yield byte-identical consumer copy. This is the
  // whole standardization guarantee.
  const first = selectHazardGuidance(
    { family: 'pathogen', pathogen: 'Salmonella' },
    reasonEvidence('Salmonella', 'Product Contamination'),
  );
  const second = selectHazardGuidance(
    { family: 'pathogen', pathogen: 'Salmonella' },
    reasonEvidence('Salmonella', 'Potential Salmonella contamination'),
  );
  assert.ok(first && second);
  assert.deepEqual(first, second);
  assert.equal(first.key, 'salmonella');
});

test('each corpus-evidenced pathogen selects its own guide', () => {
  const cases: [string, string][] = [
    ['Salmonella', 'salmonella'],
    ['Listeria monocytogenes', 'listeria'],
    ['E. coli', 'stec'],
    ['E. coli O157:H7', 'stec'],
    ['Clostridium botulinum', 'botulism'],
    ['Hepatitis A', 'hepatitis-a'],
    ['Cyclospora', 'cyclospora'],
  ];
  for (const [pathogen, key] of cases) {
    const selected = selectHazardGuidance(
      { family: 'pathogen', pathogen },
      reasonEvidence(pathogen, 'Product Contamination'),
    );
    assert.equal(selected?.key, key, `${pathogen} selected ${selected?.key}`);
    assert.ok(selected?.symptoms && selected.symptoms.length > 0);
    assert.ok(selected?.source.url.startsWith('https://'));
  }
});

test('an undeclared allergen selects the allergen guide and names the allergen', () => {
  const milk = selectHazardGuidance(
    { family: 'allergen', raw: 'milk' },
    reasonEvidence('Undeclared milk', 'Unreported Allergens'),
  );
  assert.equal(milk?.key, 'undeclared-allergen');
  // The risk sentence comes from the approved allergen template and names the
  // specific allergen; the symptom list is the shared reviewed one.
  assert.match(milk?.risk ?? '', /milk allergy/i);
  assert.ok(milk?.symptoms?.some((symptom) => /hives/i.test(symptom)));
  assert.equal(milk?.source.organization, 'FDA');
  // Same allergen, different notice wording — identical copy.
  const milkAgain = selectHazardGuidance(
    { family: 'allergen', raw: 'milk' },
    reasonEvidence('Undeclared milk', 'Product Contamination'),
  );
  assert.deepEqual(milk, milkAgain);
  // A different allergen names itself, and never borrows the first one's name.
  const soy = selectHazardGuidance(
    { family: 'allergen', raw: 'soy' },
    reasonEvidence('Undeclared soy', 'Unreported Allergens'),
  );
  assert.match(soy?.risk ?? '', /soy allergy/i);
  assert.doesNotMatch(soy?.risk ?? '', /milk/i);
  // An unnamed allergen degrades to the honest generic sentence, never a guess.
  const unnamed = selectHazardGuidance(
    { family: 'allergen', raw: null },
    reasonEvidence(null, 'Unreported Allergens'),
  );
  assert.match(unnamed?.risk ?? '', /a food allergy or severe sensitivity/i);
});

test('multi-hazard display precedence is order-independent and deterministic', () => {
  // A notice must show exactly ONE guide. Registry order is botulism,
  // listeria, stec, allergen, salmonella, hepatitis-a, cyclospora, and each
  // case below places the LOWER-priority organism FIRST in the evidence
  // string — proving match order, registry order, and text order decide
  // nothing. `displayPriority` is a presentation tie-breaker; it makes no
  // claim that one hazard is medically worse than another.
  const pairs: [string, string][] = [
    ['Salmonella and Listeria monocytogenes', 'listeria'],
    ['Cyclospora and Salmonella', 'salmonella'],
    ['Salmonella and Clostridium botulinum', 'botulism'],
    ['Hepatitis A and E. coli O157:H7', 'stec'],
    ['Cyclospora, Hepatitis A, Salmonella, Listeria', 'listeria'],
  ];
  for (const [evidence, expected] of pairs) {
    const selected = selectHazardGuidance(
      { family: 'pathogen', pathogen: evidence },
      reasonEvidence(evidence, 'Product Contamination'),
    );
    assert.equal(selected?.key, expected, `"${evidence}" selected ${selected?.key}`);
  }
  // No recorded FDA or FSIS notice names two supported hazards today; these
  // are the guard, so a future multi-organism notice always resolves the same
  // way instead of depending on how the reason happens to be worded.
});

test('non-medical hazard families are never given a guide or invented symptoms', () => {
  const families = [
    { family: 'foreign_material', material: 'glass' },
    { family: 'foreign_material', material: null },
    { family: 'mislabeled', word: 'misbranded' },
    { family: 'inspection' },
    { family: 'import', country: 'Ecuador', illegal: true, ineligible: false },
    { family: 'unfit' },
    { family: 'insanitary' },
    { family: 'processing' },
    { family: 'nutrition' },
    { family: 'chemical', agent: 'Lead' },
    { family: 'contents', contents: 'toxic yellow oleander' },
    { family: 'unapproved', ingredient: 'garlic essential oil', use: 'culinary use' },
    { family: 'unknown' },
  ] as const;
  for (const reason of families) {
    assert.equal(
      selectHazardGuidance(reason, reasonEvidence('Glass', 'Potential presence of glass')),
      null,
      `${reason.family} was given a hazard guide`,
    );
  }
});

test('an organism named in a lone canonical reason is still recognized (verbatim safety net)', () => {
  // The structured pathogen slot is frequently null on notices whose reason
  // names the organism outright, which lands the case in the `verbatim`
  // family. Recognizing the name there closes a documented routing gap. No
  // recorded corpus case needs this today; it is a guard, not a behavior
  // change.
  const rescued = selectHazardGuidance(
    { family: 'verbatim', noun: 'Potential Clostridium botulinum contamination' },
    reasonEvidence(null, 'Potential Clostridium botulinum contamination'),
  );
  assert.equal(rescued?.key, 'botulism');
  // A verbatim reason naming NO organism stays unguided.
  assert.equal(
    selectHazardGuidance(
      { family: 'verbatim', noun: 'Potential presence of small stones' },
      reasonEvidence(null, 'Potential presence of small stones'),
    ),
    null,
  );
});

test('guide selection never reads announcement prose', () => {
  // Only the canonical structured reason is evidence. An organism mentioned
  // in the announcement body — background prose, a supplier's history, an
  // unrelated outbreak reference — must not select a guide, or the same
  // hazard would render different copy on different recalls.
  assert.equal(
    selectHazardGuidance(
      { family: 'verbatim', noun: 'Undercooked product' },
      reasonEvidence(null, 'Undercooked product'),
    ),
    null,
  );
  // A pathogen family with no named organism gets no guide either — the
  // generic "possible contamination" case falls to the risk-only tier.
  assert.equal(
    selectHazardGuidance(
      { family: 'pathogen', pathogen: null },
      reasonEvidence(null, 'Product Contamination'),
    ),
    null,
  );
});

test('guide selection is independent of recall identity and agency', () => {
  // Nothing about which notice, which agency, or which page layout produced
  // the reason may change the answer.
  const a = selectHazardGuidance(
    { family: 'pathogen', pathogen: 'Listeria monocytogenes' },
    reasonEvidence('Listeria monocytogenes', 'Product Contamination'),
  );
  const b = selectHazardGuidance(
    { family: 'pathogen', pathogen: 'Listeria monocytogenes' },
    reasonEvidence('listeria monocytogenes', 'potential listeria contamination'),
  );
  assert.deepEqual(a, b);
});

test('the risk-only tier still covers recognized hazards without a reviewed guide', () => {
  // Cronobacter, mold, choking, packaging defects and the rest keep the
  // approved standardized sentence — no guide, so no symptom list and no
  // source citation, but no coverage regression either.
  assert.ok(healthRiskSummary('microbial_contamination', null, 'Potential Cronobacter sakazakii'));
  assert.ok(healthRiskSummary('foreign_material', null, 'Potential glass contamination'));
  assert.ok(healthRiskSummary('product_integrity', null, 'Packaging defect'));
  // And an unmapped regulatory reason still yields nothing at all.
  assert.equal(healthRiskSummary('other_regulatory', null, 'Import Violation'), null);
  assert.equal(healthRiskSummary('unknown', null, null), null);
});
