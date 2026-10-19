/**
 * Detail correctness B, C and D (2026-10-07), proven end to end against
 * recorded official notices: raw record → parse → projectCase → consumer
 * projection → rendered Detail model.
 *
 *  - B: only verified EXPLICIT pair clauses pair a code with a date — "Lot
 *    code X BEST BY D", "Best If Used By D, Lot# X", "lot code X and best by
 *    D", "Lot X with expiration date of D", and a "Corresponding … Dates" list
 *    of equal length. Independent lists stay independent; position alone
 *    never pairs.
 *  - C: those pairs survive in a set of four or fewer codes, through the same
 *    paired mechanism a long set uses.
 *  - D: a supplier's tested sample, a "Corresponding" date list, and a
 *    customer-service clock time are never lots or batch codes, and a
 *    repeated "Lot " label is not part of a code.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { projectCase } from '../domain/projection';
import type { CaseProjection } from '../domain/recall-types';
import { buildConsumerCase } from '../lib/consumer-projection';
import { affectedProductCards, buildDetailModel } from '../lib/recall-presentation';
import { parseFdaAnnouncement, slugFromPath, type FdaListingItem } from './fda/parse';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';

const corpus: { path: string; listing: FdaListingItem; mainHtml: string }[] = JSON.parse(
  gunzipSync(readFileSync('src/server/fda/fixtures/qa-corpus.json.gz')).toString('utf8'),
);

function fdaCase(fragment: string): CaseProjection {
  const entry = corpus.find((e) => slugFromPath(e.path).includes(fragment));
  assert.ok(entry, `corpus record missing: ${fragment}`);
  return projectCase([
    parseFdaAnnouncement({
      listing: entry!.listing,
      detailMainHtml: entry!.mainHtml,
      path: entry!.path,
    }),
  ]);
}

function fsisCase(recallNumber: string): CaseProjection {
  const records = JSON.parse(
    readFileSync('src/server/fsis/fixtures/benchmark-records.json', 'utf8'),
  ) as { record?: FsisRawRecord }[];
  const raw = records
    .map((entry) => (entry.record ?? entry) as FsisRawRecord)
    .find((entry) => entry.field_recall_number_export === recallNumber);
  assert.ok(raw, `recorded FSIS record ${recallNumber} missing`);
  return projectCase([parseFsisRecord(raw!)]);
}

/** A stored baseline case, for notices recorded only there. */
function baselineCase(idPrefix: string): CaseProjection {
  const baseline = JSON.parse(readFileSync('src/content/baseline-recalls.json', 'utf8')) as {
    cases: { item: { id: string }; detail: { projection: CaseProjection } }[];
  };
  const found = baseline.cases.find((entry) => entry.item.id.startsWith(idPrefix));
  assert.ok(found, `baseline case ${idPrefix} missing`);
  return found!.detail.projection;
}

function packageCheck(projection: CaseProjection) {
  return buildConsumerCase(projection, projection.affectedProducts ?? []).packageCheck;
}

/** The rendered rows: each cell's text and pair group, keyed by column. */
function renderedRows(projection: CaseProjection) {
  const model = buildDetailModel(
    {
      id: 'test',
      projection,
      timeline: [],
      affectedProducts: projection.affectedProducts,
      visuals: [],
    },
    { today: '2026-10-07', affectsYou: false },
  );
  const table = model.sections.affectedProducts?.table.expanded;
  assert.ok(table, 'no affected-products table');
  return table!.rows.map((row) =>
    Object.fromEntries(
      table!.columns.map((column, index) => [
        column.key,
        { text: row.cells[index].text ?? '', pairGroup: row.cells[index].pairGroup },
      ]),
    ),
  );
}

/** Every code/date line a rendered row prints, aligned. */
function renderedPairs(row: ReturnType<typeof renderedRows>[number], dateKey: string) {
  const codeKey = row.batchCodes ? 'batchCodes' : 'lotCodes';
  const codes = row[codeKey].text.split('\n');
  const dates = row[dateKey].text.split('\n');
  assert.equal(row[codeKey].pairGroup, `${dateKey}+${codeKey}`);
  assert.equal(row[dateKey].pairGroup, `${dateKey}+${codeKey}`);
  return codes.map((code, index) => [code, dates[index]]);
}

// ── B + C: explicit pairs reach the projection and the rendered table ───────

test('Sunco "Best If Used By D, Lot# X": each lot keeps its own date, in source order', () => {
  const projection = fdaCase('sunco-frenchie');
  assert.deepEqual(packageCheck(projection).lotCodes?.pairs, [
    { code: 'GRA240602', date: 'August 2025' },
    { code: 'GDR240901', date: 'May 2025' },
  ]);
  const [row] = renderedRows(projection);
  assert.deepEqual(renderedPairs(row, 'bestBy'), [
    ['GRA240602', 'August 2025'],
    ['GDR240901', 'May 2025'],
  ]);
});

test('Mellace "Item / Description": each product owns its own UPC, lot and best-by', () => {
  // The source gives each product its own list item: a bold name and size,
  // then that package's UPC and its "Lot code: X BEST BY: D". Each row holds
  // exactly what its item states — no recall-wide set repeats into either.
  const projection = fdaCase('mellace-family-brands');
  const check = packageCheck(projection);
  assert.equal(check.lotCodes, null);
  assert.deepEqual(check.fields, []);
  const rows = renderedRows(projection).map((row) => ({
    product: row.product.text,
    size: row.size.text,
    upc: row.upc.text,
    lot: row.lotCodes.text,
    bestBy: row.bestBy.text,
  }));
  assert.deepEqual(rows, [
    {
      product: 'Wegmans Deluxe Mixed Nuts Unsalted',
      size: '34 oz (964 grams)',
      upc: '077890421314',
      lot: '58041',
      bestBy: 'July 28, 2026',
    },
    {
      product: 'Wegmans Deluxe Mixed Nuts Unsalted',
      size: '11.5 oz (326 grams)',
      upc: '077890421352',
      lot: '58171',
      bestBy: 'August 10, 2026',
    },
  ]);
});

test('Hampton "Lot X with expiration date of D": both lots paired, no label, no supplier lot', () => {
  const projection = baselineCase('6c54040d');
  const check = packageCheck(projection);
  assert.deepEqual(check.lotCodes?.pairs, [
    { code: 'HGLC-102125', date: 'October 21, 2026' },
    { code: 'HGLC-021326', date: 'February 13, 2027' },
  ]);
  assert.deepEqual(check.lotCodes?.codes, ['HGLC-102125', 'HGLC-021326']);
  const [row] = renderedRows(projection);
  assert.deepEqual(renderedPairs(row, 'expiration'), [
    ['HGLC-102125', 'October 21, 2026'],
    ['HGLC-021326', 'February 13, 2027'],
  ]);
  // The supplier's tested ingredient lot and a "Lot " label never render.
  const text = JSON.stringify(row);
  assert.ok(!text.includes('SO-77820'), text);
  assert.ok(!text.includes('Lot HGLC'), text);
});

test('Nestlé "Batch Numbers … Corresponding Best By Dates": paired batches, no date as a code', () => {
  const projection = fdaCase('nestle-usa-announces-voluntary-recall-limited');
  const check = packageCheck(projection);
  assert.equal(check.lotCodes?.label, 'Batch code');
  assert.deepEqual(check.lotCodes?.pairs, [
    { code: '311457531K', date: 'August 22, 2023' },
    { code: '311557534K', date: 'October 23, 2023' },
  ]);
  const [row] = renderedRows(projection);
  assert.deepEqual(renderedPairs(row, 'bestBy'), [
    ['311457531K', 'August 22, 2023'],
    ['311557534K', 'October 23, 2023'],
  ]);
  assert.ok(!row.batchCodes.text.includes('10/23/23'), row.batchCodes.text);
});

test('Meal Simple "lot code X and best by D": pairs stay inside each product row', () => {
  const projection = fsisCase('PHA-10092020-01');
  const variants = packageCheck(projection).variants;
  const pairsOf = (name: string) =>
    variants.find((variant) => variant.name?.includes(name))?.lotCodes?.pairs;
  // The SAME code carries a different date under each product: only the row
  // boundary keeps them apart.
  assert.deepEqual(pairsOf('Alfredo'), [
    { code: 'TFD279AU23', date: 'October 15, 2020' },
    { code: 'TFD280AU23', date: 'October 16, 2020' },
  ]);
  assert.deepEqual(pairsOf('Pesto'), [
    { code: 'TFD279AU23', date: 'October 13, 2020' },
    { code: 'TDF280AU23', date: 'October 14, 2020' },
  ]);
  const rows = renderedRows(projection);
  const pesto = rows.find((row) => row.product.text.includes('Pesto'));
  assert.ok(pesto);
  assert.deepEqual(renderedPairs(pesto!, 'bestBy'), [
    ['TFD279AU23', 'October 13, 2020'],
    ['TDF280AU23', 'October 14, 2020'],
  ]);
});

// ── B: independent lists stay independent ───────────────────────────────────

for (const [label, load] of [
  ['Maggi "lot codes X and Y"', () => fdaCase('allergy-alert-undeclared-peanut-maggi')],
  ['FSIS 006-2025 "Best By dates of …, and lot codes …"', () => fsisCase('006-2025')],
  [
    'Bettergoods "lot # X or # Y with an expiration date of D or E"',
    () => baselineCase('31023a06'),
  ],
] as const) {
  test(`${label}: no pair is invented`, () => {
    const projection = load();
    const check = packageCheck(projection);
    const sets = [check.lotCodes, ...check.variants.map((variant) => variant.lotCodes)];
    for (const set of sets) assert.deepEqual(set?.pairs ?? [], [], JSON.stringify(set));
    for (const row of renderedRows(projection)) {
      for (const cell of Object.values(row)) assert.equal(cell.pairGroup, null, cell.text);
    }
  });
}

// ── D: fragments that are never lots ────────────────────────────────────────

test('Perrigo: a customer-service clock time never becomes a lot code', () => {
  const projection = fdaCase('perrigo-issues-voluntary-recall-one-batch-premium');
  const text = JSON.stringify(renderedRows(projection));
  assert.ok(!text.includes('M-F from 8'), text);
  assert.ok(!text.includes('00am-5'), text);
  assert.ok(!packageCheck(projection).fields.some((field) => field.key === 'lotCodes'));
});

test('FSIS 046-2019: "all time stamps after 14:30" leaves no "30" lot beside lot 099', () => {
  for (const row of renderedRows(fsisCase('046-2019'))) {
    assert.equal(row.lotCodes.text, '099');
  }
});

// ── C: a pairing that adds nothing stays a plain field ──────────────────────

test("King Arthur: codes all sharing their row's ONE date stay plain, never a repeated date", () => {
  const rows = renderedRows(
    fdaCase('association-adm-milling-co-king-arthur-flour-inc-expands-recall'),
  );
  const multi = rows.find((row) => row.lotCodes.text === 'L18A05A, L18A05B, L18A05C');
  assert.ok(multi, JSON.stringify(rows.map((row) => row.lotCodes.text)));
  assert.equal(multi!.bestBy.text, 'December 5, 2019');
  assert.equal(multi!.lotCodes.pairGroup, null);
});

// ── One row per field in the rendered cards (2026-10-19) ───────────────────

test('Outshine: every variant renders one row per field — its distinct dates, then its distinct codes', () => {
  const projection = fdaCase(
    'dreyers-grand-ice-cream-inc-issues-voluntary-recall-select-outshine-fruit-bars',
  );
  const model = buildDetailModel(
    {
      id: 'test',
      projection,
      timeline: [],
      affectedProducts: projection.affectedProducts,
      visuals: [],
    },
    { today: '2026-10-18', affectsYou: false },
  );
  const view = model.sections.affectedProducts!.table.expanded;
  const cards = affectedProductCards(view);
  assert.equal(cards.length, view.rows.length);
  cards.forEach((card, index) => {
    // Exactly one row per field the table row holds, in the fixed order, and
    // each row's values are exactly the distinct values of that column.
    const labels = card.groups.map((g) => g.label);
    assert.deepEqual(
      labels,
      ['Package Size', 'Best by', 'Barcode (UPC)', 'Batch codes'],
      card.name ?? '',
    );
    for (const group of card.groups) {
      const column = view.rows[index].cells.find((c) => c.key === group.id)!;
      assert.deepEqual(
        group.lines,
        [...new Set(column.values)].filter((v) => v !== ''),
        `${card.name}: ${group.label}`,
      );
      assert.deepEqual(group.collapsedLines, group.lines.slice(0, 2));
    }
  });
  const strawberry = cards.find((card) => /Strawberry/.test(card.name ?? ''))!;
  const [, dates, , codes] = strawberry.groups;
  assert.deepEqual(dates.lines, ['September 30, 2027', 'October 31, 2027', 'November 30, 2027']);
  assert.equal(dates.disclosure?.expandLabel, 'Show all 3 best by dates');
  assert.equal(codes.lines.length, 22);
  assert.equal(new Set(codes.lines).size, 22);
  assert.equal(codes.disclosure?.expandLabel, 'Show all 22 batch codes');
  assert.deepEqual(codes.collapsedLines, ['LLA616903', 'LLA617003']);
  const tangerine = cards.find((card) => /Tangerine/.test(card.name ?? ''))!;
  assert.deepEqual(
    tangerine.groups.map((g) => [g.label, g.lines, g.disclosure]),
    [
      ['Package Size', ['6 Bars'], null],
      ['Best by', ['October 31, 2027'], null],
      ['Barcode (UPC)', ['041548612041'], null],
      ['Batch codes', ['LLA619603', 'LLA619703'], null],
    ],
  );
});
