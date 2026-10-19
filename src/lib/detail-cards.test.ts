/**
 * The Recall Detail kit's affected-product CARDS (2026-10-07), proven on the
 * pure model: the cards are the table model's rows re-presented, so the row
 * count, order, shared values and strict images are the table's. Within a
 * card there is exactly ONE row per field (2026-10-19), in the fixed field
 * order, holding every distinct value the row has for that field — dates and
 * codes as separate rows — showing two values before the field's own control.
 * Independent lists are never aligned into pairs, and the card's separate
 * lists never imply that values at matching positions are paired.
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
  cardGroupStateId,
  CARD_FIELD_ORDER,
  visibleCellState,
  type AffectedProductsTableCell,
  type AffectedProductsTableColumnKey,
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

/** A view whose columns are exactly the keys its cells carry, in that order. */
function viewOf(rows: AffectedProductsTableViewModel['rows']): AffectedProductsTableViewModel {
  const keys = [...new Set(rows.flatMap((row) => row.cells.map((c) => c.key)))];
  return { columns: keys.map((key) => ({ key, label: key })), rows };
}

/** A row whose code and date halves are one verified pair group (index-aligned). */
function pairRow(
  id: string,
  name: string,
  codes: string[],
  dates: string[],
  extra: AffectedProductsTableCell[] = [],
  keys: { date: AffectedProductsTableColumnKey; code: AffectedProductsTableColumnKey } = {
    date: 'bestBy',
    code: 'batchCodes',
  },
): AffectedProductsTableViewModel['rows'][number] {
  const group = `${keys.date}+${keys.code}`;
  return {
    id,
    name,
    image: null,
    cells: [
      cell('product', [name]),
      cell(keys.date, dates, group),
      cell(keys.code, codes, group),
      ...extra,
    ],
  };
}

const summary = (card: ReturnType<typeof affectedProductCards>[number]) =>
  card.groups.map((g) => [g.id, g.label, g.lines, g.collapsedLines, g.disclosure?.expandLabel]);

// ── One row per field, in the fixed order ───────────────────────────────────

test('a verified pair group renders as two separate rows — the dates and the codes — never per pair', () => {
  const [card] = affectedProductCards(
    viewOf([
      pairRow(
        'r0',
        'Deluxe Mixed Nuts',
        ['58041', '58999', '58171'],
        ['July 28, 2026', '', 'August 10, 2026'],
        [cell('upc', ['077890421314', '077890421352', '077890421369'])],
        { date: 'bestBy', code: 'lotCodes' },
      ),
    ]),
  );
  assert.equal(card.name, 'Deluxe Mixed Nuts');
  assert.deepEqual(summary(card), [
    [
      'bestBy',
      'Best by',
      ['July 28, 2026', 'August 10, 2026'],
      ['July 28, 2026', 'August 10, 2026'],
      undefined,
    ],
    [
      'upc',
      'Barcode (UPC)',
      ['077890421314', '077890421352', '077890421369'],
      ['077890421314', '077890421352'],
      'Show all 3 barcodes',
    ],
    [
      'lotCodes',
      'Lot codes',
      ['58041', '58999', '58171'],
      ['58041', '58999'],
      'Show all 3 lot codes',
    ],
  ]);
  // The undated code's empty date line is no date value; no "Lot code" /
  // "Batch code" per-pair entries exist any more.
  assert.ok(card.groups.every((g) => g.lines.every((line) => line !== '')));
  assert.ok(card.groups.every((g) => !/^(Lot|Batch|Production) code$/.test(g.label)));
});

test('exactly one row per field within each product, whatever the cells and representation', () => {
  // The same facts as a pair group, as independent lists, and as a pair
  // group whose cells sit in a different order: one row per field, same
  // labels, same values, same order.
  const codes = ['A1', 'A2', 'A3'];
  const dates = ['Sep 30, 2027', 'Sep 30, 2027', 'Oct 31, 2027'];
  const asPairs = viewOf([pairRow('r0', 'Bars', codes, dates, [cell('upc', ['0415'])])]);
  const asLists = viewOf([
    {
      id: 'r0',
      name: 'Bars',
      image: null,
      cells: [
        cell('product', ['Bars']),
        cell('upc', ['0415']),
        cell('batchCodes', codes),
        cell('bestBy', ['Sep 30, 2027', 'Oct 31, 2027']),
      ],
    },
  ]);
  const shuffled: AffectedProductsTableViewModel = {
    columns: [...asPairs.columns].reverse(),
    rows: asPairs.rows.map((row) => ({ ...row, cells: [...row.cells].reverse() })),
  };
  const expected = [
    [
      'bestBy',
      'Best by',
      ['Sep 30, 2027', 'Oct 31, 2027'],
      ['Sep 30, 2027', 'Oct 31, 2027'],
      undefined,
    ],
    ['upc', 'Barcode (UPC)', ['0415'], ['0415'], undefined],
    ['batchCodes', 'Batch codes', codes, ['A1', 'A2'], 'Show all 3 batch codes'],
  ];
  for (const view of [asPairs, asLists, shuffled]) {
    const [card] = affectedProductCards(view);
    assert.deepEqual(summary(card), expected);
    assert.equal(new Set(card.groups.map((g) => g.id)).size, card.groups.length);
  }
});

test('missing and additional supported fields follow the documented order; the product column is the title', () => {
  assert.deepEqual(
    [...CARD_FIELD_ORDER],
    [
      'size',
      'bestBy',
      'useBy',
      'sellBy',
      'expiration',
      'productionDates',
      'upc',
      'lotCodes',
      'batchCodes',
      'productionCodes',
      'packaging',
    ],
  );
  // Every column, stated in reverse, and one of each kind absent.
  const everyField: AffectedProductsTableViewModel['rows'][number] = {
    id: 'r0',
    name: 'Everything',
    image: null,
    cells: [...CARD_FIELD_ORDER].reverse().map((key) => cell(key, [`${key} value`])),
  };
  const [full] = affectedProductCards(viewOf([everyField]));
  assert.deepEqual(
    full.groups.map((g) => g.id),
    [...CARD_FIELD_ORDER],
  );
  const [sparse] = affectedProductCards(
    viewOf([
      {
        id: 'r1',
        name: 'Some',
        image: null,
        cells: [
          cell('product', ['Some']),
          cell('productionCodes', ['PC1']),
          cell('size', []),
          cell('useBy', ['June 1, 2027']),
          cell('packaging', ['bag']),
          cell('upc', ['123']),
        ],
      },
    ]),
  );
  // Absent fields omitted; the source's own types kept (Use by stays Use by,
  // Production codes stay Production codes) in their documented positions.
  assert.deepEqual(
    sparse.groups.map((g) => [g.id, g.label]),
    [
      ['useBy', 'Use by'],
      ['upc', 'Barcode (UPC)'],
      ['productionCodes', 'Production codes'],
      ['packaging', 'Packaging'],
    ],
  );
});

// ── Values, duplicates and each field's own control ─────────────────────────

test('dates and codes each show two values first, with their own correctly named controls', () => {
  const codes = ['LLA616903', 'LLA617003', 'LLA617103', 'LLA620303', 'LLA621303'];
  const dates = ['Sep 30, 2027', 'Sep 30, 2027', 'Sep 30, 2027', 'Oct 31, 2027', 'Nov 30, 2027'];
  const [card] = affectedProductCards(
    viewOf([
      pairRow('r0', 'Strawberry', codes, dates, [
        cell('size', ['6 Bars']),
        cell('upc', ['041548610047']),
      ]),
    ]),
  );
  const [size, bestBy, upc, batch] = card.groups;
  assert.deepEqual([size.label, size.lines, size.disclosure], ['Package Size', ['6 Bars'], null]);
  assert.deepEqual(bestBy.lines, ['Sep 30, 2027', 'Oct 31, 2027', 'Nov 30, 2027']);
  assert.deepEqual(bestBy.collapsedLines, ['Sep 30, 2027', 'Oct 31, 2027']);
  assert.deepEqual(bestBy.disclosure, {
    expandLabel: 'Show all 3 best by dates',
    collapseLabel: 'Show less',
    expandAccessibilityLabel: 'Show all 3 best by dates',
    collapseAccessibilityLabel: 'Show less, 3 best by dates',
  });
  assert.deepEqual(
    [upc.label, upc.lines, upc.disclosure],
    ['Barcode (UPC)', ['041548610047'], null],
  );
  assert.deepEqual(batch.lines, codes);
  assert.deepEqual(batch.collapsedLines, ['LLA616903', 'LLA617003']);
  assert.equal(batch.disclosure?.expandLabel, 'Show all 5 batch codes');
  assert.equal(batch.disclosure?.collapseAccessibilityLabel, 'Show less, 5 batch codes');
  // A date control is never described with the codes' noun.
  assert.ok(!bestBy.disclosure!.expandLabel.includes('batch'));
});

test('expansion reveals every value and collapse restores exactly the same first two', () => {
  const codes = ['007', '0101', '0101', '0102', '0103', 'Z-9'];
  const [card] = affectedProductCards(
    viewOf([
      pairRow(
        'r0',
        'Brownies',
        codes,
        codes.map(() => 'Jan 5, 2027'),
      ),
    ]),
  );
  const batch = card.groups.find((g) => g.id === 'batchCodes')!;
  const render = (open: boolean) => (open ? batch.lines : batch.collapsedLines);
  const sequence = [false, true, false, true, true, false].map(render);
  assert.deepEqual(sequence[0], ['007', '0101']);
  assert.deepEqual(sequence[1], ['007', '0101', '0102', '0103', 'Z-9']);
  assert.deepEqual(sequence[2], sequence[0]);
  assert.deepEqual(sequence[5], sequence[0]);
  // Collapsed is always a prefix of expanded; leading zeroes survive.
  assert.deepEqual(batch.lines.slice(0, 2), batch.collapsedLines);
  assert.equal(batch.disclosure?.expandLabel, 'Show all 5 batch codes');
});

test('exact duplicate values disappear without losing distinct codes or dates', () => {
  const [card] = affectedProductCards(
    viewOf([
      pairRow(
        'r0',
        'Bars',
        ['Q1', 'Q1', 'Q2', 'X9', 'X9'],
        ['Feb 2, 2027', 'Feb 2, 2027', 'Feb 2, 2027', 'May 1, 2027', 'June 1, 2027'],
        [cell('upc', ['123', '123'])],
      ),
    ]),
  );
  assert.deepEqual(
    card.groups.map((g) => [g.id, g.lines]),
    [
      ['bestBy', ['Feb 2, 2027', 'May 1, 2027', 'June 1, 2027']],
      ['upc', ['123']],
      ['batchCodes', ['Q1', 'Q2', 'X9']],
    ],
  );
  // Date ranges and source wording are values, not something to normalise.
  const [ranged] = affectedProductCards(
    viewOf([pairRow('r1', 'Soup', ['190A26184'], ['July 13–August 11, 2026'])]),
  );
  assert.deepEqual(ranged.groups.find((g) => g.id === 'bestBy')!.lines, [
    'July 13–August 11, 2026',
  ]);
});

test('independent lists are never aligned into pairs, and empty fields are omitted', () => {
  const [card] = affectedProductCards(
    viewOf([
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
    ]),
  );
  assert.equal(card.name, null);
  assert.deepEqual(
    card.groups.map((group) => [group.label, group.lines]),
    [
      ['Best by', ['February 21, 2025', 'February 23, 2025']],
      ['Lot codes', ['LPK1WA046', 'LPK1WA048']],
    ],
  );
  assert.ok(card.groups.every((group) => group.disclosure === null));
});

// ── Expansion identities: per product row and field ─────────────────────────

test('fields and variants expand independently, and hidden products drop their state', () => {
  const cards = affectedProductCards(
    viewOf([
      pairRow(
        'r0',
        'Strawberry',
        ['A1', 'A2', 'A3'],
        ['Sep', 'Oct', 'Nov'],
        [cell('upc', ['1', '2', '3'])],
      ),
      pairRow('r1', 'Grape', ['A1', 'A2', 'A3'], ['Sep', 'Sep', 'Sep']),
    ]),
  );
  const ids = cards.flatMap((card) => card.groups.map((g) => cardGroupStateId(card.id, g.id)));
  // Five groups (Grape's three codes share one date), five distinct
  // identities: the same field on two products, and two fields on one
  // product, never share a state.
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
  const open = new Set([cardGroupStateId('r0', 'batchCodes')]);
  const shown = (cardId: string, groupId: string) => {
    const group = cards.find((c) => c.id === cardId)!.groups.find((g) => g.id === groupId)!;
    return open.has(cardGroupStateId(cardId, groupId)) ? group.lines : group.collapsedLines;
  };
  assert.deepEqual(shown('r0', 'batchCodes'), ['A1', 'A2', 'A3']);
  assert.deepEqual(shown('r0', 'bestBy'), ['Sep', 'Oct']);
  assert.deepEqual(shown('r0', 'upc'), ['1', '2']);
  assert.deepEqual(shown('r1', 'batchCodes'), ['A1', 'A2']);
  // Collapsing See all keeps the still-visible product's states only.
  const all = new Set(ids);
  assert.deepEqual(
    [...visibleCellState(all, ['r0'])].sort(),
    ids.filter((id) => id.startsWith('r0\u0000')).sort(),
  );
  assert.deepEqual([...visibleCellState(all, ['r0', 'r1'])].sort(), [...ids].sort());
});

test('separate variants with identical dates or codes stay separate, each with its own UPC and size', () => {
  const cards = affectedProductCards(
    viewOf([
      pairRow(
        'r0',
        'Grape',
        ['G1', 'G2', 'S1'],
        ['Oct 31, 2027', 'Oct 31, 2027', 'Oct 31, 2027'],
        [cell('upc', ['041548000114']), cell('size', ['6 Bars'])],
      ),
      pairRow(
        'r1',
        'Tangerine',
        ['T1', 'S1'],
        ['Oct 31, 2027', 'Oct 31, 2027'],
        [cell('upc', ['041548612041']), cell('size', ['12 Bars'])],
      ),
    ]),
  );
  assert.deepEqual(
    cards.map((card) => summary(card)),
    [
      [
        ['size', 'Package Size', ['6 Bars'], ['6 Bars'], undefined],
        ['bestBy', 'Best by', ['Oct 31, 2027'], ['Oct 31, 2027'], undefined],
        ['upc', 'Barcode (UPC)', ['041548000114'], ['041548000114'], undefined],
        ['batchCodes', 'Batch codes', ['G1', 'G2', 'S1'], ['G1', 'G2'], 'Show all 3 batch codes'],
      ],
      [
        ['size', 'Package Size', ['12 Bars'], ['12 Bars'], undefined],
        ['bestBy', 'Best by', ['Oct 31, 2027'], ['Oct 31, 2027'], undefined],
        ['upc', 'Barcode (UPC)', ['041548612041'], ['041548612041'], undefined],
        ['batchCodes', 'Batch codes', ['T1', 'S1'], ['T1', 'S1'], undefined],
      ],
    ],
  );
});

// ── Recorded cases ──────────────────────────────────────────────────────────

function baselineCase(idPrefix: string): CaseProjection {
  const baseline = JSON.parse(readFileSync('src/content/baseline-recalls.json', 'utf8')) as {
    cases: { item: { id: string }; detail: { projection: CaseProjection } }[];
  };
  const found = baseline.cases.find((entry) => entry.item.id.startsWith(idPrefix));
  assert.ok(found, `baseline case ${idPrefix} missing`);
  return found!.detail.projection;
}

test('recorded cases: cards keep the table row count and order, one row per field, and the category is the card’s', () => {
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
        for (const card of cards) {
          // One row per field, in the documented order; no empty group, no
          // placeholder line, no duplicate value.
          const keys = card.groups.map((g) => g.id);
          assert.equal(new Set(keys).size, keys.length, `${id}: a field renders twice`);
          assert.deepEqual(
            keys,
            CARD_FIELD_ORDER.filter((key) => keys.includes(key)),
            `${id}: fields out of order`,
          );
          for (const group of card.groups) {
            assert.ok(group.lines.length > 0, `${id}: an empty group renders`);
            assert.equal(new Set(group.lines).size, group.lines.length, `${id}: a duplicate value`);
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

test('recorded Hampton granola: its two lot codes and two expiration dates, complete, as two rows', () => {
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
  assert.deepEqual(
    card.groups.map((g) => [g.id, g.label, g.lines, g.disclosure]),
    [
      ['expiration', 'Expiration', ['October 21, 2026', 'February 13, 2027'], null],
      ['upc', 'Barcode (UPC)', card.groups[1].lines, null],
      ['lotCodes', 'Lot codes', ['HGLC-102125', 'HGLC-021326'], null],
    ],
  );
  assert.equal(card.groups[1].lines.length, 1);
});
