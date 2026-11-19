/**
 * Package date identifiers: one marking, one field, its full scope.
 *
 * The regression is the 2026-11-10 Family Farmstead Dairy cheddar recall. Its
 * table has ONE combined column, "Lot Code/Best By Date", whose cells read
 * "All lot codes dated 10/16/27 and prior", and its prose repeats that cutoff
 * as "an expiration date of 10/16/27 and prior". Lotly rendered three fields
 * for each cheese — Best by October 16, 2027; Expiration October 16, 2027;
 * Lot code "dated 10/16/27" — and dropped "and prior" from every one of them,
 * so a shopper holding a package dated 9/1/27 read that it was not recalled.
 *
 * The rules pinned here, each from the source's own evidence rather than the
 * date string alone:
 *
 *   - a trailing cutoff ("and prior", "or later") is meaning, and survives;
 *   - table text the flattener glued onto a prose line is not prose;
 *   - "dated 10/16/27" describes codes by their date and is never a lot code,
 *     while a code that merely looks like a date stays a code;
 *   - prose that restates a table's cutoff under another date name collapses
 *     into the table's field, but two markings the TABLE distinguishes never
 *     do, and neither does a bare date that merely matches;
 *   - a range stays one range.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { projectCase } from '../../domain/projection';
import type { CaseProjection } from '../../domain/recall-types';
import { buildConsumerCase } from '../../lib/consumer-projection';
import { normalizeDateValue } from '../../lib/identifiers';
import { affectedProductsModel, affectedProductsTable } from '../../lib/recall-presentation';
import { parseFdaAnnouncement, type FdaListingItem } from './parse';

interface RecordedAnnouncement {
  officialUrl: string;
  path: string;
  listing: FdaListingItem;
  mainHtml: string;
}

function familyFarmstead(): CaseProjection {
  const recorded: RecordedAnnouncement = JSON.parse(
    readFileSync(
      'src/server/fda/fixtures/announcement-family-farmstead-dairy-cheddar.json',
      'utf8',
    ),
  );
  return projectCase([
    parseFdaAnnouncement({
      listing: recorded.listing,
      detailMainHtml: recorded.mainHtml,
      path: recorded.path,
    }),
  ]);
}

function projection(summaryHtml: string, summaryText: string): CaseProjection {
  return {
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    title: 'Acme Dairy Recalls Cheese',
    summaryText,
    summaryHtml,
    reasonText: null,
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
    recallingFirm: { displayName: 'Acme Dairy', rawVariants: ['Acme Dairy'] },
    brands: [],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    affectedProducts: [],
    quantityText: null,
    illnessStatement: null,
    reportsIllness: false,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fda.gov/x',
    otherOfficialUrls: [],
    sourceIdentifiers: [],
    publishedAt: '2026-11-10',
    lastPublicActivityAt: '2026-11-10',
  };
}

/** What Recall Details shows: each product row as `label → text`. */
function renderedRows(
  source: CaseProjection,
): { name: string | null; cells: Record<string, string | null> }[] {
  const consumer = buildConsumerCase(source, source.affectedProducts);
  const table = affectedProductsTable(affectedProductsModel(consumer.packageCheck, 'Cheese'));
  assert.ok(table, 'the package table renders');
  const labels = new Map(table.expanded.columns.map((column) => [column.key, column.label]));
  return table.expanded.rows.map((row) => ({
    name: row.name,
    cells: Object.fromEntries(
      row.cells
        .filter((cell) => cell.key !== 'product')
        .map((cell) => [labels.get(cell.key) ?? cell.key, cell.text]),
    ),
  }));
}

/** A one-column-pair table plus the prose FDA's flattener produces from it. */
function tableCase(heading: string[], rows: string[][], prose: string): CaseProjection {
  const html = `<table><thead><tr>${heading.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table><p>${prose}</p>`;
  const text = [heading.join('\n'), rows.map((row) => row.join(' ')).join(' '), prose].join('\n');
  return projection(html, text);
}

// ── The regression notice ───────────────────────────────────────────────────

test('Family Farmstead: each cheddar shows ONE package identifier with its full cutoff', () => {
  const rows = renderedRows(familyFarmstead());
  assert.deepEqual(rows, [
    {
      name: 'Raw Mild Cheddar, 8 oz, plastic wrapped',
      cells: { 'Best by': 'October 16, 2027 or earlier' },
    },
    {
      name: 'Raw Sharp Cheddar, 8 oz, plastic wrapped',
      cells: { 'Best by': 'October 16, 2027 or earlier' },
    },
  ]);
});

test('Family Farmstead: the source text and label survive for traceability', () => {
  const source = familyFarmstead();
  // The stored notice is untouched: the cutoff is still in the official words.
  assert.match(source.summaryHtml ?? '', /Lot Code\/Best By Date/);
  assert.match(source.summaryText, /All lot codes dated 10\/16\/27 and prior/);
  assert.match(source.summaryText, /expiration date of 10\/16\/27 and prior/);
  const consumer = buildConsumerCase(source, source.affectedProducts);
  const bestBy = consumer.packageCheck.sharedFields.find((field) => field.key === 'bestBy');
  assert.ok(bestBy);
  assert.deepEqual(bestBy.raw, ['All lot codes dated 10/16/27 and prior']);
  assert.deepEqual(bestBy.canonicalKeys, ['on or before|date:2027-10-16']);
  // No stray lot code and no second date field, anywhere in the checker.
  const everyField = [
    ...consumer.packageCheck.sharedFields,
    ...consumer.packageCheck.fields,
    ...consumer.packageCheck.variants.flatMap((variant) => variant.fields),
  ];
  assert.deepEqual(
    everyField.map((field) => field.key),
    ['bestBy'],
  );
  assert.equal(consumer.packageCheck.lotCodes, null);
});

// ── Repeated date aliases ───────────────────────────────────────────────────

test('a prose restatement of the table cutoff under another date name collapses into it', () => {
  // The same cutoff written two ways — trailing "and prior" in the table,
  // leading "on or before" in the prose — is one cutoff.
  const rows = renderedRows(
    tableCase(
      ['Product', 'Best By'],
      [
        ['Aged Gouda', '10/16/27 and prior'],
        ['Smoked Gouda', '10/16/27 and prior'],
      ],
      'All products with expiration dates on or before October 16, 2027 are being recalled.',
    ),
  );
  for (const row of rows) {
    assert.deepEqual(row.cells, { 'Best by': 'October 16, 2027 or earlier' }, row.name ?? '');
  }
});

// ── Distinct markings that share a date ─────────────────────────────────────

test('two columns the table distinguishes stay two markings, even on the same date', () => {
  const rows = renderedRows(
    tableCase(
      ['Product', 'Best By', 'Expiration Date'],
      [['Aged Gouda', '10/16/27 and prior', '10/16/27 and prior']],
      'Consumers should check their packages.',
    ),
  );
  assert.deepEqual(rows[0].cells, {
    'Best by': 'October 16, 2027 or earlier',
    Expiration: 'October 16, 2027 or earlier',
  });
});

test('a bare prose date that merely matches a table date is not merged into it', () => {
  // "the date string alone" is not evidence that two labels name one marking.
  const consumer = buildConsumerCase(
    tableCase(
      ['Product', 'Best By'],
      [
        ['Aged Gouda', '10/16/27'],
        ['Smoked Gouda', '10/16/27'],
      ],
      'Packages also carry an expiration date of 10/16/27.',
    ),
    [],
  );
  const keys = [...consumer.packageCheck.sharedFields, ...consumer.packageCheck.fields].map(
    (field) => field.key,
  );
  assert.ok(keys.includes('bestBy'), keys.join(','));
  assert.ok(keys.includes('expiration'), keys.join(','));
});

// ── Lot codes ───────────────────────────────────────────────────────────────

test('a genuine date-shaped lot code stays a lot code', () => {
  const rows = renderedRows(
    tableCase(
      ['Product', 'Lot Code', 'Best By'],
      [['Aged Gouda', '101627', '11/30/27']],
      'Consumers should check their packages.',
    ),
  );
  assert.deepEqual(rows[0].cells, { 'Best by': 'November 30, 2027', 'Lot codes': '101627' });
});

test('"lot codes dated 10/16/27" describes a date and is never shown as a lot code', () => {
  const consumer = buildConsumerCase(
    projection(
      '<p>The recall includes all lot codes dated 10/16/27 and prior.</p>',
      'The recall includes all lot codes dated 10/16/27 and prior.',
    ),
    [],
  );
  const values = [...consumer.packageCheck.fields, ...consumer.packageCheck.sharedFields].flatMap(
    (field) => field.values,
  );
  assert.ok(!values.some((value) => /dated/i.test(value)), values.join(' | '));
});

// ── Ranges and qualifiers ───────────────────────────────────────────────────

test('a date range stays one range and is never split into its endpoints', () => {
  const rows = renderedRows(
    tableCase(
      ['Product', 'Best By Date'],
      [['Aged Gouda', '10/1/27 through 10/16/27']],
      'Consumers should check their packages.',
    ),
  );
  assert.deepEqual(rows[0].cells, { 'Best by': 'October 1–October 16, 2027' });
});

test('every cutoff qualifier survives normalization with its own meaning', () => {
  const cases: [string, string, string][] = [
    ['10/16/27 and prior', 'October 16, 2027 or earlier', 'on or before|date:2027-10-16'],
    ['10/16/27 or earlier', 'October 16, 2027 or earlier', 'on or before|date:2027-10-16'],
    ['10/16/27 and before', 'October 16, 2027 or earlier', 'on or before|date:2027-10-16'],
    ['10/16/27 and after', 'October 16, 2027 or later', 'on or after|date:2027-10-16'],
    ['10/16/27 or later', 'October 16, 2027 or later', 'on or after|date:2027-10-16'],
    ['05/27 and prior', 'May 2027 or earlier', 'on or before|month:2027-05'],
    ['through 10/16/27', 'Through October 16, 2027', 'through|date:2027-10-16'],
    [
      'including and prior to 6/27/25',
      'On or before June 27, 2025',
      'on or before|date:2025-06-27',
    ],
    ['prior to 6/27/25', 'Before June 27, 2025', 'before|date:2025-06-27'],
    // "before" alone is exclusive — a different cutoff from "or earlier".
    ['before 10/16/27', 'Before October 16, 2027', 'before|date:2027-10-16'],
  ];
  for (const [raw, display, canonical] of cases) {
    const normalized = normalizeDateValue(raw);
    assert.equal(normalized.display, display, raw);
    assert.equal(normalized.canonical, canonical, raw);
    assert.equal(normalized.raw, raw, raw);
  }
  // A qualifier after a RANGE, or one that opens another date, is left as written.
  assert.equal(normalizeDateValue('10/1/27 - 10/16/27 and prior').canonical, undefined);
});

// ── Brad's Raw Chips (2026-11-03): four variants, eleven lot→date pairs ─────

function bradsRawChips(): CaseProjection {
  const recorded: RecordedAnnouncement = JSON.parse(
    readFileSync(
      'src/server/fda/fixtures/announcement-brads-raw-chips-kale-veggie-chips.json',
      'utf8',
    ),
  );
  return projectCase([
    parseFdaAnnouncement({
      listing: recorded.listing,
      detailMainHtml: recorded.mainHtml,
      path: recorded.path,
    }),
  ]);
}

/** Each rendered row's lots, line-paired with the date printed beside each. */
function lotDatePairs(cells: Record<string, string | null>): string[] {
  const lots = (cells['Lot codes'] ?? '').split('\n');
  const dates = (cells['Best by'] ?? '').split('\n');
  assert.equal(lots.length, dates.length, 'every lot line has exactly one date line');
  return lots.map((lot, index) => `${lot} → ${dates[index]}`);
}

test("Brad's: one recall, four variants, each with its own size, UPC and lot→date pairs", () => {
  const rows = renderedRows(bradsRawChips());
  assert.deepEqual(
    rows.map((row) => [row.name, row.cells['Package Size'], row.cells['Barcode (UPC)']]),
    [
      ["Brad's Crunchy Kale, Original", '2 oz (57 g) bag', '813104021679'],
      ["Brad's Crunchy Kale, Cheeze It Up", '2 oz (57 g) bag', '813104021877'],
      ["Brad's Crunchy Kale, Radical Ranch", '2 oz (57 g) bag', '813104020726'],
      ["Brad's Veggie Chips Kale", '3 oz (85 g) bag', '854615002054'],
    ],
  );
  assert.deepEqual(
    rows.map((row) => lotDatePairs(row.cells)),
    [
      [
        '33525-1 → February 1, 2027',
        '33525-2 → February 1, 2027',
        '33525-3 → February 1, 2027',
        '34525-1 → February 11, 2027',
        '35125-2 → February 17, 2027',
      ],
      ['35025-3 → February 16, 2027'],
      ['29425-1 → December 21, 2026'],
      [
        '33225-3 → January 28, 2027',
        '33325-2 → January 29, 2027',
        '33425-1 → January 30, 2027',
        '33525-1 → February 1, 2027',
      ],
    ],
  );
  // Eleven variant–lot entries in all; 33525-1 is stated under BOTH the
  // Original and the Veggie Chips bullets, and survives under both.
  assert.equal(rows.flatMap((row) => lotDatePairs(row.cells)).length, 11);
  assert.deepEqual(
    rows
      .filter((row) => row.cells['Lot codes']?.split('\n').includes('33525-1'))
      .map((r) => r.name),
    ["Brad's Crunchy Kale, Original", "Brad's Veggie Chips Kale"],
  );
});

test("Brad's: a lot-code fragment never renders as a date, and nothing pools at recall scope", () => {
  const source = bradsRawChips();
  const consumer = buildConsumerCase(source, source.affectedProducts);
  assert.deepEqual(consumer.packageCheck.fields, []);
  assert.deepEqual(consumer.packageCheck.sharedFields, []);
  assert.equal(consumer.packageCheck.lotCodes, null);
  for (const variant of consumer.packageCheck.variants) {
    for (const field of variant.fields) {
      if (field.key !== 'bestBy') continue;
      for (const value of field.values) {
        assert.ok(!/3352/.test(value), `${variant.name ?? ''}: ${value}`);
        assert.ok(normalizeDateValue(value).canonical?.startsWith('date:'), value);
      }
    }
  }
  // Lot codes stay strings with their suffixes.
  const lots = consumer.packageCheck.variants.flatMap(
    (variant) => variant.fields.find((field) => field.key === 'lotCodes')?.values ?? [],
  );
  assert.ok(
    lots.every((lot) => /^\d{5}-\d$/.test(lot)),
    lots.join(', '),
  );
});

// ── Pairing across layouts ──────────────────────────────────────────────────

test('a structured table pairs each row lot with that row date', () => {
  const rows = renderedRows(
    tableCase(
      ['Product', 'Lot Code', 'Best By'],
      [
        ['Aged Gouda', '33525-1', '02/01/2027'],
        ['Smoked Gouda', '34525-1', '02/11/2027'],
      ],
      'Consumers should check their packages.',
    ),
  );
  assert.deepEqual(
    rows.map((row) => [row.name, row.cells['Lot codes'], row.cells['Best by']]),
    [
      ['Aged Gouda', '33525-1', 'February 1, 2027'],
      ['Smoked Gouda', '34525-1', 'February 11, 2027'],
    ],
  );
});

/** Whether a row's lot and date cells are rendered as aligned pairs. */
function pairedCells(source: CaseProjection): boolean[] {
  const consumer = buildConsumerCase(source, source.affectedProducts);
  const table = affectedProductsTable(affectedProductsModel(consumer.packageCheck, 'Cheese'));
  assert.ok(table);
  return table.expanded.rows.map((row) => row.cells.some((cell) => cell.pairGroup !== null));
}

test('a prose sentence binds each grouped lot clause to its own parenthetical date', () => {
  const text =
    'The recalled Aged Gouda carries Lots 11111-1 and 11111-2 (Best By March 3, 2027) and Lot 22222-4 (Best By April 4, 2027).';
  const source = projection(`<p>${text}</p>`, text);
  const rows = renderedRows(source);
  assert.equal(rows.length, 1);
  assert.deepEqual(lotDatePairs(rows[0].cells), [
    '11111-1 → March 3, 2027',
    '11111-2 → March 3, 2027',
    '22222-4 → April 4, 2027',
  ]);
  assert.deepEqual(pairedCells(source), [true]);
});

test('separate lot and date lists with no stated pairing are never paired', () => {
  const text =
    'The recalled products carry lot numbers: 33525-1, 34525-1. Best By dates: February 1, 2027, February 11, 2027.';
  const source = projection(`<p>${text}</p>`, text);
  const rows = renderedRows(source);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells['Best by'], 'February 1, 2027, February 11, 2027');
  assert.equal(rows[0].cells['Lot codes'], '33525-1, 34525-1');
  // Both lists are shown, but as two independent lists: no pairing invented.
  assert.deepEqual(pairedCells(source), [false]);
});

// ── Yellow Dock Root: a headed lot column and a stated container size ───────
//
// Larbi Inc.'s 2026-11-17 notice states its package and lots in prose and one
// HTML list: "Herb To Body Yellow Dock Root C/S 4oz comes in a 4 oz pouch",
// then "The recalled lots are:" over HB02223, HB02474 and HB02848. Lotly
// showed only "can't be shown reliably here yet": the plural "lots" was no
// label, a heading-led column kept at most its first code, and the size
// sentence had no reader.

function yellowDock(): CaseProjection {
  const recorded: RecordedAnnouncement = JSON.parse(
    readFileSync('src/server/fda/fixtures/announcement-larbi-yellow-dock-root.json', 'utf8'),
  );
  return projectCase([
    parseFdaAnnouncement({
      listing: recorded.listing,
      detailMainHtml: recorded.mainHtml,
      path: recorded.path,
    }),
  ]);
}

test('Yellow Dock Root: the 4 oz pouch and all three recalled lots, from the source', () => {
  const source = yellowDock();
  assert.match(source.summaryText, /comes in a 4 oz pouch/);
  assert.match(source.summaryText, /The recalled lots are:\nHB02223\nHB02474\nHB02848\n/);
  assert.deepEqual(
    renderedRows(source).map((row) => row.cells),
    [{ 'Package Size': '4 oz', 'Lot codes': 'HB02223, HB02474, HB02848' }],
  );
});

test('a heading-led column keeps every code and stops at the first line that is not one', () => {
  const text =
    'Lot codes:\nAB1234\nAB1235\nEX 0225\n90 CAPSULES\nAB9999\nNo other lots or products are affected.';
  const rows = renderedRows(projection(`<p>${text}</p>`, text));
  assert.equal(rows[0].cells['Lot codes'], 'AB1234, AB1235, EX 0225');
});

test('the plural "lots" is a label only when a colon hands it off', () => {
  for (const text of [
    'No other lots or products are affected. Lot code: AB1234.',
    'The recalled lots of this product are contained in 127 boxes. Lot code: AB1234.',
    'Additional lots of the beans that have already been recalled include: 24330, 24297. Lot code: AB1234.',
  ]) {
    const rows = renderedRows(projection(`<p>${text}</p>`, text));
    assert.equal(rows[0].cells['Lot codes'], 'AB1234', text);
  }
  const inline = 'The recalled lots are: HB02223, HB02474.';
  assert.equal(
    renderedRows(projection(`<p>${inline}</p>`, inline))[0].cells['Lot codes'],
    'HB02223, HB02474',
  );
});

test('a container sentence states the size only when nothing names another size', () => {
  const sized = (text: string, title = 'Acme Recalls Cheese') => {
    const source = { ...projection(`<p>${text}</p>`, text), title };
    const consumer = buildConsumerCase(source, source.affectedProducts);
    return affectedProductsModel(consumer.packageCheck, 'Cheese')
      .items.flatMap((item) => item.fields)
      .filter((field) => field.key === 'size')
      .map((field) => field.value);
  };
  assert.deepEqual(sized('The cheese comes in a 4 oz pouch. Lot code: AB1234.'), ['4 oz']);
  // Two different stated containers: the notice has not said which one.
  assert.deepEqual(
    sized('The cheese comes in a 4 oz pouch and is also sold in a 16 oz jar. Lot code: AB1234.'),
    [],
  );
  // The headline names another size, so the recall covers more than one.
  assert.deepEqual(
    sized(
      'The spinach is packaged in a 35 lb bag. Lot code: AB1234.',
      'Sno Pac Recalls 35 LB Bulk Frozen Spinach and 10 oz Organic Spinach',
    ),
    [],
  );
  // Not a container: no size.
  assert.deepEqual(sized('The cheese comes in a variety of flavors. Lot code: AB1234.'), []);
});
