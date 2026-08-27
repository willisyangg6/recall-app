/**
 * The canonical geography contract (C5.2A), proved against the source text and
 * source HTML of real announcements.
 *
 * Two failures found in manual QA drive most of this file:
 *
 *   Grand Central Bakery — the feed card read "Distribution not specified"
 *   about a notice whose own sentence says the bread was sold "within the
 *   Seattle and Tacoma Metro areas in WA".
 *
 *   Ukrop's Homestyle Foods — the states live only in a table column headed
 *   "State/Retailer", and the flattened cell rendered as one malformed shop
 *   called "Food Lion-NC Kroger-VA WVA".
 *
 * Everything else here is the boundary: what must NEVER become geography.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  distributionSentences,
  distributionTableStates,
  evaluateGeographyEvidence,
} from './geography-evidence';
import type { Geography } from './recall-types';

const UNKNOWN: Geography = {
  scope: 'unknown',
  states: [],
  confidence: 'stated',
  sourceText: null,
};

function derive(
  summaryText: string,
  options: { summaryHtml?: string | null; carried?: Geography; title?: string } = {},
) {
  return evaluateGeographyEvidence({
    title: options.title ?? 'A Firm Recalls A Product',
    summaryText,
    summaryHtml: options.summaryHtml ?? null,
    carried: options.carried ?? UNKNOWN,
  });
}

// ── The two reported failures ───────────────────────────────────────────────

test('Grand Central Bakery: a metro-area sentence naming its state is geography', () => {
  // Verbatim from the announcement body.
  const evidence = derive(
    'The following products are subject to recall and were sold at grocery stores, ' +
      'select restaurants, wholesalers, and four Grand Central Bakery (GCB) Café ' +
      'locations within the Seattle and Tacoma Metro areas in WA on 8/10/2026 .',
  );
  assert.equal(evidence.geography.scope, 'states');
  assert.deepEqual(evidence.geography.states, ['Washington']);
  assert.deepEqual(evidence.bases, ['prose']);
});

/** The "State/Retailer" column of the Ukrop's announcement, verbatim. */
const UKROPS_TABLE = `<table><tbody>
<tr><th scope="col"><strong>Product Name</strong></th><th scope="col"><strong>UPC</strong></th><th scope="col"><strong>Best By</strong><br><strong>Date</strong></th><th scope="col"><strong>State/Retailer</strong></th></tr>
<tr><td>Baked Spaghetti</td><td>72251528211</td><td>7/8/26<br>- 8/5/26</td><td>Food Lion -VA, NC&nbsp;<br>Harris Teeter-Wmsbg.VA&nbsp;<br>Kroger-VA, WVA<br>Libbie Market-VA<br>Military RS-VA<br>Publix-VA<br>25th Street Market_VA<br>Ukrop&rsquo;s Market Hall<br>Wegmans-Short Pump/Fredericksburg/<br>Midlothian, VA</td></tr>
<tr><td>Chicken Cobbler - Bulk</td><td>72251529457</td><td>7/8/26 -<br>8/5/26</td><td>Food Lion-NC&nbsp;<br>Kroger-VA WVA</td></tr>
<tr><td>Bread Pudding with<br>Vanilla Sauce</td><td>72251528044</td><td>7/6/26 -<br>8/3/26</td><td>Food Lion-VA, NC&nbsp;<br>Harris Teeter-Wmsbg, VA<br>Kroger- VA, WV, KY<br>Military Retail &ndash; VA<br>Publix-VA<br>25th Street Market &ndash; VA Ukrop&rsquo;s Market Hall</td></tr>
</tbody></table>`;

test('Ukrop’s: a flattened State/Retailer table yields exactly its conventional states', () => {
  const table = distributionTableStates(UKROPS_TABLE);
  // Kentucky comes from the bread-pudding row alone, which is why copying the
  // FSIS sibling notice's three states would have been wrong as well as
  // inferential — the FDA notice covers products FSIS does not.
  assert.deepEqual(table.states, ['Kentucky', 'North Carolina', 'Virginia', 'West Virginia']);
});

test('Ukrop’s: "WVA" is reported, never guessed — and costs this notice nothing', () => {
  const table = distributionTableStates(UKROPS_TABLE);
  // The same column spells West Virginia conventionally ("Kroger- VA, WV, KY"),
  // so refusing to interpret the non-standard fragment loses no state here.
  assert.ok(table.unresolvedTokens.includes('WVA'));
  assert.ok(table.states.includes('West Virginia'));
  // "RS" (Military Resale Store) is a retailer fragment and is equally unread.
  assert.ok(table.unresolvedTokens.includes('RS'));
  assert.equal(table.states.length, 4);
});

test('Ukrop’s: the store names survive separately from the state tokens', () => {
  const table = distributionTableStates(UKROPS_TABLE);
  // Lines carrying no state at all are the pure retailer rows, kept whole.
  assert.ok(table.nonStateLines.includes('Ukrop’s Market Hall'));
  // And no line is returned as the malformed retailer/state hybrid.
  assert.ok(!table.nonStateLines.some((line) => /Food Lion-NC Kroger/.test(line)));
});

test('the baked-spaghetti case moves from unknown to its four states', () => {
  const evidence = derive(
    'Ukrop’s Homestyle Foods, LLC today is voluntarily recalling six products.',
    {
      summaryHtml: UKROPS_TABLE,
    },
  );
  assert.equal(evidence.geography.scope, 'states');
  assert.deepEqual(evidence.geography.states, [
    'Kentucky',
    'North Carolina',
    'Virginia',
    'West Virginia',
  ]);
  assert.deepEqual(evidence.bases, ['table']);
});

// ── Forms the derivation must read ──────────────────────────────────────────

test('multiple explicit state names in one distribution sentence', () => {
  const evidence = derive(
    'These items were shipped to retail locations in North Carolina, Virginia, ' +
      'West Virginia, the Department of Defense and online sales.',
  );
  assert.deepEqual(evidence.geography.states, ['North Carolina', 'Virginia', 'West Virginia']);
});

test('a declared list of conventional abbreviations keeps its FIRST state', () => {
  // The bug this fixes: only codes preceded by a comma were read, so "SD" —
  // introduced by the colon — was dropped and a South Dakota shopper was
  // told the recall did not affect them.
  const evidence = derive(
    'These sandwiches were distributed in grocery stores, convenience stores, ' +
      'etc. in the following states: SD, ND, MN, IA, WY.',
  );
  assert.deepEqual(evidence.geography.states, [
    'Iowa',
    'Minnesota',
    'North Dakota',
    'South Dakota',
    'Wyoming',
  ]);
});

test('a table header that names distribution earns its column only if it holds states', () => {
  const states = `<table><tbody>
    <tr><th>STORE</th><th>DISTRIBUTION</th></tr>
    <tr><td>Trader Joe’s</td><td>AL, IA, IL, IN</td></tr></tbody></table>`;
  // A live "Distributed to" column holds Albert's Organics, Walmart, UNFI and
  // Sprouts. One row happening to carry a state code does not turn the column
  // into a state list — reading it that way would state a distribution the
  // notice never claimed, from a retailer's own footprint.
  const retailers = `<table><tbody>
    <tr><th>Item Description</th><th>Distributed to</th></tr>
    <tr><td>Vegetable Medley</td><td>Walmart - TX</td></tr>
    <tr><td>Whole Carrots</td><td>Albert's Organics</td></tr>
    <tr><td>Organic Medley</td><td>UNFI</td></tr></tbody></table>`;
  assert.deepEqual(distributionTableStates(states).states, [
    'Alabama',
    'Illinois',
    'Indiana',
    'Iowa',
  ]);
  assert.deepEqual(distributionTableStates(retailers).states, []);
});

// ── Everything that must NEVER become geography ─────────────────────────────

test('a recalling firm’s own location is not a distribution destination', () => {
  const evidence = derive(
    'Metro Produce Distributors Inc. of Minneapolis, Minnesota, is voluntarily ' +
      'recalling all Lunds & Byerlys fresh guacamole products with a use-by date ' +
      'of August 2, 2024.',
  );
  assert.equal(evidence.geography.scope, 'unknown');
  assert.deepEqual(evidence.geography.states, []);
});

test('a headquarters sentence is not a distribution destination', () => {
  const evidence = derive(
    'The company, headquartered in Boise, Idaho, has sold products for 40 years.',
  );
  assert.equal(evidence.geography.scope, 'unknown');
});

test('a store-address table is not a distribution table', () => {
  const addresses = `<table><tbody>
    <tr><th>Address</th><th>City</th><th>State</th><th>Zip</th></tr>
    <tr><td>2145 Roosevelt Ave</td><td>Springfield</td><td>MA</td><td>01104</td></tr>
    <tr><td>501 Memorial Dr</td><td>Chicopee</td><td>CT</td><td>01020</td></tr></tbody></table>`;
  assert.deepEqual(distributionTableStates(addresses).states, []);
});

test('a contact block is never read as distribution', () => {
  const evidence = derive(
    'Consumers with questions may contact the company in Richmond, Virginia at ' +
      '804-340-3050 or susan.rowe@ukrops.com.',
  );
  assert.equal(evidence.geography.scope, 'unknown');
  assert.deepEqual(distributionSentences('Please call our Ohio office at 555-123-4567.'), []);
});

test('a city with no state the source attached to it stays unknown', () => {
  const evidence = derive('The product was distributed to six retail locations in Springfield.');
  assert.equal(evidence.geography.scope, 'unknown');
  assert.deepEqual(evidence.geography.states, []);
});

test('a vague region is not a state list', () => {
  const evidence = derive(
    'The recalled Bison Burgers were distributed across Eastern & Central U.S. markets.',
  );
  assert.equal(evidence.geography.scope, 'unknown');
});

// ── Widening only ───────────────────────────────────────────────────────────

test('nationwide is never second-guessed, narrowed, or re-derived', () => {
  const nationwide: Geography = {
    scope: 'nationwide',
    states: [],
    confidence: 'stated',
    sourceText: 'Nationwide',
  };
  const evidence = derive('These items were shipped to retail locations in Ohio and Indiana.', {
    carried: nationwide,
  });
  assert.deepEqual(evidence.geography, nationwide);
  assert.deepEqual(evidence.addedStates, []);
});

test('a stated state list is preserved and only widened', () => {
  const carried: Geography = {
    scope: 'states',
    states: ['Ohio'],
    confidence: 'stated',
    sourceText: 'Ohio',
  };
  const evidence = derive('These items were shipped to retail locations in Indiana.', { carried });
  assert.deepEqual(evidence.geography.states, ['Indiana', 'Ohio']);
  assert.deepEqual(evidence.addedStates, ['Indiana']);
  assert.deepEqual(evidence.removedStates, []);
});

test('a stated list the text does not repeat is still preserved in full', () => {
  const carried: Geography = {
    scope: 'states',
    states: ['Alaska', 'Hawaii'],
    confidence: 'stated',
    sourceText: 'Alaska, Hawaii',
  };
  // FSIS states arrive structured; the prose need not mention them at all.
  const evidence = derive('The problem was discovered during a label review.', { carried });
  assert.deepEqual(evidence.geography.states, ['Alaska', 'Hawaii']);
  assert.equal(evidence.geography.confidence, 'stated');
});

test('nationwide is only READ for a case that has no state list yet', () => {
  const carried: Geography = {
    scope: 'states',
    states: ['Ohio'],
    confidence: 'stated',
    sourceText: 'Ohio',
  };
  const evidence = derive('Some of the products were distributed nationwide.', { carried });
  assert.equal(evidence.geography.scope, 'states');
  assert.deepEqual(evidence.geography.states, ['Ohio']);
});

test('an unknown case whose prose says nationwide becomes nationwide', () => {
  const evidence = derive('These items were shipped to retail locations nationwide.');
  assert.equal(evidence.geography.scope, 'nationwide');
  assert.deepEqual(evidence.geography.states, []);
});

test('the ONLY state ever removed is one proved to be a containment artifact', () => {
  const carried: Geography = {
    scope: 'states',
    states: ['Indiana', 'Virginia', 'West Virginia'],
    confidence: 'stated',
    sourceText: 'Indiana, Virginia, West Virginia',
  };
  // The notice says only "West Virginia"; the stored "Virginia" was matched
  // inside it, and asserting a recall reached Virginia is a false positive.
  const evidence = derive(
    'These items were shipped to retail locations in Indiana and West Virginia.',
    {
      carried,
    },
  );
  assert.deepEqual(evidence.removedStates, ['Virginia']);
  assert.deepEqual(evidence.geography.states, ['Indiana', 'West Virginia']);
});

test('a state the notice really names is never removed', () => {
  const carried: Geography = {
    scope: 'states',
    states: ['Virginia', 'West Virginia'],
    confidence: 'stated',
    sourceText: 'Virginia, West Virginia',
  };
  const evidence = derive('These items were shipped to Virginia and West Virginia.', { carried });
  assert.deepEqual(evidence.removedStates, []);
  assert.deepEqual(evidence.geography.states, ['Virginia', 'West Virginia']);
});

test('scope and state list can never contradict each other', () => {
  for (const text of [
    'These items were shipped to retail locations in Ohio.',
    'The problem was found during a label review.',
    'These items were shipped nationwide.',
  ]) {
    const { geography } = derive(text);
    assert.equal(geography.scope === 'states', geography.states.length > 0, text);
  }
});

test('derivation is deterministic and idempotent', () => {
  const once = derive('These items were shipped to retail locations in Ohio and Indiana.');
  const twice = evaluateGeographyEvidence({
    title: 'A Firm Recalls A Product',
    summaryText: 'These items were shipped to retail locations in Ohio and Indiana.',
    summaryHtml: null,
    carried: once.geography,
  });
  assert.deepEqual(twice.geography.states, once.geography.states);
  assert.deepEqual(twice.addedStates, []);
});
