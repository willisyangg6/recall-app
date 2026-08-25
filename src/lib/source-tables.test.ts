import assert from 'node:assert/strict';
import { test } from 'node:test';

import { interpretTable, interpretTables } from './source-tables';

// Shapes reduced from the recorded real announcements.

const TRANSPOSED = `<table><tbody>
<tr><td><strong>Brand Name</strong></td><td>GCB Potato Sourdough Bread</td><td>GCB Potato Sourdough Bread</td></tr>
<tr><td><strong>Generic name</strong></td><td>Potato Market Loaf 20oz</td><td>Mini Potato Loaf 12oz</td></tr>
<tr><td><strong>Sold At</strong></td><td>Sold at grocery stores</td><td>Sold at grocery stores and wholesalers</td></tr>
<tr><td><strong>Intended use</strong></td><td colspan="2">All products are Ready-to-Eat bread</td></tr>
<tr><td><strong>Packaging</strong></td><td>Paper Bag</td><td>No Packaging</td></tr>
<tr><td><strong>Net weight</strong></td><td>20oz</td><td>12oz</td></tr>
<tr><td><strong>UPC</strong></td><td>733163001576</td><td>None</td></tr>
</tbody></table>`;

const STANDARD = `<table><thead>
<tr><th>Product Description</th><th>Package Color</th></tr></thead><tbody>
<tr><td>Prince Sesame Italian Bread, Net Wt. 8 oz (227g)</td><td>Red and yellow</td></tr>
<tr><td>Prince Sesame Long French Bread, Net Wt. 10 oz (284g)</td><td>Red and yellow</td></tr>
</tbody></table>`;

test('a transposed table (labels in the first column) is detected and read per variant', () => {
  const table = interpretTable(TRANSPOSED);
  assert.ok(table);
  assert.equal(table!.orientation, 'transposed');
  // Two product columns → two variants, not eight "products" named after the
  // row labels (the defect this detection exists to prevent).
  assert.equal(table!.variants.length, 2);

  const first = table!.variants[0].facts;
  const concept = (name: string) => first.find((f) => f.concept === name)?.value;
  assert.equal(concept('variant'), 'Potato Market Loaf 20oz');
  assert.equal(concept('package_size'), '20oz');
  assert.equal(concept('packaging'), 'Paper Bag');
  assert.equal(concept('upc'), '733163001576');
  // "Sold At" is routed to distribution, not treated as a package identifier.
  assert.equal(concept('distribution'), 'Sold at grocery stores');
  // A colspan value applies to every variant it covers.
  assert.equal(
    table!.variants[1].facts.find((f) => f.concept === 'intended_use')?.value,
    'All products are Ready-to-Eat bread',
  );
  // Layout-artifact values are dropped, never rendered.
  assert.equal(
    table!.variants[1].facts.find((f) => f.concept === 'upc'),
    undefined,
  );
  assert.equal(
    table!.variants[1].facts.find((f) => f.concept === 'packaging'),
    undefined,
  );
});

test('a standard table (header row) yields one variant per row', () => {
  const table = interpretTable(STANDARD);
  assert.ok(table);
  assert.equal(table!.orientation, 'standard');
  assert.equal(table!.variants.length, 2);
  assert.equal(
    table!.variants[0].facts.find((f) => f.concept === 'variant')?.value,
    'Prince Sesame Italian Bread, Net Wt. 8 oz (227g)',
  );
  assert.equal(
    table!.variants[0].facts.find((f) => f.concept === 'package_color')?.value,
    'Red and yellow',
  );
});

test('non-product tables and empty markup are ignored', () => {
  assert.equal(interpretTable('<table><tr><td>only one row</td></tr></table>'), null);
  assert.deepEqual(interpretTables(null), []);
  assert.deepEqual(interpretTables('<p>no tables here</p>'), []);
});

test('a vertically spanned cell keeps every later row in the right column', () => {
  // Real shape: one barcode covering five lot rows. Read naively, each later
  // row's LOT number slides under the "Item UPC" heading and is presented to a
  // consumer as a barcode.
  const table = `<table><thead><tr><th>Item UPC</th><th>Lot #</th><th>Exp. Date</th></tr></thead>
    <tbody>
      <tr><td rowspan="3">7-56184-10737-9</td><td>0039</td><td>11/2025</td></tr>
      <tr><td>0545</td><td>01/2026</td></tr>
      <tr><td>0640</td><td>02/2026</td></tr>
    </tbody></table>`;
  const rows = interpretTable(table)!.variants;
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.facts.find((f) => f.concept === 'upc')?.value, '7-56184-10737-9');
    assert.ok(row.facts.some((f) => f.concept === 'lot'));
  }
  assert.equal(rows[1].facts.find((f) => f.concept === 'lot')?.value, '0545');
});

test('a date and the codes beside it in one row stay paired', () => {
  const table = `<table><thead><tr><th>Best Used By:</th><th>Lot Code</th></tr></thead>
    <tbody><tr><td>12/04/19</td><td>L18A04A</td></tr>
    <tr><td>12/05/19</td><td>L18A05A</td></tr></tbody></table>`;
  const rows = interpretTable(table)!.variants;
  // The row IS the relationship; column-by-column it becomes two unrelated lists.
  assert.equal(rows[0].facts.find((f) => f.concept === 'lot')?.pairedDate, '12/04/19');
  assert.equal(rows[1].facts.find((f) => f.concept === 'lot')?.pairedDate, '12/05/19');
});

test('a barcode is never paired to a production date', () => {
  const table = `<table><thead><tr><th>Best By</th><th>UPC</th></tr></thead>
    <tbody><tr><td>12/04/19</td><td>071012010509</td></tr></tbody></table>`;
  const rows = interpretTable(table)!.variants;
  // A UPC identifies the product, not the production run.
  assert.equal(rows[0].facts.find((f) => f.concept === 'upc')?.pairedDate, undefined);
});

test('a transposed table can name its versions in the header row', () => {
  const table = `<table><thead><tr><th>Sura Tanmen</th><th>Unit</th><th>Case</th></tr></thead>
    <tbody>
      <tr><td>Item Number</td><td>05410</td><td>05410.1</td></tr>
      <tr><td>UPC</td><td>085315054108</td><td>085315054105</td></tr>
      <tr><td>Net Weight</td><td>15.4 oz</td><td>11.75 lbs</td></tr>
    </tbody></table>`;
  const interpreted = interpretTable(table)!;
  assert.equal(interpreted.orientation, 'transposed');
  assert.deepEqual(
    interpreted.variants.map((v) => v.facts.find((f) => f.concept === 'variant')?.value),
    ['Sura Tanmen (Unit)', 'Sura Tanmen (Case)'],
  );
  // Each pack format keeps its own identifiers instead of merging into one list.
  assert.equal(
    interpreted.variants[0].facts.find((f) => f.concept === 'upc')?.value,
    '085315054108',
  );
  assert.equal(
    interpreted.variants[1].facts.find((f) => f.concept === 'upc')?.value,
    '085315054105',
  );
});

test('a header that carries its own value does not label the cells beneath it', () => {
  // "BEST IF USED BY 09/23/2023" over a column of lot codes. Read as a plain
  // label, those codes become "Best by: 20082D04" — a lot number as a date.
  const table = `<table><tbody>
    <tr><th>BEST IF USED BY<br>09/23/2023</th><th>BEST IF USED BY<br>09/29/2023</th></tr>
    <tr><td>Affected Lot Codes:</td><td>Affected Lot Codes:</td></tr>
    <tr><td>20082D04</td><td>20088D04</td></tr>
  </tbody></table>`;
  const rows = interpretTable(table)!.variants;
  const facts = rows.flatMap((r) => r.facts);
  assert.ok(facts.some((f) => f.concept === 'best_by' && f.value === '09/23/2023'));
  assert.ok(facts.some((f) => f.concept === 'lot' && f.value === '20082D04'));
  assert.ok(!facts.some((f) => f.concept === 'best_by' && /^\d{5}D/.test(f.value)));
  // The column's date reaches the code it stands for.
  assert.equal(
    facts.find((f) => f.concept === 'lot' && f.value === '20088D04')?.pairedDate,
    '09/29/2023',
  );
});

test('a table whose product cells defer to the photos is marked as such', () => {
  const table = `<table><thead><tr><th>Product Packaging</th><th>Batch Code</th><th>UPC</th></tr></thead>
    <tbody>
      <tr><td>See Image Below</td><td>LLA616903</td><td>See Image Below</td></tr>
      <tr><td>See Image Below</td><td>LLA620303</td><td>See Image Below</td></tr>
    </tbody></table>`;
  const interpreted = interpretTable(table)!;
  assert.equal(interpreted.defersToImages, true);
  // …and "See Image Below" itself never becomes a fact.
  assert.ok(!interpreted.variants.flatMap((v) => v.facts).some((f) => /see image/i.test(f.value)));
  // A pointer at a photo is not a field name, so orientation stays standard.
  assert.equal(interpreted.orientation, 'standard');
});

test('every table fact records where it came from and which row it belongs to', () => {
  const table = `<table><thead><tr><th>Product</th><th>UPC</th></tr></thead>
    <tbody><tr><td>Loaf A</td><td>733163001576</td></tr>
    <tr><td>Loaf B</td><td>733163001583</td></tr></tbody></table>`;
  const rows = interpretTable(table)!.variants;
  assert.notEqual(rows[0].scope, rows[1].scope);
  for (const row of rows) {
    for (const fact of row.facts) {
      assert.equal(fact.evidence, 'table');
      assert.equal(fact.scope, row.scope);
    }
  }
});
