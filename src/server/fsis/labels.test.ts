/**
 * FSIS label-PDF pipeline: link discovery and content-addressed idempotency.
 * (Actual rasterization is exercised by the bounded dry run in
 * scripts/render-fsis-labels.ts — it needs network and the WASM decoders, so
 * it stays out of the unit suite.)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractLabelPdfUrls, labelAssetKey, sha256 } from './labels';

test('label PDF links are found, absolutized, and https-normalized', () => {
  const urls = extractLabelPdfUrls(
    '<p>The following products are subject to recall ' +
      '[<a href="/sites/default/files/food_label_pdf/2026-08/Recall-017-2026-Labels.pdf">view labels</a>]:</p>' +
      '<p>[<a href="http://www.fsis.usda.gov/sites/default/files/import/019-2014-incorrrect-label-1.pdf">view labels</a>]</p>',
  );
  assert.deepEqual(urls, [
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2026-08/Recall-017-2026-Labels.pdf',
    'https://www.fsis.usda.gov/sites/default/files/import/019-2014-incorrrect-label-1.pdf',
  ]);
});

test('distribution-list PDFs and third-party hosts never qualify', () => {
  assert.deepEqual(
    extractLabelPdfUrls(
      '<a href="/sites/default/files/distro_list/dl-017-2026.pdf">distribution list</a>' +
        '<a href="https://example.com/labels.pdf">labels</a>',
    ),
    [],
  );
});

test('asset keys are content-addressed and deterministic', () => {
  const bytes = new TextEncoder().encode('the same pdf bytes');
  const hash = sha256(bytes);
  assert.equal(hash, sha256(new TextEncoder().encode('the same pdf bytes')));
  assert.equal(labelAssetKey(hash, 1), labelAssetKey(hash, 1));
  assert.notEqual(labelAssetKey(hash, 1), labelAssetKey(hash, 2));
  assert.match(labelAssetKey(hash, 3), /^fsis-labels\/[0-9a-f]{20}\/p3\.webp$/);
});
