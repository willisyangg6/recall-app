/**
 * The receipt Stores' three production images (2026-09-30), pinned as files:
 * the founder-approved scene, paper and overlap are byte-identical to the
 * asset report, the layout rules place them where the report says, and only
 * the Stores step draws them. The approved target, its manifest, the exact
 * crops, the masks, the report, the review sheets and the source kit are
 * review material that no app code may import.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import {
  OVERLAP_PX,
  PAPER_PX,
  PAPER_SLICE_PX,
  REFERENCE_WIDTH,
  SCENE_PX,
} from '@/lib/stores-receipt-presentation';

const ROOT = join(__dirname, '..', '..');
const REPORT = 'assets/brand/reference/stores-receipt/lotly-stores-receipt-asset-report.json';
const TARGET = 'assets/brand/reference/lotly-onboarding-stores-receipt-target.png';
const TARGET_SHA256 = '06dfcfc8b2a8db26b892f462d24f281ef68da47ac1677c945fc2945295dd236b';

/** The approved files as installed; changing a byte without re-approval fails here. */
const PRODUCTION = {
  scene: {
    path: 'assets/brand/production/lotly-stores-receipt-scene.png',
    sha256: 'c13672616dd1f510bc5d565d477c0fc65bb0803ea7b4fa113fddbbcd1c47a4d4',
    size: SCENE_PX,
  },
  paper: {
    path: 'assets/brand/production/lotly-stores-receipt-paper.png',
    sha256: '50561405c89b49a2d69c540cd5e44472e38d6509305b27f845ca4737fbefb9f1',
    size: PAPER_PX,
  },
  overlap: {
    path: 'assets/brand/production/lotly-stores-receipt-overlap.png',
    sha256: '1ccd1ef188b2e70b05d7cb9e8e0a1e248abb44b1521d40f697d11492d897ad8e',
    size: OVERLAP_PX,
  },
} as const;

interface Report {
  reference: { path: string; sha256: string };
  layers: {
    scene: { referenceBox_xyxy_exclusive: number[] };
    paper: { offsetInScene: number[]; bottomAnchorSceneRow: number };
    overlap: { offsetInScene: number[] };
  };
  paperStretch: { sliceRowsInPaper: number[] };
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

/** The IHDR fields and chunk order, read without decoding the pixels. */
function header(bytes: Buffer) {
  const chunks: string[] = [];
  for (let offset = 8; offset < bytes.length;) {
    chunks.push(bytes.toString('latin1', offset + 4, offset + 8));
    offset += 12 + bytes.readUInt32BE(offset);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
    interlace: bytes[28],
    chunks: chunks.filter((type, i) => type !== chunks[i - 1]),
  };
}

test('the three layers are the approved bytes: 8-bit RGBA, tagged sRGB, at the sizes the layout measures', () => {
  for (const [name, entry] of Object.entries(PRODUCTION)) {
    const bytes = readFileSync(join(ROOT, entry.path));
    assert.equal(sha256(bytes), entry.sha256, `${name}: the approved bytes changed`);
    const png = header(bytes);
    assert.deepEqual(
      { width: png.width, height: png.height },
      { width: entry.size.width, height: entry.size.height },
      `${name}: the layout rules measure another size`,
    );
    assert.equal(png.bitDepth, 8, `${name} bit depth`);
    assert.equal(png.colorType, 6, `${name} is not RGBA`);
    assert.equal(png.interlace, 0, `${name} is interlaced`);
    assert.deepEqual(png.chunks, ['IHDR', 'sRGB', 'gAMA', 'cHRM', 'IDAT', 'IEND'], name);
  }
});

test('the asset report describes the installed bytes, and the layout places the layers where it says', () => {
  const report = JSON.parse(readFileSync(join(ROOT, REPORT), 'utf8')) as Report;
  for (const [name, entry] of Object.entries(PRODUCTION)) {
    const reported = report.files.find((file) => file.path === entry.path);
    assert.ok(reported, `${name} is missing from the report`);
    assert.equal(reported.sha256, entry.sha256);
    assert.equal(reported.bytes, readFileSync(join(ROOT, entry.path)).length);
    assert.deepEqual(reported.dimensions, [entry.size.width, entry.size.height]);
  }
  // One scale: the scene is the target's full width.
  const [x0, y0, x1, y1] = report.layers.scene.referenceBox_xyxy_exclusive;
  assert.deepEqual([x1 - x0, y1 - y0], [REFERENCE_WIDTH, SCENE_PX.height]);
  // The paper's place in the scene, and its bottom anchor.
  assert.deepEqual(report.layers.paper.offsetInScene, [PAPER_PX.left, PAPER_PX.top]);
  assert.equal(report.layers.paper.bottomAnchorSceneRow, SCENE_PX.height - PAPER_PX.bottomGap);
  assert.equal(PAPER_PX.top + PAPER_PX.height, SCENE_PX.height - PAPER_PX.bottomGap);
  // The overlap, fixed to the paper's bottom-left corner (and so the scene's).
  const [ox, oy] = report.layers.overlap.offsetInScene;
  assert.equal(PAPER_PX.left + OVERLAP_PX.left, ox);
  assert.equal(PAPER_PX.top + PAPER_PX.height - OVERLAP_PX.bottom - OVERLAP_PX.height, oy);
  // The one approved stretch slice.
  assert.deepEqual(report.paperStretch.sliceRowsInPaper, [
    PAPER_SLICE_PX.top,
    PAPER_SLICE_PX.bottom,
  ]);
  assert.deepEqual(report.reference, { ...report.reference, path: TARGET, sha256: TARGET_SHA256 });
  assert.equal(sha256(readFileSync(join(ROOT, TARGET))), TARGET_SHA256);
});

test('only the Stores step draws the layers, and no app code imports reference or source material', () => {
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
  for (const entry of Object.values(PRODUCTION)) {
    const name = entry.path.split('/').pop()!;
    assert.deepEqual(
      sources.filter(([, source]) => source.includes(name)).map(([path]) => path),
      ['src/components/onboarding/retailers-step.tsx'],
    );
  }
  for (const [path, source] of sources) {
    for (const forbidden of [
      'lotly-onboarding-stores-receipt-target',
      'lotly-onboarding-stores-receipt-source-manifest',
      'stores-receipt-scene-source',
      'stores-receipt-paper-source',
      'stores-receipt-overlap-source',
      'stores-receipt-paper-repair-footprints',
      'lotly-stores-receipt-asset-report',
      'lotly-stores-receipt-asset-comparison',
      'lotly-stores-receipt-stretch-demo',
      'lotly-stores-source-kit',
    ]) {
      assert.ok(!source.includes(forbidden), `${path} references ${forbidden}`);
    }
    assert.ok(!/require\([^)]*brand\/reference/.test(source), `${path} imports reference material`);
  }
});
