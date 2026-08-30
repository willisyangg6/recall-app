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

test('protocol-relative hrefs resolve correctly — the defect behind the malformed ledger URLs', () => {
  // The exact href forms preserved in the stored summary HTML of notices
  // 030-2021 and PHA-12182021-02 (read from the live corpus, 2026-08-29).
  // The pre-C9 extractor treated them as root-relative and produced
  // https://www.fsis.usda.gov//www.fsis.usda.gov/… — the duplicated-host
  // 404s in product_visual_failures.
  const urls = extractLabelPdfUrls(
    '<p>[<a href="//www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-08/030-2021-labels.pdf">view labels</a>]</p>' +
      '<p>[<a href="//www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-12/pha-12182021-02-labels.pdf">view labels</a>]</p>',
  );
  assert.deepEqual(urls, [
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-08/030-2021-labels.pdf',
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-12/pha-12182021-02-labels.pdf',
  ]);
});

test('an already-malformed duplicated-host href is repaired, not re-fetched under the broken form', () => {
  assert.deepEqual(
    extractLabelPdfUrls(
      '<a href="https://www.fsis.usda.gov//www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-08/030-2021-labels.pdf">view labels</a>',
    ),
    ['https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-08/030-2021-labels.pdf'],
  );
});

test('an external URL that embeds the FSIS host is never rewritten into an FSIS URL', () => {
  assert.deepEqual(
    extractLabelPdfUrls(
      '<a href="https://example.com//www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-08/labels.pdf">view labels</a>',
    ),
    [],
  );
});

test('query strings and percent-encoded segments survive extraction', () => {
  assert.deepEqual(
    extractLabelPdfUrls(
      '<a href="/sites/default/files/food_label_pdf/2023-10/Recall%20047-2023_food%20label.pdf?rev=1&amp;x=a%2Fb">view labels</a>',
    ),
    [
      'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2023-10/Recall%20047-2023_food%20label.pdf?rev=1&x=a%2Fb',
    ],
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
