/**
 * The shared primitives (P2B0), pinned at the source level.
 *
 * React Native components cannot render under Node, so these tests read the
 * primitives and their call sites as text — the same technique the
 * design-preview and saved-recalls suites use — and pin what the design
 * contract promises about them: they consume semantic tokens and nothing
 * primitive, they take spacing and radii only from the scales, the one Risk
 * Label is what every risk surface renders through, Critical has no second
 * treatment anywhere, `Affects You` never passes through the risk path, and
 * every shared interactive primitive reaches the 44pt target.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const SRC = join(__dirname, '..', '..');
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');

const UI_FILES = [
  'ui/text.tsx',
  'ui/surface.tsx',
  'ui/disclosure-control.tsx',
  'ui/risk-label.tsx',
  // P2B1
  'ui/icon.tsx',
  'ui/relevance-label.tsx',
  'ui/chip.tsx',
  'ui/search-bar.tsx',
];
const UI = Object.fromEntries(UI_FILES.map((f) => [f, read(join('components', f))]));
const TEXT = UI['ui/text.tsx'];
const SURFACE = UI['ui/surface.tsx'];
const DISCLOSURE = UI['ui/disclosure-control.tsx'];
const RISK_LABEL = UI['ui/risk-label.tsx'];
const CARD = read('components/recall-card.tsx');
const DETAIL = read('app/recall/[id].tsx');
const PREVIEW = read('app/design-preview/index.tsx');
const THEME = read('constants/theme.ts');
const USE_THEME = read('hooks/use-theme.ts');

/** Every client source file: app, components, lib, hooks, constants, content, domain. */
function clientSources(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  for (const dir of ['app', 'components', 'lib', 'hooks', 'constants', 'content', 'domain']) {
    for (const entry of readdirSync(join(SRC, dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath, entry.name);
      out.push({ path: path.slice(SRC.length + 1), source: readFileSync(path, 'utf8') });
    }
  }
  return out;
}

const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/;
const OFF_SCALE_NUMBER = /\b(padding|margin|gap|rowGap|columnGap|borderRadius)[A-Za-z]*:\s*-?\d/;

// ── Tokens in, primitives out ───────────────────────────────────────────────

test('every shared primitive consumes the design tokens and spells no colour of its own', () => {
  for (const [name, source] of Object.entries(UI)) {
    assert.ok(source.includes("from '@/constants/design-tokens'"), `${name} imports the tokens`);
    assert.ok(
      !source.includes("from '@/constants/theme'"),
      `${name} does not use the legacy theme`,
    );
    assert.ok(!HEX_LITERAL.test(source), `${name} contains no hex literal`);
    assert.ok(!source.includes('Colors.'), `${name} does not read the legacy palette`);
  }
});

test('spacing and radii in the primitives come only from the approved scales', () => {
  for (const [name, source] of Object.entries(UI)) {
    assert.ok(!OFF_SCALE_NUMBER.test(source), `${name} has no numeric padding/margin/gap/radius`);
  }
  assert.ok(RISK_LABEL.includes('paddingHorizontal: spacing[8]'));
  assert.ok(RISK_LABEL.includes('paddingVertical: spacing[4]'));
  assert.ok(RISK_LABEL.includes('borderRadius: radius[4]'));
  assert.ok(SURFACE.includes('borderRadius: radius[radiusStep]'));
});

test('the text primitive resolves a typography variant and a semantic colour, and never caps Dynamic Type', () => {
  assert.ok(TEXT.includes('textStyle(variant)'));
  assert.ok(TEXT.includes('color: color[colorToken]'));
  assert.ok(TEXT.includes("Omit<NativeTextProps, 'maxFontSizeMultiplier'>"));
  assert.ok(!/maxFontSizeMultiplier=/.test(TEXT));
  assert.ok(TEXT.includes("variant = 'body'"));
  assert.ok(TEXT.includes("'text/primary'"));
});

test('the surface primitive takes only semantic background, border and elevation tokens', () => {
  assert.ok(SURFACE.includes('backgroundColor: color[background]'));
  assert.ok(SURFACE.includes('borderColor: color[border]'));
  assert.ok(SURFACE.includes('elevation[level]'));
  assert.ok(SURFACE.includes('background?: BackgroundToken'));
  assert.ok(SURFACE.includes('border?: BorderToken'));
});

// ── The one Risk Label ──────────────────────────────────────────────────────

test('the Risk Label looks its treatment up by the domain tier from the seven-label palette', () => {
  assert.ok(RISK_LABEL.includes('tier: ConsumerRiskTier;'));
  assert.ok(RISK_LABEL.includes('const palette = riskPalette[tier];'));
  assert.ok(RISK_LABEL.includes('backgroundColor: palette.background'));
  assert.ok(RISK_LABEL.includes('borderColor: palette.border'));
  assert.ok(RISK_LABEL.includes('color: palette.foreground'));
  assert.ok(RISK_LABEL.includes('borderWidth: 1'));
  assert.ok(RISK_LABEL.includes('variant="label"'));
  assert.ok(RISK_LABEL.includes('minHeight: layout.riskLabelHeight'));
  // One size. The retired "large" Detail variant is gone.
  assert.ok(!/size\??:/.test(RISK_LABEL));
  assert.ok(!RISK_LABEL.includes('large'));
  // The spoken label is mandatory and comes from the caller's contract.
  assert.ok(RISK_LABEL.includes('accessibilityLabel: string;'));
  assert.ok(RISK_LABEL.includes('accessibilityLabel={accessibilityLabel}'));
});

test('the feed card and Recall Detail render risk through the one Risk Label, at one size', () => {
  for (const [name, source] of [
    ['recall-card', CARD],
    ['detail', DETAIL],
    ['design-preview', PREVIEW],
  ]) {
    assert.ok(
      source.includes("import { RiskLabel } from '@/components/ui/risk-label';"),
      `${name} imports RiskLabel`,
    );
    assert.ok(!source.includes('RiskBadge'), `${name} has no RiskBadge`);
    assert.ok(!source.includes('size="large"'), `${name} has no large variant`);
  }
});

test('Critical has exactly one treatment: the palette is read only by the Risk Label', () => {
  // A READ of the palette (`riskPalette[` / `riskPalette.`), not a mention:
  // theme.ts re-exports it and comments may name it.
  const readers = clientSources()
    .filter(({ source }) => /riskPalette[[.]/.test(source))
    .map(({ path }) => path)
    .sort();
  assert.deepEqual(readers, [
    'components/ui/design-foundation.test.ts',
    'components/ui/risk-label.tsx',
    'constants/design-tokens.test.ts',
  ]);
});

test('the provisional risk palette and every retired red are gone from the client', () => {
  const retired = [
    'RiskColors',
    'useRiskColors',
    'RiskBadge',
    'risk-badge',
    'tomato/',
    // The provisional badge colours (light and dark), and the obsolete
    // label/Critical treatment.
    '#8E1519',
    '#B4400C',
    '#A85E06',
    '#8A6A00',
    '#F5DE8A',
    '#B3261E',
    '#C2450F',
    '#8F7000',
    '#E8D488',
    '#FF6C61',
  ];
  // Product code only: tests are allowed to name what they forbid.
  for (const { path, source } of clientSources().filter((f) => !/\.test\.tsx?$/.test(f.path))) {
    for (const token of retired) {
      assert.ok(!source.toUpperCase().includes(token.toUpperCase()), `${path} contains ${token}`);
    }
  }
  assert.ok(THEME.includes("export * from '@/constants/design-tokens';"));
  assert.ok(THEME.includes('Legacy provisional'));
  assert.ok(!USE_THEME.includes('Risk'));
});

// ── Relevance is not risk ───────────────────────────────────────────────────

test('Affects You never passes through the Risk Label', () => {
  // Every RiskLabel on the card and Detail is fed the model's risk tier, and
  // the Affects-you flag renders through a different element.
  const cardLabels = CARD.match(/<RiskLabel[\s\S]*?\/>/g) ?? [];
  assert.equal(cardLabels.length, 1);
  assert.ok(cardLabels[0].includes('tier={model.risk.tier}'));
  assert.ok(CARD.includes('{model.affectsYou ? <RelevanceLabel /> : null}'));
  const detailLabels = DETAIL.match(/<RiskLabel[\s\S]*?\/>/g) ?? [];
  assert.equal(detailLabels.length, 1);
  assert.ok(detailLabels[0].includes('tier={model.risk.tier}'));
  assert.ok(!RISK_LABEL.toLowerCase().includes('relevancepalette'));
});

// ── The disclosure control ──────────────────────────────────────────────────

test('the disclosure control is a button with an expanded state and a 44pt target', () => {
  assert.ok(DISCLOSURE.includes('accessibilityRole="button"'));
  assert.ok(DISCLOSURE.includes('accessibilityState={{ expanded }}'));
  assert.ok(DISCLOSURE.includes('hitSlopToMinimum(typography.caption.lineHeight)'));
  assert.ok(DISCLOSURE.includes('hitSlop={HIT_SLOP}'));
  // Words and spoken labels are the presentation contract's, never local.
  assert.ok(DISCLOSURE.includes('control.expandLabel'));
  assert.ok(DISCLOSURE.includes('control.collapseLabel'));
  assert.ok(DISCLOSURE.includes('control.expandAccessibilityLabel'));
  assert.ok(DISCLOSURE.includes('control.collapseAccessibilityLabel'));
  const code = DISCLOSURE.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/See all|Show less/.test(code), 'no local disclosure wording');
  assert.ok(DISCLOSURE.includes('color="action/secondary"'));
});

test('Recall Detail renders every in-place reveal through the shared control', () => {
  assert.ok(
    DETAIL.includes("import { DisclosureControl } from '@/components/ui/disclosure-control';"),
  );
  assert.ok(!DETAIL.includes('function DisclosureButton'));
  assert.ok(!DETAIL.includes('DISCLOSURE_HIT_SLOP'));
  const uses = DETAIL.match(/<DisclosureControl\b/g) ?? [];
  // Jurisdictions, product rows, and cells: three sites, none local.
  assert.equal(uses.length, 3);
});

// ── The development gallery ─────────────────────────────────────────────────

test('the gallery renders the primitives, dev-only, without inventing recall content', () => {
  assert.ok(PREVIEW.includes('DESIGN FOUNDATION'));
  assert.ok(PREVIEW.includes("import { Surface } from '@/components/ui/surface';"));
  assert.ok(PREVIEW.includes("import { Text } from '@/components/ui/text';"));
  assert.ok(PREVIEW.includes("disclosureControl(22, 'lot codes')"));
  assert.ok(PREVIEW.includes('Object.keys(typography)'));
  // The hub is still the only entry, still behind __DEV__ on Profile.
  assert.ok(read('app/(tabs)/profile.tsx').includes('{__DEV__ ? ('));
});
