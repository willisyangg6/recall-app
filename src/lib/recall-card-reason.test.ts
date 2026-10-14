/**
 * The card's shorter reason wording (2026-10-14): exactly the approved
 * shapes change; every named allergen and any uncertainty qualifier survive;
 * confirmed and unfamiliar wording is returned unchanged.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardReasonText } from '@/lib/recall-card-reason';

test('an allergen line drops only the redundant word "allergen"', () => {
  assert.equal(cardReasonText('Undeclared sesame allergen'), 'Undeclared sesame');
  assert.equal(cardReasonText('Undeclared milk and soy allergens'), 'Undeclared milk and soy');
  assert.equal(
    cardReasonText('Undeclared milk, egg and peanut allergens'),
    'Undeclared milk, egg and peanut',
  );
  // An uncertainty qualifier stays.
  assert.equal(cardReasonText('Possible undeclared milk allergen'), 'Possible undeclared milk');
  assert.equal(cardReasonText('Potential undeclared egg allergen'), 'Potential undeclared egg');
});

test('a line that names no allergen, or never said "allergen", is unchanged', () => {
  assert.equal(cardReasonText('Undeclared allergen'), 'Undeclared allergen');
  assert.equal(
    cardReasonText('Undeclared egg, milk, peanut, soy, sulfites, tree nut and wheat'),
    'Undeclared egg, milk, peanut, soy, sulfites, tree nut and wheat',
  );
  assert.equal(cardReasonText('Undeclared wheat and gluten'), 'Undeclared wheat and gluten');
});

test('only the two approved pathogen lines are shortened', () => {
  assert.equal(cardReasonText('Potential Salmonella contamination'), 'Possible Salmonella');
  assert.equal(cardReasonText('Potential Listeria contamination'), 'Possible Listeria');
  for (const unchanged of [
    'Potential E. coli contamination',
    'Potential E. coli and/or Salmonella contamination',
    'Potential to be contaminated with Listeria monocytogenes',
    'Potential foreign material contamination',
    'Potential contamination',
  ]) {
    assert.equal(cardReasonText(unchanged), unchanged);
  }
});

test('confirmed contamination and unfamiliar reasons are returned exactly as given', () => {
  for (const unchanged of [
    'Salmonella contamination',
    'Confirmed Listeria contamination',
    'Contaminated with Listeria monocytogenes',
    'Import violation',
    'Produced without required inspection',
    'Elevated levels of patulin',
  ]) {
    assert.equal(cardReasonText(unchanged), unchanged);
  }
  assert.equal(cardReasonText(null), null);
});
