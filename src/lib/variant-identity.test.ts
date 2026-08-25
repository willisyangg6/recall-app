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

import { isGeographicName, variantIdentityRejection } from './variant-identity';

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
