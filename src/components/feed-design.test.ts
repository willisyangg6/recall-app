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
  // Media: rendered unconditionally — the tile exists in every state. The
  // tile itself is the shared primitive (P2B2 extracted it for Detail).
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
  // Every Text element on the Feed and the card names its variant.
  for (const [name, source] of [
    ['feed', FEED],
    ['card', CARD],
    ['save button', SAVE_BUTTON],
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
  assert.ok(CARD.includes('<Text variant="micro-caption" color="text/secondary">'));
  assert.ok(CARD.includes('<Text variant="heading-3">{model.productName}</Text>'));
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

test('the media tile keeps the same square footprint with an image, a failed image, or none', () => {
  assert.equal(layout.cardMediaSize, 112);
  assert.ok(CARD.includes('size={layout.cardMediaSize}'));
  // The shared tile (P2B2) is a square of the caller's size in every state.
  assert.ok(MEDIA_TILE.includes('{ width: size, height: size }'));
  assert.ok(MEDIA_TILE.includes('background="background/media-placeholder"'));
  assert.ok(MEDIA_TILE.includes('onError={() => setFailed(true)}'));
  assert.ok(
    MEDIA_TILE.includes('resizeMode="contain"'),
    'a label photo is never cropped or distorted',
  );
  // No broken-image glyph and no substitute picture: the only image source
  // is the model's own hero URL.
  assert.equal((codeOnly(MEDIA_TILE).match(/source=\{/g) ?? []).length, 1);
  assert.ok(MEDIA_TILE.includes('source={{ uri: image }}'));
  assert.ok(!CARD.includes('source={'), 'the card renders no image of its own');
  assert.ok(!CARD.includes('PhotoThumbnail'));
  assert.ok(!CARD.includes('require('), 'the card bundles no stock image');
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

test('the save control still toggles the same device-local store with the same words', () => {
  assert.ok(SAVE_BUTTON.includes("from '@/hooks/use-saved-recalls'"));
  assert.ok(SAVE_BUTTON.includes('onPress={() => void toggle(caseId)}'));
  assert.ok(SAVE_BUTTON.includes('if (!available) return null;'));
  assert.ok(SAVE_BUTTON.includes('{saved ? SAVED_ACTION_LABEL : SAVE_ACTION_LABEL}'));
  assert.ok(SAVE_BUTTON.includes("name={saved ? 'bookmark-filled' : 'bookmark'}"));
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
  assert.ok(CARD.includes('label: saved ? SAVED_ACCESSIBILITY_LABEL : SAVE_ACCESSIBILITY_LABEL'));
});

// ── 8. Long content wraps ───────────────────────────────────────────────────

test('nothing on the card truncates or fixes a height around real product text', () => {
  assert.ok(!CARD.includes('numberOfLines'));
  assert.ok(!CARD.includes('ellipsizeMode'));
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
    { today: '2026-09-14', affectsYou: false },
  );
  assert.equal(three.locationSummary, 'CA, NY +1');
  const two = buildHomeCardModel(item({ geography: geo('states', ['California', 'New York']) }), {
    today: '2026-09-14',
    affectsYou: false,
  });
  assert.equal(two.locationSummary, 'CA, NY');
  const national = buildHomeCardModel(item({ geography: geo('nationwide') }), {
    today: '2026-09-14',
    affectsYou: false,
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
    for (const forbidden of ['design-preview', 'DesignPreview', '__DEV__', 'isDevelopmentBuild']) {
      assert.ok(!codeOnly(source).includes(forbidden), `${name} references ${forbidden}`);
    }
  }
  assert.ok(PROFILE.includes('{__DEV__ ? ('));
  assert.ok(PREVIEW.includes('if (!isDevelopmentBuild())'));
  // The gallery renders the product's card over live recalls and names its
  // two simulated values; it invents no recall content.
  assert.ok(PREVIEW.includes('FEED CARD MATRIX'));
  assert.ok(PREVIEW.includes('buildHomeCardModel(item, { today, affectsYou: false })'));
  assert.ok(PREVIEW.includes('relevance simulated'));
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
  // P2B5 the chevron-right that Profile's navigation rows carry; there is
  // still no bell, share, sliders or chevron-left glyph.
  assert.deepEqual(glyphs, [
    'bookmark',
    'bookmark-filled',
    'chevron-down',
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
  assert.ok(PERSONALIZE_CTA.body.includes('Feed will show what affects you'));
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
