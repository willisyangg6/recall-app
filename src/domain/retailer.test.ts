import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractRetailerNames, isRetailerName, retailersWithPlaces } from './retailer';

// Phrasings verbatim from recorded real FDA announcements.

test('source-stated retailers are extracted from sold-at constructions', () => {
  assert.deepEqual(
    extractRetailerNames(
      'is recalling lot 3896 of Wellsley Farms Farm-Raised Atlantic Salmon sold in 2-lb bags at BJ’s Wholesale Club stores due to the potential',
    ),
    ['BJ’s Wholesale Club'],
  );
  assert.deepEqual(
    extractRetailerNames(
      'The recalled product was shipped to Publix retail stores throughout 8 states.',
    ),
    ['Publix'],
  );
  assert.deepEqual(
    extractRetailerNames('distributed to Publix grocery stores in the company’s operating area'),
    ['Publix'],
  );
  assert.deepEqual(
    extractRetailerNames(
      'The Jalapenos were distributed to the following Costco locations: Store #1487',
    ),
    ['Costco'],
  );
  assert.deepEqual(extractRetailerNames('sold in 34 Walmart stores across the state'), ['Walmart']);
});

test('retailers are never inferred: generic venues, footprints, and states do not qualify', () => {
  // Generic venue words, not a retailer relationship.
  assert.deepEqual(extractRetailerNames('is sold in the frozen section.'), []);
  assert.deepEqual(
    extractRetailerNames('were sold at grocery stores, select restaurants, and wholesalers'),
    [],
  );
  // Corporate-footprint boilerplate carries no distribution meaning.
  assert.deepEqual(extractRetailerNames('currently operates 1,413 stores in Florida'), []);
  // A state name in a store count is geography, not a retailer.
  assert.deepEqual(extractRetailerNames('sold in 34 Texas stores'), []);
  assert.deepEqual(extractRetailerNames(null), []);
  assert.deepEqual(extractRetailerNames('No retailer is mentioned here.'), []);
});

test('geography and languages can never become retailers', () => {
  // Boroughs and cities after "distributed in" are places, not stores.
  assert.deepEqual(
    extractRetailerNames(
      'The cream cheese was distributed in Brooklyn, Queens, Bronx and New York City area by direct delivery to retail stores and distributors.',
    ),
    [],
  );
  assert.deepEqual(
    extractRetailerNames('was distributed in Ann Arbor and Brighton, MI at 3 store locations.'),
    [],
  );
  // FSIS hotline boilerplate: a language is not a store.
  assert.deepEqual(
    extractRetailerNames(
      'The toll-free USDA Meat and Poultry Hotline is available in English and Spanish and can be reached from Monday to Friday.',
    ),
    [],
  );
  // Help-line domains are contact details.
  assert.ok(!isRetailerName('AskKaren.gov'));
  // Known cities fail retailer classification outright.
  assert.ok(!isRetailerName('Portland'));
  assert.ok(!isRetailerName('Ann Arbor and Brighton'));
});

test('a store list keeps its stores while the city list after "stores in" stays geography', () => {
  const text =
    'The affected salad was sold at Market of Choice stores in Ashland, Bend, Corvallis, Eugene Hillsboro, Medford, Portland, West Linn in Oregon between 4/16/2026 and 5/4/2026.';
  assert.deepEqual(extractRetailerNames(text), ['Market of Choice']);
});

test('retailersWithPlaces keeps the source-stated store→place relationships', () => {
  const covered = retailersWithPlaces(
    'was distributed to PCC Markets in Washington, Earth Fare Stores in Florida and South Carolina, and select independent retailers.',
  );
  assert.deepEqual(covered, [
    { retailer: 'PCC Markets', places: ['Washington'] },
    { retailer: 'Earth Fare Stores', places: ['Florida', 'South Carolina'] },
  ]);
  assert.deepEqual(retailersWithPlaces(null), []);
});

// ── Generic conjunction tails (O3-B5B Phase 6B) ─────────────────────────────
//
// "and <lowercase quantifier> …" after a named retailer is unnamed
// distribution prose, never a second identity. Phrasings verbatim from the
// recorded Sprout Organics notices (bounded excerpts) plus counterexamples.

test('a lowercase quantifier-led "and" tail is prose, not a second retailer', () => {
  // The recorded original-notice construction.
  assert.deepEqual(
    extractRetailerNames(
      'The product, a 3.5-ounce pouch, was sold in Walgreens and some independent stores in the US South region with most sales in Texas.',
    ),
    ['Walgreens'],
  );
  // This phrasing never matched the sold-at seam even before the rule
  // (conservative non-match, verified against the unmodified module) — the
  // requirement is that NO false identity appears.
  assert.deepEqual(
    extractRetailerNames('The affected lot was sold at Walgreens and other independent retailers.'),
    [],
  );
  assert.deepEqual(
    extractRetailerNames(
      'The product was sold in Walgreens and other independent stores in the region.',
    ),
    ['Walgreens'],
  );
  assert.deepEqual(
    extractRetailerNames('was available at Kroger and various local stores statewide'),
    ['Kroger'],
  );
  // The prose fragment alone must never become an identity.
  assert.equal(isRetailerName('some independent'), false);
});

test('the recorded expansion-notice construction still yields no false identity', () => {
  // Semicolon-separated distribution clauses ("in Walgreens; in independent
  // retailers in AZ, …; and online") — the state-list clause and the online
  // channel must not produce identities; Walgreens has no sold-at verb run
  // of its own here, so the sentence seam stays conservative.
  const sentence =
    'The product, a 3.5-ounce pouch, was sold in Walgreens; in independent retailers in AZ, CO, FL; and online. It was not sold in any other large retail chain besides Walgreens.';
  const names = extractRetailerNames(sentence);
  assert.ok(!names.some((n) => n.toLowerCase().includes('independent')), JSON.stringify(names));
  assert.ok(!names.some((n) => /\band\b/.test(n)), JSON.stringify(names));
});

test('capitalized conjunctions and legitimate names survive the tail rule', () => {
  // A capitalized right side is a NAME, not prose — preserved exactly.
  assert.equal(isRetailerName("H-E-B and Joe V's Smart Shop"), true);
  // Two genuinely named chains in a sold-at list keep exactly the behavior
  // the unmodified module had (verified old == new on this phrasing) — the
  // capitalized conjunction is never stripped by the tail rule.
  assert.deepEqual(
    extractRetailerNames('sold only at Costco, BJ’s Wholesale Club and Sam’s Club locations'),
    ['Costco', 'BJ’s Wholesale'],
  );
  assert.deepEqual(
    extractRetailerNames(
      'is recalling lot 3896 of Wellsley Farms Farm-Raised Atlantic Salmon sold in 2-lb bags at BJ’s Wholesale Club stores due to the potential',
    ),
    ['BJ’s Wholesale Club'],
  );
  // Ampersand names are untouched.
  assert.deepEqual(extractRetailerNames('sold at Bed Bath & Beyond stores nationwide'), [
    'Bed Bath & Beyond',
  ]);
  // Generic prose without any named retailer invents nothing.
  assert.deepEqual(
    extractRetailerNames('was sold in some independent stores and other retail outlets'),
    [],
  );
});
