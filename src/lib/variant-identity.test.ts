/**
 * The closed variant-identity contract: names that are dates, geography,
 * codes, field labels, or serialized source rows can never be affected
 * versions, and real product names always can. Each rejection class pins a
 * live regression: "Best by 12/14/2026" (Aquafaba), "California" (Pounded
 * Yam), "Item name : Birch Benders" and "Case item code : 8 1000156076 5"
 * (Birch Benders).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  captionContradictsPackage,
  isGeographicName,
  packagingOnlyName,
  splitTrailingMeasurements,
  variantIdentityRejection,
} from './variant-identity';

test('dates and field-label rows are never variant identities', () => {
  assert.equal(variantIdentityRejection('Best by 12/14/2026'), 'field-label');
  assert.equal(variantIdentityRejection('Best by 12/12/2027'), 'field-label');
  assert.equal(variantIdentityRejection('Item name : Birch Benders'), 'field-label');
  assert.equal(variantIdentityRejection('Case item code : 8 1000156076 5'), 'field-label');
  assert.equal(variantIdentityRejection('UPC item code : 8 1000156076 8'), 'field-label');
  assert.equal(variantIdentityRejection('Lot code : 5 265'), 'field-label');
  assert.equal(variantIdentityRejection('12/14/2026'), 'date');
  assert.equal(variantIdentityRejection('July 20 – August 17, 2026'), 'date');
});

test('geography is never a variant identity', () => {
  for (const place of ['California', 'Georgia', 'Illinois', 'New Jersey', 'New York', 'Texas']) {
    assert.equal(variantIdentityRejection(place), 'geography', place);
  }
  assert.equal(variantIdentityRejection('Southern California'), 'geography');
  assert.equal(variantIdentityRejection('Ann Arbor and Brighton'), 'geography');
  assert.equal(variantIdentityRejection('NY'), 'geography');
});

test('codes and serialized rows are never variant identities', () => {
  assert.equal(variantIdentityRejection('8 1000156076 8'), 'code');
  assert.equal(variantIdentityRejection('046675000105'), 'code');
  assert.equal(
    variantIdentityRejection('Lot code : 5 265 • Best-If-Used-By date: MAR 24, 2027'),
    'raw-source-row',
  );
});

test('real product identities always pass', () => {
  for (const name of [
    'Kroger Large 12 eggs',
    'Simple Truth Cage Free Medium Brown 12 eggs',
    'Grade A Large Bulk X 15 DOZEN',
    'Mushroom Spinach & Salsa with Two Cheeses',
    'Eridanous Shortbread Cookies with Chocolate Truffle Coating & Apricot Filling',
    'Fireworks White Cheddar Seasoning',
    '12.76 oz Bacon Ranch Crunch Chopped Salad Kit',
    // A month word inside a real name does not make it a date.
    'December Fudge Cake',
    // "Lotus" is not the label "Lot".
    'Lotus Biscoff Cookie Butter',
    // Brooklyn Lager is a product; bare "Brooklyn" is a borough.
    'Brooklyn Lager 6-Pack',
  ]) {
    assert.equal(variantIdentityRejection(name), null, name);
  }
});

test('directional regions and state runs read as geography', () => {
  assert.ok(isGeographicName('Southern Nevada'));
  assert.ok(isGeographicName('Upstate New York'));
  assert.ok(isGeographicName('California Nevada'));
  assert.ok(!isGeographicName('Southern Comfort'));
  assert.ok(!isGeographicName('Market of Choice'));
});

// ── P0A: symptoms and recall narrative ──────────────────────────────────────

test('a symptom the hazard paragraph names is never a variant identity', () => {
  // FDA's own Salmonella and Listeria paragraphs, verbatim: "…resulting in
  // nausea, vomiting, and abdominal cramps" and "…high fever, severe
  // headache, stiffness, nausea, abdominal pain and diarrhea".
  for (const symptom of [
    'Nausea',
    'vomiting',
    'Abdominal cramps',
    'abdominal pain',
    'diarrhea',
    'High fever',
    'severe headache',
    'stiffness',
    'Blurred vision',
    'Difficulty swallowing',
  ]) {
    assert.equal(variantIdentityRejection(symptom), 'symptom', symptom);
  }
});

test('a product whose name contains a symptom word still passes', () => {
  // The vocabulary matches the WHOLE name, never a substring.
  for (const name of [
    'Fever-Tree Premium Tonic Water',
    'Swelling Tides Oyster Crackers',
    'Chills Frozen Lemonade 12 oz',
  ]) {
    assert.equal(variantIdentityRejection(name), null, name);
  }
});

test('shopper instructions are never variant identities', () => {
  // SunFed and Walmart both close with "Consumers should take the following
  // actions:" over a bulleted list; every item below became a version card.
  for (const instruction of [
    'Check to see if you have recalled whole fresh American cucumbers (photo below)',
    'Consumers who are unsure if they have purchased the recalled product are advised to contact their retailer',
    'If you think you have consumed a recalled product and do not feel well, contact your healthcare provider',
    'strongly urged to check the “Use By” date',
    'd in the recall release issued March 19',
  ]) {
    assert.ok(
      variantIdentityRejection(instruction) !== null,
      `${instruction} -> ${variantIdentityRejection(instruction)}`,
    );
  }
});

test('a reference to one of the notice’s own attachments is not a product', () => {
  // FSIS 040-2016 hands off its product list as "[View Labels(PDF only)
  // Labels A , Labels B , Labels C ]"; split on its commas, that run became
  // affected-version cards.
  for (const reference of [
    'Labels A',
    'Labels B',
    'Labels C ]',
    'View Labels',
    'See Labels',
    '[View Labels (PDF only)]',
    'Label 1',
    'Image 2',
    'Photo',
    'Figure 3',
    'Attachment A',
  ]) {
    assert.equal(variantIdentityRejection(reference), 'document-reference', reference);
  }
});

test('a real product whose name opens with a document word still passes', () => {
  // The whole candidate must be the reference, never just its first word.
  for (const name of [
    'Label Rouge Free Range Chicken',
    'Picture Sweet Corn 15 oz',
    'Figure Eight Pretzels',
    'Photo Finish Energy Bars',
  ]) {
    assert.equal(variantIdentityRejection(name), null, name);
  }
});

test('packaging-only names are recognized; product names with packaging words are not', () => {
  for (const packaging of [
    'Cardboard boxes',
    'cardboard boxes',
    'Plastic bags',
    'Trays',
    'Cartons',
    'Glass jars',
    'Aluminum pan with plastic overwrap',
    'Vacuum sealed packages',
    'Clear plastic clamshells',
  ]) {
    assert.equal(packagingOnlyName(packaging), true, packaging);
  }
  for (const product of [
    '7-Eleven Wrap',
    'Boxed Water',
    'Cup Noodles',
    'Bagel Bites',
    'Jalapeno Ranch Dressing',
    'Buffalo Chicken Rangoon',
    'Lunch Box Snack Mix',
    '365',
    '100% Grass-fed Pepper Jack Cheese',
    'a2 Platinum Premium Infant Formula',
    '',
  ]) {
    assert.equal(packagingOnlyName(product), false, product);
  }
});

test('trailing measurement lists split off a base name; measurement-only values never do', () => {
  assert.deepEqual(splitTrailingMeasurements('Enoki Mushroom 150g'), {
    base: 'Enoki Mushroom',
    measurements: ['150g'],
  });
  assert.deepEqual(
    splitTrailingMeasurements(
      'Garlic Mediterranean Infused Extra Virgin Olive Oil 500 ml, 250 ml, and 100 ml',
    ),
    {
      base: 'Garlic Mediterranean Infused Extra Virgin Olive Oil',
      measurements: ['500 ml', '250 ml', '100 ml'],
    },
  );
  assert.deepEqual(
    splitTrailingMeasurements('Chocolatey Eyeballs, 7 oz., 10 oz., 10.5 oz., 11 oz., and 16 oz.'),
    {
      base: 'Chocolatey Eyeballs',
      measurements: ['7 oz.', '10 oz.', '10.5 oz.', '11 oz.', '16 oz.'],
    },
  );
  // A parenthesized metric equivalent stays attached to its measurement.
  assert.deepEqual(
    splitTrailingMeasurements('Banana & Strawberry Fruit Puree Pouches, 4 oz. (113 g)'),
    {
      base: 'Banana & Strawberry Fruit Puree Pouches',
      measurements: ['4 oz. (113 g)'],
    },
  );
  // Measurement-only values and numeric brands never split.
  assert.equal(splitTrailingMeasurements('62.4-oz'), null);
  assert.equal(splitTrailingMeasurements('7 oz'), null);
  assert.equal(splitTrailingMeasurements('365'), null);
  // Names without a trailing measurement never split.
  assert.equal(splitTrailingMeasurements('Nerds Gummy Clusters'), null);
  assert.equal(splitTrailingMeasurements('100% Grass-fed Pepper Jack Cheese'), null);
});

test('origin and net-weight statements are never variant identities', () => {
  // Recorded Sun Hong: a package-description comma list flattened into prose
  // variants — label metadata, not products.
  assert.equal(variantIdentityRejection('Product of Korea'), 'origin-statement');
  assert.equal(variantIdentityRejection('Product of the USA'), 'origin-statement');
  assert.equal(variantIdentityRejection('Products of Mexico'), 'origin-statement');
  assert.equal(variantIdentityRejection('Net weight 7.05 oz/200g'), 'measurement-statement');
  assert.equal(variantIdentityRejection('Net Wt. 12 oz'), 'measurement-statement');
  // A colon-labelled weight is caught earlier as a field label — either
  // category keeps it out of Product.
  assert.notEqual(variantIdentityRejection('Weight: 5 lb'), null);
  assert.equal(variantIdentityRejection('Weight 5 lb'), 'measurement-statement');
});

test('genuine names containing origin/weight vocabulary still pass', () => {
  // Containing the words is not being the statement — the rejections are
  // whole-candidate and anchored.
  assert.equal(variantIdentityRejection('Korean Rice Cakes'), null);
  assert.equal(variantIdentityRejection('Korea Farm Enoki Mushrooms'), null);
  assert.equal(variantIdentityRejection('Dairy Products Assortment'), null);
  assert.equal(variantIdentityRejection('Weight Watchers Smart Ones Desserts'), null);
  assert.equal(variantIdentityRejection('Net Cost Sour Cream'), null);
  // A name carrying a measurement is still a product (demotion of
  // measurement-ONLY names is the presentation contract's job, not a
  // rejection here).
  assert.equal(variantIdentityRejection('Enoki Mushroom 150g'), null);
  assert.equal(variantIdentityRejection('Ukrop’s Baked Spaghetti 62.4-oz Pan'), null);
});

test('the shared caption-contradiction policy: stated identifiers veto, silence never does', () => {
  const pkg = { name: 'Organic Vegetable Medley', size: '12 oz UPC 711535517733', upc: null };
  // A caption naming a different barcode depicts a sibling — even when the
  // row's own barcode lives inside its size cell.
  assert.equal(
    captionContradictsPackage('Organic Vegetable Medley 12oz UPC 803944306999', pkg),
    true,
  );
  assert.equal(
    captionContradictsPackage('Organic Vegetable Medley 12oz UPC 711535517733', pkg),
    false,
  );
  // A caption stating sizes with none the package states is a sibling.
  assert.equal(
    captionContradictsPackage('Wish-Bone Thousand Island Dressing, Net Wt 24 oz.', {
      name: 'Wish-Bone® THOUSAND ISLAND DRESSING',
      size: '15 oz',
      upc: null,
    }),
    true,
  );
  // Silence is not contradiction.
  assert.equal(
    captionContradictsPackage('Thousand Island Dressing bottle', {
      name: 'Wish-Bone® THOUSAND ISLAND DRESSING',
      size: '15 oz',
      upc: '041321006456',
    }),
    false,
  );
  // And a caption with identifiers never vetoes a package that states none.
  assert.equal(
    captionContradictsPackage('Everything bar, 6.35 oz, UPC 850011828564', {
      name: 'Everything Bar',
      size: null,
      upc: null,
    }),
    false,
  );
});
