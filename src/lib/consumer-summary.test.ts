import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  companyDisplayName,
  companyLine,
  extractAttachmentLinks,
  humanizeAllCaps,
  parseProductLine,
  productSummaryFromTitle,
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
