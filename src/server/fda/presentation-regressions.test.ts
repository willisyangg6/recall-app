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
  caseIdentity,
  cleanProductName,
  conciseReasonLine,
  whereSoldModel,
} from '../../lib/recall-presentation';
import { buildConsumerCase } from '../../lib/consumer-projection';
import { productDisplayName } from '../../lib/consumer-summary';
import {
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
    table!.columns.map((column) => column.label),
    ['Product', 'Barcode (UPC)', 'Lot codes'],
  );
  assert.equal(table!.rows.length, 1);
  assert.deepEqual(table!.rows[0].cells, [
    'Jalapeno Ranch Dressing',
    '199284564923',
    '69, 86, 108, 113, 116, and 121',
  ]);
  assert.equal(table!.seeAllLabel, null);
  // The codes render inline in the row — nothing sits behind a disclosure.
  assert.equal(model.caseCodes, null);
  assert.equal(table!.rows[0].codes, null);
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
    table!.columns.map((column) => column.label),
    ['Product', 'Package Size', 'Packaging'],
  );
  assert.equal(table!.initialRows, 3);
  assert.equal(table!.seeAllLabel, 'See all (5)');
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
