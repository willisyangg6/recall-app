import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
  retailerHeadOfCellLine,
  toPackageFields,
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

test('a flattened State/Retailer cell becomes real stores, not one malformed name', () => {
  // The live Ukrop's table: ten stores in ONE cell, separated by the source's
  // own line breaks. Read flat, the shortest cell passed the retailer gate and
  // the section rendered a single shop called "Food Lion-NC Kroger-VA WVA",
  // hiding every other store on the page.
  const cell = [
    'Food Lion -VA, NC',
    'Harris Teeter-Wmsbg.VA',
    'Kroger-VA, WVA',
    'Libbie Market-VA',
    'Publix-VA',
    'Ukrop’s Market Hall',
  ];
  const ukrops = buildDistribution(projection({ summaryText: 'Ukrop’s is recalling six items.' }), [
    {
      concept: 'distribution',
      sourceLabel: 'State/Retailer',
      value: cell.join(' '),
      valueLines: cell,
      scope: 't0r0',
    },
  ]);
  // Every store the existing retailer contract accepts, now named on its own.
  // ("Libbie Market" is rejected by that contract, unchanged here, for the
  // same reason it always was — a singular "<word> Market" is not a chain.)
  for (const store of ['Food Lion', 'Kroger', 'Publix', 'Ukrop’s Market Hall']) {
    assert.ok(ukrops.retailers.includes(store), `${store} — got ${ukrops.retailers.join(' | ')}`);
  }
  // The malformed hybrid is gone, and no state token is presented as a store.
  assert.ok(!ukrops.retailers.some((name) => /WVA|-VA|-NC/.test(name)), ukrops.retailers.join('|'));
});

test('a wrapped "Sold At" sentence is one value, never split into extra stores', () => {
  // Only a column the source labels with a state role holds one entry per
  // line. This cell wraps a single sentence across three lines.
  const lines = ['Sold direct to customers at Grand', 'Central Bakery Cafés', 'and wholesalers'];
  const potato = buildDistribution(projection({ summaryText: 'Bread was recalled.' }), [
    {
      concept: 'distribution',
      sourceLabel: 'Sold At',
      value: lines.join(' '),
      valueLines: lines,
      scope: 't0c0',
    },
  ]);
  assert.ok(!potato.retailers.includes('Central Bakery Cafés'), potato.retailers.join(' | '));
});

test('a "Store City & State" address cell is a location, never a store name', () => {
  // The live Walmart 34-store table. Stripping the state off "ALLEN, TX"
  // would present 34 Texas towns as 34 retailers.
  const walmart = buildDistribution(
    projection({ summaryText: 'Available at 34 Walmart stores located in Texas.' }),
    [
      {
        concept: 'distribution',
        sourceLabel: 'Store City & State',
        value: 'ALLEN, TX',
        scope: 'r0',
      },
      {
        concept: 'distribution',
        sourceLabel: 'Store City & State',
        value: 'CANTON, TX',
        scope: 'r1',
      },
    ],
  );
  for (const town of ['ALLEN', 'CANTON', 'Allen', 'Canton']) {
    assert.ok(!walmart.retailers.includes(town), `${town} — got ${walmart.retailers.join(' | ')}`);
  }
});

test('a trailing period belongs to the store name, not to a state token', () => {
  assert.equal(retailerHeadOfCellLine('Duluth Candy Co.'), 'Duluth Candy Co.');
  assert.equal(retailerHeadOfCellLine('Food Lion -VA, NC'), 'Food Lion');
  assert.equal(retailerHeadOfCellLine('Harris Teeter-Wmsbg.VA'), 'Harris Teeter-Wmsbg');
  assert.equal(retailerHeadOfCellLine('Ukrop’s Market Hall'), 'Ukrop’s Market Hall');
  // A store whose NAME contains a state is never truncated.
  assert.equal(retailerHeadOfCellLine('Texas Roadhouse'), 'Texas Roadhouse');
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

test('every date in a structured cell renders in full — no same-month collapse', () => {
  // P3C-1 (founder decision): dates in one month used to collapse into a
  // single phrase ("July 11, 15, 18, 22, 2026"). A shopper checks one printed
  // marking at a time, so each parsed date keeps its own month, day and year.
  assert.equal(
    joinFactValues('production_date', [
      'July 11, 2026',
      'July 15, 2026',
      'July 16, 2026',
      'July 18, 2026',
      'July 22, 2026',
    ]),
    'July 11, 2026, July 15, 2026, July 16, 2026, July 18, 2026, July 22, 2026',
  );
  // Two same-month dates are two complete dates, not a shared month and two
  // bare days.
  assert.equal(
    joinFactValues('best_by', ['November 19, 2027', 'November 20, 2027']),
    'November 19, 2027, November 20, 2027',
  );
  // Mixed months and mixed years were already correct and stay so.
  assert.equal(
    joinFactValues('best_by', ['September 30, 2027', 'October 31, 2027']),
    'September 30, 2027, October 31, 2027',
  );
  assert.equal(
    joinFactValues('use_by', ['December 8, 2025', 'December 8, 2026']),
    'December 8, 2025, December 8, 2026',
  );
  // A range is one value and is never split into its endpoints.
  assert.equal(
    joinFactValues('sell_by', ['July 20–August 17, 2026', 'September 1, 2026']),
    'July 20–August 17, 2026, September 1, 2026',
  );
  // An unsupported value keeps the source's own wording, beside the parsed
  // dates rather than instead of them.
  assert.equal(
    joinFactValues('expiration', ['November 19, 2027', 'C 08 05 23']),
    'November 19, 2027, C 08 05 23',
  );
  // P3C-1: the conjunction survives where the value is an ordinary phrase.
  // Size and Packaging are the only two approved fields that are, so they are
  // the boundary between structured data and English inside this joiner.
  assert.equal(joinFactValues('package_size', ['20 oz', '12 oz']), '20 oz and 12 oz');
  assert.equal(
    joinFactValues('packaging', ['Plastic bags', 'Cardboard boxes', 'Foil pouches']),
    'Plastic bags, Cardboard boxes, and Foil pouches',
  );
});

test('structured cells are comma-separated; ordinary phrases keep their grammar', () => {
  // P3C-1. The distinction is by CONCEPT, so it is field-aware by
  // construction: a barcode, a printed code, and the calendar date stamped
  // beside one are machine data a shopper scans, and a conjunction inside a
  // run of identifiers reads as part of the last value.
  const structured: [Parameters<typeof joinFactValues>[0], string[], string][] = [
    ['upc', ['43240304', '230420340240', '324020340'], '43240304, 230420340240, 324020340'],
    ['lot', ['10662 5139', '10662 5140'], '10662 5139, 10662 5140'],
    ['case_code', ['B 048', 'B 049'], 'B 048, B 049'],
    ['production_code', ['26192', '26193'], '26192, 26193'],
    ['item_number', ['4874', '4875'], '4874, 4875'],
    ['best_by', ['March 26, 2027', 'April 7, 2027'], 'March 26, 2027, April 7, 2027'],
    ['use_by', ['March 26, 2027', 'April 7, 2027'], 'March 26, 2027, April 7, 2027'],
    ['sell_by', ['March 26, 2027', 'April 7, 2027'], 'March 26, 2027, April 7, 2027'],
    ['expiration', ['March 26, 2027', 'April 7, 2027'], 'March 26, 2027, April 7, 2027'],
  ];
  for (const [concept, values, expected] of structured) {
    assert.equal(joinFactValues(concept, values), expected, concept);
  }
  // Two values are the case the old joiner rendered as a bare "and"; they are
  // commas now too, so a two-code list and a three-code list read alike.
  assert.equal(joinFactValues('upc', ['10662 5139', '10662 5140']), '10662 5139, 10662 5140');
  // Values themselves are untouched: leading zeroes and the spacing inside a
  // printed code are what a shopper compares character by character.
  assert.equal(joinFactValues('upc', ['011110626196']), '011110626196');
  // Same-month dates each render complete (no collapse) and comma-only.
  assert.equal(
    joinFactValues('production_date', ['July 11, 2026', 'July 22, 2026']),
    'July 11, 2026, July 22, 2026',
  );
  // Natural language is untouched — this is not a global removal of "and".
  assert.equal(joinValues(['California', 'Texas', 'Ohio']), 'California, Texas, and Ohio');
  assert.equal(joinValues(['milk', 'soy']), 'milk and soy');
  assert.equal(joinFactValues('package_size', ['20 oz', '12 oz']), '20 oz and 12 oz');
});

test('a date list keeps every sibling, including the ones that do not parse', () => {
  // A value that resolves is not evidence about the ones beside it. Dropping
  // the rest shortened the list of markings a shopper is asked to check —
  // silently, and in the one field where completeness is the point.
  const grouped = aggregateFacts([fact('best_by', '11/19/2027, ABC-123, 11/20/2027')]);
  const values = grouped.find((group) => group.concept === 'best_by')?.values ?? [];
  assert.deepEqual(values, ['November 19, 2027', 'November 20, 2027', 'ABC-123']);
  // Each part is still type-checked on its own, so this is preservation, not
  // a hole: a whole-cell fallback is what let "10/2025 and 1365200" pass as a
  // date because one half of it looked like one.
  const netWeight = aggregateFacts([fact('use_by', '58 oz, 02/14/2026')]);
  assert.deepEqual(netWeight.find((group) => group.concept === 'use_by')?.values, [
    'February 14, 2026',
  ]);
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

// ── P0A: identifier integrity end to end ────────────────────────────────────

test('official identifiers render as strings: no digit grouping, leading zeroes intact', () => {
  const grouped = aggregateFacts([
    fact('lot', '2606022'),
    fact('lot', '13150423'),
    fact('lot', '050011'),
    fact('upc', '0001111079120'),
  ]);
  const { fields } = toPackageFields(grouped);
  const byKey = new Map(fields.map((field) => [field.key, field.value]));
  // Seven and eight digits are exactly that — never "2,606,022".
  assert.equal(byKey.get('lotCodes'), '2606022, 13150423, 050011');
  assert.equal(byKey.get('upc'), '0001111079120');
  for (const value of byKey.values()) assert.ok(!value.includes(','.concat('0')), value);
  assert.ok(!/\d,\d{3}\b/.test(byKey.get('lotCodes') ?? ''));
});

test('digit grouping belongs to the recall total and to nothing else', () => {
  // "3,860 units" is how wide the recall is; it is the one field where a
  // separator is meaningful, and it never reaches an identifier.
  const consumer = buildConsumerCase(
    projection({
      title: 'Acme Foods Recalls Widgets',
      summaryText:
        'Acme Foods is recalling approximately 3860 units of the product with lot code 2606022.',
    }),
    [],
  );
  assert.equal(consumer.quantityText, '3,860 units');
  const lot = consumer.packageCheck.fields.find((field) => field.key === 'lotCodes');
  assert.equal(lot?.value, '2606022');
});

test('representative FDA shape: an Outshine batch-code cell still yields its codes and dates', () => {
  // The recorded announcement's own table cell, verbatim.
  const consumer = buildConsumerCase(
    projection({
      title: 'Dreyer’s Grand Ice Cream, Inc. Issues Voluntary Recall of Select Outshine Fruit Bars',
      summaryHtml:
        '<table><tr><th>Product</th><th>Packaging</th><th>Batch Code/Best Before Date</th><th>UPC</th></tr>' +
        '<tr><td>Outshine Fruit Bars Tangerine</td><td>6 Bars</td>' +
        '<td>Batch code/ Best Before&nbsp;<br>(bottom of package):&nbsp;<br>LLA619603 – 31 OCT 2027&nbsp;<br>LLA619703 – 31 OCT 2027</td>' +
        '<td>041548612041</td></tr></table>',
    }),
    [],
  );
  const variant = consumer.packageCheck.variants[0];
  assert.ok(variant, JSON.stringify(consumer.packageCheck.variants));
  assert.equal(variant.name, 'Outshine Fruit Bars Tangerine');
  const byKey = new Map(variant.fields.map((field) => [field.key, field.value]));
  assert.equal(byKey.get('batchCodes'), 'LLA619603, LLA619703');
  assert.equal(byKey.get('bestBy'), 'October 31, 2027');
  assert.equal(byKey.get('upc'), '041548612041');
  // The source's own column called it Packaging, and it keeps that name.
  assert.equal(byKey.get('packaging'), '6 Bars');
  // The inline "(bottom of package)" hint is a location, never a code.
  assert.equal(consumer.packageCheck.codeLocation?.text, 'On the bottom of the package.');
});

test('representative FSIS shape: a labeled list item still yields its use-by marking', () => {
  // Reser's Fine Foods 009-2026, verbatim.
  const consumer = buildConsumerCase(
    projection({
      sourceAgency: 'FSIS',
      title: 'Reser’s Fine Foods, Inc. Recalls Ready-To-Eat Pasta Salad Product',
      summaryHtml:
        '<p>The following product is subject to recall [<a href="/x.pdf">view labels</a>]:</p>' +
        '<ul><li>5-lb. plastic tub packages of “Molly’s Kitchen California Style Pasta Salad” with “USE BY JUL/16/26 430” printed on the side of the plastic tub.</li></ul>',
      summaryText:
        'The following product is subject to recall:\n5-lb. plastic tub packages of “Molly’s Kitchen California Style Pasta Salad” with “USE BY JUL/16/26 430” printed on the side of the plastic tub.',
    }),
    [],
  );
  const byKey = new Map(
    [...consumer.packageCheck.fields, ...consumer.packageCheck.sharedFields].map((field) => [
      field.key,
      field.value,
    ]),
  );
  assert.equal(byKey.get('useBy'), 'JUL/16/26 430');
  assert.ok(!byKey.has('lotCodes'), JSON.stringify([...byKey]));
});

// ── P0A correction pass: the four remaining identifier defects ──────────────

/**
 * The recorded corpus, read rather than transcribed. Each case below was
 * reported against a specific official announcement, so the test runs on the
 * announcement's own words and fails loudly if the fixture ever changes.
 */
const GOLD_SET: {
  rows: { sourceId: string; title: string; announcementSummary: string | null }[];
} = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'domain', 'fixtures', 'category-gold-set.json'), 'utf8'),
);

function recorded(sourceId: string): CaseProjection {
  const row = GOLD_SET.rows.find((item) => item.sourceId === sourceId);
  assert.ok(row?.announcementSummary, `recorded fixture missing: ${sourceId}`);
  return projection({ title: row.title, summaryText: row.announcementSummary });
}

function packageFields(consumer: ReturnType<typeof buildConsumerCase>): Map<string, string> {
  return new Map(
    [...consumer.packageCheck.fields, ...consumer.packageCheck.sharedFields].map((field) => [
      field.key,
      field.value,
    ]),
  );
}

test('a period-delimited lot code survives to the checker', () => {
  // North Star Imports (048-2019), verbatim: "…marked FOR INSTITUTIONAL USE
  // ONLY with lot code GP.1051.18 and pack dates 10/30/2018, 10/31/2018, and
  // 11/01/2018." The code-set builder's shape excluded periods, so the one
  // official identifier this notice states rendered nowhere.
  const consumer = buildConsumerCase(recorded('048-2019'), []);
  assert.equal(packageFields(consumer).get('lotCodes'), 'GP.1051.18');
  // The pack dates stated under their own label never join the lot list.
  const lot = packageFields(consumer).get('lotCodes') ?? '';
  assert.ok(!lot.includes('2018'), lot);

  // Channel Fish (003-2017): "…with Use or Freeze By date of 01/21/17 and lot
  // code 2457744.2".
  assert.equal(
    packageFields(buildConsumerCase(recorded('003-2017'), [])).get('lotCodes'),
    '2457744.2',
  );

  // Mutual Trading: "…lot code is 2025.6.30 or before this date." A date-shaped
  // lot code is still the lot code the source published.
  assert.equal(
    packageFields(
      buildConsumerCase(
        recorded('mutual-trading-co-issues-allergy-alert-undeclared-milk-prepared-monkfish-liver'),
        [],
      ),
    ).get('lotCodes'),
    '2025.6.30',
  );
});

test('the period shape admits codes without admitting quantities, times or phones', () => {
  // Gerber states net weights, not lot codes; Valley Meats states clock times;
  // Stutz prints its telephone number as 760.230.9547. None may become a code.
  for (const [id, forbidden] of [
    [
      'recall-reminder-gerber-products-company-previously-recalled-and-discontinued-all-batches-gerberr',
      /oz|net\s*wt/i,
    ],
    ['065-2023', /time|:\d\d/i],
    [
      'stutz-packing-co-recalls-walnut-product-because-possible-health-risk',
      /760\.230|\d{3}\.\d{3}\.\d{4}/,
    ],
  ] as const) {
    const consumer = buildConsumerCase(recorded(id), []);
    const values = [
      ...[...packageFields(consumer).values()],
      ...(consumer.packageCheck.lotCodes?.codes ?? []),
      ...(consumer.packageCheck.productionCodes?.codes ?? []),
    ];
    for (const value of values) assert.ok(!forbidden.test(value), `${id}: ${value}`);
  }
});

test('a placement sentence becomes the code location, never a lot code', () => {
  // Middlefield, verbatim: "Customers can find the lot codes on 8 oz. packets
  // and 5 lb. loaves located on the side." rendered "Lot code: …, and on 8 oz".
  const consumer = buildConsumerCase(
    recorded(
      'middlefield-original-cheese-co-op-recalls-100-grass-fed-pepper-jack-cheese-and-horseradish-flavored',
    ),
    [],
  );
  assert.equal(packageFields(consumer).get('lotCodes'), '251661, 2524061, 251672');
  // The package size never rides in as an identifier.
  for (const value of packageFields(consumer).values()) {
    assert.ok(!/\b\d+\s*(?:oz|lb)\b/i.test(value), value);
  }
  // And the phrase reaches the section that owns it.
  assert.equal(consumer.packageCheck.codeLocation?.text, 'On the side of the package.');
});

test('a flattened table row does not invent a lot code from another column', () => {
  // Moonlight's summary flattens its table, so the column-header run
  // "… Facility Code Lot Code" is followed by the row's own cells. The 4401 in
  // it sits under PLU Sticker, and the lot codes are 01PCLC, 03PCAF, … —
  // emitting 4401 would state a lot the notice never gave.
  const consumer = buildConsumerCase(
    recorded(
      'moonlight-companies-voluntarily-recalls-california-grown-conventional-yellow-and-white-peaches',
    ),
    [],
  );
  const values = [
    ...packageFields(consumer).values(),
    ...(consumer.packageCheck.lotCodes?.codes ?? []),
  ];
  for (const value of values) {
    assert.ok(!/Moonlight|Peaches|pieces/i.test(value), value);
    assert.notEqual(value, '4401');
  }
  // Nothing is invented in its place, and the miss is reported honestly.
  assert.deepEqual(consumer.packageCheck.variants, []);
  assert.equal(consumer.packageCheck.coverage, 'parser_missed');
});

test('a label word left at the end of a date is dropped only when a date remains', () => {
  // Hormel (041-2018), verbatim: "…with a Best By February 2021 date and
  // production codes: F020881, …". The label's own noun rendered inside the
  // value as "February 2021 date".
  const consumer = buildConsumerCase(recorded('041-2018'), []);
  assert.equal(packageFields(consumer).get('bestBy'), 'February 2021');
  // The production codes still reach their own disclosure.
  assert.ok(consumer.packageCheck.productionCodes?.codes.includes('F020881'));

  // Source wording that is not a redundant label survives untouched: the word
  // only goes when what remains still resolves to a date.
  const kept = aggregateFacts([fact('best_by', 'C 08 05 23 date')]);
  assert.deepEqual(kept.find((group) => group.concept === 'best_by')?.values, ['C 08 05 23 date']);
});

test('a reference to the notice’s own labels is not an affected version', () => {
  // FSIS 040-2016, verbatim: "The following products are subject to recall:
  // [View Labels(PDF only) Labels A , Labels B , Labels C ]" produced version
  // cards named "Labels B" and "Labels C ]".
  const consumer = buildConsumerCase(recorded('040-2016'), []);
  assert.deepEqual(consumer.packageCheck.variants, []);
  assert.deepEqual(consumer.variantNames, []);
  // The official recall-level evidence is retained, not lost with them.
  assert.ok(packageFields(consumer).get('bestBy')?.startsWith('January 2, 2015'));
  assert.equal(consumer.quantityText, '47,112,256 pounds');
  assert.equal(consumer.packageCheck.render, true);
});
