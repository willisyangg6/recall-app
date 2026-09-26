/**
 * The Ready step's presentation rules (lib/ready-presentation.ts): the
 * allergen artwork for every selection size, canonical order whatever the
 * tap order, the rows' spoken names, and the trust-peek mascot's seat at both
 * size bounds. The artwork's measurements are checked against the PNG itself
 * in mascot-assets.test.ts.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONSUMER_ALLERGENS } from '@/domain/preferences';
import { PREVIEW_NONE, PREVIEW_ROW_COMPLETED } from '@/lib/onboarding-copy';
import {
  allergenArtwork,
  moreLabel,
  pawDepth,
  PICTOGRAM_INK,
  PICTOGRAM_PAIR,
  PICTOGRAM_PAIR_STEP,
  PICTOGRAM_SINGLE,
  READY_MASCOT_MAX,
  READY_MASCOT_MIN,
  readyMascotLift,
  readyMascotOffset,
  readyMascotRight,
  readyMascotSize,
  ROW_WELL_SIZE,
  shieldDepth,
  shieldReach,
  SUMMARY_PADDING,
  SUMMARY_ROW_GAP,
  summaryHeaderMinHeight,
  summaryHeadingInset,
  summaryHeadingLayout,
  summaryRowLabel,
  summaryStacked,
} from '@/lib/ready-presentation';

test('nothing chosen draws no pictogram at all', () => {
  assert.deepEqual(allergenArtwork([]), { kind: 'none' });
  // A token outside the vocabulary has no pictogram and claims nothing.
  assert.deepEqual(allergenArtwork(['gluten']), { kind: 'none' });
});

test('one allergen draws its own pictogram, alone, as large as the map pin', () => {
  assert.deepEqual(allergenArtwork(['sesame']), {
    kind: 'pictograms',
    tokens: ['sesame'],
    more: 0,
  });
  assert.equal(PICTOGRAM_SINGLE, 32);
  // At most 22.3pt of drawing: the map pin's ink is 22.7pt tall at 24pt.
  assert.ok(Math.abs(PICTOGRAM_SINGLE * PICTOGRAM_INK - 22.7) < 0.5);
  assert.ok(PICTOGRAM_SINGLE <= ROW_WELL_SIZE);
});

test('two allergens draw both on the well’s diagonal, meeting only at one corner', () => {
  assert.deepEqual(allergenArtwork(['peanut', 'tree nuts']), {
    kind: 'pictograms',
    tokens: ['peanut', 'tree nuts'],
    more: 0,
  });
  assert.equal(PICTOGRAM_PAIR, 28);
  // The pair fills the well exactly on both axes, nothing cropped…
  assert.equal(PICTOGRAM_PAIR + PICTOGRAM_PAIR_STEP, ROW_WELL_SIZE);
  // …each drawing is at most 19.6pt (was 16.8pt at 24pt boxes)…
  const ink = PICTOGRAM_PAIR * PICTOGRAM_INK;
  assert.ok(ink > 19.5 && ink < 19.6);
  // …and, centred in their boxes, they share at most a 7.6pt corner square;
  // the well's top trailing corner (right of the first, above the second)
  // stays clear for the +N.
  const margin = (PICTOGRAM_PAIR - ink) / 2;
  const cornerOverlap = margin + ink - (PICTOGRAM_PAIR_STEP + margin);
  assert.ok(cornerOverlap < 7.6, `${cornerOverlap}`);
  // The +N (20pt+ wide from 8pt past the well's edge, from 4pt above its
  // top) covers x ≥ 28 and y ≤ 10 of the well: the first drawing ends before
  // it, and the second starts below it.
  assert.ok(margin + ink < ROW_WELL_SIZE + 8 - 20, 'the +N covers the first pictogram');
  assert.ok(PICTOGRAM_PAIR_STEP + margin > 10, 'the +N covers the second pictogram');
});

test('three or more draw the first two and count the rest', () => {
  assert.deepEqual(allergenArtwork(['milk', 'egg', 'wheat']), {
    kind: 'pictograms',
    tokens: ['milk', 'egg'],
    more: 1,
  });
  const all = CONSUMER_ALLERGENS.map((option) => option.token);
  assert.deepEqual(allergenArtwork(all), {
    kind: 'pictograms',
    tokens: ['peanut', 'tree nuts'],
    more: 7,
  });
  assert.equal(moreLabel(1), '+1');
  assert.equal(moreLabel(7), '+7');
});

test('the order is the canonical vocabulary’s, never the order they were tapped', () => {
  const tapped = ['shellfish', 'sesame', 'tree nuts', 'peanut'];
  assert.deepEqual(allergenArtwork(tapped), {
    kind: 'pictograms',
    tokens: ['peanut', 'tree nuts'],
    more: 2,
  });
  assert.deepEqual(allergenArtwork(['fish', 'milk']), allergenArtwork(['milk', 'fish']));
});

test('each row is spoken with its complete selection and that it is done', () => {
  const row = (label: string, names: string[]) =>
    summaryRowLabel(label, names, PREVIEW_NONE, PREVIEW_ROW_COMPLETED);
  assert.equal(row('States', ['California']), 'States: California, completed');
  assert.equal(
    row('Allergens', ['Peanuts', 'Tree nuts']),
    'Allergens: Peanuts and Tree nuts, completed',
  );
  assert.equal(
    row('Stores', ['Aldi', "BJ's Wholesale Club"]),
    "Stores: Aldi and BJ's Wholesale Club, completed",
  );
  assert.equal(row('Allergens', []), 'Allergens: None, completed');
  // Three or more: every name is spoken; the +N is decoration only.
  assert.equal(
    row('Allergens', ['Milk', 'Egg', 'Wheat']),
    'Allergens: Milk, Egg and Wheat, completed',
  );
});

test('the mascot takes 0.195 of the window between its bounds, and its smallest size from the accessibility sizes', () => {
  // Raised from 120–152pt (144 on an iPhone 17) in the 2026-09-26 polish pass.
  assert.equal(READY_MASCOT_MIN, 140);
  assert.equal(READY_MASCOT_MAX, 180);
  assert.equal(readyMascotSize(667, 1), READY_MASCOT_MIN); // iPhone SE: 0.195 is 132
  assert.equal(readyMascotSize(874, 1), 172); // iPhone 17: +19% over 144
  assert.equal(readyMascotSize(956, 1), 180); // the largest phones
  assert.equal(readyMascotSize(874, 1.5), READY_MASCOT_MIN);
  assert.equal(readyMascotSize(874, 3.1), READY_MASCOT_MIN);
});

test('the mascot’s seat on the summary card is unchanged at both size bounds', () => {
  // The box starts this far above the card's top border…
  assert.equal(readyMascotOffset(READY_MASCOT_MIN), 96);
  assert.equal(readyMascotOffset(READY_MASCOT_MAX), 124);
  // …the drawing stands this tall above it, all of it reserved…
  assert.equal(readyMascotLift(READY_MASCOT_MIN), 79);
  assert.equal(readyMascotLift(READY_MASCOT_MAX), 102);
  // …the drawing's trailing edge lands on the card's padding…
  for (const size of [READY_MASCOT_MIN, READY_MASCOT_MAX]) {
    const artRight = readyMascotRight(size) + size * (1 - 969 / 1024);
    assert.ok(Math.abs(artRight - SUMMARY_PADDING) <= 0.5, `${size}: ${artRight}`);
  }
  // …the paw rests just inside the card, above the heading…
  assert.equal(pawDepth(READY_MASCOT_MAX), 7);
  assert.ok(pawDepth(READY_MASCOT_MAX) < SUMMARY_PADDING);
  // …and the shield hangs this far in, reaching this far from the trailing edge.
  assert.equal(shieldDepth(READY_MASCOT_MIN), 37);
  assert.equal(shieldDepth(READY_MASCOT_MAX), 48);
  assert.equal(shieldReach(READY_MASCOT_MIN), 70);
  assert.equal(shieldReach(READY_MASCOT_MAX), 85);
});

test('the heading keeps clear of the shield, and the first row starts below it', () => {
  for (const size of [READY_MASCOT_MIN, 172, READY_MASCOT_MAX]) {
    // The heading's text ends before the shield begins.
    const headingEnd = SUMMARY_PADDING + summaryHeadingInset(size);
    assert.ok(headingEnd > shieldReach(size), `${size}: the heading runs under the shield`);
    // The first row starts after the heading block and the row gap: below
    // the shield and its clearance, however short the heading.
    const firstRow = SUMMARY_PADDING + summaryHeaderMinHeight(size) + SUMMARY_ROW_GAP;
    assert.ok(firstRow >= shieldDepth(size) + 8, `${size}: a row starts under the shield`);
  }
});

test('from the accessibility sizes the rows stack and the heading drops beneath the shield at full width', () => {
  assert.equal(summaryStacked(1), false);
  assert.equal(summaryStacked(1.35), false);
  assert.equal(summaryStacked(1.5), true);
  assert.equal(summaryStacked(3.1), true);
  // Beside the shield at ordinary sizes…
  assert.deepEqual(summaryHeadingLayout(144, 1), {
    paddingTop: 0,
    paddingRight: summaryHeadingInset(144),
    minHeight: summaryHeaderMinHeight(144),
  });
  // …beneath it, with the card's whole width, from the accessibility sizes.
  const stacked = summaryHeadingLayout(READY_MASCOT_MIN, 3.1);
  assert.equal(stacked.paddingRight, 0);
  assert.ok(SUMMARY_PADDING + stacked.paddingTop > shieldDepth(READY_MASCOT_MIN));
});
