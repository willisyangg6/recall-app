/**
 * The three in-place disclosures on Recall Detail: the jurisdiction list, the
 * Affected Products rows, and an individual multi-value cell.
 *
 * All three answer the same three questions — how many render first, what the
 * control says, and what expanding does to ORDER — so they are pinned
 * together here rather than scattered through the presentation goldens. The
 * one rule they all share: nothing is reordered, ever. A collapsed list is
 * always a PREFIX of the expanded one, in the source's own sequence, so the
 * first thing a shopper sees is the first thing the agency wrote.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ConsumerDistribution, ConsumerPackageCheck, LotCodeSet } from './consumer-projection';
import { PACKAGE_FIELD_LABEL } from './consumer-schema';
import {
  affectedProductsModel,
  affectedProductsTable,
  AFFECTED_PRODUCTS_INITIAL_ROWS,
  cellStateId,
  disclosureControl,
  homeLocationSummary,
  SHOW_LESS_LABEL,
  visibleCellState,
  whereSoldModel,
  WHERE_SOLD_INITIAL_STATES,
  type AffectedProductsTableCell,
  type AffectedProductsTableViewModel,
} from './recall-presentation';

// ── Fixtures ────────────────────────────────────────────────────────────────

const STATES = [
  'Alabama',
  'California',
  'Delaware',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Kansas',
  'Maine',
  'Nevada',
];

function distribution(overrides: Partial<ConsumerDistribution> = {}): ConsumerDistribution {
  return {
    scopeType: 'states',
    areaText: '',
    states: [],
    areas: [],
    coverage: [],
    retailers: [],
    statedRetailers: [],
    retailersShown: [],
    retailersHidden: 0,
    retailLocations: [],
    onlinePlatforms: [],
    channels: [],
    unspecified: false,
    ...overrides,
  };
}

function soldIn(states: string[]) {
  return whereSoldModel(distribution({ scopeType: 'states', states }));
}

/** A package check with `rows` products, each carrying the given field values. */
function packageCheck(rows: { name: string; values: string[] }[]): ConsumerPackageCheck {
  return {
    render: true,
    scopeStatement: 'Only packages matching the affected details below are part of this recall.',
    variants: rows.map(({ name, values }, index) => ({
      name,
      fields: [
        {
          key: 'bestBy' as const,
          label: PACKAGE_FIELD_LABEL.bestBy,
          value: values.join(', '),
          values,
          raw: values,
          canonicalKeys: values.map((value) => value.toLowerCase()),
        },
      ],
      rejected: [],
      codeLocation: null,
      lotCodes: null,
      photo: null,
      scope: `t0r${index}`,
    })),
    sharedFields: [],
    fields: [],
    rejected: [],
    lotCodes: null,
    productionCodes: null,
    productionDates: null,
    productionDateValues: [],
    codeLocation: null,
    photos: [],
    coverage: 'structured',
    hasIdentifiers: true,
  };
}

function tableOf(rows: { name: string; values: string[] }[]) {
  return affectedProductsTable(affectedProductsModel(packageCheck(rows), 'Product'))!;
}

const bestByCell = (view: AffectedProductsTableViewModel, row: number) => {
  const index = view.columns.findIndex((column) => column.key === 'bestBy');
  assert.notEqual(index, -1, 'no Best by column');
  return view.rows[row].cells[index];
};

// ── The shared control ──────────────────────────────────────────────────────

test('every disclosure words and counts itself the same way', () => {
  const control = disclosureControl(10, 'states');
  assert.equal(control.expandLabel, 'See all (10)');
  assert.equal(control.collapseLabel, 'Show less');
  assert.equal(SHOW_LESS_LABEL, 'Show less');
  // The count is the TOTAL, never the hidden remainder.
  assert.equal(disclosureControl(6, 'states').expandLabel, 'See all (6)');
  // Spoken labels name what is being revealed; a screen-reader user hearing
  // "See all (10)" alone would learn nothing about the ten things.
  assert.equal(control.expandAccessibilityLabel, 'See all 10 states');
  // The collapse label is spoken exactly as it is written, so Voice Control
  // matches what a sighted user would say out loud.
  assert.equal(control.collapseAccessibilityLabel, 'Show less');
});

// ── Part 2: jurisdictions on Detail ─────────────────────────────────────────

test('five jurisdictions render complete, with no action at all', () => {
  assert.equal(WHERE_SOLD_INITIAL_STATES, 5);
  for (let count = 1; count <= WHERE_SOLD_INITIAL_STATES; count += 1) {
    const sold = soldIn(STATES.slice(0, count));
    assert.equal(sold.statesDisclosure, null, `${count} jurisdictions produced a control`);
    // Collapsed and expanded are the same string: there is nothing to reveal.
    assert.equal(sold.leadCollapsed, sold.lead);
  }
  assert.equal(
    soldIn(STATES.slice(0, 5)).lead,
    'Alabama, California, Delaware, Florida, and Georgia',
  );
});

test('six or more jurisdictions show the first five plus See all (N)', () => {
  const six = soldIn(STATES.slice(0, 6));
  assert.equal(six.statesDisclosure?.expandLabel, 'See all (6)');
  assert.equal(six.leadCollapsed, 'Alabama, California, Delaware, Florida, Georgia');
  // No terminal "and" while collapsed: it would assert the list had ended.
  assert.doesNotMatch(six.leadCollapsed, /\band\b/);

  const ten = soldIn(STATES);
  assert.equal(ten.statesDisclosure?.expandLabel, 'See all (10)');
  // Spoken in the consumer word (P2B6C): the list shows states, so the reveal says states.
  assert.equal(ten.statesDisclosure?.expandAccessibilityLabel, 'See all 10 states');
  assert.equal(ten.statesDisclosure?.collapseLabel, 'Show less');
});

test('expanding and collapsing jurisdictions preserves canonical order exactly', () => {
  const sold = soldIn(STATES);
  // Collapsed is a strict PREFIX of expanded, in the notice's own order.
  assert.deepEqual(sold.leadCollapsed.split(', '), STATES.slice(0, 5));
  for (const state of STATES) assert.ok(sold.lead.includes(state), state);
  const expandedOrder = STATES.map((state) => sold.lead.indexOf(state));
  assert.deepEqual(
    [...expandedOrder].sort((a, b) => a - b),
    expandedOrder,
  );
  // The preserved list itself is untouched — collapsing renders less, it
  // never drops or re-sequences a jurisdiction.
  assert.deepEqual(sold.states, STATES);
});

test('nationwide and unspecified distribution are untouched — no control, same lead', () => {
  const nationwide = whereSoldModel(
    distribution({ scopeType: 'nationwide', areaText: 'Nationwide.' }),
  );
  assert.equal(nationwide.lead, 'Nationwide');
  assert.equal(nationwide.leadCollapsed, 'Nationwide');
  assert.equal(nationwide.statesDisclosure, null);

  const unspecified = whereSoldModel(
    distribution({
      scopeType: 'unspecified',
      areaText: 'Distribution was not specified.',
      unspecified: true,
    }),
  );
  assert.equal(unspecified.leadCollapsed, unspecified.lead);
  assert.equal(unspecified.statesDisclosure, null);

  // A stated metro phrase is one sentence, not a list — nothing to reveal.
  const metro = whereSoldModel(
    distribution({ scopeType: 'areas', areaText: 'The Chicago metropolitan area.' }),
  );
  assert.equal(metro.leadCollapsed, metro.lead);
  assert.equal(metro.statesDisclosure, null);
});

test('the Feed card jurisdiction summary is completely unchanged', () => {
  // Home keeps its own far tighter two-code summary; the Detail disclosure
  // does not reach it.
  assert.equal(
    homeLocationSummary({
      scope: 'states',
      states: STATES,
      confidence: 'stated',
      sourceText: null,
    }),
    'AL, CA +8',
  );
  assert.equal(
    homeLocationSummary({
      scope: 'states',
      states: ['Alabama', 'California'],
      confidence: 'stated',
      sourceText: null,
    }),
    'AL, CA',
  );
  assert.equal(
    homeLocationSummary({
      scope: 'nationwide',
      states: [],
      confidence: 'stated',
      sourceText: null,
    }),
    'Nationwide',
  );
  assert.equal(
    homeLocationSummary({ scope: 'unknown', states: [], confidence: 'inferred', sourceText: null }),
    'Distribution not specified',
  );
});

test('retailer presentation is not touched by the jurisdiction disclosure', () => {
  const sold = whereSoldModel(
    distribution({
      scopeType: 'states',
      states: STATES,
      retailers: ['Costco Wholesale', 'Kroger', 'Publix', 'Safeway'],
      statedRetailers: ['Costco Wholesale', 'Kroger', 'Publix', 'Safeway'],
    }),
  );
  assert.equal(sold.retailerCount, 4);
  // P2B7V: the shared list punctuation — the same `joinNames` the
  // jurisdiction list uses, so both read as a sentence.
  assert.equal(sold.retailersNamed, 'Costco Wholesale, Kroger, Publix, and Safeway');
  assert.deepEqual(sold.retailers, ['Costco Wholesale', 'Kroger', 'Publix', 'Safeway']);
});

// ── Part 3: product rows ────────────────────────────────────────────────────

test('one product shows the row normally, with no section-level action', () => {
  const table = tableOf([{ name: 'Strawberry Bars', values: ['June 1, 2027'] }]);
  assert.equal(table.rowsDisclosure, null);
  assert.equal(table.collapsed.rows.length, 1);
  // Collapsed and expanded are the same rendering.
  assert.deepEqual(table.collapsed, table.expanded);
});

test('more than one product renders exactly the first row plus See all (N)', () => {
  assert.equal(AFFECTED_PRODUCTS_INITIAL_ROWS, 1);
  const rows = ['Strawberry', 'Grape', 'Watermelon', 'Black Cherry'].map((name) => ({
    name,
    values: ['June 1, 2027'],
  }));
  const table = tableOf(rows);
  assert.equal(table.initialRows, 1);
  assert.equal(table.collapsed.rows.length, 1);
  assert.equal(table.collapsed.rows[0].name, 'Strawberry');
  assert.equal(table.rowsDisclosure?.expandLabel, 'See all (4)');
  assert.equal(table.rowsDisclosure?.expandAccessibilityLabel, 'See all 4 affected products');
  assert.equal(table.rowsDisclosure?.collapseLabel, 'Show less');
  // Two products already need the control — only ONE product renders without.
  assert.equal(tableOf(rows.slice(0, 2)).rowsDisclosure?.expandLabel, 'See all (2)');
});

test('expanding products shows every row in the original source order', () => {
  const names = ['Strawberry', 'Grape', 'Watermelon', 'Black Cherry', 'Tangerine'];
  const table = tableOf(names.map((name) => ({ name, values: ['June 1, 2027'] })));
  assert.deepEqual(
    table.expanded.rows.map((row) => row.name),
    names,
  );
  // Nothing is sorted by date, code, or anything else this app decided.
  assert.deepEqual(
    table.collapsed.rows.map((row) => row.name),
    [names[0]],
  );
  assert.equal(table.expanded.rows[0].id, table.collapsed.rows[0].id);
});

// ── Part 3: multi-value cells ───────────────────────────────────────────────

test('one or two values in a cell render in full, with no action', () => {
  for (const values of [['June 1, 2027'], ['June 1, 2027', 'June 8, 2027']]) {
    const cell = bestByCell(tableOf([{ name: 'Bars', values }]).expanded, 0);
    assert.equal(cell.disclosure, null, values.join('|'));
    assert.equal(cell.text, values.join(', '));
    assert.equal(cell.collapsedText, cell.text);
    assert.deepEqual(cell.values, values);
  }
});

test('three or more values show the first two plus a cell-local See all (N)', () => {
  const values = ['June 1, 2027', 'June 8, 2027', 'June 15, 2027', 'June 22, 2027'];
  const cell = bestByCell(tableOf([{ name: 'Bars', values }]).expanded, 0);
  assert.equal(cell.disclosure?.expandLabel, 'See all (4)');
  assert.equal(cell.disclosure?.expandAccessibilityLabel, 'See all 4 best by');
  assert.equal(cell.collapsedText, 'June 1, 2027, June 8, 2027');
  // Expanding lands on the projection's own composed wording, unchanged.
  assert.equal(cell.text, values.join(', '));
  assert.deepEqual(cell.values, values);
  // Exactly three values is the first count that discloses.
  const three = bestByCell(tableOf([{ name: 'Bars', values: values.slice(0, 3) }]).expanded, 0);
  assert.equal(three.disclosure?.expandLabel, 'See all (3)');
});

test('a cell discloses only its own field — never a sibling cell or row', () => {
  const table = tableOf([
    { name: 'Strawberry', values: ['A', 'B', 'C', 'D'] },
    { name: 'Grape', values: ['E', 'F'] },
    { name: 'Watermelon', values: ['G', 'H', 'I'] },
  ]);
  const view = table.expanded;
  // Each cell counts its OWN values and nothing else.
  assert.equal(bestByCell(view, 0).disclosure?.expandLabel, 'See all (4)');
  assert.equal(bestByCell(view, 1).disclosure, null);
  assert.equal(bestByCell(view, 2).disclosure?.expandLabel, 'See all (3)');
  // Each cell carries its own column identity, so the screen can key
  // expansion per (row, column) and never expand a sibling.
  for (const row of view.rows) {
    assert.deepEqual(
      row.cells.map((cell) => cell.key),
      view.columns.map((column) => column.key),
    );
  }
  // Row identities are distinct, which is what keeps two cells in the same
  // column independent.
  assert.equal(new Set(view.rows.map((row) => row.id)).size, 3);
});

test('a product-name cell is one value and never discloses', () => {
  const table = tableOf([
    { name: 'A very long product name that is still one single value', values: ['A', 'B', 'C'] },
    { name: 'Second', values: ['D'] },
  ]);
  const product = table.expanded.rows[0].cells[0];
  assert.equal(product.key, 'product');
  assert.equal(product.disclosure, null);
  assert.equal(product.values.length, 1);
});

test('the section and cell disclosures are independent of each other', () => {
  const table = tableOf([
    { name: 'Strawberry', values: ['A', 'B', 'C'] },
    { name: 'Grape', values: ['D', 'E', 'F'] },
  ]);
  // The row control exists because there are two rows; the cell controls
  // exist because each field holds three values. Neither implies the other.
  assert.equal(table.rowsDisclosure?.expandLabel, 'See all (2)');
  assert.equal(bestByCell(table.collapsed, 0).disclosure?.expandLabel, 'See all (3)');
  // And a single-row table with a long cell has a cell control and no row one.
  const single = tableOf([{ name: 'Only', values: ['A', 'B', 'C'] }]);
  assert.equal(single.rowsDisclosure, null);
  assert.equal(bestByCell(single.expanded, 0).disclosure?.expandLabel, 'See all (3)');
});

test('disclosure introduces no new data semantics — no dedupe, no reformat', () => {
  // Duplicates the projection kept are still there, in place, in order.
  const values = ['A', 'A', 'B', 'C'];
  const cell = bestByCell(tableOf([{ name: 'Bars', values }]).expanded, 0);
  assert.deepEqual(cell.values, values);
  assert.equal(cell.collapsedText, 'A, A');
  assert.equal(cell.text, 'A, A, B, C');
});

// ── Identifier pairs ────────────────────────────────────────────────────────

/**
 * A row whose lot codes carry explicit source-stated dates, plus the Best by
 * field those dates live in. `pairs` is the projection's own structure —
 * nothing here infers a relationship from array position.
 */
function pairedCheck(
  pairs: { code: string; date: string }[],
  options: { undatedCodes?: string[]; bestBy?: string[] } = {},
): ConsumerPackageCheck {
  const undated = options.undatedCodes ?? [];
  const codes = [...pairs.map((pair) => pair.code), ...undated];
  const lotCodes: LotCodeSet = { count: codes.length, codes, pairs, label: 'Lot code' };
  const dates = options.bestBy ?? [...new Set(pairs.map((pair) => pair.date))];
  return {
    render: true,
    scopeStatement: 'Only packages matching the affected details below are part of this recall.',
    variants: [
      {
        name: 'Bonbons',
        fields:
          dates.length === 0
            ? []
            : [
                {
                  key: 'bestBy' as const,
                  label: PACKAGE_FIELD_LABEL.bestBy,
                  value: dates.join(', '),
                  values: dates,
                  raw: dates,
                  canonicalKeys: dates.map((date) => date.toLowerCase()),
                },
              ],
        rejected: [],
        codeLocation: null,
        lotCodes,
        photo: null,
        scope: 't0r0',
      },
    ],
    sharedFields: [],
    fields: [],
    rejected: [],
    lotCodes: null,
    productionCodes: null,
    productionDates: null,
    productionDateValues: [],
    codeLocation: null,
    photos: [],
    coverage: 'structured',
    hasIdentifiers: true,
  };
}

function pairedRow(check: ConsumerPackageCheck) {
  const view = affectedProductsTable(affectedProductsModel(check, 'Bonbons'))!.expanded;
  const at = (key: string): AffectedProductsTableCell => {
    const index = view.columns.findIndex((column) => column.key === key);
    assert.notEqual(index, -1, `no ${key} column`);
    return view.rows[0].cells[index];
  };
  return { view, codes: at('lotCodes'), dates: at('bestBy') };
}

const TWO_PAIRS = [
  { code: 'LLA616903', date: 'September 30, 2027' },
  { code: 'LLA617003', date: 'October 31, 2027' },
];
const FOUR_PAIRS = [
  ...TWO_PAIRS,
  { code: 'LLA617103', date: 'September 30, 2027' },
  { code: 'LLA617203', date: 'November 30, 2027' },
];

test('two known pairs render aligned, with no disclosure control at all', () => {
  const { codes, dates } = pairedRow(pairedCheck(TWO_PAIRS));
  assert.equal(codes.disclosure, null);
  assert.equal(dates.disclosure, null);
  // One group, both halves, same line count — line n is line n's partner.
  assert.equal(codes.pairGroup, 'bestBy+lotCodes');
  assert.equal(dates.pairGroup, codes.pairGroup);
  assert.deepEqual(codes.values, ['LLA616903', 'LLA617003']);
  assert.deepEqual(dates.values, ['September 30, 2027', 'October 31, 2027']);
  assert.equal(codes.collapsedText, 'LLA616903\nLLA617003');
  assert.equal(dates.collapsedText, 'September 30, 2027\nOctober 31, 2027');
});

test('three or more known pairs initially show exactly two complete pairs', () => {
  const { codes, dates } = pairedRow(pairedCheck(FOUR_PAIRS));
  assert.equal(codes.disclosure?.expandLabel, 'See all (4)');
  assert.equal(codes.collapsedText, 'LLA616903\nLLA617003');
  assert.equal(dates.collapsedText, 'September 30, 2027\nOctober 31, 2027');
  // Exactly two lines each, and they are the same two pairs on both sides.
  assert.equal(codes.collapsedText!.split('\n').length, 2);
  assert.equal(dates.collapsedText!.split('\n').length, 2);
  // Three pairs is the first count that discloses.
  const three = pairedRow(pairedCheck(FOUR_PAIRS.slice(0, 3)));
  assert.equal(three.codes.disclosure?.expandLabel, 'See all (3)');
});

test('expanding reveals every pair, in source order, on both sides at once', () => {
  const { codes, dates } = pairedRow(pairedCheck(FOUR_PAIRS));
  assert.deepEqual(
    codes.values,
    FOUR_PAIRS.map((pair) => pair.code),
  );
  assert.deepEqual(
    dates.values,
    FOUR_PAIRS.map((pair) => pair.date),
  );
  // The expanded text is the same lines in the same order on both halves.
  assert.deepEqual(
    codes.text!.split('\n'),
    FOUR_PAIRS.map((pair) => pair.code),
  );
  assert.deepEqual(
    dates.text!.split('\n'),
    FOUR_PAIRS.map((pair) => pair.date),
  );
  // A repeated date keeps its own line beside its own code: four codes state
  // three distinct days, and the cell shows four lines, not three.
  assert.equal(dates.values.length, 4);
  assert.equal(new Set(dates.values).size, 3);
});

test('both paired columns expand and collapse together — one shared state key', () => {
  const { codes, dates } = pairedRow(pairedCheck(FOUR_PAIRS));
  // The control is one object, carried identically by both halves.
  assert.deepEqual(codes.disclosure, dates.disclosure);
  // And the screen's state key is identical for both, so there is no
  // representable state in which one is open and the other is not.
  assert.equal(cellStateId('t0r0', codes), cellStateId('t0r0', dates));
  // An ordinary cell still gets its own per-column key.
  const plain = tableOf([{ name: 'Bars', values: ['A', 'B', 'C'] }]).expanded.rows[0];
  const keys = plain.cells.map((cell) => cellStateId('t0r0', cell));
  assert.equal(new Set(keys).size, keys.length);
});

test('a date containing a comma survives as ONE value', () => {
  const { dates } = pairedRow(pairedCheck(FOUR_PAIRS));
  // Line-joined, never comma-joined — the exact reason a pair group cannot
  // reuse the ordinary comma rendering.
  for (const value of dates.values) assert.match(value, /^[A-Z][a-z]+ \d+, \d{4}$/);
  assert.equal(dates.values[0], 'September 30, 2027');
  assert.ok(!dates.text!.includes(', September'), 'a date was comma-joined with its neighbour');
  assert.equal(dates.text!.split('\n').length, dates.values.length);
});

test('no pair is invented: unrelated arrays never group, whatever their length', () => {
  // Same shapes, same counts — but the Best by column holds dates the pairs
  // never name, so nothing proves the two columns are one statement.
  const mismatched = pairedCheck(FOUR_PAIRS, { bestBy: ['January 1, 2030', 'January 2, 2030'] });
  const { codes, dates } = pairedRow(mismatched);
  assert.equal(codes.pairGroup, null);
  assert.equal(dates.pairGroup, null);
  // Both keep their ordinary independent behaviour; nothing is lost.
  assert.equal(codes.collapsedText, 'LLA616903, LLA617003');
  assert.deepEqual(dates.values, ['January 1, 2030', 'January 2, 2030']);

  // A code set with NO pairs at all never groups either, however suggestive
  // the neighbouring column's length looks.
  const unpaired = pairedCheck([], {
    undatedCodes: ['A1', 'A2', 'A3'],
    bestBy: ['June 1, 2027', 'June 2, 2027', 'June 3, 2027'],
  });
  const plain = pairedRow(unpaired);
  assert.equal(plain.codes.pairGroup, null);
  assert.equal(plain.dates.pairGroup, null);
});

test('unpaired multi-value fields keep their independent disclosure', () => {
  // A non-paired row behaves exactly as before: comma-joined, its own
  // control, its own count, on each field separately.
  const unpaired = pairedCheck([], {
    undatedCodes: ['A1', 'A2', 'A3', 'A4'],
    bestBy: ['June 1, 2027', 'June 2, 2027', 'June 3, 2027'],
  });
  const { codes, dates } = pairedRow(unpaired);
  assert.equal(dates.disclosure?.expandLabel, 'See all (3)');
  assert.equal(dates.disclosure?.expandAccessibilityLabel, 'See all 3 best by');
  assert.equal(dates.collapsedText, 'June 1, 2027, June 2, 2027');
  assert.equal(codes.disclosure?.expandLabel, 'See all (4)');
  assert.equal(codes.collapsedText, 'A1, A2');
  // Two independent controls, not one.
  assert.notDeepEqual(codes.disclosure, dates.disclosure);
  assert.notEqual(cellStateId('t0r0', codes), cellStateId('t0r0', dates));
});

test('mixed paired and unpaired evidence drops nothing and implies nothing', () => {
  const check = pairedCheck(TWO_PAIRS, { undatedCodes: ['NODATE1', 'NODATE2'] });
  const { codes, dates } = pairedRow(check);
  // Every code survives — the two paired ones first, then the undated ones.
  assert.deepEqual(codes.values, ['LLA616903', 'LLA617003', 'NODATE1', 'NODATE2']);
  // An undated code's partner renders EMPTY. It is never given a date, and
  // never borrows a sibling pair's.
  assert.deepEqual(dates.values, ['September 30, 2027', 'October 31, 2027', '', '']);
  assert.equal(codes.values.length, dates.values.length);
  // The control counts what it reveals, and says how many of those are pairs
  // rather than letting the word "pairs" cover the undated codes.
  assert.equal(codes.disclosure?.expandLabel, 'See all (4)');
  assert.equal(
    codes.disclosure?.expandAccessibilityLabel,
    'See all 4 identifiers (2 paired with a date)',
  );
});

test('collapsing the product rows resets hidden rows’ disclosure state', () => {
  const sep = String.fromCharCode(0);
  const open = new Set([
    `t0r0${sep}bestBy+lotCodes`,
    `t0r0${sep}upc`,
    `t0r1${sep}bestBy+lotCodes`,
    `t0r2${sep}lotCodes`,
  ]);
  // Only the first row survives a collapse, so only its entries do — and a
  // pair group's single entry is kept or dropped as one thing.
  assert.deepEqual([...visibleCellState(open, ['t0r0'])].sort(), [
    `t0r0${sep}bestBy+lotCodes`,
    `t0r0${sep}upc`,
  ]);
  assert.deepEqual([...visibleCellState(open, [])], []);
  // Expanding again keeps every visible row's state.
  assert.equal(visibleCellState(open, ['t0r0', 't0r1', 't0r2']).size, 4);
});

test('accessibility labels distinguish a pair control from an ordinary field', () => {
  const paired = pairedRow(pairedCheck(FOUR_PAIRS)).codes.disclosure!;
  const ordinary = bestByCell(
    tableOf([{ name: 'Bars', values: ['June 1, 2027', 'June 8, 2027', 'June 15, 2027'] }]).expanded,
    0,
  ).disclosure!;
  assert.equal(paired.expandAccessibilityLabel, 'See all 4 identifier pairs');
  assert.equal(ordinary.expandAccessibilityLabel, 'See all 3 best by');
  assert.notEqual(paired.expandAccessibilityLabel, ordinary.expandAccessibilityLabel);
  // Both still collapse with the one collapse word.
  assert.equal(paired.collapseLabel, SHOW_LESS_LABEL);
  assert.equal(ordinary.collapseLabel, SHOW_LESS_LABEL);
});
