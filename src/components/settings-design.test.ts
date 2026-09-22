/**
 * The Personalization and Notifications screens' visual implementation
 * (P2B6A and its follow-up), pinned at the source level — the technique
 * every design suite here uses, because React Native cannot render under
 * Node.
 *
 * What the milestone promises: every selection and catalog the screens
 * offered is still offered; states, allergens and stores are ALL multi-choice
 * controls (P2B7U), carrying checkbox shape and role, never a radio's; a
 * row never moves when it is checked, selections survive search changes, and
 * the catalog's own matching is kept; the store sheet's Done only closes
 * (autosave is that section's one persistence path) while the state sheet's
 * Done is the ONE route that saves its draft, and every other exit discards
 * it; the main screen names zero, one and many stores in full and
 * abbreviates the states; content section headings are
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
  stateSummary,
  storeRows,
  STORE_SEARCH_LABEL,
  STORE_SEARCH_PLACEHOLDER,
  storeSummary,
  toggleAllergen,
  toggleRetailer,
  withStates,
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

/**
 * The hub's two settings galleries, each alone.
 *
 * Bounded by the NEXT top-level function rather than by a named one. The
 * notifications slice used to run all the way to `GallerySample`, which
 * silently swept in every function declared in between — so an unrelated
 * gallery added later (P2B7S's freshness gallery, which legitimately says
 * "sync") failed the notifications scope assertion below. The slice now
 * means what its name says.
 */
function untilNextFunction(source: string, start: string): string {
  const from = source.indexOf(start);
  const next = source.indexOf('\nfunction ', from + start.length);
  return source.slice(from, next === -1 ? source.length : next);
}
const PERSONALIZATION_GALLERY = HUB.slice(
  HUB.indexOf('function LivePreferences('),
  HUB.indexOf('function NotificationsGallery('),
);
const NOTIFICATIONS_GALLERY = untilNextFunction(HUB, 'function NotificationsGallery(');

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

test('the state selector: a multi-select sheet that stays open, drafts every change, and saves only on Done', () => {
  const content = componentBody(FORM, 'StateSelectorContent');
  // Multi-select semantics, by shape and by role. The rows are Check Rows,
  // which announce as checkboxes with their checked state.
  assert.equal(count(content, '<CheckRow'), 1);
  assert.ok(content.includes('checked={draft.includes(choice.code)}'));
  assert.ok(CHECK.includes('accessibilityRole="checkbox"'));
  assert.ok(CHECK.includes('accessibilityState={{ checked }}'));
  assert.ok(CHECK.includes('accessibilityLabel={label}'));

  // A tap edits the DRAFT and does nothing else: it cannot commit, and it
  // cannot close. Neither the commit nor any dismissal is reachable from a
  // row's press handler.
  assert.ok(
    content.includes('onPress={() => setDraft((prior) => toggleStateCode(prior, choice.code))}'),
  );
  assert.equal(count(content, 'onCommit('), 1, 'exactly one place commits');
  assert.ok(!/onPress=\{\(\) => \{[\s\S]*?onCommit\(/.test(content), 'a row commits');
  assert.ok(!content.includes('onDone()'), 'nothing but the action completes the selection');

  // Clear empties the draft and stays open — no commit, no dismissal.
  assert.ok(content.includes('onPress={onClear}'));
  assert.ok(content.includes('label={STATE_CLEAR_LABEL}'));

  // P2B7V — `Clear selection` is PERMANENTLY allocated. The controls slot is
  // a fixed two-element column, so choosing the first state or clearing the
  // last one can never insert or remove a pill above the list and shift all
  // 52 rows. This is the structural pin: no conditional may appear inside the
  // controls slot at all, which is what stops a later change from quietly
  // reintroducing the jump.
  const controls = content.slice(
    content.indexOf('const controls = ('),
    content.indexOf('const list ='),
  );
  assert.ok(controls.includes('<Button'), 'the clear control left the controls slot');
  assert.ok(!controls.includes('draft.length > 0 ?'), 'Clear selection is conditional again');
  assert.ok(!/\?\s*\(/.test(controls), 'a conditional reached the pinned controls slot');
  assert.ok(!controls.includes('&&'), 'a conditional reached the pinned controls slot');
  // With nothing checked it is inert rather than absent, and the handler is
  // guarded too: removing either guard alone cannot make an empty clear
  // mutate, dismiss, or dirty the draft.
  assert.ok(controls.includes('disabled={draft.length === 0}'));
  // The no-op itself is the shared model's, not a rule this component keeps:
  // `clearStateDraft` is unit-tested on its behaviour in
  // `lib/personalization-screen.test.ts`.
  assert.ok(content.includes('const onClear = useCallback(() => setDraft(clearStateDraft), []);'));
  // The no-op reaches nothing else: no commit, no dismissal, no save.
  const clear = content.slice(
    content.indexOf('const onClear'),
    content.indexOf('// The controls slot'),
  );
  for (const forbidden of ['onCommit', 'onRequestClose', 'setOpen', 'onDone']) {
    assert.ok(!clear.includes(forbidden), `Clear selection reaches ${forbidden}`);
  }

  // The draft is seeded from the SAVED selection and is the component's own.
  assert.ok(content.includes('const [draft, setDraft] = useState<readonly string[]>(selected);'));
  // The rows come from the query alone, so a checked state hidden by a
  // search is still checked when the search is cleared.
  assert.ok(content.includes('const shown = filterStateChoices(choices, query);'));
  assert.ok(!content.includes('filterStateChoices(choices, query, draft)'));
  assert.ok(!/shown\s*\.(filter|sort)\(/.test(content), 'no local reordering or exclusion');
  assert.ok(content.includes('onChangeText={setQuery}'));
  assert.equal(count(content, 'setDraft('), 2, 'only a row and Clear ever change the draft');

  // Done hands over the WHOLE draft, once, as one value.
  assert.ok(content.includes('const onDone = useCallback(() => onCommit([...draft]), ['));

  // The sheet: the trailing action is Done, and it is wired to the COMMIT,
  // not to the dismissal. Every other way out is onRequestClose.
  const sheet = componentBody(FORM, 'StateSelector');
  assert.ok(sheet.includes('action={{ label: DONE_LABEL, hint: STATE_DONE_HINT }}'));
  assert.ok(sheet.includes('onAction={onDone}'));
  assert.ok(sheet.includes('onRequestClose={onRequestClose}'));
  assert.ok(sheet.includes('title={STATE_SELECTOR_TITLE}'));
  assert.ok(sheet.includes('status={status}'), 'the count line is the draft’s');
  assert.ok(sheet.includes('autoFocus'), 'the state search keeps its focus on open');
  // The sheet keeps the two exits apart: only the action can commit.
  assert.ok(SHEET.includes('onPress={onAction ?? onRequestClose}'));
  assert.ok(SHEET.includes('allowSwipeDismissal'));
  assert.ok(SHEET.includes('onRequestClose={onRequestClose}'), 'back and swipe dismiss');

  // The section: a dismissal only closes, so the draft dies with the sheet;
  // a commit saves and closes, in that order, exactly once each.
  const section = componentBody(FORM, 'StateSection');
  assert.ok(section.includes('const close = useCallback(() => setOpen(false), []);'));
  assert.ok(section.includes('onRequestClose={close}'));
  assert.ok(section.includes('onCommit={commit}'));
  assert.match(section, /onCommit\(codes\);\s*setOpen\(false\);/);
  assert.equal(count(section, 'onCommit(codes)'), 1);
  // Done commits once and closes once. The latch, held by the section that
  // owns BOTH halves of what Done does, makes a second press — a double tap,
  // or one landing as the sheet animates away — a no-op; reopening releases
  // it, which is the only way back into the sheet.
  assert.ok(section.includes('const committed = useRef(false);'));
  assert.match(
    section,
    /\(codes: string\[\]\) => \{\s*if \(committed\.current\) return;\s*committed\.current = true;\s*onCommit\(codes\);\s*setOpen\(false\);/,
  );
  assert.match(section, /const openSheet = \(\) => \{\s*committed\.current = false;/);
  // Remounting per opening is what re-seeds the draft from what is saved.
  assert.ok(section.includes('key={session}'));

  // The main screen keeps one compact row that opens the sheet, blank each
  // time, showing the abbreviated selection rather than a long list.
  assert.equal(count(section, '<SelectorTrigger'), 1);
  assert.ok(section.includes('value={selected.length === 0 ? null : stateSummary(selected)}'));
  assert.ok(section.includes('placeholder={STATE_PLACEHOLDER}'));
  assert.ok(section.includes('action={stateActionLabel(selected)}'));
  assert.ok(!section.includes('<SearchBar'), 'the state search is not on the main screen');
  assert.ok(!section.includes('<CheckRow'), 'the state list is not on the main screen');
  // Search clearing (the bar's Clear) and selection clearing stay separate.
  assert.ok(content.includes('<SearchBar'));
});

test('no radio semantics survive anywhere in the personalization screen', () => {
  // The multi-state selector must not be describable as "one of these", in
  // its components or in its roles. The Choice Row still exists for the
  // shopper report's questionnaire, which genuinely asks for one answer;
  // it simply may not appear here.
  for (const forbidden of ['ChoiceRow', 'ChoiceGroup', 'accessibilityRole="radio"', 'radiogroup']) {
    assert.ok(!FORM.includes(forbidden), `the form still carries ${forbidden}`);
  }
  assert.ok(!SHEET.includes('radio'));
  assert.ok(!TRIGGER.includes('radio'));
  // The Choice Row itself is untouched and still radio, for its own screen.
  assert.ok(CHOICE.includes('accessibilityRole="radio"'));
  assert.ok(read('components', 'report-questionnaire.tsx').includes('<ChoiceRow'));
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
  // The store sheet has no onAction, so every way it closes — the word, the
  // swipe, Android back — is the same dismissal: no save, no second
  // persistence path. (The state sheet's own Done is proven above.)
  assert.ok(SHEET.includes('onRequestClose={onRequestClose}'));
  assert.ok(SHEET.includes('onPress={onAction ?? onRequestClose}'));
  assert.ok(!componentBody(FORM, 'StoreSelector').includes('onAction'));
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
  let prefs = withStates(EMPTY_PREFERENCES, ['NY', 'DC', 'MT']);
  prefs = toggleAllergen(toggleAllergen(prefs, 'milk'), 'peanut');
  prefs = toggleRetailer(toggleRetailer(prefs, 'walmart'), 'costco');
  assert.deepEqual(prefs, {
    // Canonical order, not the order the codes arrived in.
    states: ['DC', 'MT', 'NY'],
    allergens: ['milk', 'peanut'],
    retailers: ['walmart', 'costco'],
  });
  assert.deepEqual(Object.keys(EMPTY_PREFERENCES).sort(), ['allergens', 'retailers', 'states']);
  const summary = summarizePreferences(prefs);
  assert.deepEqual(summary.states, ['District of Columbia', 'Montana', 'New York']);
  assert.deepEqual(summary.allergens, ['Peanuts', 'Milk']);
  assert.deepEqual(summary.retailers, ['Walmart', 'Costco']);
  // Stores keep the order chosen and are never abbreviated on the main
  // screen; states are canonical and abbreviated past two, because the list
  // they come from is 52 rows long.
  assert.equal(storeSummary(prefs.retailers), 'Walmart, Costco');
  assert.equal(stateSummary(prefs.states), 'District of Columbia, Montana +1');
  assert.ok(FORM.includes('onChange(withStates(prefs, codes))'));
  assert.ok(FORM.includes('onChange(toggleAllergen(prefs, token))'));
  assert.ok(FORM.includes('onChange(toggleRetailer(prefs, id))'));
  assert.ok(ROUTE_P.includes("setLoad({ status: 'ready', prefs: next });"));
});

// ── Headings: two patterns ──────────────────────────────────────────────────

test('content section headings are title case in heading-3 navy; navigation group labels are captions in the same title case', () => {
  const heading = SECTION.slice(SECTION.indexOf('<Text variant="heading-3"'));
  assert.ok(heading.startsWith('<Text variant="heading-3" accessibilityRole="header">'));
  assert.ok(!SECTION.includes('toUpperCase'));
  assert.ok(!SECTION.includes('variant="caption"'), 'no caption heading remains in the section');
  assert.equal(typography['heading-3'].fontSize, 19);
  assert.equal(typography['heading-3'].face, 'sans-600');
  for (const title of ['States you shop in', 'Allergens to watch', 'Stores you shop at']) {
    assert.ok(LIB_P.includes(`'${title}'`) || COPY_P.includes(`'${title}'`), title);
    assert.equal(title, title.charAt(0).toUpperCase() + title.slice(1));
    assert.notEqual(title, title.toUpperCase());
  }
  // Profile's navigation group label keeps its own TREATMENT — the small
  // secondary caption, which is what separates a group of links from a
  // section of content — but no longer its own CASING: since P2B7H both
  // patterns render the words as written, and only compact status badges
  // shout (P2B7H, DESIGN.md "Section headings and group labels").
  assert.ok(PROFILE_SECTION.includes('variant="caption"'));
  assert.ok(PROFILE_SECTION.includes('{title}'));
  assert.ok(!PROFILE_SECTION.includes('toUpperCase'));
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
  assert.match(PANEL, /<StateMessage\s+scrollable=\{false\}\s+title=\{UNSUPPORTED_STATE\.title\}/);
  // P3C1.5: a whole-screen state scrolls when the text outgrows the screen,
  // but this panel already sits inside the Notifications screen's own
  // ScrollView, so it opts out rather than nesting a second one.
  assert.ok(PANEL.includes('scrollable={false}'));
});

// ── Loading and failure ─────────────────────────────────────────────────────

test('loading and failure are rendered as themselves — never as an empty form or a disabled control', () => {
  assert.ok(ROUTE_P.includes("useState<PreferencesLoadState>({ status: 'loading' })"));
  assert.ok(!ROUTE_P.includes('EMPTY_PREFERENCES'));
  assert.ok(ROUTE_P.includes("setLoad({ status: 'failed' });"));
  assert.ok(ROUTE_P.includes("setLoad({ status: 'unsupported' });"));
  assert.match(ROUTE_P, /load\.status === 'ready' \? \(/);
  assert.ok(ROUTE_P.includes('<PreferencesNotReady status={load.status} />'));
  assert.match(
    FORM,
    /<StateMessage\s+scrollable=\{false\}\s+tone="loading"\s+title=\{LOADING_STATE\.title\}/,
  );
  assert.match(
    FORM,
    /<StateMessage\s+scrollable=\{false\}\s+tone="error"\s+title=\{FAILED_STATE\.title\}/,
  );
  // Same reason as the notifications panel: this form renders inside the
  // Personalization screen's ScrollView (P3C1.5).
  assert.equal((FORM.match(/scrollable=\{false\}/g) ?? []).length, 3);
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
  assert.ok(FORM.includes('accessibilityLabel={stateTriggerLabel(names)}'));
  assert.ok(FORM.includes('accessibilityLabel={storeTriggerLabel(names)}'));
  assert.ok(FORM.includes('accessibilityHint={STORE_SEARCH_HINT}'));
  assert.ok(FORM.includes('accessibilityHint={STATE_SEARCH_HINT}'));
  assert.ok(CHECK.includes('accessibilityLabel={label}'));
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
  assert.ok(LIB_P.includes("'1 state selected'"));
  // Four announced lines: each selector's no-match message, the state
  // selector's count line in a gallery frame, and the autosave status.
  assert.equal(count(FORM, 'accessibilityLiveRegion="polite"'), 4);
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
  // Long values wrap in the trigger row, and above 1.5x the row STACKS
  // rather than squeezing the value into a column a few characters wide.
  // The scale is read live, so changing the setting restacks the row.
  assert.ok(TRIGGER.includes('style={styles.value}'));
  assert.ok(TRIGGER.includes('flex: 1,'));
  assert.ok(TRIGGER.includes('const { fontScale } = useWindowDimensions();'));
  assert.ok(TRIGGER.includes('const stacked = fontScale >= STACK_AT_SCALE;'));
  assert.ok(TRIGGER.includes('const STACK_AT_SCALE = 1.5;'));
  assert.ok(TRIGGER.includes('stacked && styles.rowStacked'));
  assert.ok(TRIGGER.includes('stacked && styles.mainStacked'));
  assert.ok(TRIGGER.includes("flexDirection: 'column',"));
  // Stacking is a layout change, never a cap or a truncation.
  assert.ok(!codeOnly(TRIGGER).includes('numberOfLines'));
  assert.ok(!codeOnly(TRIGGER).includes('maxFontSizeMultiplier'));

  // P2B7U: Done is now the one control that SAVES, so it has to survive the
  // largest type size intact. The title takes the remaining column and wraps
  // (`flex: 1`); the action refuses to shrink, so the word is never squeezed
  // to an ellipsis or off the row, and the row aligns to the title's first
  // line rather than centring against a wrapped heading.
  const SHEET_STYLES = SHEET.slice(SHEET.indexOf('const styles = StyleSheet.create('));
  const titleRow = SHEET_STYLES.slice(
    SHEET_STYLES.indexOf('titleRow: {'),
    SHEET_STYLES.indexOf('title: {'),
  );
  assert.ok(titleRow.includes("alignItems: 'flex-start'"));
  const actionStyle = SHEET_STYLES.slice(
    SHEET_STYLES.indexOf('action: {'),
    SHEET_STYLES.indexOf('controls: {'),
  );
  assert.ok(actionStyle.includes('flexShrink: 0'), 'the Done word can be squeezed');
  assert.ok(actionStyle.includes('minHeight: hitTarget.minimum'));
  assert.ok(!actionStyle.includes('width:'), 'the action is sized by its own text');
  // The list is a ScrollView with no fixed or capped height, so 52 rows at
  // the largest type size scroll instead of clipping — and the keyboard's
  // inset is added rather than the list being shortened.
  assert.ok(SHEET.includes('<ScrollView'));
  assert.ok(SHEET.includes('automaticallyAdjustKeyboardInsets'));
  assert.ok(!/flexBasis|lineHeight:\s*\d/.test(codeOnly(SHEET)));
});

test('the multi-state selector announces what it is, what is checked, and what Done does', () => {
  // Every control the new editor adds speaks for itself.
  const content = componentBody(FORM, 'StateSelectorContent');
  const sheet = componentBody(FORM, 'StateSelector');
  const section = componentBody(FORM, 'StateSection');
  // The rows announce as checkboxes carrying their checked state — the one
  // thing that tells a screen-reader user this list takes more than one.
  assert.ok(CHECK.includes('accessibilityRole="checkbox"'));
  assert.ok(CHECK.includes('accessibilityState={{ checked }}'));
  assert.ok(content.includes('checked={draft.includes(choice.code)}'));
  // The count is words in a live region, so each tap is announced rather
  // than being carried by colour or position alone.
  assert.ok(sheet.includes('status={status}'));
  assert.ok(SHEET.includes('accessibilityLiveRegion="polite"'));
  assert.ok(LIB_P.includes("'1 state selected'"));
  // Done says that it saves, and what leaving without it does.
  assert.ok(sheet.includes('hint: STATE_DONE_HINT'));
  assert.match(
    LIB_P,
    /STATE_DONE_HINT =\s*'Saves the states you checked and closes the list\. Leaving without Done keeps your saved states\.'/,
  );
  // The trigger speaks every chosen jurisdiction in full, even when the row
  // itself abbreviates to two names and a count.
  assert.ok(section.includes('accessibilityLabel={stateTriggerLabel(names)}'));
  assert.ok(section.includes('const names = stateNamesForCodes(selected);'));
  assert.ok(LIB_P.includes('return `States: ${names.length === 0'));
  // Focus returns to the row that opened the sheet, on either way out.
  assert.ok(section.includes('onClosed={focusTrigger}'));
  // The no-match message is announced too.
  assert.ok(content.includes('{STATE_SEARCH_NO_MATCH}'));
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
  assert.equal(count(PERSONALIZATION_GALLERY, '— simulated:'), 18);
  assert.equal(count(NOTIFICATIONS_GALLERY, '— simulated:'), 7);
  for (const label of [
    'Loading',
    'Empty selections',
    'Populated',
    'Read failure',
    'States row, no selection',
    'States row, one selected',
    'States row, more than two selected',
    'States selector, search',
    'States selector, several checked',
    'States selector, nothing checked',
    'States selector, no results',
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
  // The rules module stays a leaf: the closed vocabularies, and the one
  // compact-summary rule it shares with the Profile hub (also a leaf). It
  // still reaches nothing that can read or write anything.
  assert.deepEqual([...codeOnly(LIB_P).matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort(), [
    './profile-hub',
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
  assert.ok(FORM.includes("import { CheckRow } from '@/components/ui/check-row';"));
});
