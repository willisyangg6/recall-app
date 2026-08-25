import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allergenDisplayPhrase, normalizedAllergenTokens } from './hazard';

test('allergen values normalize to canonical personalization tokens (founder Part 10)', () => {
  assert.deepEqual(normalizedAllergenTokens('undeclared eggs'), ['egg']);
  assert.deepEqual(normalizedAllergenTokens('undeclared soybean'), ['soy']);
  assert.deepEqual(normalizedAllergenTokens('undeclared milk and sesame'), ['milk', 'sesame']);
  assert.deepEqual(normalizedAllergenTokens('undeclared tree nuts'), ['tree nuts']);
  // Specific nuts collapse into the tree-nut family token.
  assert.deepEqual(normalizedAllergenTokens('undeclared cashews and pistachios'), ['tree nuts']);
  assert.deepEqual(normalizedAllergenTokens('undeclared gluten'), ['gluten']);
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
