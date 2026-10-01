/**
 * The preference-board Ready's four production images (2026-09-30), pinned
 * as files: the founder-approved scene, blank board, foreground overlap and
 * editor mini mascot are byte-identical to the asset report, the layout
 * rules place them where the report says, and only Ready and the editor
 * draw them. Both approved targets, their manifest, the exact source crops,
 * the masks, the report, the review sheets and the source kit are review
 * material that no app code may import.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import { MINI_MASCOT_PX } from '@/lib/edit-preferences';
import {
  BOARD_GROWTH_MAX_PX,
  CONTENT_PX,
  OVERLAP_PX,
  PAPER_PX,
  PAPER_SLICE_PX,
  REFERENCE_WIDTH,
  SCENE_PX,
  WALL_BAND_PX,
} from '@/lib/ready-presentation';

const ROOT = join(__dirname, '..', '..');
const REPORT =
  'assets/brand/reference/ready-preference-board/lotly-ready-preference-board-asset-report.json';
const TARGETS = {
  ready: {
    path: 'assets/brand/reference/lotly-onboarding-ready-preference-board-target.png',
    sha256: 'b560d581498eb5f141c0e7e07e00524461aed4c8c7ac2c2a10bc97bf6c038486',
  },
  editor: {
    path: 'assets/brand/reference/lotly-ready-edit-preferences-target.png',
    sha256: '2f626ff6e574178943d4a9810f6e1522ad9080e2182011306d143479bcfa1630',
  },
} as const;

/** The approved files as installed; changing a byte without re-approval fails here. */
const PRODUCTION = {
  scene: {
    path: 'assets/brand/production/lotly-ready-preference-board-scene.png',
    sha256: 'a5f4e8ffafb3c02688c30ecbe9986f6b23393c1bd316fa46cf36ed9f6ca3a852',
    size: SCENE_PX,
    drawnBy: ['src/components/onboarding/preview-step.tsx'],
  },
  paper: {
    path: 'assets/brand/production/lotly-ready-preference-board-paper.png',
    sha256: '9d14c4490c42ca491b6ee0e2a892725965ac262276340612451cc302b48ffaeb',
    size: PAPER_PX,
    drawnBy: ['src/components/onboarding/preview-step.tsx'],
  },
  overlap: {
    path: 'assets/brand/production/lotly-ready-preference-board-overlap.png',
    sha256: '2ec9bebdc8fb223a9ffd29f37430020fedf88643eae46f29448767cd02ca2bb4',
    size: OVERLAP_PX,
    drawnBy: ['src/components/onboarding/preview-step.tsx'],
  },
  mini: {
    path: 'assets/brand/production/lotly-ready-preferences-mini-mascot.png',
    sha256: '586d6e2113aaaed4db62caad2d5bc6747e59bbe0085232d7f584ed7dbe29ac67',
    size: MINI_MASCOT_PX,
    drawnBy: ['src/components/onboarding/edit-preferences-step.tsx'],
  },
} as const;

interface Report {
  references: { path: string; sha256: string }[];
  layers: {
    scene: { referenceBox_xyxy_exclusive: number[] };
    paper: { offsetInScene: number[]; bottomAnchorSceneRow: number };
    overlap: { offsetInScene: number[] };
  };
  growth: { paperSliceRowsInPaper: number[]; wallBand: { rowsInScene: number[] } };
  nativeLayout: { contentSafeRect_xyxy_exclusive: number[] };
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

test('the four images are the approved bytes: 8-bit RGBA, tagged sRGB, at the sizes the layout measures', () => {
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
  // The board's and the overlap's places in the scene; the board's foot.
  assert.deepEqual(report.layers.paper.offsetInScene, [PAPER_PX.left, PAPER_PX.top]);
  assert.equal(report.layers.paper.bottomAnchorSceneRow, PAPER_PX.top + PAPER_PX.height);
  assert.deepEqual(report.layers.overlap.offsetInScene, [OVERLAP_PX.left, OVERLAP_PX.top]);
  // The approved growth: the one paper slice, the one wall band, the cap.
  assert.deepEqual(report.growth.paperSliceRowsInPaper, [
    PAPER_SLICE_PX.top,
    PAPER_SLICE_PX.bottom,
  ]);
  assert.deepEqual(report.growth.wallBand.rowsInScene, [WALL_BAND_PX.top, WALL_BAND_PX.bottom]);
  assert.equal(BOARD_GROWTH_MAX_PX, 80);
  // The native rows stay inside the report's content-safe rectangle.
  const [sx0, sy0, sx1, sy1] = report.nativeLayout.contentSafeRect_xyxy_exclusive;
  const paperX = x0 + PAPER_PX.left;
  const paperY = y0 + PAPER_PX.top;
  assert.deepEqual(
    [
      paperX + CONTENT_PX.left,
      paperY + CONTENT_PX.top,
      paperX + PAPER_PX.width - CONTENT_PX.right,
      paperY + PAPER_PX.height - CONTENT_PX.bottom,
    ],
    [sx0, sy0, sx1, sy1],
  );
  // Both approved targets are the bytes the report was cut from.
  for (const target of Object.values(TARGETS)) {
    const reference = report.references.find((entry) => entry.path === target.path);
    assert.ok(reference, `${target.path} is missing from the report`);
    assert.equal(reference.sha256, target.sha256);
    assert.equal(sha256(readFileSync(join(ROOT, target.path))), target.sha256);
  }
});

test('only Ready and the editor draw the images, and no app code imports reference or source material', () => {
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
      entry.drawnBy,
    );
  }
  for (const [path, source] of sources) {
    for (const forbidden of [
      'lotly-onboarding-ready-preference-board-target',
      'lotly-onboarding-ready-preference-board-source-manifest',
      'lotly-ready-edit-preferences-target',
      'ready-preference-board/',
      'preference-board-scene-source',
      'preference-board-paper-source',
      'preference-board-overlap-source',
      'preferences-mini-mascot-source',
      'paper-repair-footprints',
      'lotly-ready-preference-board-asset-report',
      'lotly-ready-preference-board-asset-comparison',
      'lotly-ready-preference-board-stretch-demo',
      'lotly-ready-source-kit',
    ]) {
      assert.ok(!source.includes(forbidden), `${path} references ${forbidden}`);
    }
    assert.ok(!/require\([^)]*brand\/reference/.test(source), `${path} imports reference material`);
  }
});
