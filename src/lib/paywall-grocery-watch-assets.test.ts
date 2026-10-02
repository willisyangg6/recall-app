/**
 * The onboarding paywall's one production image (the grocery-watch hero,
 * 2026-10-01), pinned as a file: the founder-approved bytes are identical to
 * the asset report, the layout rule measures the size the file carries, and
 * only the onboarding paywall draws it. The approved target, its manifest,
 * the exact and derived source crops, the operation map, the report, the
 * comparison sheet and the source kit are review material that no app code
 * may import.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import { HERO_PX, REFERENCE_WIDTH } from '@/lib/onboarding-paywall-presentation';

const ROOT = join(__dirname, '..', '..');
const REPORT =
  'assets/brand/reference/paywall-grocery-watch/lotly-paywall-grocery-watch-asset-report.json';
const HERO = 'assets/brand/production/lotly-paywall-grocery-watch-scene.png';
/** The approved bytes as installed; changing one without re-approval fails here. */
const HERO_SHA256 = '4ff24a80d368ec297db450ace644a5b4b8a667141e9c7dd26f9f01327dce0df4';
const TARGET = 'assets/brand/reference/lotly-onboarding-paywall-grocery-watch-target.png';
const TARGET_SHA256 = '5e2025faf937470bb94ac485189adf7e658ba4bc548cc7ca93621967099238a4';

interface Report {
  reference: { path: string; sha256: string };
  cropDecisions: { crop_xyxy_exclusive: number[] };
  files: { path: string; sha256: string; bytes: number; dimensions: number[] }[];
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Strips comments, so a documented path never reads as an import. */
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

test('the asset report describes the installed bytes, the approved target and the crop the layout uses', () => {
  const report = JSON.parse(readFileSync(join(ROOT, REPORT), 'utf8')) as Report;
  const reported = report.files.find((file) => file.path === HERO);
  assert.ok(reported, 'the hero is missing from the report');
  assert.equal(reported.sha256, HERO_SHA256);
  assert.equal(reported.bytes, readFileSync(join(ROOT, HERO)).length);
  assert.deepEqual(reported.dimensions, [HERO_PX.width, HERO_PX.height]);
  assert.deepEqual(report.reference, { ...report.reference, path: TARGET, sha256: TARGET_SHA256 });
  assert.equal(sha256(readFileSync(join(ROOT, TARGET))), TARGET_SHA256);
  // One scale: the hero is the target's full width, from the row the
  // headline placement measures from.
  assert.deepEqual(report.cropDecisions.crop_xyxy_exclusive, [
    0,
    HERO_PX.top,
    REFERENCE_WIDTH,
    HERO_PX.top + HERO_PX.height,
  ]);
});

test('only the onboarding paywall draws the hero, and no app code imports reference or source material', () => {
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
  assert.deepEqual(
    sources
      .filter(([, source]) => source.includes('lotly-paywall-grocery-watch-scene.png'))
      .map(([path]) => path),
    ['src/components/paywall/onboarding-paywall-panel.tsx'],
  );
  for (const [path, source] of sources) {
    for (const forbidden of [
      'lotly-onboarding-paywall-grocery-watch-target',
      'lotly-onboarding-paywall-grocery-watch-source-manifest',
      'paywall-grocery-watch/',
      'lotly-paywall-grocery-watch-scene-source',
      'lotly-paywall-grocery-watch-scene-headline-removed-source',
      'lotly-paywall-grocery-watch-operation-footprints',
      'lotly-paywall-grocery-watch-asset-report',
      'lotly-paywall-grocery-watch-asset-comparison',
      'lotly-paywall-source-kit',
    ]) {
      assert.ok(!source.includes(forbidden), `${path} references ${forbidden}`);
    }
  }
});
