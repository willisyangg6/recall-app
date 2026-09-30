/**
 * The problem screens' presentation rules: the approved compositions'
 * deterministic sizes, the SE and accessibility classes, and the fit
 * arithmetic that keeps both screens unscrolled at default text size on
 * the smallest supported phone.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

import { fontFace, typography } from '@/constants/design-tokens';
import { PROBLEM_RISK_GROUPS } from '@/lib/onboarding-copy';
import {
  PROBLEM_ACCESSIBLE_AT_SCALE,
  PROBLEM_COMPACT_BELOW_HEIGHT,
  PROBLEM_RISK_GROUP_IDS,
  PROBLEM_RISK_GROUP_ROWS,
  RISK_ART_BOTTOM,
  RISK_ART_TOP,
  RISK_LABEL_FIT_MARGIN,
  RISK_LABEL_VARIANT,
  RISK_LABEL_WIDEST,
  RISK_LABEL_WIDEST_WORD,
  RISK_LIST_TOP,
  RISK_ROW_ART_ACCESSIBLE_MIN,
  RISK_ROW_ART_GAP,
  RISK_ROW_ART_MIN,
  RISK_SEPARATOR,
  SCALE_PICTOGRAPH_ACCESSIBLE,
  SCALE_PICTOGRAPH_COMPACT,
  SCALE_PICTOGRAPH_MAX,
  problemLayout,
  riskArtTrim,
  riskArtVisibleHeight,
  riskListBudget,
  riskListHeight,
  riskRowHasSeparator,
  riskRowLayout,
  scalePictographSize,
} from '@/lib/problem-presentation';
import { INLINE_FOOTER_AT_SCALE } from '@/lib/paywall-screen';

/** The two verification devices' windows and content widths (16pt margins). */
const IPHONE_17 = { width: 393, height: 852, contentWidth: 361 };
const IPHONE_SE = { width: 375, height: 667, contentWidth: 343 };

/**
 * The risk rows' verification windows, as the simulators report them
 * (2026-09-29): the iPhone 17 is 402×874 with 62/34pt safe-area insets, the
 * SE 3rd generation 375×667 with 20/0.
 */
const RISK_17 = { contentWidth: 370, windowHeight: 874, insetTop: 62, insetBottom: 34 };
const RISK_SE = { contentWidth: 343, windowHeight: 667, insetTop: 20, insetBottom: 0 };
/** React Native's iOS font scales: default, XXXL, AX1–AX5. */
const XXXL = 1.353;
const AX = [1.786, 2.143, 2.643, 3.143, 3.571];

test('the accessible layout begins at the first accessibility text-size class, the shared threshold', () => {
  // iOS's largest non-AX class is ≈1.35 and AX1 is ≈1.64; 1.5 splits them,
  // and it is the SAME threshold the paywall footer already uses.
  assert.equal(PROBLEM_ACCESSIBLE_AT_SCALE, INLINE_FOOTER_AT_SCALE);
  assert.equal(problemLayout(1), 'standard');
  assert.equal(problemLayout(1.35), 'standard');
  assert.equal(problemLayout(1.5), 'accessible');
  assert.equal(problemLayout(3.12), 'accessible');
});

test('the pictograph canvas: taller phones, the SE class, and the accessible class', () => {
  // One authored square canvas, whole, never wider than the page.
  assert.equal(SCALE_PICTOGRAPH_MAX, 320);
  assert.equal(SCALE_PICTOGRAPH_COMPACT, 216);
  assert.equal(SCALE_PICTOGRAPH_ACCESSIBLE, 220);
  assert.equal(scalePictographSize(IPHONE_17.contentWidth, IPHONE_17.height, 1), 320);
  assert.equal(scalePictographSize(IPHONE_SE.contentWidth, IPHONE_SE.height, 1), 216);
  // The class boundary is the window height, not the device name.
  assert.equal(PROBLEM_COMPACT_BELOW_HEIGHT, 700);
  assert.equal(scalePictographSize(361, 699, 1), 216);
  assert.equal(scalePictographSize(361, 700, 1), 320);
  // Accessible: the whole composition stays visible beside uncapped text.
  assert.equal(scalePictographSize(IPHONE_17.contentWidth, IPHONE_17.height, 1.64), 220);
  // A narrow window binds before every cap.
  assert.equal(scalePictographSize(200, 852, 1), 200);
});

test('Problem Scale fits the SE window unscrolled at default text size', () => {
  // The SE's 667pt window, decomposed with the frame's own constants: top
  // inset 20 + top bar (8 + 44) + progress row (6 + 8) = 86; footer 12 +
  // 44 + 12 = 68; content padding 8 + 24 = 32. The copy heights are the
  // 2026-09-28 device measurements at 343pt wide: scale headline 2 lines
  // (68) + gap 8 + body 1 line (24). Stat 62; source 18; block gaps 16 each.
  const contentArea = 667 - 86 - 68 - 32;
  const canvas = scalePictographSize(IPHONE_SE.contentWidth, IPHONE_SE.height, 1);
  const scaleBlocks = 62 + 16 + (68 + 8 + 24) + 16 + canvas + 16 + 18;
  assert.ok(scaleBlocks <= contentArea, `problem-scale needs ${scaleBlocks} of ${contentArea}pt`);
});

/** Measures `text` in a typography token with the vendored font file itself. */
function measure(text: string, variant: keyof typeof typography, scale = 1): number {
  const token = typography[variant];
  const face = fontFace[token.face];
  const weight = face.replace('PublicSans_', '');
  GlobalFonts.registerFromPath(
    join(
      __dirname,
      '..',
      '..',
      'node_modules',
      '@expo-google-fonts',
      'public-sans',
      weight,
      `${face}.ttf`,
    ),
    face,
  );
  const context = createCanvas(8, 8).getContext('2d');
  context.font = `${token.fontSize * scale}px ${face}`;
  return context.measureText(text).width;
}

test('the risk labels are live heading-3 text, and the recorded widths are the real ones', () => {
  // The closest bold reading-size token to the target's labels (≈17pt
  // semibold): heading-3, Public Sans SemiBold 19. The widest label and the
  // widest word, re-measured here so the one-line contract cannot drift.
  assert.equal(RISK_LABEL_VARIANT, 'heading-3');
  const widths = PROBLEM_RISK_GROUP_ROWS.map(({ label }) => measure(label, RISK_LABEL_VARIANT));
  assert.ok(Math.abs(Math.max(...widths) - RISK_LABEL_WIDEST) < 0.1, `widest ${widths}`);
  const words = PROBLEM_RISK_GROUP_ROWS.flatMap(({ label }) => label.split(' '));
  const widestWord = Math.max(...words.map((word) => measure(word, RISK_LABEL_VARIANT)));
  assert.ok(Math.abs(widestWord - RISK_LABEL_WIDEST_WORD) < 0.1, `widest word ${widestWord}`);
});

test('the illustration overlaps only its own transparent bands, never its solid artwork', () => {
  // 176 and 869 of 1024: the highest and lowest solid rows across the four
  // production files (pinned against the files by statistics-assets.test).
  assert.equal(RISK_ART_TOP, 176 / 1024);
  assert.equal(RISK_ART_BOTTOM, 869 / 1024);
  for (const size of [56, 60, 64, 78, 88, 105, 112]) {
    const trim = riskArtTrim(size);
    assert.ok(trim.top <= size * RISK_ART_TOP, `${size}: the top trim reaches the artwork`);
    assert.ok(trim.bottom <= size * (1 - RISK_ART_BOTTOM), `${size}: the bottom trim does`);
    assert.equal(riskArtVisibleHeight(size), size - trim.top - trim.bottom);
  }
  assert.deepEqual(riskArtTrim(105), { top: 18, bottom: 15 });
  assert.deepEqual(riskArtTrim(78), { top: 13, bottom: 11 });
});

test('default size: the largest one-line illustration, the roomiest padding, on both phones', () => {
  const on17 = riskRowLayout({ ...RISK_17, fontScale: 1 });
  const onSE = riskRowLayout({ ...RISK_SE, fontScale: 1 });
  assert.deepEqual(on17, {
    art: 105,
    trimTop: 18,
    trimBottom: 15,
    padding: 12,
    arrangement: 'beside',
  });
  assert.deepEqual(onSE, {
    art: 78,
    trimTop: 13,
    trimBottom: 11,
    padding: 8,
    arrangement: 'beside',
  });
  for (const [device, rows] of [
    [RISK_17, on17],
    [RISK_SE, onSE],
  ] as const) {
    // Every label, the widest included, has one line of room beside the art.
    const labelColumn = device.contentWidth - rows.art - RISK_ROW_ART_GAP;
    assert.ok(labelColumn >= RISK_LABEL_WIDEST + RISK_LABEL_FIT_MARGIN, `${labelColumn}pt`);
    // One more point of illustration would push the widest label to two lines.
    assert.ok(
      device.contentWidth - (rows.art + 1) - RISK_ROW_ART_GAP <
        Math.ceil(RISK_LABEL_WIDEST) + RISK_LABEL_FIT_MARGIN + 1,
    );
  }
});

test('default size: four rows, three separators and Source fit above the footer on both phones', () => {
  // The budget, decomposed: the window less the insets, the frame's chrome
  // (66 above, 69 in the footer, 32 of content padding), the two-line
  // heading and body (124, measured on both phones), 16 + 8 above the list,
  // 16 below it and the 18pt source line.
  assert.equal(riskListBudget({ ...RISK_17, fontScale: 1 }), 874 - 62 - 34 - 167 - 124 - 58);
  assert.equal(riskListBudget({ ...RISK_SE, fontScale: 1 }), 667 - 20 - 0 - 167 - 124 - 58);
  const on17 = riskRowLayout({ ...RISK_17, fontScale: 1 });
  const onSE = riskRowLayout({ ...RISK_SE, fontScale: 1 });
  // Row = visible art + 2 × padding; four rows + three 1pt hairlines.
  assert.equal(riskListHeight(on17.art, on17.padding), 4 * (72 + 24) + 3 * RISK_SEPARATOR);
  assert.equal(riskListHeight(onSE.art, onSE.padding), 4 * (54 + 16) + 3 * RISK_SEPARATOR);
  assert.ok(riskListHeight(on17.art, on17.padding) <= riskListBudget({ ...RISK_17, fontScale: 1 }));
  assert.ok(riskListHeight(onSE.art, onSE.padding) <= riskListBudget({ ...RISK_SE, fontScale: 1 }));
  // The SE could not also take the roomier padding: that is why it is tighter.
  assert.ok(riskListHeight(onSE.art, 12) > riskListBudget({ ...RISK_SE, fontScale: 1 }));
  // The list starts 24pt below the body (frame gap 16 + 8), the leftover
  // space falling below the last row rather than above the first.
  assert.equal(RISK_LIST_TOP + 16, 24);
});

test('a shorter window shrinks the illustration toward its floor, never below it', () => {
  // 640pt: the default padding cannot hold 78pt art, so the art shrinks to fit.
  const short = { ...RISK_SE, windowHeight: 640, fontScale: 1 };
  const rows = riskRowLayout(short);
  assert.ok(rows.art < 78 && rows.art > RISK_ROW_ART_MIN, `${rows.art}`);
  assert.ok(riskListHeight(rows.art, rows.padding) <= riskListBudget(short));
  assert.ok(riskListHeight(rows.art + 1, rows.padding) > riskListBudget(short), 'not the largest');
  // Where even the floor cannot fit, the floor holds and the content scrolls.
  assert.equal(
    riskRowLayout({ ...RISK_SE, windowHeight: 400, fontScale: 1 }).art,
    RISK_ROW_ART_MIN,
  );
});

test('larger text keeps the default-size illustration and scrolls; labels wrap between words', () => {
  for (const device of [RISK_17, RISK_SE]) {
    const atDefault = riskRowLayout({ ...device, fontScale: 1 });
    const atXXXL = riskRowLayout({ ...device, fontScale: XXXL });
    assert.equal(atXXXL.art, atDefault.art, 'the illustration shrank because text grew');
    assert.equal(atXXXL.arrangement, 'beside');
    // The widest word always fits the label column beside the illustration.
    const labelColumn = device.contentWidth - atXXXL.art - RISK_ROW_ART_GAP;
    assert.ok(labelColumn >= RISK_LABEL_WIDEST_WORD * XXXL + RISK_LABEL_FIT_MARGIN);
  }
});

test('accessibility sizes: rows keep the illustration beside the label while the longest word fits', () => {
  for (const device of [RISK_17, RISK_SE]) {
    for (const scale of AX) {
      const rows = riskRowLayout({ ...device, fontScale: scale });
      const word = Math.ceil(RISK_LABEL_WIDEST_WORD * scale) + RISK_LABEL_FIT_MARGIN;
      if (rows.arrangement === 'beside') {
        assert.ok(rows.art >= RISK_ROW_ART_ACCESSIBLE_MIN);
        assert.ok(
          device.contentWidth - rows.art - RISK_ROW_ART_GAP >= word,
          `${scale}: mid-word break`,
        );
      } else {
        // Only where no illustration of the accessible minimum could sit
        // beside the word: the illustration moves above, the row grows.
        assert.ok(device.contentWidth - RISK_ROW_ART_ACCESSIBLE_MIN - RISK_ROW_ART_GAP < word);
        assert.ok(word <= device.contentWidth, `${scale}: the word is wider than the page`);
      }
    }
  }
  // The measured outcome on the verification phones.
  const arrangement = (device: typeof RISK_SE) =>
    AX.map((scale) => riskRowLayout({ ...device, fontScale: scale }).arrangement);
  assert.deepEqual(arrangement(RISK_SE), ['beside', 'beside', 'beside', 'above', 'above']);
  assert.deepEqual(arrangement(RISK_17), ['beside', 'beside', 'beside', 'beside', 'above']);
  assert.equal(riskRowLayout({ ...RISK_17, fontScale: 3.143 }).art, 60);
});

test('hairlines fall only between rows', () => {
  assert.deepEqual(
    PROBLEM_RISK_GROUP_IDS.map((_, index) => riskRowHasSeparator(index)),
    [true, true, true, false],
  );
  assert.equal(RISK_SEPARATOR, 1);
});

test('the four groups pair the semantic ids with the founder’s exact labels, in order', () => {
  assert.deepEqual(PROBLEM_RISK_GROUP_IDS, [
    'young-children',
    'pregnant-people',
    'adults-65-plus',
    'weakened-immune-systems',
  ]);
  assert.deepEqual(
    PROBLEM_RISK_GROUP_ROWS.map((row) => row.id),
    [...PROBLEM_RISK_GROUP_IDS],
  );
  assert.deepEqual(
    PROBLEM_RISK_GROUP_ROWS.map((row) => row.label),
    [...PROBLEM_RISK_GROUPS],
  );
  assert.equal(PROBLEM_RISK_GROUP_ROWS.length, 4);
});
