/**
 * The Recall Detail kit's affected-product CARDS (2026-10-07), proven on the
 * pure model: the cards are the table model's rows re-presented, so the row
 * count, order, shared values and strict images are the table's, and each
 * field shows two lines before its own Show more. A verified pair group is
 * grouped by date — each date once, over exactly its own codes; undated
 * codes are a final entry with no date; independent lists are never aligned into
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
  // The pair group, grouped by date (2026-10-18): each date with exactly its
  // own codes under the singular label for one code; the undated code is its
  // own entry with no date — none is borrowed from a neighbour.
  assert.equal(pairs.paired, true);
  assert.deepEqual(pairs.pairs, [
    {
      codes: { label: 'Lot code', values: ['58041'] },
      date: { label: 'Best by', value: 'July 28, 2026' },
    },
    {
      codes: { label: 'Lot code', values: ['58171'] },
      date: { label: 'Best by', value: 'August 10, 2026' },
    },
    { codes: { label: 'Lot code', values: ['58999'] }, date: null },
  ]);
  assert.deepEqual(pairs.collapsedPairs, pairs.pairs?.slice(0, 2));
  // Each entry's spoken text reads its codes and date together.
  assert.deepEqual(pairs.lines, [
    'Lot code 58041, Best by July 28, 2026',
    'Lot code 58171, Best by August 10, 2026',
    'Lot code 58999',
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
      codes: { label: 'Lot code', values: ['HGLC-102125'] },
      date: { label: 'Expiration', value: 'October 21, 2026' },
    },
    {
      codes: { label: 'Lot code', values: ['HGLC-021326'] },
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

// ── Date-grouped pair entries (2026-10-18) ──────────────────────────────────

/** One product row whose code and date halves are one verified pair group. */
function pairRow(
  id: string,
  name: string,
  codes: string[],
  dates: string[],
  extra: AffectedProductsTableCell[] = [],
): AffectedProductsTableViewModel['rows'][number] {
  return {
    id,
    name,
    image: null,
    cells: [
      cell('product', [name]),
      cell('bestBy', dates, 'bestBy+batchCodes'),
      cell('batchCodes', codes, 'bestBy+batchCodes'),
      ...extra,
    ],
  };
}

function pairView(rows: AffectedProductsTableViewModel['rows']): AffectedProductsTableViewModel {
  return {
    columns: [
      { key: 'product', label: 'Product' },
      { key: 'bestBy', label: 'Best by' },
      { key: 'batchCodes', label: 'Batch codes' },
      { key: 'upc', label: 'Barcode (UPC)' },
      { key: 'size', label: 'Package Size' },
    ],
    rows,
  };
}

/** Every code/date relationship an entry list states, as "code @ date". */
function relations(
  entries: readonly { codes: { values: string[] }; date: { value: string } | null }[],
) {
  return entries.flatMap((entry) =>
    entry.codes.values.map((code) => `${code} @ ${entry.date?.value ?? '-'}`),
  );
}

function pairGroupOf(view: AffectedProductsTableViewModel, index = 0) {
  const group = affectedProductCards(view)[index].groups.find((g) => g.pairs !== null);
  assert.ok(group, 'no pair group');
  return group!;
}

test('many codes sharing one date: the date shows once, over every code, leading zeroes kept', () => {
  const codes = ['LLA618503', 'LLA618603', 'LLA618703', 'LLA618803', 'LLA618903', '007'];
  const group = pairGroupOf(
    pairView([
      pairRow(
        'r0',
        'Black Cherry',
        codes,
        codes.map(() => 'July 31, 2027'),
      ),
    ]),
  );
  assert.deepEqual(group.pairs, [
    {
      codes: { label: 'Batch codes', values: codes },
      date: { label: 'Best by', value: 'July 31, 2027' },
    },
  ]);
  assert.equal(group.lines.length, 1);
  assert.equal(group.lines[0], `Batch codes ${codes.join(', ')}, Best by July 31, 2027`);
  // Collapsed: the first two codes under their own date; the control names all six.
  assert.deepEqual(group.collapsedPairs, [
    {
      codes: { label: 'Batch codes', values: codes.slice(0, 2) },
      date: { label: 'Best by', value: 'July 31, 2027' },
    },
  ]);
  assert.equal(group.disclosure?.expandAccessibilityLabel, 'Show all 6 identifier pairs');
});

test('several dates: each date keeps only its own codes, in first-seen order, with no date limit', () => {
  const dates = ['Sep 30, 2027', 'Oct 31, 2027', 'Nov 30, 2027', 'Dec 31, 2027'];
  const codes = ['A1', 'B1', 'A2', 'C1', 'B2', 'D1'];
  const lineDates = [dates[0], dates[1], dates[0], dates[2], dates[1], dates[3]];
  const group = pairGroupOf(pairView([pairRow('r0', 'Strawberry', codes, lineDates)]));
  assert.deepEqual(
    group.pairs?.map((entry) => [entry.date?.value, entry.codes.label, entry.codes.values]),
    [
      [dates[0], 'Batch codes', ['A1', 'A2']],
      [dates[1], 'Batch codes', ['B1', 'B2']],
      [dates[2], 'Batch code', ['C1']],
      [dates[3], 'Batch code', ['D1']],
    ],
  );
  assert.deepEqual(
    [...relations(group.pairs!)].sort(),
    codes.map((code, i) => `${code} @ ${lineDates[i]}`).sort(),
  );
});

test('one code paired with several dates appears under each of them, and nowhere else', () => {
  const group = pairGroupOf(
    pairView([
      pairRow('r0', 'Bars', ['X9', 'X9', 'Y1'], ['May 1, 2027', 'June 1, 2027', 'May 1, 2027']),
    ]),
  );
  assert.deepEqual(relations(group.pairs!), [
    'X9 @ May 1, 2027',
    'Y1 @ May 1, 2027',
    'X9 @ June 1, 2027',
  ]);
  assert.equal(group.disclosure?.expandAccessibilityLabel, 'Show all 3 identifier pairs');
});

test('undated codes stay a final entry with no date, never borrowing a dated neighbour', () => {
  const group = pairGroupOf(
    pairView([pairRow('r0', 'Brownies', ['0101', '0102', '0103'], ['', 'Jan 5, 2027', ''])]),
  );
  assert.deepEqual(group.pairs, [
    {
      codes: { label: 'Batch code', values: ['0102'] },
      date: { label: 'Best by', value: 'Jan 5, 2027' },
    },
    { codes: { label: 'Batch codes', values: ['0101', '0103'] }, date: null },
  ]);
  assert.deepEqual(group.lines, ['Batch code 0102, Best by Jan 5, 2027', 'Batch codes 0101, 0103']);
  assert.equal(
    group.disclosure?.expandAccessibilityLabel,
    'Show all 3 identifiers (1 paired with a date)',
  );
});

test('a true duplicate code/date line is listed once; distinct batches sharing a date are not duplicates', () => {
  const group = pairGroupOf(
    pairView([
      pairRow('r0', 'Bars', ['Q1', 'Q1', 'Q2'], ['Feb 2, 2027', 'Feb 2, 2027', 'Feb 2, 2027']),
    ]),
  );
  assert.deepEqual(group.pairs?.[0].codes.values, ['Q1', 'Q2']);
  assert.equal(group.pairs?.length, 1);
  assert.equal(group.disclosure, null, 'two distinct codes need no Show more');
});

test('separate variants with identical dates or codes stay separate, each with its own UPC and size', () => {
  const view = pairView([
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
  ]);
  const cards = affectedProductCards(view);
  assert.deepEqual(
    cards.map((card) => card.name),
    ['Grape', 'Tangerine'],
  );
  assert.deepEqual(relations(cards[0].groups.find((g) => g.pairs)!.pairs!), [
    'G1 @ Oct 31, 2027',
    'G2 @ Oct 31, 2027',
    'S1 @ Oct 31, 2027',
  ]);
  assert.deepEqual(relations(cards[1].groups.find((g) => g.pairs)!.pairs!), [
    'T1 @ Oct 31, 2027',
    'S1 @ Oct 31, 2027',
  ]);
  assert.deepEqual(
    cards.map((card) => card.groups.find((g) => g.label === 'Barcode (UPC)')?.lines),
    [['041548000114'], ['041548612041']],
  );
  assert.deepEqual(
    cards.map((card) => card.groups.find((g) => g.label === 'Package Size')?.lines),
    [['6 Bars'], ['12 Bars']],
  );
});

test('collapsed shows a prefix of the expanded relationships; expanded states every one exactly once', () => {
  const codes = ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'U1'];
  const lineDates = ['Sep 30', 'Sep 30', 'Sep 30', 'Oct 31', 'Oct 31', 'Nov 30', ''];
  const group = pairGroupOf(pairView([pairRow('r0', 'Watermelon', codes, lineDates)]));
  const expanded = relations(group.pairs!);
  assert.deepEqual(
    [...expanded].sort(),
    codes.map((c, i) => `${c} @ ${lineDates[i] || '-'}`).sort(),
  );
  assert.equal(new Set(expanded).size, expanded.length);
  // Every date heads exactly one entry.
  const heads = group.pairs!.map((entry) => entry.date?.value ?? null);
  assert.equal(new Set(heads).size, heads.length);
  const collapsed = relations(group.collapsedPairs!);
  assert.deepEqual(collapsed, expanded.slice(0, 2));
  assert.deepEqual(group.collapsedLines, ['Batch codes A1, A2, Best by Sep 30']);
  assert.equal(
    group.disclosure?.expandAccessibilityLabel,
    'Show all 7 identifiers (6 paired with a date)',
  );
});
