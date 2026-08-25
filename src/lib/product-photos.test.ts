import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractProductPhotos,
  galleryPhotos,
  packageCheckPhotos,
  primaryPhoto,
} from './product-photos';

const HTML = `
<img src="/files/styles/recall_image_small/public/image_1.png?itok=A" width="240" height="253" alt="Outshine Fruit Bars Strawberry, 6 Bars" />
<img src="/files/styles/recall_image_small/public/image_1a.png?itok=B" width="172" height="80" alt="UPC Bottom of package: 041548610047" />
<img src="/files/styles/recall_image_small/public/image_2.png?itok=C" width="248" height="251" alt="Outshine Fruit Bars Grape, 6 Bars" />
<img src="data:image/png;base64,iVBORw0KGgo" alt="" />
<img src="https://cdn.example.com/other.png" alt="Third party" />
<img src="/files/styles/recall_image_small/public/fda-logo.png" alt="FDA logo" />
<img src="/files/styles/recall_image_small/public/image_1.png?itok=DIFFERENT" alt="duplicate file" />
`;

test('product photos come only from authoritative agency URLs, deduplicated', () => {
  const photos = extractProductPhotos(HTML);
  assert.deepEqual(
    photos.map((p) => p.url.replace(/^.*public\//, '').replace(/\?.*$/, '')),
    ['image_1.png', 'image_1a.png', 'image_2.png'],
  );
  // Inline pixels, third-party hosts, and page chrome are excluded…
  assert.ok(!photos.some((p) => p.url.includes('example.com')));
  assert.ok(!photos.some((p) => /logo/i.test(p.url)));
  // …and the same underlying file is never shown twice, even with a new token.
  assert.equal(new Set(photos.map((p) => p.url.replace(/\?.*$/, ''))).size, photos.length);
  // Every URL is agency-hosted, never rehosted by us.
  assert.ok(photos.every((p) => p.url.startsWith('https://www.fda.gov/files/')));
});

test('published dimensions are preserved so layout can respect them', () => {
  const photos = extractProductPhotos(HTML);
  assert.equal(photos[0].width, 240);
  assert.equal(photos[0].height, 253);
  assert.ok(Math.abs((photos[0].aspectRatio ?? 0) - 240 / 253) < 0.001);
});

test('a barcode crop is recognized and kept out of the primary gallery', () => {
  const photos = extractProductPhotos(HTML);
  assert.equal(photos[1].role, 'barcode_closeup');
  assert.equal(photos[0].role, 'package_full');
  // The gallery answers "is this the product?", so the macro is excluded.
  assert.ok(!galleryPhotos(photos).some((p) => p.role === 'barcode_closeup'));
  assert.match(primaryPhoto(photos)?.alt ?? '', /Strawberry/);
});

test('a package label that happens to contain a barcode stays a primary image', () => {
  // The only visual FDA supplies for the Dairyland Produce jalapeños. Demoting
  // it for containing a barcode would leave the recall with no product photo.
  const photos = extractProductPhotos(
    '<img src="/files/styles/recall_image_small/public/image_1_283.jpg?itok=M" width="332" height="206" alt="Dairyland Produce Pepper Jalapeno BX #5 label example" />',
  );
  assert.equal(photos[0].role, 'package_label');
  assert.equal(galleryPhotos(photos).length, 1);
  assert.equal(primaryPhoto(photos)?.role, 'package_label');
});

test('a wide label photograph is not mistaken for a code crop', () => {
  // 480x170 label shots are common; only a caption describing nothing but a
  // code, on a small image, is a crop.
  const photos = extractProductPhotos(
    '<img src="/files/styles/recall_image_small/public/label.jpg" width="391" height="162" alt="Labeling, best used by date and lot code, King Arthur Flour" />',
  );
  assert.equal(photos[0].role, 'package_label');
});

test('package-check photos lead with the code close-ups that verify a package', () => {
  const photos = extractProductPhotos(HTML);
  const compare = packageCheckPhotos(photos);
  assert.ok(compare.some((p) => p.role === 'barcode_closeup'));
  // Capped so the checker never re-dumps the whole gallery.
  assert.ok(compare.length <= 3);
});

test('close-ups still show when they are the only images there are', () => {
  const photos = extractProductPhotos(
    '<img src="/files/styles/recall_image_small/public/a.png" width="172" height="80" alt="UPC Bottom of package: 041548610047" />',
  );
  assert.equal(photos[0].role, 'barcode_closeup');
  assert.equal(galleryPhotos(photos).length, 1);
});

test('no images means no gallery, never a placeholder', () => {
  assert.deepEqual(extractProductPhotos('<p>No images</p>'), []);
  assert.deepEqual(extractProductPhotos(null), []);
  assert.equal(primaryPhoto([]), null);
  assert.deepEqual(packageCheckPhotos([]), []);
  assert.deepEqual(galleryPhotos([]), []);
});
