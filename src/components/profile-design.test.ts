/**
 * Profile's visual implementation (P2B5), pinned at the source level — the
 * technique every design suite here uses, because React Native cannot
 * render under Node.
 *
 * What the milestone promises: every existing destination is still reached,
 * exactly once, and no route or document disappeared; nothing was invented
 * (no account, avatar, paywall, subscription, support or legal surface, and
 * the unfinished Privacy Policy and Terms stay hidden); the reset stays
 * inside Privacy & Data Controls alone; Profile READS preferences on focus
 * through the one store and never writes them; loading and failure are
 * never rendered as empty preferences; the compact summary keeps a complete
 * spoken description; every navigation row is the shared primitive with the
 * canonical chevron at the minimum target; the development entry and the
 * harness stay development-only; the screen is drawn from the tokens and
 * the selected shared components under the navigator's shared header; the
 * product name is Lotly where it names the product and "recall" where it
 * names a recall; the three competing Phase 1 prototypes are gone; and no
 * parallel design system exists.
 *
 * The summary rules themselves are driven against the real module in
 * lib/profile-hub.test.ts.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { hitTarget, layout, spacing } from '@/constants/design-tokens';
import { documentBySlug, PROFILE_DOCUMENT_GROUPS, TRUST_DOCUMENTS } from '@/content';
import { RESET_ACTION_LABEL } from '@/lib/installation-reset';
import {
  compactList,
  NOTIFICATIONS_SUMMARY,
  summaryAccessibilityLabel,
  summaryLines,
  summarizePreferences,
} from '@/lib/profile-hub';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

const PROFILE = read('app', '(tabs)', 'profile.tsx');
const TAB_LAYOUT = read('app', '(tabs)', '_layout.tsx');
const ROOT_LAYOUT = read('app', '_layout.tsx');
const HUB = read('app', 'design-preview', 'index.tsx');
const ICON = read('components', 'ui', 'icon.tsx');
const MODEL = read('lib', 'profile-hub.ts');
const COMPONENTS = {
  'profile-section': read('components', 'profile', 'profile-section.tsx'),
  'navigation-row': read('components', 'profile', 'navigation-row.tsx'),
  'value-row': read('components', 'profile', 'value-row.tsx'),
  'development-entry': read('components', 'profile', 'development-entry.tsx'),
  'personalization-card': read('components', 'profile', 'personalization-card.tsx'),
};
const NAV_ROW = COMPONENTS['navigation-row'];
const VALUE_ROW = COMPONENTS['value-row'];
const SECTION = COMPONENTS['profile-section'];
const DEV_ENTRY = COMPONENTS['development-entry'];
const CARD = COMPONENTS['personalization-card'];

/** Source with comments removed, so a file may document what it does not do. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** Every file under src, for whole-tree absence checks. */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const count = (source: string, needle: string): number => source.split(needle).length - 1;

/** The hub's Profile gallery alone. */
const GALLERY = HUB.slice(
  HUB.indexOf('function ProfileGallery('),
  HUB.indexOf('function FeedControlsGallery('),
);

// ── 1–2. Every destination, exactly once; nothing disappeared ───────────────

test('every existing Profile destination is reached exactly once, in the final hierarchy', () => {
  // The two settings screens and the harness, each declared once on the hub.
  assert.equal(count(PROFILE, 'href="/settings/personalization"'), 1);
  assert.equal(count(PROFILE, 'href="/settings/notifications"'), 1);
  assert.equal(count(PROFILE, 'href="/design-preview"'), 1);
  // The documents render from the registry, once per slug — the P2A
  // "promote and skip" is gone, so no document can appear twice or not at all.
  assert.equal(count(PROFILE, 'PROFILE_DOCUMENT_GROUPS.map('), 1);
  assert.equal(count(PROFILE, "pathname: '/document/[slug]'"), 1);
  assert.ok(!PROFILE.includes('slug !== PROFILE_PRIMARY_DOCUMENT_SLUG'));
  const grouped = PROFILE_DOCUMENT_GROUPS.flatMap((group) => [...group.slugs]);
  assert.deepEqual([...grouped].sort(), TRUST_DOCUMENTS.map((doc) => doc.slug).sort());
  assert.equal(new Set(grouped).size, grouped.length);
  // The hierarchy: the card, Notifications, then the registry's groups in its
  // order — Privacy & Data, About & Safety, Legal — then App, then Development.
  assert.deepEqual(
    PROFILE_DOCUMENT_GROUPS.map((group) => group.title),
    ['Privacy & Data', 'About & Safety', 'Legal'],
  );
  const order = [
    '<PersonalizationCard',
    'label="Notifications"',
    'PROFILE_DOCUMENT_GROUPS.map(',
    '<ProfileSection title="App">',
    '{__DEV__ ? (',
  ].map((marker) => PROFILE.indexOf(marker));
  assert.ok(order.every((at) => at >= 0));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  // Privacy & Data is one row with the founder's exact supporting copy; the
  // About & Safety rows read by title alone.
  assert.deepEqual(PROFILE_DOCUMENT_GROUPS[0].slugs, ['privacy-data-controls']);
  assert.equal(
    documentBySlug('privacy-data-controls')?.summary,
    'What Lotly stores, what it sends, and how to delete your data.',
  );
  assert.ok(
    PROFILE.includes(
      'summary={doc.slug === PROFILE_PRIMARY_DOCUMENT_SLUG ? doc.summary : undefined}',
    ),
  );
  assert.deepEqual(PROFILE_DOCUMENT_GROUPS[1].slugs, [
    'sources-methodology',
    'how-affects-me-works',
    'risk-levels',
    'safety-disclaimer',
    'corrections-policy',
  ]);
  assert.deepEqual(PROFILE_DOCUMENT_GROUPS[2].slugs, ['attributions']);
});

test('no route or document disappeared: the registry and every route file are intact', () => {
  assert.deepEqual(
    TRUST_DOCUMENTS.map((doc) => doc.slug),
    [
      'sources-methodology',
      'how-affects-me-works',
      'risk-levels',
      'safety-disclaimer',
      'corrections-policy',
      'privacy-data-controls',
      'attributions',
    ],
  );
  for (const file of [
    ['app', '(tabs)', 'profile.tsx'],
    ['app', 'settings', 'personalization.tsx'],
    ['app', 'settings', 'notifications.tsx'],
    ['app', 'settings', 'index.tsx'],
    ['app', 'document', '[slug].tsx'],
    ['app', 'design-preview', 'index.tsx'],
  ]) {
    assert.ok(existsSync(join(SRC, ...file)), `${file.join('/')} is missing`);
  }
  for (const name of ['settings/personalization', 'settings/notifications', 'document/[slug]']) {
    assert.ok(ROOT_LAYOUT.includes(`name="${name}"`), `${name} left the root stack`);
  }
  // The App group is the version line and nothing else — not "Help", and no
  // support destination.
  assert.ok(PROFILE.includes('<ProfileSection title="App">'));
  assert.ok(!/title="Help"|>Help</.test(PROFILE));
  assert.ok(
    PROFILE.includes('<ValueRow label={APP_VERSION_LABEL} value={versionLine(version, build)} />'),
  );
});

// ── 3–4. Nothing invented; unfinished legal documents hidden ───────────────

test('no account, avatar, paywall, subscription, support or legal surface exists on Profile', () => {
  const sources = {
    profile: codeOnly(PROFILE),
    model: codeOnly(MODEL),
    gallery: codeOnly(GALLERY),
    ...Object.fromEntries(Object.entries(COMPONENTS).map(([k, v]) => [k, codeOnly(v)])),
  };
  for (const [name, source] of Object.entries(sources)) {
    const lower = source.toLowerCase();
    for (const forbidden of [
      'avatar',
      'username',
      'displayname',
      'email',
      'household',
      'sign in',
      'signin',
      'sign up',
      'log in',
      'account',
      'subscription',
      'subscribe',
      'premium',
      'paywall',
      'purchase',
      'achievement',
      'streak',
      'badge',
      'statistic',
      'sync',
      '/support',
      '/help',
      '/onboarding',
      '/account',
      'toggle',
      'switch',
    ]) {
      assert.ok(!lower.includes(forbidden), `${name} references ${forbidden}`);
    }
  }
  // The card shows the three preference dimensions and nothing more.
  assert.deepEqual(
    summaryLines({
      status: 'ready',
      summary: summarizePreferences({ states: [], allergens: [], retailers: [] }),
    }).map((line) => line.key),
    ['states', 'allergens', 'retailers'],
  );
});

test('the unfinished Privacy Policy and Terms stay hidden', () => {
  for (const [name, source] of Object.entries({ profile: PROFILE, hub: HUB, ...COMPONENTS })) {
    assert.ok(!source.includes('privacy-policy'), `${name} links a Privacy Policy`);
    assert.ok(!/terms of (service|use)|\bEULA\b/i.test(codeOnly(source)), `${name} mentions Terms`);
  }
  assert.equal(documentBySlug('privacy-policy'), undefined);
  assert.equal(documentBySlug('terms'), undefined);
  assert.ok(!TRUST_DOCUMENTS.some((doc) => /^(privacy policy|terms)/i.test(doc.title)));
});

// ── 5. The reset stays inside Privacy & Data Controls ───────────────────────

test('reset and deletion live inside Privacy & Data Controls only — the hub carries no destructive action', () => {
  for (const [name, source] of Object.entries({ profile: PROFILE, model: MODEL, ...COMPONENTS })) {
    assert.ok(!source.includes('InstallationResetSection'), `${name} mounts the reset`);
    assert.ok(!source.includes(RESET_ACTION_LABEL), `${name} duplicates the reset label`);
    assert.ok(!source.includes('runInstallationReset'), `${name} can run the reset`);
    assert.ok(!source.includes('deleteLocalPreferenceState'), `${name} deletes preferences`);
    assert.ok(!source.includes('Alert.alert'), `${name} raises a confirmation`);
  }
  assert.match(
    read('app', 'document', '[slug].tsx'),
    /doc\.slug === 'privacy-data-controls' \? <InstallationResetSection \/> : null/,
  );
  // Nothing on the hub is distinguished by the risk palette or a red of its own.
  for (const source of [PROFILE, ...Object.values(COMPONENTS)]) {
    assert.ok(!source.includes('riskPalette') && !source.includes("'risk/"));
  }
});

// ── 6–8. Reads on focus, never writes; loading and failure are honest ───────

test('Profile reads preferences through the one store and never writes them', () => {
  assert.ok(
    PROFILE.includes(
      "import { loadPreferences, preferencesAvailable } from '@/lib/preferences-store';",
    ),
  );
  for (const forbidden of [
    'savePreferences',
    'flushPreferencesSync',
    'deleteLocalPreferenceState',
    'setInstallationPreferences',
    'SecureStore',
    'AsyncStorage',
    'installation-id',
    'push-api',
  ]) {
    assert.ok(!PROFILE.includes(forbidden), `Profile references ${forbidden}`);
  }
  // The components and the model are handed an answer; none reads a store.
  for (const [name, source] of Object.entries({ model: MODEL, ...COMPONENTS })) {
    for (const forbidden of ['preferences-store', 'loadPreferences', 'savePreferences']) {
      assert.ok(!codeOnly(source).includes(forbidden), `${name} touches the store: ${forbidden}`);
    }
  }
  // One local answer, no second store: no module-level state, no context,
  // no external store of Profile's own.
  for (const forbidden of ['createContext', 'useSyncExternalStore', 'let snapshot', 'listeners']) {
    assert.ok(!codeOnly(PROFILE).includes(forbidden), `Profile grew a store: ${forbidden}`);
  }
});

test('the summary refreshes whenever Profile regains focus, and a stale read is discarded', () => {
  assert.match(PROFILE, /useFocusEffect\(\s*useCallback\(\(\) => \{/);
  assert.ok(PROFILE.includes('loadPreferences().then('));
  // The read is cancelled on blur, so a slow earlier read cannot overwrite a
  // newer answer after the user returns from Personalization.
  assert.ok(PROFILE.includes('let current = true;'));
  assert.ok(PROFILE.includes('current = false;'));
  assert.ok(PROFILE.includes('if (current) setSummary('));
  // The same pattern the card screens and the Personalization screen use.
  // Since P2B7N.1 the Feed reads preferences through the SHARED hook rather
  // than its own focus effect — the refocus rule lives there, once, for the
  // Feed, Saved and Detail alike.
  assert.match(read('hooks', 'use-preferences.ts'), /useFocusEffect\(/);
  assert.ok(read('app', '(tabs)', 'index.tsx').includes('usePreferences('));
  assert.match(read('app', 'settings', 'personalization.tsx'), /void savePreferences\(next\)/);
});

test('loading and failure are never rendered as empty preferences', () => {
  // The initial answer is loading — not EMPTY_PREFERENCES, not an empty summary.
  assert.ok(PROFILE.includes("useState<PreferenceSummaryState>({ status: 'loading' })"));
  assert.ok(!PROFILE.includes('EMPTY_PREFERENCES'));
  // A rejected read and a platform without preferences both become unavailable.
  assert.equal(count(PROFILE, "setSummary({ status: 'unavailable' })"), 2);
  assert.ok(PROFILE.includes('if (!preferencesAvailable()) {'));
  // And the card words each answer differently; the rules test drives the values.
  assert.deepEqual(
    summaryLines({ status: 'loading' }).map((line) => line.visible),
    ['Loading…', 'Loading…', 'Loading…'],
  );
  assert.deepEqual(
    summaryLines({ status: 'unavailable' }).map((line) => line.visible),
    ['Unavailable', 'Unavailable', 'Unavailable'],
  );
  assert.ok(CARD.includes("accessibilityState={{ busy: state.status === 'loading' }}"));
});

// ── 9–10. The compact summary, complete when spoken ────────────────────────

test('the compact rule covers zero, one, two and more-than-two selections', () => {
  assert.equal(compactList([]).visible, 'None selected');
  assert.equal(compactList(['Costco']).visible, 'Costco');
  assert.equal(compactList(['Costco', 'Target']).visible, 'Costco, Target');
  assert.equal(compactList(['Costco', 'Target', 'Walmart']).visible, 'Costco, Target +1');
  assert.equal(compactList(['A', 'B', 'C', 'D', 'E']).visible, 'A, B +3');
});

test('a visibly abbreviated summary keeps its complete accessible label', () => {
  const state = {
    status: 'ready' as const,
    summary: summarizePreferences({
      states: ['CA'],
      allergens: ['peanut', 'tree nuts', 'milk', 'egg'],
      retailers: ['costco', 'trader-joes', 'walmart'],
    }),
  };
  const [, allergens, stores] = summaryLines(state);
  assert.equal(allergens.visible, 'Peanuts, Tree nuts +2');
  assert.equal(stores.visible, "Costco, Trader Joe's +1");
  const spoken = summaryAccessibilityLabel('Personalization', state);
  for (const name of ['Peanuts', 'Tree nuts', 'Milk', 'Egg', 'Costco', "Trader Joe's", 'Walmart']) {
    assert.ok(spoken.includes(name), `the spoken label omits ${name}`);
  }
  // The card speaks that label as ONE link — the whole card is the target —
  // and renders no nested pressable.
  assert.ok(CARD.includes('accessibilityLabel={summaryAccessibilityLabel(label, state)}'));
  assert.equal(count(CARD, '<Pressable'), 1);
  assert.equal(count(CARD, '<Link '), 1);
  assert.ok(!CARD.includes('onPress='));
  assert.ok(CARD.includes('accessibilityRole="link"'));
  assert.ok(CARD.includes('accessibilityHint={PERSONALIZATION_HINT}'));
  // The visible affordance is a word on the card, not a control.
  assert.ok(CARD.includes('{EDIT_LABEL}'));
  assert.ok(CARD.includes('<Icon name="flag" size={20} color="icon/primary" />'));
});

// ── 11–12. Shared rows, the canonical chevron, the minimum target ───────────

test('every navigation row is the shared primitive carrying the canonical chevron', () => {
  assert.ok(NAV_ROW.includes('<Icon name="chevron-right" size={20} color="icon/secondary" />'));
  assert.ok(NAV_ROW.includes('accessibilityRole="link"'));
  assert.ok(NAV_ROW.includes('accessibilityLabel={label}'));
  assert.ok(NAV_ROW.includes('accessibilityHint={hint}'));
  assert.ok(NAV_ROW.includes('hint: string;'), 'the hint is mandatory');
  // The glyph is in the shared set, from the same asset pattern, at 1x/2x/3x,
  // and the primitive hides every glyph from assistive technology.
  assert.ok(ICON.includes("'chevron-right': require('@/assets/icons/chevron-right.png')"));
  for (const file of ['chevron-right.png', 'chevron-right@2x.png', 'chevron-right@3x.png']) {
    assert.ok(existsSync(join(ROOT, 'assets', 'icons', file)), `${file} is missing`);
  }
  assert.ok(ICON.includes('accessible={false}'));
  assert.ok(!ICON.includes('lucide-react'), 'no icon library was installed');
  // Profile composes no row of its own: no Link, no Pressable, no chevron.
  for (const forbidden of ['<Link', '<Pressable', 'chevron', 'onPress']) {
    assert.ok(!codeOnly(PROFILE).includes(forbidden), `Profile hand-rolls a row: ${forbidden}`);
  }
  assert.ok(PROFILE.includes('<NavigationRow'));
  assert.ok(DEV_ENTRY.includes('<NavigationRow'));
  // Sections part their rows with hairlines on one bordered surface.
  assert.ok(SECTION.includes('<Surface radius={16} border="border/subtle"'));
  assert.ok(SECTION.includes('borderTopWidth: StyleSheet.hairlineWidth'));
  assert.ok(SECTION.includes('accessibilityRole="header"'));
  // P2B7H: the group label keeps the caption treatment that distinguishes it
  // from a content heading, but renders the words as written — no style and
  // no call may shout them back.
  assert.ok(SECTION.includes('{title}'));
  assert.ok(!SECTION.includes('toUpperCase'), 'the group label is uppercased again');
  assert.ok(!SECTION.includes('textTransform'), 'the group label is transformed again');
});

test('interactive rows meet the 44pt minimum and nothing on the hub has a fixed height', () => {
  assert.equal(hitTarget.minimum, 44);
  assert.ok(NAV_ROW.includes('minHeight: hitTarget.minimum,'));
  assert.ok(VALUE_ROW.includes('minHeight: hitTarget.minimum,'));
  for (const [name, source] of Object.entries({ profile: PROFILE, ...COMPONENTS })) {
    const code = codeOnly(source);
    assert.ok(!/\bheight:/.test(code), `${name} fixes a height`);
    assert.ok(!code.includes('maxHeight'), `${name} caps a height`);
    assert.ok(!code.includes('numberOfLines'), `${name} truncates`);
    assert.ok(!code.includes('maxFontSizeMultiplier'), `${name} caps Dynamic Type`);
  }
  // Long values wrap beneath their label rather than fighting a column.
  assert.ok(CARD.includes("flexWrap: 'wrap'"));
  assert.ok(VALUE_ROW.includes("flexWrap: 'wrap'"));
});

// ── 13. Development-only ────────────────────────────────────────────────────

test('the development entry and the harness remain development-only', () => {
  // The bare identifier on the live Profile, with the entry inside the branch.
  const guard = PROFILE.indexOf('{__DEV__ ? (');
  assert.ok(guard >= 0);
  const code = codeOnly(PROFILE);
  const codeGuard = code.indexOf('{__DEV__ ? (');
  for (const marker of ['<DevelopmentEntry', 'Design Preview', '/design-preview']) {
    assert.ok(code.indexOf(marker) >= codeGuard, `${marker} escapes the __DEV__ branch`);
  }
  // The component's own lock, and no runtime flag anywhere on the hub.
  assert.ok(DEV_ENTRY.includes('if (!__DEV__) return null;'));
  assert.ok(!PROFILE.includes('isDevelopmentBuild'));
  assert.ok(!DEV_ENTRY.includes('isDevelopmentBuild'));
  // It is named for what it is, visibly and spoken, and drawn apart from the
  // consumer groups: outlined on the page colour with the strong border.
  // P2B7H: rendered as written, like every other Profile group label.
  assert.ok(DEV_ENTRY.includes('{DEVELOPMENT_HEADING}'));
  assert.ok(!DEV_ENTRY.includes('toUpperCase'));
  assert.ok(MODEL.includes("DEVELOPMENT_HEADING = 'Development builds only'"));
  assert.ok(
    MODEL.includes("DEVELOPMENT_HINT = 'Development builds only. Not part of the product.'"),
  );
  assert.ok(DEV_ENTRY.includes('hint={DEVELOPMENT_HINT}'));
  assert.ok(
    DEV_ENTRY.includes('<Surface background="background/page" radius={8} border="border/strong">'),
  );
  // The harness hub keeps its guard, and no consumer screen but Profile
  // mounts the entry.
  assert.ok(HUB.includes('if (!isDevelopmentBuild())'));
  for (const file of [
    ['app', '(tabs)', 'index.tsx'],
    ['app', '(tabs)', 'saved.tsx'],
    ['app', '(tabs)', '_layout.tsx'],
    ['app', '_layout.tsx'],
    ['app', 'settings', 'personalization.tsx'],
    ['app', 'settings', 'notifications.tsx'],
    ['app', 'document', '[slug].tsx'],
  ]) {
    assert.ok(!read(...file).includes('development-entry'), `${file.join('/')} mounts the entry`);
  }
});

// ── 14–15. Tokens, the shared components, the shared header ────────────────

test('the live Profile is drawn from the tokens and the selected shared components', () => {
  for (const component of Object.keys(COMPONENTS)) {
    assert.ok(
      PROFILE.includes(`from '@/components/profile/${component}'`),
      `Profile does not use ${component}`,
    );
  }
  for (const [name, source] of Object.entries({ profile: PROFILE, ...COMPONENTS })) {
    const code = codeOnly(source);
    for (const forbidden of [
      'fontSize:',
      'fontWeight:',
      'fontFamily:',
      'lineHeight:',
      'letterSpacing:',
      'borderRadius:',
      'backgroundColor:',
      'ThemedText',
      'ThemedView',
      "from '@/constants/theme'",
      'Spacing.',
      'Radii.',
      'Colors.',
      'MaxContentWidth',
      'useTheme',
      'useColorScheme',
      'variant="label',
      'Animated',
      'LayoutAnimation',
      'Haptics',
    ]) {
      assert.ok(!code.includes(forbidden), `${name} contains ${forbidden}`);
    }
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), `${name} contains a hex literal`);
    assert.ok(
      !/\b(padding|margin|gap|rowGap|columnGap|width|height|minHeight)[A-Za-z]*:\s*-?[1-9]/.test(
        code,
      ),
      `${name} contains an off-scale number`,
    );
    assert.ok(code.includes("from '@/constants/design-tokens'"), `${name} imports the tokens`);
  }
  for (const source of Object.values(COMPONENTS)) {
    assert.ok(source.includes("from '@/components/ui/text'"));
  }
  // The page: the warm surface, the margins, the content cap, the safe area.
  assert.ok(PROFILE.includes('<Surface background="background/page" style={styles.page}>'));
  assert.ok(PROFILE.includes('paddingHorizontal: layout.pageMargin,'));
  assert.ok(PROFILE.includes('maxWidth: layout.maxContentWidth,'));
  assert.ok(PROFILE.includes('paddingBottom: spacing[24] + insets.bottom'));
  assert.equal(layout.pageMargin, 16);
  assert.equal(spacing[24], 24);
  // The featured card is the white radius/16 card with the one canonical lift.
  assert.ok(CARD.includes('<Surface radius={16} border="border/subtle" elevation="card"'));
  // Public Sans only: nothing on the hub is set in the mono label face.
  assert.ok(!PROFILE.includes('label-strong'));
  // The light appearance is not consulted, let alone inverted.
  assert.ok(!PROFILE.includes('dark'));
});

test('the Profile navigator header matches the Feed and Saved treatment, with no second heading', () => {
  const screens = [...TAB_LAYOUT.matchAll(/<Tabs\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(screens, ['index', 'saved', 'profile']);
  assert.equal(count(TAB_LAYOUT, '...screenHeader'), 3, 'one shared header on all three tabs');
  const profileTab = TAB_LAYOUT.slice(TAB_LAYOUT.indexOf('name="profile"'));
  assert.ok(profileTab.includes('...screenHeader'));
  assert.ok(TAB_LAYOUT.includes("title: 'Profile'"));
  assert.ok(TAB_LAYOUT.includes("backgroundColor: color['background/page']"));
  assert.ok(TAB_LAYOUT.includes('headerShadowVisible: false'));
  // Profile shares the one `screenHeader`, so it gets the Dynamic Type
  // minimum Feed and Saved get — the three cannot drift apart.
  assert.ok(TAB_LAYOUT.includes('minHeight: headerMinHeight'));
  // The screen adds no heading of its own and sets no header options.
  assert.ok(!PROFILE.includes('Stack.Screen'));
  assert.ok(!codeOnly(PROFILE).includes('variant="heading'));
  assert.ok(!codeOnly(PROFILE).includes('accessibilityRole="header"'));
});

// ── 16. Lotly names the product; "recall" names a recall ───────────────────

test('product-name uses became Lotly without changing generic uses of "recall"', () => {
  // The registry summaries Profile shows: no "Recall" as the product.
  for (const doc of TRUST_DOCUMENTS) {
    assert.doesNotMatch(
      doc.summary,
      /\bRecall(’s|'s| is\b| does\b| checks\b)|\bWhat Recall\b|software Recall\b/,
      `${doc.slug} still names the product "Recall"`,
    );
  }
  assert.equal(
    documentBySlug('risk-levels')?.summary,
    'Lotly’s five consumer risk levels, and the two states that are not levels.',
  );
  assert.equal(
    documentBySlug('safety-disclaimer')?.summary,
    'What Lotly is for, and the limits of what it can tell you.',
  );
  assert.equal(
    documentBySlug('corrections-policy')?.summary,
    'How official revisions and Lotly’s own corrections are handled.',
  );
  assert.equal(
    documentBySlug('attributions')?.summary,
    'The data sources and open-source software Lotly is built on.',
  );
  // Generic uses stay: a recall is a recall.
  assert.equal(NOTIFICATIONS_SUMMARY, 'Recall alerts for this device.');
  assert.equal(
    documentBySlug('sources-methodology')?.summary,
    'Where recall information comes from and how it is kept current.',
  );
  const about = PROFILE_DOCUMENT_GROUPS.find((group) => group.title === 'About & Safety');
  assert.equal(
    about?.footnote,
    'Recall information comes from official FDA and USDA FSIS notices; every recall links to its government source.',
  );
  assert.ok(PROFILE.includes('footnote={group.footnote}'));
  // The footnote belongs to About & Safety, not to the App group.
  assert.equal(PROFILE_DOCUMENT_GROUPS.filter((group) => group.footnote).length, 1);
  // Titles and slugs are untouched by the rename.
  assert.equal(documentBySlug('risk-levels')?.title, 'Risk Levels Explained');
  assert.equal(documentBySlug('privacy-data-controls')?.title, 'Privacy & Data Controls');
  // No hub source spells "Recall" as the product either.
  for (const [name, source] of Object.entries({ profile: PROFILE, model: MODEL, ...COMPONENTS })) {
    assert.doesNotMatch(
      codeOnly(source),
      /Recall(’s|'s| is | app)/,
      `${name} names the product Recall`,
    );
  }
});

// ── 17–18. The exploration is resolved; no parallel design system ──────────

test('Directions A, B and C and the three-way selector are gone; one gallery of production components remains', () => {
  for (const gone of [
    ['components', 'design-preview'],
    ['app', 'design-preview', 'profile.tsx'],
    ['lib', 'profile-directions.ts'],
  ]) {
    assert.ok(!existsSync(join(SRC, ...gone)), `${gone.join('/')} still exists`);
  }
  for (const forbidden of [
    'PROFILE DIRECTIONS',
    'ProfileDirection',
    'profile-directions',
    '/design-preview/profile',
    'Direction A',
    'Direction B',
    'Direction C',
    'TRUST_LEAD',
    'SIMULATED_SELECTION_NOTE',
  ]) {
    assert.ok(!HUB.includes(forbidden), `the hub still offers ${forbidden}`);
  }
  for (const file of sourceFiles().filter((path) => !path.endsWith('profile-design.test.ts'))) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!source.includes('profile-directions'), `${file} references the exploration`);
    assert.ok(!source.includes('PROFILE_DIRECTION'), `${file} references the exploration`);
  }
  // The one gallery: the production components, imported, in the named states.
  assert.ok(HUB.includes('PROFILE COMPONENTS AND STATES'));
  assert.ok(HUB.includes('<ProfileGallery />'));
  for (const component of Object.keys(COMPONENTS)) {
    assert.ok(
      HUB.includes(`from '@/components/profile/${component}'`),
      `the gallery copies ${component}`,
    );
  }
  for (const state of [
    "{ status: 'loading' }",
    'ready(EMPTY_PREFERENCES)',
    "allergens: ['peanut', 'milk']",
    "allergens: ['peanut', 'tree nuts', 'milk', 'egg']",
    "{ status: 'unavailable' }",
    '<DevelopmentEntry',
  ]) {
    assert.ok(GALLERY.includes(state), `the gallery lacks ${state}`);
  }
  // Every state is labelled simulated, and the gallery touches no store.
  assert.ok(GALLERY.includes('neither reads nor writes this device’s preferences'));
  assert.equal(count(GALLERY, '— simulated:'), 5);
  for (const forbidden of ['preferences-store', 'loadPreferences', 'savePreferences']) {
    assert.ok(!codeOnly(HUB).includes(forbidden), `the hub touches ${forbidden}`);
  }
});

test('no .interface-design/system.md exists and no token was added or changed', () => {
  assert.ok(!existsSync(join(ROOT, '.interface-design')), 'a parallel design system was written');
  for (const source of [MODEL, ...Object.values(COMPONENTS)]) {
    assert.ok(!/export const (color|spacing|radius|typography|elevation)\b/.test(source));
    assert.ok(!source.includes('export const styles'));
  }
});
