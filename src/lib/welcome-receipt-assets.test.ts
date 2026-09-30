/**
 * The receipt Welcome's two production images (2026-09-29), pinned as files:
 * the founder-approved wordmark and repaired hero are byte-identical to the
 * asset report's current revision, the layout rules measure the same
 * dimensions the files carry, and only Welcome draws them. The approved
 * target, the source crops, the report and the comparison sheets are review
 * material that no app code may import.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import { HERO_PX, WORDMARK_PX } from '@/lib/welcome-presentation';

const ROOT = join(__dirname, '..', '..');
const REPORT = 'assets/brand/reference/welcome/lotly-welcome-receipt-asset-report.json';

/** The approved files as installed; changing a byte without re-approval fails here. */
const PRODUCTION = {
  wordmark: {
    path: 'assets/brand/production/lotly-wordmark-welcome-receipt.png',
    sha256: 'e3ea3163b9973f9e386180f5330d50678c6d3e69791b03f1d94e29692b1eeacd',
    size: WORDMARK_PX,
  },
  hero: {
    path: 'assets/brand/production/lotly-welcome-receipt-scene.png',
    sha256: '1b47e790e6c004d5416b4f6a80da46654269067467dd61ec7c48ba01210c6717',
    size: HERO_PX,
  },
} as const;

/** The superseded first hero export (852×810, straight cutoff), never to return. */
const SUPERSEDED_HERO = '0d8fd9d48678d3ad280e8a051b2c1e661551022664c1b4084dafe8637a2d83f9';

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
  assert.ok(bytes.subarray(1, 4).toString('latin1') === 'PNG', 'not a PNG');
  const chunks: string[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    chunks.push(bytes.toString('latin1', offset + 4, offset + 8));
    offset += 12 + length;
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

test('both production images are the approved bytes: 8-bit RGBA, tagged sRGB, at the measured sizes', () => {
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
  assert.notEqual(PRODUCTION.hero.sha256, SUPERSEDED_HERO);
});

test('the asset report describes the installed bytes, and the 852×810 hero is recorded as superseded', () => {
  const report = JSON.parse(readFileSync(join(ROOT, REPORT), 'utf8')) as {
    files: { role: string; path: string; sha256: string; bytes: number; dimensions: number[] }[];
    revisions: { change: string }[];
  };
  for (const [name, entry] of Object.entries(PRODUCTION)) {
    const reported = report.files.find((file) => file.path === entry.path);
    assert.ok(reported, `${name} is missing from the report`);
    const bytes = readFileSync(join(ROOT, entry.path));
    assert.equal(reported.sha256, entry.sha256);
    assert.equal(reported.bytes, bytes.length);
    assert.deepEqual(reported.dimensions, [entry.size.width, entry.size.height]);
  }
  assert.ok(report.revisions.some((revision) => revision.change.includes(SUPERSEDED_HERO)));
  assert.ok(report.revisions.some((revision) => revision.change.startsWith('Bottom repair')));
});

test('only Welcome draws the two images, and no app code imports reference or source material', () => {
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
      ['src/components/onboarding/welcome-content.tsx'],
    );
  }
  for (const [path, source] of sources) {
    for (const forbidden of [
      'lotly-onboarding-welcome-receipt-target',
      'lotly-onboarding-welcome-receipt-source-manifest',
      'welcome-receipt-scene-source',
      'welcome-receipt-scene-bottom-repaired-source',
      'wordmark-welcome-receipt-source',
      'lotly-welcome-receipt-asset-report',
      'lotly-welcome-receipt-asset-comparison',
      'lotly-welcome-receipt-bottom-repair-comparison',
      'lotly-welcome-source-kit',
    ]) {
      assert.ok(!source.includes(forbidden), `${path} references ${forbidden}`);
    }
    assert.ok(!/require\([^)]*brand\/reference/.test(source), `${path} imports reference material`);
  }
  // The approved inputs stay where the report says, unchanged.
  const target = 'assets/brand/reference/lotly-onboarding-welcome-receipt-target.png';
  assert.ok(existsSync(join(ROOT, target)));
  assert.equal(
    sha256(readFileSync(join(ROOT, target))),
    'beccec0c66200341e2939867d411677bd0b8772af377c71a0512a9347abdda56',
  );
});
