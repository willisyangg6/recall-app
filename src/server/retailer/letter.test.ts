import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCostcoIndex } from './costco-index';
import {
  FIXTURE_IDS,
  fixtureDocument,
  fixtureExtract,
  fixtureIndexHtml,
} from './fixtures/costco-fixtures';
import { codeDatesIn, parseLetter, statedLetterDate } from './letter';
import { extractPdfText } from './pdf-text';
import type { ParsedNotice } from './types';

const entries = new Map(
  parseCostcoIndex(fixtureIndexHtml()).map((entry) => [entry.nativeId, entry]),
);

async function parsed(nativeId: string): Promise<{ notice: ParsedNotice; flat: string }> {
  const extracted = await fixtureExtract(fixtureDocument(nativeId));
  return {
    notice: parseLetter(entries.get(nativeId)!, extracted.extraction, extracted.text),
    flat: extracted.text.replace(/\s+/g, ' '),
  };
}

test('Whipped Cream: stated date, firm, Costco item number apart from codes, paired states', async () => {
  const { notice } = await parsed(FIXTURE_IDS.whippedCream);
  assert.equal(notice.extraction, 'text');
  assert.equal(notice.statedNoticeDate, '2026-11-07');
  assert.equal(notice.statedNoticeDateText, '11/7/2026');
  assert.equal(notice.recallingFirmText, 'Alamance Foods');
  assert.equal(notice.noticeKind, 'recall');
  assert.equal(notice.foodStatus, 'food');
  assert.deepEqual(notice.agenciesNamed, []); // no agency named: none inferred
  assert.deepEqual(notice.retailerItemNumbers, ['1777000']);
  assert.deepEqual(notice.upcs, []); // an item number is never a UPC
  assert.ok(notice.codeEvidence.some((line) => line.includes('Lot: 04/02/2027')));
  assert.deepEqual(
    notice.stateClaims.map((claim) => claim.state),
    [
      'Alabama',
      'Florida',
      'Georgia',
      'Illinois',
      'Indiana',
      'Iowa',
      'Mississippi',
      'Missouri',
      'North Carolina',
      'South Carolina',
      'Tennessee',
      'Wisconsin',
    ],
  );
  for (const claim of notice.stateClaims) {
    assert.equal(claim.retailer, 'Costco');
    assert.equal(claim.basis, 'stated_state_list');
  }
  assert.equal(notice.indexScopeText, 'Select Locations in the Midwest and Southeast');
});

test('Tractor Wheels: the printed package size is a claim, never an identifier', async () => {
  const { notice } = await parsed(FIXTURE_IDS.tractorWheels);
  assert.equal(notice.statedNoticeDate, '2026-10-31');
  assert.equal(notice.recallingFirmText, 'Once Upon a Farm');
  assert.deepEqual(notice.agenciesNamed, ['FDA']);
  assert.deepEqual(notice.retailerItemNumbers, ['1977696']);
  assert.deepEqual(notice.upcs, []);
  assert.equal(notice.packageClaims.length, 1);
  assert.deepEqual(notice.packageClaims[0].sizeTokens, ['67oz', '20-count']);
  assert.match(notice.packageClaims[0].text, /Tractor Wheels Soft-baked Bars, 67oz, 20-count$/);
  // Unchecked until a link candidate exists.
  assert.equal(notice.packageClaims[0].verifiedInAgencyNotice, null);
  for (const value of [...notice.retailerItemNumbers, ...notice.upcs]) {
    assert.doesNotMatch(value, /oz|count/i);
  }
  assert.equal(notice.stateClaims.length, 0); // the letter states no geography
});

test('Little Giant ladders: a CPSC consumer product is not food', async () => {
  const { notice } = await parsed(FIXTURE_IDS.ladders);
  assert.equal(notice.foodStatus, 'non_food');
  assert.deepEqual(notice.agenciesNamed, ['CPSC']);
  assert.equal(notice.recallingFirmText, 'Little Giant');
  // The "Costco Item Number | Description" table rows.
  assert.deepEqual(notice.retailerItemNumbers, ['1671610', '1806348', '2009560']);
});

test('Punahele: a scanned letter is stored but never read by guesswork', async () => {
  const extracted = await extractPdfText(fixtureDocument(FIXTURE_IDS.punahele));
  assert.equal(extracted.extraction, 'image_only');
  const notice = parseLetter(
    entries.get(FIXTURE_IDS.punahele)!,
    extracted.extraction,
    extracted.text,
  );
  assert.equal(notice.statedNoticeDate, null);
  assert.equal(notice.noticeKind, 'unclear');
  assert.equal(notice.foodStatus, 'unclear');
  // Only what the index itself printed survives.
  assert.deepEqual(notice.retailerItemNumbers, ['1896152']);
  assert.equal(notice.indexScopeText, 'Hawaii locations only');
});

test('Meatloaf: an undated letter stays undated (a filename date is not a statement)', async () => {
  const { notice } = await parsed(FIXTURE_IDS.meatloaf);
  assert.equal(notice.statedNoticeDate, null);
  assert.equal(entries.get(FIXTURE_IDS.meatloaf)!.documentUrl.endsWith('_31426.pdf'), true);
  assert.equal(notice.stateClaims.length, 28);
});

test('Madeleines: a named-warehouse list yields Costco/state pairs', async () => {
  const { notice } = await parsed(FIXTURE_IDS.madeleines);
  assert.deepEqual(notice.stateClaims.map((claim) => claim.state).sort(), [
    'California',
    'Colorado',
    'Florida',
    'Illinois',
    'Montana',
    'Puerto Rico',
    'Virginia',
    'Washington',
    'Wisconsin',
  ]);
  assert.ok(notice.stateClaims.every((claim) => claim.basis === 'named_store_locations'));
});

test('Turkish Delight: a letter that says the product is safe is a quality notice', async () => {
  const { notice } = await parsed(FIXTURE_IDS.turkishDelight);
  assert.equal(notice.noticeKind, 'quality_notice');
  assert.equal(notice.statedNoticeDate, '2026-03-12'); // "Date: 03/12/2026"
});

test('every evidence string is verbatim in its letter (whitespace collapsed)', async () => {
  for (const nativeId of Object.values(FIXTURE_IDS)) {
    const { notice, flat } = await parsed(nativeId);
    const evidence = [
      notice.recallingFirmEvidence,
      notice.noticeKindEvidence,
      ...notice.codeEvidence,
      ...notice.stateClaims.map((claim) => claim.evidence),
      ...notice.packageClaims.map((claim) => claim.text),
    ].filter((value): value is string => value !== null);
    for (const value of evidence)
      assert.ok(flat.includes(value), `${nativeId}: ${value.slice(0, 60)}`);
  }
});

test('stated dates come only from a date line, and code dates read every printed form', () => {
  assert.deepEqual(
    statedLetterDate('Dear Member,\nYou bought it between 10/11/2026 and 10/31/2026.'),
    {
      iso: null,
      text: null,
    },
  );
  assert.equal(statedLetterDate('Header\nMarch 2nd, 2026\nDear Member').iso, '2026-03-02');
  assert.equal(statedLetterDate('2/30/2026').iso, null); // not a real date
  assert.deepEqual(codeDatesIn('Best By dates ranging from 110825 through 011227'), [
    '2025-11-08',
    '2027-01-12',
  ]);
  assert.deepEqual(codeDatesIn('Best By dates ranging from 20 MAY 2026 through 06 JUL 2027'), [
    '2026-05-20',
    '2027-07-06',
  ]);
  assert.deepEqual(codeDatesIn('Lot: 04/02/2027 (Best If Used By APR/02/27)'), ['2027-04-02']);
});
