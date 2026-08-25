import assert from 'node:assert/strict';
import { test } from 'node:test';

import { composeCodeLocation, isCodeLocation, isValidForConcept } from './fact-types';

test('a date field never accepts something that is not a date', () => {
  // The canonical cross-type failure: a NatureBest net weight filed under a
  // date heading rendered as "Use by: 58 oz", which a shopper cannot find on
  // any package and would read as "not my product".
  assert.equal(isValidForConcept('use_by', '58 oz'), false);
  assert.equal(isValidForConcept('best_by', 'Date, 48 oz'), false);
  assert.equal(
    isValidForConcept('best_by', 'on the Wegmans Deluxe Mixed Nuts Unsalted 34 oz'),
    false,
  );
  // Genuine dates and printed date codes still pass.
  assert.equal(isValidForConcept('use_by', 'February 14, 2026'), true);
  assert.equal(isValidForConcept('best_by', 'C 08 05 23'), true);
  assert.equal(isValidForConcept('expiration', 'on 10/2025'), true);
});

test('a size field never accepts a bare date, and named sizes still pass', () => {
  assert.equal(isValidForConcept('package_size', 'February 14, 2026'), false);
  assert.equal(isValidForConcept('package_size', '14 oz (397 g)'), true);
  assert.equal(isValidForConcept('package_size', 'Half Gallon'), true);
  assert.equal(isValidForConcept('package_size', '6 Bars'), true);
});

test('a number the source calls a UPC stays a UPC, above the barcode floor', () => {
  assert.equal(isValidForConcept('upc', '628634442166'), true);
  // Retailer-assigned codes are shorter than a scannable barcode and are
  // printed on the package exactly as the notice writes them.
  assert.equal(isValidForConcept('upc', '41415-06453'), true);
  assert.equal(isValidForConcept('upc', '8541200408'), true);
  // Below ten digits the number is something else the notice printed nearby —
  // a lot code a mis-read sentence attached to the word "UPC".
  assert.equal(isValidForConcept('upc', '1226183'), false);
  assert.equal(isValidForConcept('upc', 'See image below'), false);
});

test('recall narrative can never become a place to look for a code', () => {
  // The exact NatureBest regression: a free-text search for "located in…" ran
  // across the company's address sentence and told consumers to look for a lot
  // code in Missouri City, Texas.
  assert.equal(
    isCodeLocation(
      'located in Missouri City, TX and Houston, TX is voluntarily recalling products containing',
    ),
    false,
  );
  assert.equal(
    isCodeLocation('located at 888 Magnolia Ave, Elizabeth, NJ 07201, is recalling Item # LL0320'),
    false,
  );
  assert.equal(
    isCodeLocation('located on the back of the product, are being voluntarily recalled:'),
    false,
  );
  assert.equal(isCodeLocation('can be found on the recall list'), false);
});

test('"same packaging as …" is a relationship between versions, not a location', () => {
  // Prince Bakery states this to say two breads share artwork. Routed into
  // "where to find it" it tells a shopper to look at a different product.
  assert.equal(isCodeLocation('same packaging as Sesame French Bread Large'), false);
  assert.equal(
    composeCodeLocation('Green and yellow (same packaging as Sesame Italian Bread Large)'),
    null,
  );
});

test('code locations are composed from semantics, never concatenated', () => {
  // Concatenating a prefix onto a source fragment produced "Located on at the
  // top of the label"; composing from surface and position cannot.
  assert.equal(composeCodeLocation('bottom of package')?.text, 'On the bottom of the package.');
  assert.equal(composeCodeLocation('at the top of the label')?.text, 'At the top of the label.');
  assert.equal(
    composeCodeLocation('can be found on the bottom left corner on the rear side of the pouch')
      ?.text,
    'On the bottom-left of the back of the pouch.',
  );
  assert.equal(
    composeCodeLocation('can be found on the jar cap, directly beneath the expiration date')?.text,
    'On the jar cap, directly beneath the expiration date.',
  );
});

test('the verb introducing a location is not mistaken for the container', () => {
  // "**can** be found on the bottom of the ingredient side panel" once matched
  // "can" as the container, sending consumers to look at a can that does not
  // exist for this product.
  const composed = composeCodeLocation(
    'can be found on the bottom of the ingredient side panel of the 5 lb',
  );
  assert.equal(composed?.text, 'On the bottom of the panel.');
});

test('how a code looks is a separate fact from where it is', () => {
  const composed = composeCodeLocation('printed in black ink on the back of the package');
  assert.equal(composed?.text, 'On the back of the package.');
  assert.equal(composed?.appearance, 'Black printed text.');
  // Appearance alone is not a location, so it cannot stand in for one.
  assert.equal(composeCodeLocation('printed in black ink'), null);
});
