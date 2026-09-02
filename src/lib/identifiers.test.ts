import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractCodeDatePairs,
  extractDate,
  formatMeasurements,
  normalizeDateValue,
  normalizeUpc,
  normalizeUpcList,
  resolveDateWithCode,
  sentenceCaseValue,
  splitCompoundCell,
  splitTrailingPlacement,
} from './identifiers';

test('barcodes normalize losslessly and only at real barcode lengths', () => {
  // Printed with legibility spacing (real: Momchipz).
  assert.equal(normalizeUpc('6 28634 44216 6')?.display, '628634442166');
  assert.equal(normalizeUpc('6 28634 44216 6')?.raw, '6 28634 44216 6');
  // Leading zeroes are significant and preserved (real: Kroger).
  assert.equal(normalizeUpc('0001111079120')?.display, '0001111079120');
  assert.equal(normalizeUpc('7-43490-00010-4')?.display, '743490000104');
  // Arbitrary numbers are never claimed as barcodes.
  assert.equal(normalizeUpc('430'), null);
  assert.equal(normalizeUpc('41415-06453'), null); // 10 digits: not a UPC length
  assert.equal(normalizeUpc('None'), null);
  assert.equal(normalizeUpc('lot 2606022'), null);

  const list = normalizeUpcList('300871239418 or 300871239456');
  assert.deepEqual(
    list.map((v) => v.display),
    ['300871239418', '300871239456'],
  );
});

test('every readable date reaches one consumer standard', () => {
  // Real FDA orderings, including year-first all-caps and compact codes.
  for (const [source, expected] of [
    ['2026 AUGUST 31', 'August 31, 2026'],
    ['AUGUST 31, 2026', 'August 31, 2026'],
    ['31 AUG 2026', 'August 31, 2026'],
    ['14FEB2026', 'February 14, 2026'],
    ['2026-08-31', 'August 31, 2026'],
    // Numeric dates are month-first: the convention of every US federal notice.
    ['02/14/2026', 'February 14, 2026'],
    ['2/14/26', 'February 14, 2026'],
    ['12-04-19', 'December 4, 2019'],
  ] as const) {
    assert.equal(normalizeDateValue(source).display, expected, source);
  }
  // A first component above 12 cannot be a month, so nothing is guessed.
  assert.equal(normalizeDateValue('13/05/2026').display, '13/05/2026');
  assert.equal(normalizeDateValue('13/05/2026').canonical, undefined);
  // The source text is always retained.
  assert.equal(normalizeDateValue('2026 AUGUST 31').raw, '2026 AUGUST 31');
});

test('date ranges are standardized without collapsing what they mean', () => {
  // Within one year the year is stated once; across years both are needed,
  // because that distinction is exactly what a shopper checks.
  assert.equal(normalizeDateValue('7/13/2026 - 8/11/2026').display, 'July 13–August 11, 2026');
  assert.equal(
    normalizeDateValue('12/12/2026 - 1/2/2027').display,
    'December 12, 2026–January 2, 2027',
  );
  assert.equal(
    normalizeDateValue('from 4/26/2018 to 10/10/2018').display,
    'April 26–October 10, 2018',
  );
});

test('a qualifier is meaning, not formatting, and survives normalization', () => {
  // "through February 27" covers every date up to that day; collapsing it to a
  // single date would misstate which packages are affected.
  assert.equal(
    normalizeDateValue('through February 27, 2026').display,
    'Through February 27, 2026',
  );
  assert.equal(normalizeDateValue('before 3/1/2026').display, 'Before March 1, 2026');
  assert.equal(normalizeDateValue('on or before 3/1/2026').display, 'On or before March 1, 2026');
  assert.equal(normalizeDateValue('through February 27, 2026').raw, 'through February 27, 2026');
});

test('a date wrapped in other text is still read as a date', () => {
  assert.equal(extractDate('BB 11/13/2024')?.display, 'November 13, 2024');
  assert.equal(extractDate('03-15-2024 product of USA')?.display, 'March 15, 2024');
  // Nothing date-shaped means nothing is invented.
  assert.equal(extractDate('58 oz'), null);
  assert.equal(extractDate('LLA616903'), null);
});

test('a compound source cell splits into label, placement, and code/date pairs', () => {
  // Verbatim shape from the Outshine announcement.
  const cell = splitCompoundCell(
    'Batch code/ Best Before (bottom of package): LLA616903 – 30 SEP 2027 LLA617003 – 30 SEP 2027 LLA620303 – 31 OCT 2027',
  );
  assert.equal(cell.inlineLabel, 'Batch code/ Best Before');
  assert.equal(cell.locationHint, 'bottom of package');
  assert.equal(cell.pairs.length, 3);
  assert.deepEqual(cell.pairs[0], { code: 'LLA616903', date: '30 SEP 2027' });

  // A plain value is left alone.
  const plain = splitCompoundCell('Paper Bag');
  assert.equal(plain.inlineLabel, null);
  assert.equal(plain.locationHint, null);
  assert.deepEqual(plain.pairs, []);
  assert.equal(plain.body, 'Paper Bag');
});

test('measurements get their space back, everywhere and losslessly', () => {
  assert.equal(formatMeasurements('3oz (85 g)'), '3 oz (85 g)');
  assert.equal(formatMeasurements('Net Wt. 8 oz (227g)'), 'Net Wt. 8 oz (227 g)');
  assert.equal(formatMeasurements('12oz, 20oz'), '12 oz, 20 oz');
  assert.equal(formatMeasurements('2.5 ounce Fruit Bars'), '2.5 ounce Fruit Bars');
  // Unrecognized units and non-measurements are left exactly as written.
  assert.equal(formatMeasurements('LLA616903'), 'LLA616903');
  assert.equal(formatMeasurements('Model 5X'), 'Model 5X');
});

test('a stray digit against a barcode is not read as part of it', () => {
  // Real caption: "UPC Bottom of Package:2 041548816678". 1 + 12 digits is a
  // valid EAN-13 length, so the corrupted value would otherwise pass.
  assert.equal(normalizeUpc('2 041548816678')?.display, '041548816678');
  // A genuinely spaced UPC has no standalone-length segment, so it survives.
  assert.equal(normalizeUpc('6 28634 44216 6')?.display, '628634442166');
});

test('a placement phrase is split out of the value it was riding inside', () => {
  assert.deepEqual(splitTrailingPlacement('2026 AUGUST 31, back of package'), {
    value: '2026 AUGUST 31',
    placement: 'back of package',
  });
  assert.deepEqual(splitTrailingPlacement('August 31, 2026'), {
    value: 'August 31, 2026',
    placement: null,
  });
  // Never strip so much that no identifier is left.
  assert.equal(splitTrailingPlacement('bottom of package').placement, null);
});

test('codes printed with their calendar date keep the pairing', () => {
  assert.deepEqual(extractCodeDatePairs('LLA616903 – 30 SEP 2027 LLA617003 – 31 OCT 2027'), [
    { code: 'LLA616903', date: '30 SEP 2027' },
    { code: 'LLA617003', date: '31 OCT 2027' },
  ]);
  assert.deepEqual(extractCodeDatePairs('26192 (07/11/26), 26196 (07/15/26)'), [
    { code: '26192', date: '07/11/26' },
    { code: '26196', date: '07/15/26' },
  ]);
});

test('a Julian pack code proves the order of the date beside it — and only then', () => {
  // Day 192 of 2026 IS July 11, so the notice stated the same day twice.
  const resolved = resolveDateWithCode('07/11/26', '26192');
  assert.equal(resolved.display, 'July 11, 2026');
  assert.equal(resolved.canonical, 'date:2026-07-11');
  // A code that resolves to a different day proves nothing; source wording stands.
  assert.equal(resolveDateWithCode('07/11/26', '26200').display, '07/11/26');
  // A code that is not a Julian date proves nothing either.
  assert.equal(resolveDateWithCode('07/11/26', 'LLA616903').display, '07/11/26');
  assert.equal(resolveDateWithCode('07/11/26', '26192').raw, '07/11/26');
});

test('one date written two ways shares a canonical identity', () => {
  assert.equal(normalizeDateValue('2026 AUGUST 31').canonical, 'date:2026-08-31');
  assert.equal(normalizeDateValue('August 31, 2026').canonical, 'date:2026-08-31');
  // Numeric dates are read month-first, the convention of every US federal
  // notice, so they reach the same consumer standard as every other form.
  assert.equal(normalizeDateValue('8/31/26').canonical, 'date:2026-08-31');
});

test('a bounded span is one range, never two endpoint days', () => {
  // "between X and Y" covers every date in the window; splitting it on "and"
  // told an egg buyer only the two endpoint days were affected.
  const between = normalizeDateValue('between July 20, 2026 and August 17, 2026');
  assert.equal(between.display, 'July 20–August 17, 2026');
  assert.equal(between.canonical, 'range:date:2026-07-20:date:2026-08-17');
  assert.equal(
    normalizeDateValue('ranging 9/1/24 – 11/23/24').display,
    'September 1–November 23, 2024',
  );
  // A range stating its year once, at the end, lends it to the start.
  assert.equal(
    normalizeDateValue('July 20 – August 17, 2026').canonical,
    'range:date:2026-07-20:date:2026-08-17',
  );
});

test('a month-granular span keeps month granularity at both ends', () => {
  const span = normalizeDateValue('between November 2028 through May 2029');
  assert.equal(span.display, 'November 2028–May 2029');
  assert.equal(span.canonical, 'range:month:2028-11:month:2029-05');
  // An INCOMPLETE span never normalizes — and the value contract downstream
  // refuses to render it raw.
  assert.equal(normalizeDateValue('between November 2028 through').canonical, undefined);
});

test('Canadian bilingual month codes read as the day they name', () => {
  // "2028 FE 04" on a PRODUCT OF CANADA can; the notice's own production date
  // (February 4, 2026, a two-year shelf life) corroborates FE = February.
  assert.equal(normalizeDateValue('2028 FE 04').display, 'February 4, 2028');
  assert.equal(normalizeDateValue('2024 NO 07').canonical, 'date:2024-11-07');
  assert.equal(normalizeDateValue('2024 AL 01').display, 'April 1, 2024');
  // Unknown two-letter runs stay untouched.
  assert.equal(normalizeDateValue('2024 XX 07').canonical, undefined);
});

test('safe textual values sentence-case through one shared renderer', () => {
  assert.equal(sentenceCaseValue('vacuum package'), 'Vacuum package');
  assert.equal(sentenceCaseValue('glass jars'), 'Glass jars');
  // Acronyms, brands, and intentional casing are never touched.
  assert.equal(sentenceCaseValue('RTE tray'), 'RTE tray');
  assert.equal(sentenceCaseValue('iSnack pouch'), 'iSnack pouch');
  // A value opening with its measurement reads correctly as is.
  assert.equal(sentenceCaseValue('12 oz plastic cups'), '12 oz plastic cups');
});

test('a bare "up to" bound reads as Through, and complete year-less spans stay raw', () => {
  assert.equal(normalizeDateValue('up to January 23, 2022').display, 'Through January 23, 2022');
  assert.ok(normalizeDateValue('up to January 23, 2022').canonical);
  // "11-28 thru 12-15" is the marking exactly as printed — no year to invent,
  // both endpoints present. It does not normalize and it is not malformed.
  assert.equal(normalizeDateValue('11-28 thru 12-15').canonical, undefined);
});

test('a range whose ends carry list commas still normalizes as one range', () => {
  // "from July 8, 2026, to June 29, 2027" — the comma after the start date is
  // the source's grammar, not date content. Failing to read the range split
  // it into two endpoint days downstream, misstating which packages match.
  assert.deepEqual(normalizeDateValue('from July 8, 2026, to June 29, 2027'), {
    display: 'July 8, 2026–June 29, 2027',
    raw: 'from July 8, 2026, to June 29, 2027',
    canonical: 'range:date:2026-07-08:date:2027-06-29',
  });
  assert.deepEqual(normalizeDateValue('between November 30, 2021, and January 8, 2022'), {
    display: 'November 30, 2021–January 8, 2022',
    raw: 'between November 30, 2021, and January 8, 2022',
    canonical: 'range:date:2021-11-30:date:2022-01-08',
  });
});
