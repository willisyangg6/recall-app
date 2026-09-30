/**
 * The grocery-atlas States' one production image (2026-09-30), pinned as a
 * file: the founder-approved scene is byte-identical to the asset report,
 * the layout rule measures the size the file carries, and only the States
 * step draws it. The approved target, the exact-crop source, the report,
 * the comparison sheet and the source kit are review material that no app
 * code may import.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import { SCENE_PX } from '@/lib/states-presentation';

const ROOT = join(__dirname, '..', '..');
const REPORT =
  'assets/brand/reference/states-grocery-atlas/lotly-states-grocery-atlas-asset-report.json';
const SCENE = 'assets/brand/production/lotly-states-grocery-atlas-scene.png';
/** The approved bytes as installed; changing one without re-approval fails here. */
const SCENE_SHA256 = 'a1216e8d6ddd6649fb1ccf9704f2e6cb0c65d998e037b32a4ca5c36b0b84d52a';
const TARGET = 'assets/brand/reference/lotly-onboarding-states-grocery-atlas-target.png';
const TARGET_SHA256 = 'affbcf5fe16ce0a92dd1b70e5dbe77a09dce92681772c82bb4ff7cddecfea2c4';

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

test('the scene is the approved bytes: 8-bit RGBA, tagged sRGB, at the measured size', () => {
  const bytes = readFileSync(join(ROOT, SCENE));
  assert.equal(sha256(bytes), SCENE_SHA256, 'the approved bytes changed');
  assert.equal(bytes.readUInt32BE(16), SCENE_PX.width);
  assert.equal(bytes.readUInt32BE(20), SCENE_PX.height);
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

test('the asset report describes the installed bytes and the approved target', () => {
  const report = JSON.parse(readFileSync(join(ROOT, REPORT), 'utf8')) as {
    reference: { path: string; sha256: string };
    files: { path: string; sha256: string; bytes: number; dimensions: number[] }[];
  };
  const reported = report.files.find((file) => file.path === SCENE);
  assert.ok(reported, 'the scene is missing from the report');
  assert.equal(reported.sha256, SCENE_SHA256);
  assert.equal(reported.bytes, readFileSync(join(ROOT, SCENE)).length);
  assert.deepEqual(reported.dimensions, [SCENE_PX.width, SCENE_PX.height]);
  assert.deepEqual(report.reference, { ...report.reference, path: TARGET, sha256: TARGET_SHA256 });
  assert.equal(sha256(readFileSync(join(ROOT, TARGET))), TARGET_SHA256);
});

test('only the States step draws the scene, and no app code imports reference or source material', () => {
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
      .filter(([, source]) => source.includes('lotly-states-grocery-atlas-scene.png'))
      .map(([path]) => path),
    ['src/components/onboarding/states-step.tsx'],
  );
  for (const [path, source] of sources) {
    for (const forbidden of [
      'lotly-onboarding-states-grocery-atlas-target',
      'lotly-onboarding-states-grocery-atlas-source-manifest',
      'lotly-states-grocery-atlas-scene-source',
      'lotly-states-grocery-atlas-asset-report',
      'lotly-states-grocery-atlas-asset-comparison',
      'lotly-states-source-kit',
    ]) {
      assert.ok(!source.includes(forbidden), `${path} references ${forbidden}`);
    }
  }
});
