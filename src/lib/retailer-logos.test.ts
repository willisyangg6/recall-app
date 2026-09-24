/**
 * Retailer logos (P2B7X.1): the provenance manifest and the component are
 * pinned to each other, every mark is bundled and never remote, the
 * container preserves the mark's ratio, the fallback is the shared `home`
 * glyph, and the accessible name never depends on the image.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { RETAILER_CATALOG } from '@/domain/retailer-catalog';
import {
  RETAILER_LOGO_BOX,
  RETAILER_LOGO_MANIFEST,
  retailerLogoCoverage,
  retailerLogoEntry,
} from './retailer-logos';

const ROOT = join(__dirname, '..', '..');
const COMPONENT = readFileSync(join(ROOT, 'src', 'components', 'ui', 'retailer-logo.tsx'), 'utf8');

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** The ids the component declares a bundled raster for. */
function declaredMarks(): string[] {
  const code = codeOnly(COMPONENT);
  const table = code.slice(
    code.indexOf('const MARKS'),
    code.indexOf('export function hasRetailerLogo'),
  );
  return [...table.matchAll(/^\s+'?([a-z0-9-]+)'?:\s*require\(/gm)].map((m) => m[1]);
}

test('the manifest and the component declare the same marks, keyed by canonical retailer id', () => {
  const manifest = Object.keys(RETAILER_LOGO_MANIFEST).sort();
  assert.deepEqual(declaredMarks().sort(), manifest);
  for (const id of manifest) {
    assert.ok(
      RETAILER_CATALOG.some((r) => r.id === id),
      `${id} is not a catalog retailer`,
    );
    assert.equal(RETAILER_LOGO_MANIFEST[id].retailerId, id);
  }
});

test('every recorded mark has an HTTPS source, an owner, a retrieval date, a permission note and its size', () => {
  for (const entry of Object.values(RETAILER_LOGO_MANIFEST)) {
    assert.match(entry.sourceUrl, /^https:\/\//, entry.retailerId);
    assert.ok(entry.owner.length > 0, entry.retailerId);
    assert.match(entry.retrievedOn, /^\d{4}-\d{2}-\d{2}$/, entry.retailerId);
    assert.ok(entry.permission.length > 0, entry.retailerId);
    assert.ok(entry.width > 0 && entry.height > 0, entry.retailerId);
    for (const suffix of ['', '@2x', '@3x']) {
      assert.ok(
        existsSync(join(ROOT, 'assets', 'retailer-logos', `${entry.retailerId}${suffix}.png`)),
        `${entry.retailerId}${suffix}.png is missing`,
      );
    }
  }
});

test('coverage is reported honestly: today every catalog retailer falls back', () => {
  const coverage = retailerLogoCoverage();
  assert.equal(coverage.withLogo.length + coverage.fallback.length, RETAILER_CATALOG.length);
  assert.equal(RETAILER_CATALOG.length, 77);
  assert.equal(coverage.withLogo.length, Object.keys(RETAILER_LOGO_MANIFEST).length);
  assert.equal(retailerLogoEntry('walmart'), null);
});

test('marks are bundled requires — never a remote URI, a logo service or a favicon', () => {
  const code = codeOnly(COMPONENT);
  for (const forbidden of [
    'uri:',
    'https://',
    'http://',
    'clearbit',
    'favicon',
    'logo.dev',
    'brandfetch',
    'fetch(',
  ]) {
    assert.ok(!code.includes(forbidden), `the logo component reaches ${forbidden}`);
  }
  assert.ok(code.includes("require('@/assets/retailer-logos/") || declaredMarks().length === 0);
});

test('the container is fixed and the mark is contained, never stretched, cropped or recoloured', () => {
  const code = codeOnly(COMPONENT);
  assert.deepEqual(RETAILER_LOGO_BOX, { width: 40, height: 24 });
  assert.ok(code.includes('width: RETAILER_LOGO_BOX.width'));
  assert.ok(code.includes('height: RETAILER_LOGO_BOX.height'));
  assert.ok(code.includes('resizeMode="contain"'));
  assert.ok(!code.includes('resizeMode="stretch"'));
  assert.ok(!code.includes('resizeMode="cover"'));
  assert.ok(!code.includes('tintColor'), 'a mark is never recoloured');
});

test('the fallback is the shared home glyph in the same box, and every variant carries the retailer name', () => {
  const code = codeOnly(COMPONENT);
  assert.ok(code.includes('<Icon name="home" size={20} color="icon/secondary" />'));
  assert.ok(code.includes('return <RetailerLogoFallback name={name} />;'));
  // Both the mark and the fallback speak the name; the image itself is hidden.
  assert.equal((code.match(/accessibilityLabel=\{name\}/g) ?? []).length, 2);
  assert.ok(code.includes('accessible={false}'));
});

test('logos render on the selector rows only — never on a recall card or Detail’s retailer row', () => {
  const card = codeOnly(readFileSync(join(ROOT, 'src', 'components', 'recall-card.tsx'), 'utf8'));
  const detail = codeOnly(readFileSync(join(ROOT, 'src', 'app', 'recall', '[id].tsx'), 'utf8'));
  const feed = codeOnly(readFileSync(join(ROOT, 'src', 'app', '(tabs)', 'index.tsx'), 'utf8'));
  for (const [name, source] of [
    ['card', card],
    ['detail', detail],
    ['feed', feed],
  ]) {
    assert.ok(!source.includes('RetailerLogo'), `${name} renders retailer logos`);
  }
  const form = codeOnly(
    readFileSync(join(ROOT, 'src', 'components', 'settings', 'personalization-form.tsx'), 'utf8'),
  );
  assert.ok(
    form.includes('leading={<RetailerLogo retailerId={retailer.id} name={retailer.name} />}'),
  );
});
