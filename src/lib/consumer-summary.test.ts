import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  capitalizeLeadingWord,
  companyDisplayName,
  displayHeadlineCase,
  companyLine,
  extractAttachmentLinks,
  headlineCaseIfLowercase,
  humanizeAllCaps,
  parseProductLine,
  productSummaryFromTitle,
  reasonClauseCasing,
} from './consumer-summary';

// Title and product-line strings below are verbatim from the recorded real
// FSIS fixtures in src/server/fsis/fixtures/ (not imported: src/lib code and
// tests stay free of src/server imports per the repository structure rule).

test('product summary from a standard recall headline', () => {
  assert.equal(
    productSummaryFromTitle(
      'Indus Foods, LLC DBA Gangothri Foods Recalls Ready-To-Eat Pickled Goat and Chicken Products Produced Without Benefit of Inspection',
    ),
    'Ready-To-Eat Pickled Goat and Chicken',
  );
  assert.equal(
    productSummaryFromTitle(
      'Asian America Trading, Inc. Recalls Ineligible Siluriformes Fish Products Imported From the People’s Republic of China',
    ),
    'Ineligible Siluriformes Fish',
  );
  assert.equal(
    productSummaryFromTitle(
      'Ajinomoto Foods North America, Inc. Expands Recall for Chicken and Pork Fried Rice, Ramen, and Shu Mai Products Due to Possible Foreign Matter Contamination',
    ),
    'Chicken and Pork Fried Rice, Ramen, and Shu Mai',
  );
  assert.equal(
    productSummaryFromTitle(
      'FSIS Retracts Public Health Alert for Frozen, Ready-to-Eat Chicken Nuggets Due to Updated Laboratory Result',
    ),
    'Frozen, Ready-to-Eat Chicken Nuggets',
  );
});

test('upstream-ingredient alerts retain the triggering recalled ingredient', () => {
  // The jalapeño-style PHA must never collapse to just "Various Meat and Poultry".
  const summary = productSummaryFromTitle(
    'FSIS Issues Public Health Alert for Various Meat and Poultry Products Containing FDA-Regulated Jalapeños That Have Been Recalled Due To Possible Salmonella Contamination',
  );
  assert.equal(
    summary,
    'Various Meat and Poultry Products Containing Recalled FDA-Regulated Jalapeños',
  );

  // "containing X" without a recalled-tail keeps the ingredient relationship too.
  assert.equal(
    productSummaryFromTitle(
      'FSIS Issues Public Health Alert for Chicken Salad Products Containing FDA-Regulated Dressing Due to Possible Listeria Contamination',
    ),
    'Chicken Salad Products Containing FDA-Regulated Dressing',
  );

  // "made with X that has been recalled" variant.
  assert.equal(
    productSummaryFromTitle(
      'FSIS Issues Public Health Alert for Ready-To-Eat Ham Salad Products Made With FDA-Regulated Mayonnaise That Has Been Recalled',
    ),
    'Ready-To-Eat Ham Salad Products Made With Recalled FDA-Regulated Mayonnaise',
  );
});

test('product summary falls back to null on unknown headline grammar', () => {
  assert.equal(productSummaryFromTitle('FSIS Announces Updated Labeling Guidance'), null);
  assert.equal(productSummaryFromTitle(''), null);
  assert.equal(productSummaryFromTitle('Acme Recalls Products'), null);
});

test('all-caps display is un-shouted conservatively', () => {
  assert.equal(humanizeAllCaps("RED'S ALL NATURAL"), "Red's All Natural");
  assert.equal(
    humanizeAllCaps('GREAT VALUE FULLY COOKED DINO SHAPED CHICKEN BREAST NUGGETS'),
    'Great Value Fully Cooked Dino Shaped Chicken Breast Nuggets',
  );
  // Acronyms and dotted forms survive.
  assert.equal(humanizeAllCaps('USDA BBQ SAUCE'), 'USDA BBQ Sauce');
  assert.equal(humanizeAllCaps('U.S. BEEF PATTIES'), 'U.S. Beef Patties');
  assert.equal(humanizeAllCaps('MCCORMICK SEASONED BEEF'), 'McCormick Seasoned Beef');
  assert.equal(humanizeAllCaps('7-ELEVEN SANDWICH'), '7-Eleven Sandwich');
  // Mixed-case brand stylizations are NEVER touched.
  assert.equal(humanizeAllCaps("McDonald's"), "McDonald's");
  assert.equal(
    humanizeAllCaps('Molly’s Kitchen California Style Pasta Salad'),
    'Molly’s Kitchen California Style Pasta Salad',
  );
});

test('unpronounceable initialisms survive un-shouting; ordinary words never do (P2a)', () => {
  // Recorded Kofinas shape: the recalling firm "LMSI LLC" must display as
  // "LMSI", never "Lmsi" — no English word opens with "LMS".
  assert.equal(humanizeAllCaps('LMSI'), 'LMSI');
  assert.equal(humanizeAllCaps('JBS FOODS'), 'JBS Foods');
  // Negative cases: pronounceable all-caps words and brands are still
  // un-shouted — the guard never forces ordinary tokens upper.
  assert.equal(humanizeAllCaps('KROGER BRAND CHEESE'), 'Kroger Brand Cheese');
  assert.equal(humanizeAllCaps('SPRITE'), 'Sprite');
  assert.equal(humanizeAllCaps('SCHWAN FROZEN PIZZA'), 'Schwan Frozen Pizza');
  assert.equal(humanizeAllCaps('STRAWBERRY OKRA PHO'), 'Strawberry Okra Pho');
  assert.equal(humanizeAllCaps('MRS. SMITH PIES'), 'Mrs. Smith Pies');
});

test('company display prefers DBA, strips legal suffixes, un-shouts caps', () => {
  assert.equal(companyDisplayName('Indus Foods, LLC DBA Gangothri Foods'), 'Gangothri Foods');
  // Slash-joined establishment aliases display the primary entity.
  assert.equal(companyDisplayName("City Foods, Inc./Bea's Best Corned Beef"), 'City Foods');
  assert.equal(companyDisplayName('Fresh & Ready Foods LLC'), 'Fresh & Ready Foods');
  assert.equal(companyDisplayName("RED'S ALL NATURAL, LLC."), "Red's All Natural");
  assert.equal(
    companyDisplayName('Ajinomoto Foods North America'),
    'Ajinomoto Foods North America',
  );
  assert.equal(companyDisplayName(null), null);
  assert.equal(companyDisplayName('  '), null);
  // Recorded Kofinas shape: legal-suffix stripping plus the initialism guard.
  assert.equal(companyDisplayName('LMSI LLC'), 'LMSI');
});

test('company line never fabricates an organization', () => {
  // Multi-brand scope only when the source title supports it.
  assert.equal(
    companyLine(null, 'FSIS Issues Public Health Alert for Various Meat and Poultry Products…'),
    'Multiple products and brands',
  );
  assert.equal(
    companyLine(null, 'FSIS Issues Public Health Alert for Ground Beef Products'),
    'Company not specified',
  );
  assert.equal(companyLine('Dorada Foods', 'anything'), 'Dorada Foods');
});

test('package identifiers: quoted use-by with placement (Molly’s Kitchen shape)', () => {
  const parsed = parseProductLine(
    '5-lb. plastic tub packages of “Molly’s Kitchen California Style Pasta Salad” with “USE BY JUL/16/26 430” printed on the side of the plastic tub.',
  );
  assert.ok(parsed);
  assert.equal(parsed.name, 'Molly’s Kitchen California Style Pasta Salad');
  assert.equal(parsed.packageText, '5-lb. plastic tub packages');
  // The whole printed string is a use-by marking; "430" is NOT labeled a lot
  // number because the source does not say so.
  assert.deepEqual(parsed.identifiers, [{ label: 'Use by', value: 'USE BY JUL/16/26 430' }]);
  assert.equal(parsed.locationText, 'printed on the side of the plastic tub');
});

test('package identifiers: label-quote + value-quote + lot + establishment (Dorada shape)', () => {
  const parsed = parseProductLine(
    '29-oz. plastic bags containing approx. 36 “GREAT VALUE FULLY COOKED DINO SHAPED CHICKEN BREAST NUGGETS” with “BEST IF USED BY” date “FEB 10 2027,” lot code” 0416DPO1215,” and establishment number “P44164” printed on the back of the bag.',
  );
  assert.ok(parsed);
  assert.equal(parsed.name, 'GREAT VALUE FULLY COOKED DINO SHAPED CHICKEN BREAST NUGGETS');
  assert.deepEqual(parsed.identifiers, [
    { label: 'Best by', value: 'FEB 10 2027' },
    { label: 'Lot code', value: '0416DPO1215' },
    { label: 'Establishment number', value: 'P44164' },
  ]);
  assert.equal(parsed.locationText, 'printed on the back of the bag');
});

test('package identifiers: unquoted best-by ranges and lot code lists', () => {
  const tj = parseProductLine(
    '20-oz. (1 lb. 4 oz.) plastic bag packages containing frozen “TRADER JOE’S Chicken Fried Rice with stir fried rice, vegetables, seasoned dark chicken meat and eggs” with BEST BY dates 9/8/2026 through 11/17/2026.',
  );
  assert.ok(tj);
  assert.deepEqual(tj.identifiers, [{ label: 'Best by', value: '9/8/2026 through 11/17/2026' }]);

  const wrap = parseProductLine(
    '•\t10-oz. clear clamshell containers containing “thoughtfully handmade just for you Chicken Caesar Wrap with parmesan cheese, lettuce, Caesar dressing” with Best By dates of 21 FEB, 23 FEB, 25 FEB, and lot codes LPK1WA046, LPK1WA048, LPK1WA050 printed on the label.',
  );
  assert.ok(wrap);
  assert.deepEqual(wrap.identifiers, [
    { label: 'Best by', value: '21 FEB, 23 FEB, 25 FEB' },
    { label: 'Lot code', value: 'LPK1WA046, LPK1WA048, LPK1WA050' },
  ]);
  assert.equal(wrap.locationText, 'printed on the label');
});

test('ambiguous quoted codes stay generic identifying text, never mislabeled', () => {
  const parsed = parseProductLine(
    '10-lb. white cardboard box cases containing a plastic bag of “Old World Italian Sausage” with “rope” handwritten on the case.',
  );
  assert.ok(parsed);
  assert.equal(parsed.packageText, '10-lb. white cardboard box cases');
  assert.deepEqual(parsed.identifiers, [{ label: 'Look for', value: 'rope' }]);
  assert.equal(parsed.locationText, 'handwritten on the case');
});

test('product lines without a quoted name are not parsed (caller shows raw text)', () => {
  assert.equal(parseProductLine('Various institutional bulk packages of frozen chicken'), null);
  assert.equal(parseProductLine(''), null);
});

test('official PDF attachments are extracted from summary HTML only', () => {
  const html =
    '<p>The list of products is available <a href="https://www.fsis.usda.gov/sites/default/files/distro_list/2026-08/PHA-08082026-01-product-list_1.pdf">here</a>. ' +
    '<a href="/sites/default/files/food_label_pdf/2026-08/Recall-017-2026-Labels.pdf">view labels</a> ' +
    '<a href="https://www.fda.gov/food/outbreak.pdf">FDA</a> <a href="mailto:MPHotline@usda.gov">mail</a> ' +
    '<a href="https://www.fsis.usda.gov/recalls">listing</a></p>';
  assert.deepEqual(extractAttachmentLinks(html), [
    {
      url: 'https://www.fsis.usda.gov/sites/default/files/distro_list/2026-08/PHA-08082026-01-product-list_1.pdf',
      label: 'Product list (PDF)',
    },
    {
      url: 'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2026-08/Recall-017-2026-Labels.pdf',
      label: 'Product labels (PDF)',
    },
  ]);
  assert.deepEqual(extractAttachmentLinks(null), []);
});

// ── Display capitalization (P3D) ────────────────────────────────────────────

test('headlineCaseIfLowercase fixes a defectively lowercase headline', () => {
  // Synthetic reproduction of the production-observed defect (P3D audit):
  // this exact FDA product description rendered entirely lowercase on Home.
  assert.equal(
    headlineCaseIfLowercase('dietary supplements marketed for male sexual enhancement'),
    'Dietary Supplements Marketed For Male Sexual Enhancement',
  );
  // Recorded-corpus defect (Town Food Service saucepans description).
  assert.equal(
    headlineCaseIfLowercase('4 sizes of aluminum saucepans from 1 quart to 3 quarts'),
    '4 Sizes Of Aluminum Saucepans From 1 Quart To 3 Quarts',
  );
});

test('headlineCaseIfLowercase is a no-op on any value carrying uppercase', () => {
  for (const value of [
    'Dietary Supplements Marketed For Male Sexual Enhancement', // already correct
    'ALL CAPS SHOUTING', // humanizeAllCaps territory, never this helper
    'FDA',
    'USDA',
    'FSIS',
    'UPC',
    'E. coli',
    'iHerb',
    '4Earth',
    'McCain',
    'CuttleFish Flavoured Seafood Ball',
    'ProSource Produce',
    'Murray Int’l Trading',
    "Nature's Promise",
    '500 mL',
    'Thickened Dairy Drink - Mildly Thick/Nectar Consistency',
  ]) {
    assert.equal(headlineCaseIfLowercase(value), value);
  }
});

test('headlineCaseIfLowercase preserves protected tokens inside a lowercase headline', () => {
  // Scientific genus abbreviation: "E. coli", never "E. Coli".
  assert.equal(
    headlineCaseIfLowercase('e. coli contaminated product'),
    'E. coli Contaminated Product',
  );
  // Digit-bearing tokens (codes, model numbers, attached measurements).
  assert.equal(headlineCaseIfLowercase('item 4875 baby powder'), 'Item 4875 Baby Powder');
  assert.equal(headlineCaseIfLowercase('4-lb. smoked sausage'), '4-lb. Smoked Sausage');
  assert.equal(headlineCaseIfLowercase('8-oz cups of dip'), '8-oz Cups Of Dip');
  // Abbreviated units stay lowercase; spelled-out units are ordinary words.
  assert.equal(headlineCaseIfLowercase('16 oz. cream cheese'), '16 oz. Cream Cheese');
  assert.equal(headlineCaseIfLowercase('5 kg bag of flour'), '5 kg Bag Of Flour');
  assert.equal(headlineCaseIfLowercase('1 quart to 3 quarts'), '1 Quart To 3 Quarts');
  // Stylized numeric brand survives even in an otherwise lowercase value.
  assert.equal(headlineCaseIfLowercase('a2 infant formula'), 'a2 Infant Formula');
});

test('headlineCaseIfLowercase handles punctuation, segments, and Unicode', () => {
  assert.equal(headlineCaseIfLowercase('ready-to-eat pickled goat'), 'Ready-To-Eat Pickled Goat');
  assert.equal(
    headlineCaseIfLowercase('mildly thick/nectar consistency'),
    'Mildly Thick/Nectar Consistency',
  );
  assert.equal(headlineCaseIfLowercase("red's all natural"), "Red's All Natural");
  assert.equal(headlineCaseIfLowercase('baked bites (chocolate)'), 'Baked Bites (Chocolate)');
  assert.equal(headlineCaseIfLowercase('jalapeño ranch dip'), 'Jalapeño Ranch Dip');
  assert.equal(headlineCaseIfLowercase(''), '');
  assert.equal(headlineCaseIfLowercase('   '), '   ');
});

test('capitalizeLeadingWord fixes a lowercase-leading label or sentence only', () => {
  // Synthetic reproductions of the production-observed Dynarex defects: the
  // FDA brand field carried "dynacare" entirely lowercase.
  assert.equal(capitalizeLeadingWord('dynacare'), 'Dynacare');
  assert.equal(
    capitalizeLeadingWord('dynacare recalled Baby Powder'),
    'Dynacare recalled Baby Powder',
  );
  // Recorded-corpus defect (Sunco & Frenchie brand entry).
  assert.equal(
    capitalizeLeadingWord('terrafina recalled Golden Raisins'),
    'Terrafina recalled Golden Raisins',
  );
  assert.equal(capitalizeLeadingWord("red's all natural"), "Red's all natural");
  assert.equal(capitalizeLeadingWord('éclair assortment'), 'Éclair assortment');
});

test('capitalizeLeadingWord preserves stylized, numeric, and cased identities', () => {
  for (const value of [
    'a2', // stylized lowercase brand — the audited sentenceCaseValue defect
    'a2 recalled a2 Platinum',
    'iHerb',
    'iHerb recalled Supplements',
    '4Earth',
    'eBay listing',
    'FDA',
    'McCain',
    'Dynacare', // already correct
    '4-lb., or various weight packages sliced in retail delis',
    '30 8-oz',
    '',
    '   ',
  ]) {
    assert.equal(capitalizeLeadingWord(value), value);
  }
});

test('both P3D helpers are idempotent across the whole example matrix', () => {
  const inputs = [
    'dietary supplements marketed for male sexual enhancement',
    '4 sizes of aluminum saucepans from 1 quart to 3 quarts',
    'e. coli contaminated product',
    '16 oz. cream cheese',
    'a2 infant formula',
    "red's all natural",
    'jalapeño ranch dip',
    'ready-to-eat pickled goat',
    'dynacare',
    'dynacare recalled Baby Powder',
    'terrafina',
    'a2',
    'a2 recalled a2 Platinum',
    'iHerb',
    '4Earth',
    'McCain',
    'FDA',
    'E. coli',
    '500 mL',
    '30 8-oz',
    '',
    '   ',
  ];
  for (const input of inputs) {
    const headline = headlineCaseIfLowercase(input);
    assert.equal(headlineCaseIfLowercase(headline), headline, `headline not idempotent: ${input}`);
    const leading = capitalizeLeadingWord(input);
    assert.equal(capitalizeLeadingWord(leading), leading, `leading not idempotent: ${input}`);
  }
});

test('companyDisplayName opens a defectively lowercase company with a capital', () => {
  // Synthetic reproduction of the production-observed Dynarex defect.
  assert.equal(companyDisplayName('dynacare'), 'Dynacare');
  // Stylized and already-cased names are untouched.
  assert.equal(companyDisplayName('a2 Milk Company'), 'a2 Milk Company');
  assert.equal(companyDisplayName('iHerb, LLC'), 'iHerb');
});

test('displayHeadlineCase is the one composed pipeline both cards and push use', () => {
  // ALL-CAPS is un-shouted (humanizeAllCaps side of the composition).
  assert.equal(displayHeadlineCase('TOP SIRLOIN BUTT'), 'Top Sirloin Butt');
  assert.equal(displayHeadlineCase('FDA UPC LMSI'), 'FDA UPC LMSI'); // acronyms kept
  // A defectively lowercase headline is headline-cased (the other side).
  assert.equal(
    displayHeadlineCase('dietary supplements marketed for male sexual enhancement'),
    'Dietary Supplements Marketed For Male Sexual Enhancement',
  );
  // Correct mixed casing passes through untouched.
  for (const value of [
    'Crunchy Trail Mix',
    'a2 Platinum Premium Infant Formula',
    'iHerb',
    'E. coli',
  ]) {
    assert.equal(displayHeadlineCase(value), value);
  }
  // The two gates are mutually exclusive, so the composition is idempotent.
  for (const input of ['TOP SIRLOIN BUTT', 'dietary supplements', 'Crunchy Trail Mix', '', '   ']) {
    const once = displayHeadlineCase(input);
    assert.equal(displayHeadlineCase(once), once, `not idempotent: ${input}`);
  }
});

// ── Reason-clause sentence-interior casing (P3E) ────────────────────────────
//
// Phrases below marked "recorded" are the verbatim source reason phrases of
// the audited FDA corpus notices; the full-pipeline regressions for those
// notices live in src/server/presentation-casing.test.ts. Cases marked
// "synthetic" cover edge shapes the recorded corpus does not contain.

test('reasonClauseCasing restores organism casing from the genus vocabulary (recorded)', () => {
  assert.equal(
    reasonClauseCasing('Potential Cronobacter sakazakii contamination'),
    'potential Cronobacter sakazakii contamination',
  );
  assert.equal(
    reasonClauseCasing('Potential for cross-contamination with Cronobacter sakazakii'),
    'potential for cross-contamination with Cronobacter sakazakii',
  );
  assert.equal(
    reasonClauseCasing('Potential Foodborne Illness – Bacillus cereus'),
    'potential foodborne illness – Bacillus cereus',
  );
  assert.equal(
    reasonClauseCasing(
      'Presence of cereulide toxin produced by some strains of the bacterium Bacillus cereus',
    ),
    'presence of cereulide toxin produced by some strains of the bacterium Bacillus cereus',
  );
  assert.equal(
    reasonClauseCasing('Potential mold contamination - Talaromyces penicillium'),
    'potential mold contamination - Talaromyces penicillium',
  );
});

test('reasonClauseCasing keeps vitamin designations uppercase (recorded)', () => {
  assert.equal(
    reasonClauseCasing('Elevated level of Vitamin D3 dosage'),
    'elevated level of vitamin D3 dosage',
  );
  assert.equal(
    reasonClauseCasing('levels of Vitamin D above the maximum level permitted'),
    'levels of vitamin D above the maximum level permitted',
  );
});

test('reasonClauseCasing flattens generic source title casing to natural prose (recorded)', () => {
  // A capitalized drug name is not medically meaningful casing — lowercase
  // mid-sentence is the natural prose form.
  assert.equal(reasonClauseCasing('Undeclared Sildenafil'), 'undeclared sildenafil');
  // "lead" is lowercase in the canonical chemical vocabulary — the vocabulary
  // affirms natural lowercase rather than restoring a capital.
  assert.equal(
    reasonClauseCasing('Potential Foodborne Illness – Lead contamination'),
    'potential foodborne illness – lead contamination',
  );
  assert.equal(
    reasonClauseCasing('Product Safety – choking threats'),
    'product safety – choking threats',
  );
  assert.equal(
    reasonClauseCasing('Foodborne Illness - Potential for microorganisms growth'),
    'foodborne illness - potential for microorganisms growth',
  );
});

test('reasonClauseCasing restores canonical pathogen and chemical spans (synthetic)', () => {
  // No recorded free-text reason names these agents (they classify into the
  // structured families first), but the helper must not corrupt them if one
  // ever arrives: the shared vocabularies carry the canonical casing.
  assert.equal(
    reasonClauseCasing('Potential E. Coli O157:H7 Contamination'),
    'potential E. coli O157:H7 contamination',
  );
  assert.equal(
    reasonClauseCasing('Possible Listeria Monocytogenes exposure'),
    'possible Listeria monocytogenes exposure',
  );
  // A genuinely semantic code-bearing agent survives via CHEMICAL_AGENTS.
  assert.equal(
    reasonClauseCasing('Potential Cesium-137 Contamination'),
    'potential Cesium-137 contamination',
  );
});

test('reasonClauseCasing never invents a designation from a code-like token (synthetic)', () => {
  // "d3" not governed by the word "vitamin" is a model/code token, not a
  // nutrient designation.
  assert.equal(
    reasonClauseCasing('Defective Model D3 Dispenser Part'),
    'defective model d3 dispenser part',
  );
  // ALL-CAPS generic prose is ordinary shouting, not semantic casing.
  assert.equal(reasonClauseCasing('POTENTIAL CHOKING HAZARD'), 'potential choking hazard');
});

test('reasonClauseCasing degrades safely on degenerate input (synthetic)', () => {
  assert.equal(reasonClauseCasing(''), '');
  assert.equal(reasonClauseCasing('   '), '   ');
  // Punctuation and parentheses pass through untouched (recorded EA Sween
  // shape: the phrase is already natural lowercase).
  assert.equal(
    reasonClauseCasing('the potential presence of foreign particles (plastic)'),
    'the potential presence of foreign particles (plastic)',
  );
});

test('reasonClauseCasing is casing-only and idempotent over every covered shape', () => {
  const inputs = [
    'Potential Cronobacter sakazakii contamination',
    'Potential Foodborne Illness – Bacillus cereus',
    'Potential mold contamination - Talaromyces penicillium',
    'Elevated level of Vitamin D3 dosage',
    'levels of Vitamin D above the maximum level permitted',
    'Undeclared Sildenafil',
    'Potential Foodborne Illness – Lead contamination',
    'Potential E. Coli O157:H7 Contamination',
    'POTENTIAL CHOKING HAZARD',
    'the potential presence of foreign particles (plastic)',
    'Defective Model D3 Dispenser Part',
    '',
    '   ',
  ];
  for (const input of inputs) {
    const once = reasonClauseCasing(input);
    // Casing-only: the transform never adds, drops, or reorders a character.
    assert.equal(once.toLowerCase(), input.toLowerCase(), `not casing-only: ${input}`);
    assert.equal(reasonClauseCasing(once), once, `not idempotent: ${input}`);
  }
});
