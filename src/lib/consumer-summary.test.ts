import assert from 'node:assert/strict';
import { test } from 'node:test';

import { companyDisplayName, parseProductLine, productSummaryFromTitle } from './consumer-summary';

// Title strings below are verbatim from the recorded real FSIS fixtures in
// src/server/fsis/fixtures/ (not imported: src/lib code and tests stay free of
// src/server imports per the repository structure rule).

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
  // Entity-decoded form, as produced by the parser before projection.
  assert.equal(
    productSummaryFromTitle(
      'Impero Foods & Meats, Inc. Recalls Raw Pork Sausage Products Produced Without Benefit of Inspection',
    ),
    'Raw Pork Sausage',
  );
});

test('product summary from expansion and PHA headlines', () => {
  assert.equal(
    productSummaryFromTitle(
      'Ajinomoto Foods North America, Inc. Expands Recall for Chicken and Pork Fried Rice, Ramen, and Shu Mai Products Due to Possible Foreign Matter Contamination',
    ),
    'Chicken and Pork Fried Rice, Ramen, and Shu Mai',
  );
  // PHA pattern must win even though the tail contains the word "Recalled".
  assert.equal(
    productSummaryFromTitle(
      'FSIS Issues Public Health Alert for Various Meat and Poultry Products Containing FDA-Regulated Jalapeños That Have Been Recalled Due To Possible Salmonella Contamination',
    ),
    'Various Meat and Poultry',
  );
  assert.equal(
    productSummaryFromTitle(
      'FSIS Retracts Public Health Alert for Frozen, Ready-to-Eat Chicken Nuggets Due to Updated Laboratory Result',
    ),
    'Frozen, Ready-to-Eat Chicken Nuggets',
  );
});

test('product summary falls back to null on unknown headline grammar', () => {
  assert.equal(productSummaryFromTitle('FSIS Announces Updated Labeling Guidance'), null);
  assert.equal(productSummaryFromTitle(''), null);
  // A match whose product phrase is empty after cleanup is rejected, not shown.
  assert.equal(productSummaryFromTitle('Acme Recalls Products'), null);
});

test('company display name prefers DBA and strips mechanical legal suffixes', () => {
  assert.equal(companyDisplayName('Indus Foods, LLC DBA Gangothri Foods'), 'Gangothri Foods');
  assert.equal(companyDisplayName('Fresh & Ready Foods LLC'), 'Fresh & Ready Foods');
  assert.equal(companyDisplayName('Asian America Trading, Inc.'), 'Asian America Trading');
  assert.equal(companyDisplayName('Impero Foods & Meats, Inc.'), 'Impero Foods & Meats');
  // No suffix → unchanged; identity words are never stripped.
  assert.equal(
    companyDisplayName('Ajinomoto Foods North America'),
    'Ajinomoto Foods North America',
  );
  assert.equal(companyDisplayName('Dorada Foods'), 'Dorada Foods');
  assert.equal(companyDisplayName(null), null);
  assert.equal(companyDisplayName('  '), null);
});

test('product lines split into name, package, and identifying details', () => {
  // Verbatim real product lines from the fixtures.
  const pickle = parseProductLine('8-oz. glass jars containing “Gangothri Goat Pickle” ');
  assert.deepEqual(pickle, {
    name: 'Gangothri Goat Pickle',
    packageText: '8-oz. glass jars',
    detailText: null,
  });

  const sausage = parseProductLine(
    '•\t10-lb. white cardboard box cases containing a plastic bag of “Old World Italian Sausage” with “rope” handwritten on the case.  ',
  );
  assert.equal(sausage?.name, 'Old World Italian Sausage');
  assert.equal(sausage?.packageText, '10-lb. white cardboard box cases');
  assert.equal(sausage?.detailText, 'with “rope” handwritten on the case.');

  // Identifying details (dates, lot codes, establishment numbers) are kept.
  const nuggets = parseProductLine(
    '29-oz. plastic bags containing approx. 36 “GREAT VALUE FULLY COOKED DINO SHAPED CHICKEN BREAST NUGGETS” with “BEST IF USED BY” date “FEB 10 2027,” lot code” 0416DPO1215,” and establishment number “P44164” printed on the back of the bag.',
  );
  assert.equal(nuggets?.name, 'GREAT VALUE FULLY COOKED DINO SHAPED CHICKEN BREAST NUGGETS');
  assert.ok(nuggets?.detailText?.includes('FEB 10 2027'));
  assert.ok(nuggets?.detailText?.includes('P44164'));

  // Trailing punctuation inside the quoted label is cleaned, name preserved.
  const crackers = parseProductLine(
    '50-g plastic bag packages containing “CRISPY FISH SKIN CRACKERS, SALTED EGG.” ',
  );
  assert.equal(crackers?.name, 'CRISPY FISH SKIN CRACKERS, SALTED EGG');
});

test('product lines without a quoted name are not parsed (caller shows raw text)', () => {
  assert.equal(parseProductLine('Various institutional bulk packages of frozen chicken'), null);
  assert.equal(parseProductLine(''), null);
});
