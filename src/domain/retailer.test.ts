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
