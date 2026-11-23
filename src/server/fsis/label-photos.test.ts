/**
 * FSIS label photographs (docs/recall-imagery.md §16): which links are
 * picture sources, what a label document's photographs are, and how each is
 * named — against the agency's own recorded documents.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { FSIS_HOSTS, resolveOfficialUrl } from '../../lib/official-urls';
import {
  captionsForBoxes,
  discoverLabelPhotoSources,
  extractLabelPhotos,
  isPanelText,
  pageImageSources,
  photoKind,
} from './label-photos';

const resolve = (raw: string) =>
  resolveOfficialUrl(raw, { approvedHosts: FSIS_HOSTS })?.url ?? null;
const pdf = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'attachments', name)));

// ── Discovery ───────────────────────────────────────────────────────────────

test('picture links are found by their words, their file name, or the label folder', () => {
  const html = [
    '<a href="/sites/default/files/food_label_pdf/2026-11/Recall_028-2026-product-labels.pdf">view labels</a>',
    '<a href="https://www.fsis.usda.gov/sites/default/files/import/072-2015.pdf">Labels</a>',
    '<a href="/sites/default/files/import/019-2016-label.jpg">Label</a>',
    '<a href="/sites/default/files/media_file/2026/x.pdf">Product label photos</a>',
    '<a href="/sites/default/files/food_label_pdf/2018-11/rc-116-2018-viet.pdf">Băng tiếng việt</a>',
    '<a href="/sites/default/files/import/RC%2B106-2018%2BProducts%2BList%2Band%2BLabels.pdf">The complete list of products and product labels</a>',
    '<img src="/sites/default/files/import/105-2017-label.jpg">',
  ].join(' ');
  assert.deepEqual(
    discoverLabelPhotoSources(html, resolve).map((s) => [s.kind, s.url.split('/').pop()]),
    [
      ['pdf', 'Recall_028-2026-product-labels.pdf'],
      ['pdf', '072-2015.pdf'],
      ['image', '019-2016-label.jpg'],
      ['pdf', 'x.pdf'],
      ['pdf', 'rc-116-2018-viet.pdf'],
      ['pdf', 'RC%2B106-2018%2BProducts%2BList%2Band%2BLabels.pdf'],
      ['image', '105-2017-label.jpg'],
    ],
  );
});

test('lists, other hosts, fragments and unrelated links are never picture sources', () => {
  const html = [
    '<a href="/sites/default/files/media_file/documents/PHA-11142026-Product-List_0.pdf">View the list of products subject to the public health alert</a>',
    '<a href="/sites/default/files/distro_list/2026-08/PHA-08082026-01-product-list_1.pdf">here</a>',
    '<a href="https://www.example.com/labels.pdf">view labels</a>',
    '<a href="#label">view label</a>',
    '<a href="https://www.fsis.usda.gov/recalls">recalls</a>',
    '<a href="https://www.fsis.usda.gov/food-safety/safe-food-handling">here</a>',
  ].join(' ');
  assert.deepEqual(discoverLabelPhotoSources(html, resolve), []);
});

test('a linked label page contributes its own images, never page furniture', () => {
  const html =
    '<header><img src="/themes/fsis/logo.png"></header><main>' +
    '<img src="/sites/default/files/images/product-front.jpg">' +
    '<img src="/sites/default/files/images/usda-seal.png"></main>' +
    '<footer><img src="/sites/default/files/x/footer.jpg"></footer>';
  assert.deepEqual(
    pageImageSources(html, resolve).map((u) => u.split('/').pop()),
    ['product-front.jpg'],
  );
});

// ── Pure rules ──────────────────────────────────────────────────────────────

test('panel copy needs two distinct panel terms; a front label word alone is not a panel', () => {
  assert.equal(isPanelText('Nutrition Facts Serving size 2 oz Calories 110'), true);
  assert.equal(isPanelText('INGREDIENTS: beef, salt. CONTAINS: soy'), true);
  assert.equal(isPanelText('HIGH PROTEIN BEEF JERKY'), false);
});

test('strips and slivers are detail images, not product photographs', () => {
  assert.equal(photoKind(893, 856), 'product');
  assert.equal(photoKind(1400, 429), 'detail'); // the biscuit tub's side band
  assert.equal(photoKind(300, 900), 'detail');
});

test('a caption is the printed text beside a photo, else the page title, never text inside it', () => {
  const boxes = [
    { x: 0.1, y: 0.2, w: 0.3, h: 0.3 },
    { x: 0.6, y: 0.2, w: 0.3, h: 0.3 },
  ];
  const captions = captionsForBoxes(boxes, [
    { text: 'Product Labels: Acme Sausages', cx: 0.5, cy: 0.05 },
    { text: 'Acme Hot', cx: 0.75, cy: 0.55 },
    { text: 'Nutrition Facts', cx: 0.2, cy: 0.3 }, // inside the first photo
  ]);
  assert.deepEqual(captions, ['Product Labels: Acme Sausages', 'Acme Hot']);
});

// ── The agency's own documents ──────────────────────────────────────────────

test('Betterballen: one photograph per page, each named by its own printed caption', async () => {
  const { photos, dropped } = await extractLabelPhotos(pdf('PHA_11062026_01A_Label.pdf'));
  assert.deepEqual(
    photos.map((p) => [p.page, p.kind, p.caption]),
    [
      [1, 'product', 'Bitterballen (Beef)'],
      [2, 'product', 'Saté Kroketten (Chicken)'],
      [3, 'product', 'Bami Rolls (Pork)'],
    ],
  );
  assert.deepEqual(dropped, { panel: 0, tooSmall: 0, duplicate: 0, overCap: 0 });
  // Crops, not pages: the photo is far smaller than a rendered sheet's area.
  for (const photo of photos) assert.ok(photo.width >= 1000 && photo.height >= 600);
});

test('Biscuit & Sausage Gravy: the tub photo leads; the side band is a detail; the other labels follow', async () => {
  const { photos } = await extractLabelPhotos(pdf('PHA-11142026-Product-Labels.pdf'));
  const [first, ...rest] = photos;
  assert.equal(first.page, 1);
  assert.equal(first.kind, 'product');
  assert.match(first.caption ?? '', /BISCUIT & SAUSAGE GRAVY/i);
  assert.ok(rest.some((p) => p.page === 1 && p.kind === 'detail'));
  assert.ok(photos.length >= 2);
});

test('Brett Anthony Wow Bao: three photographs on one page, the box first and largest', async () => {
  const { photos } = await extractLabelPhotos(pdf('Recall_028-2026-product-labels.pdf'));
  assert.equal(photos.length, 3);
  assert.ok(photos.every((p) => /Wow Bao Cheeseburger/i.test(p.caption ?? '')));
  const [box, ...others] = photos;
  for (const other of others) assert.ok(box.width * box.height > other.width * other.height);
});

test('Grace Vienna Sausages: every photo on a page carries that page’s variety', async () => {
  const { photos } = await extractLabelPhotos(pdf('PHA-10062026-01-Labels.pdf'));
  assert.deepEqual(
    photos.map((p) => [p.page, p.caption]),
    [
      [1, 'Product Labels: Grace Chicken Vienna Sausages'],
      [1, 'Product Labels: Grace Chicken Vienna Sausages'],
      [1, 'Product Labels: Grace Chicken Vienna Sausages'],
      [1, 'Product Labels: Grace Chicken Vienna Sausages'],
      [2, 'Grace Chicken Vienna Sausages Hot & Spicy'],
      [2, 'Grace Chicken Vienna Sausages Hot & Spicy'],
      [2, 'Grace Chicken Vienna Sausages Hot & Spicy'],
    ],
  );
});

test('Imperio jerky: nutrition-facts pages are panels, never product photographs', async () => {
  const { photos, dropped } = await extractLabelPhotos(pdf('Recall-027-2026-Labels.pdf'));
  assert.deepEqual(
    photos.map((p) => p.page),
    [1, 3, 5],
  );
  assert.equal(dropped.panel, 3);
  assert.ok(photos.every((p) => p.caption === null || !isPanelText(p.caption)));
});
