/**
 * The three-tab information architecture (P2A), pinned against the route
 * sources as text — the same approach profile-structure.test.ts and the
 * workflow-schedule pins use, because there is no React renderer in this
 * suite and these are one-line facts whose silent drift would put a fourth
 * destination in the bar, orphan a screen, or resurrect a deep link nobody
 * can reach.
 *
 * What is asserted here is structure, not appearance: which destinations
 * exist, in which order, under which labels, and which routes deliberately
 * stay OUT of the bar. The tab bar's dimensions, colors, and eventual icons
 * belong to the design system and are pinned nowhere.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const APP = join(__dirname, '..', 'app');
const TABS = join(APP, '(tabs)');
const read = (...parts: string[]): string => readFileSync(join(APP, ...parts), 'utf8');

const TAB_LAYOUT = read('(tabs)', '_layout.tsx');
const ROOT_LAYOUT = read('_layout.tsx');
const FEED = read('(tabs)', 'index.tsx');

/** The tab screens the layout declares, in declaration order. */
const declaredTabs = [...TAB_LAYOUT.matchAll(/<Tabs\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);

// ── The bar itself ──────────────────────────────────────────────────────────

test('the bottom navigation has exactly three destinations, in order', () => {
  assert.deepEqual(declaredTabs, ['index', 'saved', 'profile']);
});

test('Feed is the initial destination', () => {
  // Expo Router's initial tab is the group's `index` route, and it is
  // declared first. Both facts together are what make Feed the landing
  // destination — either alone could drift.
  assert.equal(declaredTabs[0], 'index');
  assert.ok(existsSync(join(TABS, 'index.tsx')), 'the Feed route must be the group index');
});

test('the labels and spoken names are exactly Feed, Saved and Profile', () => {
  for (const label of ['Feed', 'Saved', 'Profile']) {
    assert.match(TAB_LAYOUT, new RegExp(`title: '${label}'`), `missing title ${label}`);
    assert.match(TAB_LAYOUT, new RegExp(`tabBarLabel: '${label}'`), `missing label ${label}`);
    assert.match(
      TAB_LAYOUT,
      new RegExp(`tabBarAccessibilityLabel: '${label}'`),
      `missing accessibility label ${label}`,
    );
  }
  // The feed is named Feed, never Home / Recalls / Recall Alerts.
  for (const rejected of ['Home', 'Recalls', 'Recall Alerts']) {
    assert.ok(
      !TAB_LAYOUT.includes(`tabBarLabel: '${rejected}'`),
      `the feed tab must not be labelled ${rejected}`,
    );
  }
});

test('nothing but the three destinations lives in the tab group', () => {
  // A route becomes a tab by being in this folder, so the folder's contents
  // ARE the bar. This is the guard against a fourth item appearing by
  // accident rather than by decision.
  assert.deepEqual(readdirSync(TABS).sort(), [
    '_layout.tsx',
    'index.tsx',
    'profile.tsx',
    'saved.tsx',
  ]);
});

test('Search, Affects Me, Settings, Detail and the report screens are not tabs', () => {
  for (const name of [
    'search',
    'affects-me',
    'settings',
    'recall/[id]',
    'report/[id]',
    'document/[slug]',
  ]) {
    assert.ok(!declaredTabs.includes(name), `${name} must not be a bottom-bar destination`);
  }
});

// ── Nesting ─────────────────────────────────────────────────────────────────

test('the root stack owns the group once, with its own header hidden', () => {
  assert.match(
    ROOT_LAYOUT,
    /<Stack\.Screen name="\(tabs\)" options=\{\{ headerShown: false \}\} \/>/,
  );
  // Exactly one registration — a second would be a second navigator.
  assert.equal([...ROOT_LAYOUT.matchAll(/name="\(tabs\)"/g)].length, 1);
});

test('a pushed screen cannot render a second tab bar', () => {
  // Detail, the questionnaire, the settings pages and the documents are
  // registered on the ROOT stack, outside the group, so they push over the
  // bar instead of nesting another navigator inside a tab.
  for (const name of [
    'recall/[id]',
    'report/[id]',
    'settings/index',
    'settings/personalization',
    'settings/notifications',
    'document/[slug]',
  ]) {
    assert.ok(ROOT_LAYOUT.includes(`name="${name}"`), `${name} is not on the root stack`);
    assert.ok(
      !existsSync(join(TABS, `${name}.tsx`)),
      `${name} must not also exist inside the tab group`,
    );
  }
  // And no nested navigator is declared anywhere but the two layouts.
  assert.ok(!FEED.includes('<Tabs'), 'the Feed screen must not declare its own navigator');
});

// ── Deep links and route compatibility ──────────────────────────────────────

test('every pre-existing route still resolves to a real screen', () => {
  // `(tabs)` is a route GROUP: it contributes no URL segment, so `/` and
  // `/profile` are unchanged by the move. These are the paths external deep
  // links and the push-notification handler use.
  for (const file of [
    ['(tabs)', 'index.tsx'], // "/"
    ['(tabs)', 'profile.tsx'], // "/profile"
    ['recall', '[id].tsx'],
    ['report', '[id].tsx'],
    ['document', '[slug].tsx'],
    ['settings', 'index.tsx'], // "/settings"
  ]) {
    assert.ok(existsSync(join(APP, ...file)), `${file.join('/')} is missing`);
  }
  // The push handler's deep link target is unchanged.
  const push = readFileSync(join(__dirname, '..', 'hooks', 'use-push-notifications.ts'), 'utf8');
  assert.match(push, /pathname: '\/recall\/\[id\]'/);
});

test('the superseded /settings route redirects rather than rendering a dead screen', () => {
  const legacy = read('settings', 'index.tsx');
  assert.match(legacy, /<Redirect href="\/settings\/notifications" \/>/);
  // Redirect REPLACES, so no dead entry joins the history and Back cannot
  // bounce the user through a screen that renders nothing.
  assert.ok(!legacy.includes('router.push'), 'a push would leave a trap in the history');
  // It is a redirect and nothing else — no revived combined settings form.
  assert.ok(!legacy.includes('savePreferences'));
  assert.ok(!legacy.includes('getAlertStatus'));
});

// ── Feed keeps what it owned ────────────────────────────────────────────────

test('Search stays inside Feed — it is a control, not a destination', () => {
  assert.match(FEED, /accessibilityLabel="Search recalls"/);
  assert.match(FEED, /filterBySearch/);
  assert.ok(!existsSync(join(TABS, 'search.tsx')));
});

test('Affects Me stays inside Feed as the existing mode control', () => {
  assert.match(FEED, /FEED MODE CONTROL/);
  assert.match(FEED, /buildAffectsMeSections/);
  assert.ok(!existsSync(join(TABS, 'affects-me.tsx')));
  // One feed, two modes — not a second feed screen. (Matched with a trailing
  // space so the list's own ref TYPE, `useRef<SectionList<…>>`, is not
  // counted as a second rendered list.)
  assert.equal([...FEED.matchAll(/<SectionList\s/g)].length, 1);
});

test('Feed and Saved share ONE feed session, so a tab switch cannot double-fetch', () => {
  const hook = readFileSync(join(__dirname, '..', 'hooks', 'use-feed.ts'), 'utf8');
  assert.match(hook, /let feedSession: FeedSession \| null = null;/);
  for (const screen of [FEED, read('(tabs)', 'saved.tsx')]) {
    assert.match(screen, /import \{ useFeed[^}]*\} from '@\/hooks\/use-feed'/);
    assert.ok(
      !screen.includes('createFeedSession'),
      'a screen creating its own session would mean a second cache and duplicate syncs',
    );
  }
});

test('the feed request and ordering path is unchanged by the move', () => {
  // The screen still receives its corpus from the same reconciliation engine
  // and sections it with the same pure functions — the move changed where
  // the session is constructed, not what it does.
  const hook = readFileSync(join(__dirname, '..', 'hooks', 'use-feed.ts'), 'utf8');
  assert.match(hook, /fetchManifest: fetchCurrentManifest/);
  assert.match(hook, /fetchAll: fetchCurrentFeed/);
  assert.match(hook, /fetchByIds: fetchFeedItemsByIds/);
  assert.match(FEED, /buildFeedSections\(allVisible\)/);
  assert.match(FEED, /orderByLocationTiers/);
});

test('community shopper-report data stays off the Feed', () => {
  for (const forbidden of ['CommunityReportsBlock', 'loadReportSummary', 'shoppers reported']) {
    assert.ok(!FEED.includes(forbidden), `Feed must not reference ${forbidden}`);
  }
});

// ── Profile ─────────────────────────────────────────────────────────────────

const PROFILE = read('(tabs)', 'profile.tsx');

test('Profile offers its three primary destinations and no settings form', () => {
  assert.match(PROFILE, /label="Personalization"/);
  assert.match(PROFILE, /href="\/settings\/personalization"/);
  assert.match(PROFILE, /label="Notifications"/);
  assert.match(PROFILE, /href="\/settings\/notifications"/);
  // The third is the registered privacy document, taken from the registry so
  // Profile cannot invent a destination or drift from the document's title.
  assert.match(PROFILE, /PROFILE_PRIMARY_DOCUMENT_SLUG/);
  assert.match(PROFILE, /pathname: '\/document\/\[slug\]'/);

  // Profile is navigation only: no controls, no state, no duplicate form.
  for (const forbidden of [
    'useState',
    'preferences-store',
    'savePreferences',
    'loadPreferences',
    'push-registration',
    'getAlertStatus',
    'enableRecallAlerts',
    'CONSUMER_ALLERGENS',
    'searchRetailers',
  ]) {
    assert.ok(!PROFILE.includes(forbidden), `Profile must not reference ${forbidden}`);
  }
});

test('Personalization and Notifications are genuinely separate screens', () => {
  const personalization = read('settings', 'personalization.tsx');
  const notifications = read('settings', 'notifications.tsx');

  // Personalization owns the preference controls and nothing about permission.
  assert.match(personalization, /savePreferences/);
  assert.match(personalization, /CONSUMER_ALLERGENS/);
  assert.match(personalization, /searchRetailers/);
  for (const forbidden of ['enableRecallAlerts', 'disableRecallAlerts', 'getAlertStatus']) {
    assert.ok(!personalization.includes(forbidden), `Personalization must not own ${forbidden}`);
  }

  // Notifications owns the alert controls and writes no preference.
  assert.match(notifications, /enableRecallAlerts/);
  assert.match(notifications, /disableRecallAlerts/);
  for (const forbidden of ['savePreferences', 'CONSUMER_ALLERGENS', 'searchRetailers']) {
    assert.ok(!notifications.includes(forbidden), `Notifications must not own ${forbidden}`);
  }
});

test('opening Notifications reads the status and never requests permission', () => {
  const notifications = read('settings', 'notifications.tsx');
  // The focus effect calls ONLY the read-only status check.
  assert.match(notifications, /void load\(\);/);
  assert.match(notifications, /const alerts = await getAlertStatus\(\);/);
  // The prompt is reachable exclusively from the explicit button's onPress.
  const prompts = [...notifications.matchAll(/enableRecallAlerts/g)].length;
  assert.equal(prompts, 2, 'enableRecallAlerts should appear once as an import, once on a press');
  assert.match(notifications, /onPress=\{\(\) => run\(enableRecallAlerts\)\}/);
  assert.ok(
    !notifications.includes('useEffect(() => {\n    void run(enableRecallAlerts)'),
    'permission must never be requested on mount',
  );
});

test('push delivery is not activated and is not claimed to be active', () => {
  const notifications = read('settings', 'notifications.tsx');
  assert.ok(!notifications.includes('push:activate'));
  // It says what is true — whether alerts are on for THIS DEVICE — and does
  // not promise delivery the server has not been switched on for.
  assert.match(notifications, /Recall alerts are on for this device\./);
});

test('Profile creates no installation identity and no onboarding surface', () => {
  // Identity: visiting Profile must not mint an installation id as a side
  // effect — it imports nothing that could.
  for (const forbidden of ['getOrCreateInstallationId', 'installation-id', 'push-api']) {
    assert.ok(!PROFILE.includes(forbidden), `Profile must not reference ${forbidden}`);
  }
  // Destinations: no route or control for onboarding, sign-in, or billing.
  // Matched as NAVIGATION and CODE rather than as bare words, so the header
  // comment documenting their deliberate absence stays allowed.
  for (const destination of ['/onboarding', '/sign-in', '/subscribe', '/account']) {
    assert.ok(!PROFILE.includes(destination), `Profile must not link ${destination}`);
  }
  for (const symbol of ['signIn(', 'signUp(', 'purchase(', 'Subscription']) {
    assert.ok(!PROFILE.includes(symbol), `Profile must not call ${symbol}`);
  }
});

test('the unfinished Privacy Policy stays hidden from the simplified Profile', () => {
  assert.ok(!PROFILE.includes('privacy-policy'));
  assert.ok(!PROFILE.toLowerCase().includes('terms of service'));
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

test('returning to Feed re-reads preferences, so a personalization edit still lands', () => {
  // Affects Me recalculates from a focus-time preference read; the split of
  // the settings screen did not change which store either side uses.
  assert.match(FEED, /useFocusEffect\(/);
  assert.match(FEED, /void loadPreferences\(\)\.then\(/);
  assert.match(read('settings', 'personalization.tsx'), /void savePreferences\(next\)/);
});

test('switching tabs triggers no shopper-report call and no permission prompt', () => {
  const saved = read('(tabs)', 'saved.tsx');
  for (const screen of [FEED, saved, PROFILE]) {
    for (const forbidden of [
      'loadReportSummary',
      'loadMyReport',
      'submitReport',
      'enableRecallAlerts',
      'requestPermission',
    ]) {
      assert.ok(!screen.includes(forbidden), `a tab screen must not call ${forbidden}`);
    }
  }
});

test('no tab screen mutates official recall data, a report, or a notification setting', () => {
  const saved = read('(tabs)', 'saved.tsx');
  for (const screen of [FEED, saved, PROFILE]) {
    for (const forbidden of ['withdrawShopperReport', 'setInstallationPreferences', '.upsert(']) {
      assert.ok(!screen.includes(forbidden), `a tab screen must not call ${forbidden}`);
    }
  }
});
