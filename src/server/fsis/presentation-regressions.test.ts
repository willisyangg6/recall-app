/**
 * P2b exact consumer regressions against recorded OFFICIAL FSIS records
 * (verbatim from the FSIS Recall API — see fixtures/README.md), proven at
 * full pipeline depth: raw record → parse → projectCase → consumer
 * projection → shared presentation contract. Plus corpus-wide scans over the
 * benchmark set pinning the P2b product-identity invariant: nothing that is
 * not a product identity ever renders as Product.
 *
 * The flagship fixture is Shanghai Ravioli 018-2026, whose product items read
 * "Cardboard boxes containing 100 pieces of “BUFFALO CHICKEN RANGOON” and
 * “Sell By” dates from July 8, 2026, to June 29, 2027 …". The container once
 * rendered as the Product name while the source's own quoted identity went
 * unread and the sell-by RANGE flattened into its two endpoint days. Nothing
 * here matches on the record's id or title — the fixture pins shared
 * mechanisms only.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { projectCase } from '../../domain/projection';
import type { CaseProjection } from '../../domain/recall-types';
import { buildConsumerCase } from '../../lib/consumer-projection';
import { extractAttachmentLinks } from '../../lib/consumer-summary';
import {
  affectedProductsModel,
  affectedProductsTable,
  buildDetailModel,
  caseIdentity,
  cleanProductName,
  conciseReasonLine,
} from '../../lib/recall-presentation';
import { interpretReason } from '../../lib/recall-reason';
import { extractForeignMaterialEvidence, FOREIGN_MATERIALS } from '../../domain/hazard';
import { measurementOnlyName, packagingOnlyName } from '../../lib/variant-identity';
import { parseFsisRecord, type FsisRawRecord } from './parse';

const FIXTURES = join(process.cwd(), 'src/server/fsis/fixtures');

function projectFixture(file: string): CaseProjection {
  const raw: FsisRawRecord = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
  return projectCase([parseFsisRecord(raw)]);
}

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

test('recorded 018-2026: a container never renders as Product; quoted identities do', () => {
  const projection = projectFixture('recall-container-items-shanghai-018-2026.json');
  const { model, table } = consumerView(projection);

  // Two affected versions, each under the source's own quoted product name.
  assert.equal(model.items.length, 2);
  assert.deepEqual(
    model.items.map((item) => item.name),
    ['Buffalo Chicken Rangoon', 'Benedetto’s Buffalo Chicken Mozzarella Stick'],
  );
  // "Cardboard boxes" is packaging evidence: it renders only under Packaging,
  // never as Product.
  for (const item of model.items) {
    assert.ok(!packagingOnlyName(item.name ?? ''), String(item.name));
  }

  // Each item's stated piece count is its own Package Size — never merged.
  assert.deepEqual(
    model.items.map((item) => item.fields.find((field) => field.key === 'size')?.value),
    ['100 pieces', '120 pieces'],
  );

  // The table: headers once, one row per version, source order preserved —
  // and NO shared-facts block. Each item's own text states the identical
  // sell-by range and packaging, so that proven-shared evidence repeats
  // inside every row. The sell-by renders as a RANGE, never as two endpoint
  // days joined by "and" (a shopper with a mid-range date must still match).
  assert.ok(table, 'the table model is missing');
  assert.deepEqual(
    table!.expanded.columns.map((column) => column.label),
    ['Product', 'Package Size', 'Sell by', 'Packaging'],
  );
  assert.deepEqual(
    table!.expanded.rows.map((row) => row.cells.map((cell) => cell.text)),
    [
      ['Buffalo Chicken Rangoon', '100 pieces', 'July 8, 2026–June 29, 2027', 'Cardboard boxes'],
      [
        'Benedetto’s Buffalo Chicken Mozzarella Stick',
        '120 pieces',
        'July 8, 2026–June 29, 2027',
        'Cardboard boxes',
      ],
    ],
  );
  for (const row of table!.expanded.rows) {
    assert.ok(!String(row.cells[2].text).includes(' and '), String(row.cells[2].text));
  }

  // The official labels PDF stays preserved as model data for a later
  // surface (the Detail screen renders no orphan attachment link — pinned by
  // the wiring contract).
  const attachments = extractAttachmentLinks(projection.summaryHtml);
  assert.ok(
    attachments.some((attachment) => attachment.label === 'Product labels (PDF)'),
    'the labels PDF attachment was lost from the model',
  );
});

test('FSIS corpus scan: no measurement or packaging value renders as Product', () => {
  const records: FsisRawRecord[] = JSON.parse(
    readFileSync(join(FIXTURES, 'benchmark-records.json'), 'utf8'),
  );
  for (const file of readdirSync(FIXTURES)) {
    if (!file.endsWith('.json') || file === 'benchmark-records.json') continue;
    records.push(JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')));
  }
  let scanned = 0;
  for (const raw of records) {
    let projection: CaseProjection;
    try {
      projection = projectCase([parseFsisRecord(raw)]);
    } catch {
      continue;
    }
    const { model } = consumerView(projection);
    scanned += 1;
    for (const item of model.items) {
      if (item.name === null) continue;
      const label = `${raw.field_recall_number}: ${item.name}`;
      assert.ok(!measurementOnlyName(item.name), `measurement as Product — ${label}`);
      assert.ok(!packagingOnlyName(item.name), `packaging as Product — ${label}`);
    }
  }
  assert.ok(scanned >= 66, `only ${scanned} FSIS records scanned`);
});

// ── P3A: section visibility and Home/Detail reason parity ───────────────────

/** Every recorded FSIS record: the benchmark set plus the single fixtures. */
function everyRecord(): { id: string; projection: CaseProjection }[] {
  const raws: FsisRawRecord[] = JSON.parse(
    readFileSync(join(FIXTURES, 'benchmark-records.json'), 'utf8'),
  );
  for (const file of readdirSync(FIXTURES)) {
    if (!file.endsWith('.json') || file === 'benchmark-records.json') continue;
    const parsed = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
    if (!Array.isArray(parsed)) raws.push(parsed);
  }
  const out: { id: string; projection: CaseProjection }[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const id = raw.field_recall_number;
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      out.push({ id, projection: projectCase([parseFsisRecord(raw)]) });
    } catch {
      continue;
    }
  }
  return out;
}

function recordById(id: string): CaseProjection {
  const found = everyRecord().find((record) => record.id === id);
  assert.ok(found, `recorded FSIS record missing: ${id}`);
  return found!.projection;
}

/** The full Detail model for one recorded projection. */
function detailModelFor(projection: CaseProjection) {
  return buildDetailModel(
    {
      id: 'test',
      projection,
      timeline: [],
      affectedProducts: projection.affectedProducts,
      visuals: [],
    },
    { today: '2026-09-03', affectsYou: false },
  );
}

/** Home's card line for the canonical fields a feed row carries. */
function homeReasonLine(projection: CaseProjection): string | null {
  return conciseReasonLine({
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    title: projection.title,
  });
}

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

test('P3A recorded Steak Burrito PHA: no Affected Products heading above nothing', () => {
  // The motivating defect. This PHA's package evidence could not be
  // structured, so the gated projection yields no rows, no codes and no
  // dates — and the section is now absent entirely: no heading, no spacing,
  // no empty table, no blank container.
  const projection = recordById('PHA-07292026-01');
  const model = detailModelFor(projection);
  assert.equal(model.sections.affectedProducts, null);
  // PROOF the section held nothing consumer-facing.
  assert.equal(model.affectedProducts.items.length, 0);
  assert.equal(model.affectedProducts.caseCodes, null);
  assert.equal(model.affectedProducts.productionCodes, null);
  assert.equal(model.affectedProducts.productionDates, null);
  // The honest coverage statement survives as model evidence — it is simply
  // not content, and never was rendered (P2a founder decision).
  assert.notEqual(model.affectedProducts.note, null);
  // Everything else on the page is unchanged and non-empty.
  assert.notEqual(model.whatHappened.text.trim(), '');
  assert.match(model.whatHappened.text, /public health alert was issued/i);
});

test('P3A recorded 005-2026 and PHA-10092020-01: glass on Detail, never plastic anywhere', () => {
  // Both are glass contaminations whose products are packaged in plastic.
  // Detail names glass from the announcement body; Home has no body and
  // stays honestly generic. Neither surface ever says plastic.
  for (const id of ['005-2026', 'PHA-10092020-01']) {
    const projection = recordById(id);
    const home = homeReasonLine(projection);
    const detail = detailModelFor(projection).whatHappened.text;
    assert.match(detail, /may contain pieces of glass/, id);
    assert.equal(home, 'Potential foreign material contamination.', id);
    for (const surface of [home ?? '', detail]) {
      assert.ok(!/\bplastic\b/i.test(surface), `${id}: packaging became the hazard — ${surface}`);
    }
    // The families agree, and Home names nothing rather than something else.
    const evidence = {
      reasonText: projection.reasonText,
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: projection.pathogenOrAllergen,
      title: projection.title,
    };
    const homeTyped = interpretReason(evidence);
    const detailTyped = interpretReason({ ...evidence, summaryText: projection.summaryText });
    assert.equal(homeTyped.family, detailTyped.family, id);
    assert.equal(agentOf(homeTyped), null, id);
    assert.equal(agentOf(detailTyped), 'glass', id);
  }
});

test('P3A recorded 018-2026: both rows and their repeated shared facts still render', () => {
  const projection = projectFixture('recall-container-items-shanghai-018-2026.json');
  const section = detailModelFor(projection).sections.affectedProducts;
  assert.ok(section, 'the two-row section was hidden');
  const table = section!.table!;
  assert.equal(table.expanded.rows.length, 2);
  assert.deepEqual(
    table.expanded.rows.map((row) => row.name),
    ['Buffalo Chicken Rangoon', 'Benedetto’s Buffalo Chicken Mozzarella Stick'],
  );
  // The proven-shared sell-by range still repeats inside BOTH rows.
  const sellBy = table.expanded.columns.findIndex((column) => column.key === 'sellBy');
  assert.deepEqual(
    table.expanded.rows.map((row) => row.cells[sellBy].text),
    ['July 8, 2026–June 29, 2027', 'July 8, 2026–June 29, 2027'],
  );
});

test('P3A FSIS corpus scan: no empty section, no lost row, no reason disagreement', () => {
  const records = everyRecord();
  let visible = 0;
  let hidden = 0;
  for (const { id, projection } of records) {
    const model = detailModelFor(projection);
    assert.notEqual(model.whatHappened.text.trim(), '', id);
    if (model.sections.whereSold !== null) {
      assert.notEqual(model.sections.whereSold.lead.trim(), '', `empty Where it was sold: ${id}`);
    }
    const section = model.sections.affectedProducts;
    if (section === null) {
      hidden += 1;
      // PROOF: nothing consumer-facing was under the heading.
      assert.equal(model.affectedProducts.items.length, 0, `a real row was hidden: ${id}`);
      assert.equal(model.affectedProducts.caseCodes, null, id);
      assert.equal(model.affectedProducts.productionCodes, null, id);
      assert.equal(model.affectedProducts.productionDates, null, id);
    } else {
      visible += 1;
      const readable =
        section.productionDates !== null ||
        section.productionCodes !== null ||
        section.caseCodes !== null ||
        (section.table !== null &&
          section.table.expanded.columns.length > 0 &&
          section.table.expanded.rows.some(
            (row) =>
              (row.name ?? '').trim() !== '' ||
              row.cells.some((cell) => (cell.text ?? '').trim() !== '' || cell.codes !== null),
          ));
      assert.ok(readable, `visible section with no readable content: ${id}`);
    }

    // Reason parity, same contract as the FDA scan.
    const evidence = {
      reasonText: projection.reasonText,
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: projection.pathogenOrAllergen,
      title: projection.title,
    };
    const home = interpretReason(evidence);
    const detail = interpretReason({ ...evidence, summaryText: projection.summaryText });
    assert.equal(home.family, detail.family, `family disagreement: ${id}`);
    const [a, b] = [agentOf(home), agentOf(detail)];
    assert.ok(a === null || a === b, `${id}: Home "${a}" vs Detail "${b}"`);
    for (const named of [a, b]) {
      if (named === null || home.family !== 'foreign_material') continue;
      assert.ok(FOREIGN_MATERIALS.includes(named), `${id}: "${named}" is outside the vocabulary`);
      assert.equal(
        extractForeignMaterialEvidence(
          `${projection.reasonText ?? ''}\n${projection.title}\n${projection.summaryText}`,
        ).stated,
        true,
        `${id}: "${named}" named where no foreign-material hazard is stated`,
      );
    }
  }
  assert.ok(records.length >= 66, `only ${records.length} FSIS records scanned`);
  assert.ok(visible >= 20, `only ${visible} sections visible`);
  assert.ok(hidden >= 20, `only ${hidden} sections hidden`);
});
