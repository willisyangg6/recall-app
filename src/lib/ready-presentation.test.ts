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
  DECK_NEXT_SCALE,
  DECK_TUCK,
  PREVIEW_REASON_LINES,
  PREVIEW_TITLE_LINES,
  previewCardLayout,
  previewCardUniform,
  deckStatusHeight,
  CAROUSEL_GAP,
  READY_BODY_ASIDE_FRACTION,
  readyBodyAside,
  CAROUSEL_PEEK,
  carouselActiveIndex,
  carouselCardWidth,
  carouselSnapInterval,
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
  readyMascotOverlap,
  readyMascotReserve,
  readyMascotRight,
  readyMascotSize,
  ROW_WELL_SIZE,
  shieldDepth,
  shieldReach,
  STORE_SUMMARY_LIMIT,
  storeSummaryText,
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

test('the Stores row shows up to three stores in full, then the first two and a count', () => {
  assert.equal(STORE_SUMMARY_LIMIT, 3);
  assert.equal(storeSummaryText([]), '');
  assert.equal(storeSummaryText(['Aldi']), 'Aldi');
  assert.equal(storeSummaryText(['Aldi', "BJ's Wholesale Club"]), "Aldi, BJ's Wholesale Club");
  assert.equal(storeSummaryText(['Costco', 'Aldi', 'Kroger']), 'Costco, Aldi, Kroger');
  // Four or more: the first two in the summary's own (chosen) order, then a
  // count that wraps as one unit (a no-break space inside `+N more`).
  assert.equal(
    storeSummaryText(['Costco', 'Aldi', 'Kroger', 'Target']),
    'Costco, Aldi +2\u00A0more',
  );
  const six = ['Aldi', "BJ's Wholesale Club", "Trader Joe's", "Sam's Club", 'Safeway', 'Publix'];
  assert.equal(storeSummaryText(six), "Aldi, BJ's Wholesale Club +4\u00A0more");
  // Deterministic: the same selection always reads the same.
  assert.equal(storeSummaryText([...six]), storeSummaryText(six));
});

test('a compacted Stores row still speaks every store', () => {
  const six = ['Aldi', "BJ's Wholesale Club", "Trader Joe's", "Sam's Club", 'Safeway', 'Publix'];
  assert.equal(
    summaryRowLabel('Stores', six, PREVIEW_NONE, PREVIEW_ROW_COMPLETED),
    "Stores: Aldi, BJ's Wholesale Club, Trader Joe's, Sam's Club, Safeway and Publix, completed",
  );
});

test('at ordinary sizes the crest rises 48pt beside the body paragraph; from scale 1.2 the full lift is reserved', () => {
  // The reduction the 2026-09-27 polish asked for: 40–60pt on an iPhone 17.
  assert.equal(readyMascotOverlap(1), 48);
  assert.equal(readyMascotOverlap(1.118), 48);
  // From 1.2 the paragraph can wrap far enough right to reach the mascot.
  assert.equal(readyMascotOverlap(1.2), 0);
  assert.equal(readyMascotOverlap(1.353), 0);
  assert.equal(readyMascotOverlap(3.118), 0);
  // The reserve on the three sizes, and the seat itself unchanged by it.
  assert.equal(readyMascotReserve(172, 1), readyMascotLift(172) - 48); // iPhone 17: 97 − 48
  assert.equal(readyMascotReserve(172, 1), 49);
  assert.equal(readyMascotReserve(140, 1), 31); // iPhone SE
  assert.equal(readyMascotReserve(180, 1), 54);
  assert.equal(readyMascotReserve(140, 3.118), readyMascotLift(140));
  assert.equal(readyMascotOffset(172), Math.round(172 * (704 / 1024)), 'the seat moved');
});

test('while the crest rises, the heading gives up the mascot’s width so the body wraps into the cliff', () => {
  assert.equal(READY_BODY_ASIDE_FRACTION, 0.82);
  // iPhone 17 (size 172) and SE (140) at the default scale.
  assert.equal(readyBodyAside(172, 1), 141);
  assert.equal(readyBodyAside(140, 1), 115);
  // From scale 1.2 the full lift is reserved (readyMascotOverlap is 0), the
  // mascot sits wholly below the paragraph, and large text keeps its width.
  assert.equal(readyBodyAside(172, 1.2), 0);
  assert.equal(readyBodyAside(140, 3.118), 0);
});

test('deck cards share one size: every slot reserved from the type scale, until the accessibility sizes', () => {
  assert.equal(PREVIEW_TITLE_LINES, 2);
  assert.equal(PREVIEW_REASON_LINES, 2);
  const normal = previewCardLayout(1)!;
  // Reserved exactly to the line limits at the default size.
  assert.equal(normal.titleMinHeight, 26 * 2); // heading-3 line height 26
  assert.equal(normal.reasonMinHeight, 18 * 2); // body-small line height 18
  // One status chip row by rule (label line 16, 4pt paddings, borders); the
  // deck raises it to the tallest row it measured (below).
  assert.equal(normal.statusMinHeight, 16 + 8 + 2);
  // The reservations grow with the reader's text size: never capped type.
  const larger = previewCardLayout(1.353)!;
  assert.ok(larger.titleMinHeight > normal.titleMinHeight);
  assert.ok(larger.reasonMinHeight > normal.reasonMinHeight);
  assert.ok(larger.statusMinHeight > normal.statusMinHeight);
  // From the accessibility sizes nothing is reserved or line-limited.
  assert.equal(previewCardUniform(1.5), false);
  assert.equal(previewCardLayout(1.5), null);
  assert.equal(previewCardLayout(3.118), null);
});

test('the deck reserves the tallest status row it measured, never less than the rule, and never oscillates', () => {
  assert.equal(deckStatusHeight(26, []), 26);
  // A deck whose rows all fit one line keeps one line: no empty band.
  assert.equal(deckStatusHeight(26, [26, 26, 25.6]), 26);
  // One wrapping row (a PHA label beside a long date) raises every card.
  assert.equal(deckStatusHeight(26, [26, 60.2, 26]), 61);
  // Re-measuring with the reservation applied only confirms it.
  assert.equal(deckStatusHeight(26, [26, 61, 61, 61]), 61);
});

test('the waiting card is smaller and tucked behind the active one: depth, restrained', () => {
  assert.ok(DECK_NEXT_SCALE < 1 && DECK_NEXT_SCALE >= 0.9, 'depth too loud or absent');
  assert.ok(DECK_TUCK > 0 && DECK_TUCK <= 24);
});

test('a carousel card leaves the next card’s peek visible, and the snap stride is one card and its gap', () => {
  assert.equal(CAROUSEL_PEEK, 32);
  assert.equal(CAROUSEL_GAP, 12);
  // The iPhone 17 (402pt window): the content width between the margins.
  const usable = 402 - 2 * 24;
  assert.equal(carouselCardWidth(usable), usable - CAROUSEL_PEEK);
  assert.equal(carouselSnapInterval(usable), usable - CAROUSEL_PEEK + CAROUSEL_GAP);
  // The card never collapses below a readable floor.
  assert.equal(carouselCardWidth(100), 200);
});

test('the active card follows the snapped offset and never leaves the deck', () => {
  const usable = 402 - 2 * 24;
  const stride = carouselSnapInterval(usable);
  assert.equal(carouselActiveIndex(0, usable, 4), 0);
  assert.equal(carouselActiveIndex(stride, usable, 4), 1);
  assert.equal(carouselActiveIndex(2 * stride + 4, usable, 4), 2);
  // A slight over-scroll on either end still resolves to a real card.
  assert.equal(carouselActiveIndex(-30, usable, 4), 0);
  assert.equal(carouselActiveIndex(99 * stride, usable, 4), 3);
  assert.equal(carouselActiveIndex(0, usable, 0), 0);
});
