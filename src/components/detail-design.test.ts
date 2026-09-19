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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  imageCounterText,
  imagePositionLabel,
  imageUnavailableLabel,
  IMAGE_DOTS_WINDOW,
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
const IMAGE_SET = read('components', 'ui', 'official-image-set.tsx');
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

/** Every client source file, so a rule can be proven over the whole app. */
function clientSourceFiles(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  for (const dir of ['app', 'components', 'lib', 'hooks', 'constants', 'content', 'domain']) {
    for (const entry of readdirSync(join(SRC, dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
        continue;
      }
      const path = join(entry.parentPath, entry.name);
      out.push({ path: path.slice(SRC.length + 1), source: readFileSync(path, 'utf8') });
    }
  }
  return out;
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
  // Same page colour, same absence of a shadow, same heading token on both.
  for (const source of [ROOT_LAYOUT, TAB_LAYOUT]) {
    assert.ok(source.includes("backgroundColor: color['background/page']"));
    assert.ok(source.includes('headerShadowVisible: false'));
    assert.ok(source.includes("textStyle('heading-3')"));
    assert.ok(source.includes('headerTitleStyle: { fontFamily, fontSize, fontWeight'));
  }
  // They differ in exactly one respect, and deliberately (P3C1.5): the tab
  // headers are JS headers whose bar this app sizes itself, so they carry a
  // Dynamic Type minimum; the pushed screens use the NATIVE stack header,
  // which iOS sizes for the reader's text size on its own and which does not
  // accept a height here at all.
  assert.ok(TAB_LAYOUT.includes('minHeight: headerMinHeight'));
  assert.ok(
    !ROOT_LAYOUT.includes('minHeight'),
    'the native stack header must not be given a height it ignores',
  );
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
  // The pre-design-system photo gallery (`PhotoGallery`, `PhotoThumbnail`,
  // `ComparePhotos`) was unmounted from every screen by P2B1/P2B2 and is
  // superseded by the shared `MediaTile` and, from P2B7C, the tokenized
  // `OfficialImageSet`. P2B7C deleted the module rather than reviving it:
  // its legacy-theme colours and its own aspect-ratio tile sizing are both
  // contrary to the shipped contract.
  assert.ok(
    !existsSync(join(SRC, 'components', 'photo-gallery.tsx')),
    'the retired photo gallery returned',
  );
  assert.ok(existsSync(join(SRC, 'components', 'ui', 'official-image-set.tsx')));
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
  // AMENDED FOR P2B7C: the header's media footprint is still
  // `detail-media-size`, but the screen no longer names it — the shared
  // imagery component owns the header tile and the label-evidence page, and
  // takes both sizes from the same tokens.
  assert.ok(IMAGE_SET.includes('size={layout.detailMediaSize}'));
  assert.ok(IMAGE_SET.includes('width: layout.detailMediaSize'));
  assert.ok(IMAGE_SET.includes('height: layout.detailMediaSize'));
  assert.equal(layout.pageDotSize, 8);
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
  // Every section after the first is preceded by its own hairline, so a
  // section that does not render leaves no divider. Where It Was Sold is
  // unconditional (P2B7E) and carries the divider directly; the optional
  // sections still keep theirs inside their own conditional.
  for (const index of order.slice(1)) {
    const before = DETAIL.slice(0, index).slice(-360);
    assert.match(
      before,
      /(\? \(\s*<>\s*<View style=\{styles\.divider\} \/>|<View style=\{styles\.divider\} \/>\s*$)/,
    );
  }
  // Where It Was Sold has NO presence condition at all: it is not wrapped in
  // a `whereSold ? … : null`, so no raw distribution value can remove it.
  const whereSoldOpen = DETAIL.slice(0, order[1]).slice(-360);
  assert.ok(
    !/\{whereSold \?/.test(whereSoldOpen),
    'Where It Was Sold regained a presence condition',
  );
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
  // P2B7N.1: Detail reaches the SAME matcher through the shared verdict the
  // card surfaces use, rather than calling `evaluatePersonalRelevance` with
  // its own hand-listed facts — one relevance answer for all three screens.
  assert.ok(DETAIL.includes('affectsYouVerdict('));
  assert.ok(!codeOnly(DETAIL).includes('evaluatePersonalRelevance('));
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
  // The tile keeps its square for a real image, shows only the model's
  // image, and — AMENDED FOR P2B7I — renders nothing at all for an absent or
  // failed one, so there is no bare placeholder to hide from assistive
  // technology: the tile is an image element or it is not there.
  assert.ok(
    MEDIA_TILE.includes("(typeof layout)['cardMediaSize' | 'detailMediaSize' | 'rowMediaSize']"),
  );
  assert.ok(
    MEDIA_TILE.includes(
      'if (uri === null || failedUri === uri || hasImageFailed(uri)) return null;',
    ),
  );
  assert.ok(MEDIA_TILE.includes('accessibilityRole="image"'));
  assert.ok(!MEDIA_TILE.includes('no-hide-descendants'), 'a hidden placeholder survives');
  assert.ok(MEDIA_TILE.includes('resizeMode="contain"'));
  // AMENDED FOR P2B7C. Detail used to render the hero tile directly, gated
  // on `model.heroImageUrl`. The founder decision moved the header's imagery
  // behind the model's bounded image SET, rendered by the one shared
  // component — so the same promise is pinned in its new shape: the header
  // renders imagery only when the model produced a set, and never a
  // placeholder square beside the title.
  assert.equal(DETAIL.split('model.productImages').length - 1, 2);
  assert.match(
    DETAIL,
    /\{model\.productImages \? <OfficialImageSet set=\{model\.productImages\} \/> : null\}/,
  );
  assert.ok(!DETAIL.includes('model.heroImageUrl'));
  // One usable image is still exactly the tile Detail always showed, and
  // every page of a set is that same tile.
  assert.match(IMAGE_SET, /<MediaTile\s+uri=\{pages\[0\]\.url\}/);
  assert.match(IMAGE_SET, /<MediaTile\s+uri=\{item\.url\}/);
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

// ── 7b. The official image set (P2B7C, as corrected) ────────────────────────

const IMAGE_SET_CODE = codeOnly(IMAGE_SET);

test('the image set is one tokenized component, and the only carousel in the app', () => {
  assert.ok(IMAGE_SET.includes('export function OfficialImageSet('));
  // ONE pager exists in the whole client. A second one would be the thing
  // this milestone exists to avoid — and, since the P2B7C correction, the
  // label gallery that used to be the second one is gone entirely.
  const pagers = clientSourceFiles().filter(({ source }) => /pagingEnabled/.test(source));
  assert.deepEqual(
    pagers.map(({ path }) => path),
    ['components/ui/official-image-set.tsx'],
  );
  // It is a shared primitive: tokens in, no legacy theme, no hex, no
  // off-scale spacing, and no recall content of its own.
  assert.ok(IMAGE_SET.includes("from '@/constants/design-tokens'"));
  assert.ok(!IMAGE_SET.includes("from '@/constants/theme'"));
  assert.ok(!HEX_LITERAL.test(IMAGE_SET_CODE));
  assert.ok(!OFF_SCALE_NUMBER.test(IMAGE_SET_CODE));
  assert.ok(!IMAGE_SET.includes('ThemedText'));
  // No new dependency, and no network or data access: React, React Native,
  // the shared primitives, the tokens, the contract and (P2B7I) the
  // session's failure memory — nothing else.
  const imports = [...IMAGE_SET.matchAll(/from '([^']+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(imports, [
    '@/components/ui/media-tile',
    '@/components/ui/text',
    '@/constants/design-tokens',
    '@/lib/image-failures',
    '@/lib/recall-presentation',
    'react',
    'react-native',
  ]);
  // The set has ONE presentation now: the header. The evidence presentation
  // existed only for the retired label gallery.
  for (const retired of ['presentation=', 'evidence', 'fullWidth', 'evidenceMediaHeight']) {
    assert.ok(
      !IMAGE_SET_CODE.includes(retired),
      `the retired label presentation survives: ${retired}`,
    );
  }
});

test('the whole official set is navigable — no presentation cap survives', () => {
  // RESTORED BY THE P2B7I CORRECTION (founder decision). P2B7I had briefly
  // bounded the pager to six pages; that is reverted, because a counter's
  // denominator a shopper cannot swipe to is exactly the defect this work
  // exists to close. The CONTRACT still decides the pages (`imagePageView`
  // removes what failed and nothing else) and the pager renders all of
  // them, virtualized.
  assert.ok(
    IMAGE_SET.includes(
      'const { pages, officialCount, usableCount, indicator } = imagePageView(set, failed);',
    ),
  );
  assert.ok(IMAGE_SET.includes('data={pages}'));
  assert.ok(IMAGE_SET.includes('initialNumToRender={1}'));
  assert.ok(IMAGE_SET.includes('maxToRenderPerBatch={2}'));
  assert.ok(IMAGE_SET.includes('windowSize={3}'));
  assert.ok(IMAGE_SET.includes('removeClippedSubviews'));
  assert.ok(IMAGE_SET.includes('getItemLayout='));
  assert.ok(IMAGE_SET.includes('<FlatList'));
  // Neither the contract nor the component truncates the set. The only
  // bound in either is the INDICATOR's, and it bounds no pages.
  assert.ok(!PRESENTATION.includes('IMAGE_PAGES_MAX'), 'the six-page cap returned');
  assert.ok(!PRESENTATION.includes('.slice(0, IMAGE_PAGES_MAX)'), 'the six-page cap returned');
  assert.equal(IMAGE_DOTS_WINDOW, 5);
  for (const retired of [
    'DETAIL_IMAGE_SET_MAX',
    'IMAGE_PAGES_MAX',
    'truncationNote',
    'Showing ',
    '.slice(',
  ]) {
    assert.ok(!IMAGE_SET_CODE.includes(retired), `the component caps or discloses: ${retired}`);
  }
  assert.ok(!PRESENTATION.includes('DETAIL_IMAGE_SET_MAX'), 'the retired cap name returned');
  assert.ok(!PRESENTATION.includes('truncationNote'), 'the contract still composes the prose');
});

test('a page that cannot load leaves the set, and the indicator follows it', () => {
  // The reported acceptance failure: two dots over two blank grey squares.
  // A failed page is no longer a page — it leaves the contract's `pages`, so
  // the dots, the counter and the spoken position all describe what
  // actually renders. P2B7I: the tile itself renders NOTHING once it has
  // failed, and the verdict is remembered for the session so the pager is
  // seeded with it on the next visit.
  assert.ok(PRESENTATION.includes('set.images.filter((image) => !failed.has(image.url))'));
  assert.ok(IMAGE_SET.includes('onLoadFailed={onFailed}'));
  assert.ok(IMAGE_SET.includes('hasImageFailed(image.url)'));
  assert.ok(MEDIA_TILE.includes('onLoadFailed?: (uri: string) => void;'));
  assert.ok(MEDIA_TILE.includes('recordImageFailure(uri);'));
  assert.ok(MEDIA_TILE.includes('onLoadFailed?.(uri);'));
  // Every candidate failed: the header returns to its approved no-image
  // shape rather than keeping a blank tile with indicators over it.
  assert.ok(IMAGE_SET.includes('if (pages.length === 0) return null;'));
  // One usable image is the static tile, with no indicator at all.
  assert.ok(IMAGE_SET.includes('if (pages.length === 1) {'));
  // The visible page is tracked by IMAGE IDENTITY, so a late failure on an
  // offscreen page cannot move the page the shopper is looking at.
  assert.ok(IMAGE_SET.includes('pages.findIndex((image) => image.url === visible.url)'));
  assert.ok(IMAGE_SET.includes('Math.min(visible.at, pages.length - 1)'));
  assert.ok(IMAGE_SET.includes('setVisible({ url: image.url, at })'));
});

test('a bounded dot WINDOW, and the counter ADDED beside it — never one instead of the other', () => {
  // AMENDED FOR P2B7I AND ITS CORRECTION. Through P2B7H the counter
  // REPLACED the dots from six images (`IMAGE_DOTS_MAX`); the founder
  // rejected that. The dots are now always present in a paged set, drawn as
  // a sliding window of at most five, and the counter joins them — the
  // window bounds the marks, never the pages.
  assert.ok(IMAGE_SET.includes('{imageDotWindow(current, usableCount).map((page) => ('));
  assert.ok(IMAGE_SET.includes("{indicator === 'dots-and-counter' ? ("));
  assert.ok(IMAGE_SET.includes('{imageCounterText(current, usableCount)}'));
  assert.ok(IMAGE_SET.includes('styles.dot'));
  assert.ok(!IMAGE_SET.includes('IMAGE_DOTS_MAX'), 'the replaced-dots threshold survives');
  assert.ok(!PRESENTATION.includes('IMAGE_DOTS_MAX'), 'the replaced-dots threshold survives');
  // The counter is the contract's compact form over the pages that can be
  // shown — which is the official total until something fails — and the
  // spoken position counts the same reachable pages.
  assert.equal(imageCounterText(1, 74), '2 / 74');
  assert.equal(imageCounterText(73, 74), '74 / 74');
  assert.equal(imagePositionLabel(1, 74), 'Image 2 of 74');
  assert.equal(imageUnavailableLabel(74, 74), null);
  assert.equal(
    imageUnavailableLabel(72, 74),
    '72 of 74 official images can be shown; the rest could not be loaded',
  );
  // The component composes no copy of its own — the rejected prose cannot
  // return through it.
  for (const composed of ['Showing', 'official images', 'label pages', 'of 6']) {
    assert.ok(!IMAGE_SET_CODE.includes(composed), `the component composes copy: ${composed}`);
  }
});

test('paging is a hand gesture: no auto-advance, no arrows, no animation, no press target', () => {
  assert.ok(IMAGE_SET.includes('pagingEnabled'));
  // Nothing advances a page on its own, and nothing animates.
  for (const automatic of [
    'setInterval',
    'setTimeout',
    'requestAnimationFrame',
    'Animated',
    'autoPlay',
    'autoplay',
    'LayoutAnimation',
    'reduceMotion',
  ]) {
    assert.ok(
      !IMAGE_SET_CODE.includes(automatic),
      `the set advances or animates itself: ${automatic}`,
    );
  }
  // The one programmatic scroll keeps the set from resting between pages
  // when it shrinks, and it is explicitly not animated.
  assert.equal((IMAGE_SET_CODE.match(/scrollToOffset\(/g) ?? []).length, 1);
  assert.ok(IMAGE_SET.includes('animated: false'));
  assert.ok(!IMAGE_SET.includes('animated: true'));
  // No next/previous controls, and the images are not pressable — this
  // milestone has no full-screen destination to send anyone to.
  for (const control of [
    'Pressable',
    'TouchableOpacity',
    'onPress',
    'Next',
    'Previous',
    'chevron',
    'arrow',
  ]) {
    assert.ok(!IMAGE_SET_CODE.includes(control), `an image control appeared: ${control}`);
  }
  // Only this row scrolls sideways, and it never scrolls vertically: the
  // page's own ScrollView keeps vertical scrolling.
  // One pager element; the `useRef<FlatList<…>>` generic is not one.
  assert.equal((IMAGE_SET_CODE.match(/<FlatList\n/g) ?? []).length, 1);
  assert.ok(IMAGE_SET.includes('horizontal'));
  assert.ok(!IMAGE_SET_CODE.includes('nestedScrollEnabled'));
  assert.ok(!IMAGE_SET_CODE.includes('scrollEnabled={false}'));
});

test('an image is contained, never cropped, and one failure never collapses the set', () => {
  // Every page is the shared media tile, which contains rather than crops,
  // and no aspect ratio is used to size or trim a page.
  assert.ok(MEDIA_TILE.includes('resizeMode="contain"'));
  assert.ok(!IMAGE_SET_CODE.includes('cover'));
  assert.ok(!IMAGE_SET_CODE.includes('aspectRatio'));
  assert.equal((IMAGE_SET.match(/<MediaTile/g) ?? []).length, 2); // static + paged
  // There is no loading state at all, so none can be left stuck.
  for (const busy of ['loading', 'Loading', 'ActivityIndicator', 'onLoadStart', 'spinner']) {
    assert.ok(!IMAGE_SET_CODE.includes(busy), `a stuck-able activity state appeared: ${busy}`);
  }
});

test('position is spoken, the dots are decoration, the counter speaks the official total once', () => {
  // Each image keeps its factual label and announces its own position over
  // the pages that can be reached — never over a total it cannot.
  assert.ok(IMAGE_SET.includes('positionLabel={imagePositionLabel(index, usableCount)}'));
  assert.ok(MEDIA_TILE.includes('accessibilityValue={'));
  assert.ok(MEDIA_TILE.includes('{ text: positionLabel }'));
  // The dots are hidden from assistive technology on both platforms, so
  // nothing there is focusable or pressable. AMENDED FOR P2B7I AND ITS
  // CORRECTION: the counter is hidden too while every published photo is
  // reachable (each page already announces the same two numbers), and
  // becomes the one spoken element — labelled with a sentence, never its
  // slash — only when a failure means fewer pages than were published.
  assert.ok(IMAGE_SET.includes('accessibilityElementsHidden'));
  assert.ok(IMAGE_SET.includes('importantForAccessibility="no-hide-descendants"'));
  assert.ok(IMAGE_SET.includes('accessible={unavailable !== null}'));
  assert.ok(IMAGE_SET.includes('accessibilityLabel={unavailable ?? undefined}'));
  // Nothing here caps Dynamic Type or truncates a line.
  assert.ok(!IMAGE_SET.includes('maxFontSizeMultiplier'));
  assert.ok(!IMAGE_SET.includes('numberOfLines'));
  assert.ok(!IMAGE_SET.includes('ellipsizeMode'));
});

test('no label gallery exists anywhere on the screen or in the contract', () => {
  // AMENDED BY THE P2B7C CORRECTION (founder decision). A general gallery of
  // a notice's FSIS label renders — above the Affected Products table, and
  // as a standalone section for a notice without one — was built in P2B7C
  // and is removed: imagery under Affected Products is ONLY ever an image
  // matched to that exact product row. The pages stay stored and allocated.
  for (const retired of [
    'Official product labels',
    'OFFICIAL_LABELS_TITLE',
    'officialLabels',
    'labelPages',
    'labelEvidence',
    'presentation="evidence"',
  ]) {
    assert.ok(!DETAIL.includes(retired), `the retired label gallery survives: ${retired}`);
    assert.ok(!PRESENTATION.includes(retired), `the contract still models it: ${retired}`);
  }
  // The one image Affected Products may still show is the matched row
  // thumbnail, drawn by the row itself.
  assert.match(DETAIL, /\{row\.image \? \(/);
  assert.ok(DETAIL.includes('uri={row.image.url}'));
  assert.ok(DETAIL.includes('size={layout.rowMediaSize}'));
  // And the header renders exactly one image surface.
  assert.equal((DETAIL.match(/<OfficialImageSet\b/g) ?? []).length, 1);
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
    // official imagery (P2B7C, as corrected)
    'images_one',
    'images_two',
    'images_five',
    'images_six',
    'images_seven',
    'images_many',
    'images_largest',
    'image_portrait',
    'image_landscape',
    'name_long_images',
    'row_image_matched',
    'labels_unrendered',
    'text_accessibility_large',
    'text_accessibility_xxxl',
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
  // The scenario screener reads the tier from the real pipeline over the real
  // row — including its notice type, which `riskView` now requires (P2B7N).
  assert.ok(
    PREVIEW.includes('riskTier: riskView(item.classification, item.sourceAgency, item.noticeType)'),
  );
  assert.ok(PREVIEW.includes('DETAIL STATES AND CALLOUTS'));
  assert.ok(PREVIEW.includes('<StateMessage {...DETAIL_LOADING} />'));
  // P2B7C (as corrected): the imagery gallery renders the PRODUCTION set
  // over real models, including the one state the live corpus cannot supply
  // on demand — a candidate whose image cannot load — and the complete icon
  // set is inspectable in one place.
  assert.ok(PREVIEW.includes('OFFICIAL IMAGERY AND FAILURE'));
  assert.ok(PREVIEW.includes('<ImagerySampleGallery confirmed={confirmed} />'));
  assert.ok(PREVIEW.includes('imageSet: model.productImages'));
  assert.ok(PREVIEW.includes('<OfficialImageSet set={sample.set} />'));
  assert.ok(PREVIEW.includes('function unreachableImage(name: string): string {'));
  assert.ok(PREVIEW.includes('SIMULATED: three candidates, the middle one unreachable.'));
  assert.ok(PREVIEW.includes('SIMULATED: every candidate unreachable.'));
  assert.ok(PREVIEW.includes('ICON SET ('));
  assert.ok(PREVIEW.includes('{ICON_NAMES.map((name) => ('));
  // The retired label-gallery scenarios are gone from the harness too.
  for (const retired of [
    'labels_one',
    'labels_several',
    'labels_many',
    'Official product labels',
  ]) {
    assert.ok(!PREVIEW_LIB.includes(retired), `a retired label scenario survives: ${retired}`);
    assert.ok(!PREVIEW.includes(retired), `a retired label scenario survives: ${retired}`);
  }
  // Still dev-only, still pushing the real screen.
  assert.ok(PREVIEW.includes('if (!isDevelopmentBuild())'));
  assert.ok(read('app', '(tabs)', 'profile.tsx').includes('{__DEV__ ? ('));
});
