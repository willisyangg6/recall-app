/**
 * Hero provenance classification (C9): the audit vocabulary the QA gates
 * stand on. Nothing here selects imagery — that is the point.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyHeroUrl } from './hero-provenance';

const PREFIX = 'https://project.supabase.co/storage/v1/object/public/product-visuals/';

test('provenance classification: agency photo, our render, or unknown — nothing guessed', () => {
  assert.equal(classifyHeroUrl('https://www.fda.gov/files/Photo.jpg', PREFIX), 'agency_photo');
  assert.equal(
    classifyHeroUrl(
      'https://www.fda.gov/files/styles/recall_image_small/public/x.jpg?itok=abc',
      PREFIX,
    ),
    'agency_photo',
  );
  assert.equal(classifyHeroUrl(`${PREFIX}fsis-labels/x/p1.webp`, PREFIX), 'label_render');
  assert.equal(classifyHeroUrl('https://cdn.example.com/stock-food.jpg', PREFIX), 'unknown');
  assert.equal(classifyHeroUrl('https://notfda.gov/files/x.jpg', PREFIX), 'unknown');
  assert.equal(classifyHeroUrl('https://images.notfda.gov.evil.net/x.jpg', PREFIX), 'unknown');
  assert.equal(classifyHeroUrl('http://www.fda.gov/files/x.jpg', PREFIX), 'unknown');
  assert.equal(classifyHeroUrl(null, PREFIX), null);
});
