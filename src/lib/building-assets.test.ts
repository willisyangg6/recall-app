/**
 * The Building step's production artwork and glyphs (the five-stop watch,
 * 2026-10-02), pinned as files: the founder-approved hero bytes are the
 * asset report's, the native tag overlays use the report's fitted
 * calibration, only the Building step draws the hero, and the five glyphs are
 * the vendored and Lotly-authored sources rasterised by the existing
 * pipeline. The approved reference, its manifest, the source crops, the
 * repair mask, the report, the comparison sheet and the source kit are review
 * material that no app code may import.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import { color, typography } from '@/constants/design-tokens';
import {
  ACCESSIBILITY_SCALE,
  BUILDING_COLOURS,
  captionType,
  WIDEST_CAPTION_WORD_EM,
  headlineType,
  HERO_PX,
  RAIL_PX,
  REFERENCE_WIDTH,
  STOP_FILLS,
  STOP_GLYPHS,
  stopCentreX,
  TAG_GLYPHS,
} from '@/lib/building-presentation';
import { BUILDING_STOPS } from '@/lib/building-watch';

const ROOT = join(__dirname, '..', '..');
const REPORT =
  'assets/brand/reference/building-grocery-search/lotly-building-grocery-search-asset-report.json';
const HERO = 'assets/brand/production/lotly-building-grocery-search-scene.png';
/** The approved bytes as installed; changing one without re-approval fails here. */
const HERO_SHA256 = 'ffcfabc1800f2c4e84a29a1e22bfae1667a4be401e517ee6e54c81b166964f6a';
const TARGET = 'assets/brand/reference/lotly-onboarding-building-grocery-search-target.png';
const TARGET_SHA256 = '764c5aff70de7f38413580aaf3eb02646079d58b8eb2053d2390c3f6ec9bb814';
const LUCIDE = join(ROOT, 'assets', 'icon-sources', 'lucide');
const LOTLY = join(ROOT, 'assets', 'icon-sources', 'lotly');
const GLYPHS = join(ROOT, 'assets', 'onboarding', 'building');

interface Calibration {
  centre_heroPx: number[];
  iconBox24Grid: { px: number };
  rotationDegClockwise: number;
}
interface Report {
  reference: { path: string; sha256: string };
  cropDecisions: { crop_xyxy_exclusive: number[] };
  files: { path: string; sha256: string; bytes: number; dimensions: number[] }[];
  tagOverlayCalibration: Record<'pin' | 'allergen' | 'cart', Calibration>;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('the hero is the approved bytes: 8-bit RGBA, tagged sRGB, at the measured size', () => {
  const bytes = readFileSync(join(ROOT, HERO));
  assert.equal(sha256(bytes), HERO_SHA256, 'the approved bytes changed');
  assert.equal(bytes.readUInt32BE(16), HERO_PX.width);
  assert.equal(bytes.readUInt32BE(20), HERO_PX.height);
  assert.equal(bytes[24], 8, 'bit depth');
  assert.equal(bytes[25], 6, 'not RGBA');
  assert.equal(bytes[28], 0, 'interlaced');
  const chunks: string[] = [];
  for (let offset = 8; offset < bytes.length;) {
    chunks.push(bytes.toString('latin1', offset + 4, offset + 8));
    offset += 12 + bytes.readUInt32BE(offset);
  }
  assert.deepEqual(
    chunks.filter((type, i) => type !== chunks[i - 1]),
    ['IHDR', 'sRGB', 'gAMA', 'cHRM', 'IDAT', 'IEND'],
  );
});

test('the report describes the installed bytes, the crop and the tag calibration the screen uses', () => {
  const report = JSON.parse(readFileSync(join(ROOT, REPORT), 'utf8')) as Report;
  const reported = report.files.find((file) => file.path === HERO);
  assert.ok(reported, 'the hero is missing from the report');
  assert.equal(reported.sha256, HERO_SHA256);
  assert.equal(reported.bytes, readFileSync(join(ROOT, HERO)).length);
  assert.deepEqual(reported.dimensions, [HERO_PX.width, HERO_PX.height]);
  assert.equal(report.reference.path, TARGET);
  assert.equal(report.reference.sha256, TARGET_SHA256);
  assert.equal(sha256(readFileSync(join(ROOT, TARGET))), TARGET_SHA256);
  assert.equal(REFERENCE_WIDTH, HERO_PX.width);
  assert.deepEqual(report.cropDecisions.crop_xyxy_exclusive, [
    0,
    HERO_PX.top,
    REFERENCE_WIDTH,
    HERO_PX.top + HERO_PX.height,
  ]);
  const byStop = { area: 'pin', allergens: 'allergen', stores: 'cart' } as const;
  for (const tag of TAG_GLYPHS) {
    const measured = report.tagOverlayCalibration[byStop[tag.stop]];
    assert.ok(Math.abs(tag.centre[0] - measured.centre_heroPx[0]) < 0.01, `${tag.stop} x`);
    assert.ok(Math.abs(tag.centre[1] - measured.centre_heroPx[1]) < 0.01, `${tag.stop} y`);
    assert.ok(Math.abs(tag.box - measured.iconBox24Grid.px) < 0.01, `${tag.stop} box`);
    assert.ok(Math.abs(tag.rotate - measured.rotationDegClockwise) < 0.01, `${tag.stop} angle`);
  }
});

test('only the Building step draws the hero and its glyphs, and no app code imports review material', () => {
  const sources: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        sources.push([relative(ROOT, path), codeOnly(readFileSync(path, 'utf8'))]);
      }
    }
  };
  walk(join(ROOT, 'src'));
  for (const asset of ['lotly-building-grocery-search-scene.png', 'onboarding/building/']) {
    assert.deepEqual(
      sources.filter(([, source]) => source.includes(asset)).map(([path]) => path),
      ['src/components/onboarding/building-step.tsx'],
      asset,
    );
  }
  for (const [path, source] of sources) {
    for (const forbidden of [
      'lotly-onboarding-building-grocery-search-target',
      'lotly-onboarding-building-grocery-search-source-manifest',
      'building-grocery-search/',
      'lotly-building-grocery-search-scene-source',
      'lotly-building-grocery-search-scene-blank-tags-source',
      'lotly-building-grocery-search-repair-mask',
      'lotly-building-grocery-search-asset-report',
      'lotly-building-grocery-search-asset-comparison',
      'lotly-building-source-kit',
    ]) {
      assert.ok(!source.includes(forbidden), `${path} references ${forbidden}`);
    }
  }
});

test('the five glyphs: the pinned Lucide sources, the one Lotly-authored source, rasterised natively', () => {
  // Byte-identical to lucide-icons/lucide@f06ac67e…/icons/map-pin.svg and
  // …/octagon-alert.svg, retrieved from the pinned commit on 2026-10-02.
  assert.equal(
    sha256(readFileSync(join(LUCIDE, 'map-pin.svg'))),
    '16f1042a62f1bda20ebab8bfc1cb79c0be285c980dea6c2c733a17902631405b',
  );
  assert.equal(
    sha256(readFileSync(join(LUCIDE, 'octagon-alert.svg'))),
    '86d28171a1d6ee0e65ebd44c9e683dce5803a85a1d3980fcc60bd46465f8c6b2',
  );
  // The general allergen symbol: Lucide's own octagon with its stroked
  // exclamation, not a peanut, milk or any ingredient.
  const octagon = readFileSync(join(LUCIDE, 'octagon-alert.svg'), 'utf8');
  assert.match(octagon, /<path d="M12 8v4" \/>/);
  assert.match(octagon, /<path d="M12 16h\.01" \/>/);
  // The Feed stop's three stacked cards: Lotly-authored on the Lucide grid,
  // at Lucide's stroke and caps, drawn to the approved mockup.
  const stacked = readFileSync(join(LOTLY, 'stacked-cards.svg'), 'utf8');
  assert.equal(
    sha256(Buffer.from(stacked)),
    'd06b0bac824c866d914e780c38bf7a93e0370c395794bfc7747e308776ee5745',
  );
  for (const rule of [
    /viewBox="0 0 24 24"/,
    /stroke="currentColor"/,
    /stroke-width="2"/,
    /stroke-linecap="round"/,
  ]) {
    assert.match(stacked, rule);
  }
  assert.equal((stacked.match(/<rect /g) ?? []).length, 1);
  assert.equal((stacked.match(/<path /g) ?? []).length, 2);
  assert.equal(readdirSync(LOTLY).filter((name) => name.endsWith('.svg')).length, 1);
  // Five glyphs, three scales each, and nothing else in the folder.
  assert.deepEqual(Object.keys(STOP_GLYPHS), [...BUILDING_STOPS]);
  const expected = Object.values(STOP_GLYPHS)
    .flatMap((name) => ['', '@2x', '@3x'].map((suffix) => `${name}${suffix}.png`))
    .sort();
  assert.deepEqual(readdirSync(GLYPHS).sort(), expected);
  for (const name of expected) {
    const bytes = readFileSync(join(GLYPHS, name));
    const side = name.includes('@3x') ? 120 : name.includes('@2x') ? 80 : 40;
    assert.equal(bytes.readUInt32BE(16), side, `${name} width`);
    assert.equal(bytes.readUInt32BE(20), side, `${name} height`);
  }
  // The renderer is deterministic: the verified @3x bytes are pinned.
  assert.deepEqual(
    Object.values(STOP_GLYPHS).map((name) => sha256(readFileSync(join(GLYPHS, `${name}@3x.png`)))),
    [
      '91c9cc97698eee8698465a5496fbcc38a833fe8eb08fe2aa9bdb0f0e69cec3f5',
      '068fee6a5c727f4e52f9ee765e65cc80fa25fe7458043f25526e2712b1545f09',
      '6666397e8e7a266f386e04f94e8f78bd6e43a6b2a29f87c1b2f2c4b71c300a15',
      '97fe1bbc7c1fa10aee788cb16c68c5d8820634f8c4338ab22e745aa501646f19',
      '367a28f7e011fd295ab3facf9ea996d5e0247da3ca3a0a0c95e89a37f1bfc448',
    ],
  );
  assert.ok(existsSync(join(ROOT, 'scripts', 'render-onboarding-assets.mjs')));
});

test('the rail: five equal stops, evenly pitched and centred; colours fixed; shared tokens untouched', () => {
  for (const width of [402, 393, 375]) {
    const centres = BUILDING_STOPS.map((_, i) => stopCentreX(width, i));
    assert.ok(Math.abs(centres[2] - width / 2) < 1e-9, `${width}: not centred`);
    const pitches = centres.slice(1).map((x, i) => x - centres[i]);
    assert.ok(
      pitches.every((p) => Math.abs(p - pitches[0]) < 1e-9),
      `${width}: uneven`,
    );
    const diameter = (RAIL_PX.diameter * width) / REFERENCE_WIDTH;
    assert.ok(centres[0] - diameter / 2 > 8, `${width}: the rail runs off the page`);
  }
  // Decoration, never state: blue, lime, blue, lime, blue whatever happens.
  assert.deepEqual(STOP_FILLS, ['blue', 'lime', 'blue', 'lime', 'blue']);
  // The lighter blue is Building's own; the shared tokens stay as they are.
  assert.equal(BUILDING_COLOURS.stopBlue, '#D4EBFE');
  assert.equal(color['background/subtle'], '#C0D6EB');
  assert.equal(color['background/accent'], '#E2EE57');
  assert.ok(!Object.values(color).includes(BUILDING_COLOURS.stopBlue as never));
});

test('at the accessibility sizes the headline and caption take smaller bases, so no word breaks', () => {
  // React Native's AX4 and AX5 scales; the SE's and the iPhone 17's columns.
  const ax4 = 3.143;
  const ax5 = 3.571;
  const se = 375 - 32;
  const iphone17 = 402 - 32;
  assert.deepEqual(headlineType(1), { fontSize: 36, lineHeight: 36 });
  assert.deepEqual(captionType(1, se), { fontSize: 18, lineHeight: 23 });
  assert.equal(headlineType(ACCESSIBILITY_SCALE).fontSize, typography['heading-2'].fontSize);
  // `body` with a screen-local 1.25 leading while the widest word fits.
  assert.deepEqual(captionType(ACCESSIBILITY_SCALE, se), { fontSize: 16, lineHeight: 20 });
  assert.equal(captionType(ax4, se).fontSize, typography.body.fontSize);
  assert.equal(captionType(ax5, iphone17).fontSize, typography.body.fontSize);
  // At AX5 on an SE `personalized` at 16pt broke as `personalize|d` on the
  // Simulator: the caption steps to `body-small`.
  assert.deepEqual(captionType(ax5, se), { fontSize: 13, lineHeight: 16 });
  for (const scale of [ACCESSIBILITY_SCALE, 2.143, 2.643, ax4, ax5]) {
    for (const column of [se, iphone17]) {
      const fontSize = captionType(scale, column).fontSize;
      assert.ok(
        WIDEST_CAPTION_WORD_EM * fontSize * scale <= column * 0.95,
        `${scale}× ${column}pt`,
      );
    }
  }
  // `Getting` (3.707em) fits the SE's column at AX5 at `heading-2`.
  assert.ok(3.707 * headlineType(ax5).fontSize * ax5 < se * 0.95);
  // Still multiplied by the reader's setting: bases, never caps.
  assert.ok(headlineType(ax5).fontSize * ax5 > headlineType(1).fontSize);
  assert.ok(captionType(ax5, se).fontSize * ax5 > captionType(1, se).fontSize);
});
