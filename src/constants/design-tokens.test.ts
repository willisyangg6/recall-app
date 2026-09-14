/**
 * The design tokens (P2B0), pinned to the design contract.
 *
 * DESIGN.md's front matter is the founder-readable statement of every token;
 * `design-tokens.ts` is the code's. These tests parse the former and compare
 * it to the latter, name by name and value by value, so neither can change
 * without the other — and they pin the properties the contract promises:
 * the complete seven-label risk palette, relevance kept apart from risk, the
 * spacing and radius scales, the type scale's resolved line heights, the
 * minimum touch target, and the font-installation flag's honesty against
 * package.json.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { ConsumerRiskTier } from '@/domain/risk-tier';
import {
  color,
  CUSTOM_FONTS_INSTALLED,
  elevation,
  FONT_PACKAGES,
  fontFace,
  fontFamily,
  hitSlopToMinimum,
  hitTarget,
  iconSize,
  layout,
  radius,
  relevancePalette,
  REQUIRED_FONT_FACES,
  RISK_TOKEN_NAME,
  riskPalette,
  spacing,
  textStyle,
  typography,
  type TypographyVariant,
} from './design-tokens';

const ROOT = join(__dirname, '..', '..');
const DESIGN_MD = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8');
const TOKENS_SOURCE = readFileSync(join(__dirname, 'design-tokens.ts'), 'utf8');
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

// ── The contract's front matter, parsed ─────────────────────────────────────

type Tree = { [key: string]: string | Tree };

/**
 * A deliberately small reader for the front matter's shape — nested maps of
 * scalars, two-space indentation, optional quotes. No YAML dependency, and
 * nothing here needs one.
 */
function parseFrontMatter(markdown: string): Tree {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'DESIGN.md must open with a YAML front matter block');
  const root: Tree = {};
  const stack: { indent: number; node: Tree }[] = [{ indent: -1, node: root }];
  for (const raw of match[1].split('\n')) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const separator = raw.indexOf(':');
    const key = raw.slice(0, separator).trim();
    let value = raw.slice(separator + 1).trim();
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (value === '') {
      const node: Tree = {};
      parent[key] = node;
      stack.push({ indent, node });
      continue;
    }
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    parent[key] = value;
  }
  return root;
}

function section(tree: Tree, name: string): Record<string, string> {
  const node = tree[name];
  assert.equal(typeof node, 'object', `front matter has a "${name}" section`);
  return node as Record<string, string>;
}

const FRONT_MATTER = parseFrontMatter(DESIGN_MD);

const TIERS: ConsumerRiskTier[] = [
  'critical',
  'very_high',
  'high',
  'moderate',
  'low',
  'pending',
  'unknown',
];

const HEX = /^#[0-9A-F]{6}$/;

function hue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return (((h * 60) % 360) + 360) % 360;
}

// ── Semantic colours ────────────────────────────────────────────────────────

test('every semantic colour token equals the value DESIGN.md approves, by its Figma name', () => {
  const approved = section(FRONT_MATTER, 'colors');
  for (const [name, value] of Object.entries(color)) {
    assert.equal(value, approved[name], `color['${name}']`);
  }
});

test('the contract names no colour the code lacks, and vice versa', () => {
  const approved = Object.keys(section(FRONT_MATTER, 'colors')).sort();
  const inCode = [
    ...Object.keys(color),
    ...TIERS.flatMap((tier) =>
      ['background', 'foreground', 'border'].map((part) => `${RISK_TOKEN_NAME[tier]}/${part}`),
    ),
    ...['background', 'foreground', 'border'].map((part) => `relevance/affects-you/${part}`),
  ].sort();
  assert.deepEqual(inCode, approved);
});

test('every colour is an uppercase six-digit hex — the form the contract writes', () => {
  const all = [
    ...Object.values(color),
    ...Object.values(riskPalette).flatMap((p) => [p.background, p.foreground, p.border]),
    ...Object.values(relevancePalette).flatMap((p) => [p.background, p.foreground, p.border]),
    elevation.card.shadowColor,
  ];
  for (const value of all) assert.match(value, HEX);
});

test('the primitive Figma reds (tomato/500, tomato/300) are not tokens', () => {
  assert.ok(!TOKENS_SOURCE.includes('tomato'));
  // tomato/300 — the retired label/Critical border — appears nowhere.
  assert.ok(!TOKENS_SOURCE.toUpperCase().includes('#FF6C61'));
});

// ── The seven-label risk palette ────────────────────────────────────────────

test('the risk palette is exactly the seven consumer labels, in severity order', () => {
  assert.deepEqual(Object.keys(riskPalette), TIERS);
});

test('each risk label carries the approved background, foreground and border', () => {
  const approved = section(FRONT_MATTER, 'colors');
  for (const tier of TIERS) {
    const name = RISK_TOKEN_NAME[tier];
    assert.equal(riskPalette[tier].background, approved[`${name}/background`], `${name} bg`);
    assert.equal(riskPalette[tier].foreground, approved[`${name}/foreground`], `${name} fg`);
    assert.equal(riskPalette[tier].border, approved[`${name}/border`], `${name} border`);
  }
});

test('Critical is the canonical semantic treatment — never the old dark red on white', () => {
  assert.deepEqual(riskPalette.critical, {
    background: '#EF4E47',
    foreground: '#001F3E',
    border: '#C82728',
  });
  assert.notEqual(riskPalette.critical.foreground, '#FFFFFF');
  assert.notEqual(riskPalette.critical.background, '#C82728');
});

test('the severity spectrum runs red to yellow with no green, and Pending/Unknown leave it', () => {
  const severity: ConsumerRiskTier[] = ['critical', 'very_high', 'high', 'moderate', 'low'];
  let previous = -1;
  for (const tier of severity) {
    const h = hue(riskPalette[tier].background);
    assert.ok(h < 70, `${tier} background hue ${h.toFixed(0)}° is red-to-yellow`);
    assert.ok(h >= previous, `${tier} sits at or past the previous tier on the hue wheel`);
    previous = h;
  }
  for (const tier of TIERS) {
    const h = hue(riskPalette[tier].background);
    assert.ok(h < 75 || h > 165, `${tier} background is not green (${h.toFixed(0)}°)`);
  }
  // The two non-severity states are blue-grey and grey: off the spectrum.
  assert.ok(hue(riskPalette.pending.background) > 180);
  assert.equal(riskPalette.unknown.background, color['background/media-placeholder']);
});

test('the six navy-text labels share text/primary; Unknown carries its own legible grey', () => {
  for (const tier of TIERS) {
    if (tier === 'unknown') continue;
    assert.equal(riskPalette[tier].foreground, color['text/primary']);
  }
  assert.equal(riskPalette.unknown.foreground, '#4B585E');
});

// ── Relevance is not risk ───────────────────────────────────────────────────

test('Affects You lives in its own palette and is not a risk tier', () => {
  assert.deepEqual(Object.keys(relevancePalette), ['affects-you']);
  assert.ok(!('affects-you' in riskPalette));
  assert.ok(!('affects_you' in riskPalette));
  assert.deepEqual(relevancePalette['affects-you'], {
    background: '#E2EE57',
    foreground: '#001F3E',
    border: '#ADB600',
  });
  // Lime is the accent, and no risk label uses it.
  assert.equal(relevancePalette['affects-you'].background, color['background/accent']);
  for (const tier of TIERS) {
    assert.notEqual(riskPalette[tier].background, relevancePalette['affects-you'].background);
  }
});

// ── Scales ──────────────────────────────────────────────────────────────────

test('spacing is exactly the approved scale, keyed by its own value', () => {
  const approved = section(FRONT_MATTER, 'spacing');
  assert.deepEqual(Object.values(spacing), [4, 8, 12, 16, 24, 32, 48]);
  for (const [key, value] of Object.entries(spacing)) {
    assert.equal(Number(key), value);
    assert.equal(approved[`spacing/${key}`], `${value}px`);
  }
});

test('radius is exactly the approved scale, plus the pill', () => {
  const approved = section(FRONT_MATTER, 'radius');
  assert.deepEqual(radius, { 4: 4, 8: 8, 12: 12, 16: 16, full: 999 });
  for (const [key, value] of Object.entries(radius)) {
    assert.equal(approved[`radius/${key}`], `${value}px`);
  }
});

test('icon sizes are the approved four', () => {
  const approved = section(FRONT_MATTER, 'icon-size');
  assert.deepEqual(Object.values(iconSize), [12, 16, 20, 24]);
  for (const [key, value] of Object.entries(iconSize)) {
    assert.equal(Number(key), value);
    assert.equal(approved[`icon-size/${key}`], `${value}px`);
  }
});

test('the reference layout is recorded, and 16 is the one value that carries over', () => {
  const approved = section(FRONT_MATTER, 'layout');
  assert.equal(approved['reference-width'], `${layout.referenceWidth}px`);
  assert.equal(approved['page-margin'], `${layout.pageMargin}px`);
  assert.equal(approved['content-width'], `${layout.contentWidth}px`);
  assert.equal(approved['bottom-nav-height'], `${layout.bottomNavHeight}px`);
  assert.equal(approved['search-bar-height'], `${layout.searchBarHeight}px`);
  assert.equal(approved['risk-label-height'], `${layout.riskLabelHeight}px`);
  assert.equal(layout.contentWidth, layout.referenceWidth - 2 * layout.pageMargin);
  assert.equal(layout.pageMargin, spacing[16]);
  assert.equal(layout.searchBarHeight, hitTarget.minimum);
});

// ── Elevation ───────────────────────────────────────────────────────────────

test('the one card elevation is 0 2px 8px at 6% black, with an Android equivalent', () => {
  const approved = section(FRONT_MATTER, 'elevation');
  const card = elevation.card;
  assert.equal(
    approved['elevation/card'],
    `0 ${card.shadowOffset.height}px ${card.shadowRadius}px rgba(0, 0, 0, ${card.shadowOpacity})`,
  );
  assert.deepEqual(card, {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    shadowOpacity: 0.06,
    elevation: 2,
  });
  assert.equal(approved['elevation/none'], 'none');
  assert.equal(elevation.none.shadowOpacity, 0);
  assert.equal(elevation.none.elevation, 0);
});

// ── Typography ──────────────────────────────────────────────────────────────

test('every typography token matches the contract: family, size, weight, ratio, tracking', () => {
  const approved = section(FRONT_MATTER, 'typography') as unknown as Record<
    string,
    Record<string, string>
  >;
  assert.deepEqual(Object.keys(typography).sort(), Object.keys(approved).sort());
  for (const [variant, token] of Object.entries(typography)) {
    const spec = approved[variant];
    assert.equal(fontFamily[token.family], spec.fontFamily, `${variant} family`);
    assert.equal(`${token.fontSize}px`, spec.fontSize, `${variant} size`);
    assert.equal(token.fontWeight, spec.fontWeight, `${variant} weight`);
    assert.equal(String(token.lineHeightRatio), spec.lineHeight, `${variant} ratio`);
    const em = Math.round((token.letterSpacing / token.fontSize) * 1000) / 1000;
    assert.equal(`${em}em`, spec.letterSpacing, `${variant} tracking`);
  }
});

test('line heights are the ratio resolved to whole points, the way Figma draws them', () => {
  for (const [variant, token] of Object.entries(typography)) {
    assert.equal(token.lineHeight, Math.round(token.fontSize * token.lineHeightRatio), variant);
    assert.ok(Number.isInteger(token.lineHeight));
    assert.ok(Number.isInteger(token.fontSize));
  }
  assert.equal(typography['heading-3'].lineHeight, 26);
  assert.equal(typography['heading-2'].lineHeight, 30);
  assert.equal(typography.body.lineHeight, 24);
  assert.equal(typography.caption.lineHeight, 16);
});

test('only the two label styles are monospace, and only they carry tracking', () => {
  for (const [variant, token] of Object.entries(typography)) {
    const mono = variant === 'label' || variant === 'label-strong';
    assert.equal(token.family, mono ? 'mono' : 'sans', variant);
    assert.equal(token.letterSpacing, mono ? 0.24 : 0, variant);
  }
});

test('the approved sizes are the only sizes', () => {
  const sizes = new Set(Object.values(typography).map((t) => t.fontSize));
  assert.deepEqual(
    [...sizes].sort((a, b) => a - b),
    [10, 12, 13, 16, 19, 23, 28, 33],
  );
});

test('a text style resolves the platform face at the token weight until the fonts are installed', () => {
  for (const variant of Object.keys(typography) as TypographyVariant[]) {
    const style = textStyle(variant);
    const token = typography[variant];
    assert.equal(style.fontSize, token.fontSize);
    assert.equal(style.lineHeight, token.lineHeight);
    assert.equal(style.letterSpacing, token.letterSpacing);
    if (CUSTOM_FONTS_INSTALLED) {
      assert.equal(style.fontFamily, fontFace[token.face]);
      assert.equal(style.fontWeight, undefined, 'a registered face carries its own weight');
    } else {
      assert.equal(style.fontFamily, undefined);
      assert.equal(style.fontWeight, token.fontWeight);
    }
  }
});

test("the six faces are exactly the contract's weights, named as @expo-google-fonts registers them", () => {
  assert.deepEqual(Object.keys(fontFace), [
    'sans-400',
    'sans-500',
    'sans-600',
    'sans-700',
    'mono-500',
    'mono-600',
  ]);
  for (const [key, name] of Object.entries(fontFace)) {
    const [family, weight] = key.split('-');
    const prefix = family === 'sans' ? 'PublicSans' : 'IBMPlexMono';
    const suffix = { '400': 'Regular', '500': 'Medium', '600': 'SemiBold', '700': 'Bold' }[weight];
    assert.equal(name, `${prefix}_${weight}${suffix}`);
  }
  assert.deepEqual(REQUIRED_FONT_FACES, Object.values(fontFace));
  // Every typography token renders in one of those six — no seventh face.
  for (const [variant, token] of Object.entries(typography)) {
    assert.ok(token.face in fontFace, variant);
    assert.equal(token.face, `${token.family}-${token.fontWeight}`);
  }
});

test('each required face ships in the installed package at the exact weight', () => {
  if (!CUSTOM_FONTS_INSTALLED) return;
  for (const [key, name] of Object.entries(fontFace)) {
    const pkg = key.startsWith('sans') ? 'public-sans' : 'ibm-plex-mono';
    const folder = name.split('_')[1];
    const ttf = join(ROOT, 'node_modules', '@expo-google-fonts', pkg, folder, `${name}.ttf`);
    assert.ok(existsSync(ttf), `${name} exists at ${ttf}`);
    const index = readFileSync(
      join(ROOT, 'node_modules', '@expo-google-fonts', pkg, 'index.js'),
      'utf8',
    );
    assert.ok(index.includes(`export const ${name} `), `${pkg} exports ${name}`);
  }
});

test('the root layout loads exactly the six required faces before the first screen', () => {
  const layout = readFileSync(join(ROOT, 'src', 'app', '_layout.tsx'), 'utf8');
  const loaded = layout.match(/useFonts\(\{([\s\S]*?)\}\)/);
  assert.ok(loaded, 'the root layout calls useFonts once');
  const names = loaded[1]
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '');
  assert.deepEqual(names.sort(), [...REQUIRED_FONT_FACES].sort());
  // No face is imported that the contract does not use.
  const imported = [...layout.matchAll(/\b(PublicSans|IBMPlexMono)_\d{3}[A-Za-z]+/g)].map(
    (m) => m[0],
  );
  assert.deepEqual([...new Set(imported)].sort(), [...REQUIRED_FONT_FACES].sort());
  // The splash stays up until the fonts settle, and a failure never leaves
  // the app blank.
  assert.match(layout, /^void SplashScreen\.preventAutoHideAsync\(\);$/m);
  assert.match(layout, /if \(fontsLoaded \|\| fontError\) void SplashScreen\.hideAsync\(\);/);
  assert.match(layout, /if \(!fontsLoaded && !fontError\) return null;/);
});

test('CUSTOM_FONTS_INSTALLED tells the truth about package.json', () => {
  const declared = { ...PACKAGE_JSON.dependencies, ...PACKAGE_JSON.devDependencies };
  const installed = FONT_PACKAGES.every((name) => name in declared);
  assert.equal(
    CUSTOM_FONTS_INSTALLED,
    installed,
    `flag ${CUSTOM_FONTS_INSTALLED} but packages ${installed ? 'present' : 'absent'}: ${FONT_PACKAGES.join(', ')}`,
  );
  assert.deepEqual(FONT_PACKAGES, [
    '@expo-google-fonts/public-sans',
    '@expo-google-fonts/ibm-plex-mono',
    'expo-font',
  ]);
});

// ── Touch target ────────────────────────────────────────────────────────────

test('the minimum interactive target is 44pt, and hitSlop closes exactly the gap', () => {
  assert.equal(hitTarget.minimum, 44);
  assert.equal(section(FRONT_MATTER, 'hit-target').minimum, '44pt');
  assert.deepEqual(hitSlopToMinimum(16), { top: 14, bottom: 14, left: 0, right: 0 });
  assert.deepEqual(hitSlopToMinimum(24, 24), { top: 10, bottom: 10, left: 10, right: 10 });
  assert.deepEqual(hitSlopToMinimum(44, 44), { top: 0, bottom: 0, left: 0, right: 0 });
  assert.deepEqual(hitSlopToMinimum(60, 200), { top: 0, bottom: 0, left: 0, right: 0 });
  // An odd gap rounds UP, so the target is never a half-point short.
  assert.deepEqual(hitSlopToMinimum(17), { top: 14, bottom: 14, left: 0, right: 0 });
});

// ── Nothing accidental ──────────────────────────────────────────────────────

test('no accidental fractional Figma value was copied into the tokens', () => {
  for (const accidental of [
    '17.786',
    '11.233',
    '12.169',
    '14.978',
    '7.489',
    '3.744',
    '13.106',
    '18.722',
    '194.711',
    '202.437',
  ]) {
    assert.ok(!TOKENS_SOURCE.includes(accidental), `tokens must not contain ${accidental}`);
  }
  for (const value of [
    ...Object.values(spacing),
    ...Object.values(radius),
    ...Object.values(iconSize),
    ...Object.values(layout),
  ]) {
    assert.ok(Number.isInteger(value), `${value} is a whole point`);
  }
});

test('the token module is a leaf: only type imports, no runtime dependency', () => {
  const imports = [...TOKENS_SOURCE.matchAll(/^import .* from '([^']+)';$/gm)];
  assert.deepEqual(
    imports.map((m) => m[1]),
    ['react-native', '@/domain/risk-tier'],
  );
  for (const m of imports) assert.match(m[0], /^import type /, m[0]);
});
