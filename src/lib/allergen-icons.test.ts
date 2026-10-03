/**
 * The allergen icons (P2B7X.1): every consumer allergen has one glyph, all
 * nine come from one family with recorded provenance, every raster exists
 * at the three scales on one box, and no second icon system reaches the
 * allergen rows.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { BUILDING_ICON_SOURCES } from './building-presentation';
import { NOTIFICATIONS_ICON_SOURCES } from './notification-education-presentation';
import { PAYWALL_ICON_SOURCES } from './onboarding-paywall-presentation';
import { READY_ICON_SOURCES } from './ready-presentation';
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
  // No source outside the nine, the States step's six (P2B7Y,
  // lib/state-map.ts), the Ready step's cart and lock
  // (lib/ready-presentation.ts), the onboarding paywall's file-search and
  // bell (lib/onboarding-paywall-presentation.ts) and the Building step's
  // map-pin and octagon-alert (lib/building-presentation.ts) and notification
  // education's shield-check (lib/notification-education-presentation.ts): a stray glyph
  // would be a second decision.
  // (The problem pictograph's user-round was vendored 2026-09-28 and
  // retired 2026-09-29 with the authored pictograph.)
  const vendored = readdirSync(SOURCES)
    .filter((f) => f.endsWith('.svg'))
    .sort();
  assert.deepEqual(
    vendored,
    [
      ...ALLERGEN_ICON_SOURCES,
      ...STATES_ICON_SOURCES,
      ...READY_ICON_SOURCES,
      ...PAYWALL_ICON_SOURCES,
      ...BUILDING_ICON_SOURCES,
      ...NOTIFICATIONS_ICON_SOURCES,
    ]
      .map((s) => `${s.lucideName}.svg`)
      .sort(),
  );
  for (const source of [
    ...STATES_ICON_SOURCES,
    ...READY_ICON_SOURCES,
    ...PAYWALL_ICON_SOURCES,
    ...BUILDING_ICON_SOURCES,
    ...NOTIFICATIONS_ICON_SOURCES,
  ]) {
    const svg = readFileSync(join(SOURCES, `${source.lucideName}.svg`), 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/, `${source.lucideName} is not on the 24 grid`);
    assert.match(svg, /stroke-width="2"/, `${source.lucideName} has a foreign stroke weight`);
  }
});

test('notification education’s shield-check is Lucide’s own glyph at the pinned commit, rasterised natively at every scale', () => {
  // Byte-identical to lucide-icons/lucide@f06ac67e…/icons/shield-check.svg,
  // retrieved from the pinned commit on 2026-10-03.
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(
    sha(join(SOURCES, 'shield-check.svg')),
    '8d4fcdbde5bba4abb1a2f6fe53e37ceb6343a1d5449a9d88f6f97c1971d26c4e',
  );
  const ICONS = join(SOURCES, '..', '..', 'icons');
  assert.deepEqual(
    ['', '@2x', '@3x'].map((suffix) => sha(join(ICONS, `shield-check${suffix}.png`))),
    [
      '43fb7f7c4099c109098fbccb75f2d358094970bd56b874aa00597c4e0aebb05a',
      '5ff42e62bd077135c5307c16fbfb0a888a3c0997e9f2f51797759eefb6878f04',
      'd0ff6fff21c5c23f7ee9103cfccf4256969e115e2a2ab11bee2511d5772fd1e3',
    ],
  );
});

test('the Ready cart is Lucide’s own shopping-cart at the pinned commit, rasterised natively at every scale', () => {
  // Byte-identical to lucide-icons/lucide@f06ac67e…/icons/shopping-cart.svg,
  // verified against the pinned commit on 2026-09-26, as every vendored source is.
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(
    sha(join(SOURCES, 'shopping-cart.svg')),
    '7cdc07053044af9e5fd24fff5e089ce97b2a39ea978933a160c4bbfebf8a167c',
  );
  // The three files are true 24, 48 and 72px rasterisations of that source
  // (scripts/render-onboarding-assets.mjs, `native`), not one 24px bitmap
  // stretched; the renderer is deterministic, so the verified bytes are pinned.
  const ICONS = join(SOURCES, '..', '..', 'icons');
  assert.deepEqual(
    ['', '@2x', '@3x'].map((suffix) => sha(join(ICONS, `shopping-cart${suffix}.png`))),
    [
      'e84f0db572f9d6daee6faf5a2bdbdd8ccb1cc711cc0f476bb433cc4a1ac96928',
      'cc774d083446101bce37ad91eba07d8b4b790a15850221705a4f3676d967eb44',
      '54d204d496204a38e40de2f20b725cba01497785580a755f6947dce0482892d5',
    ],
  );
});

test('the paywall’s file-search and bell are Lucide’s own glyphs at the pinned commit, rasterised natively at every scale', () => {
  // Byte-identical to lucide-icons/lucide@f06ac67e…/icons/file-search-corner.svg
  // and …/icons/bell.svg, retrieved from the pinned commit on 2026-10-01 (the
  // same fetch reproduced the vendored shopping-cart byte for byte).
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(
    sha(join(SOURCES, 'file-search-corner.svg')),
    '4830c66d8d8b4218a9945b6f2673942bb79e4638fa5fb4df051d61e3a9629a85',
  );
  assert.equal(
    sha(join(SOURCES, 'bell.svg')),
    '394889e9631fe3a9a63be9a479a95b451b708e432d895978d21d9130b5ee5dbe',
  );
  // True 24, 48 and 72px rasterisations (scripts/render-onboarding-assets.mjs,
  // `native`); the renderer is deterministic, so the verified bytes are pinned.
  const ICONS = join(SOURCES, '..', '..', 'icons');
  const files = (icon: string) =>
    ['', '@2x', '@3x'].map((suffix) => sha(join(ICONS, `${icon}${suffix}.png`)));
  assert.deepEqual(files('file-search'), [
    '8cad5f66ad4e9d8a9df79f2edb3a940173dbd2410377c7ae52c69a86bb98e819',
    'a0f4147ec6b842f18141bb3de21b2657c0aa780df33430365a4ef0d0877ce362',
    'c9a722eaf04022bf07d31ff2f7cdefead39f9e0862d7670d255b4c5f6562ff92',
  ]);
  assert.deepEqual(files('bell'), [
    'bd0f6879909e3d9886e872594531a976874e46965c38b367ccf509b5d7694753',
    'c2d57f7c95b22a32e616197fbbb70a42fcdbe756d2222c0de065ac22169aa46f',
    '8e470d2eda85c3ba27e416dc604674d224ff1472c444ad7d46a48a0d796c6d66',
  ]);
  assert.deepEqual(
    PAYWALL_ICON_SOURCES.map((s) => s.icon),
    ['file-search', 'bell'],
  );
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
