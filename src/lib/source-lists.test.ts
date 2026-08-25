/**
 * Source-declared affected-product lists become structured variants, each
 * owning its item's identifiers — the White Cheddar Seasoning and Primavera
 * Nueva regressions, pinned with the real announcements' HTML shapes.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildConsumerCase } from './consumer-projection';
import type { CaseProjection } from '@/domain/recall-types';
import { extractAffectedProductLists } from './source-lists';

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
