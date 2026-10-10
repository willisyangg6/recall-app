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

import { layout } from '@/constants/design-tokens';
import {
  DESIGN_PREVIEW_SCENARIOS,
  GUIDE_REQUIREMENTS,
  RISK_REQUIREMENTS,
} from '@/lib/design-preview';
import {
  DETAIL_ERROR_TITLE,
  DETAIL_LOADING,
  DETAIL_MISSING,
  DETAIL_TITLE_LINES,
  retractedNotice,
} from '@/lib/detail-copy';
import {
  AFFECTED_PRODUCTS_INITIAL_ROWS,
  CARD_FIELD_INLINE_VALUES,
  disclosureControl,
  fieldDisclosureControl,
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
  // No custom back button replaced the platform's on a pushed screen: no
  // headerLeft, no router.back on Detail. (P2B7X.1 added a `chevron-left`
  // glyph for the headerless onboarding screens' own back control; Detail
  // and every other pushed screen still use the platform chevron.)
  assert.ok(!ROOT_LAYOUT.includes('headerLeft'));
  assert.ok(!DETAIL.includes('chevron-left'));
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

test('Detail draws every word from a type scale and every colour from the tokens', () => {
  const code = codeOnly(DETAIL);
  assert.ok(DETAIL.includes("import { Text } from '@/components/ui/text';"));
  assert.ok(DETAIL.includes("from '@/constants/design-tokens'"));
  // AMENDED FOR THE RECALL DETAIL KIT (2026-10-07): the approved Detail type
  // roles (28/34 title, 24/30 sections, 18/24 subheadings and card titles,
  // 16/23 body, 14/20 metadata, 16/22 actions) live in the scoped
  // `constants/detail-design.ts`, exactly as the Feed kit's do in
  // `feed-design.ts`, so the app-wide scale pinned to DESIGN.md is unchanged.
  assert.ok(DETAIL.includes("from '@/constants/detail-design'"));
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
  assert.ok(
    !existsSync(join(SRC, 'components', 'photo-gallery.tsx')),
    'the retired photo gallery returned',
  );
  assert.ok(existsSync(join(SRC, 'components', 'ui', 'official-image-set.tsx')));
  // Every Text takes a variant or a Detail type role; nothing sets a size,
  // weight, face or hex colour of its own, and every spacing and radius is a
  // named token or kit value.
  const texts = code.match(/<Text\b[^>]*>/g) ?? [];
  assert.ok(texts.length >= 12, `expected a restyled screen, found ${texts.length} Text elements`);
  for (const element of texts) assert.match(element, /variant="|detailType\./);
  for (const forbidden of ['fontSize:', 'fontWeight:', 'fontFamily:', 'lineHeight:']) {
    assert.ok(!code.includes(forbidden), `Detail sets ${forbidden}`);
  }
  assert.ok(!HEX_LITERAL.test(code));
  assert.ok(!OFF_SCALE_NUMBER.test(code), 'Detail has an off-scale padding, margin, gap or radius');
  assert.ok(!code.includes('toUpperCase()'), 'the legacy all-caps section heading survives');
  // The hierarchy: the product title role, section headings in the section role.
  assert.match(
    code,
    /style=\{\[detailType\.productTitle, styles\.textColor\]\}\s+accessibilityRole="header"/,
  );
  assert.match(code, /style=\{\[detailType\.section, styles\.textColor, styles\.sectionTitle\]\}/);
  // The header stacks once the rendered name broke a word beside the photo —
  // measured from the probe's layout and latched — and, per the kit, at the
  // accessibility text sizes. The text scale is read ONLY against the one
  // shared threshold.
  assert.ok(code.includes('splitsAWord(lines)'));
  assert.ok(code.includes('const { lines } = event.nativeEvent;'));
  assert.ok(code.includes('const [stackedHeader, setStackedHeader] = useState(false);'));
  assert.ok(code.includes('const largeText = fontScale >= DETAIL_STACK_SCALE;'));
  assert.equal((code.match(/fontScale >= DETAIL_STACK_SCALE/g) ?? []).length, 2);
  assert.ok(code.includes('fieldStacks(contentWidth, fontScale)'));
  assert.ok(!/fontScale\s*[<>]=?\s*\d/.test(code), 'Detail compares the text scale to a number');
  assert.ok(!code.includes('variant="label'));
  // The page is the warm surface; each affected product is a white bordered card.
  assert.ok(code.includes('<Surface background="background/page" style={styles.page}>'));
  const card = DETAIL.slice(DETAIL.indexOf('  card: {'), DETAIL.indexOf('  cardHeader: {'));
  assert.match(card, /backgroundColor: detailColor\.surface/);
  assert.match(card, /borderColor: detailColor\.border/);
  assert.match(card, /borderRadius: detailGeometry\.productCardRadius/);
  // The scoped module recolours nothing: every colour is a token's value
  // except the symptom bubble, this screen's own mark.
  const DESIGN = codeOnly(read('constants', 'detail-design.ts'));
  assert.deepEqual(DESIGN.match(/#[0-9A-Fa-f]{6}/g), ['#EDF4FA']);
});

test('Detail geometry comes from the tokens and the kit, fixes no text height, and truncates only the title', () => {
  // AMENDED FOR THE RECALL DETAIL KIT: the header photo is the kit's
  // contained 112×144 and a card's matched image its 64pt thumbnail, both
  // from `constants/detail-design.ts`; the retired table's column width and
  // 40pt row image are gone from the screen.
  assert.ok(IMAGE_SET.includes('width: detailGeometry.headerPhotoWidth'));
  assert.ok(IMAGE_SET.includes('height: detailGeometry.headerPhotoHeight'));
  assert.ok(IMAGE_SET.includes('size={PHOTO}'));
  assert.equal(layout.pageDotSize, 8);
  assert.ok(DETAIL.includes('width: detailGeometry.productThumbnail'));
  assert.ok(!DETAIL.includes('layout.tableColumnWidth'));
  assert.ok(!DETAIL.includes('layout.rowMediaSize'));
  assert.ok(DETAIL.includes('maxWidth: layout.maxContentWidth'));
  // The only fixed heights: the card thumbnail's square, the distribution
  // glyph box (one body LINE tall, so the pin and the store stay centred on
  // the first line at any text size), and the symptom bubble's disc. No
  // text container has a height.
  const heights = codeOnly(DETAIL).match(/\bheight: [^,]+/g) ?? [];
  assert.deepEqual(heights, [
    'height: detailGeometry.productThumbnail',
    'height: detailType.body.lineHeight',
    'height: detailGeometry.symptomBubble',
  ]);
  assert.ok(!DETAIL.includes('maxFontSizeMultiplier'));
  assert.ok(!DETAIL.includes('ellipsizeMode'));
  // Safety-critical text wraps. ONE clamp exists: the title's two-line
  // disclosure, reversible in place, lifted entirely at accessibility sizes,
  // and never hiding the name from search, speech, share, push or identity.
  assert.equal((DETAIL.match(/numberOfLines=/g) ?? []).length, 1);
  assert.ok(DETAIL.includes('numberOfLines={titleClamped ? DETAIL_TITLE_LINES : undefined}'));
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
  const whereSold = DETAIL.slice(order[1], order[2]);
  const lead = whereSold.indexOf('whereSold.lead');
  const community = whereSold.indexOf('<CommunityReportsBlock section={communityReports} />');
  assert.ok(lead !== -1 && community !== -1 && lead < community);
  assert.ok(!DETAIL.slice(order[0], order[1]).includes('CommunityReportsBlock'));
  assert.ok(!DETAIL.slice(DETAIL.indexOf('styles.header'), order[0]).includes('CommunityReports'));
  assert.ok(!DETAIL.slice(order[2]).includes('CommunityReportsBlock'));
  // AMENDED FOR THE RECALL DETAIL KIT: a full-width thin divider separates
  // EVERY major section, the header included, so What Happened has one too.
  // An optional section keeps its divider inside its own conditional, so a
  // section that does not render leaves none behind.
  for (const index of order) {
    const before = DETAIL.slice(0, index).slice(-360);
    assert.match(
      before,
      /(\? \(\s*<>\s*<View style=\{styles\.divider\} \/>|<View style=\{styles\.divider\} \/>\s*$)/,
    );
  }
  const whereSoldOpen = DETAIL.slice(0, order[1]).slice(-360);
  assert.ok(
    !/\{whereSold \?/.test(whereSoldOpen),
    'Where It Was Sold regained a presence condition',
  );
  // No divider inside the product header itself.
  assert.ok(
    !DETAIL.slice(
      DETAIL.indexOf('<View style={styles.header}>'),
      DETAIL.indexOf('model.affectsYou ?'),
    ).includes('styles.divider'),
  );
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
  assert.equal(CARD_FIELD_INLINE_VALUES, 2);
  assert.deepEqual(disclosureControl(10, 'states'), {
    expandLabel: 'See all (10)',
    collapseLabel: 'Show less',
    expandAccessibilityLabel: 'See all 10 states',
    collapseAccessibilityLabel: 'Show less',
  });
  // The kit's per-field control: "Show more", spoken with the whole count.
  assert.deepEqual(fieldDisclosureControl(4, 'lot codes'), {
    expandLabel: 'Show more',
    collapseLabel: 'Show less',
    expandAccessibilityLabel: 'Show all 4 lot codes',
    collapseAccessibilityLabel: 'Show less',
  });
  // The screen renders the model's collapsed/expanded views and its
  // controls; it slices, counts and thresholds nothing itself.
  for (const forbidden of [
    '.slice(',
    '> 5',
    '>= 5',
    '> 2',
    '>= 2',
    'INITIAL_',
    'See all',
    'Show more',
  ]) {
    assert.ok(!codeOnly(DETAIL).includes(forbidden), `Detail decides a threshold: ${forbidden}`);
  }
  assert.ok(DETAIL.includes('statesExpanded ? whereSold.lead : whereSold.leadCollapsed'));
  assert.ok(DETAIL.includes('control={whereSold.statesDisclosure}'));
  assert.ok(DETAIL.includes('control={affectedProducts.table.rowsDisclosure}'));
  assert.ok(DETAIL.includes('control={group.disclosure}'));
  assert.ok(DETAIL.includes('const lines = open ? group.lines : group.collapsedLines;'));
  assert.equal((DETAIL.match(/<DetailDisclosure\b/g) ?? []).length, 3);
});

test('verified pairs render as whole labelled entries, expanded and collapsed as one group', () => {
  // AMENDED FOR THE FOUNDER'S GRANOLA REVIEW (2026-10-08). The table's two
  // aligned half-columns were retired by the kit, and its "code · date" tuple
  // line is now retired too: each verified pair is ONE structured entry the
  // model built — the code under its own label, its date under the source's
  // date type — rendered as a compact block with no outer "Lot codes" label.
  // The halves still cannot be truncated, sorted or expanded apart, and no
  // display string is ever re-split (dates carry commas).
  assert.ok(!DETAIL.includes(".split('"), 'the screen re-splits a display string');
  assert.ok(DETAIL.includes('const stateId = cardGroupStateId(card.id, group.id);'));
  assert.ok(DETAIL.includes('const open = openGroups.has(stateId);'));
  assert.ok(DETAIL.includes('visibleCellState('));
  assert.ok(DETAIL.includes('const entries = (open ? group.pairs : group.collapsedPairs) ?? [];'));
  assert.ok(DETAIL.includes('<FieldRow label={entry.code.label} value={entry.code.value}'));
  // An undated code is an entry with no date row — never a borrowed date,
  // never a dropped code.
  assert.ok(DETAIL.includes('{entry.date ? ('));
  assert.ok(PRESENTATION.includes("date: date === '' ? null : { label: dateLabel, value: date },"));
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
  // P2B7X.1 added `chevron-left` for the onboarding screens' back control
  // (a rotation of `chevron-down`, like `chevron-right`); it is no longer an
  // unused Figma glyph. Share and sliders still have no behaviour.
  for (const glyph of ['share', 'sliders']) {
    assert.ok(!ICON.includes(`'${glyph}'`), `the icon set gained an unused ${glyph} glyph`);
    assert.ok(!ICON.includes(`${glyph}:`), `the icon set gained an unused ${glyph} glyph`);
  }
  // The onboarding paywall (2026-10-01) added a `bell` GLYPH for its second
  // benefit row: drawing beside the words `Get matching recall alerts`, in a
  // row that is not a control. Figma's bell CONTROL is still nowhere: the
  // glyph is named by the paywall's benefit list and by no other source.
  const bellUsers = clientSourceFiles()
    .filter(({ source }) => /['"]?\bbell['"]?:|['"]bell['"]/.test(codeOnly(source)))
    .map(({ path }) => path)
    .sort();
  assert.deepEqual(bellUsers, ['components/ui/icon.tsx', 'lib/onboarding-paywall-presentation.ts']);
  // The pressables the screen adds are its external links — the official
  // notice, the Health Risk guide source, and (decision E) each guide's own
  // source in a multi-hazard section — the title's disclosure, and the one
  // Detail disclosure control (states, rows, card fields); every other
  // control is a shared primitive with real behaviour.
  assert.equal((code.match(/<Pressable\b/g) ?? []).length, 5);
  assert.equal((code.match(/accessibilityRole="link"/g) ?? []).length, 3);
  assert.equal((code.match(/Linking\.openURL\(/g) ?? []).length, 3);
  assert.equal((code.match(/accessibilityHint=\{EXTERNAL_LINK_HINT\}/g) ?? []).length, 3);
  assert.equal((code.match(/<ExternalLinkLabel /g) ?? []).length, 3);
  assert.equal((code.match(/hitSlop=\{LINK_HIT_SLOP\}/g) ?? []).length, 3);
  // No horizontally scrolling surface: the table became vertical cards
  // (Recall Detail kit), and the image pager lives in its own component.
  assert.equal((code.match(/\bhorizontal\b/g) ?? []).length, 0);
  // The save control is the shared contract, once — in the navigation bar,
  // opposite Back (Recall Detail kit, 2026-10-07, superseding P2A's place in
  // the product header). The purpose this pin always served is kept: ONE
  // save control, with the shared state, spoken label and selected state,
  // and no header button on any other pushed screen. It is a native bar item
  // (a Pressable in a native-stack header began presses it never completed
  // on iOS 26), registered on Detail's own Stack.Screen, never the root.
  assert.ok(!code.includes('<SaveRecallButton'));
  assert.equal((code.match(/useSaveHeaderItems\(/g) ?? []).length, 1);
  assert.ok(code.includes('unstable_headerRightItems: () => saveItems'));
  assert.ok(!ROOT_LAYOUT.includes('headerRight'));
  const SAVE = read('components', 'save-recall-button.tsx');
  for (const shared of [
    'saveControlState(isSavedId(ids, caseId))',
    'accessibilityLabel: state.accessibilityLabel',
    'selected: state.selected',
    'onPress: () => void toggle(caseId)',
    "icon: { type: 'image', source: iconSource(state.icon) }",
  ]) {
    assert.ok(SAVE.includes(shared), `the header item left the shared save contract: ${shared}`);
  }
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
  // The model's set, overridden only by a development fixture (never in a
  // release build).
  assert.equal(DETAIL.split('model.productImages').length - 1, 1);
  assert.ok(
    DETAIL.includes(
      'DEVELOPMENT_FIXTURES?.developmentDetailFixture(id)?.images ?? model.productImages',
    ),
  );
  assert.match(DETAIL, /\{productImages \? <OfficialImageSet set=\{productImages\} \/> : null\}/);
  assert.ok(!DETAIL.includes('model.heroImageUrl'));
  // One usable image is still exactly the tile Detail always showed, and
  // every page of a set is that same tile.
  assert.match(IMAGE_SET, /<MediaTile\s+uri=\{pages\[0\]\.url\}/);
  assert.match(IMAGE_SET, /<MediaTile\s+uri=\{item\.url\}/);
  // The notice label: the kit's badge type on its own informational palette,
  // spoken as the contract's words.
  assert.ok(NOTICE_LABEL.includes('accessibilityLabel={label}'));
  assert.ok(NOTICE_LABEL.includes("const palette = noticeTypePalette['public-health-alert'];"));
  assert.match(
    NOTICE_LABEL,
    /<Text style=\{\[labelType\.badge[^>]*>\s*\{label\.toUpperCase\(\)\}\s*<\/Text>/,
  );
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
    '@/constants/detail-design',
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
  assert.ok(IMAGE_SET.includes("'no-hide-descendants'"));
  assert.ok(IMAGE_SET.includes('accessible={unavailable !== null}'));
  // Recall Detail kit: two pages show dots alone, so when a failure leaves
  // two, the dots — and only then — carry the one failure sentence.
  assert.ok(IMAGE_SET.includes("accessible={indicator === 'dots' && unavailable !== null}"));
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
  // The one image Affected Products may still show is the strictly matched
  // row image, drawn by that row's own card.
  assert.match(DETAIL, /const image = card\.image \? \(/);
  assert.ok(DETAIL.includes('uri={card.image.url}'));
  assert.ok(DETAIL.includes('size={CARD_THUMBNAIL}'));
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

test('the retailer names and the Common symptoms subheading are text colour, never the muted grey', () => {
  // AMENDED FOR THE RECALL DETAIL KIT. The retailer row shows the store
  // glyph and the names — no visible "Retailers:" — in the body role and the
  // text colour; and "Common symptoms" is an 18/24 bold subheading beneath
  // Health Risk (no colon, no divider before it), also in the text colour.
  const retailerRow = DETAIL.slice(
    DETAIL.indexOf('{whereSold.retailersNamed ?'),
    DETAIL.indexOf('{/* Community shopper reports'),
  );
  assert.ok(retailerRow.length > 0, 'the retailer row moved');
  assert.ok(!retailerRow.includes('secondaryColor'), 'the retailer names are muted');
  assert.match(retailerRow, /detailType\.body, styles\.textColor/);
  assert.ok(!/>\s*Retailers:/.test(retailerRow), 'the visible Retailers: prefix returned');

  const symptomsStart = DETAIL.indexOf('{healthRisk.symptoms ?');
  const symptoms = DETAIL.slice(symptomsStart, DETAIL.indexOf('<SymptomList', symptomsStart));
  assert.ok(symptoms.length > 0, 'the symptom subheading moved');
  assert.ok(!symptoms.includes('secondaryColor'), 'the Common symptoms subheading is muted');
  assert.match(symptoms, /detailType\.symptomSubheading, styles\.textColor/);
  assert.match(symptoms, /accessibilityRole="header"/);
  assert.ok(symptoms.includes('Common symptoms'));
  assert.ok(!symptoms.includes('Common symptoms:'));
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(codeOnly(DETAIL)), 'Detail spells a raw colour');
});

// ── The Detail title's four-line disclosure (P2B7V) ─────────────────────────

test('the title clamp is two lines, measured, reversible, and lifted at accessibility sizes', () => {
  const block = DETAIL.slice(
    DETAIL.indexOf('<View style={styles.titleBlock}>'),
    DETAIL.indexOf('{/* The product category'),
  );
  assert.ok(block.length > 0, 'the title block moved');

  // Two lines (Recall Detail kit; P2B7V set four), from the shared copy
  // module — never a number spelled here.
  assert.ok(block.includes('numberOfLines={titleClamped ? DETAIL_TITLE_LINES : undefined}'));
  assert.equal(DETAIL_TITLE_LINES, 2);
  assert.ok(!/numberOfLines=\{\d\}/.test(DETAIL), 'the clamp count was inlined');
  // Expanding removes the clamp entirely; accessibility sizes never clamp.
  assert.ok(DETAIL.includes('const titleClamped = !largeText && !titleExpanded;'));

  // OVERFLOW IS MEASURED, never guessed from the string.
  assert.ok(block.includes('lines.length > DETAIL_TITLE_LINES'));
  assert.ok(!/productName\.length/.test(DETAIL), 'the control is decided by a character count');
  assert.ok(!/\.length\s*>\s*\d{2,}/.test(block), 'the control is decided by a character count');
  const probe = DETAIL.slice(DETAIL.indexOf('titleProbe: {'), DETAIL.indexOf('disclosure: {'));
  assert.match(probe, /position: 'absolute'/);
  assert.match(probe, /opacity: 0/);
  for (const forbidden of ['height:', 'minHeight:', 'maxHeight:']) {
    assert.ok(!probe.includes(forbidden), `the title probe fixes ${forbidden}`);
  }
  assert.ok(block.includes('accessibilityElementsHidden'));
  assert.ok(block.includes('importantForAccessibility="no"'));
  const probeElement = block.slice(
    block.indexOf('styles.titleProbe'),
    block.indexOf('{titleOverflows && !largeText ?'),
  );
  assert.ok(!probeElement.includes('numberOfLines'), 'the measuring copy is itself clamped');

  // The control exists ONLY when the title overflows, and not at
  // accessibility sizes (where the title is already complete). "Show full
  // title" with a down chevron; "Show less" with an up chevron.
  assert.match(block, /\{titleOverflows && !largeText \? \([\s\S]*?\) : null\}/);
  assert.ok(block.includes('DETAIL_TITLE_EXPAND_LABEL'));
  assert.ok(block.includes('DETAIL_TITLE_COLLAPSE_LABEL'));
  assert.ok(block.includes("name={titleExpanded ? 'chevron-up' : 'chevron-down'}"));
  assert.ok(block.includes('accessibilityState={{ expanded: titleExpanded }}'));
  assert.ok(!block.includes('<Button'), 'the title control became a primary action');
  assert.match(block, /detailType\.action, styles\.linkColor/);
  assert.ok(block.includes('accessibilityLabel={model.productName}'));

  const card = read('components', 'recall-card.tsx');
  assert.ok(!card.includes('DETAIL_TITLE_LINES'));
  assert.ok(!card.includes('titleExpanded'));
});

test('every per-recall disclosure resets when the route points at another recall', () => {
  const code = codeOnly(DETAIL);
  // Reset during RENDER, not in an effect: an effect would paint one frame of
  // the previous recall's expanded title before correcting itself.
  assert.match(code, /if \(shownId !== id\) \{/);
  for (const reset of [
    'setShownId(id);',
    'setTitleExpanded(false);',
    'setTitleOverflows(false);',
    'setStatesExpanded(false);',
    'setTableExpanded(false);',
  ]) {
    assert.ok(code.includes(reset), `navigating to another recall does not reset: ${reset}`);
  }
  // The title state is the screen's alone and never reaches the model, so no
  // projection, search entry or share string can see a shortened name.
  const presentation = read('lib', 'recall-presentation.ts');
  for (const leaked of ['titleExpanded', 'titleOverflows', 'DETAIL_TITLE_LINES']) {
    assert.ok(!presentation.includes(leaked), `the shared contract learned about ${leaked}`);
  }
});

// ── Retailer visibility in Where It Was Sold (P2B7O) ────────────────────────

test('the retailers a notice named render under the geography, never instead of it', () => {
  const section = DETAIL.slice(
    DETAIL.indexOf('<Section\n          title="Where It Was Sold"'),
    DETAIL.indexOf('{/* Health Risk (P1B)'),
  );
  assert.ok(section.length > 0, 'the Where It Was Sold section moved');
  assert.ok(
    section.indexOf('whereSold.lead') < section.indexOf('whereSold.retailersNamed'),
    'the retailers were placed above the geography they narrow',
  );
  // AMENDED FOR THE RECALL DETAIL KIT: the map pin, then the location; the
  // store glyph, then the names — both 24pt, from the shared icon system,
  // in the same leading column, with no visible "States" or "Retailers".
  assert.match(section, /name="map-pin" points=\{detailGeometry\.interfaceGlyph\}/);
  assert.match(section, /name="store" points=\{detailGeometry\.interfaceGlyph\}/);
  assert.equal((section.match(/name="store"/g) ?? []).length, 1);
  assert.ok(!section.includes('require('), 'the retailer row introduced an image asset');
  const rendered = section.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.ok(!/>\s*Retailers:/.test(rendered), 'the visible Retailers: prefix returned');
  assert.ok(!/>\s*States\b/.test(rendered), 'a visible States prefix appeared');
  // The approved word is still SPOKEN, from the copy module's one constant.
  assert.ok(rendered.includes('`${RETAILERS_SPOKEN_PREFIX} ${whereSold.retailersNamed}`'));
  assert.match(section, /\{whereSold\.retailersNamed\}/);
  for (const forbidden of ['.join(', '.slice(', 'retailerCount', 'whereSold.retailers)']) {
    assert.ok(!section.includes(forbidden), `Detail builds its own retailer list: ${forbidden}`);
  }
  for (const forbidden of ['Sold at', 'You bought', 'Purchased', 'Available at', 'Only at']) {
    assert.ok(!section.includes(forbidden), `the retailer block overclaims: "${forbidden}"`);
  }
});

test('the retailer row is quiet metadata: no chips, no scroller, no control', () => {
  const block = DETAIL.slice(
    DETAIL.indexOf('{whereSold.retailersNamed ?'),
    DETAIL.indexOf('{/* Community shopper reports'),
  );
  assert.ok(block.length > 0, 'the retailer row moved');
  for (const forbidden of [
    'Chip',
    'CategoryTag',
    'Callout',
    'horizontal',
    'ScrollView',
    'FlatList',
    'Pressable',
    'onPress',
    'Disclosure',
    'Link',
  ]) {
    assert.ok(!block.includes(forbidden), `the retailer row introduced ${forbidden}`);
  }
  // One utterance: the row is ONE accessible element, spoken as "Retailers:
  // ALDI and BJ's", so the prefix the screen no longer shows is still heard.
  // The store glyph is decorative (the shared Icon hides itself).
  assert.equal((block.match(/accessibilityRole="header"/g) ?? []).length, 0);
  assert.match(block, /\baccessible\b/);
  assert.equal((block.match(/accessibilityLabel=/g) ?? []).length, 1);
});

test('the retailer names wrap inline and fix no height', () => {
  const styles = DETAIL.slice(
    DETAIL.indexOf('distributionRow: {'),
    DETAIL.indexOf('// Health Risk: the Common symptoms'),
  );
  assert.ok(styles.length > 0, 'the distribution styles moved');
  const block = DETAIL.slice(
    DETAIL.indexOf('{whereSold.retailersNamed ?'),
    DETAIL.indexOf('{/* Community shopper reports'),
  );
  assert.ok(!block.includes('numberOfLines'), 'the retailer names are clamped');
  assert.ok(!block.includes('ellipsizeMode'), 'the retailer names truncate');
  // The geography and retailer lines share ONE row shape: glyph first, text
  // in its own column, so a long list wraps beneath itself, never under the
  // glyph.
  assert.equal((block.match(/style=\{styles\.distributionRow\}/g) ?? []).length, 1);
  assert.match(styles, /flexDirection: 'row'/);
  assert.match(styles, /alignItems: 'flex-start'/);
  assert.ok(!styles.includes('marginLeft'));
  assert.ok(!styles.includes('paddingLeft'));
  const rowStyles = DETAIL.slice(
    DETAIL.indexOf('distributionRow: {'),
    DETAIL.indexOf('distributionGlyph: {'),
  );
  for (const forbidden of ['height:', 'maxHeight:', 'overflow:']) {
    assert.ok(!rowStyles.includes(forbidden), `the distribution row fixes ${forbidden}`);
  }
  assert.match(styles, /distributionGlyph: \{\s*height: detailType\.body\.lineHeight/);
  assert.match(styles, /distributionText: \{\s*flex: 1,/);
});

test('decision E: a multi-hazard Health Risk keeps one heading and one Common symptoms subheading', () => {
  const start = DETAIL.indexOf('{healthRisk.hazards ? (');
  const block = DETAIL.slice(start, DETAIL.indexOf(') : (', start));
  assert.ok(start >= 0 && block.length > 0, 'the multi-hazard branch moved');
  // ONE major heading for the section, whichever branch renders inside it,
  // and one Common symptoms subheading for all the guides; the organism
  // labels are the small bold metadata role.
  assert.equal((DETAIL.match(/<Section title="Health Risk">/g) ?? []).length, 1);
  assert.ok(DETAIL.indexOf('<Section title="Health Risk">') < start);
  assert.equal((block.match(/Common symptoms/g) ?? []).length, 1);
  assert.equal((block.match(/detailType\.symptomSubheading/g) ?? []).length, 1);
  assert.equal((block.match(/detailType\.metadataStrong/g) ?? []).length, 2);
  assert.match(
    block,
    /accessibilityLabel=\{`\$\{hazard\.source\.label\} about \$\{hazard\.organism\}`\}/,
  );
  assert.match(block, /label=\{`\$\{hazard\.organism\} symptoms`\}/);
  assert.ok(!block.includes('secondaryColor'));
});
