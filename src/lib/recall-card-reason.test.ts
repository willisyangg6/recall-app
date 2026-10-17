/**
 * The card's shorter reason wording (2026-10-14, widened 2026-10-16 from the
 * corpus audit): only recognised shapes change; every named allergen, hazard
 * and connective, and the uncertainty, survive; confirmed and unfamiliar
 * wording is returned unchanged. Inputs are the corpus's own strings.
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

test('the two founder-approved pathogen lines keep their short forms', () => {
  assert.equal(cardReasonText('Potential Salmonella contamination'), 'Possible Salmonella');
  assert.equal(cardReasonText('Potential Listeria contamination'), 'Possible Listeria');
});

test('every potential pathogen line reads "Possible <organism>", keeping each organism and connective', () => {
  for (const [given, card] of [
    ['Potential E. coli contamination', 'Possible E. coli'],
    ['Potential Clostridium botulinum contamination', 'Possible Clostridium botulinum'],
    ['Potential Hepatitis A contamination', 'Possible Hepatitis A'],
    ['Potential Cyclospora contamination', 'Possible Cyclospora'],
    ['Potential Cronobacter sakazakii contamination', 'Possible Cronobacter sakazakii'],
    ['Potential Salmonella and E. coli contamination', 'Possible Salmonella and E. coli'],
    ['Potential E. coli or Salmonella contamination', 'Possible E. coli or Salmonella'],
    ['Potential E. coli and/or Salmonella contamination', 'Possible E. coli and/or Salmonella'],
    ['Potential to be contaminated with Listeria monocytogenes', 'Possible Listeria monocytogenes'],
  ]) {
    assert.equal(cardReasonText(given), card, given);
  }
});

test('other potential hazards say "Possible" and keep every named material', () => {
  for (const [given, card] of [
    ['Potential foreign material contamination', 'Possible foreign material contamination'],
    ['Potential lead contamination', 'Possible lead contamination'],
    ['Potential Cesium-137 contamination', 'Possible Cesium-137 contamination'],
    ['Potential metal contamination', 'Possible metal contamination'],
    ['Potential contamination', 'Possible contamination'],
    ['Potential to be contaminated with mold', 'Possible mold contamination'],
    ['Potential presence of small stones', 'Possible small stones'],
    [
      'The potential presence of foreign particles (plastic)',
      'Possible foreign particles (plastic)',
    ],
    ['Potential for under-processing', 'Possible under-processing'],
    [
      'Potential for cross-contamination with Cronobacter sakazakii',
      'Possible cross-contamination with Cronobacter sakazakii',
    ],
    [
      'Potential choking hazard for babies and young children',
      'Possible choking hazard for babies and young children',
    ],
  ]) {
    assert.equal(cardReasonText(given), card, given);
  }
});

test('"Potential Foodborne Illness – X" drops only the heading', () => {
  assert.equal(cardReasonText('Potential Foodborne Illness - Botulism'), 'Possible botulism');
  assert.equal(cardReasonText('Potential Foodborne Illness -Botulism'), 'Possible botulism');
  assert.equal(
    cardReasonText('Potential Foodborne Illness – Bacillus cereus'),
    'Possible Bacillus cereus',
  );
  assert.equal(
    cardReasonText('Potential Foodborne Illness – Lead contamination'),
    'Possible lead contamination',
  );
});

test('a mixed list is not treated as all pathogens: the word "contamination" stays', () => {
  assert.equal(
    cardReasonText('Potential Salmonella and glass contamination'),
    'Possible Salmonella and glass contamination',
  );
});

test('confirmed contamination and unfamiliar reasons are returned exactly as given', () => {
  for (const unchanged of [
    'Salmonella contamination',
    'Confirmed Listeria contamination',
    'Contaminated with Listeria monocytogenes',
    'Import violation',
    'Produced without required inspection',
    'Elevated levels of patulin',
    'Cronobacter spp. contamination',
    'Foodborne Illness - Potential for microorganisms growth',
    'Gastrointestinal illness and potential liver function issues',
    'Product Safety – choking threats',
    'Undeclared sulfites',
    'Product contains sildenafil and tadalafil',
  ]) {
    assert.equal(cardReasonText(unchanged), unchanged);
  }
  assert.equal(cardReasonText(null), null);
});
