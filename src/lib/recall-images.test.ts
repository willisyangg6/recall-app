/**
 * The image-role allocation contract (P2c): one hero, evidence-matched row
 * images, a deduplicated gallery — and the same underlying asset never
 * holding two visible roles. Pure unit coverage; the recorded-announcement
 * pipeline regressions live in src/server/fda/presentation-regressions.test.ts.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProductPhoto } from './product-photos';
import { allocateRecallImages, type RowImageCandidate } from './recall-images';

function photo(overrides: Partial<ProductPhoto> & { url: string }): ProductPhoto {
  return {
    alt: null,
    order: 0,
    role: 'package_full',
    width: 300,
    height: 300,
    aspectRatio: 1,
    ...overrides,
  };
}

function row(overrides: Partial<RowImageCandidate> & { rowId: string }): RowImageCandidate {
  return { name: null, size: null, upc: null, sourcePhotoUrl: null, ...overrides };
}

const URL_A = 'https://www.fda.gov/files/a.png';
const URL_B = 'https://www.fda.gov/files/b.png';
const URL_C = 'https://www.fda.gov/files/c.png';

test('the previously observed duplication shape renders once: hero never re-enters any lower role', () => {
  // Sun Hong / Great One shape: the stored hero IS the first recognizable
  // photo, which is also what primaryPhoto and the checker used to surface.
  // Under the allocation the asset holds exactly one visible role.
  const photos = [
    photo({ url: URL_A, alt: 'Picture of enoki mushroom case', order: 0 }),
    photo({
      url: URL_B,
      alt: 'Picture of back label, enoki mushrooms',
      role: 'package_back',
      order: 1,
    }),
  ];
  const allocation = allocateRecallImages({
    heroImageUrl: URL_A,
    photos,
    labelVisuals: [],
    rows: [],
  });
  assert.equal(allocation.hero?.url, URL_A);
  assert.deepEqual(
    allocation.gallery.map((image) => image.url),
    [URL_B],
  );
  assert.equal(allocation.supporting.length, 0);
  const everywhere = [
    allocation.hero?.url,
    ...allocation.gallery.map((image) => image.url),
    ...allocation.supporting.map((image) => image.url),
    ...[...allocation.rowImages.values()].map((assignment) => assignment.image.url),
  ].filter(Boolean);
  assert.equal(new Set(everywhere).size, everywhere.length);
});

test('absent imagery is honestly absent: null hero, empty gallery, no row images', () => {
  const allocation = allocateRecallImages({
    heroImageUrl: null,
    photos: [],
    labelVisuals: [],
    rows: [row({ rowId: 'r0', name: 'Some Product' })],
  });
  assert.equal(allocation.hero, null);
  assert.deepEqual(allocation.gallery, []);
  assert.equal(allocation.rowImages.size, 0);
});

test('a stored hero outside the extracted set still renders, with null classification', () => {
  const allocation = allocateRecallImages({
    heroImageUrl: 'https://www.fda.gov/files/other-record.png',
    photos: [],
    labelVisuals: [],
    rows: [],
  });
  assert.equal(allocation.hero?.url, 'https://www.fda.gov/files/other-record.png');
  assert.equal(allocation.hero?.classification, null);
  assert.equal(allocation.hero?.caption, null);
});

test('hero-to-row reuse: only in a multi-version table, only for the one proven row', () => {
  const only = photo({
    url: URL_A,
    alt: 'Jaimes Spanish Village Jalapeno Ranch Front Panel Label',
    role: 'package_label',
  });
  // Single-row table: the hero is never repeated immediately below itself,
  // even when source evidence points at that row.
  const singleRow = allocateRecallImages({
    heroImageUrl: URL_A,
    photos: [only],
    labelVisuals: [],
    rows: [row({ rowId: 'case', name: 'Jalapeno Ranch Dressing', sourcePhotoUrl: URL_A })],
  });
  assert.equal(singleRow.hero?.url, URL_A);
  assert.equal(singleRow.rowImages.size, 0);
  assert.deepEqual(singleRow.gallery, []);

  // Multi-version table: the hero may ALSO back exactly the row its evidence
  // proves — and only that one; it still never enters the gallery.
  const multiRow = allocateRecallImages({
    heroImageUrl: URL_A,
    photos: [only, photo({ url: URL_B, alt: 'Flavor B pack' })],
    labelVisuals: [],
    rows: [
      row({ rowId: 'r0', name: 'Jalapeno Ranch Dressing', sourcePhotoUrl: URL_A }),
      row({ rowId: 'r1', name: 'Another Version', sourcePhotoUrl: URL_A }),
    ],
  });
  assert.equal(multiRow.rowImages.get('r0')?.image.url, URL_A);
  assert.equal(multiRow.rowImages.get('r0')?.evidence, 'source_row');
  assert.equal(multiRow.rowImages.get('r1'), undefined);
  assert.ok(!multiRow.gallery.some((image) => image.url === URL_A));

  // Without evidence tying the hero to a row, no row borrows it — the hero
  // is never assigned merely to fill the first row.
  const noEvidence = allocateRecallImages({
    heroImageUrl: URL_A,
    photos: [photo({ url: URL_A })],
    labelVisuals: [],
    rows: [row({ rowId: 'r0', name: 'Version One' }), row({ rowId: 'r1', name: 'Version Two' })],
  });
  assert.equal(noEvidence.rowImages.size, 0);
});

test('source-established association assigns, and one image can back at most one row', () => {
  const photos = [
    photo({ url: URL_A, alt: 'Flavor A pack' }),
    photo({ url: URL_B, alt: 'Flavor B pack' }),
  ];
  const allocation = allocateRecallImages({
    heroImageUrl: null,
    photos,
    labelVisuals: [],
    rows: [
      row({ rowId: 'r0', name: 'Flavor A', sourcePhotoUrl: URL_A }),
      row({ rowId: 'r1', name: 'Duplicate Claim', sourcePhotoUrl: URL_A }),
    ],
  });
  const first = allocation.rowImages.get('r0');
  assert.equal(first?.image.url, URL_A);
  assert.equal(first?.evidence, 'source_row');
  assert.equal(first?.accessibilityText, 'Flavor A');
  assert.equal(allocation.rowImages.get('r1'), undefined);
});

test('a caption stating a different barcode or size vetoes even a source-established match', () => {
  const contradictedUpc = allocateRecallImages({
    heroImageUrl: null,
    photos: [
      photo({ url: URL_A, alt: 'Organic Vegetable Medley 12oz UPC 803944306999' }),
      photo({ url: URL_B }),
    ],
    labelVisuals: [],
    rows: [
      row({
        rowId: 'r0',
        name: 'Organic Vegetable Medley',
        size: '12 oz UPC 711535517733',
        sourcePhotoUrl: URL_A,
      }),
      row({ rowId: 'r1', name: 'Another Row' }),
    ],
  });
  assert.equal(contradictedUpc.rowImages.size, 0);

  const contradictedSize = allocateRecallImages({
    heroImageUrl: null,
    photos: [
      photo({ url: URL_A, alt: 'Wish-Bone Thousand Island Dressing, Net Wt 24 oz.' }),
      photo({ url: URL_B }),
    ],
    labelVisuals: [],
    rows: [
      row({ rowId: 'r0', name: 'Thousand Island Dressing', size: '15 oz', sourcePhotoUrl: URL_A }),
      row({ rowId: 'r1', name: 'Another Row' }),
    ],
  });
  assert.equal(contradictedSize.rowImages.size, 0);

  // Silence never contradicts: a caption without identifiers vetoes nothing.
  const silent = allocateRecallImages({
    heroImageUrl: null,
    photos: [photo({ url: URL_A, alt: 'Thousand Island Dressing bottle' }), photo({ url: URL_B })],
    labelVisuals: [],
    rows: [
      row({
        rowId: 'r0',
        name: 'Thousand Island Dressing',
        size: '15 oz',
        upc: '041321006456',
        sourcePhotoUrl: URL_A,
      }),
      row({ rowId: 'r1', name: 'Another Row' }),
    ],
  });
  assert.equal(silent.rowImages.get('r0')?.image.url, URL_A);
});

test('caption name+size matches sibling versions that share a name (the Crystal shape)', () => {
  const photos = [
    photo({
      url: URL_A,
      alt: 'Little Temptations Chocolatey Eyeballs, Front Label, 7 oz.',
      role: 'package_label',
    }),
    photo({
      url: URL_B,
      alt: 'Little Temptations Chocolatey Eyeballs, Plastic Pouch Label, 16 oz.',
      role: 'package_label',
    }),
  ];
  const allocation = allocateRecallImages({
    heroImageUrl: null,
    photos,
    labelVisuals: [],
    rows: [
      row({ rowId: 'r0', name: 'Chocolatey Eyeballs', size: '7 oz.' }),
      row({ rowId: 'r1', name: 'Chocolatey Eyeballs', size: '16 oz.' }),
    ],
  });
  const seven = allocation.rowImages.get('r0');
  assert.equal(seven?.image.url, URL_A);
  assert.equal(seven?.evidence, 'caption_name_size');
  assert.equal(seven?.accessibilityText, 'Chocolatey Eyeballs, 7 oz.');
  assert.equal(allocation.rowImages.get('r1')?.image.url, URL_B);
  // The matched images hold their one role — the gallery does not repeat them.
  assert.deepEqual(allocation.gallery, []);
});

test('"10 oz" can never claim a "10.5 oz" caption, and identical siblings stay unmatched', () => {
  const tenPointFive = allocateRecallImages({
    heroImageUrl: null,
    photos: [photo({ url: URL_A, alt: 'Chocolatey Eyeballs, Label, 10.5 oz.' })],
    labelVisuals: [],
    rows: [
      row({ rowId: 'r0', name: 'Chocolatey Eyeballs', size: '10 oz.' }),
      row({ rowId: 'r1', name: 'Chocolatey Eyeballs', size: '11 oz.' }),
    ],
  });
  assert.equal(tenPointFive.rowImages.size, 0);

  // Two rows with the same name AND size: the pairing is ambiguous in both
  // directions, so nothing is guessed (the Conagra two-15-oz shape).
  const ambiguous = allocateRecallImages({
    heroImageUrl: null,
    photos: [photo({ url: URL_A, alt: 'Dressing, Net Wt 15 oz.' })],
    labelVisuals: [],
    rows: [
      row({ rowId: 'r0', name: 'Dressing Original', size: '15 oz' }),
      row({ rowId: 'r1', name: 'Dressing Original', size: '15 oz' }),
    ],
  });
  assert.equal(ambiguous.rowImages.size, 0);
});

test('caption identity matching: unique containment, most specific version first', () => {
  // The Great One shape: brand-prefixed captions, and one version name that
  // is a substring of another. The specific version claims its caption first,
  // so the shorter name can only take the caption that names exactly it.
  const photos = [
    photo({ url: URL_A, alt: 'Label: QQ FISH Tofu Style Fried Fish Cake', role: 'package_label' }),
    photo({ url: URL_B, alt: 'Label: QQ FISH Fried Fish Cake', role: 'package_label' }),
    photo({
      url: URL_C,
      alt: 'Label: QQ FISH Shrimp Flavoured Seafood Ball',
      role: 'package_label',
    }),
  ];
  const allocation = allocateRecallImages({
    heroImageUrl: null,
    photos,
    labelVisuals: [],
    rows: [
      row({ rowId: 'r0', name: 'Fried Fish Cake' }),
      row({ rowId: 'r1', name: 'Tofu Style Fried Fish Cake' }),
      row({ rowId: 'r2', name: 'Crab Flavoured Seafood Ball' }),
    ],
  });
  assert.equal(allocation.rowImages.get('r1')?.image.url, URL_A);
  assert.equal(allocation.rowImages.get('r0')?.image.url, URL_B);
  assert.equal(allocation.rowImages.get('r0')?.evidence, 'caption_name');
  // No caption names the crab version — it honestly shows nothing, and the
  // unclaimed shrimp image stays a gallery candidate.
  assert.equal(allocation.rowImages.get('r2'), undefined);
  assert.deepEqual(
    allocation.gallery.map((image) => image.url),
    [URL_C],
  );
});

test('rows sharing a name are excluded from name-only matching, and ties are ambiguity', () => {
  const shared = allocateRecallImages({
    heroImageUrl: null,
    photos: [photo({ url: URL_A, alt: 'Chocolatey Eyeballs, Front Label' })],
    labelVisuals: [],
    rows: [
      row({ rowId: 'r0', name: 'Chocolatey Eyeballs' }),
      row({ rowId: 'r1', name: 'Chocolatey Eyeballs' }),
    ],
  });
  assert.equal(shared.rowImages.size, 0);

  // Two captions containing the name, equally specific: nothing is assigned.
  const tie = allocateRecallImages({
    heroImageUrl: null,
    photos: [
      photo({ url: URL_A, alt: 'Peach Salsa jar photo A' }),
      photo({ url: URL_B, alt: 'Peach Salsa jar photo B' }),
    ],
    labelVisuals: [],
    rows: [row({ rowId: 'r0', name: 'Peach Salsa' }), row({ rowId: 'r1', name: 'Other Item' })],
  });
  assert.equal(tie.rowImages.size, 0);
});

test('caption matching never runs for a single-row model', () => {
  const allocation = allocateRecallImages({
    heroImageUrl: null,
    photos: [photo({ url: URL_A, alt: 'Peach Salsa back label' })],
    labelVisuals: [],
    rows: [row({ rowId: 'case', name: 'Peach Salsa' })],
  });
  assert.equal(allocation.rowImages.size, 0);
  assert.deepEqual(
    allocation.gallery.map((image) => image.url),
    [URL_A],
  );
});

test('identifier close-ups are never row images or gallery entries — they stay supporting', () => {
  const photos = [
    photo({ url: URL_A, alt: 'Outshine Fruit Bars Grape, 6 Bars, UPC 041548244044' }),
    photo({
      url: URL_B,
      alt: 'UPC Bottom of package: 041548244044',
      role: 'barcode_closeup',
      width: 179,
      height: 77,
    }),
  ];
  const allocation = allocateRecallImages({
    heroImageUrl: null,
    photos,
    labelVisuals: [],
    rows: [
      row({ rowId: 'r0', name: 'Outshine Fruit Bars Grape', sourcePhotoUrl: URL_B }),
      row({ rowId: 'r1', name: 'Another Flavor' }),
    ],
  });
  // The close-up cannot be assigned even when proposed as source evidence.
  assert.equal(allocation.rowImages.get('r0')?.image.url, URL_A);
  assert.equal(allocation.rowImages.get('r0')?.evidence, 'caption_name');
  assert.deepEqual(
    allocation.supporting.map((image) => image.url),
    [URL_B],
  );
  assert.deepEqual(allocation.gallery, []);
});

test('label renders join the gallery after announcement photos, without official captions', () => {
  const labelRender = photo({
    url: 'https://cdn.example/label-1.webp',
    alt: 'Official product label',
    role: 'package_label',
  });
  const allocation = allocateRecallImages({
    heroImageUrl: URL_A,
    photos: [photo({ url: URL_A }), photo({ url: URL_B, alt: 'Second photo' })],
    labelVisuals: [labelRender],
    rows: [],
  });
  assert.deepEqual(
    allocation.gallery.map((image) => [image.url, image.source, image.caption]),
    [
      [URL_B, 'fda_announcement', 'Second photo'],
      ['https://cdn.example/label-1.webp', 'fsis_label_render', null],
    ],
  );
});

test('the allocation is deterministic: identical inputs allocate identically', () => {
  const build = () =>
    allocateRecallImages({
      heroImageUrl: URL_A,
      photos: [
        photo({ url: URL_A, alt: 'Hero pack' }),
        photo({ url: URL_B, alt: 'Flavor B pack, 6 oz' }),
        photo({
          url: URL_C,
          alt: 'UPC Bottom of package: 041548244044',
          role: 'barcode_closeup',
          width: 179,
          height: 77,
        }),
      ],
      labelVisuals: [],
      rows: [
        row({ rowId: 'r0', name: 'Flavor A', size: '6 oz' }),
        row({ rowId: 'r1', name: 'Flavor B', size: '6 oz' }),
      ],
    });
  const first = build();
  const second = build();
  assert.deepEqual(
    [...first.rowImages.entries()].map(([id, a]) => [id, a.image.url, a.evidence]),
    [...second.rowImages.entries()].map(([id, a]) => [id, a.image.url, a.evidence]),
  );
  assert.deepEqual(
    first.gallery.map((image) => image.url),
    second.gallery.map((image) => image.url),
  );
  assert.equal(first.hero?.url, second.hero?.url);
});
