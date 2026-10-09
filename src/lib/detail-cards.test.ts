/**
 * The Recall Detail kit's affected-product CARDS (2026-10-07), proven on the
 * pure model: the cards are the table model's rows re-presented, so the row
 * count, order, shared values and strict images are the table's, and each
 * field shows two lines before its own Show more. A verified pair is one
 * indivisible entry — a labelled code over its own labelled date; an undated
 * code is an entry with no date; independent lists are never aligned into
 * pairs.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { CaseProjection } from '@/domain/recall-types';

import {
  affectedProductCards,
  buildDetailModel,
  cardCategoryId,
  cardCategoryLabel,
  type AffectedProductsTableCell,
  type AffectedProductsTableViewModel,
} from './recall-presentation';

function cell(
  key: AffectedProductsTableCell['key'],
  values: string[],
  pairGroup: string | null = null,
): AffectedProductsTableCell {
  return {
    key,
    values,
    text: values.join(', '),
    collapsedText: values.slice(0, 2).join(', '),
    disclosure: null,
    pairGroup,
  };
}

test('a verified pair is one labelled entry; an undated code has no date; two show before Show more', () => {
  const view: AffectedProductsTableViewModel = {
    columns: [
      { key: 'product', label: 'Product' },
      { key: 'bestBy', label: 'Best by' },
      { key: 'upc', label: 'Barcode (UPC)' },
      { key: 'lotCodes', label: 'Lot codes' },
    ],
    rows: [
      {
        id: 'r0',
        name: 'Deluxe Mixed Nuts',
        image: null,
        cells: [
          cell('product', ['Deluxe Mixed Nuts']),
          cell('bestBy', ['July 28, 2026', '', 'August 10, 2026'], 'bestBy+lotCodes'),
          cell('upc', ['077890421314', '077890421352', '077890421369']),
          cell('lotCodes', ['58041', '58999', '58171'], 'bestBy+lotCodes'),
        ],
      },
    ],
  };
  const [card] = affectedProductCards(view);
  assert.equal(card.name, 'Deluxe Mixed Nuts');
  const [pairs, upc] = card.groups;
  // The pair group: whole entries in source order, each code under the
  // singular code label and its own date under the source's date type; the
  // undated code keeps its place with no date — none is borrowed from a
  // neighbour.
  assert.equal(pairs.paired, true);
  assert.deepEqual(pairs.pairs, [
    {
      code: { label: 'Lot code', value: '58041' },
      date: { label: 'Best by', value: 'July 28, 2026' },
    },
    { code: { label: 'Lot code', value: '58999' }, date: null },
    {
      code: { label: 'Lot code', value: '58171' },
      date: { label: 'Best by', value: 'August 10, 2026' },
    },
  ]);
  assert.deepEqual(pairs.collapsedPairs, pairs.pairs?.slice(0, 2));
  // Each entry's spoken text reads the pair together.
  assert.deepEqual(pairs.lines, [
    'Lot code 58041, Best by July 28, 2026',
    'Lot code 58999',
    'Lot code 58171, Best by August 10, 2026',
  ]);
  assert.deepEqual(pairs.collapsedLines, pairs.lines.slice(0, 2));
  assert.equal(pairs.disclosure?.expandLabel, 'Show more');
  assert.equal(pairs.disclosure?.collapseLabel, 'Show less');
  // Spoken: the whole count, and how many lines are actually paired.
  assert.equal(
    pairs.disclosure?.expandAccessibilityLabel,
    'Show all 3 identifiers (2 paired with a date)',
  );
  // The paired date column is absorbed into the entries, never repeated.
  assert.equal(card.groups.filter((group) => group.label === 'Best by').length, 0);
  // An independent list stays its own labelled list with its own control.
  assert.equal(upc.paired, false);
  assert.equal(upc.pairs, null);
  assert.equal(upc.label, 'Barcode (UPC)');
  assert.deepEqual(upc.collapsedLines, ['077890421314', '077890421352']);
  assert.equal(upc.disclosure?.expandAccessibilityLabel, 'Show all 3 barcodes');
  assert.notEqual(upc.id, pairs.id, 'two groups share one expansion state');
});

test('independent lists are never aligned into pairs, and empty fields are omitted', () => {
  const view: AffectedProductsTableViewModel = {
    columns: [
      { key: 'bestBy', label: 'Best by' },
      { key: 'lotCodes', label: 'Lot codes' },
      { key: 'size', label: 'Package Size' },
    ],
    rows: [
      {
        id: 'case',
        name: null,
        image: null,
        cells: [
          cell('bestBy', ['February 21, 2025', 'February 23, 2025']),
          cell('lotCodes', ['LPK1WA046', 'LPK1WA048']),
          cell('size', []),
        ],
      },
    ],
  };
  const [card] = affectedProductCards(view);
  assert.equal(card.name, null);
  assert.deepEqual(
    card.groups.map((group) => [group.label, group.paired, group.pairs, group.lines]),
    [
      ['Best by', false, null, ['February 21, 2025', 'February 23, 2025']],
      ['Lot codes', false, null, ['LPK1WA046', 'LPK1WA048']],
    ],
  );
  assert.ok(card.groups.every((group) => group.disclosure === null));
});

function baselineCase(idPrefix: string): CaseProjection {
  const baseline = JSON.parse(readFileSync('src/content/baseline-recalls.json', 'utf8')) as {
    cases: { item: { id: string }; detail: { projection: CaseProjection } }[];
  };
  const found = baseline.cases.find((entry) => entry.item.id.startsWith(idPrefix));
  assert.ok(found, `baseline case ${idPrefix} missing`);
  return found!.detail.projection;
}

test('recorded cases: cards keep the table row count and order, and the category is the card’s', () => {
  for (const id of ['6c54040d', '080dedcf', '02593a77', '31023a06']) {
    const projection = baselineCase(id);
    const model = buildDetailModel(
      {
        id,
        projection,
        timeline: [],
        affectedProducts: projection.affectedProducts,
        visuals: [],
      },
      { today: '2026-10-07', affectsYou: false },
    );
    const section = model.sections.affectedProducts;
    if (section) {
      for (const view of [section.table.collapsed, section.table.expanded]) {
        const cards = affectedProductCards(view);
        assert.deepEqual(
          cards.map((card) => card.id),
          view.rows.map((row) => row.id),
          `${id}: cards are not the table's rows`,
        );
        // No card group is ever empty, and no line is a placeholder.
        for (const card of cards) {
          for (const group of card.groups) {
            assert.ok(group.lines.length > 0, `${id}: an empty group renders`);
            assert.ok(
              group.lines.every((line) => line.trim() !== '' && line !== '—'),
              `${id}: a placeholder line renders`,
            );
          }
        }
      }
    }
    // The header category is exactly the Feed card's.
    const expected = cardCategoryId(projection.productCategories);
    assert.equal(model.category?.id ?? null, expected, id);
    assert.equal(model.category?.label ?? null, cardCategoryLabel(projection.productCategories));
  }
});

test('recorded Hampton granola: its two verified lot/expiration pairs, whole and in source order', () => {
  const projection = baselineCase('6c54040d');
  const model = buildDetailModel(
    {
      id: '6c54040d',
      projection,
      timeline: [],
      affectedProducts: projection.affectedProducts,
      visuals: [],
    },
    { today: '2026-10-08', affectsYou: false },
  );
  const [card] = affectedProductCards(model.sections.affectedProducts!.table.expanded);
  const pairGroups = card.groups.filter((group) => group.pairs !== null);
  assert.equal(pairGroups.length, 1);
  assert.deepEqual(pairGroups[0].pairs, [
    {
      code: { label: 'Lot code', value: 'HGLC-102125' },
      date: { label: 'Expiration', value: 'October 21, 2026' },
    },
    {
      code: { label: 'Lot code', value: 'HGLC-021326' },
      date: { label: 'Expiration', value: 'February 13, 2027' },
    },
  ]);
  assert.equal(pairGroups[0].disclosure, null, 'two pairs need no Show more');
  // No independent Lot codes or Expiration list repeats the paired values.
  assert.ok(
    card.groups.every(
      (group) => group.pairs !== null || !['Lot codes', 'Expiration'].includes(group.label),
    ),
  );
});
