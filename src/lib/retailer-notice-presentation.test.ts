import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { BASELINE_RECALLS } from './baseline-recalls';
import { buildFeedSections } from './feed-relevance';
import { recallCardAccessibilityLabel } from './recall-card-accessibility';
import { cardReasonText } from './recall-card-reason';
import { affectedProductCards, buildHomeCardModel } from './recall-presentation';
import { readRetailerNoticeFields } from './retailer-notice-fields';
import {
  buildRetailerDetailModel,
  buildRetailerHomeCardModel,
  homeRowKey,
  mergeSectionRows,
  retailerNoticeIdFromRoute,
  retailerNoticesForAll,
  retailerPackageFields,
  retailerRouteId,
} from './retailer-notice-presentation';
import { readRetailerNoticeRows, type RetailerNotice } from './retailer-notices';

/** The reviewed staging fixture's approved fields, read as the client reads them. */
const APPROVED = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      'server',
      'retailer',
      'fixtures',
      'approvals',
      'kirkland-whipped-cream.json',
    ),
    'utf8',
  ),
).fields as unknown;

const ROW = {
  id: '8c4663c8-2009-4094-86b0-0c69c24dec4e',
  publisher: 'costco',
  document_url:
    'https://gdx-assets.costco.com/adobe/assets/urn:aaid:aem:8dedd165-f61b-475a-b7bb-5f33f77a4675/original/as/FINAL%20KS%20Whipped%20Cream%20Member%20Letter.pdf',
  notice_date: '2026-11-07',
  fields: APPROVED,
};

const STAGING = 'http://127.0.0.1:56721';

function notice(overrides: Partial<typeof ROW> = {}, baseUrl?: string): RetailerNotice {
  const [read] = readRetailerNoticeRows([{ ...ROW, ...overrides }], baseUrl);
  assert.ok(read, 'the fixture row must read');
  return read;
}

const TODAY = '2026-11-15';

test('the approved fixture reads as a complete retailer notice', () => {
  const read = notice();
  assert.equal(read.publisher, 'costco');
  assert.equal(read.noticeDate, '2026-11-07');
  assert.equal(read.fields.productName, 'Kirkland Signature Real Heavy Whipped Cream');
});

test('a malformed or unsafe row is dropped whole, never shown in part', () => {
  const bad = [
    { ...ROW, document_url: 'https://example.com/letter.pdf' },
    { ...ROW, document_url: 'http://gdx-assets.costco.com/letter.pdf' },
    { ...ROW, notice_date: 'Nov 7' },
    { ...ROW, publisher: 'kroger' },
    { ...ROW, fields: { ...(APPROVED as object), reviewNotes: 'private' } },
    { ...ROW, fields: { ...(APPROVED as object), productName: '' } },
  ];
  for (const row of bad) {
    assert.deepEqual(readRetailerNoticeRows([row]), [], JSON.stringify(row).slice(0, 80));
  }
  assert.equal(readRetailerNoticeRows([ROW, ROW]).length, 1);
});

test('the Feed card is the shared card model: Unknown risk in its slot, no retailer badge', () => {
  const card = buildRetailerHomeCardModel(notice(), TODAY);
  // Every key the agency card model carries, and nothing it does not.
  const agency = buildHomeCardModel(BASELINE_RECALLS[0], { today: TODAY, prefs: null });
  assert.deepEqual(
    Object.keys(card)
      .filter((key) => key !== 'saveable')
      .sort(),
    Object.keys(agency).sort(),
  );
  assert.equal(card.risk.tier, 'unknown');
  assert.equal(card.risk.badgeLabel, 'UNKNOWN');
  assert.equal(card.risk.note, null);
  assert.equal(card.risk.official, null);
  assert.equal(card.noticeLabel, null);
  assert.equal(card.activity.text, 'Announced Nov 7');
  assert.equal(card.brand.text, 'Alamance Foods');
  // The shared concise-reason path, rendered in the card's own wording.
  assert.equal(card.reasonLine, 'Potential cleaning chemical contamination');
  assert.equal(cardReasonText(card.reasonLine), 'Possible cleaning chemical contamination');
  assert.equal(card.locationSummary, 'AL, FL +10');
  assert.equal(card.affectsYou, false);
  assert.equal(card.saveable, false);
  assert.doesNotMatch(JSON.stringify(card), /Costco notice|PENDING|FDA|FSIS|USDA/i);
  // It speaks like any card, and claims no save state it cannot have.
  const spoken = recallCardAccessibilityLabel(card, false);
  assert.match(spoken, /^Risk level: Unknown\. Announced Nov 7\./);
  assert.doesNotMatch(spoken, /saved/i);
});

test('the card opens Recall Details under a route id no case can have', () => {
  const card = buildRetailerHomeCardModel(notice(), TODAY);
  assert.equal(card.id, `retailer:${ROW.id}`);
  assert.equal(retailerNoticeIdFromRoute(card.id), ROW.id);
  assert.equal(retailerNoticeIdFromRoute(BASELINE_RECALLS[0].id), null);
  assert.equal(retailerRouteId({ id: ROW.id }), card.id);
});

test('Recall Details uses only its existing sections, with the letter as the source', () => {
  const detail = buildRetailerDetailModel(notice(), TODAY);
  assert.equal(detail.noticeTypeLabel, 'Recall');
  assert.equal(detail.risk.headlineLabel, 'UNKNOWN');
  assert.deepEqual(detail.officialSource, {
    label: 'View Costco’s letter',
    url: ROW.document_url,
  });
  assert.equal(detail.whatHappened.text, (APPROVED as { whatHappened: string }).whatHappened);
  assert.equal(detail.whatHappened.scope, null);
  assert.equal(detail.illnessNotice, null);
  // No backend configured in this test: no URL, so no image anywhere.
  assert.equal(detail.productImages, null);
  // Where It Was Sold: the states, then Costco as the stated retailer.
  assert.equal(detail.sections.whereSold.retailersNamed, 'Costco');
  assert.deepEqual(detail.sections.whereSold.states.length, 12);
  // No agency-only sections.
  assert.equal(detail.sections.healthRisk, null);
  assert.equal(detail.sections.communityReports, null);
  // No attribution sentence or retailer badge anywhere in the model.
  assert.doesNotMatch(JSON.stringify(detail), /Costco notice|not a government recall/i);
});

test('the approved photo fills the existing image slot on the card and the detail', () => {
  const withPhoto = notice({}, STAGING);
  const path = (APPROVED as { image: { path: string } }).image.path;
  assert.equal(withPhoto.imageUrl, `${STAGING}/storage/v1/object/public/product-visuals/${path}`);
  assert.match(path, /^retailer-notices\/df0f1de8[0-9a-f]{56}\/8a1a80cb[0-9a-f]{56}\.jpg$/);
  const card = buildRetailerHomeCardModel(withPhoto, TODAY);
  assert.equal(card.heroImageUrl, withPhoto.imageUrl);
  const detail = buildRetailerDetailModel(withPhoto, TODAY);
  assert.deepEqual(
    detail.productImages?.images.map((image) => image.url),
    [withPhoto.imageUrl],
  );
  // Unapproved → no image: the approved no-image shape, exactly as for an
  // agency recall with no photo (the tile renders nothing, no grey square).
  const without = notice({ fields: { ...(APPROVED as object), image: null } as unknown }, STAGING);
  assert.equal(without.imageUrl, null);
  assert.equal(buildRetailerHomeCardModel(without, TODAY).heroImageUrl, null);
  assert.equal(buildRetailerDetailModel(without, TODAY).productImages, null);
});

test('a photo path that does not name a letter and an image hash is rejected', () => {
  for (const path of [
    'retailer-notices/abc/def.jpg',
    '../secret.jpg',
    'https://example.com/can.jpg',
  ]) {
    const fields = {
      ...(APPROVED as object),
      image: { path, width: 763, height: 2046, pdfObject: 11 },
    };
    assert.equal(readRetailerNoticeFields(fields), null, path);
  }
});

test('package identifiers go through the shared package-field gate, adding no row', () => {
  const detail = buildRetailerDetailModel(notice(), TODAY);
  const [card] = affectedProductCards(detail.sections.affectedProducts!.table.expanded);
  assert.equal(card.name, 'Kirkland Signature Real Heavy Whipped Cream');
  // The agency labels, in the agency order; Best by in the shared date format.
  assert.deepEqual(
    card.groups.map((group) => [group.label, group.lines]),
    [
      ['Package Size', ['15 oz (425 g)']],
      ['Best by', ['April 2, 2027']],
      ['Lot codes', ['04/02/2027']],
    ],
  );
  // The raw source values are kept: the best-by marking as printed, and the
  // lot exactly as the letter wrote it (never reformatted as a date).
  const gated = retailerPackageFields(notice().fields);
  const bestBy = gated.fields.find((field) => field.key === 'bestBy')!;
  const lot = gated.fields.find((field) => field.key === 'lotCodes')!;
  assert.deepEqual([bestBy.values, bestBy.raw], [['April 2, 2027'], ['APR/02/27']]);
  assert.deepEqual([lot.values, lot.raw], [['04/02/2027'], ['04/02/2027']]);
  // The item number and supplier code reach the gate and are rejected by it.
  assert.deepEqual(
    gated.rejected.map((rejected) => [rejected.concept, rejected.values]),
    [['item_number', ['1777000', 'AC50']]],
  );
  // No approved field for an item number or supplier code: the shared gate
  // drops them, exactly as it drops an agency notice's item code. Timestamps
  // have no concept. None is relabeled into another row.
  const shown = JSON.stringify(detail.sections);
  for (const unslotted of ['1777000', 'AC50', '00:35'])
    assert.ok(!shown.includes(unslotted), unslotted);
  assert.doesNotMatch(shown, /8CT|3PK|case pack/i);
});

test('with no retailer notice, every section is exactly the agency list', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const { recent, olderActive } = buildFeedSections([...BASELINE_RECALLS], now);
  for (const agency of [recent, olderActive]) {
    const rows = mergeSectionRows(agency, []);
    assert.equal(rows.length, agency.length);
    rows.forEach((row, index) => {
      assert.equal(row.kind, 'agency');
      assert.equal(row.kind === 'agency' && row.item, agency[index]);
      assert.equal(homeRowKey(row), agency[index].id);
    });
  }
});

test('a notice sits among agency recalls by its letter date, once', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const { recent } = buildFeedSections([...BASELINE_RECALLS], now);
  const recentNotice = notice();
  const rows = mergeSectionRows(recent, [recentNotice]);
  assert.equal(rows.length, recent.length + 1);
  assert.equal(rows.filter((row) => row.kind === 'retailer').length, 1);
  assert.deepEqual(
    rows
      .filter((row) => row.kind === 'agency')
      .map((row) => (row.kind === 'agency' ? row.item.id : '')),
    recent.map((item) => item.id),
  );
});

test('All recalls hides notices under a filter and narrows them by search', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const all = [notice()];
  assert.equal(
    retailerNoticesForAll(all, now, { filtersActive: false, query: '' }).recent.length,
    1,
  );
  assert.equal(
    retailerNoticesForAll(all, now, { filtersActive: true, query: '' }).recent.length,
    0,
  );
  for (const query of ['1777000', 'AC50', 'kirkland', 'Alamance', 'costco']) {
    assert.equal(
      retailerNoticesForAll(all, now, { filtersActive: false, query }).recent.length,
      1,
      query,
    );
  }
  assert.equal(
    retailerNoticesForAll(all, now, { filtersActive: false, query: 'peanut butter' }).recent.length,
    0,
  );
  const later = new Date('2027-02-01T12:00:00Z');
  const split = retailerNoticesForAll(all, later, { filtersActive: false, query: '' });
  assert.deepEqual([split.recent.length, split.older.length], [0, 1]);
});

test('the field reader rejects a pack size smuggled into the identifiers shape', () => {
  const tampered = structuredClone(APPROVED) as { packageChecks: Record<string, unknown> };
  tampered.packageChecks.packSize = ['3PK'];
  assert.equal(readRetailerNoticeFields(tampered), null);
});
