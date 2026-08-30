/**
 * GTIN normalization (C9): structurally valid or nothing. Fixtures use
 * real identifier shapes from FDA/FSIS notices — spaced UPCs, hyphenated
 * EANs, Julian pack codes, establishment numbers, best-by dates.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { exactMatchGtins, hasValidCheckDigit, normalizeGtin } from './gtin';

test('exact valid GTINs normalize correctly across printed representations', () => {
  // UPC-A as printed with legibility spacing (Outshine-style caption).
  const spaced = normalizeGtin('0 41548 61004 7');
  assert.ok(spaced.ok);
  assert.equal(spaced.digits, '041548610047');
  assert.equal(spaced.length, 12);
  assert.equal(spaced.key, '00041548610047');
  assert.equal(spaced.ambiguous, false);

  // The same identifier hyphenated, bare, and as a zero-padded EAN-13:
  // one canonical key for all four spellings.
  for (const spelling of ['0-41548-61004-7', '041548610047', '0041548610047']) {
    const result = normalizeGtin(spelling);
    assert.ok(result.ok, `${spelling} must normalize`);
    assert.equal(result.key, spaced.key, `${spelling} must share the canonical key`);
  }

  // EAN-13 and GTIN-14.
  const ean = normalizeGtin('4006381333931');
  assert.ok(ean.ok);
  assert.equal(ean.length, 13);
  assert.equal(ean.key, '04006381333931');
  const gtin14 = normalizeGtin('10041548610044');
  assert.ok(gtin14.ok);
  assert.equal(gtin14.length, 14);
  assert.equal(gtin14.key, '10041548610044');
});

test('an invalid check digit rejects the value — a corrupted UPC never matches', () => {
  // Valid UPC-A 036000291452 with its last digit flipped.
  const flipped = normalizeGtin('036000291453');
  assert.equal(flipped.ok, false);
  assert.equal(!flipped.ok && flipped.reason, 'check-digit');
  // A single wrong interior digit fails too.
  const interior = normalizeGtin('036100291452');
  assert.equal(interior.ok, false);
  assert.ok(hasValidCheckDigit('036000291452'));
  assert.ok(!hasValidCheckDigit('036000291453'));
});

test('lot codes, dates, establishment numbers, and package codes are never GTINs', () => {
  for (const notAGtin of [
    'LLA616903', // lot code (Outshine)
    '26192', // Julian pack code (Dairyland)
    '07/11/26', // printed date
    '2026-08-31', // ISO date
    'EST. 4247', // USDA establishment number
    'P-4247', // USDA poultry establishment
    'Best By 11/13/2024',
    '030-2021', // FSIS recall number
    '12345678901', // 11 digits — a UPC missing a digit is not repaired
    '123456789', // 9 digits
    '', // nothing
    '4 oz', // measurement
  ]) {
    const result = normalizeGtin(notAGtin);
    assert.equal(result.ok, false, `${JSON.stringify(notAGtin)} must be rejected`);
  }
});

test('leading zeros are significant and preserved, never stripped or extended', () => {
  const result = normalizeGtin('041548610047');
  assert.ok(result.ok);
  assert.equal(result.digits, '041548610047', 'printed digits keep their zero');
  // An 11-digit run that WOULD validate if zero-padded is still rejected:
  // padding into a match is repair, and repair is guessing.
  const elevenDigits = normalizeGtin('41548610047');
  assert.equal(elevenDigits.ok, false);
  assert.equal(!elevenDigits.ok && elevenDigits.reason, 'unsupported-length');
});

test('8-digit codes validate but stay ambiguous — never exact-match material', () => {
  // 96385074 is a check-digit-valid EAN-8.
  const eight = normalizeGtin('96385074');
  assert.ok(eight.ok);
  assert.equal(eight.ambiguous, true);
  // exactMatchGtins refuses it even though it is structurally valid.
  assert.deepEqual(exactMatchGtins(['96385074']), []);
});

test('exactMatchGtins deduplicates on the canonical key and keeps source order', () => {
  const gtins = exactMatchGtins([
    '041548610047',
    '0 41548 61004 7', // same identifier, different spelling — collapses
    'LLA616903', // not a GTIN — dropped
    '036000291452', // second distinct identifier
    '036000291453', // corrupted — dropped
  ]);
  assert.deepEqual(
    gtins.map((gtin) => gtin.key),
    ['00041548610047', '00036000291452'],
  );
});
