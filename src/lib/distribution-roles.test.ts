/**
 * Distribution entity roles, asserted as a contract against the source shapes
 * that produced real defects (live-DB trace, 2026-08-22):
 *
 * - "throughout MI, MN, and ND" kept only Minnesota
 * - Market of Choice's own store cities rendered as RETAILERS
 * - Brooklyn and Queens rendered as RETAILERS
 * - "Ann Arbor and Brighton" rendered as one retailer
 * - Aller-C rendered an orphan "Lot code: 25E04-A" under its version cards
 *   and "Expiration: 05/27" raw
 *
 * Each golden here pins the corrected behavior: states are read
 * deterministically, cities are typed as areas, retailers require retailer
 * evidence, and a version-owned field kind never renders as a loose row.
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

test('golden Kippered Herring: every state in "throughout MI, MN, and ND" is retained', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryText:
        'The recalled "Ma Cohens Kippered Herring" were distributed in retail grocery stores throughout MI, MN, and ND.',
      // The persisted geography carried only the one state the old ", XX"
      // reader could see; display-side recovery must widen it.
      geography: {
        scope: 'states',
        states: ['Minnesota'],
        confidence: 'inferred',
        sourceText: null,
      },
    }),
    [],
  );
  assert.equal(consumer.distribution.areaText, 'Michigan, Minnesota, and North Dakota.');
  assert.deepEqual(consumer.distribution.states, ['Michigan', 'Minnesota', 'North Dakota']);
  assert.deepEqual(consumer.distribution.retailers, []);
});

test('golden Market of Choice: retailer stays the retailer, its cities become areas', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryText:
        'The affected MOC Vegan Kale Caesar Salad, 9.5oz, was sold at Market of Choice stores in Ashland, Bend, Corvallis, Eugene Hillsboro, Medford, Portland, West Linn in Oregon between 4/16/2026 and 5/4/2026.',
      geography: { scope: 'states', states: ['Oregon'], confidence: 'inferred', sourceText: null },
    }),
    [],
  );
  assert.equal(consumer.distribution.areaText, 'Oregon.');
  assert.deepEqual(consumer.distribution.retailers, ['Market of Choice']);
  // The source's own missing comma ("Eugene Hillsboro") splits into the two
  // cities it names; "West Linn" is one city and never splits.
  assert.deepEqual(consumer.distribution.areas, [
    'Ashland',
    'Bend',
    'Corvallis',
    'Eugene',
    'Hillsboro',
    'Medford',
    'Portland',
    'West Linn',
  ]);
  // The retailer ↔ geography relationship survives internally.
  const coverage = consumer.distribution.coverage.find(
    (entry) => entry.retailer === 'Market of Choice',
  );
  assert.ok(coverage, JSON.stringify(consumer.distribution.coverage));
  assert.deepEqual(coverage.states, ['Oregon']);
  assert.ok(coverage.areas.includes('Ashland') && coverage.areas.includes('West Linn'));
  // The sale-date window stays out of distribution entirely.
  assert.ok(!/4\/16|5\/4/.test(JSON.stringify(consumer.distribution)));
});

test('control Vanilla Bourbon Trail Mix: Meijer plus six states, unchanged', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryText:
        'The recalled Frederik’s by Meijer Vanilla Bourbon Trail Mix bags were distributed in Meijer retail stores in Michigan, Indiana, Ohio, Illinois, Wisconsin, and Kentucky.',
      geography: {
        scope: 'states',
        states: ['Illinois', 'Indiana', 'Kentucky', 'Michigan', 'Ohio', 'Wisconsin'],
        confidence: 'inferred',
        sourceText: null,
      },
    }),
    [],
  );
  assert.equal(
    consumer.distribution.areaText,
    'Illinois, Indiana, Kentucky, Michigan, Ohio, and Wisconsin.',
  );
  assert.deepEqual(consumer.distribution.retailers, ['Meijer']);
  assert.deepEqual(consumer.distribution.areas, []);
});

test('golden Made Fresh Salads: boroughs are areas, never retailers', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryText:
        'The cream cheese was distributed in Brooklyn, Queens, Bronx and New York City area by direct delivery to retail stores and distributors.',
      geography: {
        scope: 'states',
        states: ['New York'],
        confidence: 'inferred',
        sourceText: null,
      },
    }),
    [],
  );
  assert.equal(consumer.distribution.areaText, 'New York City area.');
  assert.deepEqual(consumer.distribution.retailers, []);
  assert.deepEqual([...consumer.distribution.areas].sort(), ['Bronx', 'Brooklyn', 'Queens']);
  assert.deepEqual(consumer.distribution.channels, ['distributors']);
});

test('golden Blank Slate: "Ann Arbor and Brighton, MI" is geography with no retailer invented', () => {
  const consumer = buildConsumerCase(
    projection({
      summaryText:
        'The VEGAN NON-DAIRY FROZEN DESSERT COCONUT FUDGE SANDWICH was distributed in Ann Arbor and Brighton, MI at 3 store locations.',
      geography: {
        scope: 'states',
        states: ['Michigan'],
        confidence: 'inferred',
        sourceText: null,
      },
    }),
    [],
  );
  assert.equal(consumer.distribution.areaText, 'Michigan.');
  assert.deepEqual(consumer.distribution.retailers, []);
  assert.deepEqual(consumer.distribution.areas, ['Ann Arbor', 'Brighton']);
});

test('golden Aller-C: no orphan lot row below version cards, and 05/27 renders as May 2027', () => {
  // The real announcement's shape: a table gives each capsule count its own
  // barcodes and lots; the prose then restates "lot numbers 25E04-A and
  // 25E04-B with an expiration date of 05/27" at recall level.
  const summaryHtml = `
    <p>Blueroot Health of Middletown, Connecticut is voluntarily recalling two lots of Vital Nutrients Aller-C dietary supplements.</p>
    <p>The recalled product is packaged in a white plastic bottle containing 100 or 200 capsules and includes lot numbers 25E04-A and 25E04-B with an expiration date of 05/27 on the side of the bottle.</p>
    <table>
      <tr><th>Product</th><th>Count</th><th>UPC</th><th>Lot Numbers</th><th>Expiration</th></tr>
      <tr><td>Vital Nutrients Aller-C</td><td>100 capsules</td><td>693465524213</td><td>25E04-B</td><td>05/27</td></tr>
      <tr><td>Vital Nutrients Aller-C</td><td>200 capsules</td><td>693465524114</td><td>25E04-A, 25E04-B</td><td>05/27</td></tr>
    </table>`;
  const consumer = buildConsumerCase(
    projection({
      summaryHtml,
      summaryText:
        'The recalled product is packaged in a white plastic bottle containing 100 or 200 capsules and includes lot numbers 25E04-A and 25E04-B with an expiration date of 05/27 on the side of the bottle.',
    }),
    [],
  );
  assert.equal(consumer.packageCheck.variants.length, 2);
  // Version-owned field kinds never render as loose case-level rows.
  assert.deepEqual(
    consumer.packageCheck.fields.map((field) => `${field.label}: ${field.value}`),
    [],
  );
  // Each version keeps its own lots, split into individual codes.
  const second = consumer.packageCheck.variants[1];
  const lots = second.fields.find((field) => field.key === 'lotCodes');
  assert.ok(lots, JSON.stringify(second.fields));
  assert.deepEqual(lots.values, ['25E04-A', '25E04-B']);
  // Month/year granularity: normalized, never given an invented day. Both
  // versions state the same expiration, so it is proven shared and renders
  // once, above the cards, instead of repeating on each.
  const expiration = consumer.packageCheck.sharedFields.find((field) => field.key === 'expiration');
  assert.ok(expiration, JSON.stringify(consumer.packageCheck.sharedFields));
  assert.equal(expiration.value, 'May 2027');
  assert.ok(
    consumer.packageCheck.variants.every((variant) =>
      variant.fields.every((field) => field.key !== 'expiration'),
    ),
  );
});
