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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { color, harmNoticePalette, type ColorToken } from '@/constants/design-tokens';

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
  // P2B2
  'ui/media-tile.tsx',
  'ui/callout.tsx',
  'ui/notice-label.tsx',
  // P2B3
  'ui/button.tsx',
  'ui/choice-row.tsx',
  // P2B6A
  'ui/check-row.tsx',
  // P2B7C
  'ui/official-image-set.tsx',
  // P2B7K, three separate boxes from P2B7V
  'ui/illness-notice.tsx',
];
const UI = Object.fromEntries(UI_FILES.map((f) => [f, read(join('components', f))]));
const TEXT = UI['ui/text.tsx'];
const SURFACE = UI['ui/surface.tsx'];
const DISCLOSURE = UI['ui/disclosure-control.tsx'];
const BUTTON = UI['ui/button.tsx'];
const RISK_LABEL = UI['ui/risk-label.tsx'];
const NOTICE_SOURCE = UI['ui/illness-notice.tsx'];
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

test('Critical has exactly one treatment: the palette is read only through named semantics', () => {
  // A READ of the palette (`riskPalette[` / `riskPalette.`), not a mention:
  // theme.ts re-exports it and comments may name it.
  //
  // P2B7K made this absolute — the Risk Label and nothing else — so that the
  // compact illness notice could not borrow Critical's red and become a
  // second Critical. P2B7V is the founder's deliberate reversal for ONE case,
  // and it is narrower than it looks: a reported death IS the app's most
  // severe consumer fact, and giving it a treatment of its own invented hue
  // would have been the second vocabulary this rule exists to prevent.
  //
  // What the rule becomes is therefore not "one reader" but "one definition,
  // reached only through a NAMED semantic map". `harmNoticePalette` in the
  // contract is that map, and it holds references rather than values (pinned
  // in `constants/design-tokens.test.ts`). No screen and no component may
  // index the risk palette directly; the Risk Label remains the only
  // component that does.
  const readers = clientSources()
    .filter(({ source }) => /riskPalette[[.]/.test(source))
    .map(({ path }) => path)
    .sort();
  assert.deepEqual(readers, [
    'components/ui/design-foundation.test.ts',
    'components/ui/risk-label.tsx',
    'constants/design-tokens.test.ts',
    'constants/design-tokens.ts',
  ]);
  // Components and screens reach severity only through the named maps.
  const components = clientSources().filter(
    ({ path }) => !path.endsWith('.test.ts') && !path.startsWith('constants/'),
  );
  for (const { path, source } of components) {
    if (path === 'components/ui/risk-label.tsx') continue;
    assert.ok(!/riskPalette[[.]/.test(source), `${path} indexes the risk palette directly`);
  }
});

test('the harm notices are one treatment map, read only by their own component', () => {
  const readers = clientSources()
    .filter(({ source }) => /harmNoticePalette[[.]/.test(source))
    .map(({ path }) => path)
    .sort();
  assert.deepEqual(readers, [
    'components/ui/design-foundation.test.ts',
    'components/ui/illness-notice.tsx',
    'constants/design-tokens.test.ts',
  ]);
  // The retired single-treatment palette is gone, not left dormant beside the
  // new one: no definition of it, and no read of it. Comments may still name
  // it — the contract explains what it replaced.
  for (const { path, source } of clientSources()) {
    if (path.endsWith('.test.ts')) continue;
    assert.ok(
      !source.includes('const illnessNoticePalette'),
      `${path} still defines the retired palette`,
    );
    assert.ok(!/illnessNoticePalette[[.]/.test(source), `${path} still reads the retired palette`);
  }
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

// ── The icon set resolves to real assets ────────────────────────────────────

test('every declared icon name resolves to a real, non-empty asset at 1x, 2x and 3x', () => {
  // The P2B7C correction's icon investigation: when glyphs stop rendering,
  // the first question is whether the app is asking for an asset that is not
  // there. This pins the whole mapping — every `IconName` the primitive
  // exports, every scale Metro may pick — so a renamed, deleted, emptied, or
  // wrongly-cased file fails here instead of appearing as a blank square on
  // a screen nobody screenshotted.
  const ICONS = join(SRC, '..', 'assets', 'icons');
  // React Native cannot load under Node, so the declared set is read from the
  // primitive's own `GLYPHS` map as text — the same technique this suite uses
  // for every other component contract.
  const icon = read('components/ui/icon.tsx');
  const ICON_NAMES = [...icon.matchAll(/^\s{2}'?([a-z-]+)'?: require\(/gm)].map((m) => m[1]);
  assert.ok(ICON_NAMES.length >= 12, `only ${ICON_NAMES.length} icons are declared`);
  for (const name of ICON_NAMES) {
    for (const suffix of ['', '@2x', '@3x']) {
      const file = join(ICONS, `${name}${suffix}.png`);
      assert.ok(existsSync(file), `missing icon asset: ${name}${suffix}.png`);
      assert.ok(statSync(file).size > 0, `empty icon asset: ${name}${suffix}.png`);
      // Metro resolves by exact, case-sensitive name: a file that differs
      // only in case resolves on macOS and fails on a case-sensitive CI or
      // device bundle.
      const onDisk = readdirSync(ICONS).find((entry) => entry === `${name}${suffix}.png`);
      assert.equal(onDisk, `${name}${suffix}.png`, `icon asset case mismatch: ${name}${suffix}`);
    }
  }
  // Every asset in the directory belongs to a declared name: an orphan file
  // is either a glyph nothing renders or a name the primitive forgot.
  for (const entry of readdirSync(ICONS)) {
    const name = entry.replace(/(@[23]x)?\.png$/, '');
    assert.ok(ICON_NAMES.includes(name), `${entry} is not declared by the icon primitive`);
  }
  // The primitive requires each glyph statically (Metro cannot bundle a
  // computed path), tints it, and hides it from assistive technology.
  for (const name of ICON_NAMES) {
    assert.ok(
      icon.includes(`require('@/assets/icons/${name}.png')`),
      `${name} is not statically required`,
    );
  }
  assert.ok(!/require\(`/.test(icon), 'a computed require cannot be bundled');
  assert.ok(icon.includes('tintColor: tint ?? color[colorToken]'));
  assert.ok(icon.includes('accessibilityElementsHidden'));
});

test('every icon surface renders through the one primitive — no local images or glyph text', () => {
  // A missing glyph is never patched screen by screen: every surface the
  // correction pass inspected draws from `Icon`, and none of them bundles an
  // image or types a symbol character of its own.
  const surfaces = [
    'app/(tabs)/_layout.tsx', // the three tab glyphs
    'app/(tabs)/index.tsx', // search, the card's pin, the chips' chevron
    'app/recall/[id].tsx', // the external-link and map-pin glyphs
    'components/recall-card.tsx',
    'components/save-recall-button.tsx', // bookmark / bookmark-filled
    'components/ui/search-bar.tsx',
    'components/ui/callout.tsx', // warning and info
    'components/profile/navigation-row.tsx', // the chevron
    'components/profile/personalization-card.tsx',
    'components/settings/selector-trigger.tsx',
  ];
  for (const path of surfaces) {
    const source = read(path);
    assert.match(source, /<Icon\b|Icon\b/, `${path} renders no icon`);
    assert.ok(!/require\('\.\.?\/.*\.png'\)/.test(source), `${path} bundles its own image`);
  }
  // …and none of the ICON-BEARING primitives substitutes a typed symbol for
  // a glyph, which is how a missing-asset defect gets papered over screen by
  // screen. (The Feed's filter sheet marks its selected option with a `✓`
  // character by its own shipped design — that is a selection channel, not
  // an icon stand-in, and it is deliberately not covered here.)
  for (const path of [
    'components/save-recall-button.tsx',
    'components/ui/callout.tsx',
    'components/profile/navigation-row.tsx',
    'app/(tabs)/_layout.tsx',
  ]) {
    const source = read(path);
    for (const glyph of ['✓', '✔', '×', '→', '★', '🔖']) {
      assert.ok(!source.includes(glyph), `${path} types a glyph character: ${glyph}`);
    }
  }
});

// ── Contrast: a disabled label is still text ────────────────────────────────

/** WCAG 2.x relative luminance of a `#RRGGBB` token value. */
function luminance(hex: string): number {
  const linear = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** The WCAG contrast ratio between two semantic tokens, computed from their values. */
function contrast(text: ColorToken, surface: ColorToken): number {
  const [light, dark] = [luminance(color[text]), luminance(color[surface])].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

test('every harm notice clears WCAG AA on its own severity fill, icon included', () => {
  // P2B7V puts sentence-case `caption` (12/500) and a 12pt glyph on the risk
  // palette's own fills. Neither is large text, so both answer to the 4.5:1
  // AA floor — and the glyph is tinted with the SAME foreground as the words,
  // so proving the text legible proves the icon legible too.
  const AA = 4.5;
  for (const [tone, palette] of Object.entries(harmNoticePalette)) {
    const [light, dark] = [luminance(palette.foreground), luminance(palette.background)].sort(
      (a, b) => b - a,
    );
    const ratio = (light + 0.05) / (dark + 0.05);
    assert.ok(ratio >= AA, `harm-notice/${tone} is ${ratio.toFixed(2)}:1, under the ${AA}:1 floor`);
  }
  // The component tints the glyph with the box's own foreground rather than a
  // semantic icon colour, which is what keeps the two in step.
  assert.ok(NOTICE_SOURCE.includes('tint={palette.foreground}'));
  assert.ok(!NOTICE_SOURCE.includes('color="icon/'), 'the glyph left the box’s own palette');
});

test('every Button label clears WCAG AA on its own surface — the disabled ones included', () => {
  // The shared Button is the only filled action in the system, so the pairs
  // are checked once here rather than screen by screen. 4.5:1 is the AA
  // floor for normal-size text, and `body-small-bold` (13/600) is nowhere
  // near the large-text exemption, so every state answers to it.
  const AA = 4.5;
  const pairs: [name: string, text: ColorToken, surface: ColorToken][] = [
    ['primary enabled', 'text/inverse', 'action/primary'],
    ['primary disabled', 'text/primary', 'action/disabled'],
    ['secondary enabled', 'text/primary', 'background/surface'],
    ['secondary disabled', 'text/secondary', 'background/surface'],
  ];
  for (const [name, text, surface] of pairs) {
    const ratio = contrast(text, surface);
    assert.ok(ratio >= AA, `${name} is ${ratio.toFixed(2)}:1, under the ${AA}:1 floor`);
  }

  // …and the component binds exactly those tokens, by variant and state.
  assert.ok(BUTTON.includes("primary: { enabled: 'text/inverse', disabled: 'text/primary' }"));
  assert.ok(BUTTON.includes("secondary: { enabled: 'text/primary', disabled: 'text/secondary' }"));
  assert.ok(BUTTON.includes("color={LABEL_COLOR[variant][inert ? 'disabled' : 'enabled']}"));

  // `text/disabled` is a fill-and-border grey, not a text colour: it is the
  // disabled surface itself, and near-invisible on white. A label may never
  // take it, which is the regression this test exists for.
  assert.ok(!BUTTON.includes("'text/disabled'"), 'a Button label took the disabled grey');
  assert.ok(contrast('text/disabled', 'action/disabled') < 1.5);
  assert.ok(contrast('text/disabled', 'background/surface') < 1.5);

  // Disabled stays announced, so the state has a channel besides colour.
  assert.ok(BUTTON.includes('accessibilityState={{ disabled: inert, busy }}'));
  assert.ok(BUTTON.includes('disabled={inert}'));
});

// ── P2B7F: an icon's source survives every remount ──────────────────────────
//
// In development a required PNG is fetched from the dev server at the address
// baked into the loaded bundle, so an icon that MOUNTS while that address is
// stale has nothing to draw while icons already on screen keep their bitmaps.
// That is an environment failure, not an app one
// (docs/recall-development-assets.md) — but it is indistinguishable on screen
// from an app bug that drops a source on re-render, and only these invariants
// keep the two apart. Each one, if broken, WOULD make the glyphs vanish in a
// release build too.

test('P2B7F: the primitive can never render an Image without a source', () => {
  const icon = read('components/ui/icon.tsx');

  // The source is passed straight from the table, unconditionally. Not
  // behind a ternary, not optional, not defaulted — there is no render path
  // that reaches `Image` without one.
  assert.ok(icon.includes('source={GLYPHS[name]}'), 'the source is no longer passed directly');
  assert.ok(
    !/source=\{[^}]*\?[^}]*\}/.test(icon),
    'the icon source became conditional — a remount could render it empty',
  );
  assert.ok(!/source=\{[^}]*undefined/.test(icon), 'the icon source can be undefined');

  // Exactly one `Image` renders here, so there is no second path with a
  // different source rule.
  assert.equal(
    [...icon.matchAll(/<Image\b/g)].length,
    1,
    'the primitive renders more than one Image',
  );
});

test('P2B7F: the glyph table is a module constant that no render can mutate', () => {
  const icon = read('components/ui/icon.tsx');

  // Built once, at module scope, frozen by `as const`. If it were rebuilt per
  // render the source identity would change on every re-render, which forces
  // the native view to re-request the asset — turning an ordinary re-render
  // into the fetch that fails.
  assert.ok(icon.includes('const GLYPHS = {'), 'the glyph table is no longer a const');
  assert.ok(icon.includes('} as const;'), 'the glyph table is no longer frozen by `as const`');
  const tableStart = icon.indexOf('const GLYPHS = {');
  const componentStart = icon.indexOf('export function Icon(');
  assert.ok(tableStart > -1 && componentStart > -1);
  assert.ok(tableStart < componentStart, 'the glyph table moved inside the component');

  // Nothing writes to it, at any point in the module's life.
  assert.ok(!/GLYPHS\[[^\]]+\]\s*=/.test(icon), 'something assigns into the glyph table');
  assert.ok(!/GLYPHS\s*=/.test(icon.slice(tableStart + 'const GLYPHS ='.length)));
  assert.ok(!/Object\.assign\(\s*GLYPHS/.test(icon), 'the glyph table is mutated');
  assert.ok(!/delete\s+GLYPHS/.test(icon), 'a glyph is deleted from the table');

  // The component holds no state, ref or memo of its own: there is no cached
  // copy of a resolved source that a remount could restore stale or empty.
  const component = icon.slice(componentStart);
  for (const hook of ['useState', 'useRef', 'useMemo', 'useEffect']) {
    assert.ok(!component.includes(hook), `the primitive caches its source in ${hook}`);
  }
});
