/**
 * The Feed's visual implementation (P2B1), pinned at the source level.
 *
 * React Native components cannot render under Node, so — as the
 * design-foundation, feed-controls and saved-recalls suites do — these tests
 * read the Feed, the card, the controls and the tab layout as text and pin
 * what the milestone promises: the complete four-state card matrix, the
 * approved typography on every Feed surface, risk and relevance kept apart,
 * the no-image geometry, the unchanged search / mode / save behaviour, the
 * card press and the save press not conflicting, long content left free to
 * wrap, the unchanged geography contract, exactly three destinations, the
 * development-only harness staying development-only, no inert Figma-only
 * control, and the presentation contract untouched by any of it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { layout, relevancePalette } from '@/constants/design-tokens';
import { PERSONALIZE_CTA } from '@/lib/feed-copy';
import type { FeedItem } from '@/lib/recall-feed';
import { buildHomeCardModel } from '@/lib/recall-presentation';

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

const FEED = read('app', '(tabs)', 'index.tsx');
const TAB_LAYOUT = read('app', '(tabs)', '_layout.tsx');
const PROFILE = read('app', '(tabs)', 'profile.tsx');
const PREVIEW = read('app', 'design-preview', 'index.tsx');
const CARD = read('components', 'recall-card.tsx');
const SAVE_BUTTON = read('components', 'save-recall-button.tsx');
const STATE_MESSAGE = read('components', 'state-message.tsx');
const MEDIA_TILE = read('components', 'ui', 'media-tile.tsx');
const NOTICE_LABEL = read('components', 'ui', 'notice-label.tsx');
const ICON = read('components', 'ui', 'icon.tsx');
const CHIP = read('components', 'ui', 'chip.tsx');
const SEARCH_BAR = read('components', 'ui', 'search-bar.tsx');
const RELEVANCE_LABEL = read('components', 'ui', 'relevance-label.tsx');
const CATEGORY_TAG = read('components', 'ui', 'category-tag.tsx');
const RISK_LABEL = read('components', 'ui', 'risk-label.tsx');
const PRESENTATION = read('lib', 'recall-presentation.ts');
const FEED_COPY = read('lib', 'feed-copy.ts');

/** Every file that renders Feed consumer text. */
const FEED_SURFACES: Record<string, string> = {
  feed: FEED,
  card: CARD,
  'save button': SAVE_BUTTON,
  'state message': STATE_MESSAGE,
  chip: CHIP,
  'search bar': SEARCH_BAR,
  'relevance label': RELEVANCE_LABEL,
  // P2B7D: the product-category tag is a Feed surface too — same tokens,
  // same type scale, and (below) deliberately NOT the mono label type.
  'category tag': CATEGORY_TAG,
  'tab layout': TAB_LAYOUT,
};

/** Source with comments removed, so a file may document what it does not do. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function geo(scope: 'nationwide' | 'states' | 'unknown', states: string[] = []) {
  return { scope, states, confidence: 'stated' as const, sourceText: null };
}

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'design-001',
    sourceAgency: 'FSIS',
    noticeType: 'recall',
    state: 'active',
    title: 'Design Case',
    classification: {
      value: 'class_I',
      sourceText: 'Class I',
      officialClasses: ['class_I'],
    } as FeedItem['classification'],
    hazardCategory: 'unknown',
    publishedAt: '2026-09-01',
    lastPublicActivityAt: '2026-09-01',
    reasonText: null,
    pathogenOrAllergen: null,
    firmName: null,
    brands: [],
    productDescription: null,
    retailerNames: [],
    heroImageUrl: null,
    productNames: [],
    geography: geo('unknown'),
    officialUrl: 'https://example.gov',
    timeline: [],
    ...overrides,
  };
}

// ── 1. The four-state card matrix ───────────────────────────────────────────

test('the card renders relevance and media as two independent, upstream-decided dimensions', () => {
  // Relevance: the shared primitive, gated on the model's verdict and nothing else.
  assert.ok(CARD.includes('{model.affectsYou ? <RelevanceLabel /> : null}'));
  assert.equal((CARD.match(/<RelevanceLabel \/>/g) ?? []).length, 1);
  // Media: the card hands the tile every state unconditionally and the
  // shared primitive (P2B2 extracted it for Detail) decides what renders —
  // since P2B7I, nothing at all for an absent or failed image — so the card
  // holds no media rule of its own that Saved could drift from.
  assert.match(
    CARD,
    /<MediaTile\s+uri=\{model\.heroImageUrl\}\s+alt=\{model\.productName\}\s+size=\{layout\.cardMediaSize\}\s*\/>/,
  );
  assert.ok(!/heroImageUrl \?/.test(codeOnly(CARD)), 'the media tile must not be conditional');
  // The two dimensions are read from the model, never derived on the card.
  assert.ok(!CARD.includes('evaluatePersonalRelevance'));
  assert.ok(!CARD.includes('allocateRecallImages'));
});

// ── 2. Approved typography everywhere ───────────────────────────────────────

test('every Feed surface draws its text from the type scale and the tokens, never its own', () => {
  for (const [name, source] of Object.entries(FEED_SURFACES)) {
    const code = codeOnly(source);
    for (const forbidden of [
      'fontSize:',
      'fontWeight:',
      'fontFamily:',
      'lineHeight:',
      'ThemedText',
      'ThemedView',
      "from '@/constants/theme'",
      'Spacing.',
      'Radii.',
      'Colors.',
      'useTheme',
    ]) {
      assert.ok(!code.includes(forbidden), `${name} contains ${forbidden}`);
    }
  }
  // Every Text element on the Feed and the card names its variant. The save
  // control is absent from this list because since P2B7H it renders NO Text
  // at all — the icon-only test below pins that directly, which is a
  // stronger statement than "its Text names a variant".
  for (const [name, source] of [
    ['feed', FEED],
    ['card', CARD],
    ['state message', STATE_MESSAGE],
  ]) {
    const openings = source.match(/<Text\b[^>]*>/g) ?? [];
    assert.ok(openings.length > 0, `${name} renders Text`);
    for (const opening of openings) {
      assert.ok(opening.includes('variant='), `${name}: ${opening} has no variant`);
    }
  }
  // The tab labels are the caption token.
  assert.ok(TAB_LAYOUT.includes("tabBarLabelStyle: textStyle('caption')"));
  assert.ok(TAB_LAYOUT.includes("textStyle('heading-3')"));
});

test('IBM Plex Mono is used only for compact status labels, never for words people read', () => {
  // The Feed screen, the save control, the chips, the search bar and the
  // state message use no mono token at all.
  for (const [name, source] of [
    ['feed', FEED],
    ['save button', SAVE_BUTTON],
    ['chip', CHIP],
    ['search bar', SEARCH_BAR],
    ['state message', STATE_MESSAGE],
    // P2B7D: the category tag is product metadata a shopper reads, not a
    // compact status label — so it is Public Sans, like the brand beside it.
    ['category tag', CATEGORY_TAG],
    ['tab layout', TAB_LAYOUT],
  ]) {
    assert.ok(!codeOnly(source).includes('variant="label'), `${name} uses the mono label type`);
  }
  // The card uses it exactly once: the Public Health Alert notice label,
  // which sits beside the risk label and is the same kind of thing.
  // The notice label is the shared primitive (P2B2); the card holds no
  // mono text of its own.
  assert.equal((codeOnly(CARD).match(/variant="label"/g) ?? []).length, 0);
  assert.ok(CARD.includes("import { NoticeLabel } from '@/components/ui/notice-label';"));
  assert.equal((codeOnly(NOTICE_LABEL).match(/variant="label"/g) ?? []).length, 1);
  // The timestamp, name, brand, summary and location are Public Sans tokens.
  // P2B7H: the activity date is `caption` (12pt), not `micro-caption`
  // (10pt) — see the readable-metadata test below for the size contract.
  assert.ok(CARD.includes('<Text variant="caption" color="text/secondary">'));
  assert.ok(
    !codeOnly(CARD).includes('variant="micro-caption"'),
    'the card reintroduced the 10pt micro-caption',
  );
  assert.ok(
    /<Text variant="heading-3" numberOfLines=\{3\}>\s*\{model\.productName\}\s*<\/Text>/.test(CARD),
  );
  assert.ok(CARD.includes('<Text variant="body-small" color="text/secondary">'));
});

// ── 3. Risk and relevance stay separate ─────────────────────────────────────

test('the relevance label cannot be handed a risk tier, and the risk label cannot render relevance', () => {
  assert.ok(RELEVANCE_LABEL.includes("relevancePalette['affects-you']"));
  assert.ok(
    RELEVANCE_LABEL.includes('export function RelevanceLabel()'),
    'no props: no tier can reach it',
  );
  for (const forbidden of ['riskPalette', 'ConsumerRiskTier', 'risk-tier']) {
    assert.ok(
      !codeOnly(RELEVANCE_LABEL).includes(forbidden),
      `relevance label mentions ${forbidden}`,
    );
  }
  assert.ok(!codeOnly(RISK_LABEL).includes('relevancePalette'));
  assert.ok(RELEVANCE_LABEL.includes("RELEVANCE_LABEL_TEXT = 'AFFECTS YOU'"));
  assert.ok(RELEVANCE_LABEL.includes("RELEVANCE_ACCESSIBILITY_LABEL = 'Affects you'"));
  // One of each on the card, and the risk one reads the model's tier.
  const riskUses = CARD.match(/<RiskLabel[\s\S]*?\/>/g) ?? [];
  assert.equal(riskUses.length, 1);
  assert.ok(riskUses[0].includes('tier={model.risk.tier}'));
  // Lime is relevance alone: no risk treatment uses it.
  assert.equal(relevancePalette['affects-you'].background, '#E2EE57');
});

// ── 4. No-image geometry ────────────────────────────────────────────────────

test('the media column exists only for a usable image — no placeholder square for an absent or failed one', () => {
  // AMENDED FOR P2B7I (founder direction). Through P2B7H the tile kept its
  // square in every state and drew the bare placeholder for "none" and
  // "failed" — the persistent grey rectangle on no-image cards. Now the
  // square exists only for a real image; the placeholder colour shows only
  // around a contained photo and while its request is active.
  assert.equal(layout.cardMediaSize, 112);
  assert.ok(CARD.includes('size={layout.cardMediaSize}'));
  assert.ok(MEDIA_TILE.includes('{ width: size, height: size }'));
  assert.ok(MEDIA_TILE.includes('background="background/media-placeholder"'));
  assert.ok(
    MEDIA_TILE.includes(
      'if (uri === null || failedUri === uri || hasImageFailed(uri)) return null;',
    ),
  );
  // A failed load is recorded for the session and reported to a caller that
  // must stop counting the page (the header pager); the card passes no
  // callback because its own shape already follows the tile's.
  assert.ok(MEDIA_TILE.includes('recordImageFailure(uri);'));
  assert.ok(MEDIA_TILE.includes('onLoadFailed?.(uri)'));
  assert.ok(!CARD.includes('onLoadFailed'), 'the card counts pages');
  assert.ok(!CARD.includes('media-placeholder'), 'the card draws a placeholder of its own');
  assert.ok(
    MEDIA_TILE.includes('resizeMode="contain"'),
    'a label photo is never cropped or distorted',
  );
  // No broken-image glyph and no substitute picture: the only image source
  // is the model's own hero URL.
  assert.equal((codeOnly(MEDIA_TILE).match(/source=\{/g) ?? []).length, 1);
  assert.ok(MEDIA_TILE.includes('source={{ uri }}'));
  assert.ok(!CARD.includes('source={'), 'the card renders no image of its own');
  assert.ok(!CARD.includes('PhotoThumbnail'));
  assert.ok(!CARD.includes('require('), 'the card bundles no stock image');
  // P2B7C: Detail's product imagery can page through up to six official
  // photos; FEED IMAGERY STAYS SINGLE-IMAGE (founder decision, DESIGN.md
  // "Recall Card"). The card renders exactly one media tile, has no paging
  // component, and reads no image set or gallery.
  assert.equal((CARD.match(/<MediaTile\b/g) ?? []).length, 1);
  for (const forbidden of [
    'OfficialImageSet',
    'productImages',
    'images.gallery',
    'pagingEnabled',
    'positionLabel',
  ]) {
    assert.ok(!CARD.includes(forbidden), `feed imagery is no longer single-image: ${forbidden}`);
    assert.ok(!FEED.includes(forbidden), `feed imagery is no longer single-image: ${forbidden}`);
  }
});

// ── 5. Search and the feed modes are unchanged ──────────────────────────────

test('search filters the same corpus the same way, through the shared bar', () => {
  assert.ok(
    FEED.includes('filterBySearch(applyFeedFilters(state.items, filters), query, entryOf)'),
  );
  assert.ok(FEED.includes('<SearchBar'));
  assert.ok(FEED.includes('value={query}'));
  assert.ok(FEED.includes('onChangeText={setQuery}'));
  assert.ok(FEED.includes('placeholder="Search product, company, brand, or code"'));
  assert.ok(FEED.includes('accessibilityLabel="Search recalls"'));
  // The bar itself holds no query, matches nothing and navigates nowhere.
  for (const forbidden of ['expo-router', 'filterBySearch', 'useState', 'fetch(']) {
    assert.ok(!codeOnly(SEARCH_BAR).includes(forbidden), `search bar references ${forbidden}`);
  }
  // Its clear control clears the caller's query and hands focus back.
  assert.ok(SEARCH_BAR.includes("onChangeText('');"));
  assert.ok(SEARCH_BAR.includes('field.current?.focus();'));
  assert.ok(SEARCH_BAR.includes("CLEAR_SEARCH_ACCESSIBILITY_LABEL = 'Clear search'"));
});

test('All and Affects me are two either/or chips that only switch the mode', () => {
  assert.ok(FEED.includes("{ key: 'all', label: 'All' }"));
  assert.ok(FEED.includes("{ key: 'affects_me', label: 'Affects me' }"));
  assert.ok(
    FEED.includes(
      '<Chip key={key} label={label} selected={tab === key} onPress={() => setTab(key)} />',
    ),
  );
  // The chip reports selection semantically and holds no behaviour.
  assert.ok(CHIP.includes('accessibilityState={{ selected }}'));
  for (const forbidden of ['useState', 'expo-router', 'setTab', 'setOpenSheet']) {
    assert.ok(!CHIP.includes(forbidden), `chip references ${forbidden}`);
  }
  // No invented multi-select: every chip on the Feed does one of the three
  // existing things — switch the mode, open a sheet, or clear all.
  const chips = FEED.match(/<Chip[\s\S]*?\/>/g) ?? [];
  assert.equal(chips.length, 5, 'All, Affects me, Location, Risk, Category, Clear all');
  for (const chip of chips) {
    assert.ok(
      /onPress=\{(\(\) => setTab\(key\)|\(\) => setOpenSheet\('(location|risk|category)'\)|clearAllFilters)\}/.test(
        chip,
      ),
      `a chip does something new: ${chip}`,
    );
  }
});

// ── 6. Save behaviour is unchanged ──────────────────────────────────────────

test('the save control still toggles the same device-local store, now icon-only', () => {
  assert.ok(SAVE_BUTTON.includes("from '@/hooks/use-saved-recalls'"));
  assert.ok(SAVE_BUTTON.includes('onPress={() => void toggle(caseId)}'));
  assert.ok(SAVE_BUTTON.includes('if (!available) return null;'));
  // P2B7E: everything the control renders is ONE decision
  // (`saveControlState`) rather than inline conditionals that could drift
  // apart — the shape of the regression where the word changed and the
  // bookmark disappeared.
  assert.ok(SAVE_BUTTON.includes('saveControlState(isSavedId(ids, caseId))'));
  // P2B7H: the Figma direction (node 81:792) is the bookmark ALONE. The
  // control renders no Text element and reaches for no copy constant, so
  // the word cannot come back by accident on one surface only.
  assert.ok(!SAVE_BUTTON.includes('<Text'), 'the save control renders a visible word again');
  for (const gone of ['SAVE_ACTION_LABEL', 'SAVED_ACTION_LABEL', 'state.label']) {
    assert.ok(!SAVE_BUTTON.includes(gone), `the save control still carries ${gone}`);
  }
  assert.ok(SAVE_BUTTON.includes('<Icon name={state.icon} size={20} color="icon/primary" />'));
  // The icon is not inside any conditional in this file.
  assert.ok(
    !/\{[^}]*\?[^}]*<Icon/.test(SAVE_BUTTON),
    'the save control renders its icon conditionally',
  );
  assert.ok(SAVE_BUTTON.includes('hitSlop={HIT_SLOP}'));
  for (const forbidden of ['expo-router', 'router.', 'fetch(', 'supabase']) {
    assert.ok(!SAVE_BUTTON.includes(forbidden), `save control references ${forbidden}`);
  }
});

// ── 7. Card press and save press do not conflict ────────────────────────────

test('saving is a nested pressable inside the card link, and the card exposes it as an action', () => {
  assert.equal((CARD.match(/<Link /g) ?? []).length, 1);
  assert.ok(
    CARD.includes("<Link href={{ pathname: '/recall/[id]', params: { id: model.id } }} asChild>"),
  );
  const link = CARD.slice(CARD.indexOf('<Link '), CARD.indexOf('</Link>'));
  assert.ok(
    link.includes('<SaveRecallButton caseId={model.id} />'),
    'the save control sits inside the link',
  );
  assert.ok(SAVE_BUTTON.includes('<Pressable'), 'the save control is its own responder');
  // A screen reader can save from the card element itself, with the same
  // spoken names the control uses.
  assert.ok(CARD.includes('accessibilityActions={'));
  assert.ok(
    CARD.includes(
      'if (event.nativeEvent.actionName === SAVE_ACTION) void savedRecalls.toggle(model.id);',
    ),
  );
  assert.ok(CARD.includes('label: save.accessibilityLabel'));
  assert.ok(CARD.includes('saveControlState(isSavedId(savedRecalls.ids, model.id))'));
});

// ── 8. Long content wraps; the title alone is line-bounded (P2B7G) ──────────

test('the product name is the ONE clamped element: three lines, tail ellipsis', () => {
  // The clamp is a LINE count on the title Text only — it scales with
  // Dynamic Type, unlike a fixed height, and the tail ellipsis is the RN
  // default (no ellipsizeMode override anywhere on the card).
  assert.equal((CARD.match(/numberOfLines=/g) ?? []).length, 1);
  assert.ok(/variant="heading-3" numberOfLines=\{3\}/.test(CARD));
  assert.ok(!CARD.includes('ellipsizeMode'));
  // The clamped node's CONTENT stays the complete product name — no slicing,
  // no substring, no separate visual string — so the card's grouped
  // accessibility element announces the full title and no override hides it.
  assert.ok(/numberOfLines=\{3\}>\s*\{model\.productName\}/.test(CARD));
  assert.ok(!CARD.includes('accessibilityLabel={model.productName'));
  assert.ok(!/\.slice\(|\.substring\(/.test(codeOnly(CARD)));
});

test('nothing else on the card truncates or fixes a height around real product text', () => {
  assert.ok(!CARD.includes('maxFontSizeMultiplier'));
  // The card fixes no height at all; the media tile's square is the shared
  // primitive's, sized by the token the card passes it.
  const heights = codeOnly(CARD).match(/\bheight: [^,]+/g) ?? [];
  assert.deepEqual(heights, []);
  // The text column takes the remaining width and may shrink below its content.
  assert.ok(/identity: \{[^}]*flex: 1[^}]*minWidth: 0/s.test(CARD));
});

// ── 9. Geography is unchanged ───────────────────────────────────────────────

test('the card renders the contract’s location summary: two codes, then +N', () => {
  assert.ok(CARD.includes('{model.locationSummary}'));
  const three = buildHomeCardModel(
    item({ geography: geo('states', ['California', 'New York', 'Texas']) }),
    { today: '2026-09-14', prefs: null },
  );
  assert.equal(three.locationSummary, 'CA, NY +1');
  const two = buildHomeCardModel(item({ geography: geo('states', ['California', 'New York']) }), {
    today: '2026-09-14',
    prefs: null,
  });
  assert.equal(two.locationSummary, 'CA, NY');
  const national = buildHomeCardModel(item({ geography: geo('nationwide') }), {
    today: '2026-09-14',
    prefs: null,
  });
  assert.equal(national.locationSummary, 'Nationwide');
});

// ── 10. Exactly three destinations ──────────────────────────────────────────

test('the bottom navigation is Feed, Saved, Profile with a glyph and a visible label each', () => {
  const screens = [...TAB_LAYOUT.matchAll(/<Tabs\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(screens, ['index', 'saved', 'profile']);
  for (const [name, glyph] of [
    ['Feed', 'home'],
    ['Saved', 'bookmark'],
    ['Profile', 'user'],
  ]) {
    assert.ok(TAB_LAYOUT.includes(`tabBarLabel: '${name}'`));
    assert.ok(TAB_LAYOUT.includes(`<TabIcon name="${glyph}" focused={focused} />`));
  }
  assert.ok(TAB_LAYOUT.includes("tabBarLabelPosition: 'below-icon'"));
  assert.ok(!TAB_LAYOUT.includes("display: 'none'"), 'the icon slot is no longer hidden');
  assert.ok(TAB_LAYOUT.includes('height: layout.bottomNavHeight + insets.bottom'));
  assert.ok(TAB_LAYOUT.includes('minHeight: hitTarget.minimum'));
});

// ── 11. Development Preview stays development-only ──────────────────────────

test('the Feed and the bar carry no development entry; the harness keeps its guards', () => {
  for (const [name, source] of [
    ['feed', FEED],
    ['tab layout', TAB_LAYOUT],
  ]) {
    for (const forbidden of ['design-preview', 'DesignPreview', 'isDevelopmentBuild']) {
      assert.ok(!codeOnly(source).includes(forbidden), `${name} references ${forbidden}`);
    }
  }
  // The tab bar branches on the build type for nothing at all.
  assert.ok(!codeOnly(TAB_LAYOUT).includes('__DEV__'), 'the tab layout references __DEV__');
  // The Feed has exactly one such branch, and it is a COPY switch, not a way
  // in: it chooses the developer wording of the not-configured state, which
  // a release build (where `__DEV__` is false) never selects (P3C1; pinned
  // in lib/release-exposure.test.ts). Anything else would be a development
  // entry point on a shopper's screen.
  assert.deepEqual(codeOnly(FEED).match(/__DEV__/g), ['__DEV__'], 'the Feed uses __DEV__ twice');
  assert.ok(
    codeOnly(FEED).includes('{...(__DEV__ ? FEED_NOT_CONFIGURED_DEV : FEED_NOT_CONFIGURED)}'),
    'the Feed’s only __DEV__ branch is not the not-configured wording',
  );
  assert.ok(PROFILE.includes('{__DEV__ ? ('));
  assert.ok(PREVIEW.includes('if (!isDevelopmentBuild())'));
  // The gallery renders the product's card over live recalls and names its
  // two simulated values; it invents no recall content.
  assert.ok(PREVIEW.includes('FEED CARD MATRIX'));
  assert.ok(PREVIEW.includes('buildHomeCardModel(item, { today, prefs: null })'));
  assert.ok(PREVIEW.includes('relevance simulated'));
});

test('the shared header grows with Dynamic Type instead of clipping its title', () => {
  // P3C1.5. Feed and Saved both clipped their navigator title vertically at
  // the accessibility text sizes: the title honours Dynamic Type (no
  // `maxFontSizeMultiplier` anywhere, DESIGN.md "Dynamic Type and text
  // wrapping"), but the bar containing it was the platform's flat 44pt.
  //
  // The bar is what moves. Nothing here may cap, shrink or opt the title out
  // of scaling — that would trade a clipped title for an unreadable one.
  for (const forbidden of [
    'maxFontSizeMultiplier',
    'allowFontScaling={false}',
    'headerTitleAllowFontScaling: false',
    'adjustsFontSizeToFit',
    'numberOfLines',
  ]) {
    assert.ok(!codeOnly(TAB_LAYOUT).includes(forbidden), `the header caps text with ${forbidden}`);
  }
  // The reader's current text size is an input, read reactively so a change
  // to the setting resizes the bar rather than waiting for a cold launch.
  assert.ok(TAB_LAYOUT.includes('const { fontScale } = useWindowDimensions();'));
  assert.ok(TAB_LAYOUT.includes('* fontScale'));
  // A MINIMUM, not a height: the platform still owns the status bar, the
  // notch and landscape, and this only raises the floor when text needs it.
  assert.ok(TAB_LAYOUT.includes('minHeight: headerMinHeight'));
  assert.ok(!/headerStyle: \{[^}]*\bheight:/.test(TAB_LAYOUT), 'a fixed height would clip again');
  // The floor is the token, and the title's own line box is what scales.
  assert.ok(TAB_LAYOUT.includes('layout.navHeaderHeight'));
  assert.equal(layout.navHeaderHeight, 44);
  assert.ok(TAB_LAYOUT.includes('insets.top +'), 'the minimum covers the status bar too');
  // The title style still carries no lineHeight: React Native does not scale
  // a fixed one with Dynamic Type, so passing it would clip inside the Text.
  assert.ok(!/headerTitleStyle: \{[^}]*lineHeight/.test(TAB_LAYOUT));
  // One header for all three destinations, so none of this can drift apart.
  assert.equal((TAB_LAYOUT.match(/\.\.\.screenHeader/g) ?? []).length, 3);
});

// ── 12. No Figma-only inert control ─────────────────────────────────────────

test('no bell, no Urgency, no filter glyph, no dead control was added from Figma', () => {
  for (const [name, source] of [
    ['feed', FEED],
    ['tab layout', TAB_LAYOUT],
    ['search bar', SEARCH_BAR],
    ['card', CARD],
  ]) {
    for (const forbidden of ['bell', 'Urgency', 'sliders', 'notification', 'onPress={() => {}}']) {
      assert.ok(!codeOnly(source).includes(forbidden), `${name} contains ${forbidden}`);
    }
  }
  // The icon set is exactly what a shipped control uses.
  const glyphs = [...ICON.matchAll(/^\s+'?([a-z-]+)'?: require\(/gm)].map((m) => m[1]).sort();
  // P2B2 added the Detail frame's external-link, warning and info glyphs,
  // P2B5 the chevron-right that Profile's navigation rows carry, P2B7X.1 the
  // chevron-left of the onboarding back control and the nine allergen glyphs
  // (one Lucide family; lib/allergen-icons.ts). There is still no bell, share
  // or sliders glyph.
  assert.deepEqual(glyphs, [
    'allergen-egg',
    'allergen-fish',
    'allergen-milk',
    'allergen-peanut',
    'allergen-sesame',
    'allergen-shellfish',
    'allergen-soy',
    'allergen-tree-nut',
    'allergen-wheat',
    'bookmark',
    'bookmark-filled',
    'chevron-down',
    'chevron-left',
    'chevron-right',
    'external-link',
    'flag',
    'home',
    'info',
    'map-pin',
    'search',
    'user',
    'warning',
  ]);
});

// ── 13. The presentation contract is untouched ──────────────────────────────

test('the presentation contract knows nothing about the visual layer, and the copy is honest', () => {
  for (const forbidden of ['design-tokens', 'RelevanceLabel', 'cardMediaSize', "'@/components"]) {
    assert.ok(
      !codeOnly(PRESENTATION).includes(forbidden),
      `recall-presentation references ${forbidden}`,
    );
  }
  // The Feed's copy module is a leaf and never says "Home".
  assert.ok(!/^import /m.test(FEED_COPY));
  assert.ok(!codeOnly(FEED_COPY).includes('Home'));
  // P2B6C: the invitation names the mode it fills, and claims no knowledge of
  // what actually affects the shopper.
  assert.equal(PERSONALIZE_CTA.title, 'Set up personalization');
  assert.ok(PERSONALIZE_CTA.body.includes('matching recalls in Affects me'));
  // The screen still runs the same pipeline functions in the same order.
  for (const call of [
    'buildFeedSections(allVisible)',
    'orderByLocationTiers(sectioned.recent, filters.stateCodes)',
    'buildAffectsMeSections(state.items,',
    'evaluatePersonalRelevance(',
    'buildHomeCardModel(item, {',
  ]) {
    assert.ok(FEED.includes(call), `the Feed no longer calls ${call}`);
  }
});

// ── P2B7F: a Feed mode switch cannot take a glyph away ──────────────────────
//
// Switching All ⇄ Affects me replaces the list's data, which remounts the
// cards and the filter row. Measured over one cycle, the glyphs that remount
// are exactly the ones a founder saw disappear — map-pin, bookmark,
// bookmark-filled, flag and chevron-down — while the tab bar, the search
// field and the development gear sit outside that boundary and never remount.
// The disappearance itself is a development-server failure, recorded in
// docs/recall-development-assets.md. What these tests hold is the app half of
// the contract: no icon inside the remounting boundary is conditional on the
// mode, so a transition cannot be what removes it.

test('P2B7F: every Feed-content glyph renders independently of the mode', () => {
  // The card's location pin and the Affects-You flag are rendered outright,
  // with no `tab`/mode expression anywhere near them.
  assert.ok(CARD.includes('<Icon name="map-pin" size={12} color="icon/primary" />'));
  assert.ok(RELEVANCE_LABEL.includes('<Icon name="flag" size={12} tint={palette.foreground} />'));

  // The save control's glyph comes from the save state alone — never from a
  // feed mode, a filter, or a loading flag.
  assert.ok(SAVE_BUTTON.includes('<Icon name={state.icon} size={20} color="icon/primary" />'));

  // No `Icon` in any Feed surface sits inside a mode conditional. A card that
  // rendered its pin only in `All` would lose it on the very transition this
  // milestone investigated.
  for (const [name, source] of Object.entries(FEED_SURFACES)) {
    for (const match of source.matchAll(/<Icon\b[^>]*>/g)) {
      const line = source.slice(0, match.index).split('\n').length;
      const context = source
        .split('\n')
        .slice(Math.max(0, line - 4), line)
        .join('\n');
      assert.ok(
        !/\btab\b\s*[=!]==?/.test(context),
        `${name} renders an icon behind a feed-mode conditional`,
      );
    }
  }
});

test('P2B7F: the glyphs outside the remount boundary are unchanged', () => {
  // The tab bar, the search field and the chip chevron each keep rendering
  // through the one primitive. They survived the reported failure because a
  // mode switch never remounts them — not because they are special — so a
  // change that pulled them into the Feed's data path would newly expose
  // them. Pinning them here keeps that visible.
  for (const glyph of ['home', 'bookmark', 'user']) {
    assert.ok(TAB_LAYOUT.includes(`<TabIcon name="${glyph}" focused={focused} />`));
  }
  assert.ok(SEARCH_BAR.includes('<Icon name="search" size={20} color="icon/secondary" />'));

  // The filter chips' chevron is drawn whenever the chip declares one, and
  // its presence is decided by the chip's own prop rather than by feed state.
  assert.ok(CHIP.includes('{trailingIcon ? ('));
  assert.ok(CHIP.includes('name={trailingIcon}'));
  assert.ok(!/trailingIcon[^\n]*\btab\b/.test(CHIP), 'the chevron depends on the feed mode');
});
