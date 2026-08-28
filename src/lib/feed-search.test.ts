import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSearchEntry,
  extractCodeCandidates,
  filterBySearch,
  matchesSearch,
  normalizeSearchText,
  parseSearchQuery,
  type SearchableRecall,
} from './feed-search';

function recall(overrides: Partial<SearchableRecall> = {}): SearchableRecall {
  return {
    title: 'Fresh Express Salad Kits Recalled For Undeclared Egg',
    productDescription: 'Caesar Salad Kit 9.7 oz',
    brands: ['Fresh Express', 'Marketside'],
    firmName: 'Fresh Express Incorporated',
    retailerNames: ['Walmart', 'Kroger'],
    productNames: [
      'Caesar Salad Kit | UPC Code: 0 71279 30906 6 | Lot 24TJ0055',
      'Chopped Kit best by 08/09/2026, EST. 46841 inside the USDA mark',
    ],
    ...overrides,
  };
}

function matches(query: string, overrides: Partial<SearchableRecall> = {}): boolean {
  const parsed = parseSearchQuery(query);
  assert.ok(parsed, `query "${query}" parsed to null`);
  return matchesSearch(buildSearchEntry(recall(overrides)), parsed);
}

// ── Human text ───────────────────────────────────────────────────────────────

test('product, company, and brand match case-insensitively', () => {
  assert.equal(matches('FRESH EXPRESS'), true);
  assert.equal(matches('caesar salad'), true);
  assert.equal(matches('marketside'), true);
  assert.equal(matches('fresh express incorporated'), true);
});

test('retailer names match', () => {
  assert.equal(matches('kroger'), true);
  assert.equal(matches('walmart'), true);
  assert.equal(matches('costco'), false);
});

test('tokens AND together and ignore word order', () => {
  assert.equal(matches('salad express'), true);
  assert.equal(matches('salad costco'), false);
});

test('normalization strips diacritics and punctuation', () => {
  assert.equal(normalizeSearchText("Entrées — Café's!"), 'entrees cafe s');
  assert.equal(matches('entree', { title: 'Chicken Entrées' }), true);
  assert.equal(matches('ben jerry', { brands: ["Ben & Jerry's"] }), true);
});

test('affected product/variant lines are searchable', () => {
  assert.equal(matches('chopped kit'), true);
});

// ── Identifiers ──────────────────────────────────────────────────────────────

test('UPC matches with harmless punctuation and spacing differences', () => {
  assert.equal(matches('071279309066'), true);
  assert.equal(matches('0 71279 30906 6'), true);
  assert.equal(matches('0-71279-30906-6'), true);
  assert.equal(matches('UPC 071279309066'), true);
  assert.equal(matches('upc code: 0 71279 30906 6'), true);
});

test('lot and batch codes match, with or without their label prefix', () => {
  assert.equal(matches('24TJ0055'), true);
  assert.equal(matches('lot 24TJ0055'), true);
  assert.equal(matches('batch 24TJ0055'), true);
  assert.equal(matches('batch B1234', { productNames: ['Cookie dough Batch B1234 only'] }), true);
});

test('establishment numbers match when the notice states them', () => {
  assert.equal(matches('46841'), true);
  assert.equal(matches('EST. 46841'), true);
  assert.equal(matches('establishment 46841'), true);
});

test('numeric identifiers are never fuzzy-matched', () => {
  assert.equal(matches('071279309067'), false); // one wrong digit
  assert.equal(matches('24TJ0056'), false);
  assert.equal(matches('46842'), false);
});

test('code candidates join adjacent digit words but never leap across text', () => {
  assert.deepEqual(extractCodeCandidates('UPC 0 71279 30906 6'), [
    '71279',
    '30906',
    '071279309066',
  ]);
  // "854311007391" and "10x9Bag" are separated by words — no merged candidate.
  const codes = extractCodeCandidates('10x9Bag | Brand: Solata | UPC Code: 854311007391');
  assert.ok(codes.includes('854311007391'));
  assert.ok(!codes.some((code) => code.includes('10X9BAG854311007391')));
});

test('short numeric queries stay in text mode; digit-heavy phrases still text-match', () => {
  // Fewer than four digits never enters identifier mode.
  assert.equal(parseSearchQuery('9.7 oz')?.identifier, null);
  assert.equal(matches('9.7 oz'), true);
  // A digit-heavy phrase tries identifier mode, then falls back to exact text.
  assert.equal(matches('best by 08 09 2026'), true);
});

// ── No-op and composition guarantees ─────────────────────────────────────────

test('empty and whitespace-only search parse to null and filter as a strict no-op', () => {
  assert.equal(parseSearchQuery(''), null);
  assert.equal(parseSearchQuery('   '), null);
  const items = [1, 2, 3];
  const entryOf = () => buildSearchEntry(recall());
  assert.equal(filterBySearch(items, '', entryOf), items); // SAME instance
  assert.equal(filterBySearch(items, '  ', entryOf), items);
});

test('filterBySearch preserves input order and never mutates the input', () => {
  const items = [
    recall({ title: 'Alpha Peanut Butter', productNames: [] }),
    recall({ title: 'Beta Crackers', productNames: [] }),
    recall({ title: 'Gamma Peanut Snacks', productNames: [] }),
  ];
  const frozen = [...items];
  const result = filterBySearch(items, 'peanut', buildSearchEntry);
  assert.deepEqual(
    result.map((item) => item.title),
    ['Alpha Peanut Butter', 'Gamma Peanut Snacks'],
  );
  assert.deepEqual(items, frozen);
});

test('raw announcement HTML is not part of the searchable surface', () => {
  // The searchable type simply has no summary/HTML field — matching on one is
  // impossible by construction. This pins the field list.
  const entry = buildSearchEntry(recall());
  assert.deepEqual(Object.keys(entry).sort(), ['codes', 'text']);
});
