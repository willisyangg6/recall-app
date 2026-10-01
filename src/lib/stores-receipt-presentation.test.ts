/**
 * The receipt Stores' layout rules (2026-09-30): the stretched slice maps
 * exactly onto the paper's approved rows at any height; the receipt must grow
 * on every supported phone, because the target's rows are too close for 44pt
 * targets; every word the receipt prints fits its column at every standard
 * text size beside the mascot, and at every accessibility size in the
 * stacked receipt (measured from the bundled font); and the targets never
 * overlap.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ACCESSIBILITY_SCALE,
  CONTENT_INSET_PX,
  COUNT_GAP,
  headlineType,
  illustrationWidth,
  PAPER_PX,
  PAPER_SLICE_PX,
  paperGrowth,
  receiptColumn,
  receiptContentHeight,
  receiptHeadingType,
  receiptLayout,
  REFERENCE_WIDTH,
  ROW_CHROME,
  ROW_MIN_HEIGHT,
  sceneScale,
  sliceImagePlacement,
  STACKED_INSET_PX,
  STACKED_SLICE_PX,
  stackedPaperScale,
  STORES_TYPE,
  type PaperSlice,
} from '@/lib/stores-receipt-presentation';

/** iOS's text-size multipliers, as React Native reports them in `fontScale`. */
const TEXT_SIZES = {
  xSmall: 0.823,
  large: 1,
  xLarge: 1.118,
  xxLarge: 1.235,
  xxxLarge: 1.353,
  ax1: 1.786,
  ax2: 2.143,
  ax3: 2.643,
  ax4: 3.143,
  ax5: 3.571,
} as const;
const STANDARD = [
  TEXT_SIZES.xSmall,
  TEXT_SIZES.large,
  TEXT_SIZES.xLarge,
  TEXT_SIZES.xxLarge,
  TEXT_SIZES.xxxLarge,
];
const ACCESSIBILITY = [
  TEXT_SIZES.ax1,
  TEXT_SIZES.ax2,
  TEXT_SIZES.ax3,
  TEXT_SIZES.ax4,
  TEXT_SIZES.ax5,
];

/** Window widths of the phones this app supports, smallest first. */
const WIDTHS = { iPhoneSE: 375, iPhone17: 402, iPhone17ProMax: 440 } as const;

/** The paper row that a point `y` down a slice box of height `h` shows. */
function rowAt(slice: PaperSlice, h: number, y: number): number {
  const { top, height } = sliceImagePlacement(slice);
  const imageTop = (parseFloat(top) / 100) * h;
  const imageHeight = (parseFloat(height) / 100) * h;
  return ((y - imageTop) / imageHeight) * PAPER_PX.height;
}

test('the stretched slice shows exactly the approved rows at any height', () => {
  for (const slice of [PAPER_SLICE_PX, STACKED_SLICE_PX]) {
    for (const h of [50, 139.4, 300, 1200]) {
      assert.ok(Math.abs(rowAt(slice, h, 0) - slice.top) < 1e-9, `top row at ${h}`);
      assert.ok(Math.abs(rowAt(slice, h, h) - slice.bottom) < 1e-9, `bottom row at ${h}`);
    }
  }
  // The receipt's slice sits below the tear and ends where the glove's art
  // begins (source row 830, paper row 356); the stacked receipt's ends above
  // the teeth (the first tooth valley is source row 1316, paper row 842).
  assert.ok(PAPER_SLICE_PX.bottom <= 356);
  assert.ok(STACKED_SLICE_PX.bottom < 842);
  assert.ok(
    STACKED_SLICE_PX.bottom - STACKED_SLICE_PX.top >
      2 * (PAPER_SLICE_PX.bottom - PAPER_SLICE_PX.top),
  );
});

test('the target’s rows are closer than 44pt, so the receipt grows on every supported phone', () => {
  // The target's dotted rules are 90.3px apart: under 39pt even on the
  // largest phone.
  for (const width of Object.values(WIDTHS)) {
    assert.ok((90.3 * width) / REFERENCE_WIDTH < ROW_MIN_HEIGHT, `${width}pt`);
  }
  // At the default size the six rows, the search action and the heading
  // need more than the exported paper holds, on every phone: the receipt
  // grows, and more at a larger text size.
  let previous = 0;
  for (const scale of STANDARD) {
    const content = receiptContentHeight(scale);
    for (const width of Object.values(WIDTHS)) {
      const growth = paperGrowth(content, sceneScale(illustrationWidth(width)));
      if (scale >= TEXT_SIZES.large) assert.ok(growth > 0, `${width}pt at ${scale}`);
    }
    assert.ok(content >= previous, 'the content shrank as the text grew');
    previous = content;
  }
  // iPhone 17 at the default size: about 45pt of growth (the demonstration's
  // +120 source px was 52pt).
  const growth = paperGrowth(receiptContentHeight(1), sceneScale(402));
  assert.ok(growth > 40 && growth < 52, `${growth}`);
});

test('every target on the receipt is at least 44pt, and none overlaps another', () => {
  assert.equal(ROW_MIN_HEIGHT, 44);
  // Clear is one count line tall; hitSlop reaches 44pt, and the gap below
  // the count row is wider than that slop, so it never meets the first row.
  const clearSlop = Math.ceil((44 - STORES_TYPE.count.lineHeight) / 2);
  assert.ok(COUNT_GAP > clearSlop, `${COUNT_GAP} <= ${clearSlop}`);
  // Rows are laid one after another (a 1pt rule between), with no slop.
  for (const scale of [...STANDARD, ...ACCESSIBILITY]) {
    assert.ok(receiptContentHeight(scale) >= 7 * ROW_MIN_HEIGHT);
  }
});

test('beside the mascot at the standard sizes, stacked from the accessibility sizes', () => {
  for (const scale of STANDARD) assert.equal(receiptLayout(scale), 'scene', `${scale}`);
  for (const scale of [ACCESSIBILITY_SCALE, ...ACCESSIBILITY])
    assert.equal(receiptLayout(scale), 'stacked', `${scale}`);
  // Adaptive bases, not caps: the tokens at the accessibility sizes.
  assert.deepEqual(headlineType(1), STORES_TYPE.headline);
  assert.deepEqual(headlineType(TEXT_SIZES.ax1), { fontSize: 23, lineHeight: 30 });
  assert.deepEqual(receiptHeadingType(1), STORES_TYPE.heading);
  assert.deepEqual(receiptHeadingType(TEXT_SIZES.ax1), { fontSize: 19, lineHeight: 26 });
});

test('every printed word fits its column, measured from the bundled Public Sans', async () => {
  const { GlobalFonts, createCanvas } = await import('@napi-rs/canvas');
  const fonts = join(__dirname, '..', '..', 'node_modules/@expo-google-fonts/public-sans');
  for (const [face, file] of [
    ['StoresRegular', '400Regular/PublicSans_400Regular.ttf'],
    ['StoresMedium', '500Medium/PublicSans_500Medium.ttf'],
    ['StoresBold', '700Bold/PublicSans_700Bold.ttf'],
  ] as const) {
    assert.ok(GlobalFonts.registerFromPath(join(fonts, file), face));
  }
  const context = createCanvas(8, 8).getContext('2d');
  const widest = (words: string[], face: string, size: number) =>
    Math.max(
      ...words.map((word) => {
        context.font = `${size}px ${face}`;
        return context.measureText(word).width;
      }),
    );
  const names = ['Walmart', 'Costco', 'Kroger', 'Aldi', 'Target', 'Trader', "Joe's"];
  const check = ROW_CHROME.check + ROW_CHROME.gap + ROW_CHROME.padding * 2;
  const words = (scale: number) => ({
    // A name word beside the checkbox, the search word beside the magnifier,
    // and a heading word alone on its line.
    name: widest(names, 'StoresRegular', STORES_TYPE.name.fontSize) * scale + check,
    search:
      widest(['Search', 'stores'], 'StoresMedium', STORES_TYPE.search.fontSize) * scale + check,
    heading:
      widest(['Popular', 'stores'], 'StoresBold', receiptHeadingType(scale).fontSize) * scale,
  });
  for (const width of Object.values(WIDTHS)) {
    const beside = receiptColumn(sceneScale(illustrationWidth(width)), CONTENT_INSET_PX);
    for (const scale of STANDARD) {
      for (const [what, need] of Object.entries(words(scale)))
        assert.ok(need + 1 <= beside, `${what} at ${scale} on ${width}pt: ${need} > ${beside}`);
    }
    const stacked = receiptColumn(stackedPaperScale(width), STACKED_INSET_PX);
    for (const scale of ACCESSIBILITY) {
      for (const [what, need] of Object.entries(words(scale)))
        assert.ok(need + 1 <= stacked, `${what} at ${scale} on ${width}pt: ${need} > ${stacked}`);
    }
  }
  // The headline keeps `regulars.` whole at the default size everywhere, and
  // at every accessibility size on the iPhone 17. On the 375pt SE at AX5 its
  // final period wraps alone (an intrinsic limit, reported, not hidden).
  const page = (width: number) => width - 32;
  const regulars = (scale: number) =>
    widest(['regulars.'], 'StoresBold', headlineType(scale).fontSize) * scale;
  for (const width of Object.values(WIDTHS)) assert.ok(regulars(1) <= page(width));
  for (const scale of ACCESSIBILITY)
    assert.ok(regulars(scale) <= page(WIDTHS.iPhone17), `${scale}`);
  assert.ok(regulars(TEXT_SIZES.ax4) <= page(WIDTHS.iPhoneSE));
  assert.ok(
    regulars(TEXT_SIZES.ax5) > page(WIDTHS.iPhoneSE),
    'the SE AX5 limit is gone: update the docs',
  );
  // The body breaks where the target does: after `your`.
  context.font = `${STORES_TYPE.body.fontSize}px StoresRegular`;
  assert.ok(context.measureText('Choose the stores where your').width < 290);
  assert.ok(context.measureText('Choose the stores where your household').width > 290);
});
