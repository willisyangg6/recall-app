/**
 * Per-item piece counts and month-precision dates, read by the shared list
 * rules. The regression is the recorded FSIS Public Health Alert
 * PHA-11062026-01 (Betterballen Foods, 2026-11-06), whose product items read
 *
 *   Clear vacuum-packed packages of 6-piece “Bami Rolls” with “BEST BY”
 *   October 2027 and lot codes BR-2026-01 and BR-2026-02.
 *
 * Lotly showed each product's name and lots, but no Package Size and no Best
 * by: the count was stated as an adjective ("6-piece") after "packages of",
 * which the container rule did not read, and the curly-quoted label handed
 * off to its date with only its closing quote. Nothing here matches on the
 * record's id, firm, or product names. The fixture pins shared mechanisms,
 * and the synthetic shapes below (labelled, never displayed or persisted)
 * prove the same rules on source shapes this notice does not have.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { projectCase } from '../../domain/projection';
import { buildConsumerCase } from '../../lib/consumer-projection';
import { normalizeDateValue } from '../../lib/identifiers';
import { extractProseIdentifiers } from '../../lib/prose-identifiers';
import {
  affectedProductCards,
  affectedProductsModel,
  affectedProductsTable,
  caseIdentity,
  CARD_FIELD_ORDER,
  cleanProductName,
} from '../../lib/recall-presentation';
import { extractAffectedProductLists } from '../../lib/source-lists';
import { parseFsisRecord, type FsisRawRecord } from './parse';

function recordedCards(file: string) {
  const raw: FsisRawRecord = JSON.parse(readFileSync(`src/server/fsis/fixtures/${file}`, 'utf8'));
  const projection = projectCase([parseFsisRecord(raw)]);
  const identity = caseIdentity(
    projection.brands ?? [],
    projection.recallingFirm.displayName,
    projection.title,
  );
  const consumer = buildConsumerCase(projection, projection.affectedProducts);
  const productName = cleanProductName({
    title: projection.title,
    productDescription: projection.productDescription ?? null,
    displayedBrands: identity.brand.brands,
    packageEvidence: projection.affectedProducts.map((product) => product.name),
  });
  const table = affectedProductsTable(affectedProductsModel(consumer.packageCheck, productName));
  assert.ok(table, file);
  return affectedProductCards(table.expanded);
}

const lines = (card: ReturnType<typeof recordedCards>[number], id: string) =>
  card.groups.find((group) => group.id === id)?.lines ?? null;

test('recorded PHA-11062026-01: each product keeps its own piece count, month-precision Best by, and lots', () => {
  const cards = recordedCards('pha-attachments-betterballen-pha-11062026-01.json');
  assert.deepEqual(
    cards.map((card) => ({
      name: card.name,
      size: lines(card, 'size'),
      bestBy: lines(card, 'bestBy'),
      lots: lines(card, 'lotCodes'),
    })),
    [
      {
        name: 'Bami Rolls',
        size: ['6 pieces'],
        bestBy: ['October 2027'],
        lots: ['BR-2026-01', 'BR-2026-02'],
      },
      {
        name: 'Saté Kroketten',
        size: ['10 pieces'],
        bestBy: ['October 2027'],
        lots: ['SK-1026-01'],
      },
      {
        name: 'Bitterballen',
        size: ['12 pieces'],
        bestBy: ['October 2027'],
        lots: ['BB-1026-01'],
      },
    ],
  );
  for (const card of cards) {
    // The count is the whole package size: no weight is invented beside it.
    assert.equal(lines(card, 'size')?.length, 1);
    // Month precision stays month precision: no day appears anywhere.
    const text = card.groups.flatMap((group) => group.lines).join(' | ');
    assert.doesNotMatch(text, /\b\d{1,2},\s*2027\b|\b(?:oz|lbs?|g)\b/i, text);
    // Fields keep the standard card order.
    const order = card.groups.map((group) => CARD_FIELD_ORDER.indexOf(group.id));
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    // The container stays packaging evidence, never the product.
    assert.deepEqual(lines(card, 'packaging'), ['Clear vacuum-packed packages']);
  }
});

/** A declared product list in the shape FSIS uses (synthetic, test-only). */
function listOf(...items: string[]) {
  const html = `<p>The following products are subject to the recall:</p><ul>${items
    .map((item) => `<li>${item}</li>`)
    .join('')}</ul>`;
  return extractAffectedProductLists(html).map((variant) => ({
    name: variant.facts.find((f) => f.concept === 'variant')?.value ?? null,
    size: variant.facts.find((f) => f.concept === 'package_size')?.value ?? null,
    packaging: variant.facts.find((f) => f.concept === 'packaging')?.value ?? null,
  }));
}

test('an adjectival count after the container is that item’s package size, across shapes', () => {
  assert.deepEqual(
    listOf(
      'Plastic trays of 24-count “Mini Pierogi” with lot code MP-1.',
      'Cardboard cartons containing 8-piece “Egg Rolls” with lot code ER-2.',
      'Vacuum-sealed bags of 1-piece “Pork Shank” with lot code PS-3.',
    ),
    [
      { name: 'Mini Pierogi', size: '24 count', packaging: 'Plastic trays' },
      { name: 'Egg Rolls', size: '8 pieces', packaging: 'Cardboard cartons' },
      { name: 'Pork Shank', size: '1 piece', packaging: 'Vacuum-sealed bags' },
    ],
  );
});

test('the established "containing N pieces of" shape is unchanged', () => {
  assert.deepEqual(
    listOf(
      'Cardboard boxes containing 100 pieces of “BUFFALO CHICKEN RANGOON” with lot code BC-1.',
      'Cardboard boxes containing 50 pieces of “MOZZARELLA STICK” with lot code MS-2.',
    ),
    [
      { name: 'BUFFALO CHICKEN RANGOON', size: '100 pieces', packaging: 'Cardboard boxes' },
      { name: 'MOZZARELLA STICK', size: '50 pieces', packaging: 'Cardboard boxes' },
    ],
  );
});

test('a hyphenated packaging material is packaging, and the quoted name after "of" is the product', () => {
  assert.deepEqual(
    listOf(
      'Plastic-wrapped packages of “FANCY BOLOGNA” containing undeclared beef.',
      'Shrink-wrapped trays of “TURKEY BOLOGNA” containing undeclared pork.',
    ),
    [
      { name: 'FANCY BOLOGNA', size: null, packaging: 'Plastic-wrapped packages' },
      { name: 'TURKEY BOLOGNA', size: null, packaging: 'Shrink-wrapped trays' },
    ],
  );
});

test('a count is read only where the source states one, for one quoted product', () => {
  const rows = listOf(
    // Several counts with no quoted product after the first: no size.
    'Clear packages of 2-piece and 4-piece Sampler Trays with lot code ST-1.',
    // A product word before the container: the name keeps its head.
    'Gift Baskets of 6-piece “Cookies” with lot code GB-2.',
    // No count at all.
    'Plastic trays of “Plain Pierogi” with lot code PP-3.',
  );
  assert.deepEqual(
    rows.map((row) => row.size),
    [null, null, null],
  );
  assert.equal(rows[2].name, 'Plain Pierogi');
});

const dates = (text: string) =>
  extractProseIdentifiers(text)
    .facts.filter((f) => f.concept !== 'lot')
    .map((f) => [f.concept, f.value]);

test('a quoted date label hands off with its closing quote, at the precision the source states', () => {
  assert.deepEqual(dates('Rolls with “BEST BY” October 2027 and lot code BR-1.'), [
    ['best_by', 'October 2027'],
  ]);
  assert.deepEqual(dates('Rolls with “BEST BY” October 16, 2027 and lot code BR-1.'), [
    ['best_by', 'October 16, 2027'],
  ]);
  assert.deepEqual(dates('Rolls with "Use By" 10/12/26 and lot code BR-1.'), [
    ['use_by', '10/12/26'],
  ]);
  // A month-year value displays as a month-year, never a guessed day.
  assert.equal(normalizeDateValue('October 2027').display, 'October 2027');
  assert.equal(normalizeDateValue('SEP 2026').display, 'September 2026');
});

test('a closing quote with no opening quote is not a label', () => {
  assert.deepEqual(dates('Rolls marked best by” October 2027 on the side.'), []);
});
