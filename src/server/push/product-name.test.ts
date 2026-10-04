/**
 * The notification-only short product name (push/product-name.ts,
 * 2026-10-03), driven through the real formatter from RECORDED official
 * notices where one exists (src/server/fda/fixtures, src/server/fsis/fixtures)
 * and synthetic inputs only for edge shapes no record carries. Every case
 * states its before (the old 60-character truncation of the raw display name)
 * so the change reads in review.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { projectCase } from '../../domain/projection';
import type { AffectedProduct, CaseProjection } from '../../domain/recall-types';
import { EDUCATION_EXAMPLE_BODY, EDUCATION_EXAMPLE_TITLE } from '../../lib/onboarding-copy';
import { parseFdaAnnouncement, type FdaListingItem } from '../fda/parse';
import { parseFsisRecord, type FsisRawRecord } from '../fsis/parse';
import { buildPushMessage, formatPushContent } from './format';
import {
  ellipsize,
  MULTIPLE_PRODUCTS_AND_BRANDS,
  notificationProductName,
  PRODUCT_SOFT_LIMIT,
} from './product-name';
import type { FormattableEvent } from './format';

const FDA = join(__dirname, '..', 'fda', 'fixtures');
const FSIS = join(__dirname, '..', 'fsis', 'fixtures');

interface Entry {
  path: string;
  listing: FdaListingItem;
  mainHtml: string;
}
const CORPUS: Entry[] = JSON.parse(
  gunzipSync(readFileSync(join(FDA, 'qa-corpus.json.gz'))).toString('utf8'),
);

/** A recorded FDA notice by the slug its official URL ends in. */
function fda(slug: string): CaseProjection {
  const entry =
    CORPUS.find((candidate) => candidate.path.endsWith(slug)) ??
    (JSON.parse(readFileSync(join(FDA, slug), 'utf8')) as Entry);
  return projectCase([
    parseFdaAnnouncement({
      listing: entry.listing,
      detailMainHtml: entry.mainHtml,
      path: entry.path,
    }),
  ]);
}

function fsis(recallNumber: string): CaseProjection {
  const records = JSON.parse(
    readFileSync(join(FSIS, 'benchmark-records.json'), 'utf8'),
  ) as FsisRawRecord[];
  const record = records.find((r) => String(r.field_recall_number_export) === recallNumber);
  assert.ok(record, `recorded FSIS record missing: ${recallNumber}`);
  return projectCase([parseFsisRecord(record)]);
}

function event(
  projection: CaseProjection,
  kind: FormattableEvent['kind'] = 'initial',
  triggerRuleId = 'new_case',
): FormattableEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    recallCaseId: '22222222-2222-4222-8222-222222222222',
    kind,
    triggerRuleId,
    payloadSummary: '',
    createdAt: '2026-10-03T00:00:00.000Z',
    projection,
  };
}

const graphemes = (text: string) =>
  [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;

// ── Recorded notices ────────────────────────────────────────────────────────

test('the onboarding example is this formatter’s output for the real Regal recall', () => {
  // FDA, Regal Health Food International (Regal Gourmet Snacks), 2023-06-08:
  // Milk Chocolate Raisins, undeclared peanuts.
  const projection = fda(
    'regal-health-food-international-issues-allergy-alert-undeclared-peanut-milk-chocolate-covered',
  );
  assert.equal(projection.productDescription, 'Milk Chocolate Raisins');
  assert.equal(projection.pathogenOrAllergen, 'undeclared peanuts');
  const content = formatPushContent(event(projection));
  assert.equal(content.title, 'Recall alert: Milk Chocolate Raisins');
  assert.equal(content.body, 'Undeclared peanut allergen. Check your package.');
  // The screen shows exactly what a real notification would say.
  assert.equal(content.title, EDUCATION_EXAMPLE_TITLE);
  assert.equal(content.body, EDUCATION_EXAMPLE_BODY);
});

test('a 46-character name with its flavour stays whole', () => {
  // FDA, Khong Guan Corporation, 2026-07-16: undeclared peanuts.
  const projection = fda(
    'khong-guan-corporation-issues-recall-glutinous-rice-balls-black-sesame-filling-due-undeclared',
  );
  assert.equal(
    formatPushContent(event(projection)).title,
    'Recall alert: Glutinous Rice Balls with Black Sesame Filling',
  );
});

test('recorded size fragments leave the title; the product stays whole', () => {
  const cases: [string, string, string][] = [
    // [slug, before, after]
    [
      'dianas-bananas-issues-allergy-alert-undelcared-peanuts-milk-chocolate-banana-babies',
      'Milk Chocolate Banana Babies, 10.5 oz',
      'Milk Chocolate Banana Babies',
    ],
    [
      'announcement-crystal-temptations-chocolatey-eyeballs.json',
      'Chocolatey Eyeballs, 7 oz., 10 oz., 10.5 oz., 11 oz., and…',
      'Chocolatey Eyeballs',
    ],
    [
      'announcement-lmsi-kofinas-garlic-olive-oil.json',
      'Garlic Mediterranean Infused Extra Virgin Olive Oil 500…',
      'Garlic Mediterranean Infused Extra Virgin Olive Oil',
    ],
  ];
  for (const [slug, before, after] of cases) {
    const { title, body } = formatPushContent(event(fda(slug)));
    assert.equal(title, `Recall alert: ${after}`, `${slug} (was “${before}”)`);
    assert.match(body, /Check your package\.$/);
  }
});

test('meaningful flavour, formulation and quantity words are never stripped', () => {
  // Peanut Butter is the flavour of a SESAME recall; it stays.
  assert.equal(
    notificationProductName(
      fda(
        'betty-lous-inc-issues-allergy-alert-undeclared-sesame-stabilyze-dark-chocolate-peanut-butter',
      ),
    ),
    'Dark Chocolate Peanut Butter Nutrition Bar',
  );
  // A leading quantity is identity, not package size; the en dash and the
  // flavour stay.
  assert.equal(
    notificationProductName(
      fda(
        'orgain-issues-voluntary-allergy-alert-possible-undeclared-peanut-residue-single-batch-30g-protein',
      ),
    ),
    '30 g Plant Protein Complete Protein Powder – Chocolate',
  );
  // Registered marks stay.
  assert.equal(
    notificationProductName(
      fda(
        'recall-reminder-gerber-products-company-previously-recalled-and-discontinued-all-batches-gerberr',
      ),
    ),
    'Gerber® Soothe N Chew® Teething Sticks',
  );
  assert.equal(
    notificationProductName(
      synthetic({ productDescription: 'Gluten-Free Sugar-Free Black Sesame Cookies, 8 oz' }),
    ),
    'Gluten-Free Sugar-Free Black Sesame Cookies',
  );
});

test('a long multi-product notice: one shared brand on record and in the name', () => {
  // Before: "VidaSlim Brand 90-Day, 30-Day and 7-Day Original Root,…"
  const projection = fda(
    'motivate-me-ashley-llc-recalling-vidaslim-brand-90-day-30-day-and-7-day-original-root-root-plus-and',
  );
  assert.equal(formatPushContent(event(projection)).title, 'Recall alert: VidaSlim products');
});

test('a long name with no group label cuts at a whole word, never on a joiner', () => {
  // Before: "Steam Buns with Egg Custard Added & Steam Buns with Egg…"
  const name = notificationProductName(
    fda(
      'prime-food-processing-llc-issues-allergy-alert-undeclared-sesame-steam-buns-egg-custard-added-and',
    ),
  );
  assert.equal(name, 'Steam Buns with Egg Custard Added & Steam Buns…');
  // FSIS public health alert: the prefix is `Safety alert:`; ñ survives.
  const pha = formatPushContent(event(fsis('PHA-08082026-01')));
  assert.equal(pha.title, 'Safety alert: Various Meat and Poultry Products Containing Recalled…');
});

// ── Rules on shapes no record carries ───────────────────────────────────────

function synthetic(overrides: Partial<CaseProjection>): CaseProjection {
  return {
    ...fda(
      'khong-guan-corporation-issues-recall-glutinous-rice-balls-black-sesame-filling-due-undeclared',
    ),
    title: 'Acme Foods Recalls Trail Mix Due to Undeclared Peanut',
    productDescription: null,
    brands: [],
    recallingFirm: { displayName: 'Acme Foods', rawVariants: [] },
    affectedProducts: [],
    ...overrides,
  };
}

const lines = (...names: string[]): AffectedProduct[] =>
  names.map((name, i) => ({
    sourceNativeId: String(i),
    name,
    rawText: name,
    extractionConfidence: 'stated',
  }));

test('code and date metadata, and exact repeats, are removed', () => {
  const name = (productDescription: string) =>
    notificationProductName(synthetic({ productDescription }));
  assert.equal(name('Spice Mix, Lot 2231, Best By 09/2027'), 'Spice Mix');
  assert.equal(name('Iced Tea Lemon | UPC: 726191018425'), 'Iced Tea Lemon');
  assert.equal(
    name('Peanut Butter Crackers, Peanut Butter Crackers and Cheese Crackers'),
    'Peanut Butter Crackers and Cheese Crackers',
  );
  // `and`/`&` inside a name is never re-joined differently.
  assert.equal(name('Black & White Sesame Balls'), 'Black & White Sesame Balls');
});

test('group labels only with evidence; mixed brands use the existing generic label', () => {
  const list = 'Southwest Chopped Salad Kit, Bacon Ranch Crunch Kit and Fresh Garden Salad Mix';
  const products = lines(
    'Southwest Chopped Salad Kit',
    'Bacon Ranch Crunch Kit',
    'Fresh Garden Salad Mix',
  );
  assert.equal(
    notificationProductName(
      synthetic({ productDescription: list, brands: ['Acme', 'Bolt'], affectedProducts: products }),
    ),
    MULTIPLE_PRODUCTS_AND_BRANDS,
  );
  // One brand, carried by every product line: the brand summary.
  assert.equal(
    notificationProductName(
      synthetic({
        productDescription: list,
        brands: ['Acme'],
        affectedProducts: lines('Acme Southwest Kit', 'Acme Bacon Ranch Kit', 'Acme Garden Mix'),
      }),
    ),
    'Acme products',
  );
  // One brand on record that the product lines contradict: never claimed.
  assert.equal(
    notificationProductName(
      synthetic({
        productDescription: 'Marcum Ground Cinnamon & Supreme Tradition Ground Cinnamon Spice Jars',
        brands: ['Colonna'],
        affectedProducts: lines('Marcum Ground Cinnamon', 'Supreme Tradition Ground Cinnamon'),
      }),
    ),
    'Marcum Ground Cinnamon & Supreme Tradition Ground…',
  );
  // `American Regent, Inc.` is one brand, not "multiple brands".
  assert.notEqual(
    notificationProductName(
      synthetic({
        productDescription: list,
        brands: ['American Regent, Inc.'],
        affectedProducts: products,
      }),
    ),
    MULTIPLE_PRODUCTS_AND_BRANDS,
  );
});

test('empty and size-only names keep the app’s existing fallback', () => {
  // No usable description: the parsed headline names the product.
  assert.equal(notificationProductName(synthetic({ productDescription: '   ' })), 'Trail Mix');
  // A removal never empties a name.
  assert.equal(notificationProductName(synthetic({ productDescription: '16 oz' })), '16 oz');
});

test('Unicode: never past the limit, never inside a grapheme', () => {
  const cases = [
    'Jalapeños Rellenos con Queso Añejo y Crema Ácida de Rancho Tradicional Familiar',
    `Supercalifragilisticexpialidocious${'x'.repeat(30)}`,
    'Café'.repeat(16),
    '🍫'.repeat(70),
  ];
  for (const description of cases) {
    const name = notificationProductName(synthetic({ productDescription: description }));
    assert.ok(graphemes(name) <= PRODUCT_SOFT_LIMIT, name);
    assert.ok(name.endsWith('…'), name);
    // Every grapheme of the result is a grapheme of the source.
    const source = new Set(
      [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(description)].map((part) =>
        part.segment.toLowerCase(),
      ),
    );
    for (const part of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(
      name.slice(0, -1),
    )) {
      assert.ok(source.has(part.segment.toLowerCase()) || part.segment === ' ', name);
    }
  }
  assert.equal(ellipsize('Short Name'), 'Short Name');
});

// ── What the shortening never touches ───────────────────────────────────────

test('body, case id, notification id and the tap destination are unchanged; nothing is fetched', () => {
  const projection = fda(
    'dianas-bananas-issues-allergy-alert-undelcared-peanuts-milk-chocolate-banana-babies',
  );
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('the formatter must not reach the network');
  };
  try {
    for (const [kind, rule] of [
      ['initial', 'new_case'],
      ['material_update', 'classification_assigned'],
      ['material_update', 'expansion_products'],
      ['material_update', 'retraction'],
    ] as const) {
      const delivery = event(projection, kind, rule);
      const message = buildPushMessage(delivery, 'ExponentPushToken[test]');
      assert.match(message.title, /: Milk Chocolate Banana Babies$/, rule);
      // The tap opens the same recall: the payload carries the case and
      // event ids and nothing else.
      assert.deepEqual(message.data, {
        kind: 'recall',
        recallCaseId: delivery.recallCaseId,
        notificationEventId: delivery.id,
      });
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  // The hazard sentence is the card's, whole, whatever the title's length.
  assert.equal(
    formatPushContent(event(projection)).body,
    'Undeclared peanut allergen. Check your package.',
  );
  // The full name stays on the recall itself.
  assert.equal(projection.productDescription, 'Milk Chocolate Banana Babies, 10.5 oz');
});
