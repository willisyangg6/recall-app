/**
 * Saved's visual implementation (P2B4), pinned at the source level.
 *
 * React Native components cannot render under Node, so — as the
 * design-foundation, feed-design, detail-design and report-design suites do
 * — these tests read the Saved route, the shared card, the state message,
 * the tab layout and the development gallery as text and pin what this
 * milestone promises: that Saved lists the SHARED card and forked nothing,
 * that it grew no feature (no search, sort, folders, filters, notes or bulk
 * editing), that its state copy is exact and cannot flash the wrong state,
 * that unsaving still runs through the one shared store, that a failed feed
 * read can never delete a device-local saved id, that every value on the
 * screen comes from a token or a shared primitive, that the accessibility
 * contract of the card and the tab is intact, and that the dev-only gallery
 * cannot touch the real saved list.
 *
 * The behavioural half of Saved — the toggle, the round trip, the
 * resolution against the corpus and the copy contract itself — is driven
 * against the real module in lib/saved-recalls.test.ts.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { hitTarget, layout, spacing } from '@/constants/design-tokens';
import { FEED_STALE_NOTICE } from '@/lib/feed-copy';
import {
  SAVED_EMPTY,
  SAVED_ERROR_TITLE,
  SAVED_LOADING,
  SAVED_NOT_CONFIGURED,
  SAVED_UNAVAILABLE,
  savedMissingNotice,
} from '@/lib/saved-recalls';

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

const SAVED = read('app', '(tabs)', 'saved.tsx');
const FEED = read('app', '(tabs)', 'index.tsx');
const TAB_LAYOUT = read('app', '(tabs)', '_layout.tsx');
const PREVIEW = read('app', 'design-preview', 'index.tsx');
const CARD = read('components', 'recall-card.tsx');
const SAVE_BUTTON = read('components', 'save-recall-button.tsx');
const STATE_MESSAGE = read('components', 'state-message.tsx');
const CALLOUT = read('components', 'ui', 'callout.tsx');
const HOOK = read('hooks', 'use-saved-recalls.ts');

/** Source with comments removed, so a file may document what it does not do. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

// ── 1. One card, shared with the Feed ───────────────────────────────────────

test('Saved lists the shared RecallCard and composes no card of its own', () => {
  assert.match(SAVED, /import \{ RecallCard \} from '@\/components\/recall-card'/);
  assert.match(
    SAVED,
    /<RecallCard model=\{buildHomeCardModel\(item, \{ today, affectsYou: false \}\)\} \/>/,
  );
  // Both screens build the card model with the same contract function, so a
  // saved recall cannot word, order or label anything differently.
  assert.ok(FEED.includes('buildHomeCardModel(item, {'));
  // Nothing on Saved reassembles a card: no label, no media, no save control,
  // no detail model, no risk or reason derivation of its own.
  for (const forbidden of [
    'RiskLabel',
    'NoticeLabel',
    'RelevanceLabel',
    'MediaTile',
    'SaveRecallButton',
    'buildDetailModel',
    'riskView',
    'interpretReason',
    'heroImageUrl',
  ]) {
    assert.ok(!codeOnly(SAVED).includes(forbidden), `Saved composes its own card: ${forbidden}`);
  }
});

// ── 2. Saved grew no features ───────────────────────────────────────────────

test('Saved is one plain list: no search, sorting, folders, filters, notes or bulk editing', () => {
  for (const forbidden of [
    'SearchBar',
    'filterBySearch',
    'buildSearchEntry',
    'Chip',
    'applyFeedFilters',
    'FeedFilterState',
    'buildFeedSections',
    'buildAffectsMeSections',
    'orderByLocationTiers',
    '.sort(',
    'Modal',
    'SectionList',
    'folder',
    'category',
    'selectedIds',
  ]) {
    assert.ok(!codeOnly(SAVED).includes(forbidden), `Saved introduced ${forbidden}`);
  }
  // Order is the store's — save order, newest first — resolved by the one
  // pure selector and never re-ranked on the screen.
  assert.match(SAVED, /selectSavedItems\(ids, state\.items\)/);
  // And no personalization verdict: every saved card renders affectsYou false.
  assert.ok(!codeOnly(SAVED).includes('evaluatePersonalRelevance'));
  assert.ok(!codeOnly(SAVED).includes('loadPreferences'));
});

test('Saved remains one of the three destinations, under the navigator’s own title', () => {
  const screens = [...TAB_LAYOUT.matchAll(/<Tabs\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(screens, ['index', 'saved', 'profile']);
  assert.ok(TAB_LAYOUT.includes("title: 'Saved'"));
  // The header is the navigator's, styled from the same tokens as the Feed's
  // — and the screen adds no second heading of its own.
  assert.ok(TAB_LAYOUT.includes('...screenHeader'));
  assert.ok(!SAVED.includes('Stack.Screen'));
  assert.ok(!codeOnly(SAVED).includes('accessibilityRole="header"'));
  assert.ok(!codeOnly(SAVED).includes('variant="heading'));
});

// ── 3. Every state, in the shared presentation, with exact copy ─────────────

test('every whole-screen state is the shared StateMessage with the contract’s words', () => {
  assert.match(SAVED, /import \{ StateMessage \} from '@\/components\/state-message'/);
  for (const state of ['SAVED_UNAVAILABLE', 'SAVED_LOADING']) {
    assert.ok(SAVED.includes(`<StateMessage {...${state}}`), `${state} is not rendered`);
  }
  // The not-configured state is the one with two wordings (P3C1): the
  // shopper's, and the developer's behind `__DEV__`. Both go through the
  // same shared StateMessage.
  assert.ok(
    SAVED.includes('{...(__DEV__ ? SAVED_NOT_CONFIGURED_DEV : SAVED_NOT_CONFIGURED)}'),
    'SAVED_NOT_CONFIGURED is not rendered',
  );
  assert.ok(SAVED.includes('<StateMessage {...SAVED_EMPTY} icon="bookmark" />'));
  assert.ok(
    SAVED.includes('<StateMessage title={SAVED_ERROR_TITLE} body={state.message} tone="error" />'),
  );
  // Loading announces itself; the failure is an alert. Neither is invented here.
  assert.ok(SAVED.includes('{...SAVED_LOADING} tone="loading"'));
  assert.ok(STATE_MESSAGE.includes("if (tone === 'loading') AccessibilityInfo"));
  assert.ok(STATE_MESSAGE.includes("accessibilityRole={tone === 'error' ? 'alert' : undefined}"));
  // Saved spells no state sentence of its own: every string it shows comes
  // from the copy contract.
  assert.equal(SAVED_EMPTY.title, 'No saved recalls');
  assert.equal(SAVED_EMPTY.body, 'Save a recall to find it here later.');
  assert.equal(SAVED_LOADING.title, 'Loading saved recalls…');
  assert.equal(SAVED_ERROR_TITLE, 'Could not load recalls');
  assert.ok(SAVED_UNAVAILABLE.title.length > 0 && SAVED_NOT_CONFIGURED.title.length > 0);
});

test('the loading state cannot flash the empty one, and neither can the error state', () => {
  // Both answers — storage and the corpus — gate everything that follows.
  const loadGate = SAVED.indexOf("if (!loaded || state.status === 'loading')");
  const emptyGate = SAVED.indexOf('if (ids.length === 0)');
  const errorGate = SAVED.indexOf("if (state.status === 'error')");
  assert.ok(loadGate >= 0, 'the loading gate is missing');
  assert.ok(emptyGate > loadGate, 'the empty state must be decided after loading');
  assert.ok(errorGate > emptyGate, 'the error state must be decided after the empty one');
  // The hook answers "not loaded" until storage resolves, so `loaded` is a
  // real answer rather than an assumption the screen makes.
  assert.match(HOOK, /loaded: snapshot !== null \|\| !savedRecallsAvailable\(\)/);
  assert.match(HOOK, /let snapshot: readonly string\[\] \| null = null;/);
});

test('a failed feed read says so without claiming anything about the saved list', () => {
  // The error body is the session's own message; the title says the RECALLS
  // could not load, never that saves were deleted, lost, cleared or expired.
  for (const forbidden of ['deleted', 'lost', 'removed', 'cleared', 'expired', 'gone forever']) {
    assert.ok(
      !SAVED_ERROR_TITLE.toLowerCase().includes(forbidden),
      `the failure copy says ${forbidden}`,
    );
  }
  // And the screen never writes the store — on failure or at any other time.
  for (const forbidden of [
    'toggle(',
    'saved-recalls-store',
    'deleteLocalSavedRecalls',
    'forgetSavedRecallsCache',
    'writeSavedRecalls',
  ]) {
    assert.ok(!codeOnly(SAVED).includes(forbidden), `Saved writes the store: ${forbidden}`);
  }
  // It reads the shared hook for ids only; the toggle it never destructures.
  assert.match(SAVED, /const \{ ids, loaded, available \} = useSavedRecalls\(\);/);
});

test('a saved recall missing from the active feed is reported, never deleted or invented', () => {
  assert.match(SAVED, /savedMissingNotice\(missingSavedCount\(ids, state\.items\)\)/);
  assert.ok(SAVED.includes('<Callout tone="information">{missing}</Callout>'));
  // The sentence blames the feed, not the device.
  assert.equal(savedMissingNotice(1), '1 saved recall is no longer in the active feed.');
  // Nothing prunes the stored list against the corpus, and no placeholder
  // card is invented for a recall the corpus cannot describe.
  for (const forbidden of ['sanitizeSavedIds', 'unavailable', 'placeholder', 'Unavailable']) {
    assert.ok(!codeOnly(SAVED).includes(forbidden), `Saved reconciles the store: ${forbidden}`);
  }
});

// ── 4. Unsaving still runs through the one shared store ─────────────────────

test('unsaving happens through the shared card, the shared control and the one store', () => {
  // Saved owns no save control: the card's is the only one on this screen,
  // and it toggles the single shared subscription every surface reads.
  assert.match(CARD, /import \{ SaveRecallButton \} from '@\/components\/save-recall-button'/);
  assert.match(SAVE_BUTTON, /onPress=\{\(\) => void toggle\(caseId\)\}/);
  assert.match(SAVE_BUTTON, /from '@\/hooks\/use-saved-recalls'/);
  assert.match(CARD, /from '@\/hooks\/use-saved-recalls'/);
  assert.match(SAVED, /from '@\/hooks\/use-saved-recalls'/);
  // One module-level snapshot, published to every listener — which is what
  // makes an unsave on Saved show up on the Feed and on Detail at once.
  assert.match(HOOK, /const listeners = new Set<\(\) => void>\(\);/);
  assert.match(HOOK, /useSyncExternalStore\(subscribe, getSnapshot, getSnapshot\)/);
  assert.match(HOOK, /publish\(await toggleSavedRecall\(id\)\);/);
  // No undo, no confirmation, no animation was invented around the removal.
  for (const forbidden of ['Undo', 'Animated', 'LayoutAnimation', 'Alert.alert', 'Haptics']) {
    assert.ok(!codeOnly(SAVED).includes(forbidden), `Saved added ${forbidden}`);
  }
});

test('card navigation from Saved is the ordinary Recall Detail push, unchanged', () => {
  assert.match(CARD, /pathname: '\/recall\/\[id\]', params: \{ id: model\.id \}/);
  assert.equal((CARD.match(/<Link /g) ?? []).length, 1);
  // Saved navigates nothing itself — no router, no link, no second route.
  for (const forbidden of ['expo-router', 'router.', '<Link', 'href=']) {
    assert.ok(!codeOnly(SAVED).includes(forbidden), `Saved navigates on its own: ${forbidden}`);
  }
});

// ── 5. Tokens and the shared type scale ─────────────────────────────────────

test('Saved spells no colour, size, family, radius or spacing of its own', () => {
  const code = codeOnly(SAVED);
  for (const forbidden of [
    'fontSize:',
    'fontWeight:',
    'fontFamily:',
    'lineHeight:',
    'borderRadius:',
    'backgroundColor:',
    '#',
    'ThemedText',
    'ThemedView',
    "from '@/constants/theme'",
    'Spacing.',
    'Radii.',
    'Colors.',
    'useTheme',
    'variant="label',
  ]) {
    assert.ok(!code.includes(forbidden), `Saved contains ${forbidden}`);
  }
  // The page, the notices and the card all come from shared primitives.
  assert.match(SAVED, /<Surface background="background\/page" style=\{styles\.page\}>/);
  assert.match(SAVED, /import \{ Callout \} from '@\/components\/ui\/callout'/);
  assert.ok(CALLOUT.includes("background: 'background/subtle'"));
  // The stale sentence is the Feed's own, not a second copy of it.
  assert.match(SAVED, /import \{ FEED_STALE_NOTICE \} from '@\/lib\/feed-copy'/);
  assert.ok(!SAVED.includes(FEED_STALE_NOTICE.slice(0, 24)), 'the notice is duplicated inline');
});

test('the list keeps the Feed’s rhythm, margins and content width', () => {
  for (const [property, value] of [
    ['maxWidth', 'layout.maxContentWidth'],
    ['paddingHorizontal', 'layout.pageMargin'],
    ['paddingTop', 'spacing[8]'],
    ['paddingBottom', 'spacing[24]'],
    ['gap', 'spacing[16]'],
  ]) {
    const rule = `${property}: ${value},`;
    assert.ok(SAVED.includes(rule), `the list content is missing ${rule}`);
    assert.ok(FEED.includes(rule), `the Feed no longer uses ${rule}`);
  }
  assert.equal(layout.pageMargin, 16);
  assert.equal(spacing[16], 16);
  // Content-driven heights and no page-level sideways scroll.
  const code = codeOnly(SAVED);
  assert.ok(!code.includes('height:') || /flex: 1/.test(code));
  assert.ok(!code.includes('horizontal'), 'nothing on Saved scrolls sideways');
  assert.ok(!code.includes('numberOfLines'));
  assert.ok(!code.includes('maxFontSizeMultiplier'));
});

// ── 6. Accessibility contract ───────────────────────────────────────────────

test('the card’s save action, its spoken names and the 44pt minimum are intact', () => {
  assert.ok(CARD.includes('accessibilityActions={'));
  assert.ok(CARD.includes('label: saved ? SAVED_ACCESSIBILITY_LABEL : SAVE_ACCESSIBILITY_LABEL'));
  assert.ok(
    CARD.includes(
      'if (event.nativeEvent.actionName === SAVE_ACTION) void savedRecalls.toggle(model.id);',
    ),
  );
  assert.match(SAVE_BUTTON, /accessibilityState=\{\{ selected: saved \}\}/);
  assert.match(SAVE_BUTTON, /hitSlop=\{HIT_SLOP\}/);
  assert.match(SAVE_BUTTON, /hitSlopToMinimum\(iconSize\[20\]\)/);
  assert.equal(hitTarget.minimum, 44);
  assert.ok(TAB_LAYOUT.includes('minHeight: hitTarget.minimum'));
  // The empty state's glyph is decorative: the words carry the state, and the
  // icon is hidden from assistive technology by the icon primitive itself.
  assert.ok(STATE_MESSAGE.includes('icon ? <Icon name={icon}'));
  assert.ok(read('components', 'ui', 'icon.tsx').includes('accessible={false}'));
});

// ── 7. The development gallery cannot touch the real saved list ─────────────

test('the Saved gallery is development-only and mutates no persistence', () => {
  assert.ok(PREVIEW.includes('SAVED STATES AND LIST'));
  assert.ok(PREVIEW.includes('<SavedGallery items={'));
  assert.ok(PREVIEW.includes('if (!isDevelopmentBuild())'));
  // It renders the product's own components over real feed items and states.
  assert.ok(PREVIEW.includes('<StateMessage {...SAVED_EMPTY} icon="bookmark" />'));
  assert.ok(PREVIEW.includes('<StateMessage {...SAVED_LOADING} />'));
  assert.ok(PREVIEW.includes('title={SAVED_ERROR_TITLE}'));
  // And it neither reads nor writes the device's saved list: no store, no
  // hook, no toggle, no reset.
  for (const forbidden of [
    'saved-recalls-store',
    'use-saved-recalls',
    'useSavedRecalls',
    'toggleSavedRecall',
    'deleteLocalSavedRecalls',
    'forgetSavedRecallsCache',
    'loadSavedRecalls',
  ]) {
    assert.ok(!codeOnly(PREVIEW).includes(forbidden), `the gallery touches ${forbidden}`);
  }
  // The simulated missing-notice count is labelled as simulated on screen,
  // inside the gallery's own caption.
  const gallery = PREVIEW.slice(
    PREVIEW.indexOf('function SavedGallery('),
    PREVIEW.indexOf('function FeedControlsGallery('),
  );
  assert.ok(gallery.includes('savedMissingNotice(2)'));
  assert.ok(/simulated[\s\n]+count of two/.test(gallery), 'the simulated count is not labelled');
  // Saved itself carries no development entry point.
  for (const forbidden of ['design-preview', 'DesignPreview', 'isDevelopmentBuild']) {
    assert.ok(!codeOnly(SAVED).includes(forbidden), `Saved references ${forbidden}`);
  }
  // Saved's single build-type branch is a copy switch, not an entry point:
  // it picks the developer wording of the not-configured state, which a
  // release build never selects (P3C1; lib/release-exposure.test.ts).
  assert.deepEqual(codeOnly(SAVED).match(/__DEV__/g), ['__DEV__'], 'Saved uses __DEV__ twice');
  assert.ok(
    codeOnly(SAVED).includes('{...(__DEV__ ? SAVED_NOT_CONFIGURED_DEV : SAVED_NOT_CONFIGURED)}'),
    'Saved’s only __DEV__ branch is not the not-configured wording',
  );
});
