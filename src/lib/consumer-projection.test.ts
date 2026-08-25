import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CaseProjection } from '@/domain/recall-types';
import {
  aggregateFacts,
  buildConsumerAction,
  buildConsumerCase,
  buildDistribution,
  extractRetailerListBlock,
  extractRetailLocationBlock,
  joinFactValues,
  joinValues,
  parseProseFacts,
  parseProseVariants,
  proseOutsideTables,
} from './consumer-projection';
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
  sourceLabel = concept,
): SemanticFact => ({
  concept,
  sourceLabel,
  value,
});

test('repeated source values are deduplicated and aggregated into one concept row', () => {
  // The real Potato Sourdough shape: three near-identical packaging rows and
  // three net-weight rows, two of which are the same value.
  const grouped = aggregateFacts([
    fact('packaging', 'Paper Bag'),
    fact('packaging', 'paper bag'),
    fact('packaging', 'No Packaging'),
    fact('package_size', '20oz'),
    fact('package_size', '20oz'),
    fact('package_size', '12oz'),
  ]);
  const packaging = grouped.find((g) => g.concept === 'packaging')!;
  const size = grouped.find((g) => g.concept === 'package_size')!;
  assert.deepEqual(packaging.values, ['Paper Bag']); // case variant + artifact removed
  assert.deepEqual(size.values, ['20 oz', '12 oz']);
  assert.equal(joinValues(size.values), '20 oz and 12 oz');
  assert.equal(joinValues(['a', 'b', 'c']), 'a, b, and c');
});

test('suppressed concepts and layout artifacts never reach the UI', () => {
  const grouped = aggregateFacts([
    fact('intended_use', 'All products are Ready-to-Eat bread'),
    fact('condition', 'Perishable'),
    fact('shelf_life', '1 day'),
    fact('packaging', 'See Image Below'),
    fact('upc', 'None'),
  ]);
  assert.deepEqual(grouped, []);
});

test('identifiers are ordered by how easily a person can check them', () => {
  const grouped = aggregateFacts([
    fact('lot', 'LLA616903'),
    fact('upc', '628634442166'),
    fact('package_size', '3oz'),
    fact('best_by', '2026 AUGUST 31'),
    fact('variant', 'Veggie Chips'),
  ]);
  // Version, then date, then size, then barcode, then lot code.
  assert.deepEqual(
    grouped.map((g) => g.concept),
    ['variant', 'best_by', 'package_size', 'upc', 'lot'],
  );
  // Dates and barcodes are normalized for comparison against a package.
  assert.deepEqual(grouped.find((g) => g.concept === 'best_by')!.values, ['August 31, 2026']);
});

test('labeled prose blocks parse, including a label split across a line break', () => {
  // Verbatim Momchipz formatting: "Best Before" is broken by a newline, so
  // "Best" lands at the end of the UPC value in the source text.
  const facts = parseProseFacts(
    'Brand: Momchipz\nProduct: Veggie Chips – Broccoli Florets & Cauliflower\nSize: 3oz (85 g)\nUPC: 6 28634 44216 6 Best\nBefore: 2026 AUGUST 31',
  );
  const value = (concept: string) => facts.find((f) => f.concept === concept)?.value;
  assert.equal(value('brand'), 'Momchipz');
  assert.equal(value('package_size'), '3oz (85 g)');
  assert.equal(value('upc'), '6 28634 44216 6'); // the stray "Best" is moved out
  assert.equal(value('best_by'), '2026 AUGUST 31');
});

test('affected versions stated in prose are extracted without bloating What happened', () => {
  const names = parseProseVariants(
    'Products affected include Outshine Strawberry, Watermelon, Grape, Tangerine and Black Cherry 6-Count 2.5 ounce Fruit Bars and the Outshine 24-Count 2.5 ounce Variety Pack Fruit Bars.',
  );
  assert.ok(names.includes('Watermelon'), names.join(' | '));
  assert.ok(names.includes('Grape'));
  // A decimal inside a size must not truncate the list.
  assert.ok(
    names.some((n) => /Black Cherry 6-Count 2\.5 ounce/.test(n)),
    names.join(' | '),
  );
  assert.ok(names.some((n) => /Variety Pack/.test(n)));
});

test('distribution aggregates channels and never uses the firm address', () => {
  const potato = buildDistribution(
    projection({
      summaryText:
        'The following products are subject to recall and were sold at grocery stores, select restaurants, wholesalers, and four Grand Central Bakery Café locations.',
    }),
    [
      fact('distribution', 'Sold at grocery stores'),
      fact(
        'distribution',
        'Sold direct to customers at Grand Central Bakery Cafés and wholesalers',
      ),
      fact('distribution', 'Sold at grocery stores and wholesalers'),
    ],
  );
  // Broad routes worth naming survive; the generic shop word never does,
  // because it says only that a food was sold in shops.
  assert.deepEqual(potato.channels, ['wholesalers', 'restaurants', 'cafés']);
  assert.equal(potato.retailers.length, 0);

  // Ecommerce distribution, with the firm's own country never used.
  const momchipz = buildDistribution(
    projection({
      summaryText:
        'August 14, 2026, Exotique Foods Inc in Ontario , Canada is recalling Momchipz Veggie Chips because it may contain undeclared gluten.\nThe Momchipz Veggie Chips was sold to 49 U.S. customers through Amazon.com between March 2026 and June 2026',
    }),
    [],
  );
  assert.deepEqual(momchipz.onlinePlatforms, ['Amazon.com']);
  assert.equal(momchipz.areaText, '');
  assert.equal(momchipz.states.length, 0);
});

test('unknown distribution stops at the honest statement — never an external referral', () => {
  const unknown = buildDistribution(
    projection({ summaryText: 'The firm issued a press release.' }),
    [],
  );
  assert.equal(unknown.areaText, 'Distribution not specified.');
  assert.equal(unknown.unspecified, true);
  assert.doesNotMatch(unknown.areaText, /notice|fda\.gov|check/i);
});

test('consumer action always exists, and an app recommendation is labeled as ours', () => {
  // No source instruction → our cautious recommendation, in our voice.
  const fallback = buildConsumerAction(projection({ hazardCategory: 'microbial_contamination' }));
  assert.equal(fallback.origin, 'app');
  assert.equal(
    fallback.text,
    'We recommend that you do not eat this product. If your package matches the recall, throw it away.',
  );
  assert.doesNotMatch(fallback.text, /notice|FDA/i);

  // Source instruction wins and keeps its meaning.
  const sourced = buildConsumerAction(
    projection({
      consumerAction:
        'Consumers should not consume the product and should return it to the place of purchase for a full refund.',
    }),
  );
  assert.equal(sourced.origin, 'source');
  assert.match(sourced.text, /Return it to the place of purchase for a refund\./);
});

test('undeclared-allergen actions address the people actually at risk', () => {
  const allergen = buildConsumerAction(
    projection({ hazardCategory: 'allergen', pathogenOrAllergen: 'undeclared milk and sesame' }),
  );
  assert.equal(
    allergen.text,
    'If you are allergic or sensitive to milk or sesame, do not eat this product. If your package matches the recall, throw it away.',
  );
  // A source instruction is scoped to the at-risk group rather than replaced.
  const sourced = buildConsumerAction(
    projection({
      hazardCategory: 'allergen',
      pathogenOrAllergen: 'undeclared soybean',
      consumerAction:
        'Consumers are urged to return it to the place of purchase for a full refund.',
    }),
  );
  assert.match(sourced.text, /^If you are allergic or sensitive to soy, /);
  assert.match(sourced.text, /place of purchase/);
});

test('lot specifics never clutter the always-visible action', () => {
  const action = buildConsumerAction(
    projection({
      consumerAction:
        'Consumers who have purchased Bakr Brown Butter Chocolate Chunk Cookie Dough with lot number 2606022 are urged to return it to the place of purchase for a full refund.',
    }),
  );
  assert.doesNotMatch(action.text, /2606022/);
  assert.match(action.text, /place of purchase/);
});

test('a value one version owns is not restated as a recall-wide identifier', () => {
  // The real Potato Sourdough shape: the table gives the UPC in the Market
  // Loaf row only. Repeating it below the version cards would assert a
  // recall-wide relationship the source never made, and a shopper holding a
  // Mini Potato Loaf would match on it wrongly.
  const html = `<table><tbody>
    <tr><td>Generic name</td><td>Potato Market Loaf 20oz</td><td>Mini Potato Loaf 12oz</td></tr>
    <tr><td>Packaging</td><td>Paper Bag</td><td>No Packaging</td></tr>
    <tr><td>Net weight</td><td>20oz</td><td>12oz</td></tr>
    <tr><td>UPC</td><td>733163001576</td><td>None</td></tr>
  </tbody></table>`;
  const consumer = buildConsumerCase(
    projection({ summaryHtml: html, summaryText: 'UPC 733163001576' }),
    [],
  );
  assert.equal(consumer.packageCheck.variants.length, 2);
  assert.equal(
    consumer.packageCheck.variants[0].fields.find((f) => f.key === 'upc')?.value,
    '733163001576',
  );
  // …and nowhere else, even though the prose repeats it.
  assert.ok(!consumer.packageCheck.fields.some((f) => f.key === 'upc'));
});

test('one date written two ways renders once, with the placement on its own', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryText: 'Best Before: 2026 AUGUST 31',
      summaryHtml:
        '<img src="/files/a.png" width="480" height="728" alt="Momchipz Veggie Chips, Best Before: 2026 AUGUST 31, back of package" />',
    }),
    [],
  );
  const bestBy = consumer.packageCheck.fields.find((f) => f.key === 'bestBy');
  assert.deepEqual(bestBy?.values, ['August 31, 2026']);
  assert.equal(consumer.packageCheck.codeLocation?.text, 'On the back of the package.');
});

test('distribution is structured concepts, never a copied source sentence', () => {
  const sun = buildDistribution(
    projection({
      summaryText:
        'The recalled Sura Tanmen, lot #1226183, was distributed exclusively in the state of Hawaii through the following retail supermarkets and food distributors between July 9 and July 29, 2026:\nDon Don Donki Kapolei Store\nH-Mart Kakaako, LLC\nNijiya Market Ala Moana Store\n',
      geography: { scope: 'states', states: ['Hawaii'], confidence: 'stated', sourceText: null },
    }),
    [],
  );
  // The place, the stores, and nothing else. The source sentence carrying the
  // lot number and the shipping window cannot reach this section at all.
  assert.equal(sun.areaText, 'Hawaii.');
  assert.ok(sun.retailers.includes('Don Don Donki Kapolei Store'), sun.retailers.join(' | '));
  assert.ok(sun.retailers.includes('H-Mart Kakaako, LLC'), sun.retailers.join(' | '));
  const everything = [sun.areaText, ...sun.retailers, ...sun.channels].join(' ');
  assert.doesNotMatch(everything, /1226183|July/);
});

test('a store address is surfaced only when its row also names the store', () => {
  const row = (scope: string, name: string, address: string): SemanticFact[] => [
    { concept: 'distribution', sourceLabel: 'Retailer', value: name, scope },
    { concept: 'retail_location', sourceLabel: 'Address', value: address, scope },
  ];
  const withStore = buildDistribution(
    projection({}),
    row('t0r0', 'Kitchen Kneads', '3030 Grant Ave Ogden Ut 84401'),
  );
  assert.deepEqual(withStore.retailLocations, ['3030 Grant Ave Ogden Ut 84401']);
  assert.deepEqual(withStore.retailers, ['Kitchen Kneads']);

  // A lone address in a company-information table is the FIRM's, not a store's.
  const firmOnly = buildDistribution(projection({}), [
    {
      concept: 'retail_location',
      sourceLabel: 'Address',
      value: '888 Magnolia Avenue, Elizabeth, NJ 07201',
      scope: 't1r0',
    },
  ]);
  assert.deepEqual(firmOnly.retailLocations, []);
});

test('a block of store addresses becomes a location disclosure, not distribution prose', () => {
  assert.deepEqual(
    extractRetailLocationBlock(
      'The product was sold at the following Zion Market locations:\n2751 Beverly Blvd, Los Angeles, CA\n9440 Garden Grove Blvd, Garden Grove, CA\n',
    ),
    ['2751 Beverly Blvd, Los Angeles, CA', '9440 Garden Grove Blvd, Garden Grove, CA'],
  );
});

test('a block of named stores is read as retailers, and a block of places is not', () => {
  assert.deepEqual(
    extractRetailerListBlock(
      'Other grocery stores in Seattle/Tacoma area in WA:\nCentral Co-op\nFred Meyer Stores\nPCC Markets\n',
    ),
    ['Central Co-op', 'Fred Meyer Stores', 'PCC Markets'],
  );
  // "Café locations in Seattle area" lists neighborhoods, which are geography.
  assert.deepEqual(
    extractRetailerListBlock(
      'Grand Central Bakery café locations in Seattle area in WA:\nBurien, Eastlake, Wallingford\n',
    ),
    [],
  );
});

test('an identifier packed inside another field is split out, not left merged', () => {
  const html = `<table><thead><tr><th>Product</th><th>Size</th></tr></thead>
    <tbody><tr><td>Yocrunch Strawberry</td><td>6 Oz (UPC 046675000105)</td></tr>
    <tr><td>Yocrunch Vanilla</td><td>6 Oz (UPC 046675000792)</td></tr></tbody></table>`;
  const consumer = buildConsumerCase(projection({ summaryHtml: html }), []);
  const first = consumer.packageCheck.variants[0];
  // Both versions state the same size, so it is proven shared and renders
  // once above the cards rather than repeating on each.
  assert.equal(consumer.packageCheck.sharedFields.find((f) => f.key === 'size')?.value, '6 Oz');
  // The barcode stays attached to the version whose row it was printed in.
  assert.equal(first.fields.find((f) => f.key === 'upc')?.value, '046675000105');
});

test('a number the source published as a UPC always reaches the consumer as one', () => {
  // Retailer-assigned codes are shorter than a scannable barcode but are
  // printed on the package exactly as the notice writes them (Publix's
  // 41415-06453, Zion Market's 8541200408). Relabelling them sends a shopper
  // looking for a field their package does not carry.
  const grouped = aggregateFacts([fact('upc', '41415-06453'), fact('upc', '0 41735 01358 3')]);
  const upc = grouped.find((g) => g.concept === 'upc');
  assert.deepEqual(upc?.values, ['41415-06453', '041735013583']);
  assert.equal(upc?.label, 'Barcode (UPC)');
  assert.ok(!grouped.some((g) => g.concept === 'product_code'));

  // A lot number that a mis-read sentence attached to the word "UPC" is not a
  // barcode: below ten digits it is something else the notice printed nearby.
  assert.ok(!aggregateFacts([fact('upc', '1226183')]).some((g) => g.concept === 'upc'));
});

test('the announcement prose is read without its own tables', () => {
  // summaryText flattens tables into the body, so every cell would otherwise
  // be read twice: once knowing its product row, once not. The second reading
  // is where relationships are lost.
  const html = '<table><tbody><tr><td>UPC</td><td>733163001576</td></tr></tbody></table>';
  const text = 'Sold at grocery stores.\nUPC\n733163001576';
  assert.doesNotMatch(proseOutsideTables(html, text), /733163001576/);
  assert.match(proseOutsideTables(html, text), /Sold at grocery stores/);
  // With no tables, the prose is untouched.
  assert.equal(proseOutsideTables(null, text), text);
});

test('merchandising is not distribution', () => {
  // Bakr: "…comes in an 8-ounce blue package and is sold in the frozen
  // section" describes a shelf, and answers nothing about whether the recall
  // reached a given shopper.
  const consumer = buildConsumerCase(
    projection({
      summaryText:
        'The Bakr Cookie Dough comes in an 8-ounce blue package and is sold in the frozen section.\nThe product was distributed in Arizona, California, Nevada, and Utah.',
      geography: {
        scope: 'states',
        states: ['Arizona', 'California', 'Nevada', 'Utah'],
        confidence: 'stated',
        sourceText: null,
      },
    }),
    [],
  );
  const everything = [
    consumer.distribution.areaText,
    ...consumer.distribution.channels,
    ...consumer.distribution.retailers,
  ].join(' ');
  assert.doesNotMatch(everything, /frozen section/i);
  assert.equal(consumer.distribution.areaText, 'Arizona, California, Nevada, and Utah.');
});

test('one seller is named once, however many ways the notice spells it', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryText:
        'The product was sold at Costco Wholesale nationwide.\nIt was also shipped to Costco stores.',
      geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
      retailerNames: ['Costco Wholesale', 'Costco'],
    }),
    [],
  );
  // "Costco Wholesale and Costco" is one distribution route written twice.
  assert.deepEqual(consumer.distribution.retailers, ['Costco Wholesale']);
});

test('a generic channel a named store already covers is not listed beside it', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryText: 'The berries were sold at Publix retail stores.',
      geography: { scope: 'states', states: ['Florida'], confidence: 'stated', sourceText: null },
      retailerNames: ['Publix'],
    }),
    [],
  );
  // Publix IS a retail store; naming both makes one route read as two.
  assert.deepEqual(consumer.distribution.channels, []);
  assert.deepEqual(consumer.distribution.retailers, ['Publix']);
});

test('a shared code location is stated once, not repeated on every version', () => {
  const html = `<table><thead><tr><th>Product</th><th>Lot Code</th></tr></thead><tbody>
    <tr><td>Strawberry Bars</td><td>Lot code (bottom of package): LLA1</td></tr>
    <tr><td>Grape Bars</td><td>Lot code (bottom of package): LLA2</td></tr>
  </tbody></table>`;
  const consumer = buildConsumerCase(projection({ summaryHtml: html }), []);
  assert.equal(consumer.packageCheck.variants.length, 2);
  assert.equal(consumer.packageCheck.codeLocation?.text, 'On the bottom of the package.');
  // The reader should not have to skip the same sentence on every card.
  assert.ok(consumer.packageCheck.variants.every((v) => v.codeLocation === null));
});

test('a date list becomes one standardized date per value, in order', () => {
  const grouped = aggregateFacts([fact('best_by', '12/20/19, 12/04/19, 12/10/19')]);
  assert.deepEqual(grouped.find((g) => g.concept === 'best_by')?.values, [
    'December 4, 2019',
    'December 10, 2019',
    'December 20, 2019',
  ]);
});

test('dates in one month collapse into a phrase a person can read', () => {
  assert.equal(
    joinFactValues('production_date', [
      'July 11, 2026',
      'July 15, 2026',
      'July 18, 2026',
      'July 22, 2026',
    ]),
    'July 11, 15, 18, and 22, 2026',
  );
  // Different months keep their own dates in full.
  assert.equal(
    joinFactValues('best_by', ['September 30, 2027', 'October 31, 2027']),
    'September 30, 2027 and October 31, 2027',
  );
  // Non-date concepts are unaffected.
  assert.equal(joinFactValues('package_size', ['20 oz', '12 oz']), '20 oz and 12 oz');
});

test('scope copy never argues with the identifiers printed beneath it', () => {
  const consumer = buildConsumerCase(
    projection({
      title: 'Publix Recalls All Lots of GreenWise Organic Frozen Blueberries',
      summaryText:
        'Publix is recalling all lots of the product.\nProduct code: 41415-06453\nProduct code: 41415-12053',
    }),
    [],
  );
  // "All versions, regardless of code" would misstate the scope: the source
  // narrows the recall to specific product codes. That stays true even though
  // the closed schema has no approved field for a bare "Product code", so the
  // codes themselves are held back.
  assert.doesNotMatch(consumer.packageCheck.scopeStatement, /regardless of code/i);
  assert.match(consumer.packageCheck.scopeStatement, /Every lot and date of this product/);
  assert.ok(consumer.packageCheck.rejected.some((r) => r.concept === 'product_code'));
});

test('a value that is not the type its field promises is never rendered', () => {
  // A misaligned source column filing a net weight under a date heading.
  const grouped = aggregateFacts([fact('use_by', '58 oz'), fact('use_by', '02/14/2026')]);
  assert.deepEqual(grouped.find((g) => g.concept === 'use_by')?.values, ['February 14, 2026']);
});
