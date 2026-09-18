/**
 * P2a exact consumer regressions, proven end to end against recorded OFFICIAL
 * announcements (listing row + page <main>, captured 2026-09-01 from fda.gov —
 * each fixture records its officialUrl). The simulator QA that triggered the
 * root-cause audit showed these exact failures; the fixtures pin the fixes at
 * full pipeline depth: raw announcement → parse → projectCase → shared
 * presentation contract.
 *
 *  - Crystal Temptations / Chocolatey Eyeballs: the consumer brand is
 *    "Little Temptations" (FDA's structured brand field); the legal firm
 *    issued the notice but is not the shelf identity.
 *  - LMSI LLC / Kofinas olive oil: brand "Kofinas", firm "LMSI" (an
 *    initialism, never "Lmsi"), and the unapproved-ingredient reason family
 *    with the exact required grammar.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { projectCase } from '../../domain/projection';
import type { CaseProjection } from '../../domain/recall-types';
import {
  affectedProductsModel,
  affectedProductsTable,
  buildDetailModel,
  caseIdentity,
  cleanProductName,
  conciseReasonLine,
  whereSoldModel,
} from '../../lib/recall-presentation';
import { interpretReason } from '../../lib/recall-reason';
import { extractForeignMaterialEvidence, FOREIGN_MATERIALS } from '../../domain/hazard';
import { buildConsumerCase } from '../../lib/consumer-projection';
import { productDisplayName } from '../../lib/consumer-summary';
import {
  captionContradictsPackage,
  measurementKey,
  measurementOnlyName,
  packagingOnlyName,
  splitTrailingMeasurements,
} from '../../lib/variant-identity';
import { buildWhatHappened } from '../../lib/what-happened';
import { parseFdaAnnouncement, slugFromPath, type FdaListingItem } from './parse';

interface RecordedAnnouncement {
  officialUrl: string;
  path: string;
  listing: FdaListingItem;
  mainHtml: string;
}

function recordedCase(fixture: string) {
  const recorded: RecordedAnnouncement = JSON.parse(
    readFileSync(`src/server/fda/fixtures/${fixture}`, 'utf8'),
  );
  const projection = projectCase([
    parseFdaAnnouncement({
      listing: recorded.listing,
      detailMainHtml: recorded.mainHtml,
      path: recorded.path,
    }),
  ]);
  const identity = caseIdentity(
    projection.brands ?? [],
    projection.recallingFirm.displayName,
    projection.title,
  );
  const happened = buildWhatHappened({
    title: projection.title,
    noticeType: projection.noticeType,
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    firmDisplayName: projection.recallingFirm.displayName,
    summaryText: projection.summaryText,
    productDescription: projection.productDescription ?? null,
    consumerBrand: identity.whatHappenedSubject,
  });
  return { projection, identity, happened };
}

test('recorded Chocolatey Eyeballs: brand identity, allergen grammar, one state list', () => {
  const { projection, identity, happened } = recordedCase(
    'announcement-crystal-temptations-chocolatey-eyeballs.json',
  );
  // Consumer brand vs legal firm — decided once, never conflated.
  assert.equal(identity.brand.text, 'Little Temptations');
  assert.equal(identity.legalFirm, 'Crystal Temptations');
  assert.equal(identity.whatHappenedSubject, 'Little Temptations');
  // The exact heading requirement (the size list stays until P2b).
  assert.match(happened.text, /^Little Temptations recalled Chocolatey Eyeballs/);
  assert.match(
    happened.text,
    /because the products may contain milk, an allergen that is not declared on the label\.$/,
  );
  // Home's reason line renders the same interpreted allergen family.
  assert.equal(
    conciseReasonLine({
      reasonText: projection.reasonText,
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: projection.pathogenOrAllergen,
      title: null,
    }),
    'Undeclared milk allergen.',
  );
  // 13 distribution states render as ONE full-name list — never "13 states."
  // beside the same names.
  const consumer = buildConsumerCase(projection, projection.affectedProducts);
  const sold = whereSoldModel(consumer.distribution);
  assert.equal(sold.states.length, 13);
  assert.ok(sold.lead.startsWith('Arizona,'), sold.lead);
  assert.ok(sold.lead.includes('Wyoming'), sold.lead);
  assert.ok(!sold.lead.includes('states.'), sold.lead);
});

test('recorded Kofinas olive oil: LMSI initialism, exact unapproved-ingredient grammar', () => {
  const { identity, happened } = recordedCase('announcement-lmsi-kofinas-garlic-olive-oil.json');
  assert.equal(identity.brand.text, 'Kofinas');
  // The legal firm survives as an initialism for official traceability —
  // "LMSI", never the un-shouted "Lmsi" — and is not the consumer subject.
  assert.equal(identity.legalFirm, 'LMSI');
  assert.equal(identity.whatHappenedSubject, 'Kofinas');
  // The exact required sentence frame and reason grammar (sizes until P2b).
  assert.match(
    happened.text,
    /^Kofinas recalled Garlic Mediterranean Infused Extra Virgin Olive Oil/,
  );
  assert.match(
    happened.text,
    /because it contains garlic essential oil that is not approved for culinary use\.$/,
  );
  assert.ok(!happened.text.includes('because of contains'), happened.text);
  assert.ok(!happened.text.includes('Lmsi'), happened.text);
});

const corpus: { path: string; listing: FdaListingItem; mainHtml: string }[] = JSON.parse(
  gunzipSync(readFileSync('src/server/fda/fixtures/qa-corpus.json.gz')).toString('utf8'),
);

function corpusHappened(fragment: string) {
  const entry = corpus.find((e) => slugFromPath(e.path).includes(fragment));
  assert.ok(entry, `corpus record missing: ${fragment}`);
  const projection = projectCase([
    parseFdaAnnouncement({
      listing: entry!.listing,
      detailMainHtml: entry!.mainHtml,
      path: entry!.path,
    }),
  ]);
  const identity = caseIdentity(
    projection.brands ?? [],
    projection.recallingFirm.displayName,
    projection.title,
  );
  return buildWhatHappened({
    title: projection.title,
    noticeType: projection.noticeType,
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    firmDisplayName: projection.recallingFirm.displayName,
    summaryText: projection.summaryText,
    productDescription: projection.productDescription ?? null,
    consumerBrand: identity.whatHappenedSubject,
  });
}

test('recorded Comforts/Kroger: the consumer brand is the What Happened subject', () => {
  const happened = corpusHappened('fda-alerts-consumers-recall-certain-comforts');
  assert.match(happened.text, /^Comforts recalled /);
  assert.ok(!happened.text.startsWith('Kroger'), happened.text);
});

/**
 * "because of <finite verb/clause>" can no longer be produced anywhere in the
 * recorded corpus — the malformed families the audit documented ("because of
 * contains…", "because of product did not…", "because of glass prone…").
 */
const MALFORMED_BECAUSE =
  /because of (?:contains?|is|are|was|were|has|have|had|does|do|did|not|may|might|must|can|could|will|would|shall|should|prone)\b/i;

/** The shared product-identity + affected-products view for one projection. */
function consumerView(projection: CaseProjection) {
  const identity = caseIdentity(
    projection.brands ?? [],
    projection.recallingFirm.displayName,
    projection.title,
  );
  const consumer = buildConsumerCase(projection, projection.affectedProducts);
  const productName = cleanProductName({
    title: projection.title,
    productDescription: projection.productDescription ?? null,
    displayedBrands: identity.brand.brands,
    packageEvidence: projection.affectedProducts.map((product) => product.name),
  });
  const model = affectedProductsModel(consumer.packageCheck, productName);
  return { identity, consumer, productName, model, table: affectedProductsTable(model) };
}

test('recorded Jaime’s Jalapeno Ranch: the exact P2b single-row table', () => {
  const { projection, identity } = recordedCase(
    'announcement-jaimes-spanish-village-jalapeno-ranch.json',
  );
  const { productName, model, table } = consumerView(projection);
  // The supported source spelling — the structured product description.
  assert.equal(productName, 'Jalapeno Ranch Dressing');
  assert.equal(identity.brand.text, 'Jaime’s Spanish Village');
  // One table header, one data row: Product, Barcode (UPC), Lot codes — and
  // NO Package Size or date column, because this version has no supported
  // values for them (the prose "16 oz glass jars" carries no size label).
  assert.ok(table, 'the table model is missing');
  assert.deepEqual(
    table!.expanded.columns.map((column) => column.label),
    ['Product', 'Barcode (UPC)', 'Lot codes'],
  );
  assert.equal(table!.expanded.rows.length, 1);
  assert.deepEqual(
    table!.expanded.rows[0].cells.map((cell) => cell.text),
    ['Jalapeno Ranch Dressing', '199284564923', '69, 86, 108, 113, 116, 121'],
  );
  // One product row: no section-level control at all.
  assert.equal(table!.rowsDisclosure, null);
  // (P3C-2) there is no recall-level set left over to render anywhere else.
  assert.deepEqual(model.sharedCodes, []);
  assert.equal(model.sharedProductionDates, null);
  // Six batch codes in one cell now disclose in place, two at a time.
  const codesCell = table!.expanded.rows[0].cells[2];
  assert.equal(codesCell.collapsedText, '69, 86');
  assert.equal(codesCell.disclosure?.expandLabel, 'See all (6)');
});

test('recorded Chocolatey Eyeballs: each version keeps its OWN packaging and size', () => {
  // The official table is Style # / "Packaging (as labeled)", one row per
  // version, each cell pairing the package description with the labeled
  // product and size ("“Crystal Temptations” plastic bag with designed
  // header card – Chocolatey Eyeballs, 10 oz."). The five packaging
  // descriptions are version-specific by the source's own rows — they must
  // never flatten into one case-level blob, never repeat whole on every row,
  // and never masquerade as Product.
  const { projection } = recordedCase('announcement-crystal-temptations-chocolatey-eyeballs.json');
  const { productName, model, table } = consumerView(projection);
  assert.equal(productName, 'Chocolatey Eyeballs');
  assert.equal(model.items.length, 5);
  assert.deepEqual(
    model.items.map((item) => [
      item.name,
      item.fields.find((field) => field.key === 'size')?.value,
      item.fields.find((field) => field.key === 'packaging')?.value,
    ]),
    [
      ['Chocolatey Eyeballs', '10 oz.', 'Plastic bag with designed header card'],
      ['Chocolatey Eyeballs', '7 oz.', 'Acrylic box with designed paper wrap'],
      ['Chocolatey Eyeballs', '10.5 oz.', 'Round plastic jar'],
      ['Chocolatey Eyeballs', '16 oz.', 'Designer plastic pouch bag'],
      ['Chocolatey Eyeballs', '11 oz.', 'Plastic bag tied with a tag'],
    ],
  );
  // Nothing hoists: no packaging value is shared, so none renders case-wide,
  // and no field anywhere carries the five-container enumeration.
  assert.deepEqual(model.appliesToAll, []);
  for (const item of model.items) {
    for (const field of item.fields) {
      assert.ok(
        !field.value.includes('–'),
        `${field.label} still holds a composite: ${field.value}`,
      );
      assert.ok(
        (field.value.match(/bag|box|jar|pouch/gi) ?? []).length <= 2,
        `${field.label} still enumerates containers: ${field.value}`,
      );
    }
  }
  // Five versions → three initial rows plus a working See all (5).
  assert.ok(table);
  assert.deepEqual(
    table!.expanded.columns.map((column) => column.label),
    ['Product', 'Package Size', 'Packaging'],
  );
  assert.equal(table!.initialRows, 1);
  assert.equal(table!.rowsDisclosure?.expandLabel, 'See all (5)');
});

/**
 * P2b corpus invariant: nothing that is not a product identity ever renders
 * as Product — no measurement-only value, no packaging/container description,
 * and no value the closed variant-identity contract classifies as a date,
 * code, document reference, heading, or geography.
 */
test('corpus scan: no measurement, packaging, or non-identity value renders as Product', () => {
  let scanned = 0;
  for (const entry of corpus) {
    let projection;
    try {
      projection = projectCase([
        parseFdaAnnouncement({
          listing: entry.listing,
          detailMainHtml: entry.mainHtml,
          path: entry.path,
        }),
      ]);
    } catch {
      continue;
    }
    const { model } = consumerView(projection);
    scanned += 1;
    for (const item of model.items) {
      if (item.name === null) continue;
      const label = `${slugFromPath(entry.path)}: ${item.name}`;
      assert.ok(!measurementOnlyName(item.name), `measurement as Product — ${label}`);
      assert.ok(!packagingOnlyName(item.name), `packaging as Product — ${label}`);
      // A trailing anchored package count ("… 6 Bars", "… 100 pieces") is
      // Package Size evidence — it never stays inside Product (integration
      // correction: the shared identity path demotes it for every source
      // shape, table, list, prose, and caption alike).
      assert.ok(
        !/\d[\d./]*\s*(?:bars?|pieces?|count|ct|packs?|pks?)\.?$/i.test(item.name),
        `trailing package count in Product — ${label}`,
      );
    }
  }
  assert.ok(scanned >= 155, `only ${scanned} corpus records scanned`);
});

/**
 * P2b corpus invariant: a measurement stripped from the case title is always
 * preserved in the rendered Affected Products data (the description-size
 * guarantee) — the sizes move, they are never lost.
 */
test('corpus scan: every measurement stripped from a title survives as Size evidence', () => {
  let stripped = 0;
  for (const entry of corpus) {
    let projection;
    try {
      projection = projectCase([
        parseFdaAnnouncement({
          listing: entry.listing,
          detailMainHtml: entry.mainHtml,
          path: entry.path,
        }),
      ]);
    } catch {
      continue;
    }
    const { productName, model } = consumerView(projection);
    const raw = productDisplayName(projection.productDescription ?? null, projection.title);
    const split = splitTrailingMeasurements(raw);
    if (!split) continue;
    const last = measurementKey(split.measurements[split.measurements.length - 1]);
    if (measurementKey(productName).includes(last)) continue; // title kept its sizes
    stripped += 1;
    const sizeEvidence = [
      ...model.appliesToAll.filter((field) => field.key === 'size').map((field) => field.value),
      ...model.items.flatMap((item) =>
        item.fields.filter((field) => field.key === 'size').map((field) => field.value),
      ),
    ].map(measurementKey);
    for (const measurement of split.measurements) {
      assert.ok(
        sizeEvidence.some((line) => line.includes(measurementKey(measurement))),
        `${slugFromPath(entry.path)}: stripped "${measurement}" is not preserved as Size`,
      );
    }
  }
  assert.ok(stripped >= 5, `only ${stripped} stripped titles scanned`);
});

/** P2b (§H): the visible brand line is always a concise identity, never prose. */
test('corpus scan: no displayed brand entry is prose-shaped', () => {
  for (const entry of corpus) {
    let projection;
    try {
      projection = projectCase([
        parseFdaAnnouncement({
          listing: entry.listing,
          detailMainHtml: entry.mainHtml,
          path: entry.path,
        }),
      ]);
    } catch {
      continue;
    }
    const { identity } = consumerView(projection);
    for (const brand of identity.brand.brands) {
      assert.ok(brand.length <= 40, `${slugFromPath(entry.path)}: prose brand "${brand}"`);
    }
  }
  // The recorded Russ Davis prose entry falls back to the safe company name.
  const russDavis = corpus.find((entry) => slugFromPath(entry.path).includes('russ-davis'));
  assert.ok(russDavis, 'the Russ Davis corpus record is missing');
  const projection = projectCase([
    parseFdaAnnouncement({
      listing: russDavis!.listing,
      detailMainHtml: russDavis!.mainHtml,
      path: russDavis!.path,
    }),
  ]);
  const { identity } = consumerView(projection);
  assert.equal(identity.brand.text, 'Russ Davis Wholesale');
  assert.equal(identity.brand.usedBrand, false);
});

test('corpus scan: no malformed because-clause survives in any What Happened', () => {
  let scanned = 0;
  for (const entry of corpus) {
    let projection;
    try {
      projection = projectCase([
        parseFdaAnnouncement({
          listing: entry.listing,
          detailMainHtml: entry.mainHtml,
          path: entry.path,
        }),
      ]);
    } catch {
      continue; // parse coverage is qa-harness's concern, not this scan's
    }
    const identity = caseIdentity(
      projection.brands ?? [],
      projection.recallingFirm.displayName,
      projection.title,
    );
    const happened = buildWhatHappened({
      title: projection.title,
      noticeType: projection.noticeType,
      reasonText: projection.reasonText,
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: projection.pathogenOrAllergen,
      firmDisplayName: projection.recallingFirm.displayName,
      summaryText: projection.summaryText,
      productDescription: projection.productDescription ?? null,
      consumerBrand: identity.whatHappenedSubject,
    });
    scanned += 1;
    assert.doesNotMatch(
      happened.text,
      MALFORMED_BECAUSE,
      `${slugFromPath(entry.path)}: ${happened.text}`,
    );
    // A junk placeholder can never become a sentence subject.
    assert.doesNotMatch(happened.text, /^(?:No Brand Name|Multiple brand names|Various)\b/i);
  }
  assert.ok(scanned >= 155, `only ${scanned} corpus records scanned`);
});

// ── P2c: global image-role allocation ───────────────────────────────────────

/** The full Detail model for one projection — the exact allocation Detail
 * renders (no label renders here: recorded FDA fixtures carry none). */
function detailModelFor(projection: CaseProjection) {
  return buildDetailModel(
    {
      id: 'test',
      projection,
      timeline: [],
      affectedProducts: projection.affectedProducts,
      visuals: [],
    },
    { today: '2026-09-02', affectsYou: false },
  );
}

function corpusProjection(fragment: string): CaseProjection {
  const entry = corpus.find((e) => slugFromPath(e.path).includes(fragment));
  assert.ok(entry, `corpus record missing: ${fragment}`);
  return projectCase([
    parseFdaAnnouncement({
      listing: entry!.listing,
      detailMainHtml: entry!.mainHtml,
      path: entry!.path,
    }),
  ]);
}

/**
 * The role-exclusivity invariant, with the one sanctioned exception: in a
 * multi-version table the hero may ALSO back exactly the one row it provably
 * depicts. Everything else stays exclusive — the hero never enters gallery
 * or supporting, no image backs two rows, and gallery/supporting never
 * overlap each other or the row images.
 */
function assertImageRoleInvariants(model: ReturnType<typeof detailModelFor>, label: string) {
  const hero = model.images.hero?.url ?? null;
  const rowUrls = [...model.images.rowImages.values()].map((assignment) => assignment.image.url);
  const pool = [...model.images.gallery, ...model.images.supporting].map((image) => image.url);
  assert.equal(new Set(rowUrls).size, rowUrls.length, `${label}: an image backs two rows`);
  assert.equal(new Set(pool).size, pool.length, `${label}: duplicated gallery/supporting entry`);
  for (const url of pool) {
    assert.notEqual(url, hero, `${label}: the hero re-entered gallery/supporting`);
    assert.ok(!rowUrls.includes(url), `${label}: a row image re-entered gallery/supporting`);
  }
  const heroRowUses = rowUrls.filter((url) => url === hero).length;
  assert.ok(heroRowUses <= 1, `${label}: the hero backs more than one row`);
  if (heroRowUses === 1) {
    assert.ok(
      (model.sections.affectedProducts?.table.expanded.rows.length ?? 0) >= 2,
      `${label}: hero reused in a single-row table`,
    );
  }
  // P3C-2 introduced rows that state no product name. An image is attached
  // through stated identity evidence only, so a nameless row can never carry
  // one — not from its size, its barcode, its codes, or its position — and
  // its accessibility text can never invent an identity for it.
  for (const row of model.sections.affectedProducts?.table.expanded.rows ?? []) {
    if (row.name !== null) continue;
    assert.equal(row.image, null, `${label}: a nameless row was given an image`);
  }
}

const fileName = (url: string) => decodeURIComponent(url).replace(/^.*\//, '').replace(/\?.*$/, '');

test('recorded Jaime’s Jalapeno Ranch: the package image renders once, as the hero only', () => {
  const { projection } = recordedCase('announcement-jaimes-spanish-village-jalapeno-ranch.json');
  const model = detailModelFor(projection);
  // The hero is the stored authoritative selection, unchanged.
  assert.equal(model.images.hero?.url, projection.heroImageUrl);
  assert.equal(model.heroImageUrl, projection.heroImageUrl);
  // A single-row table never reuses the hero — repeating the same image
  // immediately below the title adds nothing.
  assert.equal(model.images.rowImages.size, 0);
  assert.equal(model.sections.affectedProducts!.table!.expanded.rows[0].image, null);
  // The second official label stays a gallery candidate; nothing renders it
  // as a lower Product Photo section.
  assert.deepEqual(
    model.images.gallery.map((image) => fileName(image.url)),
    ['jamie2.jpeg.png'],
  );
  assertImageRoleInvariants(model, 'jalapeno');
});

test('recorded Outshine: exact flavor thumbnails, count demotion, and in-cell codes', () => {
  const projection = corpusProjection('outshine-fruit-bars');
  const model = detailModelFor(projection);
  const table = model.sections.affectedProducts!.table!;
  assert.equal(model.images.hero?.url, projection.heroImageUrl);

  // Collapsed: exactly ONE row — the source's first — with a clean name and
  // "6 Bars" in Package Size. Rows are never reordered, so the first row is
  // the notice's first row, not the soonest date or the smallest code.
  const collapsed = table.collapsed;
  assert.equal(collapsed.rows.length, 1);
  assert.deepEqual(
    collapsed.rows.map((row) => row.name),
    ['Outshine Fruit Bars Strawberry'],
  );
  const colKey = (view: typeof collapsed, key: string) =>
    view.columns.findIndex((column) => column.key === key);
  for (const row of collapsed.rows) {
    assert.equal(row.cells[colKey(collapsed, 'size')].text, '6 Bars');
  }
  // That row's twenty-two batch codes are PAIRED with its best-by dates, so
  // the two columns are one coordinated group rather than two independent
  // lists. Two complete pairs render inline, aligned line for line; the rest
  // are one tap away in place.
  const strawberry = collapsed.rows[0].cells[colKey(collapsed, 'batchCodes')];
  const strawberryDates = collapsed.rows[0].cells[colKey(collapsed, 'bestBy')];
  assert.equal(strawberry.values.length, 22);
  assert.equal(strawberry.disclosure?.expandLabel, 'See all (22)');
  assert.equal(strawberry.disclosure?.expandAccessibilityLabel, 'See all 22 identifier pairs');
  assert.equal(strawberry.pairGroup, 'bestBy+batchCodes');
  assert.equal(strawberryDates.pairGroup, strawberry.pairGroup);
  // One control, carried identically by both halves — neither can move alone.
  assert.deepEqual(strawberryDates.disclosure, strawberry.disclosure);
  // Line-joined, never comma-joined: a best-by date carries its own comma.
  assert.equal(strawberry.collapsedText, 'LLA616903\nLLA617003');
  assert.equal(strawberryDates.collapsedText, 'September 30, 2027\nSeptember 30, 2027');
  // Both halves the same length, so line n of one is the partner of line n of
  // the other. The row states three distinct best-by dates across twenty-two
  // codes; aligned, that is twenty-two statements, not sixty-six.
  assert.equal(strawberryDates.values.length, 22);
  assert.equal(new Set(strawberryDates.values).size, 3);
  // The source-supported pairs are still captured on the model too.
  assert.equal(model.affectedProducts.items[0].codes!.pairs.length, 22);

  // Expanded: all six rows; the trailing package counts moved into Package
  // Size everywhere ("6 Bars" / "24 Bars"), leaving Product clean.
  const expanded = table.expanded;
  assert.deepEqual(
    expanded.rows.map((row) => [row.name, row.cells[colKey(expanded, 'size')].text]),
    [
      ['Outshine Fruit Bars Strawberry', '6 Bars'],
      ['Outshine Fruit Bars Grape', '6 Bars'],
      ['Outshine Fruit Bars Watermelon', '6 Bars'],
      ['Outshine Fruit Bars Black Cherry', '6 Bars'],
      ['Outshine Fruit Bars Tangerine', '6 Bars'],
      ['Outshine Fruit Bars Variety Pack', '24 Bars'],
    ],
  );
  // Tangerine's two codes stay inline with no control. The source printed no
  // date beside them, so that row forms NO pair group and keeps the ordinary
  // comma-joined independent rendering — paired and unpaired rows sit in the
  // same table without either borrowing the other's treatment.
  const codesCells = expanded.rows.map((row) => row.cells[colKey(expanded, 'batchCodes')]);
  assert.equal(codesCells[4].text, 'LLA619603, LLA619703');
  assert.equal(codesCells[4].disclosure, null);
  assert.equal(codesCells[4].pairGroup, null);
  assert.equal(expanded.rows[4].cells[colKey(expanded, 'bestBy')].pairGroup, null);
  // Every other row's codes ARE paired, and each of those groups counts only
  // its own row's pairs.
  assert.deepEqual(
    codesCells.map((cell) => cell.pairGroup),
    Array(6)
      .fill('bestBy+batchCodes')
      .map((group, index) => (index === 4 ? null : group)),
  );
  assert.deepEqual(
    codesCells.map((cell) => cell.disclosure?.expandLabel ?? null),
    ['See all (22)', 'See all (9)', 'See all (16)', 'See all (6)', null, 'See all (5)'],
  );

  // Every flavor holds exactly its caption/UPC-proven image — including the
  // controlled hero reuse: the strawberry hero also backs the strawberry row
  // (two contexts, one proven version), and no other row.
  assert.deepEqual(
    [...model.images.rowImages.entries()].map(([rowId, assignment]) => [
      rowId,
      fileName(assignment.image.url),
      assignment.evidence,
    ]),
    [
      ['t0r0', 'image_1_216.png', 'source_row'],
      ['t0r1', 'image_2_166.png', 'source_row'],
      ['t0r2', 'image_3_98.png', 'source_row'],
      ['t0r3', 'image_4_78.png', 'source_row'],
      ['t0r4', 'image_5_49.png', 'source_row'],
      ['t0r5', 'image_6_37.png', 'source_row'],
    ],
  );
  assert.equal(model.images.rowImages.get('t0r0')!.image.url, model.images.hero!.url);
  assert.equal(
    model.images.rowImages.get('t0r0')!.accessibilityText,
    'Outshine Fruit Bars Strawberry, 6 Bars',
  );
  // The six barcode close-ups stay supporting; the gallery holds nothing —
  // and in particular never the hero.
  assert.equal(model.images.supporting.length, 6);
  assert.ok(model.images.supporting.every((image) => image.classification === 'barcode_closeup'));
  assert.deepEqual(model.images.gallery, []);
  assertImageRoleInvariants(model, 'outshine');
});

test('recorded Chocolatey Eyeballs: five rows; every size-proven image, hero reuse included', () => {
  const { projection } = recordedCase('announcement-crystal-temptations-chocolatey-eyeballs.json');
  const model = detailModelFor(projection);
  const table = model.sections.affectedProducts!.table!;
  // The P2b decomposition is untouched: five product/size/packaging rows.
  assert.equal(table.expanded.rows.length, 5);
  assert.deepEqual(
    table.expanded.columns.map((column) => column.label),
    ['Product', 'Package Size', 'Packaging'],
  );
  // No codes exist → no code column in either view.
  for (const view of [table.collapsed, table.expanded]) {
    assert.ok(
      !view.columns.some((column) => column.key === 'lotCodes' || column.key === 'batchCodes'),
    );
  }
  // Each row gets the image whose official caption states its exact size —
  // including the controlled reuse of the 10 oz hero on the 10 oz row.
  assert.equal(model.images.hero?.url, projection.heroImageUrl);
  assert.deepEqual(
    table.expanded.rows.map((row) => ({
      file: row.image ? fileName(row.image.url) : null,
      a11y: row.image?.accessibilityText ?? null,
      evidence: model.images.rowImages.get(row.id)?.evidence ?? null,
    })),
    [
      {
        file: 'image_1_229.png',
        a11y: 'Chocolatey Eyeballs, 10 oz.',
        evidence: 'caption_name_size',
      },
      {
        file: 'image_2_178.png',
        a11y: 'Chocolatey Eyeballs, 7 oz.',
        evidence: 'caption_name_size',
      },
      {
        file: 'image_3_102.png',
        a11y: 'Chocolatey Eyeballs, 10.5 oz.',
        evidence: 'caption_name_size',
      },
      {
        file: 'image_4_84.png',
        a11y: 'Chocolatey Eyeballs, 16 oz.',
        evidence: 'caption_name_size',
      },
      {
        file: 'image_5_50.png',
        a11y: 'Chocolatey Eyeballs, 11 oz.',
        evidence: 'caption_name_size',
      },
    ],
  );
  assert.equal(model.images.rowImages.get('t0r0')!.image.url, model.images.hero!.url);
  // The reused hero still never enters the gallery.
  assert.deepEqual(model.images.gallery, []);
  assertImageRoleInvariants(model, 'crystal');
});

test('recorded Sun Hong and Great One: the audited hero duplication renders once', () => {
  // The earlier audit observed hero == primaryPhoto == checkerPhotos[0] in
  // both mechanisms' data. Under the allocation the asset holds exactly one
  // visible role, and the remaining official images stay unique.
  const sunHong = detailModelFor(corpusProjection('sun-hong-foods'));
  assert.ok(sunHong.images.hero, 'Sun Hong lost its hero');
  assert.deepEqual(
    sunHong.images.gallery.map((image) => fileName(image.url)),
    ['Back Enoki.jpeg', 'Front Enoki.jpeg'],
  );
  assert.equal(sunHong.images.rowImages.size, 0);
  assertImageRoleInvariants(sunHong, 'sun-hong');

  const greatOne = detailModelFor(corpusProjection('great-one-trading'));
  assert.ok(greatOne.images.hero, 'Great One lost its hero');
  // The rows whose captions uniquely name them get exactly those labels —
  // including the controlled reuse of the hero on the Mushroom Fish Ball row
  // its caption proves.
  assert.deepEqual(
    [...greatOne.images.rowImages.entries()].map(([rowId, assignment]) => [
      rowId,
      fileName(assignment.image.url),
      assignment.evidence,
    ]),
    [
      ['t0r3', 'Image 3_9.jpg', 'caption_name'],
      ['t0r4', 'Image 5_4.jpg', 'caption_name'],
      ['t0r1', 'Image 2_27.jpg', 'caption_name'],
      ['t0r0', 'Image 1_34.jpg', 'caption_name'],
    ],
  );
  assert.equal(greatOne.images.rowImages.get('t0r0')!.image.url, greatOne.images.hero!.url);
  assertImageRoleInvariants(greatOne, 'great-one');
});

test('recorded no-image notice: null hero, empty gallery, no row images, no placeholder fields', () => {
  const model = detailModelFor(corpusProjection('quaker-recalls-granola'));
  assert.equal(model.heroImageUrl, null);
  assert.equal(model.images.hero, null);
  assert.deepEqual(model.images.gallery, []);
  assert.deepEqual(model.images.supporting, []);
  assert.equal(model.images.rowImages.size, 0);
  for (const row of model.sections.affectedProducts?.table?.expanded.rows ?? []) {
    assert.equal(row.image, null);
  }
});

/**
 * P2c corpus audit, pinned: the complete set of affected-row image
 * assignments across the recorded corpus — every one manually reviewed
 * against its recorded official caption (name, size, and barcode agreement).
 * A new assignment, a lost assignment, or a changed mechanism fails here and
 * must be re-reviewed, not re-pinned blindly.
 */
const PINNED_ROW_IMAGE_CENSUS = [
  '4earth-farms-llc-recalls-organic-and-con|t0r0|image_1_46.png|source_row',
  '4earth-farms-llc-recalls-organic-and-con|t0r1|image_2_29.png|source_row',
  '4earth-farms-llc-recalls-organic-and-con|t0r2|image_3_15.png|source_row',
  '4earth-farms-llc-recalls-organic-and-con|t0r3|image_4_14.png|source_row',
  '4earth-farms-llc-recalls-organic-and-con|t0r4|image_5_5.png|source_row',
  '4earth-farms-llc-recalls-organic-and-con|t0r5|image_6_5.png|source_row',
  '4earth-farms-llc-recalls-organic-and-con|t0r7|image_8_3.png|source_row',
  '4earth-farms-llc-recalls-organic-and-con|t0r8|image_9_3.png|source_row',
  'conagra-brands-issues-voluntary-allergy-|t0r2|WB Thousand Island 24.jpeg|source_row',
  'conagra-brands-issues-voluntary-allergy-|t0r3|WB Blue Cheese 24.jpeg|source_row',
  'direct-source-seafood-llc-recalling-froz|t0r1|image_2_168.jpg|source_row',
  'enjoy-life-natural-brands-llc-conducts-n|t0r0|image-1_37.jpg|caption_name',
  'enjoy-life-natural-brands-llc-conducts-n|t0r10|image-11_5.jpg|caption_name_size',
  'enjoy-life-natural-brands-llc-conducts-n|t0r11|image-12_5.jpg|caption_name_size',
  'enjoy-life-natural-brands-llc-conducts-n|t0r1|image-2_28.jpg|caption_name_size',
  'enjoy-life-natural-brands-llc-conducts-n|t0r2|image-3_10.jpg|caption_name_size',
  'enjoy-life-natural-brands-llc-conducts-n|t0r3|image-4_3.jpg|caption_name_size',
  'enjoy-life-natural-brands-llc-conducts-n|t0r4|image-5_31.jpg|caption_name_size',
  'enjoy-life-natural-brands-llc-conducts-n|t0r5|image-6_22.jpg|caption_name_size',
  'enjoy-life-natural-brands-llc-conducts-n|t0r6|image-7_13.jpg|caption_name_size',
  'enjoy-life-natural-brands-llc-conducts-n|t0r7|image-8_12.jpg|caption_name_size',
  'enjoy-life-natural-brands-llc-conducts-n|t0r8|image-9_9.jpg|caption_name_size',
  'enjoy-life-natural-brands-llc-conducts-n|t0r9|image-10_8.jpg|caption_name_size',
  'fresh-ready-foods-llc-recalls-spicy-brea|t0r0|ready2_0.jpg|caption_name',
  'fresh-ready-foods-llc-recalls-spicy-brea|t0r1|ready4.png|caption_name',
  'global-mix-inc-recalls-tejocote-products|t0r0|image_5_8.jpg|source_row',
  'global-mix-inc-recalls-tejocote-products|t0r1|image_4_14.jpg|source_row',
  'global-mix-inc-recalls-tejocote-products|t0r2|image_3_17.jpg|source_row',
  'great-one-trading-inc-issues-expanding-a|t0r0|Image 1_34.jpg|caption_name',
  'great-one-trading-inc-issues-expanding-a|t0r1|Image 2_27.jpg|caption_name',
  'great-one-trading-inc-issues-expanding-a|t0r3|Image 3_9.jpg|caption_name',
  'great-one-trading-inc-issues-expanding-a|t0r4|Image 5_4.jpg|caption_name',
  'lyons-magnus-expands-voluntary-recall-in|t0r144|image-14_4.jpg|caption_name',
  'lyons-magnus-expands-voluntary-recall-in|t0r205|image-17_3.jpg|caption_name',
  'motivate-me-ashley-llc-recalling-vidasli|t0r0|image_2_93.jpg|caption_name',
  'motivate-me-ashley-llc-recalling-vidasli|t0r1|image_4_40.jpg|caption_name',
  'motivate-me-ashley-llc-recalling-vidasli|t0r2|image_6_18.jpg|caption_name',
  'motivate-me-ashley-llc-recalling-vidasli|t0r3|image_8_14.jpg|caption_name',
  'motivate-me-ashley-llc-recalling-vidasli|t0r4|image_10_7.jpg|caption_name',
  'motivate-me-ashley-llc-recalling-vidasli|t0r5|image_11_6.jpg|caption_name',
  'prince-bakery-inc-issues-allergy-alert-u|t0r0|image_1_217.png|source_row',
  'prince-bakery-inc-issues-allergy-alert-u|t0r1|image_3_100.png|source_row',
  'prince-bakery-inc-issues-allergy-alert-u|t0r3|image_2_168.png|source_row',
  'prince-bakery-inc-issues-allergy-alert-u|t0r4|image_4_80.png|source_row',
  'russ-davis-wholesale-recalls-peaches-and|t0r0|image-1_51.jpg|caption_name',
  'russ-davis-wholesale-recalls-peaches-and|t0r1|image-2_34.jpg|caption_name',
  'three-turkey-wrap-sandwiches-added-mg-fo|t0r0|Product label, Fresh to You Deluxe Club Wrap.jpg|caption_name',
  'updated-dreyers-grand-ice-cream-inc-issu|t0r0|image_1_216.png|source_row',
  'updated-dreyers-grand-ice-cream-inc-issu|t0r1|image_2_166.png|source_row',
  'updated-dreyers-grand-ice-cream-inc-issu|t0r2|image_3_98.png|source_row',
  'updated-dreyers-grand-ice-cream-inc-issu|t0r3|image_4_78.png|source_row',
  'updated-dreyers-grand-ice-cream-inc-issu|t0r4|image_5_49.png|source_row',
  'updated-dreyers-grand-ice-cream-inc-issu|t0r5|image_6_37.png|source_row',
];

test('corpus audit: allocation invariants hold everywhere, and every row assignment is pinned', () => {
  let scanned = 0;
  const census: string[] = [];
  for (const entry of corpus) {
    let projection;
    try {
      projection = projectCase([
        parseFdaAnnouncement({
          listing: entry.listing,
          detailMainHtml: entry.mainHtml,
          path: entry.path,
        }),
      ]);
    } catch {
      continue;
    }
    const slug = slugFromPath(entry.path);
    const model = detailModelFor(projection);
    scanned += 1;
    // The hero is exactly the stored authoritative selection — this milestone
    // changes no hero anywhere in the corpus.
    assert.equal(model.images.hero?.url ?? null, projection.heroImageUrl ?? null, slug);
    assert.equal(model.heroImageUrl, projection.heroImageUrl ?? null, slug);
    // Role exclusivity, allowing only the one evidence-proven hero-to-row
    // reuse in a multi-version table.
    assertImageRoleInvariants(model, slug);
    for (const [rowId, assignment] of model.images.rowImages) {
      census.push(
        `${slug.slice(0, 40)}|${rowId}|${fileName(assignment.image.url)}|${assignment.evidence}`,
      );
    }
    const table = model.sections.affectedProducts?.table ?? null;
    if (table) {
      // The table renders exactly the allocation's verdicts, in both views.
      for (const view of [table.collapsed, table.expanded]) {
        for (const row of view.rows) {
          const assignment = model.images.rowImages.get(row.id) ?? null;
          assert.equal(row.image?.url ?? null, assignment?.image.url ?? null, `${slug}/${row.id}`);
        }
        // No rendered column is entirely empty in the view that shows it, and
        // a code-bearing visible row never presents an empty codes cell.
        view.columns.forEach((column, index) => {
          if (column.key === 'product') {
            assert.ok(
              view.rows.some((row) => row.name !== null),
              `${slug}: empty Product column`,
            );
            return;
          }
          assert.ok(
            view.rows.some((row) => row.cells[index].text !== null),
            `${slug}: column ${column.key} entirely empty in a rendered view`,
          );
        });
      }
    }
  }
  assert.ok(scanned >= 155, `only ${scanned} corpus records scanned`);
  assert.deepEqual(census.sort(), PINNED_ROW_IMAGE_CENSUS);
});

// ── P2c correction: identity gate + stored photo associations ───────────────

test('recorded Sun Hong: no origin or net-weight pseudo-product rows survive', () => {
  // The notice's package-description comma list ("…Enoki Mushrooms (orange
  // front), Product of Korea, Net weight 7.05 oz/200g") flattened into prose
  // variants; the identity gate now rejects the label-metadata entries
  // globally while the genuine version survives untouched.
  const projection = corpusProjection('sun-hong-foods');
  const consumer = buildConsumerCase(projection, projection.affectedProducts);
  assert.deepEqual(
    consumer.packageCheck.variants.map((variant) => variant.name),
    ['Enoki Mushrooms (orange front)'],
  );
  const model = detailModelFor(projection);
  for (const row of model.sections.affectedProducts?.table?.expanded.rows ?? []) {
    assert.ok(!/^products?\s+of\b/i.test(row.name ?? ''), `origin row: ${row.name}`);
    assert.ok(!/^net\s+(?:wt|weight)\b/i.test(row.name ?? ''), `weight row: ${row.name}`);
  }
});

test('recorded 4Earth Farms: every stored photo association is proven by its caption UPC', () => {
  // Before the correction, caption-prefix matching stored sibling images on
  // the wrong same-named rows (caption UPC 803944306999 on the row for UPC
  // 711535517733). The shared contradiction policy plus identity-keyed
  // matching now stores only caption-discriminated pairings.
  const projection = corpusProjection('4earth-farms');
  const consumer = buildConsumerCase(projection, projection.affectedProducts);
  let attached = 0;
  for (const variant of consumer.packageCheck.variants) {
    if (!variant.photo) continue;
    attached += 1;
    const size = variant.fields.find((field) => field.key === 'size')?.value ?? '';
    const caption = variant.photo.alt ?? '';
    const rowUpc = size.match(/\d{11,14}/)?.[0];
    const captionUpc = caption.match(/\d{11,14}/)?.[0];
    // Wherever both the row and its caption state a barcode, they agree.
    if (rowUpc && captionUpc) {
      assert.equal(captionUpc, rowUpc, `${variant.scope}: "${size}" <- "${caption}"`);
    }
  }
  // All three same-named Organic Vegetable Medley rows (and the rest) hold
  // their own UPC-proven image — eight associations, none guessed.
  assert.equal(attached, 8);
});

test('recorded Conagra: contradicted and indistinguishable sibling associations are refused', () => {
  const projection = corpusProjection('conagra-brands');
  const consumer = buildConsumerCase(projection, projection.affectedProducts);
  const bySize = consumer.packageCheck.variants.map((variant) => ({
    scope: variant.scope,
    size: variant.fields.find((field) => field.key === 'size')?.value,
    caption: variant.photo?.alt ?? null,
  }));
  // The two 15 oz Thousand Island rows are indistinguishable by the 15 oz
  // caption — neither stores it. The 24 oz rows each hold their own
  // size-agreeing image; the 24 oz caption can never sit on a 15 oz row.
  assert.deepEqual(bySize, [
    { scope: 't0r0', size: '15 oz', caption: null },
    { scope: 't0r1', size: '15 oz', caption: null },
    { scope: 't0r2', size: '24 oz', caption: 'Wish-Bone Thousand Island Dressing, Net Wt 24 oz.' },
    { scope: 't0r3', size: '24 oz', caption: 'Wish-Bone® CHUNKY BLUE CHEESE DRESSING, 24 oz' },
  ]);
});

test("recorded Tony's Chocolonely: a product photo is never guessed onto one sibling lot row", () => {
  // Four Everything Bar rows differ only by lot/date (and one by UPC); the
  // caption "Everything bar" states no identifier, so it cannot single one
  // out. The former arbitrary first-row attachment is refused at the source;
  // the image stays an unassigned official photo (a gallery candidate).
  const projection = corpusProjection('tonys-chocolonely');
  const consumer = buildConsumerCase(projection, projection.affectedProducts);
  assert.ok(consumer.packageCheck.variants.length >= 7);
  for (const variant of consumer.packageCheck.variants) {
    assert.equal(variant.photo, null, `${variant.scope} guessed a photo`);
  }
  const model = detailModelFor(projection);
  assert.ok(
    model.images.gallery.some((image) => /Everything bar/i.test(image.caption ?? '')),
    'the Everything bar photo was lost instead of staying a gallery candidate',
  );
});

test('corpus audit: no stored variant-photo association contradicts its own caption', () => {
  // The stored-association layer, audited corpus-wide with the SAME shared
  // policy the display allocator uses — the two layers cannot disagree.
  let scanned = 0;
  let associations = 0;
  for (const entry of corpus) {
    let projection;
    try {
      projection = projectCase([
        parseFdaAnnouncement({
          listing: entry.listing,
          detailMainHtml: entry.mainHtml,
          path: entry.path,
        }),
      ]);
    } catch {
      continue;
    }
    scanned += 1;
    const consumer = buildConsumerCase(projection, projection.affectedProducts);
    for (const variant of consumer.packageCheck.variants) {
      // Origin/net-weight label metadata can never be a row anywhere. A
      // nameless row (P3C-2) states no identity at all, so there is nothing
      // for the metadata patterns to match.
      assert.ok(
        variant.name === null ||
          (!/^products?\s+of\s+(?:the\s+)?[A-Za-z .]+$/i.test(variant.name) &&
            !/^net\s+(?:wt|weight)\b/i.test(variant.name)),
        `${slugFromPath(entry.path)}: non-product row "${variant.name}"`,
      );
      if (!variant.photo?.alt) continue;
      associations += 1;
      const size = variant.fields.find((field) => field.key === 'size')?.value ?? null;
      assert.equal(
        captionContradictsPackage(variant.photo.alt, {
          name: variant.name,
          size: size !== null && !size.includes(',') ? size : null,
          upc: variant.fields.find((field) => field.key === 'upc')?.value ?? null,
        }),
        false,
        `${slugFromPath(entry.path)}/${variant.scope}: "${variant.name}" <- "${variant.photo.alt}"`,
      );
    }
  }
  assert.ok(scanned >= 155, `only ${scanned} corpus records scanned`);
  assert.ok(associations >= 20, `only ${associations} stored associations audited`);
});

test('recorded Taylor Fresh: a column no visible row justifies waits for See all', () => {
  // The first three rows state no package size; later rows do. Collapsed
  // shows no Package Size column at all — never a column of empty cells —
  // and expanding recomputes the columns over every displayed row.
  const model = detailModelFor(corpusProjection('taylor-fresh-foods'));
  const table = model.sections.affectedProducts!.table!;
  assert.ok(table.rowsDisclosure, 'expected a See all control');
  assert.deepEqual(
    table.collapsed.columns.map((column) => column.key),
    ['product', 'bestBy'],
  );
  assert.deepEqual(
    table.expanded.columns.map((column) => column.key),
    ['product', 'size', 'bestBy'],
  );
});

test('recorded YoCrunch: a mixed view keeps the codes column with honest empty cells', () => {
  // Only one row carries lot codes: the column exists (a code-bearing visible
  // row never hides its codes), that row shows its own value, and the others
  // stay empty. Asserted on the expanded view, because the collapsed view is
  // one row and computes its columns over exactly that row — a column no
  // visible row populates correctly does not render at all.
  const model = detailModelFor(corpusProjection('yocrunchr-products'));
  const table = model.sections.affectedProducts!.table!;
  const view = table.expanded;
  const lotIndex = view.columns.findIndex((column) => column.key === 'lotCodes');
  assert.ok(lotIndex >= 0, 'the lot-codes column is missing');
  const bearing = view.rows.filter((row) => row.cells[lotIndex].text !== null);
  assert.equal(bearing.length, 1);
  // Empty cells are empty — never a dash, never a borrowed value.
  for (const row of view.rows) {
    if (bearing.includes(row)) continue;
    assert.equal(row.cells[lotIndex].text, null);
    assert.deepEqual(row.cells[lotIndex].values, []);
  }
});

// ── P3A: section visibility and Home/Detail reason parity ───────────────────

/** Every corpus projection that parses, keyed by slug. */
function everyProjection(): { slug: string; projection: CaseProjection }[] {
  const out: { slug: string; projection: CaseProjection }[] = [];
  for (const entry of corpus) {
    try {
      out.push({
        slug: slugFromPath(entry.path),
        projection: projectCase([
          parseFdaAnnouncement({
            listing: entry.listing,
            detailMainHtml: entry.mainHtml,
            path: entry.path,
          }),
        ]),
      });
    } catch {
      continue;
    }
  }
  return out;
}

/** The agent/material/allergen a typed reason names, or null. */
function agentOf(reason: ReturnType<typeof interpretReason>): string | null {
  switch (reason.family) {
    case 'pathogen':
      return reason.pathogen;
    case 'foreign_material':
      return reason.material;
    case 'chemical':
      return reason.agent;
    case 'allergen':
      return reason.raw;
    default:
      return null;
  }
}

test('P3A recorded Palermo Villa: BOTH surfaces name plastic, and neither names metal', () => {
  // Its FDA reason category is the dual "Potential Metal or Chemical
  // Contaminant" — a taxonomy label that names two possibilities and states
  // neither. The notice's own title states the contaminant, and the title is
  // on every feed row, so Home reaches the same answer Detail does.
  const projection = corpusProjection('palermo-villa');
  const home = conciseReasonLine({
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    title: projection.title,
  });
  const detail = detailModelFor(projection).whatHappened.text;
  assert.equal(home, 'Potential plastic contamination.');
  assert.match(detail, /may contain pieces of plastic/);
  for (const surface of [home, detail]) {
    assert.ok(!/\bmetal\b/i.test(surface!), `metal named: ${surface}`);
  }
});

test('P3A recorded Jalapeno Ranch: its one meaningful row keeps the section', () => {
  const { projection } = recordedCase('announcement-jaimes-spanish-village-jalapeno-ranch.json');
  const section = detailModelFor(projection).sections.affectedProducts;
  assert.ok(section, 'the single-row section was hidden');
  assert.equal(section!.table!.expanded.rows.length, 1);
  assert.equal(section!.table!.expanded.rows[0].name, 'Jalapeno Ranch Dressing');
});

test('P3A recorded no-image notice: no placeholder, and imagery never decides a section', () => {
  // The recorded notice with no imagery at all still shows its real rows —
  // section visibility follows readable content, never the image allocation.
  const withRows = detailModelFor(corpusProjection('quaker-recalls-granola'));
  assert.equal(withRows.heroImageUrl, null);
  assert.equal(withRows.images.rowImages.size, 0);
  assert.ok(withRows.sections.affectedProducts, 'real rows were hidden with the imagery');
  // And a recorded notice that supports no rows renders no section at all —
  // no heading, no placeholder, nothing held open.
  const withNothing = detailModelFor(corpusProjection('ikm-recalls-product'));
  assert.equal(withNothing.sections.affectedProducts, null);
  assert.equal(withNothing.affectedProducts.items.length, 0);
});

test('P3A corpus scan: no Detail section can render a heading above nothing', () => {
  let scanned = 0;
  let visible = 0;
  for (const { slug, projection } of everyProjection()) {
    const model = detailModelFor(projection);
    scanned += 1;
    // What happened is never optional and never empty (title fallback).
    assert.notEqual(model.whatHappened.text.trim(), '', slug);
    // Where it was sold renders its one representation, or is absent.
    if (model.sections.whereSold !== null) {
      assert.notEqual(model.sections.whereSold.lead.trim(), '', `empty Where it was sold: ${slug}`);
    }
    const section = model.sections.affectedProducts;
    if (section === null) {
      // PROOF the hidden section held nothing: no rows, no codes, no dates.
      assert.equal(model.affectedProducts.items.length, 0, `a real row was hidden: ${slug}`);
      assert.deepEqual(model.affectedProducts.sharedCodes, [], slug);
      assert.equal(model.affectedProducts.sharedProductionDates, null, slug);
      continue;
    }
    visible += 1;
    // A visible section is a table, and the table always carries something
    // readable (P3C-2: the section has nothing else in it).
    const readable =
      section.table.expanded.columns.length > 0 &&
      section.table.expanded.rows.some(
        (row) =>
          (row.name ?? '').trim() !== '' ||
          row.cells.some((cell) => (cell.text ?? '').trim() !== ''),
      );
    assert.ok(readable, `visible section with no readable content: ${slug}`);
  }
  assert.ok(scanned >= 155, `only ${scanned} corpus records scanned`);
  assert.ok(visible >= 100, `only ${visible} sections visible`);
});

test('P3A corpus scan: Home and Detail never disagree about a reason', () => {
  let scanned = 0;
  let refined = 0;
  for (const { slug, projection } of everyProjection()) {
    const homeEvidence = {
      reasonText: projection.reasonText,
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: projection.pathogenOrAllergen,
      title: projection.title,
    };
    const home = interpretReason(homeEvidence);
    const detail = interpretReason({ ...homeEvidence, summaryText: projection.summaryText });
    scanned += 1;
    // Family: identical on every notice — it comes from structured fields.
    assert.equal(home.family, detail.family, `family disagreement: ${slug}`);
    // Agent/material/allergen: Home names nothing, or exactly what Detail
    // names. A third answer is the contradiction this scan exists to catch.
    const [a, b] = [agentOf(home), agentOf(detail)];
    assert.ok(a === null || a === b, `${slug}: Home "${a}" vs Detail "${b}"`);
    if (a === null && b !== null) refined += 1;
    // Packaging is never a hazard: a named material always comes from the
    // closed vocabulary AND from a notice that states a foreign-material
    // hazard at all. A notice whose only material word describes its package
    // states no such hazard, so it can never reach a named contaminant.
    for (const named of [a, b]) {
      if (named === null || home.family !== 'foreign_material') continue;
      assert.ok(FOREIGN_MATERIALS.includes(named), `${slug}: "${named}" is outside the vocabulary`);
      assert.equal(
        extractForeignMaterialEvidence(
          `${projection.reasonText ?? ''}\n${projection.title}\n${projection.summaryText}`,
        ).stated,
        true,
        `${slug}: "${named}" named where no foreign-material hazard is stated`,
      );
    }
  }
  assert.ok(scanned >= 155, `only ${scanned} corpus records scanned`);
  assert.ok(refined >= 1, 'the summary-only refinement case disappeared from the corpus');
});

// ── P3C-2: the table is the sole owner of affected-product codes ────────────

/** A view's rendered cell for one column key, by row index. */
function cellAt(
  view: { columns: { key: string }[]; rows: { cells: any[] }[] },
  row: number,
  key: string,
) {
  const index = view.columns.findIndex((column) => column.key === key);
  assert.notEqual(index, -1, `no ${key} column`);
  return view.rows[row].cells[index];
}

test('P3C-2 corpus scan: no notice keeps a code or date outside the table', () => {
  // The founder's final ruling, measured over every recorded announcement:
  // there is no below-table code disclosure and no below-table production-date
  // line, because the model has no field left for one to render from.
  let scanned = 0;
  let inTable = 0;
  for (const { slug, projection } of everyProjection()) {
    scanned += 1;
    const model = detailModelFor(projection);
    const section = model.sections.affectedProducts;
    if (section === null) continue;
    const view = section.table.expanded;
    // Every rendered column is justified by a row IN THIS VIEW, in both the
    // collapsed and expanded renderings — a column of empty cells never
    // renders, and that stays true after "See all".
    for (const rendering of [section.table.collapsed, section.table.expanded]) {
      rendering.columns.forEach((column, index) => {
        assert.ok(
          rendering.rows.some((row) => (row.cells[index].text ?? '').trim() !== ''),
          `${slug}: empty ${column.key} column`,
        );
      });
    }
    if (
      view.columns.some((column) =>
        ['lotCodes', 'batchCodes', 'productionCodes', 'productionDates'].includes(column.key),
      )
    ) {
      inTable += 1;
    }
  }
  assert.ok(scanned >= 155, `only ${scanned} corpus records scanned`);
  assert.ok(inTable >= 40, `only ${inTable} notices render codes or production dates in the table`);
});

test('P3C-2 shape B: King Arthur keeps one row per source row, each date with its codes', () => {
  // The source table is Best Used By / Lot Code with NO product column. Its
  // nineteen rows used to be discarded whole: the recall rendered as one row
  // named from the title, its nineteen dates merged into a single cell, and
  // its thirty-four lot codes flattened into a recall-wide block beneath the
  // table where no date could be matched to any code.
  const model = detailModelFor(corpusProjection('king-arthur-flour'));
  const view = model.sections.affectedProducts!.table.expanded;
  assert.equal(view.rows.length, 19);
  // Every row lacks a product name, so the Product column does not render at
  // all — no useless column of empty cells, and no name borrowed from the
  // recall title to fill it.
  assert.deepEqual(
    view.columns.map((column) => column.key),
    ['bestBy', 'upc', 'lotCodes'],
  );
  assert.ok(view.rows.every((row) => row.name === null));
  // The source's own pairing, row by row.
  assert.equal(cellAt(view, 0, 'bestBy').text, 'December 4, 2019');
  assert.equal(cellAt(view, 0, 'lotCodes').text, 'L18A04A');
  assert.equal(cellAt(view, 1, 'bestBy').text, 'December 5, 2019');
  assert.equal(cellAt(view, 1, 'lotCodes').text, 'L18A05A, L18A05B, L18A05C');
  // The recall-wide barcode is PROVEN shared (no source row states one), so
  // it repeats into every row. Repetition is the contract.
  assert.ok(view.rows.every((_, index) => cellAt(view, index, 'upc').text === '071012010509'));
  // Every lot code the source states appears exactly once, in its own row.
  const codes = view.rows.flatMap((_, index) =>
    (cellAt(view, index, 'lotCodes').text ?? '').split(', '),
  );
  assert.equal(codes.length, 34);
  assert.equal(new Set(codes).size, 34);
  // …and the date that used to render as a lot code is gone from the codes.
  assert.ok(!codes.includes('12/04/19'));
  // Long tables collapse; the initial view is ONE row and its columns are
  // computed over exactly that row.
  assert.equal(model.sections.affectedProducts!.table.rowsDisclosure?.expandLabel, 'See all (19)');
  assert.equal(model.sections.affectedProducts!.table.collapsed.rows.length, 1);
  // No image is attached to any nameless row.
  assert.ok(view.rows.every((row) => row.image === null));
});

test('P3C-2 shape B: MedTech pairs each lot with its own expiration', () => {
  const view = detailModelFor(corpusProjection('medtech-products')).sections.affectedProducts!.table
    .expanded;
  assert.equal(view.rows.length, 5);
  assert.ok(view.rows.every((row) => row.name === null));
  assert.deepEqual(
    view.rows.map((_, index) => [
      cellAt(view, index, 'lotCodes').text,
      cellAt(view, index, 'expiration').text,
    ]),
    [
      ['0039', 'November 2025'],
      ['0545', 'January 2026'],
      ['0640', 'February 2026'],
      ['0450', 'May 2026'],
      ['1198', 'December 2026'],
    ],
  );
  // The source's rowspan barcode is shared, and repeats into all five rows.
  assert.ok(view.rows.every((_, index) => cellAt(view, index, 'upc').text === '756184107379'));
});

test('P3C-2 shape B: a column-oriented grid is not read as rows', () => {
  // Wawona's recorded table puts one best-by date in each COLUMN header and
  // that date's lot codes beneath it, so a single `<tr>` holds four codes
  // belonging to four different dates. Reading those `<tr>`s as rows would
  // group codes the source never grouped — and, because its last four `<tr>`s
  // hold only the tail of the longest column, it would also publish four of
  // twenty-three codes and silently drop the rest.
  const model = detailModelFor(corpusProjection('wawona-frozen-foods'));
  const view = model.sections.affectedProducts!.table.expanded;
  assert.equal(view.rows.length, 1);
  // P2B7G: the row is named by the shared cleaned product name, which now
  // spaces the jammed "4lb" (an approved unit-spacing delta — see
  // presentation-casing.test.ts APPROVED_UNIT_SPACING_DELTAS).
  assert.equal(view.rows[0].name, 'Organic Daybreak Blend 4 lb bags of frozen fruit');
  const codes = cellAt(view, 0, 'lotCodes');
  assert.equal(codes.disclosure!.expandLabel, 'See all (23)');
  assert.equal(codes.values.length, 23);
  // Each code still carries the column date the source printed above it —
  // captured on the model, which is where that pairing lives now that the
  // cell renders the codes themselves.
  // Wawona states its codes about the whole recalled population, so the
  // pairing lives on the model's shared set — which the table repeats into
  // the one row that owns it.
  const sourceCodes =
    model.affectedProducts.items[0].codes ??
    model.affectedProducts.sharedCodes.find((set) => set.key === 'lotCodes')!.codes;
  assert.equal(sourceCodes.pairs.length, 23);
  assert.equal(
    sourceCodes.pairs.find((pair) => pair.code === '20082D04')!.date,
    'September 23, 2023',
  );
  assert.equal(
    sourceCodes.pairs.find((pair) => pair.code === '20108D08')!.date,
    'October 18, 2023',
  );
});

test('P3C-2 shape B: a nameless row with no consumer facts is still refused', () => {
  // Albanese's second recorded table is 191 store addresses; Murray's is
  // internal item numbers; Grimmway's is label prose. None maps onto an
  // approved consumer field, so none becomes a row — the gate that kept them
  // out is unchanged, and a 191-row address table can never reach the screen.
  for (const [fragment, maxRows] of [
    ['albanese-confectionery', 2],
    ['murray-intl-trading', 1],
    ['grimmway-farms-expands', 1],
    ['taharka-brothers', 0],
  ] as const) {
    const section = detailModelFor(corpusProjection(fragment)).sections.affectedProducts;
    const rows = section?.table.expanded.rows.length ?? 0;
    assert.ok(rows <= maxRows, `${fragment}: ${rows} rows`);
  }
});

test('P3C-2 shape D: recall-level codes render as one anonymous evidence row', () => {
  // Four recorded notices state supported codes and name no product row for
  // them. Before P3C-2 each rendered an empty table area with a code
  // disclosure beneath it; now the codes ARE the table, in one anonymous row
  // whose Product column does not render.
  for (const [fragment, label, count] of [
    ['twin-sisters-creamery', 'See all (8)', 8],
    ['sheng-kee-california', 'See all (17)', 17],
    ['hardies-fresh-foods-recalls-cucumbers', 'See all (7)', 7],
  ] as const) {
    const view = detailModelFor(corpusProjection(fragment)).sections.affectedProducts!.table
      .expanded;
    assert.equal(view.rows.length, 1, fragment);
    assert.equal(view.rows[0].name, null, fragment);
    assert.ok(
      !view.columns.some((column) => column.key === 'product'),
      `${fragment}: an empty Product column rendered`,
    );
    assert.equal(view.rows[0].cells[0].disclosure?.expandLabel, label, fragment);
    assert.equal(view.rows[0].cells[0].values.length, count, fragment);
    // A nameless row never receives an image.
    assert.equal(view.rows[0].image, null, fragment);
  }
});

test('P3C-2 shape D: production codes and their readable dates are table cells', () => {
  const view = detailModelFor(corpusProjection('hardies-fresh-foods-recalls-jalapenos')).sections
    .affectedProducts!.table.expanded;
  assert.deepEqual(
    view.columns.map((column) => column.key),
    ['productionDates', 'lotCodes', 'productionCodes'],
  );
  assert.equal(view.rows.length, 1);
  // Five production codes, each printed beside its own readable date: one
  // aligned pair group, line-joined because these values carry commas.
  const jalapenoDates = cellAt(view, 0, 'productionDates');
  const jalapenoCodes = cellAt(view, 0, 'productionCodes');
  assert.equal(
    jalapenoDates.text,
    'July 11, 2026\nJuly 15, 2026\nJuly 16, 2026\nJuly 18, 2026\nJuly 22, 2026',
  );
  assert.equal(jalapenoDates.pairGroup, 'productionDates+productionCodes');
  assert.equal(jalapenoCodes.pairGroup, jalapenoDates.pairGroup);
  assert.equal(jalapenoDates.disclosure?.expandAccessibilityLabel, 'See all 5 identifier pairs');
  assert.equal(jalapenoDates.collapsedText, 'July 11, 2026\nJuly 15, 2026');
  assert.equal(jalapenoCodes.collapsedText, '26192\n26196');
  // The seven LOT codes on the same row are NOT paired with anything, so they
  // keep their own independent comma-joined disclosure.
  assert.equal(cellAt(view, 0, 'lotCodes').pairGroup, null);
  assert.equal(cellAt(view, 0, 'lotCodes').collapsedText, 'X2741775, X2741859');
  // The two code sets keep their own labels: a production code is never
  // relabelled as a lot code to fit an existing column.
  assert.equal(cellAt(view, 0, 'lotCodes').values.length, 7);
  assert.deepEqual(cellAt(view, 0, 'productionCodes').values, [
    '26192',
    '26196',
    '26197',
    '26199',
    '26203',
  ]);
});

test('P3C-2 shape D: a case-level set repeats into the named row that owns it', () => {
  // One named row, one recall-level code set: the codes render inside that
  // row's own cell, not beneath the table.
  const view = detailModelFor(corpusProjection('northfork-bison')).sections.affectedProducts!.table
    .expanded;
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].name, 'Bison Burgers & Bison Ground');
  assert.equal(cellAt(view, 0, 'productionDates').text, 'April 30, 2019');
});

// ── P2B7C: the header's official image set ──────────────────────────────────

/**
 * The image-set shapes, proven on recorded official announcements rather
 * than constructed ones: a notice with no photo, one, two, exactly six,
 * seven, and the corpus's largest set at fifty-one.
 *
 * AMENDED BY THE P2B7C CORRECTION: these used to pin a six-image cap and the
 * truncation sentence it disclosed. Both are retired — every official photo
 * is navigable now — so each shape pins the COMPLETE set instead, still in
 * the allocator's order (hero first, then its gallery).
 */
const IMAGE_SET_SHAPES: { fragment: string; images: number }[] = [
  { fragment: 'recall-certain-comforts', images: 0 },
  { fragment: 'fischer-wieser', images: 1 },
  { fragment: 'great-one-trading', images: 2 },
  { fragment: 'town-food-service', images: 6 },
  { fragment: 'gina-marie-bakery', images: 7 },
  { fragment: 'lyons-magnus-expands', images: 51 },
];

test('recorded notices produce every image-set shape: 0, 1, 2, 6, 7 and 51 official photos', () => {
  for (const shape of IMAGE_SET_SHAPES) {
    const model = detailModelFor(corpusProjection(shape.fragment));
    const set = model.productImages;
    if (shape.images === 0) {
      // No photo is honestly no set: the header renders nothing at all.
      assert.equal(set, null, shape.fragment);
      assert.equal(model.heroImageUrl, null, shape.fragment);
      continue;
    }
    assert.ok(set, shape.fragment);
    // Complete: nothing is dropped, so any count a screen shows is reachable.
    assert.equal(set.images.length, shape.images, shape.fragment);
    // The stored hero leads — the same image the Feed card showed — and the
    // rest follow the allocator's gallery order exactly.
    assert.equal(set.images[0].url, model.heroImageUrl, shape.fragment);
    assert.deepEqual(
      set.images.map((image) => image.url),
      [model.heroImageUrl, ...model.images.gallery.map((image) => image.url)],
      shape.fragment,
    );
    // Every image speaks the model's own product name, never a caption.
    for (const image of set.images) {
      assert.equal(image.accessibilityLabel, model.productName, shape.fragment);
    }
  }
});

test('every recorded notice: the header set is complete, unique, official, and photography only', () => {
  let withSets = 0;
  let paged = 0;
  let beyondDots = 0;
  for (const entry of corpus) {
    const projection = projectCase([
      parseFdaAnnouncement({
        listing: entry.listing,
        detailMainHtml: entry.mainHtml,
        path: entry.path,
      }),
    ]);
    const label = slugFromPath(entry.path);
    const model = detailModelFor(projection);
    const set = model.productImages;
    // A notice with no usable official photo produces no set at all — the
    // approved no-image header, never a placeholder.
    if (set === null) {
      assert.equal(model.heroImageUrl, null, `${label}: a hero with no set`);
      assert.equal(model.images.gallery.length, 0, `${label}: a gallery with no set`);
      continue;
    }
    withSets += 1;
    if (set.images.length > 1) paged += 1;
    if (set.images.length > 5) beyondDots += 1;
    assert.ok(set.images.length >= 1, `${label}: an empty set`);
    // The set is the WHOLE allocation for this surface: no cap, so the
    // indicator can never name a page a shopper cannot reach.
    assert.equal(
      set.images.length,
      (model.heroImageUrl === null ? 0 : 1) + model.images.gallery.length,
      `${label}: the set disagrees with the allocation`,
    );
    // No duplicate URL inside the set, and none of them is a row image: the
    // allocation's role exclusivity survives.
    const urls = set.images.map((image) => image.url);
    assert.equal(new Set(urls).size, urls.length, `${label}: a repeated image`);
    const rowUrls = [...model.images.rowImages.values()].map((entry) => entry.image.url);
    for (const [index, url] of urls.entries()) {
      // Role exclusivity, with P2c's ONE sanctioned exception intact: in a
      // multi-version table the HERO may also be the thumbnail of the row it
      // provably depicts (case hero and exact-version thumbnail are two
      // different contexts — docs/recall-imagery.md §13). Every image after
      // the hero is a gallery image, and a gallery image never backs a row.
      if (index > 0) {
        assert.ok(!rowUrls.includes(url), `${label}: a gallery image also backs a row`);
      }
      assert.ok(url.startsWith('https://'), `${label}: a non-https official image`);
    }
    // No screen surface anywhere carries a label gallery: the section type
    // holds the table and nothing else, and there is no standalone section.
    if (model.sections.affectedProducts !== null) {
      assert.deepEqual(
        Object.keys(model.sections.affectedProducts),
        ['table'],
        `${label}: the Affected Products section grew an image gallery`,
      );
    }
    assert.ok(!('officialLabels' in model.sections), `${label}: a standalone label section`);
  }
  // The corpus genuinely exercises the three indicator shapes, so this audit
  // is not vacuously passing on a corpus of single-photo notices.
  assert.ok(withSets >= 100, `only ${withSets} notices produced an image set`);
  assert.ok(paged >= 50, `only ${paged} notices produced a paged set`);
  assert.ok(beyondDots >= 5, `only ${beyondDots} notices exceed the dot threshold`);
});
