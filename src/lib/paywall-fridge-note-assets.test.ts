/**
 * The Fridge Note paywall's two production images (2026-11-06), pinned as
 * files: the bytes are the lifetime-paywall kit's, unaltered (its
 * assets-manifest.json sha256 values), at the sizes the layout measures
 * from, and only the paywall panel draws them. The kit itself
 * (docs/lotly-lifetime-paywall-source-kit/) is review material no app code
 * may import.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import { SIGNATURE } from '@/lib/onboarding-paywall-presentation';

const ROOT = join(__dirname, '..', '..');
const DIR = 'assets/paywall/fridge-note';

/** The kit's manifest values; changing a file without re-approval fails here. */
const ASSETS = [
  {
    file: `${DIR}/fridge-note-backdrop.png`,
    sha256: '70128c83b2278a50dec10b614a5f7c99df748e9efd4032a9fe5f84f5bede5f9b',
    width: 1254,
    height: 1254,
  },
  {
    file: `${DIR}/willis-signature.png`,
    sha256: '5ff2fbac1c6d9d27dd0fd27c78b52257d324cca29aabca6728740c21da793343',
    width: 2164,
    height: 727,
  },
] as const;

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('the artwork is the kit’s bytes: 8-bit RGBA at the manifest’s size', () => {
  for (const asset of ASSETS) {
    const bytes = readFileSync(join(ROOT, asset.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.file);
    assert.equal(bytes.readUInt32BE(16), asset.width, asset.file);
    assert.equal(bytes.readUInt32BE(20), asset.height, asset.file);
    assert.equal(bytes[24], 8, `${asset.file} bit depth`);
    assert.equal(bytes[25], 6, `${asset.file} is not RGBA`);
  }
  // The signature's drawn box keeps the file's own aspect.
  assert.ok(Math.abs(SIGNATURE.aspectRatio - 2164 / 727) < 1e-9);
});

test('only the paywall panel draws the artwork, and no app code imports the kit', () => {
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
  for (const name of ['fridge-note-backdrop.png', 'willis-signature.png']) {
    assert.deepEqual(
      sources.filter(([, source]) => source.includes(name)).map(([path]) => path),
      ['src/components/paywall/onboarding-paywall-panel.tsx'],
      name,
    );
  }
  for (const [path, source] of sources) {
    assert.ok(!source.includes('lotly-lifetime-paywall-source-kit'), path);
    assert.ok(!source.includes('final-direction-02'), path);
  }
});
