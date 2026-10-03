/**
 * The Ready wide board's seven production images (2026-10-02), pinned as
 * files: byte-identical to the founder-approved asset report, at the sizes
 * and offsets the layout rules use, drawn only by Ready. The target, its
 * manifest, the exact source crops, the mask, the report, the review sheet
 * and the source kit are review material that no app code may import.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';

import {
  WIDE_FOREGROUND_COLUMN_PX,
  WIDE_FOREGROUND_TOP_PX,
  WIDE_GROWTH,
  WIDE_OVERLAP_PX,
  WIDE_PAPER_PX,
  WIDE_SCENE_PX,
  WIDE_TEXT_PX,
} from '@/lib/ready-presentation';

const ROOT = join(__dirname, '..', '..');
const REPORT = 'assets/brand/reference/ready-wide-board/lotly-ready-wide-board-asset-report.json';
const TARGET = {
  path: 'assets/brand/reference/lotly-onboarding-ready-wide-board-target.png',
  sha256: 'b0d25fbc9a2afd6f7ef2c9b60416821e53bdd3b7cb815ec3947a8ec08b5cd7ec',
};
const DIR = 'assets/brand/production/';

/** The approved files as installed; changing a byte without re-approval fails here. */
const PRODUCTION = {
  scene: {
    sha256: '595c3e6f7814fb80ac69e592cd01f22c5f1cc5f1c39026a2f2666920eca0af4f',
    size: WIDE_SCENE_PX,
  },
  paper: {
    sha256: 'e1732322159050f7134ab4c1bd97e4aab72f94ffc364ab7a527c952ff4e2753e',
    size: WIDE_PAPER_PX,
  },
  overlap: {
    sha256: 'f60a5442e50292c74471f3d8caae0da827f615f043166c19cd3d58abd3481800',
    size: WIDE_OVERLAP_PX,
  },
  'paper-extension': {
    sha256: 'a2a58d527a3a664b70b27e81cb556fd9f421d2e28fc4cc2b74c9b3ef380d1c96',
    size: { width: WIDE_PAPER_PX.width, height: WIDE_GROWTH.plateRows },
  },
  'wall-extension': {
    sha256: '798fc4363e89ce3a362e7363563b361a45937133a930461844a08e90d8db1518',
    size: { width: WIDE_SCENE_PX.width, height: WIDE_GROWTH.plateRows },
  },
  'paper-feather': {
    sha256: 'eb27b0597818e994d3df39619fc43026ceb4454735e901c8c75c505f945a5bfc',
    size: { width: WIDE_PAPER_PX.width, height: WIDE_GROWTH.featherRows },
  },
  'wall-feather': {
    sha256: '1c5e191a37d2f41e111590ac6e64605ec546069e26853c8d260699cab06e5f5f',
    size: { width: WIDE_SCENE_PX.width, height: WIDE_GROWTH.featherRows },
  },
} as const;

const fileOf = (name: string) => `${DIR}lotly-ready-wide-board-${name}.png`;

interface Report {
  references: { path: string; sha256: string }[];
  layers: { paper: { offsetInScene: number[] }; overlap: { offsetInScene: number[] } };
  growth: {
    insertionRow: { inPaper: number; inScene: number };
    plates: { heightRows: number };
    feathers: { rows: number };
  };
  nativeLayout: { nativeTextRegion_xyxy_exclusive: number[] };
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

test('the seven wide-board images are the approved bytes: 8-bit RGBA, tagged sRGB, at the sizes the layout measures', () => {
  for (const [name, entry] of Object.entries(PRODUCTION)) {
    const bytes = readFileSync(join(ROOT, fileOf(name)));
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

test('the asset report describes the installed bytes, and the layout places them where it says', () => {
  const report = JSON.parse(readFileSync(join(ROOT, REPORT), 'utf8')) as Report;
  for (const [name, entry] of Object.entries(PRODUCTION)) {
    const reported = report.files.find((file) => file.path === fileOf(name));
    assert.ok(reported, `${name} is missing from the report`);
    assert.equal(reported.sha256, entry.sha256);
    assert.equal(reported.bytes, readFileSync(join(ROOT, fileOf(name))).length);
    assert.deepEqual(reported.dimensions, [entry.size.width, entry.size.height]);
  }
  assert.deepEqual(report.layers.paper.offsetInScene, [WIDE_PAPER_PX.left, WIDE_PAPER_PX.top]);
  assert.deepEqual(report.layers.overlap.offsetInScene, [
    WIDE_OVERLAP_PX.left,
    WIDE_OVERLAP_PX.top,
  ]);
  assert.equal(report.growth.insertionRow.inPaper, WIDE_GROWTH.paperRow);
  assert.equal(report.growth.insertionRow.inScene, WIDE_GROWTH.sceneRow);
  assert.equal(report.growth.plates.heightRows, WIDE_GROWTH.plateRows);
  assert.equal(report.growth.feathers.rows, WIDE_GROWTH.featherRows);
  // The native block's region: the report's, in paper coordinates (the paper starts at target 85, 250).
  const [x0, y0] = report.nativeLayout.nativeTextRegion_xyxy_exclusive;
  assert.deepEqual([x0 - 85, y0 - 250], [WIDE_TEXT_PX.left, WIDE_TEXT_PX.top]);
  const reference = report.references.find((entry) => entry.path === TARGET.path);
  assert.ok(reference);
  assert.equal(reference.sha256, TARGET.sha256);
  assert.equal(sha256(readFileSync(join(ROOT, TARGET.path))), TARGET.sha256);
});

test('only Ready draws the wide board, and no app code imports its reference material', () => {
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
  for (const name of Object.keys(PRODUCTION)) {
    const file = fileOf(name).split('/').pop()!;
    assert.deepEqual(
      sources.filter(([, source]) => source.includes(file)).map(([path]) => path),
      ['src/components/onboarding/preview-step.tsx'],
    );
  }
  for (const [path, source] of sources) {
    for (const forbidden of [
      'lotly-onboarding-ready-wide-board-target',
      'lotly-onboarding-ready-wide-board-source-manifest',
      'ready-wide-board/',
      'wide-board-scene-source',
      'wide-board-paper-source',
      'wide-board-overlap-source',
      'lotly-ready-wide-board-asset-report',
      'lotly-ready-wide-board-asset-comparison',
      'lotly-ready-wide-board-source-kit',
    ]) {
      assert.ok(!source.includes(forbidden), `${path} references ${forbidden}`);
    }
  }
});

/** The alpha channel of an 8-bit RGBA, non-interlaced PNG. */
function alphaOf(bytes: Buffer): { width: number; height: number; alpha: Uint8Array } {
  const idat: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('latin1', offset + 4, offset + 8) === 'IDAT')
      idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const alpha = new Uint8Array(width * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 4 ? line[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x] + p) & 255;
    }
    for (let x = 0; x < width; x += 1) alpha[y * width + x] = line[x * 4 + 3];
    prev = line;
  }
  return { width, height, alpha };
}

test('the wide foreground profile the board grows by is the overlap image’s own', () => {
  const { width, height, alpha } = alphaOf(readFileSync(join(ROOT, fileOf('overlap'))));
  // Paper x = overlap x + (overlap left - paper left); paper y = overlap y + (overlap top - paper top).
  const dx = WIDE_OVERLAP_PX.left - WIDE_PAPER_PX.left;
  const dy = WIDE_OVERLAP_PX.top - WIDE_PAPER_PX.top;
  const derived: number[] = [];
  for (let c = 0; c * WIDE_FOREGROUND_COLUMN_PX < WIDE_PAPER_PX.width; c += 1) {
    let top = Infinity;
    for (
      let px = c * WIDE_FOREGROUND_COLUMN_PX;
      px < (c + 1) * WIDE_FOREGROUND_COLUMN_PX;
      px += 1
    ) {
      const ox = px - dx;
      if (ox < 0 || ox >= width) continue;
      for (let y = 0; y < height; y += 1)
        if (alpha[y * width + ox]) {
          top = Math.min(top, y + dy);
          break;
        }
    }
    derived.push(Number.isFinite(top) ? top : 0);
  }
  assert.deepEqual(derived, [...WIDE_FOREGROUND_TOP_PX]);
});
