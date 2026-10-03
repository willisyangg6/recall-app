/**
 * The Ready step's presentation rules (lib/ready-presentation.ts, the
 * preference-board Ready, 2026-09-30): where the board's native rows may go,
 * how far the compact board grows and when the wide board takes over (never a
 * separate card), what each board row shows and says, the allergen plate for
 * every selection size, and the deck's geometry. The layer offsets
 * themselves are checked against the asset report in
 * ready-board-assets.test.ts.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PREVIEW_NONE } from '@/lib/onboarding-copy';
import {
  allergenArtwork,
  atAccessibilitySize,
  BOARD_GROWTH_MAX_PX,
  boardCapacity,
  boardColumnWidth,
  boardGrowthMax,
  boardTemplate,
  brokenWordCount,
  plateCopies,
  WIDE_GROWTH,
  WIDE_OVERLAP_PX,
  WIDE_PAPER_PX,
  WIDE_SCENE_PX,
  WIDE_TEXT_PX,
  WIDE_CLEARANCE_PX,
  WIDE_FOREGROUND_COLUMN_PX,
  WIDE_FOREGROUND_TOP_PX,
  WIDE_PAPER_FLOOR_PX,
  wideGrowth,
  wideHeadingWidth,
  wideTextWidth,
  boardRowLabel,
  boardValue,
  DECK_CARD_PADDING,
  DECK_COMMIT_FRACTION,
  DECK_FLICK_VELOCITY,
  DECK_REAR_LAYERS,
  DECK_REAR_PEEK,
  DECK_REAR_SCALE,
  deckCardHeight,
  deckDotCount,
  deckDragPosition,
  deckExitDistance,
  deckFrontWidth,
  deckPose,
  deckPoseRanges,
  deckReleaseTarget,
  deckStatusHeight,
  headlineType,
  PICTOGRAM_INK,
  PICTOGRAM_PAIR,
  PICTOGRAM_PAIR_STEP,
  PICTOGRAM_SINGLE,
  PREVIEW_BRAND_LINES,
  PREVIEW_REASON_LINES,
  PREVIEW_TITLE_LINES,
  previewCardLayout,
  previewCardUniform,
  READY_TYPE,
  ROW_WELL_SIZE,
  sceneScale,
  sliceImagePlacement,
  wholePoints,
} from '@/lib/ready-presentation';

/** The three widths that matter: the target's 393pt, iPhone 17's 402pt and the SE's 375pt. */
const WIDTHS = [393, 402, 375] as const;

test('the board holds its native rows inside the measured safe rectangle at every QA width', () => {
  // The report's content-safe rectangle is 361 × 415 target pixels.
  for (const width of WIDTHS) {
    const scale = sceneScale(width);
    assert.ok(Math.abs(boardColumnWidth(scale) - 361 * scale) < 1e-9);
    assert.ok(Math.abs(boardCapacity(scale) - 415 * scale) < 1e-9);
  }
  // At the target's width: a 152pt column and 175pt of rows before growing.
  assert.equal(Math.round(boardColumnWidth(sceneScale(393))), 152);
  assert.equal(Math.round(boardCapacity(sceneScale(393))), 175);
});

const fits = (height: number, broken = 0) => ({ height, broken });

test('the compact board keeps every block that fits its column within the founder’s 80px cap, whole', () => {
  const scale = sceneScale(393);
  const capacity = boardCapacity(scale);
  assert.equal(BOARD_GROWTH_MAX_PX, 80);
  assert.ok(Math.abs(boardGrowthMax(scale) - 80 * scale) < 1e-9);
  const wide = fits(10);
  // Rows that fit: compact, ungrown.
  assert.deepEqual(
    boardTemplate({ compact: fits(capacity - 10), wide, wideStacked: wide }, scale),
    {
      kind: 'compact',
      growth: 0,
    },
  );
  // A wrapped value grows the compact board by exactly the overflow, up to the cap.
  const grown = boardTemplate({ compact: fits(capacity + 17), wide, wideStacked: wide }, scale);
  assert.ok(grown.kind === 'compact' && Math.abs(grown.growth - 17) < 1e-9);
  const atCap = boardTemplate(
    { compact: fits(capacity + boardGrowthMax(scale)), wide, wideStacked: wide },
    scale,
  );
  assert.equal(atCap.kind, 'compact');
});

/** A one-piece block: a single drawn rectangle of `height` points across the block. */
const piece = (height: number, scale: number, width = wideTextWidth(scale)) => ({
  height,
  broken: 0,
  rects: [{ x: 0, y: 0, width, height }],
});

test('past the cap, or with any word broken in the compact column, the wide board takes over and grows', () => {
  const scale = sceneScale(375);
  const capacity = boardCapacity(scale);
  const over = boardTemplate(
    {
      compact: fits(capacity + boardGrowthMax(scale) + 1),
      wide: piece(209, scale),
      wideStacked: piece(260, scale),
    },
    scale,
  );
  assert.equal(over.kind, 'wide');
  assert.ok(over.kind === 'wide' && !over.stacked);
  assert.ok(Math.abs(over.growth - wideGrowth(piece(209, scale).rects, scale)) < 1e-9);
  // Short enough, but a word breaks in the narrow column: wide, never a broken word kept.
  const broken = boardTemplate(
    { compact: fits(capacity - 20, 1), wide: piece(40, scale), wideStacked: piece(60, scale) },
    scale,
  );
  assert.deepEqual(broken, { kind: 'wide', growth: 0, stacked: false });
  // Growth is never capped on the wide board.
  const tall = boardTemplate(
    {
      compact: fits(2000, 9),
      wide: { ...piece(1800, scale), broken: 4 },
      wideStacked: { ...piece(2200, scale), broken: 2 },
    },
    scale,
  );
  assert.ok(tall.kind === 'wide' && tall.stacked && tall.growth > 2000);
});

test('the wide board grows only as far as the foreground directly beneath each drawn piece needs', () => {
  const scale = sceneScale(375);
  const toPt = (paperRow: number) => (paperRow - WIDE_TEXT_PX.top) * scale;
  // A full-width piece is held by the mascot's rays (the highest foreground, column top 376).
  const columns = (x0: number, x1: number) =>
    WIDE_FOREGROUND_TOP_PX.slice(
      Math.floor(x0 / WIDE_FOREGROUND_COLUMN_PX),
      Math.floor(x1 / WIDE_FOREGROUND_COLUMN_PX) + 1,
    ).filter((t) => t > 0);
  const rays = Math.min(
    ...columns(
      WIDE_TEXT_PX.left - WIDE_CLEARANCE_PX.side,
      WIDE_TEXT_PX.left + WIDE_TEXT_PX.width + WIDE_CLEARANCE_PX.side,
    ),
  );
  assert.equal(rays, 376);
  const fullLimit = toPt(rays - WIDE_CLEARANCE_PX.below);
  assert.ok(
    Math.abs(wideGrowth([{ x: 0, y: 0, width: wideTextWidth(scale), height: fullLimit }], scale)) <
      1e-9,
  );
  assert.ok(
    Math.abs(
      wideGrowth([{ x: 0, y: 0, width: wideTextWidth(scale), height: fullLimit + 10 }], scale) - 10,
    ) < 1e-6,
  );
  // A short piece over the empty middle of the board reaches far lower without growing:
  // only the board's foot holds it.
  const middleX = (300 - WIDE_TEXT_PX.left) * scale;
  const middle = { x: middleX, y: 0, width: 40 * scale, height: toPt(WIDE_PAPER_FLOOR_PX) };
  assert.ok(Math.abs(wideGrowth([middle], scale)) < 1e-9);
  assert.ok(
    wideGrowth([middle], scale) <
      wideGrowth([{ ...middle, x: 0, width: wideTextWidth(scale) }], scale),
  );
  // Every piece counts: the worst one decides.
  assert.ok(
    Math.abs(
      wideGrowth(
        [middle, { x: 0, y: 0, width: wideTextWidth(scale), height: fullLimit + 4 }],
        scale,
      ) - 4,
    ) < 1e-6,
  );
  // Empty pieces are ignored.
  assert.equal(wideGrowth([{ x: 0, y: 0, width: 0, height: 9999 }], scale), 0);
  assert.equal(WIDE_FOREGROUND_TOP_PX.length * WIDE_FOREGROUND_COLUMN_PX, 784);
  assert.deepEqual(WIDE_CLEARANCE_PX, { side: 5, below: 13 });
});

test('the wide board puts the plates above the words only when that breaks fewer words', () => {
  const scale = sceneScale(402);
  const m = (side: number, stacked: number) =>
    boardTemplate(
      { compact: fits(9999, 9), wide: fits(300, side), wideStacked: fits(400, stacked) },
      scale,
    );
  assert.equal((m(0, 0) as { stacked: boolean }).stacked, false);
  assert.equal((m(2, 2) as { stacked: boolean }).stacked, false);
  assert.equal((m(3, 1) as { stacked: boolean }).stacked, true);
});

test('the wide board’s layers and text region are the asset report’s, at every QA width', () => {
  assert.deepEqual(WIDE_SCENE_PX, { width: 934, height: 771 });
  assert.deepEqual(WIDE_PAPER_PX, { width: 782, height: 597, left: 85, top: 60 });
  assert.deepEqual(WIDE_OVERLAP_PX, { width: 786, height: 267, left: 83, top: 392 });
  assert.deepEqual(WIDE_GROWTH, { paperRow: 220, sceneRow: 280, plateRows: 1200, featherRows: 24 });
  for (const width of WIDTHS) {
    const scale = sceneScale(width);
    assert.ok(Math.abs(wideTextWidth(scale) - 719 * scale) < 1e-9);
    assert.ok(Math.abs(wideHeadingWidth(scale) - WIDE_TEXT_PX.headingWidth * scale) < 1e-9);
    // Much wider than the compact column: the long store summary fits two lines.
    assert.ok(wideTextWidth(scale) - 45 > 188);
  }
  // The heading stays 8px clear of the lime ribbon (its left edge is x 782 at row 265).
  assert.ok(WIDE_PAPER_PX.left + WIDE_TEXT_PX.left + WIDE_TEXT_PX.headingWidth <= 782);
});

test('the wide plates repeat only past their own 1,200 rows', () => {
  assert.equal(plateCopies(1), 1);
  assert.equal(plateCopies(1200), 1);
  assert.equal(plateCopies(1201), 2);
  assert.equal(plateCopies(3000), 3);
});

test('a word is broken only when a line ends inside it', () => {
  assert.equal(brokenWordCount('Alabama, Arizona', ['Alabama, ', 'Arizona']), 0);
  assert.equal(brokenWordCount('Alabama, Arizona', ['Alabama,', 'Arizona']), 0);
  assert.equal(brokenWordCount('Massachusetts, Iowa', ['Massachusett', 's, Iowa']), 1);
  assert.equal(brokenWordCount('Your preferences', ['Your ', 'pref', 'eren', 'ces']), 2);
  assert.equal(brokenWordCount('Hy-Vee', ['Hy-', 'Vee']), 0);
  assert.equal(brokenWordCount('Iowa', ['Iowa']), 0);
  assert.equal(brokenWordCount('Market\u00A0+1', ['Market\u00A0', '+1']), 1);
});

test('the accessibility sizes start at text scale 1.5', () => {
  assert.equal(atAccessibilitySize(1.49), false);
  assert.equal(atAccessibilitySize(1.5), true);
});

test('a stretched slice is drawn from the whole image, its rows filling the slice’s box', () => {
  // The paper's slice: rows 97–151 of 458.
  assert.deepEqual(sliceImagePlacement({ top: 97, bottom: 151 }, 458), {
    top: `${(-97 / 54) * 100}%`,
    height: `${(458 / 54) * 100}%`,
  });
  // The wall band: rows 57–61 of the 603-row scene.
  assert.deepEqual(sliceImagePlacement({ top: 57, bottom: 61 }, 603), {
    top: `${(-57 / 4) * 100}%`,
    height: `${(603 / 4) * 100}%`,
  });
});

test('Ready’s own measured type, and the shared headline base at the accessibility sizes', () => {
  assert.deepEqual(READY_TYPE.headline, { fontSize: 34, lineHeight: 40 });
  // The board's rows (the 2026-10-01 refinement): 14pt labels, 15pt values,
  // no letter spacing.
  assert.deepEqual(READY_TYPE.label, { fontSize: 14, lineHeight: 17 });
  assert.deepEqual(READY_TYPE.value, { fontSize: 15, lineHeight: 20 });
  assert.deepEqual(headlineType(1), READY_TYPE.headline);
  assert.deepEqual(headlineType(1.5), { fontSize: 23, lineHeight: 30 });
  // Every line is at least as tall as its type.
  for (const type of Object.values(READY_TYPE)) assert.ok(type.lineHeight >= type.fontSize);
});

test('nothing chosen draws no pictogram; a token outside the vocabulary claims nothing', () => {
  assert.deepEqual(allergenArtwork([]), { kind: 'none' });
  assert.deepEqual(allergenArtwork(['gluten']), { kind: 'none' });
});

test('one allergen draws its own pictogram alone; two share the plate’s diagonal exactly', () => {
  assert.deepEqual(allergenArtwork(['sesame']), {
    kind: 'pictograms',
    tokens: ['sesame'],
    more: 0,
  });
  assert.deepEqual(allergenArtwork(['peanut', 'milk']), {
    kind: 'pictograms',
    tokens: ['peanut', 'milk'],
    more: 0,
  });
  // The pair fills the plate; a single pictogram's drawing stays inside it.
  assert.equal(PICTOGRAM_PAIR + PICTOGRAM_PAIR_STEP, ROW_WELL_SIZE);
  assert.ok(PICTOGRAM_SINGLE * PICTOGRAM_INK < ROW_WELL_SIZE);
});

test('three or more draw the first two in canonical order, never tap order; the rest are counted', () => {
  assert.deepEqual(allergenArtwork(['shellfish', 'sesame', 'tree nuts', 'peanut']), {
    kind: 'pictograms',
    tokens: ['peanut', 'tree nuts'],
    more: 2,
  });
  assert.deepEqual(allergenArtwork(['fish', 'milk']), allergenArtwork(['milk', 'fish']));
});

test('a board row shows the compact rule and speaks every name', () => {
  assert.equal(boardValue(['Alabama', 'Arizona'], PREVIEW_NONE), 'Alabama, Arizona');
  // `+N` is glued to the last name with a no-break space, so it can never
  // wrap onto a line of its own.
  assert.equal(
    boardValue(['Alabama', 'Arizona', 'California'], PREVIEW_NONE),
    'Alabama, Arizona\u00A0+1',
  );
  assert.equal(
    boardValue(['Aldi', "Trader Joe's", 'Costco', 'Target'], PREVIEW_NONE),
    "Aldi, Trader Joe's\u00A0+2",
  );
  assert.equal(boardValue([], PREVIEW_NONE), 'None');
  assert.equal(
    boardRowLabel('States', ['Alabama', 'Arizona', 'California'], PREVIEW_NONE),
    'States: Alabama, Arizona and California',
  );
  assert.equal(boardRowLabel('Allergens', [], PREVIEW_NONE), 'Allergens: None');
  assert.equal(boardRowLabel('Stores', ['Aldi'], PREVIEW_NONE), 'Stores: Aldi');
});

/** iPhone 17's deck: 402pt less the page margins, and its front card. */
const DECK = 402 - 32;
const FRONT = deckFrontWidth(DECK);
const EXIT = deckExitDistance(FRONT, 16);

test('at rest only genuine next cards sit behind the front one, at most two, progressively smaller', () => {
  assert.equal(DECK_REAR_LAYERS, 2);
  assert.ok(DECK_REAR_SCALE[0] < 1 && DECK_REAR_SCALE[1] < DECK_REAR_SCALE[0]);
  // Depth 0 is the front card, upright and full size.
  assert.deepEqual(deckPose(0, FRONT, EXIT), { translateX: 0, scale: 1, opacity: 1 });
  // Depths 1 and 2 show; depth 3 and beyond are unseen.
  assert.equal(deckPose(1, FRONT, EXIT).opacity, 1);
  assert.equal(deckPose(2, FRONT, EXIT).opacity, 1);
  assert.equal(deckPose(3, FRONT, EXIT).opacity, 0);
  assert.equal(deckPose(7, FRONT, EXIT).opacity, 0);
  assert.equal(deckPose(1, FRONT, EXIT).scale, DECK_REAR_SCALE[0]);
  assert.equal(deckPose(2, FRONT, EXIT).scale, DECK_REAR_SCALE[1]);
});

test('a rear card shows only a clean strip of its right edge: inside its own padding, top and bottom hidden', () => {
  let previousRight = FRONT;
  for (const depth of [1, 2]) {
    const { translateX, scale } = deckPose(depth, FRONT, EXIT);
    // Scaled about its centre, then moved: its right edge peeks past the one in front.
    const right = FRONT / 2 + (FRONT / 2) * scale + translateX;
    const left = FRONT / 2 - (FRONT / 2) * scale + translateX;
    assert.ok(Math.abs(right - previousRight - DECK_REAR_PEEK) < 1e-9, `depth ${depth}`);
    assert.ok(right <= DECK + 1e-9, 'past the deck');
    assert.ok(left > 0, 'its left edge shows');
    // Its content ends inside the card in front: only its padding shows.
    assert.ok(right - DECK_CARD_PADDING * scale <= previousRight, `depth ${depth} leaks content`);
    previousRight = right;
  }
});

test('the outgoing card is a rigid rectangle: it only moves left, by the exit distance, never scaled', () => {
  for (const depth of [0, -0.1, -0.5, -0.9, -1, -3]) {
    const pose = deckPose(depth, FRONT, EXIT);
    assert.equal(pose.scale, 1, `scaled at ${depth}`);
    assert.equal(pose.opacity, 1);
    assert.ok(pose.translateX <= 0, 'moved right');
  }
  assert.equal(deckPose(-1, FRONT, EXIT).translateX, -EXIT);
  // It leaves the screen entirely: past the page margin and its shadow.
  assert.ok(EXIT > FRONT + 16);
  // Monotonic: further forward is always further left.
  assert.ok(deckPose(-0.6, FRONT, EXIT).translateX < deckPose(-0.3, FRONT, EXIT).translateX);
});

test('the card beneath comes forward from where it sits by one uniform promotion, never from the right', () => {
  const rest = deckPose(1, FRONT, EXIT);
  let prior = rest;
  for (const depth of [0.75, 0.5, 0.25, 0]) {
    const pose = deckPose(depth, FRONT, EXIT);
    assert.ok(pose.scale >= prior.scale && pose.translateX <= prior.translateX, `${depth}`);
    // Never further right than its resting place behind the front card.
    assert.ok(pose.translateX <= rest.translateX);
    prior = pose;
  }
  // The second rear card rises into the first rear place on the same progress.
  assert.deepEqual(deckPose(1, FRONT, EXIT), deckPose(2 - 1, FRONT, EXIT));
  const ranges = deckPoseRanges(FRONT, EXIT);
  assert.deepEqual(ranges.inputRange, [-1, 0, 1, 2, 3]);
  assert.ok(
    ranges.inputRange.every((_, i) => i === 0 || ranges.inputRange[i] > ranges.inputRange[i - 1]),
  );
});

test('a drag moves one card per exit distance and resists past either end', () => {
  // Forward is a drag to the left.
  assert.equal(deckDragPosition(0, 4, -EXIT / 2, EXIT), 0.5);
  assert.equal(deckDragPosition(2, 4, EXIT / 4, EXIT), 1.75);
  // Past the first card or the last, the deck follows at a fraction.
  assert.ok(
    deckDragPosition(0, 4, EXIT / 2, EXIT) > -0.5 && deckDragPosition(0, 4, EXIT / 2, EXIT) < 0,
  );
  const pastEnd = deckDragPosition(3, 4, -EXIT / 2, EXIT);
  assert.ok(pastEnd > 3 && pastEnd < 3.5);
  // A single card cannot be pulled away.
  assert.ok(Math.abs(deckDragPosition(0, 1, -EXIT, EXIT)) < 0.5);
});

test('a release commits one card when it travelled or was flicked; anything less restores the stack', () => {
  const far = -EXIT * (DECK_COMMIT_FRACTION + 0.01);
  const short = -EXIT * (DECK_COMMIT_FRACTION - 0.05);
  const flick = DECK_FLICK_VELOCITY + 0.1;
  assert.equal(deckReleaseTarget(1, 4, far, 0, EXIT), 2);
  assert.equal(deckReleaseTarget(1, 4, short, 0, EXIT), 1, 'a cancelled swipe moved');
  assert.equal(deckReleaseTarget(1, 4, short, -flick, EXIT), 2, 'a forward flick was lost');
  assert.equal(deckReleaseTarget(1, 4, -far, 0, EXIT), 0);
  assert.equal(deckReleaseTarget(1, 4, -short, flick, EXIT), 0, 'a back flick was lost');
  // A flick against the drag does not commit it.
  assert.equal(deckReleaseTarget(1, 4, short, flick, EXIT), 1);
  // Never past either end.
  assert.equal(deckReleaseTarget(3, 4, far, -flick, EXIT), 3);
  assert.equal(deckReleaseTarget(0, 4, -far, flick, EXIT), 0);
  assert.equal(deckReleaseTarget(0, 1, far, -flick, EXIT), 0);
});

test('one dot per navigable page, the locked page included, and none for a single page', () => {
  assert.equal(deckDotCount(0), 0);
  assert.equal(deckDotCount(1), 0);
  assert.equal(deckDotCount(2), 2);
  assert.equal(deckDotCount(4), 4);
});

test('every card in a deck is the tallest one measured, whole points, never shrinking', () => {
  assert.equal(deckCardHeight([]), 0);
  assert.equal(deckCardHeight([301.2, 296, 318.4]), 319);
  assert.equal(deckCardHeight([319, 319]), 319);
  // Layout's float noise never adds a point: a card raised to 285 that
  // measures 285.00006 confirms 285 (a plain ceil crept to 1,023pt at XL).
  assert.equal(wholePoints(285.00006), 285);
  assert.equal(deckCardHeight([285.00006, 284.99]), 285);
  assert.equal(wholePoints(285.5), 286);
  assert.equal(deckStatusHeight(26, [52.00006]), 52);
});

test('deck cards share one outer size, never padding the content: line limits until the accessibility sizes', () => {
  assert.equal(PREVIEW_TITLE_LINES, 2);
  assert.equal(PREVIEW_BRAND_LINES, 1);
  assert.equal(PREVIEW_REASON_LINES, 2);
  const normal = previewCardLayout(1)!;
  // Only the status row is reserved; the title, brand, category and reason
  // are grouped as the Feed groups them (the Moringa correction).
  assert.deepEqual(Object.keys(normal), ['statusMinHeight']);
  assert.equal(normal.statusMinHeight, 16 + 8 + 2);
  assert.ok(previewCardLayout(1.353)!.statusMinHeight > normal.statusMinHeight);
  assert.equal(previewCardUniform(1.5), false);
  assert.equal(previewCardLayout(1.5), null);
  assert.equal(previewCardLayout(3.118), null);
});

test('the deck reserves the tallest status row it measured, never less than the rule, and never oscillates', () => {
  assert.equal(deckStatusHeight(26, []), 26);
  assert.equal(deckStatusHeight(26, [26, 26, 25.6]), 26);
  assert.equal(deckStatusHeight(26, [26, 60.2, 26]), 61);
  assert.equal(deckStatusHeight(26, [26, 61, 61, 61]), 61);
});
