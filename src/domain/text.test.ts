/**
 * Sentence splitting: abbreviations are not sentence ends. The real defect
 * this pins: "Product was distributed by Primavera Nueva Inc. in California
 * and Nevada to retail stores." split after "Inc.", and the half carrying the
 * states no longer contained a distribution verb — so the recall's geography
 * was lost at ingest.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitSentences } from './text';

test('corporate and state abbreviations do not end sentences', () => {
  assert.deepEqual(
    splitSentences(
      'Product was distributed by Primavera Nueva Inc. in California and Nevada to retail stores.',
    ),
    ['Product was distributed by Primavera Nueva Inc. in California and Nevada to retail stores.'],
  );
  assert.deepEqual(
    splitSentences('Market of Choice, Inc., an Eugene, Ore. establishment, is recalling products.'),
    ['Market of Choice, Inc., an Eugene, Ore. establishment, is recalling products.'],
  );
});

test('real sentence boundaries still split', () => {
  assert.deepEqual(splitSentences('The recall is voluntary. No illnesses have been reported.'), [
    'The recall is voluntary.',
    'No illnesses have been reported.',
  ]);
  // The observed FSIS glued boundary still splits.
  assert.deepEqual(
    splitSentences('discovered during FSIS surveillance activities There have been no reports.'),
    ['discovered during FSIS surveillance activities', 'There have been no reports.'],
  );
});
