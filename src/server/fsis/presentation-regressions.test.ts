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
  caseIdentity,
  cleanProductName,
} from '../../lib/recall-presentation';
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
    table!.columns.map((column) => column.label),
    ['Product', 'Package Size', 'Sell by', 'Packaging'],
  );
  assert.deepEqual(
    table!.rows.map((row) => row.cells),
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
  for (const row of table!.rows) {
    assert.ok(!String(row.cells[2]).includes(' and '), String(row.cells[2]));
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
