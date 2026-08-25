import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AffectedProduct } from '@/domain/recall-types';
import { buildPackageCheck } from './package-check';

// Prose fragments verbatim from recorded real FDA announcements (the same
// records run end-to-end in src/server/fda/benchmark.test.ts).

const product = (rawText: string): AffectedProduct => ({
  sourceNativeId: 'x',
  name: rawText,
  rawText,
  extractionConfidence: 'stated',
});

test('label-driven prose identifiers: lot, UPC, dates, and where to look (Bakr shape)', () => {
  const check = buildPackageCheck(
    'The recalled product can be identified by lot number 2606022, which can be found on the bottom left corner on the rear side of the pouch.\nThe Bakr Brown Butter Chocolate Chunk Ready To Bake Cookie Dough comes in an 8-ounce blue package and is sold in the frozen section.',
    [],
  );
  assert.deepEqual(check.identifiers, [{ label: 'Lot', value: '2606022' }]);
  assert.match(check.locationHints[0], /bottom left corner on the rear side of the pouch/);
  assert.equal(check.packageText, '8-ounce blue package');
  assert.equal(check.coverage, 'structured');
});

test('multiple UPCs and best-by dates from one announcement (aquafaba shape)', () => {
  const check = buildPackageCheck(
    'The recalled Rooted in Rare brand Aquafaba powder is packaged in 4oz (113g) and (12 oz (340g) flexible foil pouches with UPC #199284530959 (4oz) and #199284306226 (12oz).\nBest by 12/14/2026\nBest by 12/12/2027',
    [],
  );
  const labels = check.identifiers.map((i) => `${i.label}:${i.value}`);
  assert.ok(labels.includes('UPC:199284530959'), labels.join(', '));
  assert.ok(labels.includes('UPC:199284306226'), labels.join(', '));
  assert.ok(labels.includes('Best by:12/14/2026'), labels.join(', '));
  assert.ok(labels.includes('Best by:12/12/2027'), labels.join(', '));
});

test('lot-code lists and expiration ranges keep the source qualifier', () => {
  const lots = buildPackageCheck('Lot codes being recalled are: X2741775, X2741859, X2744163.', []);
  assert.deepEqual(lots.identifiers, [{ label: 'Lot', value: 'X2741775, X2741859, X2744163' }]);

  const range = buildPackageCheck(
    'The flavors being recalled are as follows with expiration dates through February 27, 2026, marked in the bottom left corner of the label.',
    [],
  );
  assert.deepEqual(range.identifiers, [
    { label: 'Expiration', value: 'through February 27, 2026' },
  ]);
  assert.match(range.locationHints[0], /bottom left corner of the label/);
});

test('standalone product-with-code lines become checker rows (Publix blueberries shape)', () => {
  const check = buildPackageCheck(
    'The following products are recalled:\nGreenWise Organic Whole Blueberries, 10-ounce, UPC 41415-06453\nGreenWise Organic Whole Blueberries, 48-ounce, UPC 41415-12053',
    [],
  );
  assert.equal(check.proseProductLines.length, 2);
  assert.ok(check.identifiers.some((i) => i.label === 'UPC' && i.value === '41415-06453'));
  assert.equal(check.coverage, 'structured');
});

test('a code is never relabeled: ambiguous values stay under the source label', () => {
  // "USE BY JUL/16/26 430" — 430 is not separately identified by the source,
  // so it must never surface as "Lot: 430" (it stays inside the use-by value
  // through the product-line parser; prose extraction adds nothing for it).
  const check = buildPackageCheck('The tubs display “USE BY JUL/16/26 430”.', []);
  assert.ok(!check.identifiers.some((i) => i.label === 'Lot'));
});

test('source-silent vs parser-missed are distinguished (founder Part 12)', () => {
  // Fresh produce with no package codes anywhere: honest silence.
  const silent = buildPackageCheck(
    'The whole fresh cucumbers were sold loose without packaging or codes of any kind mentioned here.',
    [],
  );
  assert.equal(silent.coverage, 'source_silent');

  // Identifier vocabulary present but nothing extracted: a parser gap, not
  // a source gap — the benchmark alarms on these.
  const missed = buildPackageCheck(
    'Only packages bearing the special lot marking described in the attached table are affected 123456.',
    [],
  );
  assert.equal(missed.coverage, 'parser_missed');

  // Package description without codes = partial.
  const partial = buildPackageCheck(
    'The product is sold in a plastic 150g bag with the brand name.',
    [],
  );
  assert.equal(partial.coverage, 'partial');
  assert.equal(partial.packageText, 'plastic 150g bag');
});

test('structured product rows are the expanded view; duplicated prose identifiers are not repeated', () => {
  const rows = [product('Product A | Batch Code: LLA616903 | UPC: 041548610047')];
  const check = buildPackageCheck(
    'The batch code LLA616903 is printed on the bottom of the package.',
    rows,
  );
  assert.equal(check.hasProductRows, true);
  // The lot stated in prose duplicates the row identifier — not repeated.
  assert.ok(!check.identifiers.some((i) => i.value.includes('LLA616903')));
  assert.equal(check.coverage, 'structured');
});
