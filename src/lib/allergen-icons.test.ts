/**
 * The allergen icons (P2B7X.1): every consumer allergen has one glyph, all
 * nine come from one family with recorded provenance, every raster exists
 * at the three scales on one box, and no second icon system reaches the
 * allergen rows.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { CONSUMER_ALLERGENS } from '@/domain/preferences';
import {
  ALLERGEN_ICON_FAMILY,
  ALLERGEN_ICON_SOURCES,
  ALLERGEN_ICONS,
  allergenIconName,
  allergenIconRows,
} from './allergen-icons';
import { STATES_ICON_SOURCES } from './state-map';

const ROOT = join(__dirname, '..', '..');
const ICONS = join(ROOT, 'assets', 'icons');
const SOURCES = join(ROOT, ALLERGEN_ICON_FAMILY.sourceDirectory);

/** The IHDR width and height of a PNG file. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString('ascii', 1, 4), 'PNG', `${path} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('every consumer allergen has an icon, and the nine icons are distinct', () => {
  const rows = allergenIconRows();
  assert.equal(rows.length, CONSUMER_ALLERGENS.length);
  assert.equal(rows.length, 9);
  for (const option of CONSUMER_ALLERGENS) {
    assert.ok(allergenIconName(option.token) !== null, `${option.token} has no icon`);
  }
  assert.equal(new Set(Object.values(ALLERGEN_ICONS)).size, 9, 'two allergens share a glyph');
  assert.equal(allergenIconName('gluten'), null, 'a non-selectable token has no icon');
});

test('one family, with license, repository, commit and retrieval date recorded', () => {
  assert.equal(ALLERGEN_ICON_FAMILY.name, 'Lucide');
  assert.equal(ALLERGEN_ICON_FAMILY.license, 'ISC');
  assert.match(ALLERGEN_ICON_FAMILY.commit, /^[0-9a-f]{40}$/);
  assert.match(ALLERGEN_ICON_FAMILY.retrievedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(ALLERGEN_ICON_SOURCES.length, 9);
  assert.deepEqual(
    ALLERGEN_ICON_SOURCES.map((s) => s.icon).sort(),
    Object.values(ALLERGEN_ICONS).sort(),
  );
  // The license text and every SVG source are vendored beside each other.
  const license = readFileSync(join(SOURCES, 'LICENSE'), 'utf8');
  assert.match(license, /ISC License/);
  assert.match(license, /Lucide Icons and Contributors/);
  for (const source of ALLERGEN_ICON_SOURCES) {
    const svg = readFileSync(join(SOURCES, `${source.lucideName}.svg`), 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/, `${source.lucideName} is not on the 24 grid`);
    assert.match(svg, /stroke="currentColor"/, `${source.lucideName} is not an outline glyph`);
    assert.match(svg, /stroke-width="2"/, `${source.lucideName} has a foreign stroke weight`);
  }
  // No source outside the nine and the States step's six (P2B7Y,
  // lib/state-map.ts): a stray glyph would be a second decision.
  const vendored = readdirSync(SOURCES)
    .filter((f) => f.endsWith('.svg'))
    .sort();
  assert.deepEqual(
    vendored,
    [...ALLERGEN_ICON_SOURCES, ...STATES_ICON_SOURCES].map((s) => `${s.lucideName}.svg`).sort(),
  );
  for (const source of STATES_ICON_SOURCES) {
    const svg = readFileSync(join(SOURCES, `${source.lucideName}.svg`), 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/, `${source.lucideName} is not on the 24 grid`);
    assert.match(svg, /stroke-width="2"/, `${source.lucideName} has a foreign stroke weight`);
  }
});

test('every raster exists at 1x, 2x and 3x on the set’s 24pt box — one visual box for all nine', () => {
  for (const icon of Object.values(ALLERGEN_ICONS)) {
    for (const [suffix, side] of [
      ['', 24],
      ['@2x', 48],
      ['@3x', 72],
    ] as const) {
      const file = join(ICONS, `${icon}${suffix}.png`);
      assert.ok(existsSync(file), `missing ${icon}${suffix}.png`);
      assert.deepEqual(pngSize(file), { width: side, height: side }, `${icon}${suffix}.png`);
    }
  }
});

test('Profile’s allergen rows render the family through the one icon primitive — no emoji, no second family, no inline drawing', () => {
  const form = codeOnly(
    readFileSync(join(ROOT, 'src', 'components', 'settings', 'personalization-form.tsx'), 'utf8'),
  );
  const step = codeOnly(
    readFileSync(join(ROOT, 'src', 'components', 'onboarding', 'allergens-step.tsx'), 'utf8'),
  );
  // The onboarding grid draws the Lotly pictograms instead
  // (lib/allergen-assets.ts); this family stays Profile's.
  assert.ok(form.includes('AllergenGlyph'), 'Profile does not render the glyph');
  assert.ok(!step.includes('AllergenGlyph'), 'the onboarding grid still draws the Lucide glyph');
  assert.ok(!/allergen-(peanut|tree-nut|shellfish)['.]/.test(step), 'a Lucide raster in the step');
  assert.ok(step.includes('allergenPictogram(option.token)'));
  for (const [name, source] of [
    ['form', form],
    ['step', step],
  ]) {
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(source), `${name} uses an emoji`);
    for (const foreign of [
      '@expo/vector-icons',
      'MaterialCommunityIcons',
      'Ionicons',
      'FontAwesome',
      'react-native-svg',
      '<Svg',
      '<Path',
    ]) {
      assert.ok(!source.includes(foreign), `${name} mixes in ${foreign}`);
    }
  }
  // One glyph component, one size, one treatment for every row.
  assert.ok(
    form.includes(
      "<Icon name={name} size={20} color={checked ? 'icon/primary' : 'icon/secondary'} />",
    ),
  );
  assert.equal((form.match(/<AllergenGlyph /g) ?? []).length, 1);
});
