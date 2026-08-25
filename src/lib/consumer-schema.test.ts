/**
 * The closed consumer schema, asserted as a contract.
 *
 * These tests exist to make a whole class of defect impossible rather than
 * fixed: a source heading, a table column, or a parser heuristic must never be
 * able to introduce a consumer-visible field. Every case here is built from the
 * shape of a real announcement that produced the defect it pins.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CaseProjection } from '@/domain/recall-types';
import {
  aggregateFacts,
  buildConsumerAction,
  buildConsumerCase,
  toPackageFields,
} from './consumer-projection';
import { PACKAGE_FIELD_LABEL, PACKAGE_FIELD_ORDER } from './consumer-schema';
import type { SemanticFact } from './source-tables';

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

const fact = (
  concept: SemanticFact['concept'],
  value: string,
  sourceLabel: string = concept,
): SemanticFact => ({ concept, sourceLabel, value });

/** Every label rendered anywhere in the package checker. */
function labelsOf(consumer: ReturnType<typeof buildConsumerCase>): string[] {
  return [
    ...consumer.packageCheck.fields,
    ...consumer.packageCheck.variants.flatMap((v) => v.fields),
  ].map((field) => field.label);
}

const APPROVED = new Set(Object.values(PACKAGE_FIELD_LABEL));

test('the package field vocabulary is closed and ordered the same way every time', () => {
  assert.deepEqual(
    PACKAGE_FIELD_ORDER.map((key) => PACKAGE_FIELD_LABEL[key]),
    [
      'Best by',
      'Use by',
      'Sell by',
      'Expiration',
      'Size',
      'Packaging',
      'Barcode (UPC)',
      'Lot code',
      'Batch code',
    ],
  );
  // Whatever order the source printed its columns in, the card reads the same.
  const projected = toPackageFields(
    aggregateFacts([
      fact('upc', '041548610047'),
      fact('lot', 'LLA616903'),
      fact('best_by', '30 SEP 2027'),
      fact('package_size', '6 Bars'),
    ]),
  );
  assert.deepEqual(
    projected.fields.map((f) => f.label),
    ['Best by', 'Size', 'Barcode (UPC)', 'Lot code'],
  );
});

test('a concept with no approved field is held back, with its reason recorded', () => {
  // Every one of these was a real consumer-visible row before this pass.
  const projected = toPackageFields(
    aggregateFacts([
      fact('unknown', 'Mild Guacamole Dip, 21211600000', 'Details'),
      fact('item_number', '05410', 'Item Number'),
      fact('case_code', '18919', 'Case Code'),
      fact('product_code', '767533-20097', 'Product Code'),
      fact('package_color', 'Blue, yellow, and green', 'Package Color'),
      fact('establishment_number', '13410325396', 'Establishment Number'),
      fact('quantity', '3240 packs', 'Quantity Recalled'),
      fact('package_size', '14 oz (397 g)', 'Package Size'),
    ]),
  );
  // Only the one approved field survives.
  assert.deepEqual(
    projected.fields.map((f) => f.label),
    ['Size'],
  );
  // …and nothing is lost: each rejection keeps its concept, its source label,
  // its values, and why it was declined.
  const byConcept = new Map(projected.rejected.map((r) => [r.concept, r]));
  assert.equal(byConcept.get('unknown')?.reason, 'unsupported-consumer-field');
  assert.equal(byConcept.get('item_number')?.reason, 'unsupported-consumer-field');
  assert.equal(byConcept.get('case_code')?.reason, 'unsupported-consumer-field');
  assert.equal(byConcept.get('product_code')?.reason, 'unsupported-consumer-field');
  assert.equal(byConcept.get('quantity')?.reason, 'wrong-destination');
  assert.deepEqual(byConcept.get('case_code')?.values, ['18919']);
});

test('Whole Foods prepared foods: a residual product blob cannot become a field', () => {
  // Source shape: a table whose only usable column is a Best By window, beside
  // a cell packing product names and codes together. The blob rendered as
  // "Details: Mild Guacamole Dip, 21211600000…" before the schema closed.
  const html = `<table><thead><tr><th>Product</th><th>Best By</th></tr></thead><tbody>
    <tr><td>Mild Guacamole Dip, 21211600000, Pico de Gallo, 21211600001</td><td>8/7/26</td></tr>
    <tr><td>Mild Guacamole Dip, 21211600000, Pico de Gallo, 21211600001</td><td>8/16/26</td></tr>
  </tbody></table>`;
  const consumer = buildConsumerCase(projection({ summaryHtml: html }), []);
  for (const label of labelsOf(consumer)) {
    assert.ok(APPROVED.has(label), `unapproved field label rendered: ${label}`);
  }
  assert.ok(!labelsOf(consumer).includes('Details'));
  // What survives is the date window a person can actually check.
  const dates = [
    ...consumer.packageCheck.fields,
    ...consumer.packageCheck.variants.flatMap((v) => v.fields),
  ]
    .filter((f) => f.key === 'bestBy')
    .flatMap((f) => f.values);
  assert.ok(dates.includes('August 7, 2026'), dates.join(' | '));
  assert.ok(dates.includes('August 16, 2026'), dates.join(' | '));
});

test('the package checker hides itself when nothing useful survives the schema', () => {
  // Source shape: a Retailer/Address table plus two bare product names — a lot
  // of source data, none of it package identification. Two hundred store
  // addresses rendered as one "Details" row before this.
  const html = `<table><tbody>
      <tr><td>Product Description</td><td>Sold After</td></tr>
      <tr><td>Rich’s Milk Chocolate Mini Peanut Butter Cups</td><td>November 11, 2021</td></tr>
    </tbody></table>
    <table><tbody>
      <tr><td>Retailer</td><td>Address</td></tr>
      <tr><td>Kitchen Kneads</td><td>3030 Grant Ave Ogden Ut 84401</td></tr>
      <tr><td>2 B Sweet</td><td>706 S Delaware St Conrad Mt 59425</td></tr>
    </tbody></table>`;
  const consumer = buildConsumerCase(projection({ summaryHtml: html }), []);
  assert.equal(consumer.packageCheck.render, false);
  assert.deepEqual(consumer.packageCheck.fields, []);
  // The store data is not lost — it belongs to "Where it was sold".
  assert.ok(consumer.distribution.retailers.includes('Kitchen Kneads'));
  assert.deepEqual(consumer.distribution.retailLocations, [
    '3030 Grant Ave Ogden Ut 84401',
    '706 S Delaware St Conrad Mt 59425',
  ]);
});

test('a version missing a value omits the line rather than changing the layout', () => {
  // Motor City shape: one version states a size, the other does not.
  const html = `<table><thead><tr><th>Product</th><th>Sell By</th><th>Size</th><th>UPC</th></tr></thead><tbody>
    <tr><td>Detroit Style Pepperoni Pizza</td><td>10/14/26</td><td>21 oz</td><td>075706002015</td></tr>
    <tr><td>Detroit Style Cheese Pizza</td><td>10/16/26</td><td></td><td>075706002022</td></tr>
  </tbody></table>`;
  const consumer = buildConsumerCase(projection({ summaryHtml: html }), []);
  const [pepperoni, cheese] = consumer.packageCheck.variants;
  assert.deepEqual(
    pepperoni.fields.map((f) => f.label),
    ['Sell by', 'Size', 'Barcode (UPC)'],
  );
  // The missing size simply is not there; nothing is invented in its place.
  assert.deepEqual(
    cheese.fields.map((f) => f.label),
    ['Sell by', 'Barcode (UPC)'],
  );
  assert.equal(cheese.fields.find((f) => f.key === 'sellBy')?.value, 'October 16, 2026');
});

test('an explicit UPC survives as a barcode, and its store locations reach distribution', () => {
  // Kimchi shape: the notice labels three retailer-assigned codes "UPC", and
  // lists the six Zion Market addresses that carried the product.
  const summaryText = [
    'The product was sold at the following Zion Market locations:',
    '2751 Beverly Blvd, Los Angeles, CA 90057',
    '9440 Garden Grove Blvd, Garden Grove, CA 92844',
    '',
    'UPC: 8541200408',
    'UPC: 8541200409',
  ].join('\n');
  const consumer = buildConsumerCase(
    projection({
      summaryText,
      retailerNames: ['Zion Market'],
      geography: {
        scope: 'states',
        states: ['California', 'Georgia', 'Texas'],
        confidence: 'stated',
        sourceText: null,
      },
    }),
    [],
  );
  const upc = consumer.packageCheck.fields.find((f) => f.key === 'upc');
  assert.equal(upc?.label, 'Barcode (UPC)');
  assert.deepEqual(upc?.values, ['8541200408', '8541200409']);
  assert.equal(consumer.distribution.areaText, 'California, Georgia, and Texas.');
  assert.deepEqual(consumer.distribution.retailers, ['Zion Market']);
  assert.equal(consumer.distribution.retailLocations.length, 2);
  // The specific evidence is never compressed into the generic shop word.
  assert.deepEqual(consumer.distribution.channels, []);
});

test('named stores in a sentence are retailers, not "Distribution not specified."', () => {
  // Frankie's shape: two chains named with the states they operate in, plus a
  // generic tail the notice adds after them.
  const consumer = buildConsumerCase(
    projection({
      summaryText:
        'The product was distributed to PCC Markets in Washington, Earth Fare Stores in Florida and South Carolina, and select independent retailers.',
      geography: {
        scope: 'states',
        states: ['Washington', 'Florida', 'South Carolina'],
        confidence: 'stated',
        sourceText: null,
      },
    }),
    [],
  );
  // States render alphabetically, whatever order the source's clause used.
  assert.equal(consumer.distribution.areaText, 'Florida, South Carolina, and Washington.');
  assert.equal(consumer.distribution.unspecified, false);
  // The retailer → state relationships the clause stated survive internally.
  const pcc = consumer.distribution.coverage.find((entry) => entry.retailer === 'PCC Markets');
  assert.deepEqual(pcc?.states, ['Washington']);
  const earthFare = consumer.distribution.coverage.find(
    (entry) => entry.retailer === 'Earth Fare Stores',
  );
  assert.deepEqual(earthFare?.states, ['Florida', 'South Carolina']);
  assert.ok(
    consumer.distribution.retailers.includes('PCC Markets'),
    consumer.distribution.retailers.join(' | '),
  );
  assert.ok(
    consumer.distribution.retailers.includes('Earth Fare Stores'),
    consumer.distribution.retailers.join(' | '),
  );
});

test('an incomplete source instruction never reaches "What you should do"', () => {
  // The exact Sun Noodle fragment: stripping the lot clause used to swallow
  // the instruction, leaving a sentence that tells the reader nothing.
  const fragment = buildConsumerAction(
    projection({ consumerAction: 'Consumers who have purchased Sura Tanmen' }),
  );
  assert.equal(fragment.origin, 'app');
  assert.equal(
    fragment.text,
    'We recommend that you do not eat this product. If your package matches the recall, throw it away.',
  );

  // The same sentence, complete, keeps the source's meaning — including the
  // "original place of purchase" wording an exact-phrase match used to miss.
  const whole = buildConsumerAction(
    projection({
      consumerAction:
        'Consumers who have purchased Sura Tanmen with lot code 1226183 are urged not to consume the product and to return it to the original place of purchase for a full refund.',
    }),
  );
  assert.equal(whole.origin, 'source');
  assert.match(whole.text, /Return it to the place of purchase for a refund\./);
});

test('every fact has one destination, and the schema is what enforces it', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryHtml: `<table><thead><tr><th>Product</th><th>Best By</th><th>UPC</th><th>Quantity Recalled</th><th>Retailer</th></tr></thead>
        <tbody><tr><td>Tomato Bisque Soup Kit</td><td>8/22/26</td><td>194346474004</td><td>3240 packs</td><td>Walmart</td></tr></tbody></table>`,
      geography: { scope: 'states', states: ['Texas'], confidence: 'stated', sourceText: null },
    }),
    [],
  );
  const variant = consumer.packageCheck.variants[0];
  // Package identification: dates and barcodes, nothing else.
  assert.deepEqual(
    variant.fields.map((f) => f.label),
    ['Best by', 'Barcode (UPC)'],
  );
  // How much was recalled lives in What happened, formatted to be read.
  assert.equal(consumer.quantityText, '3,240 packs');
  assert.ok(!variant.fields.some((f) => /3,?240/.test(f.value)));
  // The retailer lives in Where it was sold.
  assert.deepEqual(consumer.distribution.retailers, ['Walmart']);
  assert.ok(!variant.fields.some((f) => /Walmart/.test(f.value)));
  // And the state never appears in a package card.
  assert.ok(!variant.fields.some((f) => /Texas/.test(f.value)));
});
