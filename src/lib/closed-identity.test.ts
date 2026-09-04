/**
 * Closed value + identity + role goldens, pinned with the live announcements'
 * own source shapes:
 *
 * - Aquafaba: a declared "best buy dates" list produced variants NAMED
 *   "Best by 12/14/2026". The list is an identifier list; the dates are
 *   case-level fields and no variant exists.
 * - Birch Benders: a property list ("Item name : …", "Case item code : …")
 *   produced one variant per row, plus a bullet artifact inside a lot value.
 *   It is one product with fields; case item code stays internal.
 * - Midwest eggs: a "Best By / Sell By Date Between:" table column was
 *   unrouted, so the range leaked from prose as a loose two-date row below
 *   thirty-three cards. It is a range, proven shared, rendered once above.
 * - Pounded Yam: a declared geography list became six variants named
 *   California…Texas, and a truncated expiration range rendered "between
 *   November 2028 through". States go to distribution; the range completes
 *   or nothing renders.
 * - Brown Butter: "Southern California"/"Southern Nevada" rendered as both
 *   areas AND retailers. Geography is one role; Target is the retailer.
 * - FSIS parity: "2028 FE 04" is the Canadian bilingual date on an imported
 *   product (the notice's own production date corroborates February 4), and
 *   "vacuum package" reads as consumer copy through the shared renderer.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CaseProjection } from '@/domain/recall-types';
import { buildConsumerCase } from './consumer-projection';

function projection(overrides: Partial<CaseProjection>): CaseProjection {
  return {
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    title: 'Acme Foods Recalls Widgets',
    summaryText: '',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
    recallingFirm: { displayName: 'Acme Foods', rawVariants: ['Acme Foods'] },
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
    publishedAt: '2026-08-01',
    lastPublicActivityAt: '2026-08-01',
    ...overrides,
  };
}

const AQUAFABA_HTML = `
  <p>The recalled Rooted in Rare brand Aquafaba powder is packaged in 4oz (113g) and (12 oz (340g) flexible foil pouches with UPC #199284530959 (4oz) and #199284306226 (12oz). The following “best buy” dates are included in the recall, which are printed on a sticker and placed on the back bottom left of the product package:</p>
  <ul><li>Best by 12/14/2026</li><li>Best by 12/12/2027</li></ul>`;

test('golden Aquafaba: dates are fields, never variant identities', () => {
  const consumer = buildConsumerCase(
    projection({
      title: '529 Commerce LLC Recalls Rooted in Rare Brand Aquafaba Powder',
      summaryHtml: AQUAFABA_HTML,
      summaryText:
        'The recalled Rooted in Rare brand Aquafaba powder is packaged in 4oz (113g) and (12 oz (340g) flexible foil pouches with UPC #199284530959 (4oz) and #199284306226 (12oz).\nThe following “best buy” dates are included in the recall, which are printed on a sticker and placed on the back bottom left of the product package:\nBest by 12/14/2026\nBest by 12/12/2027',
    }),
    [],
  );
  // No variant is named after a date, and no variants exist at all.
  assert.deepEqual(consumer.packageCheck.variants, []);
  assert.deepEqual(consumer.variantNames, []);
  const bestBy = consumer.packageCheck.fields.find((field) => field.key === 'bestBy');
  assert.ok(bestBy, JSON.stringify(consumer.packageCheck.fields));
  // P3C-1: a structured date cell separates with commas only.
  assert.equal(bestBy.value, 'December 14, 2026, December 12, 2027');
  const upc = consumer.packageCheck.fields.find((field) => field.key === 'upc');
  assert.ok(upc);
  assert.deepEqual(upc.values, ['199284530959', '199284306226']);
});

const BIRCH_HTML = `
  <p>Product was distributed nationwide and sold through grocery, natural food retailers and online channels across the U.S.</p>
  <p>The following product details identify the affected item included in this recall:</p>
  <ul><li><strong>Item name</strong>: Birch Benders 12 oz Sweet Potato Pancake and Waffle Mix</li><li><strong>Case item code</strong>: 8 1000156076 5</li><li><strong>UPC item code</strong>: 8 1000156076 8</li><li><strong>Lot code</strong>: 5 265 • Best-If-Used-By date: MAR 24, 2027</li></ul>`;

test('golden Birch Benders: one clean product structure, approved fields only', () => {
  const consumer = buildConsumerCase(
    projection({
      title:
        'Hometown Food Company Issues Allergy Alert on Undeclared Egg in Birch Benders 12oz Sweet Potato Pancake Mix',
      summaryHtml: BIRCH_HTML,
      summaryText:
        'Product was distributed nationwide and sold through grocery, natural food retailers and online channels across the U.S.\nThe following product details identify the affected item included in this recall:\nItem name : Birch Benders 12 oz Sweet Potato Pancake and Waffle Mix\nCase item code : 8 1000156076 5\nUPC item code : 8 1000156076 8\nLot code : 5 265 • Best-If-Used-By date: MAR 24, 2027',
      geography: { scope: 'nationwide', states: [], confidence: 'inferred', sourceText: null },
    }),
    [],
  );
  // The property list is one product, not four variants — and never a variant
  // named "Item name : …" or "Case item code : …".
  assert.deepEqual(consumer.packageCheck.variants, []);
  assert.deepEqual(consumer.variantNames, []);
  const byKey = new Map(consumer.packageCheck.fields.map((field) => [field.key, field.value]));
  assert.equal(byKey.get('bestBy'), 'March 24, 2027');
  assert.equal(byKey.get('size'), '12 oz');
  assert.equal(byKey.get('upc'), '810001560768');
  // The lot is clean: no bullet artifact, no embedded second label.
  assert.equal(byKey.get('lotCodes'), '5 265');
  // Case item code is preserved internally but never rendered.
  assert.ok(!byKey.has('batchCodes'));
  assert.ok(
    consumer.packageCheck.rejected.some(
      (fact) => fact.concept === 'item_number' && fact.values.includes('8 1000156076 5'),
    ),
    JSON.stringify(consumer.packageCheck.rejected),
  );
});

const EGG_TABLE = `
  <p>The eggs were produced and distributed from farms in Texas between June 6, 2026 and July 3, 2026, with sell by or best by dates between July 20, 2026 and August 17, 2026. The eggs were shipped to foodservice and retail customers in Texas, Oklahoma and Louisiana.</p>
  <table>
    <tr><th>Item Description</th><th>Identifying Code</th><th>UPC</th><th>Best By / Sell By Date&nbsp; Between:</th></tr>
    <tr><td>Kroger Large 12 eggs</td><td>P-1950 or 840962</td><td>011110609038</td><td>July 20 – August 17, 2026</td></tr>
    <tr><td>Kroger Large 18 eggs</td><td>P-1950 or 840962</td><td>011110609335</td><td>July 20 – August 17, 2026</td></tr>
    <tr><td>Grade A Jumbo Bulk 20 eggs</td><td>P-1950</td><td></td><td>July 20 – August 17, 2026</td></tr>
  </table>`;

test('golden eggs: the shared best-by range renders once above the cards, never loosely below', () => {
  const consumer = buildConsumerCase(
    projection({
      title: 'Midwest Poultry Services. L.P. Recalls Shell Eggs',
      summaryHtml: EGG_TABLE,
      summaryText:
        'The eggs were produced and distributed from farms in Texas between June 6, 2026 and July 3, 2026, with sell by or best by dates between July 20, 2026 and August 17, 2026. The eggs were shipped to foodservice and retail customers in Texas, Oklahoma and Louisiana.',
      geography: {
        scope: 'states',
        states: ['Louisiana', 'Oklahoma', 'Texas'],
        confidence: 'inferred',
        sourceText: null,
      },
    }),
    [],
  );
  assert.equal(consumer.packageCheck.variants.length, 3);
  // The range is a RANGE — every date in the window — proven shared by every
  // row, shown once in the shared block.
  assert.deepEqual(
    consumer.packageCheck.sharedFields.map((field) => `${field.label}: ${field.value}`),
    ['Best by: July 20–August 17, 2026'],
  );
  // Nothing loose after the cards, and no per-card repetition.
  assert.deepEqual(consumer.packageCheck.fields, []);
  for (const variant of consumer.packageCheck.variants) {
    assert.ok(variant.fields.every((field) => field.key !== 'bestBy'));
  }
  // Each version still owns its own barcode.
  assert.equal(
    consumer.packageCheck.variants[0].fields.find((field) => field.key === 'upc')?.value,
    '011110609038',
  );
});

const POUNDED_YAM_HTML = `
  <p>This recall includes the following product packaging sizes with the expiration dates between November 2028 through May 2029: 2lbs (0.907kg), 4lbs (1.815kg), 5lbs (2.267kg), and 10lbs (4.53kg). OLA-OLA POUNDED YAM was distributed through distribution outlets in the African and Caribbean markets between December 2025 – May 2026 in Canada, Australia and the following United States:</p>
  <ul><li>California</li><li>Georgia</li><li>Illinois</li><li>New Jersey</li><li>New York</li><li>Texas</li></ul>`;

test('golden Pounded Yam: states are distribution, never variants; the expiration range is complete', () => {
  const consumer = buildConsumerCase(
    projection({
      title: 'Fayus Inc., dba Yusol International Foods Expands Recall of OLA-OLA POUNDED YAM',
      summaryHtml: POUNDED_YAM_HTML,
      summaryText:
        'This recall includes the following product packaging sizes with the expiration dates between November 2028 through May 2029: 2lbs (0.907kg), 4lbs (1.815kg), 5lbs (2.267kg), and 10lbs (4.53kg). OLA-OLA POUNDED YAM was distributed through distribution outlets in the African and Caribbean markets between December 2025 – May 2026 in Canada, Australia and the following United States:\nCalifornia\nGeorgia\nIllinois\nNew Jersey\nNew York\nTexas',
    }),
    [],
  );
  // The geography list never becomes affected versions.
  assert.deepEqual(consumer.packageCheck.variants, []);
  assert.deepEqual(consumer.variantNames, []);
  // The states reach Where It Was Sold.
  assert.deepEqual(consumer.distribution.states, [
    'California',
    'Georgia',
    'Illinois',
    'New Jersey',
    'New York',
    'Texas',
  ]);
  assert.equal(
    consumer.distribution.areaText,
    'California, Georgia, Illinois, New Jersey, New York, and Texas.',
  );
  // The expiration renders as the complete month-granular range — never as
  // "between November 2028 through".
  const expiration = consumer.packageCheck.fields.find((field) => field.key === 'expiration');
  assert.ok(expiration, JSON.stringify(consumer.packageCheck.fields));
  assert.equal(expiration.value, 'November 2028–May 2029');
});

test('golden Brown Butter: regions are areas, Target is the retailer, and never both roles', () => {
  const consumer = buildConsumerCase(
    projection({
      title: 'Bear Stewart LLC Issues Allergy Alert on Undeclared Soy in Bakr Cookie Dough',
      summaryText:
        'The recalled Bakr Brown Butter Chocolate Chunk Ready To Bake Cookie Dough was distributed in Southern California, Southern Nevada, Arizona, and Utah through Target retail stores starting on June 11, 2026.',
      geography: {
        scope: 'states',
        states: ['Arizona', 'California', 'Nevada', 'Utah'],
        confidence: 'inferred',
        sourceText: null,
      },
    }),
    [],
  );
  assert.equal(consumer.distribution.areaText, 'Arizona, California, Nevada, and Utah.');
  assert.deepEqual(consumer.distribution.areas, ['Southern California', 'Southern Nevada']);
  // Geography holds exactly one role.
  assert.deepEqual(consumer.distribution.retailers, ['Target']);
});

const FSIS_SOUP_HTML = `
  <p>The canned condensed chicken noodle soup product was produced on February 4, 2026. The following product is subject to recall [view labels ]:</p>
  <ul><li>10.5-oz can of "tasty KITCHEN Chicken Noodle Condensed Soup PRODUCT OF CANADA" with best by date of "2028 FE 04" and lot code "5 9 2 26 035".</li><li>10.5-oz can of "tasty KITCHEN Chicken Noodle Condensed Soup" with a best before date of "2024 NO 07" and lot code "59222311".</li></ul>`;

test('golden Chicken Noodle FSIS: bilingual month codes normalize to the shared date format', () => {
  const consumer = buildConsumerCase(
    projection({
      sourceAgency: 'FSIS',
      title: 'BCI Foods, Inc. Recalls Chicken Noodle Soup Product',
      summaryHtml: FSIS_SOUP_HTML,
      summaryText:
        'The canned condensed chicken noodle soup product was produced on February 4, 2026. The following product is subject to recall [view labels ]:\n10.5-oz can of "tasty KITCHEN Chicken Noodle Condensed Soup PRODUCT OF CANADA" with best by date of "2028 FE 04" and lot code "5 9 2 26 035".\n10.5-oz can of "tasty KITCHEN Chicken Noodle Condensed Soup" with a best before date of "2024 NO 07" and lot code "59222311".',
    }),
    [],
  );
  const dates = consumer.packageCheck.variants.flatMap((variant) =>
    variant.fields.filter((field) => field.key === 'bestBy').flatMap((field) => field.values),
  );
  assert.deepEqual(dates.sort(), ['February 4, 2028', 'November 7, 2024'].sort());
});

const FSIS_BACON_HTML = `
  <p>The raw, uncured smoked bacon product was produced June 9, 2026. The following products are subject to recall [ view labels ]:</p>
  <ul><li>12-oz vacuum package of "Royale Natural Applewood Smoked ALL NATURAL Uncured Bacon Product of Canada" with sell by dates of "SEP 01 2026" and "SEP 07 2026".</li><li>12-oz vacuum package of "TOP VALU Uncured Hardwood Smoked Bacon PRODUCT OF CANADA" with various sell by dates of "SEP 01 2026".</li></ul>`;

test('golden Royale bacon: FSIS packaging reads as consumer copy through the shared renderer', () => {
  const consumer = buildConsumerCase(
    projection({
      sourceAgency: 'FSIS',
      title: 'Maple Leaf Foods Inc. Recalls Bacon Product',
      summaryHtml: FSIS_BACON_HTML,
      summaryText: 'The raw, uncured smoked bacon product was produced June 9, 2026.',
    }),
    [],
  );
  const packaging = [
    ...consumer.packageCheck.sharedFields,
    ...consumer.packageCheck.variants.flatMap((variant) => variant.fields),
  ].filter((field) => field.key === 'packaging');
  assert.ok(packaging.length > 0, JSON.stringify(consumer.packageCheck));
  for (const field of packaging) {
    assert.match(field.value, /^Vacuum package/);
  }
});
