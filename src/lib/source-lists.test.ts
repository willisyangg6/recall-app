/**
 * Source-declared affected-product lists become structured variants, each
 * owning its item's identifiers — the White Cheddar Seasoning and Primavera
 * Nueva regressions, pinned with the real announcements' HTML shapes.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildConsumerCase } from './consumer-projection';
import type { CaseProjection } from '@/domain/recall-types';
import { classifyListRole, extractAffectedProductLists } from './source-lists';

const WHITE_CHEDDAR_HTML = `
  <p>The recalled products were distributed in limited quantities through retail stores.</p>
  <p>The affected products include White Cheddar Seasoning sold in the following consumer-facing formats:</p>
  <ul><li>Williams Sonoma–branded Popcorn Sampler Gift Box, containing a White Cheddar Seasoning component. The affected lot codes are: 088594-2-1.</li><li>Fireworks Popcorn Poppings &amp; Toppings gift set containing a White Cheddar Seasoning component sold at West Allis Cheese and Sausage. The affected lot codes are: 088594-5-1.</li><li>Fireworks White Cheddar Seasoning, 1.6 oz jars, sold at West Allis Cheese and Sausage. The affected lot codes are: 088594-7-1.</li></ul>
  <p>The lot codes are printed on the product packaging.</p>`;

const PRIMAVERA_HTML = `
  <p>Product was distributed by Primavera Nueva Inc. in California and Nevada to retail stores.</p>
  <p>The following 4-count tamales, produced between October 10, 2024 and October 10, 2025 are included:</p>
  <ul><li>Roasted Green Chile &amp; Jack Cheese</li><li>Black Bean Bonanza &amp; Jack Cheese</li><li>Mushroom Spinach &amp; Salsa with Two Cheeses</li><li>Mushroom Spinach &amp; Salsa</li><li>Roasted Pumpkin &amp; White Cheddar</li></ul>`;

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

test('golden White Cheddar: each list item keeps its own lot code', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryHtml: WHITE_CHEDDAR_HTML,
      summaryText:
        'The affected products include White Cheddar Seasoning sold in the following consumer-facing formats:\nWilliams Sonoma–branded Popcorn Sampler Gift Box, containing a White Cheddar Seasoning component. The affected lot codes are: 088594-2-1.\nFireworks Popcorn Poppings & Toppings gift set containing a White Cheddar Seasoning component sold at West Allis Cheese and Sausage. The affected lot codes are: 088594-5-1.\nFireworks White Cheddar Seasoning, 1.6 oz jars, sold at West Allis Cheese and Sausage. The affected lot codes are: 088594-7-1.',
    }),
    [],
  );
  const variants = consumer.packageCheck.variants;
  assert.equal(variants.length, 3, JSON.stringify(variants.map((v) => v.name)));

  const byName = (prefix: string) => variants.find((v) => v.name.startsWith(prefix));
  const giftBox = byName('Williams Sonoma');
  assert.ok(giftBox);
  // "–branded" is grammar, not part of the product's name.
  assert.equal(giftBox.name, 'Williams Sonoma Popcorn Sampler Gift Box');
  assert.equal(giftBox.fields.find((f) => f.key === 'lotCodes')?.value, '088594-2-1');

  const giftSet = byName('Fireworks Popcorn');
  assert.ok(giftSet);
  assert.equal(giftSet.fields.find((f) => f.key === 'lotCodes')?.value, '088594-5-1');

  const jars = byName('Fireworks White Cheddar Seasoning');
  assert.ok(jars);
  assert.equal(jars.fields.find((f) => f.key === 'lotCodes')?.value, '088594-7-1');
  assert.equal(jars.fields.find((f) => f.key === 'size')?.value, '1.6 oz');

  // The three lots never flatten into one recall-wide list.
  assert.equal(
    consumer.packageCheck.fields.find((field) => field.key === 'lotCodes'),
    undefined,
  );
  assert.equal(consumer.packageCheck.lotCodes, null);
});

test('golden Primavera: flavor list becomes variants with the lead-in size, distribution recovers both states', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryHtml: PRIMAVERA_HTML,
      summaryText:
        'Product was distributed by Primavera Nueva Inc. in California and Nevada to retail stores.\nThe following 4-count tamales, produced between October 10, 2024 and October 10, 2025 are included:\nRoasted Green Chile & Jack Cheese\nBlack Bean Bonanza & Jack Cheese',
    }),
    [],
  );
  assert.equal(consumer.distribution.areaText, 'California and Nevada.');
  const names = consumer.packageCheck.variants.map((variant) => variant.name);
  // "… with Two Cheeses" and its shorter sibling stay two distinct versions.
  assert.ok(names.includes('Mushroom Spinach & Salsa with Two Cheeses'), names.join(' | '));
  assert.ok(names.includes('Mushroom Spinach & Salsa'), names.join(' | '));
  assert.equal(consumer.packageCheck.variants.length, 5);
  // The lead-in size applies to every flavor, so it is proven shared and
  // renders once above the cards rather than repeating on all five.
  assert.equal(
    consumer.packageCheck.sharedFields.find((field) => field.key === 'size')?.value,
    '4 count',
  );
});

test('a list without a declaring lead-in is never read as products', () => {
  const items = extractAffectedProductLists(
    '<p>Our stores follow these safety practices:</p><ul><li>Daily temperature checks</li><li>Weekly deep cleaning</li></ul>',
  );
  assert.deepEqual(items, []);
});

test('FSIS-shape items split package descriptor, quoted name, and identifiers', () => {
  const items = extractAffectedProductLists(
    '<p>The following products are subject to recall [<a href="/x.pdf">view labels</a>]:</p>' +
      '<ul><li>8-oz. glass jars containing “Gangothri Goat Pickle”</li>' +
      '<li>8-oz. glass jars containing “Gangothri Chicken Pickle”</li></ul>',
  );
  assert.equal(items.length, 2);
  const first = items[0].facts;
  assert.equal(first.find((f) => f.concept === 'variant')?.value, 'Gangothri Goat Pickle');
  assert.equal(first.find((f) => f.concept === 'package_size')?.value, '8 oz');
  assert.equal(first.find((f) => f.concept === 'packaging')?.value, 'glass jars');
});

// ── P0A: a declared list that is not a product list ─────────────────────────

/**
 * SunFed's own markup, verbatim. FDA closes most announcements this way, and
 * the lead-in ("the following actions:") is structurally identical to a
 * product list's — which is how five shopper instructions became five
 * affected-version cards, the first of them "Check to see if you have
 * recalled whole fresh American cucumbers (photo below)".
 */
const SUNFED_ACTIONS_HTML = `
  <p>The individual whole American cucumbers may also have a PLU sticker in the form of the attached picture.</p>
  <p>Consumers should take the following actions:</p>
  <ul>
  <li>Check to see if you have recalled whole fresh American cucumbers (photo below)</li>
  <li>Anyone with the recalled product in their possession should not consume, serve, use, sell, or distribute recalled products.&nbsp;We also encourage them to clean and sanitize surfaces that could have come into contact with the recalled product to reduce cross-contamination.</li>
  <li>Recalled products should be thrown out or destroyed so they may not be consumed or returned to the point of purchase.</li>
  <li>Consumers who are unsure if they have purchased the recalled product are advised to contact their retailer.</li>
  <li>If you think you have consumed a recalled product and do not feel well, contact your healthcare provider.</li>
  </ul>
  <p>Consumers who have purchased the recalled products may obtain additional information by contacting SunFed’s recall hotline (888) 542-5849, M-F 8:00 a.m. - 5:00 p.m. MST.</p>`;

test('a declared list of shopper instructions is not an affected-product list', () => {
  assert.equal(
    classifyListRole('Consumers should take the following actions:', [
      'Check to see if you have recalled whole fresh American cucumbers (photo below)',
      'Recalled products should be thrown out or destroyed.',
      'If you think you have consumed a recalled product and do not feel well, contact your healthcare provider.',
    ]),
    'instructions',
  );
  assert.deepEqual(extractAffectedProductLists(SUNFED_ACTIONS_HTML), []);
});

test('a declared symptom list is not an affected-product list', () => {
  // FDA's Listeria paragraph names these; read as products they became cards.
  assert.equal(
    classifyListRole('Symptoms may include the following:', [
      'High fever',
      'Severe headache',
      'Stiffness',
      'Nausea',
      'Abdominal pain',
      'Diarrhea',
    ]),
    'instructions',
  );
});

test('a declared list of shops is where it was sold, not what it is', () => {
  // Grand Central Bakery, verbatim lead-in and items.
  assert.equal(
    classifyListRole('Other grocery stores in Seattle/Tacoma area in WA:', [
      'Central Co-op',
      'Fred Meyer Stores',
      'Hilltop Red Apple',
      "Ken's Markets",
      'Marketime Foods',
      'PCC Markets',
    ]),
    'sellers',
  );
  // A product list that merely mentions a shop is still a product list.
  assert.equal(
    classifyListRole('The following products sold at our stores are recalled:', [
      'Roasted Green Chile & Jack Cheese',
      'Black Bean Bonanza & Jack Cheese',
    ]),
    'affected_products',
  );
});

test('SunFed: the official product wording survives when no version is extractable', () => {
  const consumer = buildConsumerCase(
    projection({
      title: 'SunFed Produce, LLC Recalls Whole Fresh American Cucumbers',
      summaryHtml: SUNFED_ACTIONS_HTML,
      summaryText:
        'The individual whole American cucumbers may also have a PLU sticker in the form of the attached picture.\nConsumers should take the following actions:\nCheck to see if you have recalled whole fresh American cucumbers (photo below)\nRecalled products should be thrown out or destroyed so they may not be consumed or returned to the point of purchase.\nConsumers who have purchased the recalled products may obtain additional information by contacting SunFed’s recall hotline (888) 542-5849, M-F 8:00 a.m. - 5:00 p.m. MST.',
      productDescription: 'Whole Fresh American Cucumbers',
    }),
    [
      {
        sourceNativeId: 'sunfed-1',
        name: 'Whole fresh American cucumbers',
        rawText: 'Whole fresh American cucumbers',
        extractionConfidence: 'stated',
      },
    ],
  );
  // No instruction becomes a version, and no version is invented in its place.
  assert.deepEqual(consumer.packageCheck.variants, []);
  assert.deepEqual(consumer.variantNames, []);
  // The hotline and its opening hours never become package identifiers.
  const values = [
    ...consumer.packageCheck.fields.flatMap((field) => field.values),
    ...consumer.packageCheck.sharedFields.flatMap((field) => field.values),
    ...(consumer.packageCheck.lotCodes?.codes ?? []),
  ];
  assert.deepEqual(values, []);
  // Low confidence falls back rather than losing the official evidence: the
  // recall-level product wording is still there, and the checker's wording
  // stays conservative — partial evidence never claims complete coverage.
  assert.equal(consumer.packageCheck.hasIdentifiers, true);
  assert.equal(consumer.packageCheck.render, false);
  assert.match(
    consumer.packageCheck.scopeStatement,
    /not clearly provided|may not identify every affected package/,
  );
});

test('a container phrase never stands as an item name; the quoted product does', () => {
  // The recorded FSIS 018-2026 shape: no leading measurement, a container
  // phrase, a piece count, then the source's own quoted product identity.
  const html = `
    <p>The following products are subject to recall [<a href="/sites/default/files/food_label_pdf/x.pdf">view labels</a>]:</p>
    <ul type="disc"><li>Cardboard boxes containing 100 pieces of “BUFFALO CHICKEN RANGOON” and “Sell By” dates from July 8, 2026, to June 29, 2027, represented on the label.</li><li>Cardboard boxes containing 120 pieces of “BENEDETTO’S BUFFALO CHICKEN MOZZARELLA STICK” and “Sell By” dates from July 8, 2026, to June 29, 2027, represented on the label.</li></ul>`;
  const lists = extractAffectedProductLists(html);
  assert.equal(lists.length, 2);
  const names = lists.map(
    (item) => item.facts.find((fact) => fact.concept === 'variant')?.value ?? null,
  );
  assert.deepEqual(names, [
    'BUFFALO CHICKEN RANGOON',
    'BENEDETTO’S BUFFALO CHICKEN MOZZARELLA STICK',
  ]);
  // The container is packaging evidence and the count is the package size —
  // each attached to its OWN item's scope.
  for (const [index, item] of lists.entries()) {
    assert.equal(item.facts.find((fact) => fact.concept === 'packaging')?.value, 'Cardboard boxes');
    assert.equal(
      item.facts.find((fact) => fact.concept === 'package_size')?.value,
      index === 0 ? '100 pieces' : '120 pieces',
    );
    assert.ok(item.facts.some((fact) => fact.concept === 'sell_by'));
  }
});

test('a product name merely ENDING in a container word keeps its head', () => {
  const html = `
    <p>The following products are subject to recall:</p>
    <ul><li>Harvest Gift Baskets containing assorted cheeses. The affected lot codes are: 11-22.</li><li>Holiday Snack Crates containing assorted nuts. The affected lot codes are: 11-23.</li></ul>`;
  const names = extractAffectedProductLists(html).map(
    (item) => item.facts.find((fact) => fact.concept === 'variant')?.value ?? null,
  );
  assert.deepEqual(names, ['Harvest Gift Baskets', 'Holiday Snack Crates']);
});
