/**
 * The shared separator policy for structured identifier lists.
 *
 * Every input below is a verbatim fragment from a recorded real announcement.
 * The two defects this module exists for are pinned first: Everything Sprouts'
 * `LOT# 223, 226, 230, & 233`, which produced a fourth "lot code" of `& 233`,
 * and Al'Fez Natural Tahini's semicolon-delimited best-before list, of which
 * only the first value survived.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hasProseWordRun,
  isTimeOrPhoneFragment,
  resolveEmbeddedLabel,
  splitDateList,
  splitEmbeddedFieldLabel,
  splitIdentifierList,
  stripListConnectors,
  stripTrailingProse,
} from './identifier-lists';

test('an ampersand separates identifiers and never survives inside one', () => {
  // Everything Sprouts, verbatim: "…Barcode 087906000075, LOT# 223, 226, 230, & 233."
  assert.deepEqual(splitIdentifierList('223, 226, 230, & 233'), ['223', '226', '230', '233']);
  // Vesta Fiery Gourmet joins its last two barcodes with a bare ampersand.
  assert.deepEqual(splitIdentifierList('7 94571 99491 1 & 7 94571 99499 7'), [
    '7 94571 99491 1',
    '7 94571 99499 7',
  ]);
});

test('commas, semicolons, "and", "or" and a spaced plus all separate', () => {
  assert.deepEqual(splitIdentifierList('1472, 1481, 1531'), ['1472', '1481', '1531']);
  assert.deepEqual(splitIdentifierList('3115; 3123; or 3114'), ['3115', '3123', '3114']);
  assert.deepEqual(splitIdentifierList('25E04-A and 25E04-B'), ['25E04-A', '25E04-B']);
  assert.deepEqual(splitIdentifierList('223 + 226'), ['223', '226']);
});

test('a separator character inside a code is not a separator', () => {
  // No whitespace around the plus, so it belongs to the code.
  assert.deepEqual(splitIdentifierList('A+B'), ['A+B']);
  // Hyphens, dots, slashes and internal spacing are part of printed codes.
  for (const code of ['088594-2-1', 'GP.1051.18', '190A26184 - 190A26216', '6 28634 44216 6']) {
    assert.deepEqual(splitIdentifierList(code), [code]);
  }
});

test('identifiers stay strings: leading zeroes, letters and hyphens survive', () => {
  assert.deepEqual(splitIdentifierList('050011, 0001111079120, and 010218-1'), [
    '050011',
    '0001111079120',
    '010218-1',
  ]);
  // No arithmetic and no digit grouping: a seven-digit code is seven digits.
  assert.deepEqual(splitIdentifierList('2606022'), ['2606022']);
});

test('a seam left by an upstream split is stripped from either end', () => {
  assert.equal(stripListConnectors(', & 233'), '233');
  assert.equal(stripListConnectors('and #24150'.replace('#', '')), '24150');
  assert.equal(stripListConnectors('B241851006 and'), 'B241851006');
  assert.equal(stripListConnectors('5 265 •'), '5 265');
});

test('a date list splits without breaking a range or a bare-year comma', () => {
  assert.deepEqual(splitDateList('12/04/19, 12/10/19, 12/20/19'), [
    '12/04/19',
    '12/10/19',
    '12/20/19',
  ]);
  // Al'Fez publishes its four best-before markings semicolon-delimited.
  assert.deepEqual(splitDateList('“2024 JL 31”; “2024 SE 09”; “2025 MR 27”; “2025 AL 04”'), [
    '“2024 JL 31”',
    '“2024 SE 09”',
    '“2025 MR 27”',
    '“2025 AL 04”',
  ]);
  // A range is one value; the comma before a bare year is part of its date.
  assert.deepEqual(splitDateList('7/13/2026 - 8/11/2026'), ['7/13/2026 - 8/11/2026']);
  assert.deepEqual(splitDateList('July 11, 2026'), ['July 11, 2026']);
});

test('a field label repeated inside a value is separated from the identifier', () => {
  // Channel Fish: "…with a lot code of 22739 and date code of 17037."
  assert.deepEqual(splitEmbeddedFieldLabel('date code of 17037'), {
    label: 'date code',
    value: '17037',
  });
  assert.deepEqual(splitEmbeddedFieldLabel('a package date of 9/30/2016'), {
    label: 'package date',
    value: '9/30/2016',
  });
  // A code that merely opens with a word is not a label.
  assert.equal(splitEmbeddedFieldLabel('EX 0225'), null);
  assert.equal(splitEmbeddedFieldLabel('GP.1051.18'), null);
});

test('an embedded label of the same kind is removed; a different kind is dropped', () => {
  assert.equal(resolveEmbeddedLabel('lot', 'lot code 22740'), '22740');
  assert.equal(resolveEmbeddedLabel('lot', 'Lot codes 1624001 - 1624129'), '1624001 - 1624129');
  // A date code and a package date are not lot codes, whatever list they were
  // split out of.
  assert.equal(resolveEmbeddedLabel('lot', 'date code of 17037'), null);
  assert.equal(resolveEmbeddedLabel('lot', 'a package date of 9/30/2016'), null);
  assert.equal(resolveEmbeddedLabel('lot', 'a product code of 61306'), null);
  // Values carrying no label pass through untouched.
  assert.equal(resolveEmbeddedLabel('lot', '190A26184'), '190A26184');
});

test('clock times, phone numbers and extensions are not identifiers', () => {
  // Valley Meats prints production times beside its codes.
  for (const fragment of [
    'time stamp 1',
    'a time stamp of 13',
    'time stamps between 7:36:38AM to 08:00:48AM',
    '1:02:55PM',
    '8:00 a.m.',
  ]) {
    assert.ok(isTimeOrPhoneFragment(fragment), fragment);
  }
  for (const fragment of ['(888) 542-5849', '1-800-538-9543', '760.230.9547', 'ext. 4021']) {
    assert.ok(isTimeOrPhoneFragment(fragment), fragment);
  }
});

test('rejection stays off legitimate codes', () => {
  for (const code of [
    '190A26184',
    'LLA616903',
    '25E04-A',
    '088594-2-1',
    '050011',
    'C 08 05 23',
    '041548610047',
    '2457744.2',
    'GP.1051.18',
    '1623129 - 1623365',
  ]) {
    assert.equal(isTimeOrPhoneFragment(code), false, code);
    assert.equal(hasProseWordRun(code), false, code);
  }
});

test('a sentence tail carried into a code is recognized and trimmed', () => {
  assert.ok(hasProseWordRun('EX 0624 El Chilar Ground Cinnamon'));
  assert.ok(hasProseWordRun('133 tested positive for L'));
  // Fromi, Little Leaf Farms and Savannah Bee each state a real code and then
  // keep writing; the code is what is kept.
  assert.equal(stripTrailingProse('615 appears on both the wooden box'), '615');
  assert.equal(stripTrailingProse('050011 as the first six digits'), '050011');
  assert.equal(
    stripTrailingProse('025255 of its Mint Leaf Date Sweetened Chocolate Bar'),
    '025255',
  );
  // A capitalized run is a proper name, not sentence continuation: Whole
  // Foods' own brand IS the number 365, and trimming here would invent the
  // lot code "365" out of a product name.
  assert.equal(
    stripTrailingProse('365 Whole Foods Market Small Bites Macaroni'),
    '365 Whole Foods Market Small Bites Macaroni',
  );
  // Nothing to trim leaves the value exactly as the source wrote it.
  assert.equal(stripTrailingProse('190A26184'), '190A26184');
  assert.equal(stripTrailingProse('24171 1E'), '24171 1E');
});

test('a period-delimited code splits as one value, not at its periods', () => {
  // FSIS publishes these three verbatim: "lot code GP.1051.18", "lot code
  // 2457744.2", "lot code is 2025.6.30".
  for (const code of ['GP.1051.18', '2457744.2', '2025.6.30', '1.22']) {
    assert.deepEqual(splitIdentifierList(code), [code]);
  }
  // A list of them still separates on the list separators only.
  assert.deepEqual(splitIdentifierList('2024.5.26, 2024.4.28, and 2023.7.29'), [
    '2024.5.26',
    '2024.4.28',
    '2023.7.29',
  ]);
});
