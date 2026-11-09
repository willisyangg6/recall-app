/**
 * The Fridge Note paywall's presentation contract (2026-11-06; the shorter
 * letter of revision 2, 2026-11-07): the founder's copy exactly as approved,
 * the measured type,
 * the stationery's three-band stretch and the letter's placement on it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { typography } from '@/constants/design-tokens';

import {
  atAccessibilitySize,
  BACKDROP_BANDS,
  BACKDROP_WIDTH_RATIO,
  backdropSlices,
  benefitSpacing,
  headlineType,
  LETTER_CLOSING,
  LETTER_EMPHASIS_PARAGRAPH,
  LETTER_INSETS,
  LETTER_OPENING,
  MIN_MIDDLE_FRACTION,
  letterLeftInset,
  ONBOARDING_PAYWALL_BENEFITS,
  ONBOARDING_PAYWALL_HEADLINE,
  PAYWALL_TYPE,
  SPARE_SPACING,
  STANDALONE_BENEFIT_LIFT,
  SIGNATURE,
  SIGNATURE_ACCESSIBILITY_LABEL,
  stageOverlap,
  underlinePath,
} from './onboarding-paywall-presentation';

/**
 * The founder's approved letter (revision 2, 2026-11-07): three paragraphs,
 * no greeting, no thank-you, then the signature alone.
 */
const KIT_COPY = {
  screenTitle: 'A note from me.',
  paragraphs: [
    'Life is busy. Keeping up with food recalls shouldn’t be another thing on your plate.',
    'I built Lotly to make staying informed easier, so you can make safer choices for yourself and the people you love.',
    'Your one-time purchase gives you lifetime access and helps me keep Lotly running as a solo founder.',
  ],
  signatureAccessibilityLabel: 'Willis',
  benefits: [
    ['file-search', 'Know what may affect you', 'Official FDA & USDA notices, personalized.'],
    ['bell', 'Let the alerts come to you', 'Matching recalls and important updates.'],
  ],
};

test('the founder’s copy, verbatim from the kit', () => {
  assert.equal(ONBOARDING_PAYWALL_HEADLINE, KIT_COPY.screenTitle);
  assert.deepEqual(
    [
      LETTER_OPENING,
      LETTER_EMPHASIS_PARAGRAPH.lead + LETTER_EMPHASIS_PARAGRAPH.emphasis,
      LETTER_CLOSING,
    ],
    KIT_COPY.paragraphs,
  );
  // The emphasis is the paragraph's end, which is what lets the stroke be
  // placed from the last line's layout.
  assert.equal(LETTER_EMPHASIS_PARAGRAPH.emphasis, 'people you love.');
  // No em dash anywhere in the letter any more.
  for (const paragraph of KIT_COPY.paragraphs) assert.ok(!paragraph.includes('—'));
  assert.equal(SIGNATURE_ACCESSIBILITY_LABEL, KIT_COPY.signatureAccessibilityLabel);
  assert.deepEqual(
    ONBOARDING_PAYWALL_BENEFITS.map(({ icon, title, body }) => [icon, title, body]),
    KIT_COPY.benefits,
  );
});

test('the only sign-off is the handwritten signature: no printed name, subtitle or heart', () => {
  const panel = readFileSync(
    join(__dirname, '..', 'components', 'paywall', 'onboarding-paywall-panel.tsx'),
    'utf8',
  );
  assert.ok(panel.includes("require('@/assets/paywall/fridge-note/willis-signature.png')"));
  for (const forbidden of ['— Willis', 'heart', '❤', 'Founder', 'founder of']) {
    assert.ok(!panel.includes(forbidden), forbidden);
  }
  // The signature's box draws the target's 110pt of ink at its own aspect.
  assert.ok(Math.abs(SIGNATURE.aspectRatio - 2164 / 727) < 1e-9);
  assert.ok(Math.abs(SIGNATURE.width * 0.873 - 110) < 1);
});

test('the headline: 30pt Bold on 36pt at ordinary sizes, the heading-1 base from the accessibility sizes', () => {
  assert.deepEqual(headlineType(1), { fontSize: 30, lineHeight: 36 });
  assert.deepEqual(headlineType(1.35), { fontSize: 30, lineHeight: 36 });
  assert.deepEqual(headlineType(1.5), {
    fontSize: typography['heading-1'].fontSize,
    lineHeight: typography['heading-1'].lineHeight,
  });
  assert.equal(atAccessibilitySize(1.49), false);
  assert.equal(atAccessibilitySize(1.5), true);
  // The art's top edge sits 3pt below the headline's baseline: the block's
  // descent (0.225 × size, growing with the text) less 3.
  assert.ok(Math.abs(stageOverlap(1) - (0.225 * 30 - 3)) < 1e-9);
  assert.ok(stageOverlap(1.3) > stageOverlap(1));
});

test('nothing on the screen is smaller than the shared scale’s floor', () => {
  for (const [name, type] of Object.entries(PAYWALL_TYPE)) {
    assert.ok(type.fontSize >= typography['body-small'].fontSize, name);
    assert.ok(type.lineHeight >= type.fontSize, name);
  }
  assert.deepEqual(PAYWALL_TYPE.letter, { fontSize: 14, lineHeight: 17.8 });
});

test('only the stationery’s blank middle stretches or shortens; the mascot and curl keep the art’s own scale', () => {
  assert.ok(Math.abs(BACKDROP_WIDTH_RATIO - 863 / 851) < 1e-9);
  assert.deepEqual(BACKDROP_BANDS, { top: 0.32, bottom: 0.76 });
  const width = 408;
  // A short letter shortens the paper to fit it (revision 2), but the middle
  // band is never squashed below half its source height.
  const fitted = backdropSlices(width, 330);
  assert.equal(fitted.height, 330);
  assert.equal(fitted.slices[0].imageHeight, width);
  assert.equal(fitted.slices[2].imageHeight, width);
  assert.ok(fitted.slices[1].imageHeight < width, 'the middle band shortens');
  assert.equal(MIN_MIDDLE_FRACTION, 0.5);
  const floor = width * 0.56 + 0.5 * width * 0.44;
  assert.ok(Math.abs(backdropSlices(width, 100).height - floor) < 1e-9);
  assert.ok(Math.abs(backdropSlices(width, 100).slices[1].imageHeight - width * 0.5) < 1e-9);
  // A taller letter stretches the middle band alone.
  const tall = backdropSlices(width, 700);
  const [top, middle, bottom] = tall.slices;
  assert.equal(tall.height, 700);
  assert.equal(top.imageHeight, width);
  assert.equal(top.height, width * 0.32);
  assert.equal(bottom.imageHeight, width);
  assert.ok(Math.abs(bottom.height - width * 0.24) < 1e-9);
  assert.ok(Math.abs(bottom.offset + bottom.height - 700) < 1e-9);
  // The bands meet with no gap and no overlap.
  assert.ok(Math.abs(middle.offset - (top.offset + top.height)) < 1e-9);
  assert.ok(Math.abs(bottom.offset - (middle.offset + middle.height)) < 1e-9);
  // The middle clip shows exactly the source's middle band, drawn taller:
  // the source's 32% line lands on the clip's top edge, its 76% on its bottom.
  const stretch = middle.imageHeight / width;
  assert.ok(Math.abs(middle.imageTop + 0.32 * width * stretch) < 1e-9);
  assert.ok(Math.abs(middle.imageTop + 0.76 * width * stretch - middle.height) < 1e-6);
  // The bottom clip shows the source's last 24% at its own scale.
  assert.ok(Math.abs(bottom.imageTop + 0.76 * width) < 1e-9);
});

test('the letter sits below the mascot and magnet and clear of the curl, widening only at large sizes', () => {
  assert.equal(LETTER_INSETS.left, 0.165);
  assert.equal(LETTER_INSETS.right, 0.08);
  assert.equal(letterLeftInset(1), 0.165);
  assert.equal(letterLeftInset(1.49), 0.165);
  assert.equal(letterLeftInset(1.5), 0.13);
  // The greeting starts below the magnet's band and the signature ends above
  // the curl, both measured as fractions of the art's width.
  assert.ok(LETTER_INSETS.top > 0.19, 'the magnet ends at 19% of the art');
  assert.equal(LETTER_INSETS.top, 0.255, 'the first line clears the mascot’s leg');
  assert.ok(LETTER_INSETS.bottom > 0.05 && LETTER_INSETS.bottom < 0.24);
});

test('the underline is the kit’s curve, scaled to the measured phrase', () => {
  assert.equal(underlinePath(176), 'M3 4.67 Q84 -0.78 173 3.89');
  // It spans the phrase whatever its width; never a fixed length.
  assert.match(underlinePath(110), /^M1\.87 .* 108\.13 3\.89$/);
});

test('spare height goes around the benefits only at the default size and only when there is room', () => {
  // No spare, or larger text: compact.
  assert.deepEqual(benefitSpacing(0, 1), { top: 0, between: 0, lift: 0 });
  assert.deepEqual(benefitSpacing(8, 1), { top: 0, between: 0, lift: 0 });
  assert.deepEqual(benefitSpacing(90, 1.12), { top: 0, between: 0, lift: 0 });
  // Room to spare: a quarter between (capped at 12), the rest above (capped at 44).
  assert.deepEqual(benefitSpacing(48, 1), { top: 30, between: 10, lift: 0 });
  assert.deepEqual(benefitSpacing(90, 1), { top: 44, between: 12, lift: 0 });
  assert.equal(SPARE_SPACING.below, 8);
  // Lift: when the page fits, moved from the bottom padding to the top gap;
  // never when it scrolls (spare < 0) or at larger text.
  assert.deepEqual(benefitSpacing(5, 1, 14), { top: 14, between: 0, lift: 14 });
  assert.deepEqual(benefitSpacing(-1, 1, 14), { top: 0, between: 0, lift: 0 });
  assert.deepEqual(benefitSpacing(5, 1.12, 14), { top: 0, between: 0, lift: 0 });
  assert.equal(STANDALONE_BENEFIT_LIFT, 14);
});
