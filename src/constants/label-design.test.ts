/**
 * The risk and harm label kit (2026-10-09), pinned: the approved shape and
 * type, one shape for every risk badge, each label routed to its OWN palette,
 * the harm glyph mapping and its provenance, and the wrapping that keeps a
 * long count readable at the largest text sizes.
 *
 * What a label SAYS is not here: the words, counts, pluralization and
 * suppression are the presentation contracts' (`risk-display.test.ts`,
 * `illness-status*.test.ts`), which this milestone did not touch.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { feedGeometry, feedType } from './feed-design';
import {
  HARM_GLYPH,
  HARM_LINE_HEIGHT,
  LABEL_GLYPH_SOURCE,
  labelGeometry,
  labelType,
  NOTICE_GLYPH,
} from './label-design';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, 'src', ...parts), 'utf8');

const RISK_LABEL = read('components', 'ui', 'risk-label.tsx');
const NOTICE_LABEL = read('components', 'ui', 'notice-label.tsx');
const HARM_NOTICE = read('components', 'ui', 'illness-notice.tsx');
const RELEVANCE_LABEL = read('components', 'ui', 'relevance-label.tsx');
const FEED_LABELS = read('components', 'feed', 'feed-labels.tsx');
const ICON = read('components', 'ui', 'icon.tsx');

/** A PNG's IHDR width. */
function pngWidth(path: string): number {
  return readFileSync(path).readUInt32BE(16);
}

test('the label shape and type are the approved kit values', () => {
  assert.deepEqual(
    {
      radius: labelGeometry.radius,
      minHeight: labelGeometry.minHeight,
      paddingX: labelGeometry.paddingX,
      paddingY: labelGeometry.paddingY,
      iconSide: labelGeometry.iconSide,
      iconGap: labelGeometry.iconGap,
      rowGap: labelGeometry.rowGap,
      harmBorderWidth: labelGeometry.harmBorderWidth,
      noticeBorderWidth: labelGeometry.noticeBorderWidth,
    },
    {
      radius: 5,
      minHeight: 28,
      paddingX: 8,
      paddingY: 6,
      iconSide: 16,
      iconGap: 6,
      rowGap: 8,
      harmBorderWidth: 0,
      noticeBorderWidth: 1,
    },
  );
  assert.deepEqual(labelType.badge, {
    fontFamily: 'PublicSans_700Bold',
    fontSize: 12,
    lineHeight: 16,
  });
  assert.deepEqual(labelType.harm, {
    fontFamily: 'PublicSans_600SemiBold',
    fontSize: 13,
    lineHeight: HARM_LINE_HEIGHT,
  });
  assert.equal(HARM_LINE_HEIGHT, 18);
});

test('a risk badge is the Feed card badge shape, so it lines up with Affects You and the category', () => {
  assert.equal(labelGeometry.radius, feedGeometry.badgeRadius);
  assert.equal(labelGeometry.minHeight, feedGeometry.badgeMinHeight);
  assert.equal(labelGeometry.paddingX, feedGeometry.badgePaddingX);
  assert.equal(labelGeometry.paddingY, feedGeometry.badgePaddingY);
  assert.equal(labelGeometry.iconSide, feedGeometry.badgeIconSide);
  assert.deepEqual(labelType.badge, feedType.badge);
  // The Feed card and Saved render risk and the PHA label through the SAME
  // components as Detail and Ready — one drawing, not two that agree.
  assert.match(FEED_LABELS, /return <RiskLabel tier=\{tier\} label=\{label\}/);
  assert.match(FEED_LABELS, /return <NoticeLabel label=\{label\} \/>/);
  assert.ok(!/\briskPalette\b/.test(FEED_LABELS));
});

test('each label reads its OWN palette: risk, notice type, harm — never another’s', () => {
  assert.ok(RISK_LABEL.includes('const palette = riskPalette[tier];'));
  assert.ok(NOTICE_LABEL.includes("const palette = noticeTypePalette['public-health-alert'];"));
  assert.ok(HARM_NOTICE.includes('const palette = harmNoticePalette[notice.tone];'));
  for (const [name, source, forbidden] of [
    ['risk label', RISK_LABEL, ['harmNoticePalette', 'noticeTypePalette', 'relevancePalette']],
    ['notice label', NOTICE_LABEL, ['riskPalette', 'harmNoticePalette', 'relevancePalette']],
    ['harm notice', HARM_NOTICE, ['riskPalette', 'noticeTypePalette', 'relevancePalette']],
  ] as const) {
    for (const palette of forbidden) {
      assert.ok(!source.includes(palette), `${name} reads ${palette}`);
    }
  }
  // Affects You keeps its own component, palette and label-kit-free drawing.
  assert.ok(RELEVANCE_LABEL.includes("relevancePalette['affects-you']"));
  assert.ok(!RELEVANCE_LABEL.includes('label-design'));
});

test('each harm has its own glyph, and the PHA label the info glyph', () => {
  assert.deepEqual(HARM_GLYPH, {
    none: 'label-info',
    illnesses: 'label-triangle-alert',
    hospitalizations: 'label-square-plus',
    deaths: 'label-circle-alert',
  });
  assert.equal(NOTICE_GLYPH, 'label-info');
  assert.ok(HARM_NOTICE.includes('name={HARM_GLYPH[notice.tone]}'));
  assert.ok(NOTICE_LABEL.includes('name={NOTICE_GLYPH}'));
  // The glyph is drawn at 16pt in the box's own ink, never a semantic colour.
  for (const source of [HARM_NOTICE, NOTICE_LABEL]) {
    assert.ok(source.includes('points={labelGeometry.iconSide}'));
    assert.ok(source.includes('tint={palette.foreground}'));
  }
});

test('every label glyph is a registered, pinned lucide-static 0.468.0 raster rendered per scale', () => {
  for (const [name, lucide] of Object.entries(LABEL_GLYPH_SOURCE)) {
    assert.ok(
      ICON.includes(`'${name}': require('@/assets/icons/${name}.png')`),
      `${name} is registered`,
    );
    const svg = readFileSync(
      join(ROOT, 'assets', 'icon-sources', 'lucide-static', `${lucide}.svg`),
      'utf8',
    );
    assert.ok(svg.includes('@license lucide-static v0.468.0 - ISC'), `${lucide} source pinned`);
    assert.ok(svg.includes(`lucide-${lucide}"`), `${lucide} source is that glyph`);
    const files = ['', '@2x', '@3x'].map((s) => join(ROOT, 'assets', 'icons', `${name}${s}.png`));
    files.forEach((file, i) => {
      assert.ok(existsSync(file), file);
      assert.equal(pngWidth(file), 24 * (i + 1), `${file} is its own scale`);
    });
    // Each scale is its own render, never the 1x enlarged: three distinct files.
    const hashes = files.map((f) => createHash('sha256').update(readFileSync(f)).digest('hex'));
    assert.equal(new Set(hashes).size, 3, `${name} scales are not distinct renders`);
  }
  // The callouts' heavier info/warning exports are not replaced.
  assert.ok(ICON.includes("info: require('@/assets/icons/info.png')"));
  assert.ok(ICON.includes("warning: require('@/assets/icons/warning.png')"));
});

test('labels wrap and grow at every text size: no cap, no fixed size, no truncation', () => {
  for (const [name, source] of [
    ['risk label', RISK_LABEL],
    ['notice label', NOTICE_LABEL],
    ['harm notice', HARM_NOTICE],
  ] as const) {
    assert.ok(!/maxFontSizeMultiplier|allowFontScaling/.test(source), `${name} caps type`);
    assert.ok(!/numberOfLines/.test(source), `${name} truncates`);
    assert.ok(!/\b(width|height): \d/.test(source), `${name} fixes a size`);
    assert.ok(source.includes('minHeight: labelGeometry.minHeight'), `${name} 28pt floor`);
    // The text shrinks (wraps) inside the label; the label shrinks inside its row.
    assert.match(source, /text: \{\s*flexShrink: 1,\s*\}/, `${name} text wraps`);
    // A display badge is never a control.
    assert.ok(!/onPress|accessibilityRole="button"|Pressable/.test(source), `${name} is a control`);
    assert.ok(source.includes('accessibilityRole="text"'));
  }
  // The harm glyph never shrinks; its box tracks the reader's text scale.
  assert.match(HARM_NOTICE, /glyph: \{\s*flexShrink: 0,/);
  assert.ok(HARM_NOTICE.includes('minHeight: HARM_LINE_HEIGHT * fontScale'));
  // Spoken text is the contract's own: the harm sentence and the PHA words.
  assert.ok(HARM_NOTICE.includes('accessibilityLabel={notice.spoken}'));
  assert.ok(HARM_NOTICE.includes('{notice.text}'));
  assert.ok(NOTICE_LABEL.includes('accessibilityLabel={label}'));
});
