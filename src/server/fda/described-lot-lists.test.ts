/**
 * A product described in prose, followed by a separate scoped list of lots.
 *
 * The regression is FDA's 2026-11-17 Larbi Inc. / Herb To Body Yellow Dock
 * Root C/S notice:
 *
 *   Herb To Body Yellow Dock Root C/S 4oz comes in a 4 oz pouch, with the lot
 *   number printed below the barcode on the back label.
 *   The recalled lots are:
 *   • HB02223  • HB02474  • HB02848
 *
 * The stored notice was complete, yet Recall Details showed no affected
 * product: the bare hand-off ("The recalled lots are:") was not an accepted
 * list lead-in, and the prose reader never crosses the list's line breaks.
 *
 * The rules pinned here:
 *   - the list belongs to the one product the sentence directly above it
 *     describes, with the size and packaging that sentence states;
 *   - a missing size stays missing — nothing is inferred;
 *   - each product keeps its own list when several are described in turn;
 *   - when the prose describes more than one product before a single list,
 *     the codes stay recall-wide and are never assigned to a guessed product;
 *   - no UPC and no date are ever produced from this shape.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { projectCase } from '../../domain/projection';
import type { CaseProjection } from '../../domain/recall-types';
import { stripHtml } from '../../domain/text';
import { buildConsumerCase } from '../../lib/consumer-projection';
import { affectedProductsModel, affectedProductsTable } from '../../lib/recall-presentation';
import { extractDescribedLotLists } from '../../lib/source-lists';
import { parseFdaAnnouncement, type FdaListingItem } from './parse';

interface RecordedAnnouncement {
  officialUrl: string;
  path: string;
  listing: FdaListingItem;
  mainHtml: string;
}

function yellowDock(): CaseProjection {
  const recorded: RecordedAnnouncement = JSON.parse(
    readFileSync('src/server/fda/fixtures/announcement-larbi-yellow-dock-root.json', 'utf8'),
  );
  return projectCase([
    parseFdaAnnouncement({
      listing: recorded.listing,
      detailMainHtml: recorded.mainHtml,
      path: recorded.path,
    }),
  ]);
}

function projection(summaryHtml: string): CaseProjection {
  return {
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    title: 'Acme Herbs Recalls Dried Herbs',
    summaryText: stripHtml(summaryHtml),
    summaryHtml,
    reasonText: null,
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
    recallingFirm: { displayName: 'Acme Herbs', rawVariants: ['Acme Herbs'] },
    brands: [],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    affectedProducts: [],
    quantityText: null,
    illnessStatement: null,
    reportsIllness: false,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fda.gov/x',
    otherOfficialUrls: [],
    sourceIdentifiers: [],
    publishedAt: '2026-11-17',
    lastPublicActivityAt: '2026-11-17',
  };
}

/** What Recall Details shows: each product row as `label → text`. */
function renderedRows(
  source: CaseProjection,
  caseName = 'Dried Herbs',
): { name: string | null; cells: Record<string, string | null> }[] {
  const consumer = buildConsumerCase(source, source.affectedProducts);
  const table = affectedProductsTable(affectedProductsModel(consumer.packageCheck, caseName));
  assert.ok(table, 'the package table renders');
  const labels = new Map(table.expanded.columns.map((column) => [column.key, column.label]));
  return table.expanded.rows.map((row) => ({
    name: row.name,
    cells: Object.fromEntries(
      row.cells
        .filter((cell) => cell.key !== 'product')
        .map((cell) => [labels.get(cell.key) ?? cell.key, cell.text]),
    ),
  }));
}

const list = (...codes: string[]) => `<ul>${codes.map((code) => `<li>${code}</li>`).join('')}</ul>`;

test('Yellow Dock (recorded): one product row owning all three lots, 4 oz, pouch', () => {
  const rows = renderedRows(yellowDock(), 'Yellow Dock Root C/S');
  assert.deepEqual(rows, [
    {
      name: 'Herb To Body Yellow Dock Root C/S',
      cells: {
        'Package Size': '4 oz',
        'Lot codes': 'HB02223, HB02474, HB02848',
        Packaging: 'Pouch',
      },
    },
  ]);
});

test('Yellow Dock (recorded): no UPC and no date is produced', () => {
  const consumer = buildConsumerCase(yellowDock(), []);
  const concepts = [
    ...consumer.packageCheck.variants.flatMap((variant) => variant.fields),
    ...consumer.packageCheck.fields,
    ...consumer.packageCheck.sharedFields,
  ].map((field) => field.label);
  assert.ok(!concepts.some((label) => /UPC|barcode|best|use by|sell by|expir|date/i.test(label)));
  assert.equal(consumer.packageCheck.coverage === 'parser_missed', false);
});

test('a described product with no stated size keeps its lots and invents no size', () => {
  const html =
    '<p>Acme is recalling Acme Dried Nettle Leaf.</p>' +
    '<p>Acme Dried Nettle Leaf comes in a resealable pouch, with the lot number on the back.</p>' +
    '<p>The recalled lots are:</p>' +
    list('AN1001', 'AN1002');
  assert.deepEqual(renderedRows(projection(html)), [
    {
      name: 'Acme Dried Nettle Leaf',
      cells: { 'Lot codes': 'AN1001, AN1002', Packaging: 'Resealable pouch' },
    },
  ]);
});

test('several described products each keep their own separate lot list', () => {
  const html =
    '<p>Acme Dried Nettle Leaf comes in a 2 oz pouch.</p>' +
    '<p>The recalled lots are:</p>' +
    list('AN1001', 'AN1002') +
    '<p>Acme Burdock Root comes in an 8 oz jar.</p>' +
    '<p>The recalled lots are:</p>' +
    list('AB2001');
  assert.deepEqual(renderedRows(projection(html)), [
    {
      name: 'Acme Dried Nettle Leaf',
      cells: { 'Package Size': '2 oz', 'Lot codes': 'AN1001, AN1002', Packaging: 'Pouch' },
    },
    {
      name: 'Acme Burdock Root',
      cells: { 'Package Size': '8 oz', 'Lot codes': 'AB2001', Packaging: 'Jar' },
    },
  ]);
});

test('one lot list under two described products stays recall-wide', () => {
  const html =
    '<p>Acme Dried Nettle Leaf comes in a 2 oz pouch.</p>' +
    '<p>Acme Burdock Root comes in an 8 oz jar.</p>' +
    '<p>The recalled lots are:</p>' +
    list('AX1001', 'AX1002');
  const { owned, recallWide } = extractDescribedLotLists(html);
  assert.deepEqual(owned, []);
  assert.deepEqual(
    recallWide.map((fact) => [fact.concept, fact.value, fact.scope]),
    [
      ['lot', 'AX1001', undefined],
      ['lot', 'AX1002', undefined],
    ],
  );
  const consumer = buildConsumerCase(projection(html), []);
  for (const variant of consumer.packageCheck.variants) {
    assert.ok(
      !variant.fields.some((field) => /AX100/.test(field.value)),
      `${variant.name} must not own the recall-wide lots`,
    );
  }
});

test('a plural description ("… come in …") owns nothing; its lots stay recall-wide', () => {
  const html =
    '<p>Acme Dried Nettle Leaf and Acme Burdock Root come in 2 oz pouches.</p>' +
    '<p>The recalled lots are:</p>' +
    list('AX1001', 'AX1002');
  const { owned, recallWide } = extractDescribedLotLists(html);
  assert.deepEqual(owned, []);
  assert.deepEqual(
    recallWide.map((fact) => fact.value),
    ['AX1001', 'AX1002'],
  );
});

test('a description that is not directly above the hand-off owns nothing', () => {
  const html =
    '<p>Acme Dried Nettle Leaf comes in a 2 oz pouch.</p>' +
    '<p>The product was sold nationwide through retail stores.</p>' +
    '<p>The recalled lots are:</p>' +
    list('AX1001', 'AX1002');
  assert.deepEqual(extractDescribedLotLists(html).owned, []);
});

test('a scoped list whose items are not bare codes is left to the other readers', () => {
  const html =
    '<p>Acme Dried Nettle Leaf comes in a 2 oz pouch.</p>' +
    '<p>The recalled lots are:</p>' +
    list('Lot AN1001 sold in Ohio stores', 'Lot AN1002 sold in Iowa stores');
  assert.deepEqual(extractDescribedLotLists(html), {
    owned: [],
    recallWide: [],
    consumedItems: [],
  });
});
