import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractProseIdentifiers, extractProseVariantLines } from './prose-identifiers';

// Every input below is a verbatim shape from a recorded real announcement.

function values(text: string, concept: string): string[] {
  return extractProseIdentifiers(text)
    .facts.filter((f) => f.concept === concept)
    .map((f) => f.value);
}

test('inline labeled identifiers are extracted from ordinary prose', () => {
  assert.deepEqual(
    values(
      'The recalled product can be identified by lot number 2606022, which can be found on the pouch.',
      'lot',
    ),
    ['2606022'],
  );
  assert.deepEqual(
    values(
      'The product comes in a 10.5-ounce, blue box marked with a BEST IF USED BY DATE of C 08 05 23 on the top.',
      'best_by',
    ),
    ['C 08 05 23'],
  );
  assert.deepEqual(values('The UPC code is- 7-43490-00010-4.', 'upc'), ['7-43490-00010-4']);
  assert.deepEqual(
    values(
      'stamped with the SELL BY date of September 15, 2022, which can be found on the bottom',
      'sell_by',
    ),
    ['September 15, 2022'],
  );
});

test('value lists under one label become individual values', () => {
  assert.deepEqual(
    values('marked with any of the following Lot numbers: 1472, 1481, 1531.', 'lot'),
    ['1472', '1481', '1531'],
  );
  // "or"-separated barcodes, and a continuation list that repeats no label.
  assert.deepEqual(values('The products have a UPC Code of 300871239418 or 300871239456.', 'upc'), [
    '300871239418',
    '300871239456',
  ]);
  assert.deepEqual(
    values('pouches with UPC #199284530959 (4oz) and #199284306226 (12oz).', 'upc'),
    ['199284530959', '199284306226'],
  );
});

test('a label separated from its values by a clause still resolves', () => {
  assert.deepEqual(
    values(
      'The product’s case has one of the following affected lot codes, which is affixed to the case as seen in the below image: 13150423, 13150723, 13151223.',
      'lot',
    ),
    ['13150423', '13150723', '13151223'],
  );
});

test('only real barcode lengths are promoted to a barcode', () => {
  // A package size or a short code near the word UPC must not become one.
  assert.deepEqual(values('16 fl. Oz. bottles; the UPC is 041548610047.', 'upc'), ['041548610047']);
  assert.deepEqual(values('UPC 430 appears on the tub.', 'upc'), []);
});

test('a notice that states there are no codes is source silence, not a parser miss', () => {
  const noCodes = extractProseIdentifiers(
    'The product is sold in 16 fl. Oz. plastic bottles and the labeling does not have any UPC or lot codes.',
  );
  assert.equal(noCodes.statesNoCodes, true);
  const varying = extractProseIdentifiers(
    'The product contains 12 sachets with different expiration dates stamped on the back side.',
  );
  assert.equal(varying.statesNoCodes, true);
  const normal = extractProseIdentifiers('The lot code is 1472.');
  assert.equal(normal.statesNoCodes, false);
});

test('prose product lines carrying inline identifiers become affected versions', () => {
  const lines = extractProseVariantLines(
    'PRIVATE SELECTION FROZEN TRIPLE BERRY MEDLEY, 48 OZ (BEST BY: 07-07-20; UPC: 0001111079120);\nPRIVATE SELECTION FROZEN BLACKBERRIES, 16 OZ (BEST BY: 06-19-20; UPC: 0001111087809)',
  );
  assert.equal(lines.length, 2);
  assert.match(lines[0].name, /TRIPLE BERRY MEDLEY/);
  assert.ok(lines[0].facts.some((f) => f.concept === 'upc' && f.value === '0001111079120'));
  assert.ok(lines[0].facts.some((f) => f.concept === 'best_by'));
  // Ordinary prose is never mistaken for a product line.
  assert.deepEqual(
    extractProseVariantLines('Consumers who purchased the product (see below) should stop.'),
    [],
  );
});

test('prose sentences are never mistaken for identifier values', () => {
  const facts = extractProseIdentifiers(
    'Consumers who have purchased the product with the lot code should stop using it immediately and return it.',
  ).facts;
  assert.deepEqual(facts, []);
});

test('a quoted label with a "dates between/up to" bridge yields one complete span', () => {
  const between = extractProseIdentifiers(
    '13.3-oz. tray packages containing "POWER PLATE MEALS MEATLOAF" and "USE BY" dates between 6/25/26 and 6/10/27.',
  ).facts.filter((fact) => fact.concept === 'use_by');
  assert.deepEqual(
    between.map((fact) => fact.value),
    ['between 6/25/26 and 6/10/27'],
  );
  const upTo = extractProseIdentifiers(
    'Packages with “best by” dates up to January 23, 2022, located next to the barcode.',
  ).facts.filter((fact) => fact.concept === 'best_by');
  assert.deepEqual(
    upTo.map((fact) => fact.value),
    ['up to January 23, 2022'],
  );
});

test('identifiers inside a supplier-recall reference never become this recall’s facts', () => {
  const { facts } = extractProseIdentifiers(
    'The product comes in a clear plastic package marked with a best by date of 11/23/26.\n' +
      'The recall was initiated after notification that Rooted in Rare brand Aquafaba powder with UPC #199284530959 and Best by 12/14/2026 was recalled.',
  );
  assert.ok(facts.some((fact) => fact.value.includes('11/23/26')));
  assert.ok(!facts.some((fact) => fact.value.replace(/\D/g, '').includes('199284530959')));
  assert.ok(!facts.some((fact) => fact.value.includes('12/14/2026')));
});
