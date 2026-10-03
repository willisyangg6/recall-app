/**
 * Notification education's production artwork and its placement rules (the
 * phone-led example, 2026-10-03), pinned as files: the founder-approved hero
 * bytes are the asset report's, the card-plane transform reproduces the
 * measured card, the example icon is the approved iOS icon only downscaled,
 * only the education screen draws them, and the approved reference, its
 * manifest, the source crops, the operation mask, the report, the
 * comparison sheet and the source kit are review material no app code
 * imports.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import {
  BADGE_CLEARANCE,
  BADGE_PX,
  cardMatrix,
  cardToHero,
  CARD_PLANE,
  ctaLabelType,
  firstVisibleRowUnder,
  HERO_PX,
  heroTopBelowBadge,
  ptPerPx,
  REFERENCE_WIDTH,
  WIDEST_CTA_WORD_EM,
} from '@/lib/notification-education-presentation';

const ROOT = join(__dirname, '..', '..');
const REPORT =
  'assets/brand/reference/notifications-phone/lotly-notifications-phone-asset-report.json';
const HERO = 'assets/brand/production/lotly-notifications-phone-scene.png';
/** The approved bytes as installed; changing one without re-approval fails here. */
const HERO_SHA256 = '1bf5c79fbf88fc65501780694319e8b635c960fe71c0774b95308e3b96b7bbbd';
const TARGET = 'assets/brand/reference/lotly-onboarding-notifications-phone-target.png';
const TARGET_SHA256 = '8f3627ae5bc1e92710f1e39da8563113a4c9999570ec9b42e6c532a162e0a627';
const ICONS = join(ROOT, 'assets', 'onboarding', 'notifications');

interface Report {
  reference: { path: string; sha256: string };
  cropDecisions: { crop_xyxy_exclusive: number[] };
  files: { path: string; sha256: string; bytes: number; dimensions: number[] }[];
  phonePlane: { cardQuad_hero: Record<'TL' | 'TR' | 'BR' | 'BL', [number, number]> };
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

const report = JSON.parse(readFileSync(join(ROOT, REPORT), 'utf8')) as Report;

test('the hero is the approved bytes: 8-bit RGBA, tagged sRGB, at the measured size', () => {
  const bytes = readFileSync(join(ROOT, HERO));
  assert.equal(sha256(bytes), HERO_SHA256, 'the approved bytes changed');
  assert.equal(bytes.readUInt32BE(16), HERO_PX.width);
  assert.equal(bytes.readUInt32BE(20), HERO_PX.height);
  assert.equal(bytes[24], 8, 'bit depth');
  assert.equal(bytes[25], 6, 'not RGBA');
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

test('the report describes the installed bytes, the approved target and the crop the layout uses', () => {
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
});

test('the card plane lands on the measured card, at every width', () => {
  const quad = report.phonePlane.cardQuad_hero;
  const corners: [keyof typeof quad, number, number][] = [
    ['TL', 0, 0],
    ['TR', CARD_PLANE.width, 0],
    ['BR', CARD_PLANE.width, CARD_PLANE.height],
    ['BL', 0, CARD_PLANE.height],
  ];
  for (const [name, u, v] of corners) {
    const [x, y] = cardToHero(u, v);
    assert.ok(Math.abs(x - quad[name][0]) < 0.05 && Math.abs(y - quad[name][1]) < 0.05, name);
  }
  // The matrix React Native applies (column-major, about the top-left
  // corner) to a view laid out in points carries each corner to the same
  // place at the screen's own scale.
  for (const width of [402, 393, 375, 320]) {
    const s = ptPerPx(width);
    const m = cardMatrix(width);
    for (const [name, u, v] of corners) {
      const [px, py] = [u * s, v * s];
      const w = m[3] * px + m[7] * py + m[15];
      const x = (m[0] * px + m[4] * py + m[12]) / w;
      const y = (m[1] * px + m[5] * py + m[13]) / w;
      assert.ok(Math.abs(x - quad[name][0] * s) < 0.05, `${width} ${name} x`);
      assert.ok(Math.abs(y - quad[name][1] * s) < 0.05, `${width} ${name} y`);
    }
  }
});

test('the mark overlaps the hero only where the art is transparent', () => {
  // The clearance profile only ever moves the art down as the mark widens.
  for (let i = 1; i < BADGE_CLEARANCE.length; i += 1) {
    assert.ok(BADGE_CLEARANCE[i].row <= BADGE_CLEARANCE[i - 1].row);
  }
  for (const width of [402, 375]) {
    const s = ptPerPx(width);
    const overlap = (HERO_PX.top - BADGE_PX.top) * s;
    // Unmeasured, or a default-sized mark: the mock's 20px overlap.
    assert.equal(heroTopBelowBadge(width, null), overlap);
    assert.equal(heroTopBelowBadge(width, { width: 120, height: 25 }), overlap);
    // A mark that reaches the art pushes the hero down until it clears.
    for (const badge of [
      { width: 140, height: 60 },
      { width: 360, height: 130 },
    ]) {
      const top = heroTopBelowBadge(width, badge);
      const row = firstVisibleRowUnder(BADGE_PX.left + badge.width / s);
      assert.ok(top + (row - HERO_PX.top) * s >= badge.height, `${width} ${badge.height}`);
    }
  }
});

test('the example icon is the approved iOS icon, only downscaled, at three scales', () => {
  const files = readdirSync(ICONS).sort();
  assert.deepEqual(files, [
    'notification-example-icon.png',
    'notification-example-icon@2x.png',
    'notification-example-icon@3x.png',
  ]);
  for (const [name, side] of [
    ['notification-example-icon.png', 36],
    ['notification-example-icon@2x.png', 72],
    ['notification-example-icon@3x.png', 108],
  ] as const) {
    const bytes = readFileSync(join(ICONS, name));
    assert.equal(bytes.readUInt32BE(16), side);
    assert.equal(bytes.readUInt32BE(20), side);
  }
  // The renderer is deterministic: the verified bytes are pinned.
  assert.equal(
    sha256(readFileSync(join(ICONS, 'notification-example-icon@3x.png'))),
    'aa1b5852be106bc649b4f853d32a087c140f32dac30692cd53a13bd53b48f40f',
  );
  const script = readFileSync(join(ROOT, 'scripts', 'render-onboarding-assets.mjs'), 'utf8');
  assert.match(script, /lotly-icon-ios-1024\.png/);
});

test('only education draws the hero and the example icon, and no app code imports review material', () => {
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
  for (const asset of ['lotly-notifications-phone-scene.png', 'onboarding/notifications/']) {
    assert.deepEqual(
      sources.filter(([, source]) => source.includes(asset)).map(([path]) => path),
      ['src/components/onboarding/notification-education.tsx'],
      asset,
    );
  }
  for (const [path, source] of sources) {
    for (const forbidden of [
      'lotly-onboarding-notifications-phone-target',
      'lotly-onboarding-notifications-phone-source-manifest',
      'notifications-phone/',
      'lotly-notifications-phone-scene-source',
      'lotly-notifications-phone-scene-blank-card-source',
      'lotly-notifications-phone-operation-mask',
      'lotly-notifications-phone-asset-report',
      'lotly-notifications-phone-asset-comparison',
      'lotly-notifications-source-kit',
      'lotly-icon-ios-1024',
    ]) {
      assert.ok(!source.includes(forbidden), `${path} references ${forbidden}`);
    }
  }
});

test('the primary label keeps its 16pt until `notifications` would break, then takes a 13pt base', () => {
  // React Native's AX4 and AX5 scales; the SE's and the iPhone 17's label columns.
  const label = (width: number) => width - 32 - 32;
  assert.equal(ctaLabelType(1, label(375)), null);
  assert.equal(ctaLabelType(2.143, label(402)), null);
  // AX4 on an SE still fits at 16pt (295.0pt of a 295.5pt allowance).
  assert.equal(ctaLabelType(3.143, label(375)), null);
  for (const [scale, width] of [
    [3.571, 375],
    [3.571, 402],
  ] as const) {
    const type = ctaLabelType(scale, label(width));
    assert.ok(type, `${scale}× at ${width}`);
    assert.ok(WIDEST_CTA_WORD_EM * type.fontSize * scale <= label(width) * 0.95);
    // Still multiplied by the reader's setting: a base, never a cap.
    assert.ok(type.fontSize * scale > 16);
  }
});
