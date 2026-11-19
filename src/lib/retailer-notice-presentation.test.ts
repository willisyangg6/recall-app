import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { BASELINE_RECALLS } from './baseline-recalls';
import { buildFeedSections } from './feed-relevance';
import type { FeedItem } from './recall-feed';
import { recallCardAccessibilityLabel } from './recall-card-accessibility';
import { cardReasonText } from './recall-card-reason';
import {
  affectedProductCards,
  buildHomeCardModel,
  UNSPECIFIED_DISTRIBUTION,
  withListedStores,
} from './recall-presentation';
import { retailerProductCategories } from '../server/retailer/approval';
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
  // No backend configured in this test: no URL, so no image anywhere.
  assert.equal(detail.productImages, null);
  // Where It Was Sold: the states, then Costco as the stated retailer.
  assert.equal(detail.sections.whereSold.retailersNamed, 'Costco');
  assert.deepEqual(detail.sections.whereSold.states.length, 12);
  assert.equal(detail.sections.communityReports, null);
  // No attribution sentence or retailer badge anywhere in the model.
  assert.doesNotMatch(JSON.stringify(detail), /Costco notice|not a government recall/i);
});

// ── One presentation path: the shared narrative, illness and category ──────

test('Kirkland: the shared cause sentence names the chemical; no illness or timestamp line', () => {
  const detail = buildRetailerDetailModel(notice(), TODAY);
  const fields = notice().fields;
  // The agency structure: who recalled what, and the actual hazard.
  assert.equal(
    detail.whatHappened.text,
    'Alamance Foods recalled Kirkland Signature Real Heavy Whipped Cream because the products ' +
      'may be contaminated with a cleaning chemical.',
  );
  assert.equal(detail.whatHappened.scope, null);
  // The letter's qualified statement is not an illness status: no badge, and
  // never turned into "No illnesses reported".
  assert.match(fields.whatHappened, /No serious adverse effects requiring medical care/);
  assert.equal(detail.illnessNotice, null);
  assert.doesNotMatch(JSON.stringify(detail), /No illnesses|timestamp|00:35|02:45/i);
  // The can timestamps stay in the approved fields, privately.
  assert.deepEqual(fields.packageChecks.canTimestamps, ['00:35 – 02:45']);
});

test('the category is the shared classifier answer, through the shared display gate', () => {
  const plain = notice();
  assert.equal(buildRetailerHomeCardModel(plain, TODAY).categoryLabel, null);
  const [stored] = readRetailerNoticeRows([{ ...ROW, product_categories: ['dairy_eggs'] }]);
  const card = buildRetailerHomeCardModel(stored, TODAY);
  const detail = buildRetailerDetailModel(stored, TODAY);
  assert.equal(card.categoryId, 'dairy_eggs');
  assert.equal(detail.category?.id, 'dairy_eggs');
  assert.equal(detail.category?.label, card.categoryLabel);
  // An unknown id is dropped exactly as for an agency case; missing is not Other.
  const [junk] = readRetailerNoticeRows([{ ...ROW, product_categories: ['not-a-category'] }]);
  assert.equal(junk.productCategories, undefined);
});

test('an exact "No illnesses" statement gets the shared badge and leaves the paragraph', () => {
  const [priano] = readRetailerNoticeRows([aldiRow('aldi-priano-tortelloni.json', '2026-11-16')]);
  const detail = buildRetailerDetailModel(priano, TODAY);
  assert.equal(detail.illnessNotice?.spoken, 'No illnesses reported.');
  assert.doesNotMatch(detail.whatHappened.text, /illness/i);
  // The hazard and the temperature lapse the notice states, in the shared sentence.
  assert.equal(
    detail.whatHappened.text,
    'Aldi recalled Priano Protein Carbonara Tortelloni and Priano Protein Herb & Cheese ' +
      'Tortelloni because the products may not have been stored at appropriate temperatures, ' +
      'which may allow the growth of Clostridium botulinum.',
  );
  assert.ok(detail.sections.healthRisk, 'the shared botulism guidance applies');
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

/** An approved batch request's fields, as the read path would return them. */
function batchNotice(file: string, noticeDate: string, documentUrl: string): RetailerNotice {
  const fields = JSON.parse(
    readFileSync(
      join(__dirname, '..', 'server', 'retailer', 'fixtures', 'approvals', file),
      'utf8',
    ),
  ).fields as unknown;
  return notice({ fields, notice_date: noticeDate, document_url: documentUrl });
}

const CAESAR_URL =
  'https://gdx-assets.costco.com/adobe/assets/urn%3Aaaid%3Aaem%3Acbfef661-76fc-40b0-b1e1-537279dd41da/original/as/PLEASEPOST11-7-25MemberLetter-CaesarDressingRecall-ServiceDeliItems.pdf';

test('a letter that states no state renders the shared "Distribution not specified"', () => {
  const caesar = batchNotice('caesar-salad.json', '2025-11-07', CAESAR_URL);
  assert.deepEqual(caesar.fields.whereSold.states, []);

  const card = buildRetailerHomeCardModel(caesar, TODAY);
  assert.equal(card.locationSummary, UNSPECIFIED_DISTRIBUTION);
  assert.equal(card.productName, 'Caesar Salad');
  assert.equal(card.brand.text, 'Costco and Ventura foods');
  assert.equal(card.risk.tier, 'unknown');
  assert.equal(card.affectsYou, false);

  const detail = buildRetailerDetailModel(caesar, TODAY);
  const sold = detail.sections.whereSold;
  // The agency contract's unspecified state, word for word, never a blank lead.
  assert.equal(sold.locationState, 'unspecified');
  assert.equal(sold.lead, UNSPECIFIED_DISTRIBUTION);
  assert.equal(sold.leadCollapsed, UNSPECIFIED_DISTRIBUTION);
  assert.deepEqual(sold.states, []);
  assert.equal(sold.statesDisclosure, null);
  assert.equal(sold.retailersNamed, 'Costco');
  // No region from Costco's index title becomes a place.
  assert.doesNotMatch(JSON.stringify(detail), /Midwest|Northeast|Southeast/);
  // No package field has a value (a Sell By range has no field), so the
  // section is omitted exactly as for any notice with nothing to check.
  assert.equal(detail.sections.affectedProducts, null);
  assert.deepEqual(detail.officialSource, { label: 'View Costco’s letter', url: CAESAR_URL });
  // The shared cause sentence names the material the letter states.
  assert.equal(
    detail.whatHappened.text,
    'Costco and Ventura foods recalled Caesar Salad because the products may contain pieces of plastic.',
  );
});

test('a notice with stated states keeps its state list (Madeleines)', () => {
  const madeleines = batchNotice(
    'traditional-madeleines.json',
    '2026-04-07',
    'https://gdx-assets.costco.com/adobe/assets/urn%3Aaaid%3Aaem%3A45614e14-d5b7-4475-8c47-528b245fc97f/original/as/MemberRecallLetterMadeleines2.pdf',
  );
  const card = buildRetailerHomeCardModel(madeleines, TODAY);
  assert.equal(card.locationSummary, 'MT, WA +7');
  const sold = buildRetailerDetailModel(madeleines, TODAY).sections.whereSold;
  assert.equal(sold.locationState, 'states');
  assert.equal(sold.states.length, 9);
  assert.equal(sold.retailersNamed, 'Costco');
  // The whipped cream fixture is unchanged by the empty-list rule.
  assert.equal(buildRetailerHomeCardModel(notice(), TODAY).locationSummary, 'AL, FL +10');
});

// ── A second retailer: ALDI ─────────────────────────────────────────────────

const PRIANO_URL =
  'https://dm.cms.aldi.cx/is/content/prod1amer/ALDI%20Recalls%20Priano%20Protein%20Carbonara%20Tortelloni%20and%20Priano%20Protein%20Herb%20Cheese%20Tortelloni%20Because%20Of%20Possible%20Health%20Riskpdf';

function aldiRow(file: string, noticeDate: string) {
  return {
    ...ROW,
    id: '1f0c2a9e-5b7d-4e1a-9c3f-2d6b8e4a7c10',
    publisher: 'aldi',
    document_url: PRIANO_URL,
    notice_date: noticeDate,
    fields: JSON.parse(
      readFileSync(
        join(__dirname, '..', 'server', 'retailer', 'fixtures', 'approvals', file),
        'utf8',
      ),
    ).fields as unknown,
  };
}

test('an ALDI notice renders through the same card and detail, named for ALDI', () => {
  const [priano] = readRetailerNoticeRows([aldiRow('aldi-priano-tortelloni.json', '2026-11-16')]);
  assert.ok(priano, 'an approved ALDI row reads');
  assert.equal(priano.publisher, 'aldi');

  const card = buildRetailerHomeCardModel(priano, TODAY);
  assert.equal(
    card.productName,
    'Priano Protein Carbonara Tortelloni and Priano Protein Herb & Cheese Tortelloni',
  );
  assert.equal(card.risk.tier, 'unknown');
  assert.equal(card.affectsYou, false);

  const detail = buildRetailerDetailModel(priano, TODAY);
  assert.equal(detail.sections.whereSold.retailersNamed, 'ALDI');
  assert.deepEqual(detail.officialSource, { label: 'View ALDI’s recall notice', url: PRIANO_URL });
  // Lot and Best if Used By are package identifiers, so a notice with no
  // store item number still has a package to check.
  assert.ok(detail.sections.affectedProducts, 'Affected Products shows the lot and date');
  assert.doesNotMatch(JSON.stringify(detail), /Costco/);
});

test('publisher, name and document host must all agree, or the row is dropped', () => {
  const good = aldiRow('aldi-priano-tortelloni.json', '2026-11-16');
  assert.equal(readRetailerNoticeRows([good]).length, 1);
  // An ALDI-named notice under Costco, a Costco notice under ALDI, and an
  // ALDI notice linking off ALDI's host are each dropped whole.
  assert.deepEqual(readRetailerNoticeRows([{ ...good, publisher: 'costco' }]), []);
  assert.deepEqual(readRetailerNoticeRows([{ ...ROW, publisher: 'aldi' }]), []);
  assert.deepEqual(readRetailerNoticeRows([{ ...good, document_url: ROW.document_url }]), []);
  assert.deepEqual(
    readRetailerNoticeRows([{ ...good, document_url: 'https://dm.cms.aldi.cx.example.com/x.pdf' }]),
    [],
  );
  assert.deepEqual(readRetailerNoticeRows([{ ...good, publisher: 'walmart' }]), []);
});

test('a notice with no package identifier at all is still refused', () => {
  const fields = JSON.parse(
    JSON.stringify(aldiRow('aldi-priano-tortelloni.json', '2026-11-16').fields),
  );
  fields.packageChecks.lotCodes = [];
  fields.packageChecks.bestByDates = [];
  assert.equal(readRetailerNoticeFields(fields), null);
});

// ── Every approved candidate through the one presentation path ────────────

const FIXTURES = join(__dirname, '..', 'server', 'retailer', 'fixtures', 'approvals');

/** Each approved fixture, read exactly as the client reads a returned row. */
function approvedCandidates(): { file: string; notice: RetailerNotice }[] {
  return readdirSync(FIXTURES).map((file) => {
    const request = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
    const [read] = readRetailerNoticeRows(
      [
        {
          ...ROW,
          publisher: request.publisher,
          document_url:
            request.publisher === 'aldi'
              ? PRIANO_URL
              : 'https://gdx-assets.costco.com/adobe/assets/x/original/as/letter.pdf',
          fields: request.fields,
          product_categories: retailerProductCategories(request.fields),
        },
      ],
      STAGING,
    );
    assert.ok(read, `${file} reads`);
    return { file, notice: read };
  });
}

test('every approved candidate follows the agency What Happened structure, hazard included', () => {
  const candidates = approvedCandidates();
  // Different hazards, missing fields, several products, image and no image.
  assert.deepEqual(
    [...new Set(candidates.map(({ notice: n }) => n.fields.reason.hazardCategory))].sort(),
    ['allergen', 'chemical_contamination', 'foreign_material', 'microbial_contamination'],
  );
  assert.ok(candidates.some(({ notice: n }) => n.fields.whereSold.states.length === 0));
  assert.ok(candidates.some(({ notice: n }) => n.fields.image !== null));
  assert.ok(candidates.some(({ notice: n }) => n.fields.image === null));
  for (const { file, notice: n } of candidates) {
    const detail = buildRetailerDetailModel(n, TODAY);
    const card = buildRetailerHomeCardModel(n, TODAY);
    const text = detail.whatHappened.text;
    // "<company> recalled <product> because <hazard>." — the shared frame.
    assert.match(text, / recalled .+ because .+\.$/, file);
    assert.ok(text.includes(n.fields.productName), `${file}: names the approved product(s)`);
    // The actual hazard: the stated agent or material, never only a family.
    const agent = n.fields.reason.agent ?? '';
    const named = agent.replace(/^undeclared\s+/i, '').replace(/\s+foreign material$/i, '');
    assert.ok(
      text.toLowerCase().includes(named.toLowerCase()),
      `${file}: "${text}" names "${named}"`,
    );
    // The letter's prose is evidence, never the paragraph: no illness or
    // adverse-effect sentence, no timestamps, no purchase window.
    assert.doesNotMatch(text, /illness|adverse|medical|timestamp|\d{1,2}:\d{2}|bought between/i);
    // An illness badge only where the letter states exactly that.
    const exact = /\bno illnesses have been reported\b/i.test(n.fields.whatHappened);
    assert.equal(detail.illnessNotice !== null, exact, `${file}: illness badge`);
    if (/adverse effects/i.test(n.fields.whatHappened)) {
      assert.equal(detail.illnessNotice, null, `${file}: a qualified statement is not a status`);
    }
    // The stored shared-classifier answer, through the shared display gate.
    assert.equal(card.categoryLabel, detail.category?.label ?? null, file);
    // The approved photo, or the no-image shape.
    assert.equal(card.heroImageUrl !== null, n.fields.image !== null, file);
    // The publishing retailer is named once, in the existing store row.
    assert.equal(detail.sections.whereSold.retailersNamed, n.fields.retailer, file);
  }
});

test('listed stores join the existing store row once, and never the agency distribution', () => {
  const distribution = {
    scopeType: 'nationwide' as const,
    areaText: 'Nationwide',
    states: [],
    areas: [],
    coverage: [],
    retailers: ['Walmart'],
    statedRetailers: ['Walmart', "Costco and Sam's Club"],
    retailersShown: ['Walmart'],
    retailersHidden: 0,
    retailLocations: [],
    onlinePlatforms: [],
    channels: [],
    unspecified: false,
  };
  const merged = withListedStores(distribution, [
    'Target',
    'Walmart',
    "Sam's Club",
    'Whole Foods Market',
    'Target',
  ]);
  assert.deepEqual(merged.statedRetailers, [
    'Walmart',
    "Costco and Sam's Club",
    'Target',
    'Whole Foods Market',
  ]);
  // States, scope and the evidence lists are untouched.
  assert.deepEqual(
    { ...merged, statedRetailers: distribution.statedRetailers },
    distribution,
    'only the named-store list changes',
  );
  assert.equal(withListedStores(distribution, []), distribution);
});

test('a notice linked to an agency case leaves one card; listings add none', () => {
  const agency = [...BASELINE_RECALLS];
  // While standalone, the notice is one row beside the agency rows.
  const standalone = mergeSectionRows(agency, [notice()]);
  assert.equal(standalone.length, agency.length + 1);
  // Once the monitor re-decides it as a link candidate, or a reviewer confirms
  // the match, consumer_retailer_notices() no longer returns it: the feed is
  // exactly the agency list, so the agency case is the only card.
  const linked = mergeSectionRows(agency, []);
  assert.deepEqual(
    linked.map((row) => homeRowKey(row)),
    agency.map((item: FeedItem) => item.id),
  );
  assert.equal(new Set(standalone.map(homeRowKey)).size, standalone.length, 'keys are unique');
});
