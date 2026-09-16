/**
 * The Lotly Recall Detail (P2B2), pinned at the source level.
 *
 * React Native components cannot render under Node, so — as the feed-design,
 * design-foundation and wiring suites do — these tests read the screen, the
 * primitives it uses and the layouts as text and pin what the milestone
 * promises: the pushed-screen back control never reads "(tabs)"; the screen
 * draws its text and geometry from the type scale and the tokens only; the
 * section order is the contract's; community context stays beneath the
 * official geography; every disclosure threshold and the paired
 * identifier/date rendering are unchanged; no production gate or business
 * logic moved; and nothing inert was copied from Figma. The behavioural
 * contracts themselves are pinned where they always were (the wiring,
 * detail-disclosure and presentation suites); this file pins the restyle.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { layout, typography } from '@/constants/design-tokens';
import {
  DESIGN_PREVIEW_SCENARIOS,
  GUIDE_REQUIREMENTS,
  RISK_REQUIREMENTS,
} from '@/lib/design-preview';
import {
  DETAIL_ERROR_TITLE,
  DETAIL_LOADING,
  DETAIL_MISSING,
  retractedNotice,
} from '@/lib/detail-copy';
import {
  AFFECTED_PRODUCTS_INITIAL_ROWS,
  disclosureControl,
  WHERE_SOLD_INITIAL_STATES,
} from '@/lib/recall-presentation';

const SRC = join(__dirname, '..');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');

const DETAIL = read('app', 'recall', '[id].tsx');
const ROOT_LAYOUT = read('app', '_layout.tsx');
const TAB_LAYOUT = read('app', '(tabs)', '_layout.tsx');
const COMMUNITY = read('components', 'community-reports-section.tsx');
const STATE_MESSAGE = read('components', 'state-message.tsx');
const CALLOUT = read('components', 'ui', 'callout.tsx');
const MEDIA_TILE = read('components', 'ui', 'media-tile.tsx');
const NOTICE_LABEL = read('components', 'ui', 'notice-label.tsx');
const ICON = read('components', 'ui', 'icon.tsx');
const DETAIL_COPY = read('lib', 'detail-copy.ts');
const PRESENTATION = read('lib', 'recall-presentation.ts');
const STORE = read('lib', 'shopper-report-store.ts');
const PREVIEW = read('app', 'design-preview', 'index.tsx');
const PREVIEW_LIB = read('lib', 'design-preview.ts');

/** Source with comments removed, so a file may document what it avoids. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');
}

const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/;
const OFF_SCALE_NUMBER = /\b(padding|margin|gap|rowGap|columnGap|borderRadius)[A-Za-z]*:\s*-?\d/;

// ── 1. The back control ─────────────────────────────────────────────────────

test('the pushed-screen back control is the platform chevron, named Back — never "(tabs)"', () => {
  // The route group beneath every pushed screen has no title, so the
  // platform used to fall back to its name. The stack now shows the chevron
  // alone and gives the control a spoken name of its own.
  assert.ok(ROOT_LAYOUT.includes("headerBackButtonDisplayMode: 'minimal'"));
  assert.ok(ROOT_LAYOUT.includes("const BACK_LABEL = 'Back';"));
  assert.ok(ROOT_LAYOUT.includes('headerBackTitle: BACK_LABEL'));
  // The group itself stays untitled and headerless; nothing names it.
  assert.ok(
    ROOT_LAYOUT.includes('<Stack.Screen name="(tabs)" options={{ headerShown: false }} />'),
  );
  assert.ok(!/title: '\(tabs\)'/.test(ROOT_LAYOUT));
  // No custom back button replaced the platform's: no headerLeft, no
  // chevron-left glyph in the icon set, no router.back on Detail.
  assert.ok(!ROOT_LAYOUT.includes('headerLeft'));
  assert.ok(!ICON.includes('chevron-left'));
  assert.ok(!DETAIL.includes('router.back'));
  assert.ok(!DETAIL.includes('headerLeft'));
  // Every pushed route is still registered exactly as before.
  for (const name of [
    'recall/[id]',
    'settings/index',
    'settings/personalization',
    'settings/notifications',
    'document/[slug]',
    'report/[id]',
  ]) {
    assert.ok(ROOT_LAYOUT.includes(`name="${name}"`), `${name} left the stack`);
  }
  assert.ok(ROOT_LAYOUT.includes("options={{ title: 'Recall Details' }}"));
});

test('the pushed-screen header is styled from the same tokens as the Feed header', () => {
  for (const source of [ROOT_LAYOUT, TAB_LAYOUT]) {
    assert.ok(source.includes("headerStyle: { backgroundColor: color['background/page'] }"));
    assert.ok(source.includes('headerShadowVisible: false'));
    assert.ok(
      source.includes("const { fontFamily, fontSize, fontWeight } = textStyle('heading-3')"),
    );
  }
  assert.ok(ROOT_LAYOUT.includes("headerTintColor: color['action/primary']"));
  assert.ok(!HEX_LITERAL.test(codeOnly(ROOT_LAYOUT)));
});

// ── 2. Typography and tokens ────────────────────────────────────────────────

test('Detail draws every word from the type scale and every colour from the tokens', () => {
  const code = codeOnly(DETAIL);
  assert.ok(DETAIL.includes("import { Text } from '@/components/ui/text';"));
  assert.ok(DETAIL.includes("from '@/constants/design-tokens'"));
  for (const legacy of [
    'ThemedText',
    'ThemedView',
    "from '@/constants/theme'",
    'Spacing.',
    'Radii.',
    'MaxContentWidth',
    'PhotoThumbnail',
    'useTheme',
    'Colors.',
  ]) {
    assert.ok(!DETAIL.includes(legacy), `Detail still uses ${legacy}`);
  }
  // Every Text names its variant; nothing sets a size, weight, face or hex
  // colour of its own, and every spacing and radius comes from the scale.
  const texts = code.match(/<Text\b[^>]*>/g) ?? [];
  assert.ok(texts.length >= 12, `expected a restyled screen, found ${texts.length} Text elements`);
  for (const element of texts) assert.match(element, /variant="/);
  for (const forbidden of ['fontSize:', 'fontWeight:', 'fontFamily:', 'lineHeight:']) {
    assert.ok(!code.includes(forbidden), `Detail sets ${forbidden}`);
  }
  assert.ok(!HEX_LITERAL.test(code));
  assert.ok(!OFF_SCALE_NUMBER.test(code), 'Detail has an off-scale padding, margin, gap or radius');
  assert.ok(!code.includes('toUpperCase()'), 'the legacy all-caps section heading survives');
  // The hierarchy: heading-2 product name, heading-3 section titles.
  assert.match(code, /<Text\s+variant="heading-2"\s+accessibilityRole="header"/);
  // The header stacks only when the rendered name actually broke a word
  // beside the hero — decided from the text layout, latched, never from a
  // reported font scale the runtime may not deliver.
  assert.ok(code.includes('splitsAWord(event.nativeEvent.lines)'));
  assert.ok(code.includes('const [stackedHeader, setStackedHeader] = useState(false);'));
  assert.ok(!code.includes('fontScale'));
  assert.ok(
    code.includes(
      '<Text variant="heading-3" accessibilityRole="header" style={styles.sectionTitle}>',
    ),
  );
  // Mono only where the contract allows it: the risk and notice labels are
  // the primitives'; the screen itself sets no `label` variant.
  assert.ok(!code.includes('variant="label'));
  // The page is the warm surface; the table is a white bordered surface.
  assert.ok(code.includes('<Surface background="background/page" style={styles.page}>'));
  assert.ok(code.includes('<Surface radius={8} border="border/subtle" style={styles.table}>'));
});

test('Detail geometry comes from the layout tokens, fixes no height, and truncates only the paired line', () => {
  assert.equal(layout.detailMediaSize, 152);
  assert.equal(layout.rowMediaSize, 40);
  assert.equal(layout.tableColumnWidth, 144);
  assert.ok(DETAIL.includes('size={layout.detailMediaSize}'));
  assert.ok(DETAIL.includes('size={layout.rowMediaSize}'));
  assert.ok(DETAIL.includes('width: layout.tableColumnWidth'));
  assert.ok(DETAIL.includes('maxWidth: layout.maxContentWidth'));
  // The only fixed height is the glyph box that centres the pin on the
  // first line of the jurisdiction text; every other height is content's.
  const heights = codeOnly(DETAIL).match(/\bheight: [^,]+/g) ?? [];
  assert.deepEqual(heights, ["height: typography['body-small'].lineHeight"]);
  assert.ok(typography['body-small'].lineHeight > 0);
  assert.ok(!DETAIL.includes('maxFontSizeMultiplier'));
  assert.ok(!DETAIL.includes('ellipsizeMode'));
  // Safety-critical text wraps; the ONE single-line cap is the paired line
  // the contract requires so the code and date columns stay level.
  assert.equal((DETAIL.match(/numberOfLines=/g) ?? []).length, 1);
  assert.ok(DETAIL.includes('numberOfLines={1}'));
  // Safe area: the content adds the bottom inset to its own padding.
  assert.ok(DETAIL.includes('paddingBottom: spacing[24] + insets.bottom'));
});

// ── 3. Section order and the community block ────────────────────────────────

test('the section order is unchanged, and community stays beneath the official geography', () => {
  const at = (heading: string) => {
    const index = DETAIL.search(new RegExp(`<Section\\s+title="${heading}"`));
    assert.notEqual(index, -1, `${heading} is missing`);
    return index;
  };
  const order = ['What Happened', 'Where It Was Sold', 'Health Risk', 'Affected Products'].map(at);
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(order[index - 1] < order[index], 'sections are out of contract order');
  }
  assert.ok(DETAIL.indexOf('styles.header') < order[0], 'the product header is not first');
  // Inside Where It Was Sold: the official statement, then the community block.
  const whereSold = DETAIL.slice(order[1], order[2]);
  const lead = whereSold.indexOf('whereSold.lead');
  const community = whereSold.indexOf('<CommunityReportsBlock section={communityReports} />');
  assert.ok(lead !== -1 && community !== -1 && lead < community);
  // Nowhere else on the screen: not in the header, not in What Happened,
  // not after Where It Was Sold (the import line is the only earlier mention).
  assert.ok(!DETAIL.slice(order[0], order[1]).includes('CommunityReportsBlock'));
  assert.ok(!DETAIL.slice(DETAIL.indexOf('styles.header'), order[0]).includes('CommunityReports'));
  assert.ok(!DETAIL.slice(order[2]).includes('CommunityReportsBlock'));
  // Every section after the first is preceded by the hairline inside its
  // own conditional, so a section that does not render leaves no divider.
  for (const index of order.slice(1)) {
    const before = DETAIL.slice(0, index).slice(-260);
    assert.match(before, /\? \(\s*<>\s*<View style=\{styles\.divider\} \/>/);
  }
  assert.ok(!DETAIL.slice(0, order[0]).includes('styles.divider'));
  // The community block is styled as part of the section, from the tokens.
  assert.ok(COMMUNITY.includes("import { Text } from '@/components/ui/text';"));
  assert.ok(COMMUNITY.includes("from '@/constants/design-tokens'"));
  assert.ok(!COMMUNITY.includes('ThemedText'));
  assert.ok(!COMMUNITY.includes("from '@/constants/theme'"));
  assert.ok(!HEX_LITERAL.test(codeOnly(COMMUNITY)));
  assert.ok(!OFF_SCALE_NUMBER.test(codeOnly(COMMUNITY)));
  assert.ok(COMMUNITY.includes('<Text variant="caption" color="action/secondary"'));
  assert.ok(COMMUNITY.includes('hitSlop={ACTION_HIT_SLOP}'));
});

// ── 4. Disclosure thresholds and the paired rendering ───────────────────────

test('every disclosure threshold is the contract’s, and the screen re-derives none', () => {
  assert.equal(WHERE_SOLD_INITIAL_STATES, 5);
  assert.equal(AFFECTED_PRODUCTS_INITIAL_ROWS, 1);
  assert.deepEqual(disclosureControl(10, 'states'), {
    expandLabel: 'See all (10)',
    collapseLabel: 'Show less',
    expandAccessibilityLabel: 'See all 10 states',
    collapseAccessibilityLabel: 'Show less',
  });
  // The screen renders the model's collapsed/expanded views and its
  // controls; it slices, counts and thresholds nothing itself.
  for (const forbidden of ['.slice(', '> 5', '>= 5', '> 2', '>= 2', 'INITIAL_', 'See all']) {
    assert.ok(!codeOnly(DETAIL).includes(forbidden), `Detail decides a threshold: ${forbidden}`);
  }
  assert.ok(DETAIL.includes('statesExpanded ? whereSold.lead : whereSold.leadCollapsed'));
  assert.ok(DETAIL.includes('control={whereSold.statesDisclosure}'));
  assert.ok(DETAIL.includes('control={affectedProducts.table.rowsDisclosure}'));
  assert.ok(DETAIL.includes('control={cell.disclosure}'));
  assert.equal((DETAIL.match(/<DisclosureControl\b/g) ?? []).length, 3);
});

test('paired identifier/date cells still render line for line, with the blank line kept', () => {
  assert.ok(DETAIL.includes('cell.pairGroup === null'));
  assert.ok(DETAIL.includes("shown.split('\\n')"));
  assert.ok(DETAIL.includes("{value === '' ? '\\u00A0' : value}"));
  assert.ok(DETAIL.includes('stateId={cellStateId(row.id, cell)}'));
  assert.ok(DETAIL.includes('open={openCells.has(cellStateId(row.id, cell))}'));
  assert.ok(DETAIL.includes('visibleCellState('));
  // Both halves of a pair render the same variant on the same line box, so
  // line n of one is level with line n of the other at any type size.
  assert.match(
    DETAIL,
    /<Text key=\{`\$\{cell\.key\}-\$\{index\}`\} variant="caption" numberOfLines=\{1\}>/,
  );
});

// ── 5. Production and business logic ────────────────────────────────────────

test('no gate, store, or contract moved: the screen and block read the same seams as before', () => {
  assert.ok(DETAIL.includes('buildDetailModel(state.detail, { today: todayIso(), affectsYou })'));
  assert.ok(DETAIL.includes('evaluatePersonalRelevance('));
  assert.ok(DETAIL.includes('fetchCaseDetail(id)'));
  assert.ok(COMMUNITY.includes('communityReportsView(loaded.summary, loaded.report)'));
  assert.ok(COMMUNITY.includes("from '@/lib/shopper-report-store'"));
  for (const source of [DETAIL, COMMUNITY, PREVIEW, PREVIEW_LIB, DETAIL_COPY].map(codeOnly)) {
    for (const forbidden of ['reports_enabled', 'reportsEnabled', 'fetch(', 'supabase']) {
      assert.ok(!source.includes(forbidden), `a production seam moved: ${forbidden}`);
    }
  }
  // The store's four diversions are exactly the ones the harness has always
  // had — the production gate is still the server's alone.
  assert.equal((codeOnly(STORE).match(/previewShopperState\(/g) ?? []).length, 2);
  assert.ok(!codeOnly(STORE).includes('reports_enabled'));
  // The presentation contract knows nothing of the visual layer.
  for (const forbidden of ['design-tokens', "'@/components", 'MediaTile', 'Callout']) {
    assert.ok(!codeOnly(PRESENTATION).includes(forbidden), `presentation references ${forbidden}`);
  }
  // The copy module is a leaf with no recall content in it.
  assert.ok(!/^import /m.test(DETAIL_COPY));
  assert.equal(DETAIL_LOADING.title, 'Loading…');
  assert.equal(DETAIL_MISSING.body, 'This recall could not be found.');
  assert.equal(DETAIL_ERROR_TITLE, 'Could not load this recall');
  assert.equal(retractedNotice('USDA FSIS'), 'USDA FSIS has retracted this notice.');
  assert.ok(DETAIL.includes('retractedNotice(model.agencyLabel)'));
});

// ── 6. Nothing inert from Figma ─────────────────────────────────────────────

test('no share, bell, retailer, or helper-callout control was copied from Figma', () => {
  const code = codeOnly(DETAIL);
  for (const inert of [
    'share',
    'Share',
    'bell',
    'View Retailers',
    'Check your package',
    'best buy date',
    'sliders',
    'onPress={() => {}}',
    'onPress={() => undefined}',
  ]) {
    assert.ok(!code.includes(inert), `an inert Figma control reached Detail: ${inert}`);
  }
  for (const glyph of ['share', 'bell', 'sliders', 'chevron-left']) {
    assert.ok(!ICON.includes(`'${glyph}'`), `the icon set gained an unused ${glyph} glyph`);
    assert.ok(!ICON.includes(`${glyph}:`), `the icon set gained an unused ${glyph} glyph`);
  }
  // The only pressables the screen adds are its two external links; every
  // other control is a shared primitive with real behaviour.
  assert.equal((code.match(/<Pressable\b/g) ?? []).length, 2);
  assert.equal((code.match(/accessibilityRole="link"/g) ?? []).length, 2);
  assert.equal((code.match(/Linking\.openURL\(/g) ?? []).length, 2);
  assert.equal((code.match(/accessibilityHint=\{EXTERNAL_LINK_HINT\}/g) ?? []).length, 2);
  assert.equal((code.match(/<ExternalLinkLabel /g) ?? []).length, 2);
  assert.equal((code.match(/hitSlop=\{LINK_HIT_SLOP\}/g) ?? []).length, 2);
  // The one horizontally scrolling surface is the table.
  assert.equal((code.match(/\bhorizontal\b/g) ?? []).length, 1);
  // The save control is the shared one, in the product header, once.
  assert.equal((code.match(/<SaveRecallButton caseId=\{model\.id\} \/>/g) ?? []).length, 1);
  assert.ok(!ROOT_LAYOUT.includes('headerRight'));
});

// ── 7. The primitives the screen required ───────────────────────────────────

test('the callout, media tile and notice label are token-only primitives with the right semantics', () => {
  for (const [name, source] of [
    ['callout', CALLOUT],
    ['media-tile', MEDIA_TILE],
    ['notice-label', NOTICE_LABEL],
  ] as const) {
    assert.ok(!HEX_LITERAL.test(source), `${name} spells a colour`);
    assert.ok(!OFF_SCALE_NUMBER.test(source), `${name} has an off-scale number`);
    assert.ok(!source.includes('ThemedText'), `${name} uses the legacy text`);
  }
  // Warning is the lime relevance surface; information is the soft blue.
  assert.ok(CALLOUT.includes("warning: { background: 'background/accent', icon: 'warning' }"));
  assert.ok(CALLOUT.includes("information: { background: 'background/subtle', icon: 'info' }"));
  assert.ok(CALLOUT.includes('<Text variant="body-small" style={styles.text}>'));
  assert.ok(!CALLOUT.includes('riskPalette'), 'a callout can never borrow a risk colour');
  assert.ok(!CALLOUT.includes('accessibilityRole="alert"'));
  // The tile keeps its square, shows only the model's image, and hides the
  // bare placeholder from assistive technology.
  assert.ok(
    MEDIA_TILE.includes("(typeof layout)['cardMediaSize' | 'detailMediaSize' | 'rowMediaSize']"),
  );
  assert.ok(
    MEDIA_TILE.includes(
      "importantForAccessibility={image !== null ? 'auto' : 'no-hide-descendants'}",
    ),
  );
  assert.ok(MEDIA_TILE.includes('resizeMode="contain"'));
  // Detail renders the hero tile only with an image — never a placeholder
  // square beside the title, never a broken image.
  assert.equal(DETAIL.split('model.heroImageUrl').length - 1, 2);
  assert.match(DETAIL, /\{model\.heroImageUrl \? \(\s*<MediaTile/);
  // The notice label: label type on the neutral surface, spoken as the contract's words.
  assert.ok(NOTICE_LABEL.includes('accessibilityLabel={label}'));
  assert.ok(NOTICE_LABEL.includes('<Text variant="label">{label.toUpperCase()}</Text>'));
  assert.ok(DETAIL.includes('<NoticeLabel label={model.noticeTypeLabel} />'));
  // The state message is shared between the Feed and Detail.
  assert.ok(STATE_MESSAGE.includes('export function StateMessage'));
  assert.ok(DETAIL.includes('<StateMessage {...DETAIL_LOADING} tone="loading" />'));
  assert.ok(DETAIL.includes('<StateMessage {...DETAIL_MISSING} />'));
  assert.ok(
    DETAIL.includes(
      '<StateMessage title={DETAIL_ERROR_TITLE} body={state.message} tone="error" />',
    ),
  );
});

// ── 8. The development preview ──────────────────────────────────────────────

test('the preview offers every required Detail scenario, on real recalls, simulating nothing', () => {
  const ids = DESIGN_PREVIEW_SCENARIOS.map((scenario) => scenario.id);
  for (const required of [
    // community: every state the block can be in
    'detail_below_threshold',
    'detail_reported',
    'detail_below_threshold_own_report',
    'detail_reported_own_report',
    'detail_production_gated',
    // header
    'header_image',
    'header_no_image',
    'name_short',
    'name_long',
    // geography
    'geography_nationwide',
    'jurisdictions_complete',
    'jurisdictions_collapsed',
    // health
    ...Object.keys(GUIDE_REQUIREMENTS).map((key) => `guide_${key.replace(/-/g, '_')}`),
    'health_risk_fallback',
    'health_risk_absent',
    // affected products
    'products_single',
    'products_collapsed',
    'cell_two_values',
    'cell_collapsed',
    'pairs_two',
    'pairs_many',
    'pairs_complete',
    'pairs_incomplete',
    // risk
    ...Object.values(RISK_REQUIREMENTS),
  ]) {
    assert.ok(ids.includes(required as (typeof ids)[number]), `scenario missing: ${required}`);
  }
  for (const scenario of DESIGN_PREVIEW_SCENARIOS) {
    if (scenario.group === 'community' || scenario.group === 'questionnaire') continue;
    assert.equal(scenario.simulation, null, `${scenario.id} simulates something`);
    assert.equal(scenario.destination, 'detail');
  }
  // The hub confirms the guide by the real pipeline's own selection, on the
  // real projection, and reads the hero and name from the real model.
  assert.ok(PREVIEW.includes('selectHazardGuidance('));
  assert.ok(PREVIEW.includes('hasHeroImage: model.heroImageUrl !== null'));
  assert.ok(PREVIEW.includes('productNameLength: model.productName.length'));
  assert.ok(PREVIEW.includes('riskTier: riskView(item.classification, item.sourceAgency).tier'));
  assert.ok(PREVIEW.includes('DETAIL STATES AND CALLOUTS'));
  assert.ok(PREVIEW.includes('<StateMessage {...DETAIL_LOADING} />'));
  // Still dev-only, still pushing the real screen.
  assert.ok(PREVIEW.includes('if (!isDevelopmentBuild())'));
  assert.ok(read('app', '(tabs)', 'profile.tsx').includes('{__DEV__ ? ('));
});
