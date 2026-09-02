import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { aggregateFacts, toPackageFields } from './consumer-projection';
import { extractProseIdentifiers, extractProseVariantLines } from './prose-identifiers';

// Every input below is a verbatim shape from a recorded real announcement.

function values(text: string, concept: string): string[] {
  return extractProseIdentifiers(text)
    .facts.filter((f) => f.concept === concept)
    .map((f) => f.value);
}

/**
 * The recorded corpus, read rather than transcribed: the two defects below
 * were reported against specific official announcements, and a hand-copied
 * excerpt could drift from what those announcements actually say.
 */
const GOLD_SET: { rows: { sourceId: string; announcementSummary: string | null }[] } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'domain', 'fixtures', 'category-gold-set.json'), 'utf8'),
);

function recordedSummary(sourceId: string): string {
  const row = GOLD_SET.rows.find((item) => item.sourceId === sourceId);
  assert.ok(row?.announcementSummary, `recorded fixture missing: ${sourceId}`);
  return row.announcementSummary;
}

/** What the package checker would actually show for this prose, by field. */
function rendered(text: string): Map<string, string> {
  const { fields } = toPackageFields(aggregateFacts(extractProseIdentifiers(text).facts));
  return new Map(fields.map((field) => [field.key, field.value]));
}

test('inline labeled identifiers are extracted from ordinary prose', () => {
  assert.deepEqual(
    values(
      'The recalled product can be identified by lot number 2606022, which can be found on the pouch.',
      'lot',
    ),
    ['2606022'],
  );
  assert.deepEqual(
    values(
      'The product comes in a 10.5-ounce, blue box marked with a BEST IF USED BY DATE of C 08 05 23 on the top.',
      'best_by',
    ),
    ['C 08 05 23'],
  );
  assert.deepEqual(values('The UPC code is- 7-43490-00010-4.', 'upc'), ['7-43490-00010-4']);
  assert.deepEqual(
    values(
      'stamped with the SELL BY date of September 15, 2022, which can be found on the bottom',
      'sell_by',
    ),
    ['September 15, 2022'],
  );
});

test('value lists under one label become individual values', () => {
  assert.deepEqual(
    values('marked with any of the following Lot numbers: 1472, 1481, 1531.', 'lot'),
    ['1472', '1481', '1531'],
  );
  // "or"-separated barcodes, and a continuation list that repeats no label.
  assert.deepEqual(values('The products have a UPC Code of 300871239418 or 300871239456.', 'upc'), [
    '300871239418',
    '300871239456',
  ]);
  assert.deepEqual(
    values('pouches with UPC #199284530959 (4oz) and #199284306226 (12oz).', 'upc'),
    ['199284530959', '199284306226'],
  );
});

test('a label separated from its values by a clause still resolves', () => {
  assert.deepEqual(
    values(
      'The product’s case has one of the following affected lot codes, which is affixed to the case as seen in the below image: 13150423, 13150723, 13151223.',
      'lot',
    ),
    ['13150423', '13150723', '13151223'],
  );
});

test('only real barcode lengths are promoted to a barcode', () => {
  // A package size or a short code near the word UPC must not become one.
  assert.deepEqual(values('16 fl. Oz. bottles; the UPC is 041548610047.', 'upc'), ['041548610047']);
  assert.deepEqual(values('UPC 430 appears on the tub.', 'upc'), []);
});

test('a notice that states there are no codes is source silence, not a parser miss', () => {
  const noCodes = extractProseIdentifiers(
    'The product is sold in 16 fl. Oz. plastic bottles and the labeling does not have any UPC or lot codes.',
  );
  assert.equal(noCodes.statesNoCodes, true);
  const varying = extractProseIdentifiers(
    'The product contains 12 sachets with different expiration dates stamped on the back side.',
  );
  assert.equal(varying.statesNoCodes, true);
  const normal = extractProseIdentifiers('The lot code is 1472.');
  assert.equal(normal.statesNoCodes, false);
});

test('prose product lines carrying inline identifiers become affected versions', () => {
  const lines = extractProseVariantLines(
    'PRIVATE SELECTION FROZEN TRIPLE BERRY MEDLEY, 48 OZ (BEST BY: 07-07-20; UPC: 0001111079120);\nPRIVATE SELECTION FROZEN BLACKBERRIES, 16 OZ (BEST BY: 06-19-20; UPC: 0001111087809)',
  );
  assert.equal(lines.length, 2);
  assert.match(lines[0].name, /TRIPLE BERRY MEDLEY/);
  assert.ok(lines[0].facts.some((f) => f.concept === 'upc' && f.value === '0001111079120'));
  assert.ok(lines[0].facts.some((f) => f.concept === 'best_by'));
  // Ordinary prose is never mistaken for a product line.
  assert.deepEqual(
    extractProseVariantLines('Consumers who purchased the product (see below) should stop.'),
    [],
  );
});

test('prose sentences are never mistaken for identifier values', () => {
  const facts = extractProseIdentifiers(
    'Consumers who have purchased the product with the lot code should stop using it immediately and return it.',
  ).facts;
  assert.deepEqual(facts, []);
});

test('a quoted label with a "dates between/up to" bridge yields one complete span', () => {
  const between = extractProseIdentifiers(
    '13.3-oz. tray packages containing "POWER PLATE MEALS MEATLOAF" and "USE BY" dates between 6/25/26 and 6/10/27.',
  ).facts.filter((fact) => fact.concept === 'use_by');
  assert.deepEqual(
    between.map((fact) => fact.value),
    ['between 6/25/26 and 6/10/27'],
  );
  const upTo = extractProseIdentifiers(
    'Packages with “best by” dates up to January 23, 2022, located next to the barcode.',
  ).facts.filter((fact) => fact.concept === 'best_by');
  assert.deepEqual(
    upTo.map((fact) => fact.value),
    ['up to January 23, 2022'],
  );
});

test('identifiers inside a supplier-recall reference never become this recall’s facts', () => {
  const { facts } = extractProseIdentifiers(
    'The product comes in a clear plastic package marked with a best by date of 11/23/26.\n' +
      'The recall was initiated after notification that Rooted in Rare brand Aquafaba powder with UPC #199284530959 and Best by 12/14/2026 was recalled.',
  );
  assert.ok(facts.some((fact) => fact.value.includes('11/23/26')));
  assert.ok(!facts.some((fact) => fact.value.replace(/\D/g, '').includes('199284530959')));
  assert.ok(!facts.some((fact) => fact.value.includes('12/14/2026')));
});

// ── P0A: identifier integrity ───────────────────────────────────────────────

test('Everything Sprouts: an ampersand-joined lot list yields four clean codes', () => {
  // Verbatim from the recorded announcement: "This includes Robust Radish Mix,
  // 5oz Cups, Barcode 087906000075, LOT# 223, 226, 230, & 233."
  const summary = recordedSummary(
    'everything-sprouts-llc-expands-voluntarily-recall-include-robust-radish-mix-due-potential-e-coli-and',
  );
  assert.ok(summary.includes('LOT# 223, 226, 230, & 233'), 'fixture no longer states the defect');
  const lots = values(summary, 'lot');
  assert.deepEqual(lots, ['223', '226', '230', '233']);
  // The connector must not survive anywhere in a rendered identifier.
  assert.ok(!lots.some((lot) => /[&]|\band\b/i.test(lot)), lots.join(' | '));
  assert.deepEqual(values(summary, 'upc'), ['087906000075']);
  // And what the shopper actually reads: "223, 226, 230, and & 233" before.
  const fields = rendered(summary);
  assert.equal(fields.get('lotCodes'), '223, 226, 230, and 233');
  assert.equal(fields.get('upc'), '087906000075');
});

test('Al’Fez Tahini: a semicolon-delimited list keeps every date, in source order', () => {
  // "…with corresponding BEST BEFORE: “2024 JL 31”; “2024 SE 09”; “2025 MR
  // 27”; “2025 AL 04”." Read as a terminator, the semicolon dropped three of
  // the four markings a shopper compares against the jar.
  const summary = recordedSummary(
    'ab-world-foods-us-inc-recalls-alfez-natural-tahini-because-possible-health-risk',
  );
  const bestBy = values(summary, 'best_by');
  assert.deepEqual(bestBy, ['2024 JL 11', '2024 JL 31', '2024 SE 09', '2025 MR 27', '2025 AL 04']);
  // The four quoted lot numbers stay lot numbers, and the date that follows
  // the "with corresponding BEST BEFORE:" bridge never joins them.
  assert.deepEqual(values(summary, 'lot'), ['3031', '3080', '3270', '3297']);
});

test('a semicolon-delimited lot list keeps every code', () => {
  // Eastern Meat Solutions, verbatim: "Lot # 3115; Lot # 3123; or Lot #3114
  // on the packages".
  assert.deepEqual(
    values('The packages bear Lot # 3115; Lot # 3123; or Lot #3114 on the packages.', 'lot'),
    ['3115', '3123', '3114'],
  );
});

test('official identifiers stay strings: leading zeroes and no digit grouping', () => {
  // Little Leaf Farms states the lot as the package's first six digits.
  assert.deepEqual(
    values('Lot Number: 050011 as the first six digits (printed on the bottom left).', 'lot'),
    ['050011'],
  );
  // Seven digits are seven digits — never "2,606,022".
  assert.deepEqual(values('The product can be identified by lot number 2606022.', 'lot'), [
    '2606022',
  ]);
  assert.deepEqual(values('BEST BY: 07-07-20; UPC: 0001111079120', 'upc'), ['0001111079120']);
});

test('alphanumeric, hyphenated and ranged lot codes still extract unchanged', () => {
  assert.deepEqual(values('with lot codes E-054, EX 0225 and D-181 printed on the bag.', 'lot'), [
    'E-054',
    'EX 0225',
    'D-181',
  ]);
  assert.deepEqual(values('Lot codes 25E04-A, 25E04-B and 088594-2-1.', 'lot'), [
    '25E04-A',
    '25E04-B',
    '088594-2-1',
  ]);
  // Tipical Latin Food, verbatim — a source-stated range stays one value.
  assert.ok(
    values(
      'Lot number for this product can be found at the bottom of the bag in a blue label and range from 2622404 to 2772412.',
      'lot',
    ).includes('2622404 to 2772412'),
  );
});

test('a field label repeated inside a list does not ride into the value', () => {
  // Channel Fish, verbatim: "…with a lot code of 22739 and date code of 17037."
  // A date code is not a lot code, and the list changes label at that point.
  assert.deepEqual(
    values(
      '10-lb. corrugated box of Channel Brand RAW BREADED SWAI FILLETS, with a lot code of 22739 and date code of 17037.',
      'lot',
    ),
    ['22739'],
  );
  // America New York RI Wang, verbatim: "lot code 0418272 and package date 4/3/2017."
  assert.deepEqual(values('lot code 0418272 and package date 4/3/2017.', 'lot'), ['0418272']);
  // The same label repeated is only noise around a real code.
  assert.deepEqual(values('Lot codes: 1624001 - 1624129 and Lot codes 1623129 - 1623365.', 'lot'), [
    '1624001 - 1624129',
    '1623129 - 1623365',
  ]);
});

test('a production time is never read as a date or a code', () => {
  // Valley Meats, verbatim: "…date code 231222, Use By 01/15/2024, and time
  // stamp 1:02:55PM." The value grammar truncates at the clock's own colon,
  // which put "time stamp 1" under the Use-by heading.
  const source =
    '28-lb. box packaging containing “Ground Beef Patties” with product code 72287, date code 231222, Use By 01/15/2024, and time stamp 1:02:55PM.';
  const facts = extractProseIdentifiers(source).facts;
  assert.ok(!facts.some((fact) => /time\s*stamp/i.test(fact.value)), JSON.stringify(facts));
  const fields = rendered(source);
  assert.equal(fields.get('useBy'), 'January 15, 2024');
  for (const value of fields.values()) {
    assert.ok(!/time|:\d\d|\d\s*[ap]m\b/i.test(value), value);
  }
});

test('a telephone number or extension is never read as a code', () => {
  // SunFed, verbatim: "…recall hotline (888) 542-5849, M-F 8:00 a.m. - 5:00 p.m. MST."
  const source =
    'Consumers may obtain additional information by contacting SunFed’s recall hotline (888) 542-5849, M-F 8:00 a.m. - 5:00 p.m. MST.\n' +
    'Questions about the lot code may be directed to Consumer Affairs at 1-800-538-9543 ext. 4021.';
  // Neither the hotline, its hours, nor the extension may reach a package field.
  assert.deepEqual([...rendered(source).entries()], []);
  // And a real lot code stated in the same notice is unaffected.
  assert.deepEqual(
    values(
      'The recalled jars carry lot code 088594-2-1. Consumers with questions may call 1-800-538-9543 ext. 4021.',
      'lot',
    ),
    ['088594-2-1'],
  );
});

test('a code the source states before continuing its sentence keeps the code', () => {
  // Fromi USA, verbatim: "Lot number:615 appears on both the wooden box of
  // each cheese and the case."
  assert.deepEqual(
    values('Lot number:615 appears on both the wooden box of each cheese and the case.', 'lot'),
    ['615'],
  );
});

test('production codes reach their own concept instead of a date field', () => {
  // Hormel, verbatim: "…with a Best By February 2021 date and production
  // codes: F020881, F020882 and F020883." The codes are not best-by dates.
  const facts = extractProseIdentifiers(
    '12-oz. metal cans containing SPAM Classic with a Best By February 2021 date and production codes: F020881, F020882 and F020883.',
  ).facts;
  assert.deepEqual(
    facts.filter((fact) => fact.concept === 'production_code').map((fact) => fact.value),
    ['F020881', 'F020882', 'F020883'],
  );
  assert.ok(
    !facts.some((fact) => fact.concept === 'best_by' && /^F0208/.test(fact.value)),
    JSON.stringify(facts),
  );
});
