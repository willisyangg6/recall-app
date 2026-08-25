import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  conceptForLabel,
  isCodeAndDateLabel,
  isLayoutArtifactValue,
  normalizeLabel,
} from './consumer-concepts';

test('source labels route into consumer concepts, never into UI sections of their own', () => {
  // The real FDA/FSIS headings that used to become cards.
  assert.equal(conceptForLabel('Generic name'), 'variant');
  assert.equal(conceptForLabel('Sold At'), 'distribution');
  assert.equal(conceptForLabel('Net weight'), 'package_size');
  assert.equal(conceptForLabel('Product Packaging'), 'packaging');
  assert.equal(conceptForLabel('Package Color'), 'package_color');
  assert.equal(conceptForLabel('UPC'), 'upc');
  assert.equal(conceptForLabel('Batch Code'), 'lot');
  assert.equal(conceptForLabel('Best if Used By Date'), 'best_by');
  assert.equal(conceptForLabel('Expiration Dates'), 'expiration');
  // Present in the source, deliberately not shown.
  assert.equal(conceptForLabel('Intended use'), 'intended_use');
  assert.equal(conceptForLabel('Condition'), 'condition');
  assert.equal(conceptForLabel('Shelf life'), 'shelf_life');
  // Pure page-layout metadata.
  assert.equal(conceptForLabel('See Image Below'), 'layout_artifact');
  // Unknown labels are never guessed into a concept.
  assert.equal(conceptForLabel('Marketing Region Tier'), 'unknown');
});

test('layout-artifact values never survive into consumer UI', () => {
  for (const value of ['See Image Below', 'see image', 'N/A', 'None', 'no packaging', '—', '']) {
    assert.equal(isLayoutArtifactValue(value), true, value);
  }
  for (const value of ['Paper Bag', '12 oz', '733163001576']) {
    assert.equal(isLayoutArtifactValue(value), false, value);
  }
});

test('a label naming both a code and a date is recognized as compound', () => {
  assert.equal(isCodeAndDateLabel('Batch Code/Best Before Date'), true);
  assert.equal(isCodeAndDateLabel('Lot code and expiration date'), true);
  assert.equal(isCodeAndDateLabel('Best Before'), false);
  assert.equal(isCodeAndDateLabel('UPC'), false);
});

test('label normalization is punctuation and case insensitive', () => {
  assert.equal(normalizeLabel('  Best-By Date:  '), 'best-by date');
  assert.equal(normalizeLabel('Brand Name(s)'), 'brand names');
});
