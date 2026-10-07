/**
 * The Feed + Filters design tokens (2026-10-06): the category map covers
 * exactly the launch categories, every pair meets 4.5:1, the Critical
 * override is the card's alone, and every new glyph has its pinned source,
 * its license and three directly rendered scales.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { LAUNCH_CATEGORY_IDS } from '@/domain/food-category-launch';
import { riskPalette } from './design-tokens';
import {
  CARD_STACK_SCALE,
  CATEGORY_STYLE,
  cardStacks,
  categoryStyle,
  FEED_ICON_FAMILY,
  FEED_INTERFACE_GLYPHS,
  feedColor,
  feedRiskPalette,
} from './feed-design';

const ROOT = join(__dirname, '..', '..');

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A PNG's IHDR width. */
function pngWidth(path: string): number {
  return readFileSync(path).readUInt32BE(16);
}

test('the category map covers exactly the nine launch categories', () => {
  assert.deepEqual(Object.keys(CATEGORY_STYLE).sort(), [...LAUNCH_CATEGORY_IDS].sort());
  assert.equal(Object.keys(CATEGORY_STYLE).length, 9);
  // Hidden ids get no style, so no card or filter can draw them.
  for (const hidden of ['prepared_foods', 'supplements', 'other'] as const) {
    assert.equal(categoryStyle(hidden), null);
  }
  assert.equal(categoryStyle(null), null);
  // Eight are the kit's; Baby Food & Formula's peach and glyph are the
  // founder's own approval (2026-10-06).
  const founder = Object.entries(CATEGORY_STYLE).filter(([, style]) => style.origin === 'founder');
  assert.deepEqual(
    founder.map(([id]) => id),
    ['baby_food_formula'],
  );
  assert.deepEqual(
    [CATEGORY_STYLE.baby_food_formula.background, CATEGORY_STYLE.baby_food_formula.foreground],
    ['#FFF1E8', '#8A3A14'],
  );
  // Nine distinct glyphs and nine distinct inks.
  const styles = Object.values(CATEGORY_STYLE);
  assert.equal(new Set(styles.map((style) => style.icon)).size, 9);
  assert.equal(new Set(styles.map((style) => style.foreground)).size, 9);
});

test('every category pairing reads at 4.5:1 or better, on its tint and on the page', () => {
  for (const [id, style] of Object.entries(CATEGORY_STYLE)) {
    assert.ok(contrast(style.foreground, style.background) >= 4.5, `${id} text on its tint`);
    assert.ok(contrast(style.foreground, feedColor.page) >= 4.5, `${id} text on the page`);
  }
});

test('Critical is white on red on the card and in the sheet ONLY; every other tier is unchanged', () => {
  assert.deepEqual(feedRiskPalette.critical, {
    background: '#DC001D',
    foreground: '#FFFFFF',
    border: '#DC001D',
  });
  assert.ok(contrast('#FFFFFF', '#DC001D') >= 4.5);
  // The global palette — Detail's label, the illness notices — is untouched.
  assert.deepEqual(riskPalette.critical, {
    background: '#EF4E47',
    foreground: '#001F3E',
    border: '#C82728',
  });
  for (const tier of Object.keys(riskPalette) as (keyof typeof riskPalette)[]) {
    if (tier === 'critical') continue;
    assert.deepEqual(feedRiskPalette[tier], riskPalette[tier], tier);
    assert.ok(
      contrast(feedRiskPalette[tier].foreground, feedRiskPalette[tier].background) >= 4.5,
      tier,
    );
  }
});

test('the card stacks its photo at the accessibility sizes or when the text column would be narrow', () => {
  assert.equal(cardStacks(0, 1), false, 'an unmeasured row keeps the beside layout');
  // iPhone SE: 375 - 2×14 gutter - 2×12 padding - 2×1 border = 321.
  assert.equal(cardStacks(321, 1), false);
  // 112 photo + 12 gap + 180 text = 304 is the narrowest beside row.
  assert.equal(cardStacks(304, 1), false);
  assert.equal(cardStacks(303, 1), true);
  assert.equal(cardStacks(800, CARD_STACK_SCALE), true);
  assert.equal(cardStacks(800, CARD_STACK_SCALE - 0.01), false);
});

test('every new glyph has its pinned source, the license, and three direct scales', () => {
  const sources = join(ROOT, FEED_ICON_FAMILY.sourceDirectory);
  assert.match(readFileSync(join(sources, 'LICENSE'), 'utf8'), /ISC License/);
  const glyphs: [string, string][] = [
    ...Object.entries(FEED_INTERFACE_GLYPHS),
    ...Object.values(CATEGORY_STYLE).map(
      (style) => [style.icon, style.sourceGlyph] as [string, string],
    ),
  ];
  assert.equal(glyphs.length, 13);
  for (const [icon, source] of glyphs) {
    const svg = readFileSync(join(sources, `${source}.svg`), 'utf8');
    assert.match(svg, /lucide-static v0\.468\.0 - ISC/, `${source}.svg is not the pinned source`);
    assert.match(svg, /viewBox="0 0 24 24"/);
    for (const [suffix, side] of [
      ['', 24],
      ['@2x', 48],
      ['@3x', 72],
    ] as const) {
      const file = join(ROOT, 'assets', 'icons', `${icon}${suffix}.png`);
      assert.ok(existsSync(file), `missing ${icon}${suffix}.png`);
      assert.equal(pngWidth(file), side, `${icon}${suffix}.png`);
    }
  }
});

test('no source-kit reference, font archive or proof is imported by app code', () => {
  for (const path of [
    'src/constants/feed-design.ts',
    'src/components/feed/feed-card-surface.tsx',
    'src/components/feed/feed-labels.tsx',
    'src/components/feed/filters-sheet.tsx',
    'src/components/ui/icon.tsx',
    'src/app/(tabs)/index.tsx',
  ]) {
    const source = readFileSync(join(ROOT, path), 'utf8');
    for (const forbidden of [
      'lotly-feed-filters-source-kit',
      'filters-button-reference',
      'approved-feed',
      'approved-filters',
      'PublicSans-Bold.ttf',
      'asset-and-state-sheet',
    ]) {
      assert.ok(!codeRefers(source, forbidden), `${path} references ${forbidden}`);
    }
  }
});

/** Whether code (not a comment) names the string. */
function codeRefers(source: string, needle: string): boolean {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  return code.includes(needle);
}
