import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildShareMessage, type ShareMessageInput } from './share-message';

function input(overrides: Partial<ShareMessageInput> = {}): ShareMessageInput {
  return {
    productName: 'Caesar Salad Kits',
    firmDisplayName: 'Fresh Express',
    brands: ['Marketside'],
    whatHappened: 'Fresh Express recalled salad kits because they may contain undeclared egg.',
    consumerAction: 'Do not eat the product. Return it to the place of purchase for a refund.',
    agencyLabel: 'FDA',
    officialUrl: 'https://www.fda.gov/safety/recalls/example',
    ...overrides,
  };
}

test('the message carries the canonical facts and ends with the official URL', () => {
  const share = buildShareMessage(input());
  assert.equal(share.title, 'Recall: Caesar Salad Kits');
  assert.match(share.message, /^Food recall: Caesar Salad Kits/);
  assert.match(share.message, /Company: Fresh Express/);
  assert.match(share.message, /undeclared egg/);
  assert.match(share.message, /What to do: Do not eat the product/);
  assert.ok(
    share.message.endsWith('Official FDA notice: https://www.fda.gov/safety/recalls/example'),
    'official URL must close the message',
  );
});

test('a missing company falls back to the brand line; missing both drops the line', () => {
  const brandOnly = buildShareMessage(input({ firmDisplayName: null }));
  assert.match(brandOnly.message, /Brand: Marketside/);
  assert.ok(!brandOnly.message.includes('Company:'));

  const neither = buildShareMessage(input({ firmDisplayName: null, brands: [] }));
  assert.ok(!neither.message.includes('Company:'));
  assert.ok(!neither.message.includes('Brand:'));
});

test('a missing consumer action drops its line cleanly', () => {
  const share = buildShareMessage(input({ consumerAction: null }));
  assert.ok(!share.message.includes('What to do'));
});

test('no output ever contains null/undefined placeholders or blank lines from missing fields', () => {
  const sparse = buildShareMessage(
    input({ firmDisplayName: null, brands: ['', '  '], consumerAction: '   ' }),
  );
  assert.ok(!/\b(?:null|undefined)\b/.test(sparse.message));
  assert.ok(!/\n\s*\n\s*\n/.test(sparse.message), 'no collapsed empty sections');
  assert.ok(!sparse.message.includes('Brand:'), 'whitespace-only brands are not a brand line');
});

test('the official URL is mandatory', () => {
  assert.throws(() => buildShareMessage(input({ officialUrl: '  ' })), TypeError);
});

test('the input type has no place for personalization — nothing personal can leak', () => {
  // Compile-time contract restated at runtime: the composed message is a pure
  // function of these seven canonical fields and contains only them.
  const fields = Object.keys(input()).sort();
  assert.deepEqual(fields, [
    'agencyLabel',
    'brands',
    'consumerAction',
    'firmDisplayName',
    'officialUrl',
    'productName',
    'whatHappened',
  ]);
  const share = buildShareMessage(input());
  for (const personal of ['Your allergen', 'Sold at', 'affects you', 'Affects me']) {
    assert.ok(!share.message.includes(personal));
  }
});

test('FSIS agency label reads as USDA FSIS in the source line', () => {
  const share = buildShareMessage(input({ agencyLabel: 'USDA FSIS' }));
  assert.match(share.message, /Official USDA FSIS notice: /);
});
