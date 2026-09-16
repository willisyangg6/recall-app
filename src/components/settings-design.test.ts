/**
 * The Personalization and Notifications screens' visual implementation
 * (P2B6A and its follow-up), pinned at the source level — the technique
 * every design suite here uses, because React Native cannot render under
 * Node.
 *
 * What the milestone promises: every selection and catalog the screens
 * offered is still offered; the state is a single-choice control and the
 * allergens and stores are multi-choice controls, told apart by shape and
 * role, not colour; a store's row never moves when it is checked, selections
 * survive search changes, and the catalog's own matching is kept; Done and
 * Close only close (autosave is the one persistence path); clearing a state
 * keeps its selector open and choosing another replaces it and closes; the
 * main screen names zero, one and many stores; content section headings are
 * title case in the stronger style while navigation group labels keep the
 * uppercase caption; the approved copy appears exactly and no em dash
 * remains in authored copy; official content is untouched; the notification
 * permission is requested only after the explicit action; no notification
 * setting was invented; loading and failure are never mistaken for empty or
 * disabled; every control meets the 44pt minimum with the right role, state
 * and label; Dynamic Type is not capped; the preview galleries can save,
 * register and prompt nothing; and no production, server, schema or
 * dependency change occurred.
 *
 * The list rules, the copy and the status mapping are driven against the
 * real modules in lib/personalization-screen.test.ts and
 * lib/notifications-screen.test.ts.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { hitTarget, layout, typography } from '@/constants/design-tokens';
import { EMPTY_PREFERENCES, SUPPORTED_STATE_CODES } from '@/domain/preferences';
import { RETAILER_CATALOG } from '@/domain/retailer-catalog';
import {
  ENABLE_ACTION,
  ENABLE_HINT,
  notificationsPresentation,
  STATUS_ON,
} from '@/lib/notifications-screen';
import {
  FAILED_STATE,
  LOADING_STATE,
  stateChoices,
  storeRows,
  STORE_SEARCH_LABEL,
  STORE_SEARCH_PLACEHOLDER,
  storeSummary,
  toggleAllergen,
  toggleRetailer,
  withState,
} from '@/lib/personalization-screen';
import { NONE_SELECTED, NOT_CHOSEN, summarizePreferences } from '@/lib/profile-hub';

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

const ROUTE_P = read('app', 'settings', 'personalization.tsx');
const ROUTE_N = read('app', 'settings', 'notifications.tsx');
const ROOT_LAYOUT = read('app', '_layout.tsx');
const HUB = read('app', 'design-preview', 'index.tsx');
const FORM = read('components', 'settings', 'personalization-form.tsx');
const PANEL = read('components', 'settings', 'notifications-panel.tsx');
const SECTION = read('components', 'settings', 'settings-section.tsx');
const SHEET = read('components', 'settings', 'selector-sheet.tsx');
const TRIGGER = read('components', 'settings', 'selector-trigger.tsx');
const PROFILE_SECTION = read('components', 'profile', 'profile-section.tsx');
const CHECK = read('components', 'ui', 'check-row.tsx');
const CHOICE = read('components', 'ui', 'choice-row.tsx');
const SEARCH = read('components', 'ui', 'search-bar.tsx');
const BUTTON = read('components', 'ui', 'button.tsx');
const LIB_P = read('lib', 'personalization-screen.ts');
const LIB_N = read('lib', 'notifications-screen.ts');
const COPY_P = read('lib', 'personalization-copy.ts');
const STORE = read('lib', 'preferences-store.ts');
const PUSH = read('lib', 'push-registration.ts');

/** Source with comments removed, so a file may document what it does not do. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const count = (source: string, needle: string): number => source.split(needle).length - 1;

/** The body of one component, from its declaration to the next function. */
function componentBody(source: string, name: string): string {
  const from = source.indexOf(`export function ${name}(`);
  assert.ok(from >= 0, `${name} is missing`);
  const ends = [
    source.indexOf('\nexport function ', from + 1),
    source.indexOf('\nfunction ', from + 1),
  ].filter((at) => at > from);
  return source.slice(from, ends.length ? Math.min(...ends) : source.length);
}

/** The hub's two settings galleries, each alone. */
const PERSONALIZATION_GALLERY = HUB.slice(
  HUB.indexOf('function LivePreferences('),
  HUB.indexOf('function NotificationsGallery('),
);
const NOTIFICATIONS_GALLERY = HUB.slice(
  HUB.indexOf('function NotificationsGallery('),
  HUB.indexOf('function GallerySample('),
);

const SETTINGS_SOURCES = {
  routeP: ROUTE_P,
  routeN: ROUTE_N,
  form: FORM,
  panel: PANEL,
  section: SECTION,
  sheet: SHEET,
  trigger: TRIGGER,
};

// ── Catalogs, and the two selection models ──────────────────────────────────

test('every catalog and selection the screens offered is still offered, once', () => {
  assert.ok(FORM.includes('CONSUMER_ALLERGENS.map((option) => ('));
  assert.equal(stateChoices().length, SUPPORTED_STATE_CODES.length);
  assert.equal(storeRows('').length, RETAILER_CATALOG.length);
  for (const section of ['<StateSection', '<AllergenSection', '<StoreSection']) {
    assert.equal(count(FORM, section), 1, section);
  }
  assert.ok(ROUTE_P.includes('<PersonalizationForm prefs={load.prefs} onChange={update} />'));
  // The selectors start blank on the screen; the typed-in start is for galleries.
  assert.ok(!ROUTE_P.includes('initialQuery'));
});

test('the state selector: a single-choice sheet where clearing stays open and choosing replaces and closes', () => {
  const content = componentBody(FORM, 'StateSelectorContent');
  assert.ok(content.includes('<ChoiceGroup label={STATE_SELECTOR_TITLE}>'));
  assert.equal(count(content, '<ChoiceRow'), 1);
  assert.ok(content.includes('checked={choice.code === value}'), 'the current state is checked');
  assert.ok(CHOICE.includes('accessibilityRole="radio"'));
  assert.ok(CHOICE.includes('accessibilityState={{ checked, selected: checked }}'));
  // Choosing a row replaces the state and completes the selection.
  assert.match(content, /onPress=\{\(\) => \{\s*onChange\(choice\.code\);\s*onDone\(\);\s*\}\}/);
  // Clear selection sets null and calls nothing else — the sheet stays open.
  assert.ok(content.includes('onPress={() => onChange(null)}'));
  assert.ok(!/onChange\(null\);\s*onDone\(\)/.test(content));
  assert.ok(
    content.includes('{value !== null ? ('),
    'Clear selection only while a state is chosen',
  );
  // The sheet closes on the Close action (or a swipe); choosing closes it too.
  const sheet = componentBody(FORM, 'StateSelector');
  assert.ok(sheet.includes('onDone={onRequestClose}'));
  assert.ok(sheet.includes('action={{ label: CLOSE_LABEL, hint: CLOSE_HINT }}'));
  assert.ok(sheet.includes('title={STATE_SELECTOR_TITLE}'));
  assert.ok(sheet.includes('autoFocus'), 'the state search keeps its focus on open');
  // The main screen keeps one compact row that opens the sheet, blank each time.
  const section = componentBody(FORM, 'StateSection');
  assert.equal(count(section, '<SelectorTrigger'), 1);
  assert.ok(section.includes('placeholder={STATE_PLACEHOLDER}'));
  assert.ok(section.includes('action={name === null ? STATE_SELECT_LABEL : STATE_CHANGE_LABEL}'));
  assert.ok(section.includes('key={session}'));
  // Search clearing (the bar's Clear) and selection clearing are separate controls.
  assert.ok(content.includes('<SearchBar'));
  assert.ok(content.includes('label={STATE_CLEAR_LABEL}'));
});

test('the store selector: a stable checkbox sheet where a checked row never moves', () => {
  const content = componentBody(FORM, 'StoreSelectorContent');
  // The rows are the catalog's, from the query alone: the selection is not
  // an input to the list, so checking cannot reorder or move a row.
  assert.ok(content.includes('const rows = storeRows(query);'));
  assert.ok(!content.includes('storeRows(query, selected)'));
  assert.ok(!/rows\s*\.(filter|sort)\(/.test(content), 'no local reordering or exclusion');
  assert.ok(content.includes('checked={selected.includes(retailer.id)}'));
  assert.ok(content.includes('onPress={() => onToggle(retailer.id)}'));
  assert.ok(CHECK.includes('accessibilityRole="checkbox"'));
  assert.ok(CHECK.includes('accessibilityState={{ checked }}'));
  // The search narrows the same list and touches no selection.
  assert.ok(content.includes('onChangeText={setQuery}'));
  assert.equal(count(content, 'onToggle('), 1);
  assert.ok(content.includes('{STORE_SEARCH_NO_MATCH}'));
  // The sheet: title, count in words, Done — and Done only closes.
  const sheet = componentBody(FORM, 'StoreSelector');
  assert.ok(sheet.includes('title={STORE_SELECTOR_TITLE}'));
  assert.ok(sheet.includes('status={storeCountLabel(selected.length)}'));
  assert.ok(sheet.includes('action={{ label: DONE_LABEL, hint: DONE_HINT }}'));
  assert.ok(sheet.includes('onRequestClose={onRequestClose}'));
  assert.ok(!sheet.includes('onDone'), 'nothing on the store sheet completes a selection');
  // The main screen: every chosen name, or the empty words, with one action.
  const section = componentBody(FORM, 'StoreSection');
  assert.equal(count(section, '<SelectorTrigger'), 1);
  assert.ok(section.includes('value={selected.length === 0 ? null : storeSummary(selected)}'));
  assert.ok(section.includes('action={storeActionLabel(selected)}'));
  assert.ok(!section.includes('<SearchBar'), 'the catalog search is not on the main screen');
  assert.ok(!section.includes('<CheckRow'), 'the catalog is not on the main screen');
  assert.ok(!FORM.includes('horizontal'), 'no horizontal scroller hides a selection');
});

test('the retailer search keeps the shared Clear and the catalog matching; Done is not a save step', () => {
  assert.equal(count(FORM, '<SearchBar'), 2);
  assert.ok(FORM.includes('accessibilityLabel={STORE_SEARCH_LABEL}'));
  assert.equal(STORE_SEARCH_LABEL, 'Search stores');
  assert.equal(STORE_SEARCH_PLACEHOLDER, 'Search stores');
  assert.ok(SEARCH.includes("export const CLEAR_SEARCH_LABEL = 'Clear';"));
  assert.ok(SEARCH.includes("onChangeText('');"));
  assert.ok(codeOnly(LIB_P).includes('return searchRetailers(query);'));
  // Every way a sheet closes goes through onRequestClose, which only flips
  // visibility: no save, no second persistence path.
  assert.ok(SHEET.includes('onRequestClose={onRequestClose}'));
  assert.ok(SHEET.includes('onPress={onRequestClose}'));
  assert.ok(SHEET.includes('allowSwipeDismissal'));
  assert.ok(FORM.includes('const close = useCallback(() => setOpen(false), []);'));
  for (const [name, source] of Object.entries({ form: FORM, sheet: SHEET, trigger: TRIGGER })) {
    for (const forbidden of ['savePreferences', 'preferences-store', 'SecureStore', 'fetch(']) {
      assert.ok(!codeOnly(source).includes(forbidden), `${name} touches ${forbidden}`);
    }
  }
  // Keyboard: taps land while it is up, a drag dismisses it, and the list
  // grows its inset beneath it.
  assert.ok(SHEET.includes('keyboardShouldPersistTaps="handled"'));
  assert.ok(SHEET.includes('keyboardDismissMode="on-drag"'));
  assert.ok(SHEET.includes('automaticallyAdjustKeyboardInsets'));
  assert.ok(ROUTE_P.includes('keyboardShouldPersistTaps="handled"'));
});

// ── Persistence and synchronization boundaries ──────────────────────────────

test('the route alone reads and saves through the one store; the sections and rules touch nothing', () => {
  assert.ok(
    ROUTE_P.includes(
      "import { loadPreferences, preferencesAvailable, savePreferences } from '@/lib/preferences-store';",
    ),
  );
  assert.ok(ROUTE_P.includes('void savePreferences(next).then('));
  assert.ok(ROUTE_P.includes("result.synced ? 'saved' : 'local_only'"));
  assert.match(ROUTE_P, /useFocusEffect\(\s*useCallback\(\(\) => \{/);
  assert.ok(ROUTE_P.includes('loadPreferences().then('));
  for (const forbidden of [
    'setInstallationPreferences',
    'SecureStore',
    'push-api',
    'installation-id',
    'flushPreferencesSync',
    'deleteLocalPreferenceState',
  ]) {
    assert.ok(!ROUTE_P.includes(forbidden), `the route references ${forbidden}`);
  }
  for (const [name, source] of Object.entries({
    form: FORM,
    section: SECTION,
    sheet: SHEET,
    trigger: TRIGGER,
    check: CHECK,
    rules: LIB_P,
  })) {
    for (const forbidden of [
      'preferences-store',
      'savePreferences',
      'loadPreferences',
      'SecureStore',
      'AsyncStorage',
      'fetch(',
      'installation',
    ]) {
      assert.ok(!codeOnly(source).includes(forbidden), `${name} touches ${forbidden}`);
    }
  }
  assert.ok(STORE.includes('return enqueueSave(() => writePreferences(prefs));'));
  const local = STORE.indexOf(
    'await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(cleaned));',
  );
  const mirror = STORE.indexOf('await syncToServer(cleaned);');
  assert.ok(local > 0 && mirror > local, 'the local write precedes the best-effort sync');
});

test('the edited values are exactly what the store saves and the Profile summary reads', () => {
  let prefs = withState(EMPTY_PREFERENCES, 'DC');
  prefs = toggleAllergen(toggleAllergen(prefs, 'milk'), 'peanut');
  prefs = toggleRetailer(toggleRetailer(prefs, 'walmart'), 'costco');
  assert.deepEqual(prefs, {
    state: 'DC',
    allergens: ['milk', 'peanut'],
    retailers: ['walmart', 'costco'],
  });
  assert.deepEqual(Object.keys(EMPTY_PREFERENCES).sort(), ['allergens', 'retailers', 'state']);
  const summary = summarizePreferences(prefs);
  assert.equal(summary.state, 'District of Columbia');
  assert.deepEqual(summary.allergens, ['Peanuts', 'Milk']);
  assert.deepEqual(summary.retailers, ['Walmart', 'Costco']);
  // The stored order is the order chosen, whatever order the selector lists.
  assert.equal(storeSummary(prefs.retailers), 'Walmart, Costco');
  assert.ok(FORM.includes('onChange(withState(prefs, code))'));
  assert.ok(FORM.includes('onChange(toggleAllergen(prefs, token))'));
  assert.ok(FORM.includes('onChange(toggleRetailer(prefs, id))'));
  assert.ok(ROUTE_P.includes("setLoad({ status: 'ready', prefs: next });"));
});

// ── Headings: two patterns ──────────────────────────────────────────────────

test('content section headings are title case in heading-3 navy; navigation group labels stay uppercase captions', () => {
  const heading = SECTION.slice(SECTION.indexOf('<Text variant="heading-3"'));
  assert.ok(heading.startsWith('<Text variant="heading-3" accessibilityRole="header">'));
  assert.ok(!SECTION.includes('toUpperCase'));
  assert.ok(!SECTION.includes('variant="caption"'), 'no caption heading remains in the section');
  assert.equal(typography['heading-3'].fontSize, 19);
  assert.equal(typography['heading-3'].face, 'sans-600');
  for (const title of ['Your state', 'Allergens to watch', 'Stores you shop at']) {
    assert.ok(LIB_P.includes(`'${title}'`) || COPY_P.includes(`'${title}'`), title);
    assert.equal(title, title.charAt(0).toUpperCase() + title.slice(1));
    assert.notEqual(title, title.toUpperCase());
  }
  // Profile's navigation group label is untouched: caption, secondary, uppercased.
  assert.ok(PROFILE_SECTION.includes('variant="caption"'));
  assert.ok(PROFILE_SECTION.includes('{title.toUpperCase()}'));
  assert.ok(PROFILE_SECTION.includes('accessibilityRole="header"'));
  // The sheets' titles use the content heading too.
  assert.ok(SHEET.includes('<Text variant="heading-3" accessibilityRole="header"'));
});

// ── Copy ────────────────────────────────────────────────────────────────────

test('the approved copy is rendered from the copy modules, and no authored sentence carries an em dash', () => {
  assert.ok(ROUTE_P.includes('{PERSONALIZATION_INTRO}'));
  assert.ok(FORM.includes('description={STATE_SECTION_HELPER}'));
  assert.ok(FORM.includes('description={ALLERGEN_SECTION_HELPER}'));
  assert.ok(FORM.includes('description={STORE_SECTION_HELPER}'));
  assert.ok(ROUTE_N.includes('{NOTIFICATIONS_INTRO}'));
  assert.ok(ROUTE_N.includes('{NOTIFICATIONS_FOOTNOTE}'));
  assert.ok(PANEL.includes('{shown.message}'));
  // No string literal in the screens, the sections or the copy modules
  // carries an em dash (the modules are also checked value by value in
  // their own suites).
  for (const [name, source] of Object.entries({
    ...SETTINGS_SOURCES,
    rulesP: LIB_P,
    rulesN: LIB_N,
    copyP: COPY_P,
  })) {
    const literals = codeOnly(source).match(/'[^'\n]*'|"[^"\n]*"/g) ?? [];
    for (const literal of literals) assert.ok(!literal.includes('—'), `${name}: ${literal}`);
  }
  // The retired wording is gone from these screens.
  const joined = [ROUTE_P, ROUTE_N, FORM, PANEL, LIB_P, LIB_N, COPY_P].map(codeOnly).join('\n');
  for (const retired of [
    'in a way that matters',
    'nothing else, no marketing',
    'Powers the',
    'shop or cook for',
    'Nothing is sent until',
    'system settings.',
    'Which recalls you are alerted about',
    'will sync when back online',
  ]) {
    assert.ok(!joined.includes(retired), `retired wording remains: ${retired}`);
  }
});

test('official and sourced content is not affected by the copy rules', () => {
  for (const [name, source] of Object.entries({
    ...SETTINGS_SOURCES,
    rulesP: LIB_P,
    rulesN: LIB_N,
  })) {
    for (const forbidden of ['@/content', 'official-urls', 'recall-feed', 'consumer-projection']) {
      assert.ok(!codeOnly(source).includes(forbidden), `${name} imports ${forbidden}`);
    }
  }
  // Document bodies keep their own wording and punctuation: the tone
  // rewrite is outside this scope (P2B6B changed only the product name in
  // them), and sourced notice content is never rewritten.
  assert.ok(read('content', 'how-affects-me-works.ts').includes('shop or cook for'));
  assert.ok(read('content', 'privacy-data-controls.ts').includes('What Lotly’s server stores'));
  assert.ok(PUSH.includes("name: 'Recall alerts',"));
  assert.equal(STATUS_ON, 'Recall alerts are on for this device.');
  assert.equal(ENABLE_ACTION, 'Enable recall alerts');
});

// ── Notifications ───────────────────────────────────────────────────────────

test('the notification permission is requested only from the explicit action; opening the screen reads', () => {
  assert.ok(ROUTE_N.includes('onEnable={() => run(enableRecallAlerts)}'));
  assert.equal(count(ROUTE_N, 'enableRecallAlerts'), 2);
  assert.match(ROUTE_N, /useFocusEffect\(\s*useCallback\(\(\) => \{[^}]*void load\(\);/);
  assert.ok(ROUTE_N.includes('const alerts = await getAlertStatus();'));
  assert.ok(!ROUTE_N.includes('useEffect('), 'no mount effect may run an operation');
  for (const [name, source] of Object.entries({ panel: PANEL, copy: LIB_N })) {
    for (const forbidden of [
      'push-registration',
      'expo-notifications',
      'requestPermissions',
      'getPermissions',
      'Linking',
      'openSettings',
    ]) {
      assert.ok(!codeOnly(source).includes(forbidden), `${name} reaches ${forbidden}`);
    }
  }
  assert.ok(ROUTE_N.includes('onOpenSettings={() => void Linking.openSettings()}'));
  const readBody = PUSH.slice(
    PUSH.indexOf('export async function getAlertStatus('),
    PUSH.indexOf('async function obtainAndRegisterToken('),
  );
  assert.ok(!readBody.includes('requestPermissionsAsync'));
  assert.ok(PUSH.includes('if (!permission.granted && permission.canAskAgain) {'));
});

test('no per-category toggle, schedule, history, quiet hours, account or sync exists on Notifications', () => {
  const sources = {
    route: codeOnly(ROUTE_N),
    panel: codeOnly(PANEL),
    copy: codeOnly(LIB_N),
    gallery: codeOnly(NOTIFICATIONS_GALLERY),
  };
  for (const [name, source] of Object.entries(sources)) {
    const lower = source.toLowerCase();
    for (const forbidden of [
      /<switch/,
      /\btoggle/,
      /quiet hours/,
      /\bschedule/,
      /\bhistory\b/,
      /\bcategor/,
      /\baccount/,
      /\bsync\b/,
      /\bcloud\b/,
      /\bsign in\b/,
    ]) {
      assert.ok(!forbidden.test(lower), `${name} references ${forbidden}`);
    }
  }
  assert.equal(count(PANEL, '<Button'), 1);
  assert.ok(PANEL.includes('onPress={handlers[shown.action.kind]}'));
});

test('the panel renders the mapping’s sentence and its one action for every status', () => {
  assert.ok(PANEL.includes('const shown = notificationsPresentation(view);'));
  assert.ok(PANEL.includes('<Callout tone="information">{shown.message}</Callout>'));
  assert.ok(PANEL.includes('variant={shown.action.variant}'));
  assert.ok(PANEL.includes('label={shown.action.label}'));
  assert.equal(
    notificationsPresentation({ status: 'ready', alerts: 'denied', busy: false, error: null })
      .action?.kind,
    'settings',
  );
  assert.ok(
    PANEL.includes(
      '<StateMessage title={UNSUPPORTED_STATE.title} body={UNSUPPORTED_STATE.body} />',
    ),
  );
});

// ── Loading and failure ─────────────────────────────────────────────────────

test('loading and failure are rendered as themselves — never as an empty form or a disabled control', () => {
  assert.ok(ROUTE_P.includes("useState<PreferencesLoadState>({ status: 'loading' })"));
  assert.ok(!ROUTE_P.includes('EMPTY_PREFERENCES'));
  assert.ok(ROUTE_P.includes("setLoad({ status: 'failed' });"));
  assert.ok(ROUTE_P.includes("setLoad({ status: 'unsupported' });"));
  assert.match(ROUTE_P, /load\.status === 'ready' \? \(/);
  assert.ok(ROUTE_P.includes('<PreferencesNotReady status={load.status} />'));
  assert.ok(FORM.includes('<StateMessage tone="loading" title={LOADING_STATE.title}'));
  assert.ok(FORM.includes('<StateMessage tone="error" title={FAILED_STATE.title}'));
  for (const word of [NOT_CHOSEN, NONE_SELECTED]) {
    assert.ok(!LOADING_STATE.title.includes(word) && !FAILED_STATE.title.includes(word));
  }
  assert.equal(notificationsPresentation({ status: 'loading' }).action, null);
  assert.ok(PANEL.includes('accessibilityState={{ busy: true }}'));
  assert.ok(
    PANEL.includes(
      "busy={view.status === 'ready' && view.busy && shown.action.busyLabel !== null}",
    ),
  );
  assert.ok(PANEL.includes('accessibilityRole="alert"'));
  assert.ok(ROUTE_N.includes("useState<NotificationsView>({ status: 'loading' })"));
});

// ── Targets, roles, states, labels, focus ───────────────────────────────────

test('every interactive control meets the 44pt minimum', () => {
  assert.equal(hitTarget.minimum, 44);
  assert.ok(CHECK.includes('minHeight: hitTarget.minimum,'));
  assert.ok(CHOICE.includes('minHeight: hitTarget.minimum,'));
  assert.ok(TRIGGER.includes('minHeight: hitTarget.minimum,'));
  assert.ok(SHEET.includes('minHeight: hitTarget.minimum,'), 'the Done / Close action');
  assert.ok(BUTTON.includes('minHeight: hitTarget.minimum,'));
  assert.ok(SEARCH.includes('minHeight: layout.searchBarHeight,'));
  assert.equal(layout.searchBarHeight, 44);
  // The only bespoke pressables are the trigger row and the sheet's action.
  assert.equal(count(FORM, '<Pressable'), 0);
  assert.equal(count(TRIGGER, '<Pressable'), 1);
  assert.equal(count(SHEET, '<Pressable'), 1);
  assert.equal(
    count(PANEL, '<Pressable') + count(ROUTE_P, '<Pressable') + count(ROUTE_N, '<Pressable'),
    0,
  );
});

test('selection surfaces have titles, one dismiss action, announced states, labels, hints and focus return', () => {
  assert.ok(SHEET.includes('accessibilityRole="header"'));
  assert.ok(SHEET.includes('accessibilityLabel={action.label}'));
  assert.ok(SHEET.includes('accessibilityHint={action.hint}'));
  assert.ok(SHEET.includes('presentationStyle="pageSheet"'));
  assert.ok(SHEET.includes('accessibilityLiveRegion="polite"'), 'the count line is announced');
  assert.ok(TRIGGER.includes('accessibilityRole="button"'));
  assert.ok(TRIGGER.includes('accessibilityLabel={accessibilityLabel}'));
  assert.ok(TRIGGER.includes('accessibilityHint={accessibilityHint}'));
  assert.ok(FORM.includes('accessibilityLabel={stateTriggerLabel(name)}'));
  assert.ok(FORM.includes('accessibilityLabel={storeTriggerLabel(names)}'));
  assert.ok(FORM.includes('accessibilityHint={STORE_SEARCH_HINT}'));
  assert.ok(FORM.includes('accessibilityHint={STATE_SEARCH_HINT}'));
  assert.ok(CHECK.includes('accessibilityLabel={label}'));
  assert.ok(CHOICE.includes('accessibilityLabel={label}'));
  assert.ok(SECTION.includes('accessibilityRole="header"'));
  assert.ok(PANEL.includes('accessibilityHint={shown.action.hint ?? undefined}'));
  assert.ok(ENABLE_HINT.length > 0);
  // Focus returns to the trigger that opened a sheet, once it is gone.
  assert.ok(FORM.includes('AccessibilityInfo.setAccessibilityFocus(tag)'));
  assert.equal(count(FORM, 'onClosed={focusTrigger}'), 2);
  assert.ok(SHEET.includes("onDismiss={Platform.OS === 'ios' ? onClosed : undefined}"));
  assert.ok(TRIGGER.includes('forwardRef'));
  // The count is words, never only colour; the two no-match lines are announced.
  assert.ok(LIB_P.includes("'1 store selected'"));
  assert.equal(count(FORM, 'accessibilityLiveRegion="polite"'), 3);
});

test('nothing caps Dynamic Type, truncates, or fixes a height around scaled text', () => {
  for (const [name, source] of Object.entries({ ...SETTINGS_SOURCES, check: CHECK })) {
    const code = codeOnly(source);
    assert.ok(!code.includes('maxFontSizeMultiplier'), `${name} caps Dynamic Type`);
    assert.ok(!code.includes('numberOfLines'), `${name} truncates`);
    assert.ok(!code.includes('maxHeight'), `${name} caps a height`);
    assert.ok(!code.includes('allowFontScaling'), `${name} disables font scaling`);
  }
  for (const [name, source] of Object.entries(SETTINGS_SOURCES)) {
    assert.ok(!/\bheight:/.test(codeOnly(source)), `${name} fixes a height`);
  }
  const heights = [...codeOnly(CHECK).matchAll(/\bheight: ([^,]+),/g)].map((m) => m[1]);
  assert.deepEqual(heights, ['iconSize[20]', '11']);
  // Long store names wrap in the trigger row: the value takes the row's width.
  assert.ok(TRIGGER.includes('style={styles.value}'));
  assert.ok(TRIGGER.includes('flex: 1,'));
});

// ── The galleries ───────────────────────────────────────────────────────────

test('the galleries draw the production components and can save, register and prompt nothing', () => {
  assert.ok(HUB.includes("from '@/components/settings/notifications-panel';"));
  assert.ok(HUB.includes("from '@/components/settings/personalization-form';"));
  assert.ok(PERSONALIZATION_GALLERY.length > 0 && NOTIFICATIONS_GALLERY.length > 0);
  for (const [name, source] of Object.entries({
    personalization: PERSONALIZATION_GALLERY,
    notifications: NOTIFICATIONS_GALLERY,
  })) {
    const code = codeOnly(source);
    for (const forbidden of [
      'savePreferences',
      'loadPreferences',
      'preferences-store',
      'enableRecallAlerts',
      'disableRecallAlerts',
      'getAlertStatus',
      'push-registration',
      'Linking',
      'openSettings',
      'requestPermissions',
      'SecureStore',
      'fetch(',
      'supabase',
    ]) {
      assert.ok(!code.includes(forbidden), `the ${name} gallery references ${forbidden}`);
    }
  }
  assert.ok(PERSONALIZATION_GALLERY.includes('onChange={setPrefs}'));
  assert.ok(PERSONALIZATION_GALLERY.includes('useState<UserRecallPreferences>(initial)'));
  assert.ok(
    NOTIFICATIONS_GALLERY.includes('onEnable={noop} onDisable={noop} onOpenSettings={noop}'),
  );
  assert.equal(count(PERSONALIZATION_GALLERY, '— simulated:'), 16);
  assert.equal(count(NOTIFICATIONS_GALLERY, '— simulated:'), 7);
  for (const label of [
    'Loading',
    'Empty selections',
    'Populated',
    'Read failure',
    'State row, no selection',
    'State row, existing selection',
    'State selector, search',
    'State selector, clear while open',
    'State selector, replace',
    'Store row, none selected',
    'Store row, several selected',
    'Store row, long names',
    'Store selector, no query',
    'Store selector, filtered',
    'Store selector, several checked in place',
    'Store selector, no results',
  ]) {
    assert.ok(PERSONALIZATION_GALLERY.includes(`caption="${label} — simulated:`), label);
  }
  for (const label of [
    'Loading',
    'Not determined',
    'Enabled',
    'Denied but askable',
    'System settings required',
    'Unavailable / unsupported',
    'Operation failure',
  ]) {
    assert.ok(NOTIFICATIONS_GALLERY.includes(`'${label} — simulated:`), label);
  }
  assert.ok(read('app', '(tabs)', 'profile.tsx').includes('{__DEV__ ? ('));
});

// ── No production, server, schema or dependency change ──────────────────────

test('the screens import only client modules and no new dependency; storage keys and the permission mapping are untouched', () => {
  const allowed = ['react', 'react-native', 'expo-router', 'react-native-safe-area-context'];
  for (const [name, source] of Object.entries({
    ...SETTINGS_SOURCES,
    rulesP: LIB_P,
    rulesN: LIB_N,
  })) {
    const imports = [...codeOnly(source).matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(!/server|supabase|scripts|migrations/.test(spec), `${name} imports ${spec}`);
      assert.ok(
        spec.startsWith('@/') || spec.startsWith('./') || allowed.includes(spec),
        `${name} imports an unexpected package: ${spec}`,
      );
    }
  }
  // The sheet is React Native's own Modal — no bottom-sheet library.
  assert.ok(
    SHEET.includes(
      "import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';",
    ),
  );
  const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  for (const name of Object.keys(pkg.dependencies)) {
    assert.ok(!/bottom-sheet|modal|picker|checkbox/i.test(name), `a selector dependency: ${name}`);
  }
  assert.deepEqual([...codeOnly(LIB_P).matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort(), [
    '@/domain/preferences',
    '@/domain/retailer-catalog',
  ]);
  assert.deepEqual(
    [...codeOnly(LIB_N).matchAll(/from '([^']+)'/g)].map((m) => m[1]),
    ['./alert-status'],
  );
  assert.ok(STORE.includes("const PREFS_KEY = 'recall.preferences';"));
  assert.ok(PUSH.includes("const ENABLED_FLAG_KEY = 'recall.alerts-enabled';"));
  assert.ok(
    read('lib', 'alert-status.ts').includes(
      "export type AlertStatus = 'not_enabled' | 'enabled' | 'denied';",
    ),
  );
});

// ── Tokens, shared components, and the navigator's header ───────────────────

test('both screens draw from the tokens and the shared primitives under the root stack’s header', () => {
  for (const [name, source] of Object.entries({ routeP: ROUTE_P, routeN: ROUTE_N })) {
    assert.ok(source.includes("import { Surface } from '@/components/ui/surface';"), name);
    assert.ok(source.includes("import { Text } from '@/components/ui/text';"), name);
    assert.ok(source.includes("import { layout, spacing } from '@/constants/design-tokens';"));
    assert.ok(source.includes('<Surface background="background/page" style={styles.page}>'));
    assert.ok(source.includes('paddingHorizontal: layout.pageMargin,'));
    assert.ok(source.includes('maxWidth: layout.maxContentWidth,'));
    assert.ok(source.includes('paddingBottom: spacing[24] + insets.bottom'));
    for (const forbidden of ["'@/constants/theme'", 'ThemedText', 'ThemedView', 'useTheme']) {
      assert.ok(!source.includes(forbidden), `${name} uses the legacy theme: ${forbidden}`);
    }
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(codeOnly(source)), `${name} spells a colour`);
    assert.ok(!source.includes('variant="heading'), `${name} draws an in-page title`);
    assert.ok(!source.includes('<Stack.Screen'), `${name} overrides the header`);
  }
  assert.ok(!ROUTE_N.includes('Recall alerts</'), 'the old in-page subtitle is gone');
  assert.ok(
    ROOT_LAYOUT.includes(
      '<Stack.Screen name="settings/personalization" options={{ title: \'Personalization\' }} />',
    ),
  );
  assert.ok(
    ROOT_LAYOUT.includes(
      '<Stack.Screen name="settings/notifications" options={{ title: \'Notifications\' }} />',
    ),
  );
  for (const [name, source] of Object.entries({
    form: FORM,
    panel: PANEL,
    section: SECTION,
    sheet: SHEET,
    trigger: TRIGGER,
  })) {
    assert.ok(source.includes("from '@/constants/design-tokens'"), name);
    assert.ok(!/\b(padding|margin|gap)[A-Za-z]*:\s*-?\d/.test(source), `${name} spaces off-scale`);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(codeOnly(source)), `${name} spells a colour`);
  }
  assert.ok(SHEET.includes('<Surface background="background/page" style={styles.sheet}>'));
  assert.ok(PANEL.includes("import { Button } from '@/components/ui/button';"));
  assert.ok(PANEL.includes("import { Callout } from '@/components/ui/callout';"));
  assert.ok(PANEL.includes("import { StateMessage } from '@/components/state-message';"));
  assert.ok(FORM.includes("import { SearchBar } from '@/components/ui/search-bar';"));
  assert.ok(FORM.includes("import { ChoiceGroup, ChoiceRow } from '@/components/ui/choice-row';"));
  assert.ok(FORM.includes("import { CheckRow } from '@/components/ui/check-row';"));
});
