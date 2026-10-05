/**
 * The onboarding and education screens (P2B7X.1), pinned at the source
 * level — the technique every design suite here uses, because React Native
 * cannot render under Node.
 *
 * What the milestone promises, and what would fail here if it were undone:
 * `Clear selection` is permanently allocated and inert when empty on every
 * selector step; the count line is unconditional so the list never moves;
 * States alone can refuse Continue, and says why; allergens and retailers
 * continue empty; every step reads and saves through the ONE preference
 * store and holds no second copy; the founder's copy is rendered verbatim
 * from the copy module; the notification permission is reachable from the
 * education screen's primary action alone, never on mount and never from
 * `Not now`; the example card is the shared surface over static content;
 * everything is drawn from the tokens with no capped type and no fixed
 * height around text; and the Welcome draws the approved receipt
 * composition from its two production images and native text, invents no
 * mark, and plays no entrance at all.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { TILE } from '@/lib/allergen-grid';
import {
  ALLERGENS_BODY,
  ALLERGENS_HEADLINE,
  allergenCountLabel,
  CLEAR_SELECTION_LABEL,
  CONTINUE_CTA,
  EDUCATION_BODY,
  EDUCATION_CTA,
  EDUCATION_HEADLINE,
  EDUCATION_EXAMPLE_LABEL,
  EDUCATION_FOOTNOTE,
  EDUCATION_REASSURANCE,
  EDUCATION_SECONDARY,
  EDUCATION_SUCCESS,
  INDEPENDENCE_NOTE,
  PREFERENCES_SET_CONFIRMATION,
  PREVIEW_CTA,
  PREVIEW_EDIT,
  PREVIEW_HEADLINE,
  PREVIEW_MATCH_HEADING,
  PREVIEW_SUMMARY_LABELS,
  PREVIEW_SUMMARY_TITLE,
  RETAILERS_BODY,
  RETAILERS_HEADLINE,
  STATES_BODY,
  STATES_HEADLINE,
  STATES_CHOOSER_TITLE,
  STATES_FIELD_HINT,
  STATES_HELPER,
  STATES_REQUIRED_NOTE,
  STATES_SEARCH_HINT,
  STATES_SEARCH_PLACEHOLDER,
  NO_STATES_FOUND,
  statesFoundAnnouncement,
  WELCOME_BODY,
  WELCOME_CTA,
  WELCOME_EXAMPLE_CAPTION,
  WELCOME_HEADLINE,
  WELCOME_ILLUSTRATION_LABEL,
  WELCOME_TRUST_NOTE,
  WORDMARK_LABEL,
} from '@/lib/onboarding-copy';
import * as ONBOARDING_COPY from '@/lib/onboarding-copy';
import { SAMPLE_RECALL_MODEL } from '@/lib/onboarding-sample';
import { POPULAR_RETAILERS } from '@/lib/retailer-grid';
import { COUNT_GAP, ROW_MIN_HEIGHT, STORES_TYPE } from '@/lib/stores-receipt-presentation';
import { CHIP, CONTROL_MIN_HEIGHT, SCENE_PX, STATES_TYPE } from '@/lib/states-presentation';
import { retailerLogoCoverage } from '@/lib/retailer-logos';
import { STATE_CLEAR_HINT } from '@/lib/personalization-screen';
import {
  COUNTED_STEPS,
  filledSegments,
  motionAllowed,
  ONBOARDING_STEPS,
  progressAccessibilityLabel,
  stepProgress,
} from '@/lib/onboarding-state';
import {
  CAPTION_CENTRE_PX,
  captionBand,
  captionPlacement,
  CTA_MIN_HEIGHT,
  HERO_PX,
  heroHeight,
  QUIET_BAND_PX,
  TEXT_FULL_WIDTH_AT_SCALE,
  TEXT_MEASURE,
  textFullWidth,
  textMeasure,
  WELCOME_TYPE,
  WORDMARK_PX,
} from '@/lib/welcome-presentation';

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

const FRAME = read('components', 'onboarding', 'onboarding-frame.tsx');
const WELCOME = read('components', 'onboarding', 'welcome-content.tsx');
const STATES = read('components', 'onboarding', 'states-step.tsx');
const ALLERGENS = read('components', 'onboarding', 'allergens-step.tsx');
const RETAILERS = read('components', 'onboarding', 'retailers-step.tsx');
const SEARCH_SHEET = read('components', 'onboarding', 'retailer-search-sheet.tsx');
const STATE_SHEET = read('components', 'onboarding', 'state-search-sheet.tsx');
const PROBLEM = read('components', 'onboarding', 'problem-steps.tsx');
const BUILDING = read('components', 'onboarding', 'building-step.tsx');
const PREVIEW = read('components', 'onboarding', 'preview-step.tsx');
const CAROUSEL = read('components', 'onboarding', 'ready-carousel.tsx');
const EDITOR = read('components', 'onboarding', 'edit-preferences-step.tsx');
const CHOOSER = read('components', 'onboarding', 'allergen-chooser-sheet.tsx');
const EDUCATION = read('components', 'onboarding', 'notification-education.tsx');
const SAMPLE = read('components', 'onboarding', 'sample-recall-card.tsx');
const PANEL = read('components', 'paywall', 'paywall-panel.tsx');
const ONBOARDING_PANEL = read('components', 'paywall', 'onboarding-paywall-panel.tsx');
const FORM = read('components', 'settings', 'personalization-form.tsx');
const ROUTES = {
  welcome: read('app', 'onboarding', 'welcome.tsx'),
  problemScale: read('app', 'onboarding', 'problem-scale.tsx'),
  problemRisk: read('app', 'onboarding', 'problem-risk.tsx'),
  states: read('app', 'onboarding', 'states.tsx'),
  allergens: read('app', 'onboarding', 'allergens.tsx'),
  retailers: read('app', 'onboarding', 'retailers.tsx'),
  building: read('app', 'onboarding', 'building.tsx'),
  preview: read('app', 'onboarding', 'preview.tsx'),
  editPreferences: read('app', 'onboarding', 'edit-preferences.tsx'),
  education: read('app', 'onboarding', 'notifications.tsx'),
  onboardingPaywall: read('app', 'onboarding', 'paywall.tsx'),
  paywall: read('app', 'paywall.tsx'),
};
const HOOK = read('hooks', 'use-onboarding-preferences.ts');
const STATE_MAP = read('components', 'onboarding', 'state-map.tsx');
const PROGRESS = read('components', 'onboarding', 'onboarding-progress.tsx');
const REDUCE_MOTION = read('hooks', 'use-reduce-motion.ts');
const FEED = read('app', '(tabs)', 'index.tsx');

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** The body of one named function in a source file. */
function componentBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = source.indexOf('\nexport function ', start + 1);
  const nextPlain = source.indexOf('\nfunction ', start + 1);
  const ends = [next, nextPlain, source.indexOf('\nconst styles', start + 1)].filter((i) => i > 0);
  return source.slice(start, Math.min(...ends));
}

// ── Clear selection: permanently allocated, inert when empty ────────────────

test('Clear selection is permanently allocated on every selector step and inert when nothing is selected', () => {
  // States: the shared selector's controls slot (P2B7V) — no conditional.
  const stateContent = componentBody(FORM, 'StateSelectorContent');
  const controls = stateContent.slice(
    stateContent.indexOf('const controls = ('),
    stateContent.indexOf('const list ='),
  );
  assert.ok(controls.includes('<Button'), 'the clear control left the shared controls slot');
  assert.ok(
    !/\?\s*\(/.test(controls) && !controls.includes('&&'),
    'a conditional reached the shared controls slot',
  );
  assert.ok(controls.includes('disabled={draft.length === 0}'));

  // Allergens: its own fixed one-element controls slot — the compact
  // ClearAction (P2B7Z), always rendered — in the grid the step and the
  // editor's allergen chooser share (2026-09-30).
  const allergens = componentBody(ALLERGENS, 'AllergenGrid');
  const allergenControls = allergens.slice(
    allergens.indexOf('const controls = '),
    allergens.indexOf('return ('),
  );
  assert.ok(allergenControls.includes('<ClearAction'));
  assert.ok(
    !/\?\s*\(/.test(allergenControls) && !allergenControls.includes('&&'),
    'Clear selection is conditional on Allergens',
  );
  assert.ok(allergenControls.includes('disabled={selected.length === 0}'));
  const clearAction = codeOnly(componentBody(ALLERGENS, 'ClearAction'));
  assert.ok(clearAction.includes('accessibilityLabel={CLEAR_SELECTION_LABEL}'));
  assert.ok(clearAction.includes('{CLEAR_SELECTION_LABEL}'));
  assert.ok(clearAction.includes('disabled={disabled}'));
  assert.ok(
    allergens.includes('if (selected.length === 0) return;'),
    'an empty clear must be a true no-op',
  );
  assert.ok(allergens.includes('<View style={styles.controls}>{controls}</View>'));

  // Stores is the exception by design: its count row, and the Clear inside
  // it, are invisible and out of the accessibility tree while nothing is
  // chosen (pinned in the Stores tests below). The handler still refuses an
  // empty clear.
  const retailers = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  assert.ok(retailers.includes('if (selected.length === 0) return;'));
});

test('the count line above every list is unconditional, so a selection change never moves the rows', () => {
  // States left this rule with the grocery-atlas composition (2026-09-30):
  // it has no list on the step, only chips BELOW the one search entry, so a
  // chip added or removed moves nothing a finger is on (pinned in its own
  // section below).
  for (const [name, source, label] of [
    ['allergens', ALLERGENS, 'allergenCountLabel(selected.length)'],
  ] as const) {
    const code = codeOnly(source);
    assert.ok(code.includes(`<SelectionCount text={${label}} />`), `${name} count line missing`);
    const line = code.slice(code.indexOf('<SelectionCount'), code.indexOf('<SelectionCount') + 80);
    assert.ok(!line.includes('?'), `${name} count line is conditional`);
    assert.ok(!code.includes('length > 0 ? ('), `${name} inserts an element on selection`);
  }
  // The shared component renders its text always: no empty-string guard.
  const count = componentBody(FRAME, 'SelectionCount');
  assert.ok(!count.includes('?'), 'SelectionCount renders conditionally');
  assert.ok(!count.includes('return null'), 'SelectionCount can vanish');
  assert.ok(!count.includes('&&'), 'SelectionCount renders conditionally');
  assert.equal(allergenCountLabel(0), 'No allergens selected');
  assert.equal(allergenCountLabel(1), '1 allergen selected');
  assert.equal(allergenCountLabel(3), '3 allergens selected');
});

// ── Required and optional steps ─────────────────────────────────────────────

test('States alone can refuse Continue, with the shared disabled semantics and the reason said', () => {
  const states = codeOnly(STATES);
  assert.ok(states.includes('const canContinue = canContinueFromStates(draft);'));
  assert.ok(states.includes('<ContinueButton disabled={!canContinue} onPress={onContinue} />'));
  // The local 51pt pill keeps the shared Button's disabled semantics: inert,
  // announced disabled, the disabled fill and label, and the reason as its hint.
  const cta = codeOnly(componentBody(STATES, 'ContinueButton'));
  assert.ok(cta.includes('disabled={disabled}'));
  assert.ok(cta.includes('accessibilityState={{ disabled, busy: false }}'));
  assert.ok(cta.includes('accessibilityHint={disabled ? STATES_REQUIRED_NOTE : undefined}'));
  assert.ok(cta.includes("color={disabled ? 'text/primary' : 'text/inverse'}"));
  assert.ok(states.includes("backgroundColor: color['action/disabled'],"));
  assert.equal(STATES_REQUIRED_NOTE, 'Choose at least one state to continue.');
  // The grocery-atlas composition says the requirement in words beneath the
  // chips, always; the P2B7Y footer note (an invisible, allocated line under
  // Continue) is gone with the composition it balanced.
  assert.ok(states.includes('{STATES_HELPER}'));
  assert.ok(!states.includes('noteInactive'), 'the old allocated footer note came back');
  // Allergens and Stores: Continue is never disabled.
  const allergens = codeOnly(ALLERGENS);
  assert.ok(allergens.includes('footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}'));
  assert.ok(!allergens.includes('canContinue'), 'allergens gates Continue');
  // Stores draws its own page (the receipt, 2026-09-30) with a local 51pt
  // pill that has no disabled state at all.
  const stores = codeOnly(RETAILERS);
  assert.ok(stores.includes('<ContinueButton onPress={onContinue} />'));
  assert.ok(stores.includes('accessibilityState={{ disabled: false, busy: false }}'));
  assert.ok(!stores.includes('canContinue'), 'stores gates Continue');
  assert.ok(!/disabled=\{(?!false)/.test(stores), 'stores can disable a control');
});

// ── One preference store, no second copy ────────────────────────────────────

test('every step reads and saves through the one preference store, progressively, and holds no second store', () => {
  assert.ok(HOOK.includes("from '@/lib/preferences-store'"));
  assert.ok(HOOK.includes('void savePreferences(next)'));
  assert.ok(HOOK.includes('loadPreferences().then('));
  assert.ok(HOOK.includes('useFocusEffect('));
  for (const [name, source] of Object.entries(ROUTES)) {
    for (const forbidden of [
      'SecureStore',
      'AsyncStorage',
      'expo-file-system',
      'installation-id',
      'setInstallationPreferences',
    ]) {
      assert.ok(!source.includes(forbidden), `${name} reaches ${forbidden}`);
    }
  }
  for (const name of ['states', 'allergens', 'retailers'] as const) {
    assert.ok(ROUTES[name].includes('useOnboardingPreferences()'), `${name} reads its own copy`);
  }
  // Ready reads its own copy too, starting from the one already read (2026-10-02).
  assert.ok(ROUTES.preview.includes('useOnboardingPreferences({ reuseLoaded: true })'));
  // The edits are the shared rules — the same functions Profile's editor uses.
  assert.ok(ROUTES.states.includes('update(withStates(prefs, codes))'));
  assert.ok(ROUTES.allergens.includes('update(toggleAllergen(prefs, token))'));
  assert.ok(ROUTES.allergens.includes('const next = clearAllergens(prefs);'));
  assert.ok(ROUTES.allergens.includes('if (next !== prefs) update(next);'));
  assert.ok(ROUTES.retailers.includes('update(toggleRetailer(prefs, id))'));
  // The selectors are the shared rules: States toggles through the state
  // selector's own `toggleStateCode`, and its chooser rows are the shared
  // `CheckRow` over the shared catalog.
  assert.ok(codeOnly(STATES).includes('onChange(toggleStateCode(draft, code))'));
  assert.ok(codeOnly(STATE_SHEET).includes('<CheckRow'));
  // Stores draws its own receipt rows and search; the shared store selector
  // stays Profile's (pinned below).
  assert.ok(ALLERGENS.includes('allergenGridRows(CONSUMER_ALLERGENS, columns).map((row) =>'));
  // The Preview summary reads the Profile card's own summary rule.
  assert.ok(PREVIEW.includes('summarizePreferences(prefs)'));
});

// ── Copy, verbatim ──────────────────────────────────────────────────────────

test('the founder’s onboarding copy, verbatim, rendered from the copy module', () => {
  // The receipt Welcome (2026-09-29).
  assert.equal(WORDMARK_LABEL, 'Lotly');
  assert.equal(WELCOME_HEADLINE, 'A closer look at your groceries.');
  assert.equal(WELCOME_BODY, 'Food recalls personalized just for you and your household.');
  assert.equal(WELCOME_EXAMPLE_CAPTION, 'Illustrative example, not a live recall.');
  assert.equal(
    WELCOME_ILLUSTRATION_LABEL,
    'Granola Bites. Critical. Possible Salmonella contamination. Nationwide. Marked Affects You.',
  );
  assert.equal(WELCOME_TRUST_NOTE, 'Built from FDA and USDA recall notices.');
  assert.equal(WELCOME_CTA, 'Get started');
  // The grocery-atlas States (2026-09-30).
  assert.equal(STATES_HEADLINE, 'Make it local.');
  assert.equal(STATES_BODY, 'Choose every state where you or your household buys food.');
  assert.equal(STATES_SEARCH_PLACEHOLDER, 'Search states');
  assert.equal(STATES_HELPER, 'Choose one or more states.');
  assert.equal(ALLERGENS_HEADLINE, 'Any allergens to watch?');
  assert.equal(
    ALLERGENS_BODY,
    'Select any that matter to you or your household. Leave this blank if none.',
  );
  // The receipt Stores (2026-09-30): the approved manifest's copy. The step
  // stays optional (Continue is never disabled); the sentence does not say so.
  assert.equal(RETAILERS_HEADLINE, 'Your regulars.');
  assert.equal(RETAILERS_BODY, 'Choose the stores where your household buys food.');
  assert.ok(!RETAILERS_BODY.includes('optional'));
  assert.equal(ONBOARDING_COPY.POPULAR_STORES_LABEL, 'Popular stores');
  assert.ok(!('NO_STORES_YET' in ONBOARDING_COPY), 'the empty summary came back');
  assert.equal(ONBOARDING_COPY.CLEAR_STORES_LABEL, 'Clear');
  assert.ok(
    !('SEARCH_ALL_STORES_PLACEHOLDER' in ONBOARDING_COPY),
    'the `Not listed?` search field came back',
  );
  assert.equal(ONBOARDING_COPY.SEARCH_ALL_STORES_LABEL, 'Search all stores');
  assert.match(ONBOARDING_COPY.SEARCH_ALL_STORES_HINT, /complete store list/);
  assert.equal(ONBOARDING_COPY.SEARCH_STORES_LABEL, 'Search stores');
  assert.equal(ONBOARDING_COPY.SEARCH_INSTRUCTION, 'Search the complete store list.');
  assert.equal(ONBOARDING_COPY.NO_STORES_FOUND, 'No stores found.');
  assert.equal(ONBOARDING_COPY.SEARCH_CLOSE_LABEL, 'Close');
  assert.equal(ONBOARDING_COPY.SEARCH_DONE_LABEL, 'Done');
  assert.ok(!('SEARCH_RESULTS_LABEL' in ONBOARDING_COPY), 'the upward panel’s header came back');
  assert.equal(ONBOARDING_COPY.searchResultsAnnouncement(0), 'No stores found.');
  assert.equal(ONBOARDING_COPY.searchResultsAnnouncement(1), '1 store found.');
  assert.equal(ONBOARDING_COPY.searchResultsAnnouncement(7), '7 stores found.');
  // The polish pass retired the summary and its chips; the quiet row counts.
  assert.equal(ONBOARDING_COPY.storesCountLabel(0), 'No stores selected');
  assert.equal(ONBOARDING_COPY.storesCountLabel(1), '1 store selected');
  assert.equal(ONBOARDING_COPY.storesCountLabel(4), '4 stores selected');
  // The receipt prints the short form; the spoken form stays the full one.
  assert.equal(ONBOARDING_COPY.storesCountShort(1), '1 selected');
  assert.equal(ONBOARDING_COPY.storesCountShort(2), '2 selected');
  for (const gone of ['yourStoresTitle', 'yourStoresSpoken', 'removeStoreLabel']) {
    assert.ok(!(gone in ONBOARDING_COPY), `the summary's ${gone} came back`);
  }
  assert.ok(!('BACK_TO_POPULAR_LABEL' in ONBOARDING_COPY), 'the All stores mode came back');
  assert.equal(CONTINUE_CTA, 'Continue');
  // The two problem screens (2026-09-28): the CDC's facts, verbatim, and no
  // unsupported recall statistic anywhere in the copy module.
  assert.equal(ONBOARDING_COPY.PROBLEM_SCALE_STAT, '1 in 6');
  assert.equal(
    ONBOARDING_COPY.PROBLEM_SCALE_HEADLINE,
    'Americans get sick from foodborne illness each year.',
  );
  assert.equal(ONBOARDING_COPY.PROBLEM_SCALE_BODY, 'That’s about 48 million people.');
  assert.equal(
    ONBOARDING_COPY.PROBLEM_SCALE_SPOKEN,
    '1 in 6 Americans get sick from foodborne illness each year.',
  );
  assert.equal(ONBOARDING_COPY.PROBLEM_RISK_HEADLINE, 'Some households face higher stakes.');
  // Polish pass: the fact said once — the four groups ARE the tiles, and
  // the body carries the CDC claim about them (meaning unchanged).
  assert.equal(
    ONBOARDING_COPY.PROBLEM_RISK_BODY,
    'These household members are more likely to become seriously ill from foodborne illness.',
  );
  assert.deepEqual(ONBOARDING_COPY.PROBLEM_RISK_GROUPS, [
    'Young children',
    'Pregnant people',
    'Adults 65 and older',
    'Weakened immune systems',
  ]);
  assert.equal(ONBOARDING_COPY.PROBLEM_SOURCE_NOTE, 'Source: CDC');
  // The pictograph's one spoken description (2026-09-28): the approved
  // composition's visualization, never six separate figures.
  assert.equal(ONBOARDING_COPY.PROBLEM_SCALE_FIGURES_LABEL, 'One out of six people highlighted.');
  for (const unsupported of ['6K products', '18 recalls', '25%']) {
    const module = readFileSync(join(SRC, 'lib', 'onboarding-copy.ts'), 'utf8');
    assert.ok(!module.includes(unsupported), `the copy claims ${unsupported}`);
  }
  // The Building step (2026-10-02): the approved headline and five stops,
  // truthful when nothing was chosen, `watch` only in the headline.
  assert.equal(ONBOARDING_COPY.BUILDING_HEADLINE, 'Getting your watch ready.');
  assert.equal(ONBOARDING_COPY.BUILDING_AREA_CAPTION, 'Searching recalls in your area…');
  assert.equal(ONBOARDING_COPY.buildingAllergensCaption(true), 'Checking for allergen matches…');
  assert.equal(
    ONBOARDING_COPY.buildingAllergensCaption(false),
    'Checking recalls across allergens…',
  );
  assert.equal(ONBOARDING_COPY.buildingStoresCaption(true), 'Checking recalls where you shop…');
  assert.equal(ONBOARDING_COPY.buildingStoresCaption(false), 'Checking recalls across stores…');
  assert.deepEqual(ONBOARDING_COPY.buildingMatchesParts(22), {
    before: 'Found ',
    number: '22',
    after: ' recalls for you.',
  });
  assert.deepEqual(ONBOARDING_COPY.buildingMatchesParts(1), {
    before: 'Found ',
    number: '1',
    after: ' recall for you.',
  });
  assert.equal(ONBOARDING_COPY.buildingMatchesParts(0).before, 'No matching recalls found.');
  assert.equal(ONBOARDING_COPY.BUILDING_FEED_CAPTION, 'Putting your personalized feed together…');
  assert.equal(ONBOARDING_COPY.BUILDING_DONE_CAPTION, 'Your personalized feed is ready.');
  for (const old of ['buildingStatesCaption', 'BUILDING_ACCESSIBILITY_LABEL']) {
    assert.ok(!(old in ONBOARDING_COPY), `the old checklist's ${old} survived`);
  }
  // The preference-board Ready (2026-09-30): the approved manifest's copy,
  // with no line under the headline and no merged purchase copy.
  assert.equal(PREVIEW_HEADLINE, 'You’re all set.');
  assert.ok(!('PREVIEW_BODY' in ONBOARDING_COPY), 'a line came back under the headline');
  assert.ok(!('PREVIEW_BODY_EMPTY' in ONBOARDING_COPY), 'a line came back under the headline');
  assert.equal(PREVIEW_SUMMARY_TITLE, 'Your preferences');
  // Profile's own row names, so the app says store; drawn in title case,
  // exactly as spoken (the 2026-10-01 refinement retired the capitals).
  assert.deepEqual(PREVIEW_SUMMARY_LABELS, {
    states: 'States',
    allergens: 'Allergens',
    retailers: 'Stores',
  });
  assert.ok(!('PREVIEW_BOARD_LABELS' in ONBOARDING_COPY), 'the spaced capitals came back');
  assert.equal(PREVIEW_MATCH_HEADING, 'Your recall preview');
  // The count line: singular for one, no `today`, the number its own piece.
  assert.equal(ONBOARDING_COPY.matchCountLabel(1), 'We found 1 recall for you.');
  assert.equal(ONBOARDING_COPY.matchCountLabel(3), 'We found 3 recalls for you.');
  assert.equal(ONBOARDING_COPY.matchCountLabel(21), 'We found 21 recalls for you.');
  assert.deepEqual(ONBOARDING_COPY.matchCountParts(21), {
    before: 'We found ',
    number: '21',
    after: ' recalls for you.',
  });
  assert.ok(!/today/i.test(ONBOARDING_COPY.matchCountLabel(2)));
  assert.equal(ONBOARDING_COPY.PREVIEW_LOCKED_STRIP, 'More matching recalls are locked');
  assert.equal(ONBOARDING_COPY.PREVIEW_EMPTY_TITLE, 'No matching recalls right now.');
  assert.equal(
    ONBOARDING_COPY.PREVIEW_MONITORING_NOTE,
    'We’ll keep checking as new recalls are announced.',
  );
  assert.equal(ONBOARDING_COPY.matchPositionLabel(1, 3), 'Match 1 of 3');
  assert.equal(PREVIEW_CTA, 'See my plan');
  assert.ok(!('PREVIEW_PLAN_HEADING' in ONBOARDING_COPY), 'the merged plan heading came back');
  assert.ok(!('PREVIEW_OFFER_HEADLINE' in ONBOARDING_COPY), 'the duplicate headline came back');
  assert.ok(!('PREVIEW_OFFER_BODY' in ONBOARDING_COPY), 'the duplicate sentence came back');
  assert.ok(!('PREVIEW_EXAMPLE_LABEL' in ONBOARDING_COPY), 'the example label came back');
  // The one-page editor (2026-09-30): the approved manifest's copy.
  assert.equal(ONBOARDING_COPY.EDIT_CANCEL, 'Cancel');
  assert.equal(ONBOARDING_COPY.EDIT_HEADLINE, 'Edit your preferences');
  assert.equal(ONBOARDING_COPY.EDIT_BODY, 'Adjust your watch, all in one place.');
  assert.equal(ONBOARDING_COPY.EDIT_STATES_HELPER, 'Choose at least one state.');
  assert.equal(ONBOARDING_COPY.EDIT_OPTIONAL, 'Optional');
  assert.equal(ONBOARDING_COPY.EDIT_ACTION, 'Edit');
  assert.equal(ONBOARDING_COPY.EDIT_ADD_ALLERGENS, 'Add allergens');
  assert.equal(ONBOARDING_COPY.EDIT_CAPTION, 'Your recall preview updates when you save.');
  assert.equal(ONBOARDING_COPY.EDIT_SAVE, 'Save changes');
  assert.equal(ONBOARDING_COPY.editSelectedCount(2), '2 selected');
  assert.equal(ONBOARDING_COPY.editSelectedCount(1), '1 selected');
  assert.equal(PREVIEW_EDIT, 'Edit preferences');
  assert.equal(
    INDEPENDENCE_NOTE,
    'Lotly is independent and is not affiliated with the FDA or USDA.',
  );
  assert.equal(EDUCATION_SUCCESS, 'Subscription active');
  // The approved phone-led screen (2026-10-03, source-kit LAYOUT_SPEC).
  assert.equal(EDUCATION_HEADLINE, 'Let the alerts come to you.');
  assert.equal(EDUCATION_BODY, 'New recalls and important updates, matched to your preferences.');
  assert.equal(EDUCATION_EXAMPLE_LABEL, 'Example notification');
  assert.equal(EDUCATION_CTA, 'Turn on notifications');
  assert.equal(EDUCATION_SECONDARY, 'Not now');
  assert.equal(EDUCATION_REASSURANCE, 'Recall alerts only. No marketing.');
  assert.equal(EDUCATION_FOOTNOTE, 'Change this anytime in Settings.');
  // The outcomes of Turn on notifications (2026-10-04), as the brief words them.
  assert.equal(ONBOARDING_COPY.EDUCATION_BLOCKED_TITLE, 'Notifications are turned off for Lotly.');
  assert.equal(ONBOARDING_COPY.EDUCATION_BLOCKED_BODY, 'Enable them in your device settings.');
  assert.equal(
    ONBOARDING_COPY.EDUCATION_BLOCKED_NOTICE,
    'Notifications are turned off for Lotly. Enable them in your device settings.',
  );
  assert.equal(ONBOARDING_COPY.EDUCATION_OPEN_SETTINGS, 'Open settings');
  assert.equal(ONBOARDING_COPY.EDUCATION_CONTINUE_WITHOUT, 'Continue without alerts');
  assert.equal(ONBOARDING_COPY.EDUCATION_FAILED_NOTICE, 'We couldn’t finish turning on alerts.');
  assert.equal(ONBOARDING_COPY.EDUCATION_TRY_AGAIN, 'Try again');
  assert.equal(PREFERENCES_SET_CONFIRMATION, 'Your preferences are set.');
  // Rendered from the module, not retyped: the screens carry the constants.
  for (const [name, source, constants] of [
    [
      'welcome',
      WELCOME,
      [
        'WELCOME_HEADLINE',
        'WELCOME_BODY',
        'WELCOME_ILLUSTRATION_LABEL',
        'WELCOME_EXAMPLE_CAPTION',
        'WELCOME_TRUST_NOTE',
        'WELCOME_CTA',
        'WORDMARK_LABEL',
      ],
    ],
    [
      'states',
      STATES,
      [
        'STATES_HEADLINE',
        'STATES_BODY',
        'STATES_SEARCH_PLACEHOLDER',
        'STATES_HELPER',
        'CONTINUE_CTA',
      ],
    ],
    [
      'allergens',
      ALLERGENS,
      ['ALLERGENS_HEADLINE', 'ALLERGENS_BODY', 'CONTINUE_CTA', 'CLEAR_SELECTION_LABEL'],
    ],
    [
      'retailers',
      RETAILERS,
      [
        'RETAILERS_HEADLINE',
        'RETAILERS_BODY',
        'CONTINUE_CTA',
        'CLEAR_STORES_LABEL',
        'POPULAR_STORES_LABEL',
        'SEARCH_ALL_STORES_LABEL',
      ],
    ],
    [
      'retailer search sheet',
      SEARCH_SHEET,
      [
        'SEARCH_ALL_STORES_LABEL',
        'SEARCH_STORES_LABEL',
        'SEARCH_INSTRUCTION',
        'NO_STORES_FOUND',
        'SEARCH_CLOSE_LABEL',
        'SEARCH_DONE_LABEL',
      ],
    ],
    [
      'problem screens',
      PROBLEM,
      [
        'PROBLEM_SCALE_STAT',
        'PROBLEM_SCALE_HEADLINE',
        'PROBLEM_SCALE_SPOKEN',
        'PROBLEM_SCALE_BODY',
        'PROBLEM_SCALE_FIGURES_LABEL',
        'PROBLEM_RISK_HEADLINE',
        'PROBLEM_RISK_BODY',
        'PROBLEM_SOURCE_NOTE',
        'CONTINUE_CTA',
      ],
    ],
    [
      'preview',
      PREVIEW,
      [
        'PREVIEW_HEADLINE',
        'PREVIEW_EDIT',
        'PREVIEW_MATCH_HEADING',
        'matchCountParts',
        'PREVIEW_CTA',
        'PREVIEW_NONE',
        'PREVIEW_SUMMARY_TITLE',
        'PREVIEW_SUMMARY_LABELS',
      ],
    ],
    [
      'editor',
      EDITOR,
      [
        'EDIT_CANCEL',
        'EDIT_HEADLINE',
        'EDIT_BODY',
        'EDIT_SECTION_LABELS',
        'editSelectedCount',
        'EDIT_STATES_HELPER',
        'EDIT_OPTIONAL',
        'EDIT_ACTION',
        'EDIT_ADD_ALLERGENS',
        'EDIT_CAPTION',
        'EDIT_SAVE',
      ],
    ],
    [
      'education',
      EDUCATION,
      [
        'EDUCATION_SUCCESS',
        'EDUCATION_HEADLINE',
        'EDUCATION_BODY',
        'EDUCATION_REASSURANCE',
        'EDUCATION_FOOTNOTE',
        'EDUCATION_EXAMPLE_LABEL',
        'EDUCATION_EXAMPLE_SPOKEN',
        'EDUCATION_EXAMPLE_TITLE',
        'EDUCATION_EXAMPLE_BODY',
        // The footer's words come through the outcomes leaf, phase by phase.
        'educationFooter',
      ],
    ],
    [
      'education outcomes',
      readFileSync(join(__dirname, '..', 'lib', 'notification-education-outcomes.ts'), 'utf8'),
      [
        'EDUCATION_CTA',
        'EDUCATION_CTA_HINT',
        'EDUCATION_BUSY',
        'EDUCATION_SECONDARY',
        'EDUCATION_SECONDARY_HINT',
        'EDUCATION_BLOCKED_NOTICE',
        'EDUCATION_OPEN_SETTINGS',
        'EDUCATION_OPEN_SETTINGS_HINT',
        'EDUCATION_CHECKING',
        'EDUCATION_FAILED_NOTICE',
        'EDUCATION_TRY_AGAIN',
        'EDUCATION_TRY_AGAIN_HINT',
        'EDUCATION_TRYING_AGAIN',
        'EDUCATION_CONTINUE_WITHOUT',
        'EDUCATION_CONTINUE_WITHOUT_HINT',
      ],
    ],
    ['feed', FEED, ['PREFERENCES_SET_CONFIRMATION']],
  ] as const) {
    for (const constant of constants) {
      assert.ok(codeOnly(source).includes(constant), `${name} does not render ${constant}`);
    }
  }
  assert.equal(ONBOARDING_COPY.PREVIEW_NONE, 'None');
});

// ── Ready: the preference board (2026-09-30) ────────────────────────────────

test('Ready draws the three approved layers whole, decorative, with the native rows between the board and the foreground', () => {
  const code = codeOnly(PREVIEW);
  for (const file of [
    'lotly-ready-preference-board-scene.png',
    'lotly-ready-preference-board-paper.png',
    'lotly-ready-preference-board-overlap.png',
  ]) {
    assert.ok(code.includes(`require('@/assets/brand/production/${file}')`), `Ready lost ${file}`);
  }
  // The trust-peek card mascot left with the old summary card.
  assert.ok(!code.includes('trust-peek'), 'the old Ready mascot came back');
  const hero = codeOnly(componentBody(PREVIEW, 'BoardHero'));
  // Order: the scene and the board, then the native rows, then the overlap,
  // so the mascot, bowl and cloth always stand in front of every row.
  const scene = hero.indexOf('source={SCENE}');
  const paper = hero.indexOf('source={PAPER}');
  const rows = hero.indexOf('{children}');
  const overlap = hero.indexOf('source={OVERLAP}');
  assert.ok(
    scene > 0 && scene < paper && paper < rows && rows < overlap,
    'the layer order changed',
  );
  // Every layer is decorative: never heard, never touched.
  assert.equal((hero.match(/\{\.\.\.DECORATIVE\}/g) ?? []).length, 2);
  const decorativeAt = code.indexOf('const DECORATIVE = {');
  const decorative = code.slice(decorativeAt, code.indexOf('} as const;', decorativeAt));
  for (const prop of [
    'accessible: false',
    'accessibilityElementsHidden: true',
    "importantForAccessibility: 'no-hide-descendants'",
    "pointerEvents: 'none'",
  ]) {
    assert.ok(decorative.includes(prop), `the layers lost ${prop}`);
  }
  // The rows sit in the report's content-safe rectangle.
  assert.ok(hero.includes('left: paperLeft + CONTENT_PX.left * scale,'));
  assert.ok(hero.includes('top: paperTop + CONTENT_PX.top * scale,'));
  assert.ok(hero.includes('width: boardColumnWidth(scale),'));
});

test('the board grows only through its paper slice and the thin wall band; its foot and the foreground move together', () => {
  const hero = codeOnly(componentBody(PREVIEW, 'BoardHero'));
  // One growth, applied to the scene's wall band and the board's slice alike.
  assert.ok(hero.includes('slice={WALL_BAND_PX}'));
  assert.ok(hero.includes('slice={PAPER_SLICE_PX}'));
  assert.equal((hero.match(/growth=\{growth\}/g) ?? []).length, 2);
  // The overlap moves down with everything below the band: it never moves
  // relative to the board's foot.
  assert.ok(hero.includes('top: OVERLAP_PX.top * scale + growth,'));
  assert.ok(hero.includes('height: SCENE_PX.height * scale + growth'));
  // Three pieces: rows above and below the slice 1:1, the slice stretched.
  const sliced = codeOnly(componentBody(PREVIEW, 'SlicedImage'));
  assert.ok(sliced.includes('resizeMode="stretch"'));
  assert.ok(sliced.includes('sliceImagePlacement(slice, imageRows)'));
  assert.equal((sliced.match(/<Image/g) ?? []).length, 3);
});

test('two illustrated boards chosen by measured fit; every preference always on the paper, never a separate card', () => {
  const step = codeOnly(componentBody(PREVIEW, 'PreviewStep'));
  assert.ok(
    step.includes('const resolved = measurement ? boardTemplate(measurement, scale) : null;'),
  );
  // The measurement: the same block three ways, hidden, untouchable, unheard.
  const measure = step.slice(step.indexOf('styles.measure') - 200, step.indexOf('styles.measure'));
  assert.ok(measure.includes('{...DECORATIVE}'), 'the measurement can be heard or touched');
  for (const variant of [
    "measureVariant('compact')",
    "measureVariant('wide')",
    "measureVariant('wideStacked')",
  ]) {
    assert.ok(step.includes(variant), `the measurement lost ${variant}`);
  }
  // Keyed by this content, width and text size; arrival shows nothing until it answers.
  assert.ok(
    step.includes(
      "const contentKey = [sceneWidth, fontScale, ...rows.map((row) => row.names.join(','))].join('|');",
    ),
  );
  // Revealed together with the chosen board's own artwork: the page shows once
  // each of that board's images has loaded (or failed), never on a timer.
  assert.ok(step.includes('<View style={revealed ? null : styles.unsettled}>'));
  assert.ok(
    /if \(!revealed && template && artLoads\[template\.kind\] >= heroImageCount\(template, scale\)\)\s+setRevealed\(true\);/.test(
      step,
    ),
  );
  assert.ok(
    !/setTimeout|requestAnimationFrame|InteractionManager/.test(step),
    'the reveal waits on a timer',
  );
  assert.equal((codeOnly(PREVIEW).match(/onLoadEnd=\{onArt\}/g) ?? []).length, 10);
  // The rows are always on one of the two boards: the full-width card is gone.
  assert.ok(step.includes("{template?.kind === 'wide' ? ("));
  assert.ok(
    step.includes(
      "<WideBoardHero width={sceneWidth} growth={template.growth} onArt={onArt('wide')}>",
    ),
  );
  assert.ok(
    step.includes(
      "<BoardHero width={sceneWidth} growth={template?.growth ?? 0} onArt={onArt('compact')}>",
    ),
  );
  // The wide board grows by where each drawn piece of the block actually sits.
  assert.ok(codeOnly(PREVIEW).includes('measureLayout(root'));
  assert.ok(!codeOnly(PREVIEW).includes('stackedCard'), 'the separate card came back');
  assert.ok(!codeOnly(PREVIEW).includes("'stacked' ? ("), 'the separate card came back');
  // The superseded workaround is gone: no tiled strip, no arrangement scoring.
  for (const gone of ['sliceTileCount', 'boardPlan', 'PAPER_SLICE_MAX_STRETCH', 'blockWidths']) {
    assert.ok(!codeOnly(PREVIEW).includes(gone), `${gone} came back`);
  }
  // The page always scrolls above the pinned action: nothing is capped.
  assert.ok(step.includes('<ScrollView'));
  for (const banned of ['maxFontSizeMultiplier', 'numberOfLines', 'adjustsFontSizeToFit']) {
    assert.ok(!codeOnly(PREVIEW).includes(banned), `Ready uses ${banned}`);
  }
});

test('the wide board: its approved layers in order, the native block between paper and foreground, growth by plates and feathers', () => {
  const code = codeOnly(PREVIEW);
  for (const file of [
    'scene',
    'paper',
    'overlap',
    'paper-extension',
    'wall-extension',
    'paper-feather',
    'wall-feather',
  ]) {
    assert.ok(
      code.includes(`require('@/assets/brand/production/lotly-ready-wide-board-${file}.png')`),
      `Ready lost ${file}`,
    );
  }
  const hero = codeOnly(componentBody(PREVIEW, 'WideBoardHero'));
  const scene = hero.indexOf('source={WIDE.scene}');
  const paper = hero.indexOf('source={WIDE.paper}');
  const rows = hero.indexOf('{children}');
  const overlap = hero.indexOf('source={WIDE.overlap}');
  assert.ok(
    scene > 0 && scene < paper && paper < rows && rows < overlap,
    'the layer order changed',
  );
  assert.equal((hero.match(/\{\.\.\.DECORATIVE\}/g) ?? []).length, 2);
  // The native block sits in the report's text region; the foreground moves down with growth.
  assert.ok(hero.includes('left: paperLeft + WIDE_TEXT_PX.left * scale,'));
  assert.ok(hero.includes('top: paperTop + WIDE_TEXT_PX.top * scale,'));
  assert.ok(hero.includes('width: wideTextWidth(scale),'));
  assert.ok(hero.includes('top: WIDE_OVERLAP_PX.top * scale + growth,'));
  assert.ok(hero.includes('height: WIDE_SCENE_PX.height * scale + growth'));
  // Each layer: rows above the insertion, the plate (mirrored past its height), the feather, the rest.
  const layer = codeOnly(componentBody(PREVIEW, 'GrownLayer'));
  assert.ok(layer.includes('plateCopies(plateSpan / scale)'));
  assert.ok(layer.includes('index % 2 === 1 && styles.mirrored'));
  assert.ok(layer.includes('source={feather}'));
  assert.ok(!layer.includes('resizeMode="stretch"'), 'the wide board stretches');
});

test('the board: three rows in order, each heard once with every chosen name; the plates and rules never are', () => {
  const step = codeOnly(componentBody(PREVIEW, 'PreviewStep'));
  const order = ["key: 'states'", "key: 'allergens'", "key: 'retailers'"].map((k) =>
    step.indexOf(k),
  );
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2]);
  // The rows read the Profile card's own summary, so the two cannot disagree.
  assert.ok(step.includes('summarizePreferences(prefs)'));
  const row = codeOnly(componentBody(PREVIEW, 'BoardRow'));
  assert.ok(
    row.includes(
      'accessible\n      accessibilityLabel={boardRowLabel(label, names, PREVIEW_NONE)}>',
    ),
  );
  assert.ok(row.includes('const value = boardValue(names, PREVIEW_NONE);'));
  assert.ok(row.includes('text={value}'));
  // The label: the copy module's title-case name, in Public Sans SemiBold
  // (`body-small-bold`) at Ready's 14pt, with no letter spacing of its own.
  assert.ok(
    row.includes(
      'text={label}\n          variant="body-small-bold"\n          color="text/secondary"\n          style={READY_TYPE.label}',
    ),
  );
  assert.ok(
    row.includes('text={value}\n          variant="body"\n          style={READY_TYPE.value}'),
  );
  assert.ok(!codeOnly(PREVIEW).includes('letterSpacing'));
  assert.ok(/<Piece[^>]*style=\{styles\.well\}[^>]*decorative>/.test(row));
  assert.ok(codeOnly(componentBody(PREVIEW, 'DashedRule')).includes('decorative'));
  assert.ok(
    codeOnly(componentBody(PREVIEW, 'Piece')).includes('{...(decorative ? DECORATIVE : null)}'),
  );
  const content = codeOnly(componentBody(PREVIEW, 'BoardContent'));
  assert.ok(content.includes('accessibilityRole="header"'));
  assert.ok(content.includes('text={PREVIEW_SUMMARY_TITLE}'));
  // Edit preferences: blue words and a chevron, a 44pt target by hitSlop.
  assert.ok(content.includes('accessibilityLabel={PREVIEW_EDIT}'));
  assert.ok(content.includes('accessibilityHint={PREVIEW_EDIT_HINT}'));
  assert.ok(content.includes('hitSlop={EDIT_HIT_SLOP}'));
  assert.ok(content.includes('<Icon name="chevron-right" size={16} color="icon/brand" />'));
  assert.ok(codeOnly(PREVIEW).includes('hitSlopToMinimum(READY_TYPE.edit.lineHeight)'));
});

test('the Allergens plate draws at most two approved pictograms untinted, and the neutral dash for none', () => {
  const plate = codeOnly(componentBody(PREVIEW, 'AllergenPlate'));
  assert.ok(plate.includes("if (artwork.kind === 'none') return <View style={styles.dash} />;"));
  assert.ok(plate.includes('const [first, second] = artwork.tokens;'));
  assert.ok(!plate.includes('accessibilityLabel'));
  const pictogram = codeOnly(componentBody(PREVIEW, 'Pictogram'));
  assert.ok(pictogram.includes('source={allergenPictogram(token) ?? undefined}'));
  assert.ok(!pictogram.includes('tintColor'), 'the pictograms are tinted');
  // The step reads the pictograms through the shared selection rule.
  assert.ok(codeOnly(PREVIEW).includes('allergenArtwork(prefs.allergens)'));
});

test('Ready: Back, Edit preferences (the one-page editor), See my plan and the resume point', () => {
  const route = codeOnly(ROUTES.preview);
  assert.ok(route.includes("void access.recordShownStep('preview');"));
  assert.ok(route.includes('router.push(EDIT_PREFERENCES_ROUTE);'));
  assert.ok(!route.includes("onboardingRoute('states')"), 'Edit preferences replays States');
  assert.ok(route.includes("onBack={() => goBackFrom('preview', router)}"));
  assert.ok(route.includes("onSeePlan={() => router.push(onboardingRoute('paywall'))}"));
  assert.ok(route.includes('const prefs = presentedPreferences(load.prefs);'));
  assert.ok(route.includes('prefs={prefs}'));
  // Back from the editor, focus returns to Edit preferences.
  assert.ok(route.includes('AccessibilityInfo.setAccessibilityFocus(tag)'));
  assert.ok(route.includes('editRef={editRef}'));
  // The preview is the REAL feed through the REAL matching layer, opening on
  // the corpus the Building step counted (2026-10-02).
  assert.ok(route.includes('const feed = useFeed({ reuseRecent: true });'));
  assert.ok(route.includes('buildReadyPreview(feedInput, prefs, todayIso())'));
  // Arriving from Building: the choices it just read, no pending flash.
  assert.ok(route.includes('useOnboardingPreferences({ reuseLoaded: true })'));
  assert.ok(!route.includes('usePurchaseFlow'), 'Ready grew purchase machinery back');
  const step = codeOnly(componentBody(PREVIEW, 'PreviewStep'));
  // Back, and no progress bar.
  assert.ok(step.includes('back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}'));
  assert.ok(step.includes('progress={null}'));
  // No body line, no purchase UI, no example card, no old summary card.
  for (const gone of [
    'PREVIEW_BODY',
    'SampleRecallCard',
    'usePurchaseFlow',
    'PurchasePlans',
    'PAYWALL_BENEFITS',
    'INDEPENDENCE_NOTE',
    'relevancePalette',
    'TrustPeek',
    'checkCircle',
  ]) {
    assert.ok(!codeOnly(PREVIEW).includes(gone), `Ready draws ${gone}`);
  }
  // The step reads the saved preferences and never writes them.
  for (const forbidden of ['savePreferences', 'commitPreferences', 'useOnboardingPreferences']) {
    assert.ok(!codeOnly(PREVIEW).includes(forbidden), `the step reaches ${forbidden}`);
  }
});

test('the preview: the true count in one muted sentence, the deck, the honest strip or line, and See my plan pinned', () => {
  const step = codeOnly(componentBody(PREVIEW, 'PreviewStep'));
  // The count is every real match, in one sentence of plain text, never a
  // pill or a button; only the number is emphasised.
  assert.ok(step.includes('const count = previewMatchCount(preview);'));
  assert.ok(step.includes('{count !== null ? <CountLine count={count} /> : null}'));
  const line = codeOnly(componentBody(PREVIEW, 'CountLine'));
  assert.ok(
    line.includes(
      '<Text variant="body" color="text/secondary">\n      {parts.before}\n      <Text variant="body" style={styles.countNumber}>\n        {parts.number}\n      </Text>\n      {parts.after}\n    </Text>',
    ),
  );
  assert.ok(!line.includes('Pressable') && !line.includes('Surface'), 'the count became a control');
  assert.ok(
    !step.includes('models.length > 0 ? preview.models.length'),
    'the count is the deck again',
  );
  // The deck for real matches (imaged or not); the strip only when more
  // real matches exist; otherwise the truthful line; the honest card for
  // checking and none. Nothing fallback-specific: the baseline corpus goes
  // through the same screen (founder, 2026-10-04).
  assert.ok(step.includes("{preview.kind === 'matches' ? ("));
  assert.ok(step.includes('{hasLockedMatches(preview) ? ('));
  assert.ok(step.includes('{PREVIEW_MONITORING_NOTE}'));
  for (const title of ['PREVIEW_CHECKING_TITLE', 'PREVIEW_EMPTY_TITLE']) {
    assert.ok(step.includes(title));
  }
  for (const gone of ['Try again', 'Last checked', 'Example recalls', 'onRetry', 'stale']) {
    assert.ok(!codeOnly(PREVIEW).includes(gone), `Ready still carries ${gone}`);
  }
  // See my plan: the one pinned action, opening the separate paywall.
  assert.ok(step.includes('<SeeMyPlan onPress={onSeePlan} />'));
  const cta = codeOnly(componentBody(PREVIEW, 'SeeMyPlan'));
  assert.ok(cta.includes('{PREVIEW_CTA}'));
  assert.ok(cta.includes('accessibilityRole="button"'));
});

// ── Edit preferences: one page (2026-09-30) ─────────────────────────────────

test('the editor edits ONE draft through the existing choosers, which save nothing of their own', () => {
  const step = codeOnly(componentBody(EDITOR, 'EditPreferencesStep'));
  // States and Stores: the existing search sheets, handed the draft and its toggles.
  assert.ok(step.includes('<StateSearchSheet'));
  assert.ok(step.includes('selected={draft.states}'));
  assert.ok(step.includes('onToggle={onToggleState}'));
  assert.ok(step.includes('<RetailerSearchSheet\n        catalog'));
  assert.ok(step.includes('selected={draft.retailers}'));
  assert.ok(step.includes('onToggle={onToggleStore}'));
  // Allergens: the Allergens step's own grid, in its sheet.
  assert.ok(step.includes('<AllergenChooserSheet'));
  assert.ok(step.includes('selected={draft.allergens}'));
  assert.ok(
    codeOnly(CHOOSER).includes(
      '<AllergenGrid selected={selected} onToggle={onToggle} onClear={onClear} />',
    ),
  );
  // Both allergen actions open the SAME chooser.
  assert.equal((step.match(/openChooser\('allergens'/g) ?? []).length, 2);
  // Nothing on the page, in the chooser or in the sheets it mounts writes the store.
  for (const source of [EDITOR, CHOOSER, STATE_SHEET, SEARCH_SHEET]) {
    for (const forbidden of [
      'savePreferences',
      'commitPreferences',
      'useOnboardingPreferences',
      'preferences-store',
    ]) {
      assert.ok(!codeOnly(source).includes(forbidden), `a chooser reaches ${forbidden}`);
    }
  }
});

test('the editor route reads once, commits once through the canonical store, and returns to Ready', () => {
  const route = codeOnly(ROUTES.editPreferences);
  assert.ok(route.includes('setState(beginEditing(saved))'));
  // The one save: the canonical store's local-first commit, latched against a double tap.
  assert.equal((route.match(/commitPreferences\(/g) ?? []).length, 1);
  assert.ok(route.includes('if (state === null || saving.current) return;'));
  assert.ok(route.includes('const request = saveRequest(state);'));
  // Success leaves only while the page is still on screen (2026-10-04).
  assert.ok(route.includes('if (focused.current) router.back();'));
  // A failure releases the latch, keeps the page and says so.
  assert.ok(route.includes("dispatch({ type: 'save-failed' });"));
  assert.ok(route.includes('saving.current = false;'));
  assert.ok(route.includes('AccessibilityInfo.announceForAccessibility(EDIT_SAVE_FAILED);'));
  // Cancel discards: back to Ready, nothing written — and locked for the
  // milliseconds a save is in flight (2026-10-04), hardware back included.
  assert.ok(route.includes('onCancel={cancel}'));
  assert.ok(route.includes('if (!saving.current) router.back();'));
  assert.ok(route.includes("BackHandler.addEventListener('hardwareBackPress'"));
  assert.ok(route.includes('loadPreferencesSettled().then('));
  // Not a step: no resume point, no building interstitial, no other step.
  for (const forbidden of [
    'recordShownStep',
    'onboardingRoute',
    'watchBuilt',
    'completePersonalization',
  ]) {
    assert.ok(!route.includes(forbidden), `the editor reaches ${forbidden}`);
  }
});

test('the editor is a full-screen modal over Ready in the onboarding group, never a step', () => {
  const layout = codeOnly(read('app', '_layout.tsx'));
  assert.ok(layout.includes("presentation: 'fullScreenModal', gestureEnabled: false"));
  assert.ok(layout.includes('name === EDIT_PREFERENCES_SCREEN'));
  assert.ok(!(ONBOARDING_STEPS as readonly string[]).includes('edit-preferences'));
});

test('Save changes is disabled with its reason while no state is chosen, and every target is 44pt and distinct', () => {
  const step = codeOnly(componentBody(EDITOR, 'EditPreferencesStep'));
  assert.ok(step.includes('<SaveButton disabled={!canSave} busy={saving} onPress={onSave} />'));
  const save = codeOnly(componentBody(EDITOR, 'SaveButton'));
  assert.ok(save.includes('accessibilityHint={disabled ? EDIT_SAVE_NEEDS_STATE : EDIT_SAVE_HINT}'));
  assert.ok(save.includes('accessibilityState={{ disabled, busy }}'));
  assert.ok(save.includes('disabled={disabled || busy}'));
  // Chips: 32pt drawn, 44pt by vertical hitSlop, rows further apart than the slops meet.
  const pill = codeOnly(componentBody(EDITOR, 'ChipPill'));
  assert.ok(pill.includes('hitSlop={{ top: CHIP_SLOP, bottom: CHIP_SLOP }}'));
  assert.ok(pill.includes('accessibilityLabel={removeChipLabel(chip.name)}'));
  assert.ok(codeOnly(EDITOR).includes('const CHIP_SLOP = (hitTarget.minimum - CHIP_HEIGHT) / 2;'));
  assert.ok(codeOnly(EDITOR).includes('rowGap: CHIP_ROW_GAP,'));
  // At the accessibility sizes: full-width rows with their own 44pt Remove.
  const row = codeOnly(componentBody(EDITOR, 'ChipRow'));
  assert.ok(row.includes('accessibilityLabel={removeChipLabel(chip.name)}'));
  assert.ok(row.includes('style={({ pressed }) => [styles.remove, pressed && styles.pressed]}'));
  // Edit, Add allergens and Cancel are 44pt boxes.
  for (const style of ['edit', 'add', 'cancel']) {
    const body = codeOnly(EDITOR).slice(codeOnly(EDITOR).indexOf(`  ${style}: {`));
    assert.ok(
      body.slice(0, body.indexOf('},')).includes('minHeight: hitTarget.minimum'),
      `${style} is under 44pt`,
    );
  }
});

test('the editor’s artwork and mini mascot are decorative; focus returns to the opening action', () => {
  const code = codeOnly(EDITOR);
  assert.ok(
    code.includes("require('@/assets/brand/production/lotly-ready-preferences-mini-mascot.png')"),
  );
  const section = codeOnly(componentBody(EDITOR, 'Section'));
  assert.ok(
    section.includes(
      '<View {...DECORATIVE} style={rows ? styles.iconStacked : styles.iconColumn}>',
    ),
  );
  assert.ok(section.includes('accessibilityRole="header"'));
  // The allergen artwork follows the DRAFT.
  assert.ok(code.includes('<AllergenMark tokens={draft.allergens} />'));
  const step = codeOnly(componentBody(EDITOR, 'EditPreferencesStep'));
  assert.ok(step.includes('AccessibilityInfo.setAccessibilityFocus(tag)'));
  assert.equal((step.match(/onClosed=\{refocus\}/g) ?? []).length, 3);
});

// ── The permission rule ─────────────────────────────────────────────────────

test('the notification permission is reachable from the education primary action alone — never on mount, never from Not now', () => {
  const route = codeOnly(ROUTES.education);
  // The one enable path — the two ports shared with the Notifications screen
  // — is handed to the choices' leaf once, through `educationEnablePorts`
  // (the real ports, or the Design Preview's stand-ins in development).
  // Which choice reaches it, that Not now completes without reading, asking
  // or registering, and every outcome, is proven behaviourally
  // (lib/notification-education-actions.test.ts).
  assert.equal((route.match(/educationEnablePorts\(\)/g) ?? []).length, 1);
  assert.ok(route.includes('resolvePermission: async () => (await ports).resolvePermission(),'));
  assert.ok(route.includes('register: async (signal) => (await ports).register(signal),'));
  assert.ok(
    !route.includes('enableRecallAlerts'),
    'the route goes through the ports, not the screen path',
  );
  assert.ok(!route.includes('useFocusEffect'), 'nothing runs on focus');
  // The ONE effect subscribes to the app state and forwards `active` to the
  // leaf's `resume`, which reads the permission only after the shopper
  // opened Settings from the enable flow (proven in the leaf's tests).
  assert.equal(
    (route.match(/useEffect\(/g) ?? []).length,
    1,
    'one effect: the app-state subscription',
  );
  assert.match(
    route,
    /AppState\.addEventListener\('change', \(status\) => \{\s*if \(status === 'active'\) actions\.current\?\.resume\(\);/,
  );
  assert.ok(route.includes('onEnable={() => void ready().enable()}'));
  assert.ok(route.includes('onSkip={() => void ready().skip()}'));
  assert.ok(route.includes('onOpenSettings={() => ready().openSettings()}'));
  assert.ok(route.includes('openSettings: () => void Linking.openSettings(),'));
  assert.ok(!route.includes('getAlertStatus'), 'the route reads the permission');
  assert.ok(!route.includes('getPermissionsAsync'), 'the route reads the permission itself');
  // Every completing path goes through the one completion, so the gate —
  // and the Feed's one-time notice — see exactly one completion.
  assert.equal((route.match(/access\.completeNotificationEducation\(\)/g) ?? []).length, 1);
  const actions = codeOnly(
    readFileSync(join(__dirname, '..', 'lib', 'notification-education-actions.ts'), 'utf8'),
  );
  assert.ok(
    !/^import (?!type )/m.test(actions),
    'the choices reach nothing of their own (a type import only)',
  );
  // The component itself imports no permission API.
  const component = codeOnly(EDUCATION);
  for (const forbidden of [
    'push-registration',
    'expo-notifications',
    'requestPermissions',
    'getPermissions',
  ]) {
    assert.ok(!component.includes(forbidden), `the education screen reaches ${forbidden}`);
  }
  // No other onboarding route or the paywall touches the permission.
  for (const [name, source] of Object.entries(ROUTES)) {
    if (name === 'education') continue;
    for (const forbidden of ['enableRecallAlerts', 'requestPermissions', 'push-registration']) {
      assert.ok(!source.includes(forbidden), `${name} reaches ${forbidden}`);
    }
  }
  // Push DELIVERY stays inactive: nothing in the flow names the activation
  // switch, a delivery job, or the transport.
  for (const [name, source] of [
    ['education route', ROUTES.education],
    ['education', EDUCATION],
    ['paywall route', ROUTES.paywall],
  ] as const) {
    for (const forbidden of [
      'push:activate',
      'push-activate',
      'activatePush',
      'jobs:push',
      'expo-transport',
      '@/server',
    ]) {
      assert.ok(!source.includes(forbidden), `${name} reaches ${forbidden}`);
    }
  }
});

test('the Feed shows the one-time confirmation once, taken from the gate, without announcing it as a refresh', () => {
  const feed = codeOnly(FEED);
  assert.ok(feed.includes('if (consumePreferencesSetNotice()) setPreferencesSet(true);'));
  // Keyed to the stable taker: the foreground entitlement refresh (closing the
  // notification prompt is one) must not re-run the effect and clear it.
  assert.ok(feed.includes('}, [consumePreferencesSetNotice]),'));
  assert.ok(feed.includes('return () => setPreferencesSet(false);'));
  assert.ok(feed.includes('<Callout tone="information">{PREFERENCES_SET_CONFIRMATION}</Callout>'));
});

// ── The example card ────────────────────────────────────────────────────────

test('the example card is the shared card surface over static content, marked as an example, opening nothing', () => {
  const sample = codeOnly(SAMPLE);
  assert.ok(sample.includes('<RecallCardSurface'));
  assert.ok(sample.includes('model={SAMPLE_RECALL_MODEL}'));
  assert.ok(sample.includes('trailing={null}'));
  for (const forbidden of [
    '<Link',
    'router.',
    'SaveRecallButton',
    'useSavedRecalls',
    'fetch',
    'uri:',
  ]) {
    assert.ok(!sample.includes(forbidden), `the example card ${forbidden}`);
  }
  assert.ok(sample.includes("require('@/assets/onboarding/sample-gummy-products.png')"));
  assert.equal(SAMPLE_RECALL_MODEL.productName, 'Gummy Products');
  assert.equal(SAMPLE_RECALL_MODEL.reasonLine, 'Undeclared peanut allergen');
  assert.equal(SAMPLE_RECALL_MODEL.locationSummary, 'Nationwide');
  assert.equal(SAMPLE_RECALL_MODEL.affectsYou, true);
  assert.equal(SAMPLE_RECALL_MODEL.risk.tier, 'critical');
  assert.equal(SAMPLE_RECALL_MODEL.risk.badgeLabel, 'CRITICAL');
  assert.equal(SAMPLE_RECALL_MODEL.activity.text, 'Example');
  assert.equal(SAMPLE_RECALL_MODEL.brand.text, 'Example, not a live recall');
  assert.equal(SAMPLE_RECALL_MODEL.heroImageUrl, null, 'the sample fetches no image');
  assert.equal(SAMPLE_RECALL_MODEL.id, 'onboarding-sample');
  // Since the receipt Welcome (2026-09-29) no screen draws it: Welcome's
  // example is the approved illustration, and Ready never had it back.
  assert.ok(!codeOnly(WELCOME).includes('SampleRecallCard'));
  assert.ok(!codeOnly(PREVIEW).includes('SampleRecallCard'));
});

// ── Drawn from the system ───────────────────────────────────────────────────

test('every onboarding screen draws from the tokens: no raw hex, no capped type, no fixed height around text', () => {
  for (const [name, source] of [
    ['frame', FRAME],
    ['welcome', WELCOME],
    ['states', STATES],
    ['states chooser', STATE_SHEET],
    ['allergens', ALLERGENS],
    ['retailers', RETAILERS],
    ['preview', PREVIEW],
    ['education', EDUCATION],
    ['sample', SAMPLE],
    ['panel', PANEL],
    ['state map', STATE_MAP],
    ['progress', PROGRESS],
  ] as const) {
    const code = codeOnly(source);
    assert.doesNotMatch(code, /#[0-9A-Fa-f]{6}\b/, `${name} carries a raw colour`);
    assert.ok(!code.includes('maxFontSizeMultiplier'), `${name} caps Dynamic Type`);
    assert.ok(!code.includes('numberOfLines'), `${name} truncates copy`);
    // A fixed height on anything text-sized is refused; the two decorative
    // marks (the benefit dot, the notification preview's icon square) are
    // well under any line box.
    assert.doesNotMatch(code, /\n\s+height: ([4-9]\d|\d{3,}),/, `${name} fixes a height`);
    assert.ok(!code.includes('LinearGradient'), `${name} uses a gradient`);
    assert.ok(code.includes("from '@/constants/design-tokens'"), `${name} skips the tokens`);
  }
  // Safe areas and the sticky footer belong to the frame; the keyboard lifts it.
  const frame = codeOnly(FRAME);
  assert.ok(frame.includes('useSafeAreaInsets()'));
  assert.ok(frame.includes('paddingBottom: insets.bottom + spacing[12]'));
  assert.ok(frame.includes('<KeyboardAvoidingView behavior="padding"'));
  assert.ok(frame.includes('keyboardShouldPersistTaps="handled"'));
  assert.ok(frame.includes('minHeight: hitTarget.minimum'));
  // Lime is reserved: the education's success mark and the value badge use the accent surface, nothing else on these screens does.
  assert.ok(codeOnly(EDUCATION).includes("backgroundColor: color['background/accent']"));
  assert.ok(codeOnly(ONBOARDING_PANEL).includes("backgroundColor: color['background/accent']"));
  for (const [name, source] of [
    ['welcome', WELCOME],
    ['states', STATES],
    ['allergens', ALLERGENS],
    ['retailers', RETAILERS],
    ['preview', PREVIEW],
  ] as const) {
    assert.ok(!codeOnly(source).includes('background/accent'), `${name} borrows lime`);
  }
});

// ── Welcome: the approved receipt composition (2026-09-29) ─────────────────

test('Welcome draws exactly the two approved receipt images, whole, and bundles no reference material', () => {
  const code = codeOnly(WELCOME);
  const requires = code.match(/require\('[^']+'\)/g) ?? [];
  assert.deepEqual(requires, [
    "require('@/assets/brand/production/lotly-wordmark-welcome-receipt.png')",
    "require('@/assets/brand/production/lotly-welcome-receipt-scene.png')",
  ]);
  // The old Welcome art is gone: no M01 peek, no example card.
  assert.ok(!code.includes('lotly-mascot-welcome-peek-1024.png'), 'M01 came back');
  assert.ok(!code.includes('SampleRecallCard'), 'the example card came back');
  // No reference target, source crop, report or comparison sheet at runtime.
  for (const forbidden of [
    'brand/reference',
    'lotly-onboarding-welcome-receipt',
    '-source.png',
    'asset-report',
    'comparison',
  ]) {
    assert.ok(!code.includes(forbidden), `Welcome imports ${forbidden}`);
  }
  // Drawn whole at their own aspect ratios: contain, never cover or stretch,
  // never tinted or faded, each image filling a box given a width and ratio.
  assert.equal((code.match(/<Image\b/g) ?? []).length, 2);
  assert.equal((code.match(/resizeMode="contain"/g) ?? []).length, 2);
  for (const forbidden of ['cover', 'stretch', 'tintColor', 'LinearGradient']) {
    assert.ok(!code.includes(forbidden), `Welcome uses ${forbidden}`);
  }
  // Never faded: the only opacity is the action's pressed state.
  assert.ok(!codeOnly(componentBody(WELCOME, 'WelcomeContent')).includes('opacity'));
  assert.equal((code.match(/opacity/g) ?? []).length, 1);
  assert.ok(code.includes('aspectRatio: WORDMARK_PX.width / WORDMARK_PX.height'));
  assert.ok(code.includes('aspectRatio: HERO_PX.width / HERO_PX.height'));
  // Never on a dark or coloured surface: the cream page only.
  assert.ok(code.includes('<Surface background="background/page"'));
  assert.ok(!code.includes('background/brand'));
});

test('Welcome speaks the wordmark and the illustration once each, and its printed marks are not controls', () => {
  const welcome = codeOnly(componentBody(WELCOME, 'WelcomeContent'));
  // Each image is one named element (the box), the pixels themselves hidden.
  for (const label of ['WORDMARK_LABEL', 'WELCOME_ILLUSTRATION_LABEL']) {
    const at = welcome.indexOf(`accessibilityLabel={${label}}`);
    assert.ok(at > 0, `${label} is not spoken`);
    const box = welcome.slice(welcome.lastIndexOf('<View', at), at);
    assert.ok(box.includes('accessible') && box.includes('accessibilityRole="image"'));
  }
  assert.equal((welcome.match(/<Image \{\.\.\.DRAWING\}/g) ?? []).length, 2);
  // The caption is the scene's SIBLING, so it is heard right after it and
  // never folded into the image's name.
  const scene = welcome.indexOf('accessibilityLabel={WELCOME_ILLUSTRATION_LABEL}');
  const sceneEnd = welcome.indexOf('</View>', scene);
  assert.ok(welcome.indexOf('{caption}', sceneEnd) > sceneEnd);
  // The illustration carries no press handler, link or action of any kind:
  // the printed flag, pin and bookmark are drawing. The one control is Get started.
  for (const forbidden of ['Pressable', 'onPress={() =>', 'accessibilityActions', 'Link']) {
    assert.ok(!welcome.includes(forbidden), `Welcome renders ${forbidden}`);
  }
  assert.equal((welcome.match(/<GetStarted /g) ?? []).length, 1);
  assert.ok(!welcome.includes('<Button '));
  // One promise, one example, one action: the benefit rows stay gone, and the
  // paywall owns its benefits.
  assert.ok(!('WELCOME_BENEFITS' in ONBOARDING_COPY), 'the Welcome benefits came back');
  assert.ok(!welcome.includes('BenefitList') && !welcome.includes('accessibilityRole="list"'));
  assert.ok(ONBOARDING_PANEL.includes('{ONBOARDING_PAYWALL_BENEFITS.map((benefit) => ('));
  // The headline is the screen's header; all copy is native, uncapped text.
  assert.ok(
    welcome.includes('<Text variant="display" accessibilityRole="header" style={styles.headline}>'),
  );
  assert.ok(welcome.includes('{WELCOME_BODY}'));
  assert.ok(welcome.includes('{WELCOME_TRUST_NOTE}'));
  assert.ok(welcome.includes('{WELCOME_EXAMPLE_CAPTION}'));
});

test('the receipt layout rules: images scale with the width, the column keeps the reference breaks, the caption overlays only where it fits', () => {
  // Both images are 1:1 crops of the 852px target: at 393pt the hero is 424.4pt.
  assert.deepEqual(WORDMARK_PX, { width: 395, height: 200 });
  assert.deepEqual(HERO_PX, { width: 852, height: 920 });
  assert.ok(Math.abs(heroHeight(393) - 424.37) < 0.01);
  // Welcome's own type (fidelity pass): the target's sizes and leading.
  assert.deepEqual(WELCOME_TYPE, {
    headline: { fontSize: 36, lineHeight: 36 },
    body: { fontSize: 18, lineHeight: 23 },
    cta: { fontSize: 18, lineHeight: 25 },
  });
  assert.equal(CTA_MIN_HEIGHT, 51);
  // The column: wider than `A closer look at` at 36pt (263.6pt by the font's
  // advances) and narrower than `Food recalls personalized just for` at
  // 18pt (277.3pt); it grows with the text scale.
  assert.equal(TEXT_MEASURE, 270);
  assert.equal(textMeasure(1), 270);
  assert.equal(textMeasure(2), 540);
  // At accessibility sizes the text takes the page margin, never the inset.
  assert.equal(TEXT_FULL_WIDTH_AT_SCALE, 1.5);
  assert.equal(textFullWidth(1), false);
  assert.equal(textFullWidth(1.353), false, 'XXXL keeps the composition inset');
  assert.equal(textFullWidth(3.571), true, 'AX5');
  // The caption band is centred on the target's caption row, inside the
  // quiet counter below the receipt (its lowest tip is row 784).
  const band = captionBand();
  const centre = ((band.top + band.height / 2) / 100) * HERO_PX.height;
  assert.ok(Math.abs(centre - CAPTION_CENTRE_PX) < 1e-9);
  assert.ok(QUIET_BAND_PX.top > 784 && QUIET_BAND_PX.bottom < HERO_PX.height);
  assert.equal(QUIET_BAND_PX.left + QUIET_BAND_PX.right, HERO_PX.width, 'the band is centred');
  // Overlaid at the default size on the standard phones, in the flow below
  // at larger sizes and on a narrower screen (the adaptive rule).
  assert.equal(captionPlacement(402, 1), 'overlay', 'iPhone 17');
  assert.equal(captionPlacement(393, 1), 'overlay');
  assert.equal(captionPlacement(375, 1), 'overlay', 'iPhone SE');
  assert.equal(captionPlacement(402, 1.235), 'below', 'XXL');
  assert.equal(captionPlacement(375, 1.353), 'below', 'XXXL');
  assert.equal(captionPlacement(402, 3.571), 'below', 'AX5');
  assert.equal(captionPlacement(320, 1), 'below', 'display zoom');
  const code = codeOnly(componentBody(WELCOME, 'WelcomeContent'));
  assert.ok(code.includes('const placement = captionPlacement(width, fontScale);'));
  assert.ok(code.includes("{placement === 'overlay' ? ("));
  assert.ok(
    code.includes(
      "{placement === 'below' ? <View style={styles.captionBelow}>{caption}</View> : null}",
    ),
  );
});

test('Welcome keeps the real safe areas and the frame’s sticky footer, and scrolls instead of shrinking', () => {
  const code = codeOnly(WELCOME);
  const welcome = codeOnly(componentBody(WELCOME, 'WelcomeContent'));
  // Nothing under the status bar; the footer sits over the bottom inset.
  assert.ok(welcome.includes('paddingTop: insets.top'));
  assert.ok(welcome.includes('paddingBottom: insets.bottom + spacing[12]'));
  // The content scrolls; the action stays outside it, pinned.
  const scroll = welcome.indexOf('<ScrollView');
  const scrollEnd = welcome.indexOf('</ScrollView>');
  const button = welcome.indexOf('<GetStarted onPress={onGetStarted} />');
  assert.ok(scroll > 0 && scrollEnd > scroll && button > scrollEnd);
  // The hairline is allocated always and coloured only when content runs under it.
  assert.ok(code.includes('borderTopWidth: 1,'));
  assert.ok(welcome.includes('overflowing && styles.footerRule'));
});

test('Get started still advances through the existing onboarding action', () => {
  // The component hands the press to its caller, from the sticky footer.
  const welcome = codeOnly(componentBody(WELCOME, 'WelcomeContent'));
  assert.ok(welcome.includes('<GetStarted onPress={onGetStarted} />'));
  assert.ok(
    welcome.includes('<View style={textFullWidth(fontScale) ? styles.pageMargin : styles.inset}>'),
  );
  // Welcome's taller action is the shared Button's primary treatment: a
  // button with its visible label as its name, the same pill, fill, label
  // colour and face, and pressed opacity.
  const cta = codeOnly(componentBody(WELCOME, 'GetStarted'));
  assert.ok(cta.includes('accessibilityRole="button"'));
  assert.ok(cta.includes('accessibilityState={{ disabled: false, busy: false }}'));
  assert.ok(cta.includes('onPress={onPress}'));
  assert.ok(
    cta.includes('<Text variant="body-small-bold" color="text/inverse" style={styles.ctaLabel}>'),
  );
  assert.ok(cta.includes('{WELCOME_CTA}'));
  assert.ok(!cta.includes('accessibilityLabel'), 'the visible label is not its name');
  const code = codeOnly(WELCOME);
  assert.ok(code.includes('minHeight: CTA_MIN_HEIGHT,'));
  assert.ok(code.includes('borderRadius: radius.full,'));
  assert.ok(code.includes("backgroundColor: color['action/primary'],"));
  assert.ok(/ctaPressed: \{\s*opacity: 0\.6,/.test(code));
  // The shared Button and type scale are untouched: Welcome's sizes are its own.
  const button = read('components', 'ui', 'button.tsx');
  assert.ok(button.includes('minHeight: hitTarget.minimum,'));
  assert.ok(button.includes('variant="body-small-bold"'));
  assert.ok(button.includes('opacity: 0.6,'));
  // The route records Welcome as the resume point and pushes the first
  // problem screen (2026-09-28).
  const route = codeOnly(ROUTES.welcome);
  assert.ok(route.includes("void access.recordShownStep('welcome');"));
  assert.ok(
    route.includes(
      "return <WelcomeContent onGetStarted={() => router.push(onboardingRoute('problem-scale'))} />;",
    ),
  );
});

test('the two problem screens: exact frame wiring, the source note, and the visual stories', () => {
  // Routes: resume point, Continue forward, Back through the shared rule.
  const scale = codeOnly(ROUTES.problemScale);
  assert.ok(scale.includes("void access.recordShownStep('problem-scale');"));
  assert.ok(scale.includes("onContinue={() => router.push(onboardingRoute('problem-risk'))}"));
  assert.ok(scale.includes("onBack={() => goBackFrom('problem-scale', router)}"));
  const risk = codeOnly(ROUTES.problemRisk);
  assert.ok(risk.includes("void access.recordShownStep('problem-risk');"));
  assert.ok(risk.includes("onContinue={() => router.push(onboardingRoute('states'))}"));
  assert.ok(risk.includes("onBack={() => goBackFrom('problem-risk', router)}"));
  // The scale (the authored pictograph, 2026-09-29): the stat in the `stat`
  // type, spoken once through the headline's label, over ONE authored
  // production image — six figures, one lime with three rays, five pale
  // blue, drawn by the artwork itself, whole with `contain` — exposed as
  // ONE spoken infographic, decorative beneath its label, with no glyph
  // grid, no per-figure element and no tinting in code.
  const scaleStep = codeOnly(componentBody(PROBLEM, 'ProblemScaleStep'));
  assert.ok(scaleStep.includes('<Text variant="stat">{PROBLEM_SCALE_STAT}</Text>'));
  assert.ok(scaleStep.includes('source={SCALE_PICTOGRAPH}'));
  assert.ok(scaleStep.includes('resizeMode="contain"'), 'the pictograph could crop');
  assert.ok(scaleStep.includes('scalePictographSize(contentWidth, height, fontScale)'));
  assert.equal(scaleStep.split('<Image').length, 2, 'the scale screen draws extra images');
  assert.ok(!PROBLEM.includes('figure-person'), 'the retired glyph grid is back');
  assert.ok(!PROBLEM.includes('tintColor'), 'the artwork is recoloured in code');
  assert.ok(scaleStep.includes('accessibilityLabel={PROBLEM_SCALE_FIGURES_LABEL}'));
  assert.ok(scaleStep.includes('{...DECORATIVE}'), 'the drawn pictograph is spoken twice');
  assert.ok(scaleStep.includes('headlineAccessibilityLabel={PROBLEM_SCALE_SPOKEN}'));
  assert.ok(scaleStep.includes("progress={stepProgress('problem-scale')}"));
  // The stakes (2026-09-29, the approved risk-row target, superseding the
  // 2×2 grid): four vertical editorial rows in canonical order — the
  // production illustration left, its exact label as live heading-3 text
  // right — each ONE spoken element with its image decorative, hairlines
  // between rows from `riskRowHasSeparator`, sizes from `riskRowLayout`,
  // and no pill, band, card, grid column or background of any kind.
  const riskStep = codeOnly(componentBody(PROBLEM, 'ProblemRiskStep'));
  assert.ok(riskStep.includes("progress={stepProgress('problem-risk')}"));
  assert.ok(riskStep.includes('{PROBLEM_RISK_GROUP_ROWS.map(({ id, label }, index) => ('));
  assert.ok(riskStep.includes('accessibilityLabel={label}'));
  assert.equal(riskStep.split('accessible\n').length, 2, 'a row splits into several elements');
  assert.ok(riskStep.includes('source={STATISTIC_ILLUSTRATIONS[id]}'));
  assert.ok(riskStep.includes('{...DECORATIVE}'), 'an illustration is spoken');
  assert.ok(riskStep.includes('resizeMode="contain"'), 'an illustration could crop');
  assert.ok(riskStep.includes('variant={RISK_LABEL_VARIANT}'));
  assert.ok(riskStep.includes('{label}'), 'the labels are not live text');
  assert.ok(riskStep.includes('riskRowLayout({'));
  assert.ok(riskStep.includes('riskRowHasSeparator(index) ? styles.riskSeparator : null'));
  assert.equal(riskStep.split('<Image').length, 2, 'the rows draw extra images');
  const riskRow = componentBody(PROBLEM, 'ProblemRiskStep');
  for (const retired of [
    'labelSlot',
    'labelBand',
    'riskColumnWidth',
    'riskLabelSeat',
    'riskColumns',
    'flexWrap',
    'columnGap',
  ]) {
    assert.ok(!riskRow.includes(retired), `the 2×2 grid's ${retired} is back`);
  }
  // Transparent rows: the only colour in the file is the separator's
  // `border/subtle`; no background, radius, shadow or surface anywhere.
  assert.deepEqual(codeOnly(PROBLEM).match(/color\['[^']+'\]/g), ["color['border/subtle']"]);
  for (const forbidden of [
    'backgroundColor',
    'borderRadius',
    'radius',
    'shadow',
    '<Surface',
    'background/subtle',
  ]) {
    assert.ok(!codeOnly(PROBLEM).includes(forbidden), `the problem screens draw ${forbidden}`);
  }
  assert.ok(!PROBLEM.includes('numberOfLines'), 'a label is line-capped');
  assert.ok(!PROBLEM.includes('minimumFontScale'), 'a label is font-shrunk');
  assert.ok(!PROBLEM.includes('adjustsFontSizeToFit'), 'a label is font-fitted');
  assert.ok(!PROBLEM.includes('ellipsizeMode'), 'a label is truncated');
  assert.ok(!ONBOARDING_COPY.PROBLEM_RISK_BODY.includes('Young children'), 'the fact repeats');
  // Neither screen has a mascot — no import, no reserved space, no hidden
  // character element (the approved compositions are the visual).
  assert.ok(!PROBLEM.includes('lotly-mascot'), 'a mascot is drawn on a problem screen');
  assert.ok(!PROBLEM.includes('aside'), 'a mascot aside slot is reserved');
  // Both: the source note, Back and a pinned Continue; readable source text.
  for (const step of [scaleStep, riskStep]) {
    assert.ok(step.includes('<SourceNote />'));
    assert.ok(step.includes('back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}'));
    assert.ok(step.includes('footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}'));
  }
  assert.ok(
    codeOnly(componentBody(PROBLEM, 'SourceNote')).includes(
      'variant="body-small" color="text/secondary"',
    ),
  );
  // The pale blue belongs to the artwork alone: neither screen draws it
  // (the 2×2 label bands that used it are retired, 2026-09-29).
  assert.ok(!codeOnly(PROBLEM).includes("color['background/subtle']"));
  // The CDC pages are the documented sources — in comments only, so no URL
  // is bundled — and the quiet note is never a link.
  const copyModule = read('lib', 'onboarding-copy.ts');
  assert.ok(copyModule.includes('cdc.gov/food-safety/about/index.html'));
  assert.ok(copyModule.includes('cdc.gov/food-safety/risk-factors/index.html'));
  assert.ok(!codeOnly(copyModule).includes('cdc.gov'), 'a CDC URL is bundled in code');
  assert.ok(!codeOnly(PROBLEM).includes('cdc.gov'), 'a CDC URL is bundled in code');
  assert.ok(!codeOnly(PROBLEM).includes('Linking'), 'the source note became a link');
});

test('Welcome is static: no entrance, no loop, and no screen animates the shared heading', () => {
  const code = codeOnly(WELCOME);
  for (const forbidden of [
    'Animated',
    'isReduceMotionEnabled',
    'useReduceMotion',
    'Animated.loop',
    'setInterval',
    'requestAnimationFrame',
    'react-native-reanimated',
    "from 'moti'",
    'lottie',
  ]) {
    assert.ok(!code.includes(forbidden), `Welcome uses ${forbidden}`);
  }
  // Route transitions, and their Reduce Motion fade, stay the root stack's.
  assert.ok(
    read('app', '_layout.tsx').includes("animation: reduceMotion === true ? 'fade' : 'default',"),
  );
  for (const [name, source] of [
    ['welcome', WELCOME],
    ['states', STATES],
    ['allergens', ALLERGENS],
    ['retailers', RETAILERS],
    ['preview', PREVIEW],
    ['education', EDUCATION],
    ['panel', PANEL],
  ] as const) {
    assert.ok(!source.includes('headingMotion'), `${name} animates its heading`);
  }
});

test('the paywall keeps the shared frame and its four footer actions in one toolbar; education draws its own page with no way back', () => {
  // Both paywall routes draw the grocery-watch page (2026-10-04), which
  // keeps the frame's top bar for Back and the shared footer's one toolbar.
  assert.ok(codeOnly(ONBOARDING_PANEL).includes('<OnboardingTopBar'));
  assert.ok(codeOnly(PANEL).includes('accessibilityRole="toolbar"'));
  // The approved phone-led page (2026-10-03) is full-bleed, as Building and
  // the onboarding paywall: its own page, no back control, no tabs, and the
  // two actions and the footnote pinned in the footer.
  const education = codeOnly(EDUCATION);
  assert.ok(!education.includes('<OnboardingFrame'));
  assert.ok(!education.includes('OnboardingTopBar'));
  assert.ok(!education.includes('chevron-left'));
  const footer = education.slice(education.indexOf('</ScrollView>'));
  for (const piece of [
    // The outcome notice, when a phase has one, then the primary, the
    // secondary and the footnote — the words come from the outcomes leaf.
    '{!large && notice ? <View style={styles.notice}>{notice}</View> : null}',
    '{actions}',
    '{large ? null : footnote}',
  ]) {
    assert.ok(footer.includes(piece), `the footer lost ${piece}`);
  }
  // The two actions are one element, pinned by default and in the content
  // when the measured rule moves them (below); the words come from the leaf.
  const actions = education.slice(
    education.indexOf('const actions = ('),
    education.indexOf('return ('),
  );
  for (const piece of [
    '<OnboardingActionPill',
    'label={footer.primary.label}',
    "onPress={footer.primary.kind === 'settings' ? onOpenSettings : onEnable}",
    'accessibilityLabel={footer.secondary.label}',
  ]) {
    assert.ok(actions.includes(piece), `the actions lost ${piece}`);
  }
  // From the accessibility sizes (founder review 2026-10-04): the notice is
  // in the content; the actions join it only when the pinned footer would
  // leave less room than the notice needs — measured, never counted — and
  // never move back; the page jumps to the notice's FIRST line below the
  // safe area; the blocked phase does not repeat the Settings footnote; the
  // outcome is announced once by the screen, not by a live region.
  assert.ok(education.includes('room < noticeHeight + 2 * spacing[16]'));
  assert.ok(
    education.includes('joinIfCrowded(event.nativeEvent.layout.height, noticeBox?.height ?? 0);'),
  );
  assert.ok(education.includes('joinIfCrowded(viewport, height);'));
  assert.ok(education.includes('const actionsInline = large && notice !== null && joined;'));
  assert.ok(!education.includes('setJoined(false)'), 'the actions never move back');
  assert.ok(
    education.includes(
      '{actionsInline ? <View style={styles.inlineActions}>{actions}</View> : null}',
    ),
  );
  assert.ok(education.includes('{actionsInline ? null : ('));
  assert.ok(education.includes('y: Math.max(0, noticeTop - insets.top - spacing[8]),'));
  assert.ok(
    !education.includes('scrollToEnd'),
    'the end of the notice is not where reading starts',
  );
  assert.ok(education.includes("const inlineFootnote = large && view.phase !== 'blocked';"));
  assert.ok(education.includes('AccessibilityInfo.announceForAccessibility(noticeText)'));
  assert.ok(education.includes('live={false}'));
});

test('the paywall keeps its sticky/inline terms rule, and Ready carries no terms at all', () => {
  const slots = codeOnly(componentBody(PANEL, 'usePurchaseFooterSlots'));
  // The reader's text scale is an input, read so a change moves the block
  // rather than waiting for a cold launch — the settings selector's technique.
  assert.ok(slots.includes('const { fontScale } = useWindowDimensions();'));
  assert.ok(slots.includes('const placement = paywallFooterPlacement(fontScale);'));
  // One terms block, drawn once (inside PurchaseTerms), in exactly one of
  // the two slots; the CTA stays sticky at every size.
  const terms = codeOnly(componentBody(PANEL, 'PurchaseTerms'));
  assert.equal(terms.split('accessibilityRole="toolbar"').length, 2, 'the toolbar is drawn once');
  // The standalone paywall's period-neutral disclosure is the default; the
  // onboarding paywall passes the chosen plan's (2026-10-01).
  assert.ok(terms.includes('disclosure = PAYWALL_DISCLOSURE,'));
  assert.ok(terms.includes('{disclosure}'));
  assert.ok(
    slots.includes(
      'const terms = <PurchaseTerms purchase={purchase} disclosure={options.disclosure} />;',
    ),
  );
  assert.ok(slots.includes("{placement === 'sticky' ? terms : null}"));
  assert.ok(slots.includes("inlineTerms: placement === 'inline' ? terms : null,"));
  const cta = '<PurchaseCta purchase={purchase} appearance={options.appearance} />';
  assert.ok(
    slots.indexOf(cta) > 0 &&
      slots.indexOf(cta) < slots.indexOf("{placement === 'sticky' ? terms : null}"),
    'the primary action stays in the sticky footer',
  );
  // Both paywall routes compose the one panel, which uses the one rule with
  // its explicit appearance and disclosure.
  const onboarding = codeOnly(componentBody(ONBOARDING_PANEL, 'OnboardingPaywallPanel'));
  assert.ok(onboarding.includes("appearance: 'onboarding',"));
  assert.ok(onboarding.includes('disclosure: renewalDisclosure(purchase.view),'));
  assert.ok(onboarding.includes('footer={slots.footer}>'));
  assert.ok(onboarding.indexOf('{children}') < onboarding.indexOf('{slots.inlineTerms}'));
  // The split (2026-09-28): Ready draws no terms, disclosure or legal links.
  for (const gone of ['PurchaseTerms', 'PAYWALL_DISCLOSURE', 'usePurchaseFooterSlots']) {
    assert.ok(!codeOnly(PREVIEW).includes(gone), `Ready draws ${gone}`);
  }
});

test('the deck: a physical stack of the real cards, the top one leaving left, the frosted real fourth as the final page', () => {
  const deck = codeOnly(componentBody(CAROUSEL, 'ReadyDeck'));
  // No pager: one continuous position, driven by a horizontal drag.
  for (const pager of ['FlatList', 'snapToInterval', 'pagingEnabled', 'horizontal']) {
    assert.ok(!codeOnly(CAROUSEL).includes(pager), `the deck pages with ${pager}`);
  }
  assert.ok(deck.includes('const [position] = useState(() => new Animated.Value(0));'));
  assert.ok(deck.includes('PanResponder.create({'));
  assert.ok(deck.includes('position.setValue(deckDragPosition(drag.from, count, g.dx, exit));'));
  assert.ok(deck.includes('settle(deckReleaseTarget(active, count, g.dx, g.vx, exit));'));
  // An interrupted drag restores the stack.
  assert.ok(deck.includes('onPanResponderTerminate: () => settle(active),'));
  // The responder's inputs change only on a commit or a new layout, never
  // during a drag.
  assert.ok(deck.includes('}, [active, count, exit, position, settle]);'));
  // Every card is a REAL card, posed by its depth below the position from
  // the one shared table — so the next card is mounted beneath the top one.
  assert.ok(deck.includes('const ranges = deckPoseRanges(frontWidth, exit);'));
  assert.ok(deck.includes('const depth = Animated.subtract(index, position);'));
  assert.ok(
    deck.includes(
      'transform: [{ translateX: pose(ranges.translateX) }, { scale: pose(ranges.scale) }],',
    ),
  );
  // Painted last-first, so each card lies over the ones after it; only the
  // front one takes a touch.
  assert.ok(deck.includes('.reverse()'));
  assert.ok(deck.includes("pointerEvents={index === active ? 'auto' : 'none'}"));
  // The one scale is the table's uniform one (the promotion of the card
  // beneath); nothing turns, skews or adds perspective, and no axis scales
  // on its own.
  for (const distortion of ['rotate', 'skew', 'perspective', 'scaleX', 'scaleY']) {
    assert.ok(!codeOnly(CAROUSEL).includes(distortion), `the deck uses ${distortion}`);
  }
  assert.equal((codeOnly(CAROUSEL).match(/scale:/g) ?? []).length, 1);
  // Geometry comes from measured card heights, never from a drag.
  assert.ok(deck.includes('onLayout={(event) => onCardLayout(event.nativeEvent.layout.height)}'));
  assert.ok(
    deck.includes('cardHeight > 0 && { height: DECK_ROOM.top + cardHeight + DECK_ROOM.bottom }'),
  );
  // Measurements are whole points past layout's noise, so raising a card to
  // its own height can never creep (the XL deck once grew to 1,023pt).
  assert.equal((deck.match(/wholePoints\(h\) >= wholePoints\(height\)/g) ?? []).length, 2);
  assert.ok(!codeOnly(CAROUSEL).includes('Math.ceil'));
  // Every card shares the deck's height at every text size, so a taller
  // card can never show beneath the front one.
  assert.ok(deck.includes('const shared = cardHeight > 0 ? cardHeight : undefined;'));
  assert.ok(codeOnly(componentBody(CAROUSEL, 'DeckCard')).includes('deckHeight={height}'));
  // One index: committed on release (or an accessibility move), before the
  // settle, with no timer in between.
  assert.ok(deck.includes('(target: number) => {\n      setActive(target);'));
  // The step remounts the deck for new content or a new text size.
  assert.ok(codeOnly(PREVIEW).includes('key={deckKey(preview.models, preview.locked, fontScale)}'));
  // The REAL shared card surface over the REAL feed model, uniform, media
  // through the shared tile, no save control.
  const card = codeOnly(componentBody(CAROUSEL, 'DeckCard'));
  assert.ok(card.includes('<RecallCardSurface'));
  assert.ok(card.includes('model={item.model}'));
  assert.ok(card.includes('uniform={uniform}'));
  assert.ok(card.includes('<MediaTile'));
  assert.ok(card.includes('trailing={null}'));
  assert.ok(deck.includes('const rule = previewCardLayout(fontScale);'));
  // The locked card: last, only when a real one exists, frosted, one lock,
  // no words, its recall hidden from assistive technology.
  assert.ok(deck.includes("...(locked ? [{ kind: 'locked', model: locked } as DeckItem] : [])"));
  assert.ok(
    card.includes('<BlurView intensity={FROST_INTENSITY} tint="light" style={styles.frost} />'),
  );
  assert.ok(card.includes('<View style={[styles.frost, styles.frostOpaque]} />'));
  assert.ok(card.includes('<Icon name="lock" size={24} color="icon/primary" />'));
  assert.ok(card.includes('<View {...HIDDEN} pointerEvents="none">'));
  assert.ok(!card.includes('<Text'), 'the locked card explains itself in words');
  // Behind the front card the locked card wears a plain white face, so its
  // blur's colours never reach the visible strip.
  assert.ok(
    card.includes('{veil ? <Animated.View style={[styles.veil, { opacity: veil }]} /> : null}'),
  );
  assert.ok(
    deck.includes(
      "veil: depth.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),",
    ),
  );
  // No arrows, no instruction copy, no auto-advance, no loop, no glass.
  for (const forbidden of [
    'Swipe to',
    'chevron-right',
    'chevron-left',
    'Animated.loop',
    'setInterval',
    'setTimeout',
    'LinearGradient',
    'GlassView',
    'pagingEnabled',
  ]) {
    assert.ok(!codeOnly(CAROUSEL).includes(forbidden), `the deck has ${forbidden}`);
  }
  // One dot per navigable page, the locked page included; decorative.
  assert.ok(deck.includes('const dots = deckDotCount(count);'));
  assert.ok(deck.includes('<View style={styles.dots} {...HIDDEN}>'));
});

test('the deck is one adjustable element: the active card’s whole content, next and previous without arrows', () => {
  const deck = codeOnly(componentBody(CAROUSEL, 'ReadyDeck'));
  assert.ok(deck.includes("count > 1 ? 'adjustable'"));
  assert.ok(deck.includes('accessibilityValue={count > 1 ? { text: spoken } : undefined}'));
  assert.ok(deck.includes('matchAccessibilityLabel(current.model, active, models.length)'));
  assert.ok(deck.includes(': PREVIEW_LOCKED_CARD_TITLE;'));
  assert.ok(deck.includes("{ name: 'increment' }"));
  assert.ok(deck.includes("{ name: 'decrement' }"));
  assert.ok(deck.includes("if (event.nativeEvent.actionName === 'increment') goTo(active + 1);"));
  assert.ok(
    deck.includes("else if (event.nativeEvent.actionName === 'decrement') goTo(active - 1);"),
  );
  // The locked card activates the plan screen and nothing else.
  assert.ok(
    deck.includes("else if (event.nativeEvent.actionName === 'activate') onLockedPress();"),
  );
  // A requested move settles the same way a released drag does.
  assert.ok(deck.includes('if (target !== active) settle(target);'));
});

test('the standalone paywall composes the grocery-watch panel: no second composition, no mascot, no check rows', () => {
  // 2026-10-04: an expired subscriber meets the same approved design as a
  // first-time one. The route hands the panel its own wiring (Back is
  // `reviewPreview`), and nothing else differs.
  assert.ok(
    codeOnly(ROUTES.paywall).includes(
      '<OnboardingPaywallPanel purchase={purchase} onBack={access.reviewPreview}>',
    ),
  );
  assert.ok(codeOnly(ROUTES.paywall).includes('usePurchaseFlow()'));
  assert.ok(!codeOnly(ROUTES.paywall).includes('router.'), 'the standalone route navigates');
  // The retired composition is gone from the shared pieces, not merely unused.
  for (const gone of [
    'PaywallPanel(',
    'WatchfulMascot',
    'BenefitChecks',
    'lotly-mascot-',
    'PAYWALL_HEADLINE',
    'PAYWALL_BODY',
    'PAYWALL_BENEFITS',
    '<OnboardingFrame',
    'badgeCorner',
    'HIDE_MASCOT_AT_SCALE',
  ]) {
    assert.ok(!codeOnly(PANEL).includes(gone), `the shared pieces still draw ${gone}`);
  }
  // The shared pieces keep only what both routes use.
  for (const kept of [
    'PurchaseCta',
    'PurchaseTerms',
    'usePurchaseFooterSlots',
    'PaywallNotice',
    'OnboardingActionPill',
  ]) {
    assert.ok(PANEL.includes(`export function ${kept}(`), `${kept} left the shared pieces`);
  }
});

test('the onboarding paywall: the grocery-watch composition over the shared purchase pieces', () => {
  const page = codeOnly(componentBody(ONBOARDING_PANEL, 'PaywallPage'));
  // The frame's own top bar (Back, no progress), the headline above the
  // hero, then the content column; the footer pinned over the bottom inset.
  const order = [
    '<OnboardingTopBar',
    '{ONBOARDING_PAYWALL_HEADLINE}',
    '<Image source={HERO} resizeMode="contain" style={styles.fill} />',
    '<View style={styles.column}>{children}</View>',
    '{footer}',
  ].map((marker) => {
    const at = page.indexOf(marker);
    assert.ok(at > 0, `the page lacks ${marker}`);
    return at;
  });
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'the page is out of order',
  );
  assert.ok(
    page.includes('back={{ label: PAYWALL_BACK_LABEL, hint: PAYWALL_BACK_HINT, onPress: onBack }}'),
  );
  assert.ok(page.includes('progress={null}'));
  // The headline is native text, a header, at the screen's measured size and
  // measure; it is drawn above the hero (zIndex), and the hero is drawn up
  // under it by the measured overlap.
  assert.ok(page.includes('accessibilityRole="header"'));
  assert.ok(page.includes('headlineType(fontScale),'));
  assert.ok(page.includes('maxWidth: headlineMeasure(fontScale),'));
  assert.ok(page.includes('paddingTop: headlineTopClearance(fontScale),'));
  assert.ok(/headline: \{[^}]*zIndex: 1/s.test(ONBOARDING_PANEL));
  assert.ok(page.includes('style={[styles.hero, { marginTop: -heroOverlap(width, fontScale) }]}>'));
  // The hero: decorative, untouchable, whole, static.
  assert.ok(page.includes('{...DECORATIVE}'));
  assert.ok(page.includes('pointerEvents="none"'));
  assert.ok(
    ONBOARDING_PANEL.includes(
      "require('@/assets/brand/production/lotly-paywall-grocery-watch-scene.png')",
    ),
  );
  assert.ok(/hero: \{[^}]*aspectRatio: HERO_PX\.width \/ HERO_PX\.height/s.test(ONBOARDING_PANEL));
  for (const motion of ['Animated', 'useReduceMotion', 'Easing', 'withTiming', 'setInterval']) {
    assert.ok(
      !codeOnly(ONBOARDING_PANEL).includes(motion),
      `the onboarding paywall animates: ${motion}`,
    );
  }
  // The purchase panel's order: benefits, plans, the route's controls, the
  // independence note, and (from the accessibility sizes) the terms.
  const panel = codeOnly(componentBody(ONBOARDING_PANEL, 'OnboardingPaywallPanel'));
  const parts = [
    '<BenefitRows />',
    '<OnboardingPlans purchase={purchase} />',
    '{children}',
    '{INDEPENDENCE_NOTE}',
    '{slots.inlineTerms}',
  ].map((marker) => {
    const at = panel.indexOf(marker);
    assert.ok(at > 0, `the onboarding paywall lacks ${marker}`);
    return at;
  });
  assert.deepEqual(
    parts,
    [...parts].sort((a, b) => a - b),
    'the onboarding paywall is out of order',
  );
  // Each benefit is ONE spoken element; its icon is drawing on the plate token.
  const benefits = codeOnly(componentBody(ONBOARDING_PANEL, 'BenefitRows'));
  assert.ok(benefits.includes('accessibilityLabel={`${benefit.title}. ${benefit.body}`}'));
  assert.ok(benefits.includes('<Icon name={benefit.icon} size={20} color="icon/primary" />'));
  assert.ok(ONBOARDING_PANEL.includes("backgroundColor: color['onboarding/benefit-plate'],"));
  // The plans: a real radio group of cards whose radios speak the full
  // charge; the badge is drawing; the selection is the ring, the dot and
  // the 2px navy border as well as the announced state.
  const plans = codeOnly(componentBody(ONBOARDING_PANEL, 'OnboardingPlans'));
  assert.ok(plans.includes('<ChoiceGroup label={PLAN_GROUP_LABEL} style={styles.plans}>'));
  assert.ok(plans.includes('onPress={() => purchase.onSelectPlan(plan.period)}'));
  assert.ok(plans.includes('{paywallPresentation(purchase.view).offeringMessage}'));
  const card = codeOnly(componentBody(ONBOARDING_PANEL, 'PlanCard'));
  assert.ok(card.includes('accessibilityRole="radio"'));
  assert.ok(card.includes('accessibilityLabel={plan.accessibilityLabel}'));
  assert.ok(
    card.includes('accessibilityState={{ checked: plan.selected, selected: plan.selected }}'),
  );
  assert.ok(card.includes('<View style={styles.badge} {...DECORATIVE}>'));
  assert.ok(/planSelected: \{[^}]*borderWidth: 2/s.test(ONBOARDING_PANEL));
  // No purchase state or handler of its own, no mascot, no close or skip.
  for (const gone of [
    'useState<PaywallView',
    'provider.',
    'onSubscribe',
    'lotly-mascot-',
    'WatchfulMascot',
    'BEST_VALUE',
    'PAYWALL_BODY',
    'onRequestClose',
    'Maybe later',
    'progress={stepProgress',
  ]) {
    assert.ok(!codeOnly(ONBOARDING_PANEL).includes(gone), `the onboarding paywall draws ${gone}`);
  }
  // The entitled panel: no plans, no store, the active subscription, and a Continue.
  const entitled = codeOnly(componentBody(ONBOARDING_PANEL, 'OnboardingEntitledPanel'));
  assert.ok(entitled.includes('{EDUCATION_SUCCESS}'));
  assert.ok(
    entitled.includes(
      'footer={<OnboardingActionPill label={CONTINUE_CTA} onPress={onContinue} />}>',
    ),
  );
  assert.ok(!entitled.includes('OnboardingPlans') && !entitled.includes('slots'));
  // The 51pt pill is the shared Button's primary treatment, busy word included.
  const pill = codeOnly(componentBody(PANEL, 'OnboardingActionPill'));
  assert.ok(pill.includes('accessibilityState={{ disabled: inert, busy }}'));
  assert.ok(pill.includes('{busy && busyLabel !== undefined ? busyLabel : label}'));
  assert.ok(/pill: \{[^}]*minHeight: CTA_MIN_HEIGHT/s.test(PANEL));
  const cta = codeOnly(componentBody(PANEL, 'PurchaseCta'));
  assert.ok(cta.includes("appearance = 'standard',"));
  assert.ok(
    cta.includes(
      "{appearance === 'onboarding' ? <OnboardingActionPill {...action} /> : <Button {...action} />}",
    ),
  );
});

// ── The building interstitial and the onboarding paywall (2026-09-28) ───────

test('Building and Ready reuse the choices already read; screens that save never do', () => {
  const hook = codeOnly(HOOK);
  assert.ok(hook.includes('let lastKnown: UserRecallPreferences | null = null;'));
  assert.ok(
    /\{\s*reuseLoaded = false,?\s*\}: OnboardingPreferencesOptions = \{\}/.test(hook),
    'the reuse is not opt-in',
  );
  assert.ok(hook.includes('reuseLoaded && lastKnown !== null && preferencesAvailable()'));
  // Still re-read on focus; a failed read clears the copy and says so.
  assert.ok(hook.includes('loadPreferences().then('));
  assert.ok(/lastKnown = null;\s+setLoad\(\{ status: 'failed' \}\);/.test(hook));
  // A re-read that started before a change answers with the older stored
  // value and must not put it back (2026-10-04).
  assert.ok(hook.includes('if (!current || edits.current !== readAt) return;'));
  for (const name of ['building', 'preview'] as const) {
    const route = codeOnly(ROUTES[name]);
    assert.ok(route.includes('useOnboardingPreferences({ reuseLoaded: true })'), name);
    assert.ok(route.includes('presentedPreferences(load.prefs)'), name);
  }
  // The selectors and the editor save: they read afresh and never present a
  // development view of the choices.
  for (const name of ['states', 'allergens', 'retailers', 'edit-preferences'] as const) {
    const route = codeOnly(read('app', 'onboarding', `${name}.tsx`));
    assert.ok(!route.includes('reuseLoaded'), `${name} reuses`);
    assert.ok(!route.includes('presentedPreferences'), `${name} presents a view`);
  }
  const presented = codeOnly(read('lib', 'presented-preferences.ts'));
  assert.ok(presented.includes('const developmentQa = __DEV__'));
  assert.ok(presented.includes("require('@/lib/development-feed-scenarios')"));
  assert.ok(
    !/import .*development-feed-scenarios/.test(presented.replace(/import type[^;]+;/g, '')),
  );
});

test('Building: real data presented once, replaced by Ready, never trapped, swipe disabled', () => {
  const route = codeOnly(ROUTES.building);
  assert.ok(route.includes("void access.recordShownStep('building');"));
  // Start or join the shared sync at MOUNT; presentation waits for visibility.
  assert.ok(route.includes('const feed = useFeed();'));
  // One exit: completion and Continue both mark the spent presentation and
  // REPLACE with Ready; an unreadable preference store routes on unspent.
  assert.ok(route.includes('if (left.current) return;'));
  assert.ok(route.includes('if (spent) void access.completeWatchBuild();'));
  assert.ok(route.includes('buildingDone(router);'));
  assert.ok(route.includes("load.status === 'failed' || load.status === 'unsupported'"));
  assert.ok(route.includes('if (failed) leave(false);'));
  // The gate is the shared feed's answer and the Affects You total; Continue
  // disposes the sequence before leaving; Try again refreshes the same session.
  assert.ok(route.includes('buildingData('));
  assert.ok(route.includes('feed.refreshing'));
  assert.ok(route.includes('sequence.leave();'));
  assert.ok(route.includes('void feed.refresh();'));
  assert.ok(!route.includes('completePersonalization'), 'Building completed onboarding');
  const watch = codeOnly(read('lib', 'building-watch.ts'));
  assert.ok(watch.includes('affectsYouMatches(feed.items, prefs, now).length'));
  const ready = codeOnly(read('lib', 'ready-preview.ts'));
  assert.ok(ready.includes('const affects = affectsYouMatches(feed.items, prefs, now);'));
  // buildingDone REPLACES, so Back from Ready pops to Stores; Stores'
  // Continue plays it only once and keeps the edit path direct.
  const nav = codeOnly(read('lib', 'onboarding-navigation.ts'));
  assert.ok(nav.includes("navigator.replace(onboardingRoute('preview'));"));
  assert.ok(nav.includes("else navigator.push(onboardingRoute('building'));"));
  assert.ok(nav.includes("if (previewBeneath) navigator.dismissTo(onboardingRoute('preview'));"));
  assert.ok(nav.includes("else if (watchBuilt) navigator.push(onboardingRoute('preview'));"));
  // No interactive swipe back from Building.
  const layout = codeOnly(read('app', '_layout.tsx'));
  assert.ok(layout.includes("const BUILDING_SCREEN = onboardingRoute('building').slice(1);"));
  assert.ok(layout.includes('? { headerShown: false, gestureEnabled: false }'));
  // Visibility: the stack's transitionEnd, a cold-resume fallback, AppState
  // pause/resume, and everything torn down on departure.
  const hook = codeOnly(read('hooks', 'use-building-sequence.ts'));
  assert.ok(hook.includes('navigation.addListener(') && hook.includes("'transitionEnd' as never"));
  assert.ok(hook.includes('BUILDING_TIMING.visibilityFallbackMs'));
  assert.ok(hook.includes("AppState.addEventListener('change'"));
  assert.ok(hook.includes('created.pause()') && hook.includes('created.resume()'));
  assert.ok(hook.includes('subscription.remove();') && hook.includes('created.dispose();'));
  assert.ok(hook.includes('clearTimeout(fallback);') && hook.includes('unsubscribe();'));
  // The composition: the approved hero, three native tag glyphs, the rail,
  // one caption; finite native-driver motion, nothing looping or springing.
  const step = codeOnly(BUILDING);
  assert.ok(step.includes('lotly-building-grocery-search-scene.png'));
  assert.ok(!step.includes('lotly-mascot-watchful-1024.png'), 'M04 is back on Building');
  assert.ok(step.includes('TAG_GLYPHS.map('));
  assert.ok(step.includes('BUILDING_STOPS.map('));
  assert.ok(step.includes('useNativeDriver: true'));
  assert.ok(!step.includes('useNativeDriver: false'));
  for (const forbidden of [
    'Animated.loop',
    'setInterval',
    'Animated.spring',
    'iterations',
    'setTimeout',
  ]) {
    assert.ok(!step.includes(forbidden), `the Building step uses ${forbidden}`);
  }
  // Colour is decoration; state is the rays and the badge.
  assert.ok(step.includes("STOP_FILLS[index] === 'lime'"));
  assert.ok(
    step.includes("state === 'active' ? 1 : 0") && step.includes("state === 'complete' ? 1 : 0"),
  );
  // ONE grouped progress element; the hero and the rail visuals are hidden;
  // the slow/error footer offers both controls.
  assert.equal((step.match(/accessibilityRole="progressbar"/g) ?? []).length, 1);
  assert.ok(step.includes('accessibilityLabel={BUILDING_PROGRESS_LABEL}'));
  assert.ok(
    step.includes('text: buildingProgressValue(text, completedStops(view), BUILDING_STOPS.length)'),
  );
  assert.equal(
    ONBOARDING_COPY.buildingProgressValue('Found 22 recalls for you.', 3, 5),
    'Found 22 recalls for you. 3 of 5 done.',
  );
  assert.ok(step.includes('{...DECORATIVE}'));
  assert.ok(step.includes('label={BUILDING_RETRY}') && step.includes('label={BUILDING_CONTINUE}'));
  assert.ok(!step.includes('announceForAccessibility'), 'the view announces on its own');
  // The caption (2026-10-02): faded THROUGH — out 80ms (linear), the words
  // swap while nothing is visible, in 140ms — as one native timeline whose
  // incoming curve holds at nothing until the swap, so two sentences are never
  // on screen together and nothing waits on JS at the swap; no rise, no
  // scale; the arriving layer is created transparent; a stale run changes
  // nothing; Reduce Motion swaps at once; the layers are decorative (the
  // progress element speaks once).
  const fadeThrough = codeOnly(componentBody(BUILDING, 'CaptionFadeThrough'));
  assert.ok(!step.includes('CAPTION_RISE') && !fadeThrough.includes('translateY'));
  assert.ok(!fadeThrough.includes('scale') && !fadeThrough.includes('Animated.sequence'));
  assert.ok(fadeThrough.includes('opacity: new Animated.Value(animate ? 0 : 1)'));
  assert.ok(fadeThrough.includes('layers: animate ? [front, incoming] : [incoming]'));
  assert.ok(
    /Animated\.parallel\(\[\s*fade\(outgoing\.opacity, 0, \{ duration: MOTION\.out, easing: Easing\.linear \}\),\s*fade\(incoming\.opacity, 1, fromSwap\(EASE_OUT, MOTION\.in\)\),?\s*\]\)/.test(
      fadeThrough,
    ),
  );
  assert.ok(!/setValue\(/.test(fadeThrough), 'visible text then reset opacity');
  assert.ok(fadeThrough.includes('if (!finished || current.current !== incoming.id) return;'));
  assert.ok(fadeThrough.includes('return () => run.stop();'));
  assert.ok(fadeThrough.includes('{...DECORATIVE}'));
  assert.ok(fadeThrough.includes('candidates.map('));
  // The reading hold starts when the fade-in has actually finished on screen.
  assert.ok(fadeThrough.includes('onSettled?.();'));
  assert.ok(codeOnly(ROUTES.building).includes('onCaptionSettled={sequence.captionSettled}'));
  // The rail and tags change at the hidden swap point, over the fade-in, on
  // the same native timeline (the hold is in the curve, never a JS delay).
  assert.ok(step.includes('(t <= swap ? 0 : easing((t - swap) / (1 - swap)))'));
  assert.ok(step.includes('...fromSwap(EASE_OUT, MOTION.in),'));
  assert.ok(!step.includes('Animated.delay('));
  assert.ok(codeOnly(BUILDING).includes('out: BUILDING_TIMING.captionFadeOutMs'));
  assert.ok(codeOnly(BUILDING).includes('in: BUILDING_TIMING.captionFadeInMs'));
  // Every caption is ONE Public Sans 700 sentence, the count line included.
  const words = codeOnly(componentBody(BUILDING, 'CaptionWords'));
  assert.ok(words.includes('{captionText(caption)}'));
  assert.ok(
    !codeOnly(BUILDING).includes('sans-500') && !codeOnly(BUILDING).includes('captionCount'),
  );
  assert.ok(step.includes('if (!animate) {'));
});

test('the onboarding paywall route: the shared flow, its resume point, Back to Ready, and the entitled Continue', () => {
  const route = codeOnly(ROUTES.onboardingPaywall);
  assert.ok(route.includes("void access.recordShownStep('paywall');"));
  assert.ok(route.includes("goBackFrom('paywall', router)"));
  // Already entitled: never asked to purchase again.
  assert.ok(route.includes('isEntitled(access.entitlement)'));
  assert.ok(route.includes('<OnboardingEntitledPanel'));
  assert.ok(route.includes('onContinue={() => void access.completePersonalization()}'));
  // Otherwise: the one shared purchase flow, controls included, drawn by the
  // grocery-watch panel (2026-10-01), never the standalone one.
  assert.ok(route.includes('usePurchaseFlow()'));
  assert.ok(route.includes('<OnboardingPaywallPanel purchase={purchase} onBack={onBack}>'));
  assert.ok(route.includes('{developmentControls}'));
  assert.ok(!/<PaywallPanel\b/.test(route));
});

test('the merged screen’s machinery is gone: no overlay footer, no scroll-driven CTA, no merged copy', () => {
  // The frame is back to one fixed footer.
  for (const gone of ['footerMode', 'footerAllowance', 'onScroll', 'scrollEventThrottle']) {
    assert.ok(!codeOnly(FRAME).includes(gone), `the frame keeps ${gone}`);
  }
  // The presentation module keeps no CTA rule.
  const presentation = read('lib', 'ready-presentation.ts');
  for (const gone of ['purchaseCtaVisible', 'ctaFooterAllowance', 'CTA_REVEAL']) {
    assert.ok(!presentation.includes(gone), `ready-presentation keeps ${gone}`);
  }
  // The merged copy is gone from the product source (tests and docs may
  // still name it as history).
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        sources.push(readFileSync(path, 'utf8'));
      }
    }
  };
  walk(SRC);
  for (const gone of [
    'Keep your recall watch active.',
    'View plans',
    'Example match',
    'Choose your plan',
  ]) {
    assert.ok(!sources.some((source) => source.includes(`'${gone}'`)), `the copy keeps ${gone}`);
  }
});

test('the purchase handlers exist once: in the purchase flow, and nowhere else', () => {
  const flow = codeOnly(read('hooks', 'use-purchase-flow.tsx'));
  assert.ok(flow.includes('await access.provider.purchase(pkg);'));
  assert.ok(flow.includes('await access.provider.restore();'));
  assert.ok(flow.includes('await provider.loadOfferings();'));
  // Each outcome and a failed offering is spoken: iOS does not read
  // accessibilityLiveRegion, so the notice alone would be silent.
  assert.ok(
    flow.includes('AccessibilityInfo.announceForAccessibility(PAYWALL_NOTICES[notice].text);'),
  );
  assert.equal((flow.match(/announce\(notice\);/g) ?? []).length, 2, 'purchase and restore');
  assert.ok(flow.includes("announce('restore_success');"));
  assert.ok(flow.includes('AccessibilityInfo.announceForAccessibility(OFFERING_UNAVAILABLE);'));
  assert.ok(flow.includes('AccessibilityInfo.announceForAccessibility(OFFERING_ERROR);'));
  const sources: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        sources.push([path.slice(SRC.length + 1), readFileSync(path, 'utf8')]);
      }
    }
  };
  walk(SRC);
  for (const call of ['provider.purchase(', 'provider.restore(', 'provider.loadOfferings(']) {
    const owners = sources
      .filter(
        ([path, source]) => !path.startsWith('lib/purchases/') && codeOnly(source).includes(call),
      )
      .map(([path]) => path);
    assert.deepEqual(
      owners,
      [join('hooks', 'use-purchase-flow.tsx')],
      `${call} is called elsewhere`,
    );
  }
  // Both paywall routes take it; neither re-implements it, and Ready does
  // not touch it at all.
  for (const route of [ROUTES.onboardingPaywall, ROUTES.paywall]) {
    assert.ok(codeOnly(route).includes('usePurchaseFlow()'));
    assert.ok(!codeOnly(route).includes('useState'), 'a route holds purchase state');
  }
  assert.ok(!codeOnly(ROUTES.preview).includes('usePurchaseFlow'));
});

// ── P2B7Y: the four-step progress ───────────────────────────────────────────

test('the segmented progress: five equal segments, full width, no visible count, one spoken element, on the five counted screens only', () => {
  assert.deepEqual(
    COUNTED_STEPS.map((step) => progressAccessibilityLabel(stepProgress(step)!)),
    [
      'Onboarding progress, step 1 of 5',
      'Onboarding progress, step 2 of 5',
      'Onboarding progress, step 3 of 5',
      'Onboarding progress, step 4 of 5',
      'Onboarding progress, step 5 of 5',
    ],
  );
  assert.deepEqual(filledSegments({ index: 1, total: 5 }), [true, false, false, false, false]);
  assert.deepEqual(filledSegments({ index: 3, total: 5 }), [true, true, true, false, false]);
  assert.deepEqual(filledSegments({ index: 5, total: 5 }), [true, true, true, true, true]);
  // ONE accessibility element; the segments are its drawing, never five
  // elements, and there is NO visible numeric copy at all.
  const progress = codeOnly(componentBody(PROGRESS, 'OnboardingProgress'));
  assert.ok(progress.includes('accessible'));
  assert.ok(progress.includes('accessibilityRole="progressbar"'));
  assert.ok(progress.includes('accessibilityLabel={progressAccessibilityLabel(progress)}'));
  assert.ok(!progress.includes('progressLabel'), 'the visible count came back');
  assert.ok(!codeOnly(PROGRESS).includes('<Text'), 'the bar draws text');
  // Equal segments share the full row; the 6pt mark never scales or moves.
  const code = codeOnly(PROGRESS);
  assert.ok(code.includes('flex: 1,'));
  assert.ok(code.includes('const THICKNESS = 6;'));
  // Its own named token for the filled segments; the quiet track for the rest.
  assert.ok(code.includes("backgroundColor: color['onboarding/progress']"));
  assert.ok(code.includes("backgroundColor: color['background/subtle']"));
  // The frame draws it on its own full-width row when a step passes
  // progress; the five counted screens do. Welcome, the interstitial, the
  // paywall and the education pass none, and Ready's is null by the rule.
  assert.ok(codeOnly(FRAME).includes('<OnboardingProgress progress={progress} />'));
  assert.ok(codeOnly(FRAME).includes('{progress ? ('));
  for (const [name, source] of [
    ['problem screens', PROBLEM],
    ['states', STATES],
    ['allergens', ALLERGENS],
    ['retailers', RETAILERS],
  ] as const) {
    assert.ok(source.includes('progress={stepProgress('), `${name} has no progress`);
  }
  assert.equal(stepProgress('preview'), null);
  assert.equal(stepProgress('building'), null);
  assert.equal(stepProgress('paywall'), null);
  for (const [name, source] of [
    ['welcome', WELCOME],
    ['building', BUILDING],
    ['panel', PANEL],
    ['education', EDUCATION],
  ] as const) {
    assert.ok(!codeOnly(source).includes('progress='), `${name} shows progress`);
  }
});

test('onboarding motion plays only when Reduce Motion is known off, once, and never loops', () => {
  assert.equal(motionAllowed(false), true);
  assert.equal(motionAllowed(true), false);
  assert.equal(motionAllowed(null), false, 'an unknown setting counts as on');
  const hook = codeOnly(REDUCE_MOTION);
  assert.ok(hook.includes('.catch(() => true)'), 'an unreadable setting counts as on');
  assert.ok(hook.includes("addEventListener('reduceMotionChanged'"));
  // The grocery-atlas States is static (its M02 entrance left with M02).
  assert.ok(!codeOnly(STATES).includes('Animated'), 'the States step animates');
  // Ready (2026-09-30) has no entrance at all: its scene and board are
  // simply there, and the deck moves only with the finger or a requested
  // move (instant under Reduce Motion). The editor is static.
  assert.ok(!codeOnly(PREVIEW).includes('Animated'), 'Ready animates');
  assert.ok(!codeOnly(EDITOR).includes('Animated'), 'the editor animates');
  // The deck's one animation is the settle after a release or a requested
  // move; under Reduce Motion the cards still follow the finger (direct
  // manipulation) but the settle is immediate.
  const deck = codeOnly(CAROUSEL);
  assert.equal((deck.match(/Animated\.timing\(/g) ?? []).length, 1);
  assert.ok(!deck.includes('Animated.spring') && !deck.includes('Animated.loop'));
  assert.ok(
    deck.includes(
      'if (!motionAllowed(reduceMotion)) {\n        position.setValue(target);\n        return;\n      }',
    ),
  );
  for (const [name, source] of [['progress', PROGRESS]] as const) {
    const code = codeOnly(source);
    // Decided on the first render; the final state is drawn at once otherwise.
    // The progress bar additionally animates only a step reached forward by
    // one (`segmentFillAnimates`), so it names both conditions.
    assert.ok(
      code.includes('const [animate] = useState(() => motionAllowed(reduceMotion));') ||
        code.includes(
          '() => motionAllowed(reduceMotion) && segmentFillAnimates(lastShownIndex, progress.index),',
        ),
      `${name} decides its motion somewhere else`,
    );
    assert.ok(code.includes('new Animated.Value(animate ? 0 : 1)'), `${name} starts hidden`);
    assert.ok(code.includes('if (!animate) return;'));
    assert.ok(code.includes('useNativeDriver: true'));
    for (const forbidden of ['Animated.loop', 'iterations', 'setInterval', 'Animated.spring']) {
      assert.ok(!code.includes(forbidden), `${name} uses ${forbidden}`);
    }
  }
  assert.ok(!codeOnly(STATE_MAP).includes('Animated'), 'the map animates');
});

// ── The grocery-atlas States (2026-09-30) ───────────────────────────────────

test('the chooser and the chips read and change ONE draft, through the shared selector rule, with no inferred state', () => {
  const step = codeOnly(componentBody(STATES, 'StatesStep'));
  // No copy of the selection (2026-10-04): the step edits the saved list the
  // route hands it, so an editor save beneath can never leave it stale.
  assert.equal((step.match(/useState<readonly string\[\]>/g) ?? []).length, 0, 'a second draft');
  assert.ok(step.includes('const draft = selected;'));
  assert.ok(
    step.includes('const toggle = (code: string) => onChange(toggleStateCode(draft, code));'),
  );
  // The chooser shows and toggles the same draft; a chip removes through it too.
  assert.ok(step.includes('selected={draft}'));
  assert.ok(step.includes('onToggle={toggle}'));
  assert.ok(step.includes('<ChosenState key={code} code={code} onRemove={toggle} />'));
  // The chooser keeps no selection of its own: only its query.
  const sheet = codeOnly(STATE_SHEET);
  assert.equal((sheet.match(/useState<readonly string\[\]>/g) ?? []).length, 0);
  // No location permission, no inferred state, no default.
  for (const source of [STATES, STATE_SHEET, ROUTES.states]) {
    for (const forbidden of [
      'expo-location',
      'Location',
      'geolocation',
      'getCurrentPosition',
      "'CA'",
    ]) {
      assert.ok(!codeOnly(source).includes(forbidden), `States reaches ${forbidden}`);
    }
  }
});

test('the composition: one static scene, one search entry, chips, helper and Continue, and none of the P2B7Y controls', () => {
  const code = codeOnly(STATES);
  // Back and progress are the frame's own chrome.
  assert.ok(code.includes('<OnboardingTopBar'));
  assert.ok(code.includes("progress={stepProgress('states')}"));
  assert.ok(codeOnly(FRAME).includes('<OnboardingTopBar back={back} progress={progress} />'));
  // The one production image, whole, at its own aspect ratio, decorative.
  assert.ok(
    code.includes("require('@/assets/brand/production/lotly-states-grocery-atlas-scene.png')"),
  );
  assert.ok(code.includes('<Image source={SCENE} resizeMode="contain" style={styles.fill} />'));
  assert.ok(code.includes('aspectRatio: SCENE_PX.width / SCENE_PX.height,'));
  assert.deepEqual(SCENE_PX, { width: 853, height: 731 });
  const scene = code.slice(
    code.indexOf('<View\n          accessible={false}'),
    code.indexOf('</View>', code.indexOf('<Image source={SCENE}')),
  );
  assert.ok(scene.includes('accessibilityElementsHidden'));
  assert.ok(scene.includes('importantForAccessibility="no-hide-descendants"'));
  assert.ok(scene.includes('pointerEvents="none"'));
  // Nothing is drawn over it: the scene's box holds the image alone.
  assert.equal((scene.match(/</g) ?? []).length, 2, 'something is drawn on the scene');
  for (const forbidden of ['tintColor', 'blurRadius', 'resizeMode="cover"']) {
    assert.ok(!code.includes(forbidden), `the scene uses ${forbidden}`);
  }
  // Available options are listed only in the chooser.
  for (const gone of [
    'StateMap',
    'StateSelectorContent',
    'ModeSwitch',
    'HelperMascot',
    'lotly-mascot-helper',
    'zoom',
    'SelectionCount',
    'stateChoices',
  ]) {
    assert.ok(!code.includes(gone), `the step keeps ${gone}`);
  }
  // Static: no entrance, and no keyboard on the step (the chooser owns the field).
  assert.ok(!code.includes('Animated'));
  assert.ok(!code.includes('TextInput') && !code.includes('<SearchBar'));
});

test('the States type and controls are local, measured and uncapped; the shared scale and Button are unchanged', () => {
  assert.deepEqual(STATES_TYPE.headline, { fontSize: 50, lineHeight: 56 });
  assert.deepEqual(STATES_TYPE.body, { fontSize: 18, lineHeight: 23 });
  assert.deepEqual(STATES_TYPE.cta, { fontSize: 18, lineHeight: 25 });
  assert.equal(CONTROL_MIN_HEIGHT, 51);
  const code = codeOnly(STATES);
  assert.ok(code.includes('style={[styles.body, { maxWidth: bodyMeasure(fontScale) }]}'));
  assert.ok(code.includes('minHeight: CONTROL_MIN_HEIGHT,'));
  // The search entry is a button drawn as the target's outlined field.
  const entry = codeOnly(componentBody(STATES, 'SearchEntry'));
  assert.ok(entry.includes('accessibilityRole="button"'));
  assert.ok(entry.includes('accessibilityLabel={STATES_SEARCH_PLACEHOLDER}'));
  assert.ok(entry.includes('accessibilityHint={STATES_SEARCH_HINT}'));
  assert.ok(code.includes("borderColor: color['action/primary'],"));
  // No width, line or scale cap anywhere on the step or its chooser.
  for (const source of [STATES, STATE_SHEET]) {
    for (const forbidden of ['maxFontSizeMultiplier', 'numberOfLines', 'adjustsFontSizeToFit']) {
      assert.ok(!codeOnly(source).includes(forbidden), `States uses ${forbidden}`);
    }
  }
});

test('at the accessibility sizes a chosen state is a full-width row with its own named 44pt remove button', () => {
  const step = codeOnly(componentBody(STATES, 'StatesStep'));
  assert.ok(step.includes('const chips = chipLayout(fontScale);'));
  assert.ok(step.includes('<ChosenStateRow key={code} code={code} onRemove={toggle} />'));
  const row = codeOnly(componentBody(STATES, 'ChosenStateRow'));
  // The name is text; the remove button is a separate control named for the state.
  assert.ok(row.includes('{stateSpokenName(code)}'));
  assert.ok(row.includes('accessibilityRole="button"'));
  assert.ok(row.includes('accessibilityLabel={removeStateLabel(code)}'));
  const code = codeOnly(STATES);
  const remove = code.slice(
    code.indexOf('remove: {'),
    code.indexOf('},', code.indexOf('remove: {')),
  );
  assert.ok(remove.includes('minWidth: hitTarget.minimum'));
  assert.ok(remove.includes('minHeight: hitTarget.minimum'));
  // The name takes all the width the button leaves: no width cap.
  const text = code.slice(
    code.indexOf('chipRowText: {'),
    code.indexOf('},', code.indexOf('chipRowText: {')),
  );
  assert.ok(text.includes('flex: 1'));
  assert.ok(!text.includes('maxWidth') && !text.includes('width:'));
  // The headline's base follows the text size; the gaps follow the window height.
  assert.ok(step.includes('style={headlineType(fontScale)}'));
  assert.ok(step.includes('const gaps = verticalGaps(height);'));
});

test('every chosen state is a named removal control reaching 44pt without overlapping its neighbours', () => {
  const chosen = codeOnly(componentBody(STATES, 'ChosenState'));
  assert.ok(chosen.includes('accessibilityRole="button"'));
  assert.ok(chosen.includes('accessibilityLabel={removeStateLabel(code)}'));
  assert.ok(chosen.includes('{stateSpokenName(code)}'));
  assert.ok(chosen.includes('hitSlop={{ top: CHIP.hitSlop, bottom: CHIP.hitSlop }}'));
  assert.ok(CHIP.minHeight + 2 * CHIP.hitSlop >= 44, 'a chip target is under 44pt');
  assert.ok(CHIP.rowGap >= 2 * CHIP.hitSlop, 'neighbouring chip targets overlap');
  assert.ok(codeOnly(STATES).includes('rowGap: CHIP.rowGap,'));
  // Every chip is laid out (wrapping, in the scrolling content): all reachable.
  assert.ok(codeOnly(STATES).includes('{draft.map((code) =>'));
  assert.ok(codeOnly(STATES).includes("flexWrap: 'wrap',"));
});

test('the chooser: the Retailers sheet pattern, a focused and named field, the shared rows, and every way out keeps the choices', () => {
  const sheet = codeOnly(STATE_SHEET);
  assert.ok(sheet.includes('<Modal'));
  assert.ok(sheet.includes('accessibilityViewIsModal'));
  assert.ok(sheet.includes('onRequestClose={close}'));
  assert.ok(sheet.includes('onShow={onShow}'));
  assert.ok(sheet.includes('onDismiss();\n        onClosed?.();'));
  // The same backdrop and motion as the Stores search, off under Reduce Motion.
  assert.ok(sheet.includes("from '@/lib/retailer-grid'"));
  assert.ok(sheet.includes('SHEET_BACKDROP_OPACITY'));
  assert.ok(sheet.includes('useSheetMotion(visible)'), 'the sheet left the shared motion rule');
  // The field: focused, named apart from its placeholder, with a hint.
  assert.ok(sheet.includes('autoFocus'));
  assert.ok(sheet.includes('accessibilityLabel={STATES_SEARCH_PLACEHOLDER}'));
  assert.ok(sheet.includes('accessibilityHint={STATES_FIELD_HINT}'));
  // The results: the shared rows over the shared catalog, and an empty result said.
  assert.ok(sheet.includes('const results = searchStateChoices(query);'));
  assert.ok(sheet.includes('<CheckRow'));
  assert.ok(sheet.includes('checked={selected.includes(choice.code)}'));
  assert.ok(sheet.includes('{NO_STATES_FOUND}'));
  assert.ok(sheet.includes('automaticallyAdjustKeyboardInsets'));
  assert.ok(sheet.includes('keyboardDismissMode="on-drag"'));
  // Close and Done both only close.
  assert.ok(sheet.includes('label={SEARCH_DONE_LABEL}'));
  assert.ok(sheet.includes('accessibilityLabel={SEARCH_CLOSE_LABEL}'));
  assert.equal((sheet.match(/onPress=\{onClose\}/g) ?? []).length, 2);
  // Focus returns to the search entry once the sheet has gone.
  const step = codeOnly(componentBody(STATES, 'StatesStep'));
  assert.ok(step.includes('onClosed={focusEntry}'));
  assert.ok(step.includes('AccessibilityInfo.setAccessibilityFocus(tag)'));
  // Its words.
  assert.equal(STATES_CHOOSER_TITLE, 'Choose states');
  assert.equal(STATES_FIELD_HINT, 'Filters the states below by name or abbreviation.');
  assert.equal(STATES_SEARCH_HINT, 'Opens the list of states. Check every state you choose.');
  assert.equal(NO_STATES_FOUND, 'No state matches that search.');
  assert.equal(statesFoundAnnouncement(0), 'No state matches that search.');
  assert.equal(statesFoundAnnouncement(1), '1 state found.');
  assert.equal(statesFoundAnnouncement(3), '3 states found.');
});

test('the States screen borrows no severity, relevance or harm palette', () => {
  for (const [name, source] of [
    ['states', STATES],
    ['states chooser', STATE_SHEET],
    ['state map', STATE_MAP],
    ['progress', PROGRESS],
  ] as const) {
    const code = codeOnly(source);
    for (const forbidden of [
      'riskPalette',
      'relevancePalette',
      'harmNoticePalette',
      "'risk/",
      "'relevance/",
      'background/accent',
      'action/accent',
    ]) {
      assert.ok(!code.includes(forbidden), `${name} uses ${forbidden}`);
    }
  }
});

test('Back, Continue and the resume point are exactly as before', () => {
  const route = codeOnly(ROUTES.states);
  assert.ok(route.includes("void access.recordShownStep('states');"));
  assert.ok(route.includes('onChange={(codes) => update(withStates(prefs, codes))}'));
  assert.ok(route.includes("onContinue={() => router.push(onboardingRoute('allergens'))}"));
  assert.ok(route.includes("onBack={() => goBackFrom('states', router)}"));
  const step = codeOnly(componentBody(STATES, 'StatesStep'));
  assert.ok(step.includes('back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}'));
  assert.ok(step.includes('onPress={onContinue}'));
});

// ── P2B7Y closeout ──────────────────────────────────────────────────────────

test('the settings sheet keeps its Done wording for Clear selection', () => {
  // The grocery-atlas States has no Clear selection (chips remove one state
  // each), so the onboarding-only hint went with it (2026-09-30); the sheet's
  // own wording, true there, is unchanged.
  assert.equal(CLEAR_SELECTION_LABEL, 'Clear selection');
  assert.ok(!codeOnly(STATES).includes('STATE_CLEAR_HINT'));
  assert.ok(!codeOnly(STATES).includes('CLEAR_SELECTION_LABEL'));
  // The shared selector keeps the sheet's own words as its default, so the
  // settings sheet (which passes nothing) is unchanged.
  const content = codeOnly(componentBody(FORM, 'StateSelectorContent'));
  assert.ok(content.includes('clearHint = STATE_CLEAR_HINT,'));
  assert.ok(content.includes('accessibilityHint={clearHint}'));
  assert.equal(STATE_CLEAR_HINT, 'Unchecks every state. Nothing is saved until you press Done.');
  const sheet = codeOnly(componentBody(FORM, 'StateSelector'));
  assert.ok(!sheet.includes('clearHint'), 'the settings sheet overrides its own hint');
});

test('under Reduce Motion every route dissolves instead of sliding, set once for the whole stack', () => {
  const layout = codeOnly(read('app', '_layout.tsx'));
  assert.ok(layout.includes('const reduceMotion = useReduceMotion();'));
  assert.ok(layout.includes("animation: reduceMotion === true ? 'fade' : 'default',"));
  // One central option, no per-screen timing or navigation workaround.
  assert.equal((layout.match(/animation:/g) ?? []).length, 1);
  for (const [name, source] of Object.entries(ROUTES)) {
    assert.ok(!codeOnly(source).includes('animation'), `${name} sets its own animation`);
  }
});

test('the approved States mock-up is a design reference only: nothing bundles it', () => {
  const reference = 'lotly-onboarding-states-map-target.png';
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|json)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        if (readFileSync(path, 'utf8').includes(reference)) hits.push(path);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(hits, []);
  assert.ok(!readFileSync(join(SRC, '..', 'app.json'), 'utf8').includes('brand/reference'));
});

// ── P2B7Z: the Allergens grid ───────────────────────────────────────────────

test('each allergen tile is ONE checkbox element: its full name, its state, the whole tile its target', () => {
  const tile = codeOnly(componentBody(ALLERGENS, 'AllergenTile'));
  assert.equal((tile.match(/accessibilityRole=/g) ?? []).length, 1, 'a second element in a tile');
  assert.ok(tile.includes('accessibilityRole="checkbox"'));
  assert.ok(tile.includes('accessibilityLabel={option.label}'));
  assert.ok(tile.includes('accessibilityState={{ checked }}'));
  assert.ok(tile.includes('onPress={onPress}'));
  // Only the outer Pressable presses: nothing inside is its own target.
  assert.equal((tile.match(/<Pressable/g) ?? []).length, 1);
  assert.equal((tile.match(/onPress=/g) ?? []).length, 1);
  // The label is the full canonical name — no short form (the mock-up's
  // `Shellfish`) and no truncation.
  assert.ok(tile.includes('{option.label}'));
  assert.ok(!ALLERGENS.includes("'Shellfish'"));
});

test('the pictogram and the drawn check inside a tile are hidden from assistive technology', () => {
  const tile = codeOnly(componentBody(ALLERGENS, 'AllergenTile'));
  const hidden =
    /<View\s+accessible=\{false\}\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"[^>]*>\s*(<[A-Za-z]+)/g;
  const wrapped = [...tile.matchAll(hidden)].map((m) => m[1]);
  assert.deepEqual(wrapped, ['<Image', '<CheckIndicator']);
  // The surfaces are plain views with no role or label of their own.
  const layers = tile.slice(tile.indexOf('styles.layerOpen'), tile.indexOf('{stacked ? ('));
  assert.ok(layers.length > 0);
  assert.ok(!layers.includes('accessib'));
});

test('selecting changes colour and opacity only: the tile keeps its size, and colour is never alone', () => {
  const tile = codeOnly(componentBody(ALLERGENS, 'AllergenTile'));
  // No style of the tile or its content depends on the state …
  assert.ok(
    tile.includes(
      '<View style={[styles.tile, stacked && styles.tileStacked, pressed && styles.pressed]}>',
    ),
  );
  assert.ok(!tile.includes('checked &&'), 'a checked-only style reached the tile');
  // … the chosen surface is a layer over the open one, shown by opacity …
  assert.ok(tile.includes('<View style={[styles.layer, styles.layerOpen]} />'));
  assert.ok(
    tile.includes(
      '<Animated.View style={[styles.layer, styles.layerChosen, { opacity: fill }]} />',
    ),
  );
  const code = codeOnly(ALLERGENS);
  assert.ok(code.includes("position: 'absolute',"));
  // … in the existing soft blue and navy, over the existing page surfaces …
  assert.ok(code.includes("backgroundColor: color['background/subtle'],"));
  assert.ok(code.includes("borderColor: color['action/primary'],"));
  assert.ok(code.includes("backgroundColor: color['background/surface'],"));
  // … and the shared checkbox draws the check, a channel besides colour.
  assert.ok(tile.includes('<CheckIndicator checked={checked} fill={fill} />'));
  const indicator = codeOnly(
    componentBody(read('components', 'ui', 'check-row.tsx'), 'CheckIndicator'),
  );
  assert.ok(indicator.includes('<View style={styles.mark} />'));
  assert.ok(indicator.includes('opacity: fill ?? (checked ? 1 : 0)'));
  // No decoration beyond the system: no shadow, gradient, blur or mascot.
  for (const forbidden of [
    'shadow',
    'elevation',
    'LinearGradient',
    'BlurView',
    'lotly-mascot',
    'riskPalette',
    'relevancePalette',
    "'risk/",
  ]) {
    assert.ok(!code.includes(forbidden), `the allergen step uses ${forbidden}`);
  }
  // One picture per tile, from the pictogram map: no Icon, no other image,
  // no asset path of the step's own.
  assert.ok(!code.includes('<Icon '));
  assert.equal((code.match(/<Image/g) ?? []).length, 1);
  assert.ok(!code.includes('require('));
});

test('the grid takes its column count from the shared rule, and pads a short last row', () => {
  const step = codeOnly(componentBody(ALLERGENS, 'AllergenGrid'));
  assert.ok(step.includes('const { width, fontScale } = useWindowDimensions();'));
  assert.ok(step.includes('const columns = allergenGridColumns(width, fontScale);'));
  assert.ok(step.includes('const stacked = allergenTileStacked(width, fontScale);'));
  // A stacked tile keeps every part — the glyph and check above, the label beneath.
  const tile = codeOnly(componentBody(ALLERGENS, 'AllergenTile'));
  assert.ok(
    tile.includes(
      '{pictogram}\n                {check}\n              </View>\n              {label}',
    ),
  );
  assert.ok(tile.includes('{pictogram}\n              {label}\n              {check}'));
  assert.ok(step.includes('{row.length < columns ? <View style={styles.gridSpacer} /> : null}'));
  // The count sits beside Clear, stacking only in the one-column layout.
  assert.ok(step.includes('style={[styles.countRow, columns === 1 && styles.countRowStacked]}'));
  // The tile draws from the geometry the rule measured against.
  const code = codeOnly(ALLERGENS);
  for (const key of ['gap', 'minHeight', 'paddingHorizontal', 'paddingVertical']) {
    assert.ok(code.includes(`${key}: TILE.${key},`), `the tile's ${key} left the shared geometry`);
  }
});

test('each tile draws its allergen’s Lotly pictogram whole, untinted and inert, in a fixed 44pt box', () => {
  const tile = codeOnly(componentBody(ALLERGENS, 'AllergenTile'));
  const start = tile.indexOf('const pictogram = (');
  const pictogram = tile.slice(start, tile.indexOf('const check = (', start));
  assert.ok(start >= 0 && pictogram.length > 0);
  // The production map, keyed by the canonical token (allergen-assets.test.ts
  // pins the nine pairs) — the same source whether or not the tile is chosen.
  assert.ok(pictogram.includes('source={allergenPictogram(option.token) ?? undefined}'));
  assert.ok(!pictogram.includes('checked'), 'the pictogram depends on the selection');
  assert.ok(ALLERGENS.includes("import { allergenPictogram } from '@/lib/allergen-assets';"));
  assert.ok(!ALLERGENS.includes('AllergenGlyph'), 'the Lucide glyph is still requested');
  // Drawn whole, never tinted, dimmed or animated; decorative and untouchable,
  // so the tile stays one checkbox element and one target.
  assert.ok(pictogram.includes('resizeMode="contain"'));
  assert.ok(pictogram.includes('accessible={false}\n        style={styles.pictogramImage}'));
  assert.ok(pictogram.includes('pointerEvents="none"'));
  for (const forbidden of ['tintColor', 'opacity', 'Animated', 'fill']) {
    assert.ok(!pictogram.includes(forbidden), `the pictogram uses ${forbidden}`);
  }
  // A fixed 44pt box at every size, so every label starts at one x; only its
  // transparent sides overhang the padding and gap (allergen-grid.ts).
  const code = codeOnly(ALLERGENS);
  const box = code.slice(code.indexOf('  pictogram: {'), code.indexOf('  label: {'));
  assert.ok(box.includes('width: TILE.pictogram,\n    height: TILE.pictogram,'));
  assert.ok(box.includes('marginHorizontal: -TILE.pictogramOverhang,'));
  assert.ok(!box.includes('tint') && !box.includes('background') && !box.includes('border'));
  assert.equal(TILE.pictogram, 44);
});

test('Clear on Allergens is a compact action that says what it does here', () => {
  const clear = codeOnly(componentBody(ALLERGENS, 'ClearAction'));
  assert.ok(clear.includes('accessibilityRole="button"'));
  assert.ok(clear.includes('accessibilityHint={CLEAR_ALLERGENS_HINT}'));
  assert.ok(clear.includes('accessibilityState={{ disabled }}'));
  assert.ok(clear.includes('variant="body-small-bold"'));
  assert.equal(ONBOARDING_COPY.CLEAR_ALLERGENS_HINT, 'Unchecks every allergen.');
  // The interactive colour while it can act, the secondary text when it cannot.
  assert.ok(clear.includes("color={disabled ? 'text/secondary' : 'action/secondary'}"));
  // A plain text action: never underlined, and no border or fill of its own.
  const code = codeOnly(ALLERGENS);
  assert.ok(!code.includes('textDecoration'), 'Clear selection is underlined');
  const clearStyle = code.slice(
    code.indexOf('  clear: {'),
    code.indexOf('},', code.indexOf('  clear: {')),
  );
  for (const forbidden of ['border', 'backgroundColor']) {
    assert.ok(!clearStyle.includes(forbidden), `Clear selection has a ${forbidden}`);
  }
  // Not the full-width Button any more, and still a full target.
  assert.ok(!clear.includes('<Button'));
  assert.ok(codeOnly(ALLERGENS).includes('minHeight: hitTarget.minimum,'));
});

test('a selection fades briefly, moves nothing, and is immediate under Reduce Motion', () => {
  const tile = codeOnly(componentBody(ALLERGENS, 'AllergenTile'));
  assert.ok(
    tile.includes('if (!motionAllowed(reduceMotion)) {\n      fill.setValue(to);\n      return;'),
  );
  assert.ok(tile.includes('duration: SELECTION_FADE_MS,'));
  assert.ok(tile.includes('useNativeDriver: true'));
  assert.ok(codeOnly(ALLERGENS).includes('export const SELECTION_FADE_MS = 150;'));
  // The only animated property is opacity.
  const code = codeOnly(ALLERGENS);
  for (const forbidden of [
    'Animated.loop',
    'Animated.spring',
    'Animated.sequence',
    'iterations',
    'transform',
    'scale',
    'translate',
  ]) {
    assert.ok(!code.includes(forbidden), `the allergen step uses ${forbidden}`);
  }
  assert.ok(codeOnly(ALLERGENS).includes('const reduceMotion = useReduceMotion();'));
});

test('Allergens: Continue is always enabled, and Back, Continue and the resume point are as before', () => {
  const route = codeOnly(ROUTES.allergens);
  assert.ok(route.includes("void access.recordShownStep('allergens');"));
  assert.ok(route.includes('onToggle={(token) => update(toggleAllergen(prefs, token))}'));
  assert.ok(route.includes("onContinue={() => router.push(onboardingRoute('retailers'))}"));
  assert.ok(route.includes("onBack={() => goBackFrom('allergens', router)}"));
  const step = codeOnly(componentBody(ALLERGENS, 'AllergensStep'));
  assert.ok(step.includes('footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}'));
  assert.ok(step.includes('back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}'));
  assert.ok(step.includes("progress={stepProgress('allergens')}"));
  assert.equal(
    progressAccessibilityLabel(stepProgress('allergens')!),
    'Onboarding progress, step 4 of 5',
  );
});

test('the approved Allergens mock-up is a design reference only: nothing bundles it', () => {
  const reference = 'lotly-onboarding-allergens-grid-target.png';
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|json)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        if (readFileSync(path, 'utf8').includes(reference)) hits.push(path);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(hits, []);
  assert.ok(!codeOnly(ALLERGENS).includes('brand/reference'));
});

// ── Stores: the receipt (2026-09-30; Popular stores and search 2026-09-24) ──

test('Stores is one screen: six quick choices from the curated list on the receipt, with no second mode', () => {
  // No mode, no way to another presentation, no full-catalog directory, and
  // none of the retired grid: tiles, columns, the `Not listed?` field, M03.
  for (const gone of [
    'mode',
    'setMode',
    'RetailersMode',
    'initialMode',
    'StoreSelectorContent',
    'Back to popular',
    'BACK_TO_POPULAR',
    'chevron-right',
    'CheckRow',
    'RetailerGrid',
    'RetailerTile',
    'retailerGridColumns',
    'SearchTrigger',
    'SEARCH_ALL_STORES_PLACEHOLDER',
    'ReadyMascot',
    'lotly-mascot-ready-1024',
    'OnboardingFrame',
    'aside=',
    'See more',
    'Show fewer',
  ]) {
    assert.ok(!codeOnly(RETAILERS).includes(gone), `the step still has ${gone}`);
  }
  assert.ok(!ROUTES.retailers.includes('initialMode'));
  // Every quick choice, as a row, from the one typed list and nothing else.
  const receipt = codeOnly(componentBody(RETAILERS, 'ReceiptContent'));
  assert.ok(receipt.includes('{POPULAR_RETAILERS.map((retailer) => ('));
  assert.ok(receipt.includes('<StoreRow\n'));
  assert.ok(receipt.includes('checked={selected.includes(retailer.id)}'));
  assert.ok(receipt.includes('onPress={() => onToggle(retailer.id)}'));
  assert.deepEqual(
    POPULAR_RETAILERS.map((retailer) => retailer.name),
    ['Walmart', 'Costco', 'Kroger', 'Aldi', 'Target', "Trader Joe's"],
  );
  // The heading is `Popular stores`, a header; no rank, number or size claim.
  assert.ok(receipt.includes('accessibilityRole="header" style={receiptHeadingType(fontScale)}'));
  assert.ok(receipt.includes('{POPULAR_STORES_LABEL}'));
  for (const forbidden of ['largest', 'biggest', 'top 10', 'top 6', 'ranked', 'near']) {
    assert.ok(!RETAILERS.toLowerCase().includes(`'${forbidden}`), `the step claims ${forbidden}`);
  }
  // Heading, count, a rule, the six each followed by a rule, then the search.
  const order = [
    '{POPULAR_STORES_LABEL}',
    '<ClearAction onPress={onClear} />',
    '<DottedRule />',
    '<StoreRow',
    '<SearchAction ref={searchRef} onPress={onSearch} />',
  ].map((token) => receipt.indexOf(token));
  assert.deepEqual(
    order,
    [...order].sort((x, y) => x - y),
    'the receipt is out of order',
  );
  assert.ok(order.every((index) => index >= 0));
});

test('each quick choice is ONE checkbox row: the canonical name, its state, the whole row its 44pt target', () => {
  const row = codeOnly(componentBody(RETAILERS, 'StoreRow'));
  assert.equal((row.match(/accessibilityRole=/g) ?? []).length, 1, 'a second element in a row');
  assert.ok(row.includes('accessibilityRole="checkbox"'));
  assert.ok(row.includes('accessibilityLabel={retailer.name}'));
  assert.ok(row.includes('accessibilityState={{ checked }}'));
  assert.equal((row.match(/<Pressable/g) ?? []).length, 1);
  assert.equal((row.match(/onPress=/g) ?? []).length, 1);
  // The name is the catalog's own, in full: no short form, no truncation.
  assert.ok(row.includes('{retailer.name}'));
  // The shared checkbox (navy and white when chosen, outlined when not),
  // hidden, so only the row speaks; colour is never alone.
  assert.ok(
    row.includes(
      '<View\n        accessible={false}\n        accessibilityElementsHidden\n        importantForAccessibility="no-hide-descendants">\n        <CheckIndicator checked={checked} fill={fill} />',
    ),
  );
  assert.ok(!row.includes('checked &&'), 'a checked-only style reached the row');
  // Holding a row changes nothing: no pressed dimming or highlight; only a
  // completed tap (the one `onPress`) toggles it.
  assert.ok(row.includes('style={styles.row}>'));
  assert.ok(!/\bpressed\b/.test(row), 'a quick choice dims or highlights while held');
  // Every row, and the search action, is at least 44pt; no hitSlop, so the
  // targets never overlap (the rows sit between 1pt rules).
  const code = codeOnly(RETAILERS);
  assert.ok(code.includes('minHeight: ROW_MIN_HEIGHT,'));
  assert.equal(ROW_MIN_HEIGHT, 44);
  assert.ok(!row.includes('hitSlop'));
  assert.ok(!codeOnly(componentBody(RETAILERS, 'SearchAction')).includes('hitSlop'));
  // Motion: opacity only, and immediate under Reduce Motion.
  assert.ok(
    row.includes('if (!motionAllowed(reduceMotion)) {\n      fill.setValue(to);\n      return;'),
  );
  assert.ok(code.includes('export const SELECTION_FADE_MS = 150;'));
  for (const forbidden of ['Animated.loop', 'Animated.spring', 'iterations', 'transform']) {
    assert.ok(!code.includes(forbidden), `the stores step uses ${forbidden}`);
  }
});

test('quick choices carry no retailer mark, monogram, glyph or brand colour, and no logo mechanism was added', () => {
  const row = codeOnly(componentBody(RETAILERS, 'StoreRow'));
  for (const forbidden of [
    '<Image',
    '<Icon',
    'RetailerLogo',
    'require(',
    'uri',
    "'home'",
    'charAt',
  ]) {
    assert.ok(!row.includes(forbidden), `a quick choice draws ${forbidden}`);
  }
  const code = codeOnly(RETAILERS);
  assert.ok(!code.includes('retailer-logo'), 'the step reaches the logo pipeline');
  assert.ok(!code.includes('uri:') && !code.includes('http'), 'the step fetches an image');
  for (const forbidden of [
    'shadow',
    'elevation',
    'LinearGradient',
    'BlurView',
    'riskPalette',
    'Modal',
    "color['background/subtle']",
  ]) {
    assert.ok(!code.includes(forbidden), `the stores step uses ${forbidden}`);
  }
  // The pipeline is untouched: nothing in the manifest, no bundled marks.
  assert.deepEqual(retailerLogoCoverage().withLogo, []);
  assert.ok(!existsSync(join(SRC, '..', 'assets', 'retailer-logos')), 'retailer marks were added');
  const logo = codeOnly(read('components', 'ui', 'retailer-logo.tsx'));
  assert.ok(logo.includes('const MARKS: Readonly<Record<string, ImageSourcePropType>> = {};'));
});

test('the count row on the receipt: quiet, derived from the saved selection, and its slot never comes or goes', () => {
  const receipt = codeOnly(componentBody(RETAILERS, 'ReceiptContent'));
  // No summary surface, chips or their copy.
  for (const gone of ['SelectedStores', 'chipScroll', 'removeStoreLabel', 'yourStoresTitle']) {
    assert.ok(!codeOnly(RETAILERS).includes(gone), `Stores still has ${gone}`);
  }
  // Printed as the target prints it, spoken in full; it covers search-only
  // choices too, because it reads the whole saved selection.
  assert.ok(receipt.includes('const none = selected.length === 0;'));
  assert.ok(receipt.includes('{storesCountShort(selected.length)}'));
  assert.ok(receipt.includes('accessibilityLabel={storesCountLabel(selected.length)}'));
  assert.ok(receipt.includes('<ClearAction onPress={onClear} />'));
  // The SLOT is always laid out; only its visibility follows the selection.
  assert.ok(receipt.includes('style={[styles.countRow, none && styles.countRowIdle]}'));
  assert.ok(receipt.includes('accessibilityElementsHidden={none}'));
  assert.ok(!/none \? \(|selected\.length > 0 \? \(/.test(receipt), 'the row mounts conditionally');
  assert.ok(/countRowIdle: \{\s*opacity: 0,\s*\}/.test(RETAILERS));
  assert.ok(!/countRow: \{[^}]*backgroundColor/s.test(RETAILERS), 'the count row grew a surface');
  // Clear's 44pt target comes from hitSlop, kept clear of the first row's.
  assert.ok(codeOnly(RETAILERS).includes('marginBottom: COUNT_GAP,'));
  assert.ok(COUNT_GAP > Math.ceil((44 - STORES_TYPE.count.lineHeight) / 2));
  // Clear is still a TRUE no-op with nothing chosen.
  const step = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  assert.ok(step.includes('if (selected.length === 0) return;'));
  assert.ok(step.includes('onClear={clear}'));
});

test('Search all stores is the receipt’s last row: blue text and a blue magnifier, a button with no box, field or chevron', () => {
  const action = codeOnly(componentBody(RETAILERS, 'SearchAction'));
  assert.ok(action.includes('accessibilityRole="button"'));
  assert.ok(action.includes('accessibilityLabel={SEARCH_ALL_STORES_LABEL}'));
  assert.ok(action.includes('accessibilityHint={SEARCH_ALL_STORES_HINT}'));
  assert.ok(action.includes('color="action/secondary"'));
  assert.ok(action.includes('{SEARCH_ALL_STORES_LABEL}'));
  assert.ok(action.includes('<Icon name="search" size={ROW_CHROME.check} color="icon/brand" />'));
  assert.ok(action.indexOf('{SEARCH_ALL_STORES_LABEL}') < action.indexOf('<Icon'));
  // One row: the label is a flexible text column that wraps within itself,
  // and the magnifier a fixed column to its right, vertically centred. Nothing
  // lets the icon wrap beneath the label.
  assert.ok(action.includes('style={[STORES_TYPE.search, styles.rowText]}'));
  const stepCode = codeOnly(RETAILERS);
  const rowStyle = stepCode.slice(
    stepCode.indexOf('  row: {'),
    stepCode.indexOf('},', stepCode.indexOf('  row: {')),
  );
  assert.ok(rowStyle.includes("flexDirection: 'row',"));
  assert.ok(rowStyle.includes("alignItems: 'center',"));
  assert.ok(!rowStyle.includes('flexWrap'), 'the search row can wrap its icon beneath the label');
  assert.ok(/rowText: \{\s*flex: 1,\s*\}/.test(RETAILERS));
  for (const forbidden of ['<Surface', 'borderWidth', 'elevation']) {
    assert.ok(!action.includes(forbidden), `the search action is drawn with ${forbidden}`);
  }
  const step = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  assert.ok(step.includes('onSearch={() => setSearchOpen(true)}'));
  // A button, never a second editable field, and never a way to another screen.
  const code = codeOnly(RETAILERS);
  for (const forbidden of ['<TextInput', '<SearchBar', 'chevron-right', 'router', 'Link']) {
    assert.ok(!code.includes(forbidden), `the step has ${forbidden}`);
  }
});

test('the receipt illustration: three approved layers, decorative, the paper growing upward from its anchored foot', () => {
  const code = codeOnly(RETAILERS);
  const requires = code.match(/require\('[^']+'\)/g) ?? [];
  assert.deepEqual(requires, [
    "require('@/assets/brand/production/lotly-stores-receipt-scene.png')",
    "require('@/assets/brand/production/lotly-stores-receipt-paper.png')",
    "require('@/assets/brand/production/lotly-stores-receipt-overlap.png')",
  ]);
  // Decorative everywhere: out of the tree and out of the way of touches.
  assert.ok(
    code.includes(
      "const DECORATIVE = {\n  accessible: false,\n  accessibilityElementsHidden: true,\n  importantForAccessibility: 'no-hide-descendants',\n  pointerEvents: 'none',\n} as const;",
    ),
  );
  assert.equal(
    (code.match(/<Image\b/g) ?? []).length,
    (code.match(/\{\.\.\.DECORATIVE\}/g) ?? []).length - 1,
    'an image outside a decorative wrapper (the rule is the other one)',
  );
  // One scale for all three layers; the scene pinned to the bottom of a box
  // at least as tall as it; the paper bottom-aligned above its anchor gap,
  // so it grows UP and the box (and the scene with it) moves down.
  const art = codeOnly(componentBody(RETAILERS, 'Illustration'));
  assert.ok(art.includes('const scale = sceneScale(width);'));
  assert.ok(art.includes('minHeight: SCENE_PX.height * scale,'));
  assert.ok(art.includes('paddingBottom: PAPER_PX.bottomGap * scale,'));
  assert.ok(art.includes("justifyContent: 'flex-end',"));
  assert.ok(art.includes('{ width, height: SCENE_PX.height * scale, left: 0, bottom: 0 }'));
  assert.ok(art.includes('paddingTop: PAPER_CLEARANCE,'));
  // The paper: never shorter than exported, torn top and foot 1:1, and only
  // the slice stretched; the overlap fixed to its bottom, under the contents.
  const paper = codeOnly(componentBody(RETAILERS, 'ReceiptPaper'));
  assert.ok(paper.includes('minHeight: paperHeight,'));
  assert.ok(paper.includes('resizeMode="stretch"'));
  assert.equal((paper.match(/resizeMode=/g) ?? []).length, 1, 'more than the slice stretches');
  assert.ok(paper.includes('bottom: OVERLAP_PX.bottom * scale,'));
  assert.ok(paper.indexOf('<Image source={OVERLAP}') < paper.indexOf('{children}'));
  // Stacked from the accessibility sizes: the illustration whole (all three
  // layers, blank), then the paper alone holding the receipt.
  const step = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  assert.ok(step.includes("const stacked = receiptLayout(fontScale) === 'stacked';"));
  assert.ok(step.includes('<Illustration width={sceneWidth} />'));
  assert.ok(step.includes('<Illustration width={sceneWidth}>{receipt}</Illustration>'));
  assert.ok(step.includes('slice={STACKED_SLICE_PX}>'));
  assert.equal((code.match(/<Image source=\{SCENE\}/g) ?? []).length, 1, 'the scene drawn twice');
  // Static: no entrance, and the art is never tinted or cropped to fit.
  for (const forbidden of ['tintColor', "'cover'", 'MASCOT_ENTRANCE', 'Animated.View']) {
    assert.ok(!code.includes(forbidden), `the illustration uses ${forbidden}`);
  }
});

test('the search is ONE sheet over the step, which stays mounted: a transparent Modal, no dependency, no second sheet', () => {
  const step = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  // Mounted alongside the step, never instead of it: nothing is swapped out.
  assert.ok(step.includes('<RetailerSearchSheet\n        visible={searchOpen}'));
  assert.ok(
    !/searchOpen \?|searchOpen &&/.test(step),
    'the step renders differently while searching',
  );
  assert.ok(step.includes('onClose={() => setSearchOpen(false)}'));
  assert.ok(step.includes('onClosed={focusSearch}'));
  // Focus goes back to `Search all stores` once the sheet has gone.
  assert.ok(step.includes('AccessibilityInfo.setAccessibilityFocus(tag)'));
  // A React Native Modal: the step behind takes no touch and is hidden from
  // assistive technology for as long as it is presented.
  const sheet = codeOnly(SEARCH_SHEET);
  assert.ok(
    sheet.includes('<Modal\n      visible={shown}\n      transparent\n      animationType="none"'),
  );
  assert.ok(sheet.includes('accessibilityViewIsModal'));
  assert.ok(sheet.includes("from 'react-native';"));
  for (const forbidden of [
    '@gorhom',
    'react-native-reanimated',
    'react-native-modal',
    '@expo/ui',
  ]) {
    assert.ok(!sheet.includes(forbidden), `the sheet uses ${forbidden}`);
  }
  const pkg = JSON.parse(read('..', 'package.json')) as { dependencies: Record<string, string> };
  for (const name of ['@gorhom/bottom-sheet', 'react-native-modal', 'react-native-reanimated']) {
    assert.ok(!(name in pkg.dependencies), `${name} was added`);
  }
  // One sheet: the Retailers search is its only user, and nothing else
  // in onboarding presents a Modal of its own.
  for (const [name, source] of [
    ['welcome', WELCOME],
    ['states', STATES],
    ['allergens', ALLERGENS],
    ['retailers', RETAILERS],
    ['preview', PREVIEW],
  ] as const) {
    assert.ok(!codeOnly(source).includes('<Modal'), `${name} presents a Modal`);
  }
});

test('the sheet’s frame is fixed by the window and text size: backdrop, rounded opaque surface, handle, and a pinned Done', () => {
  const sheet = codeOnly(SEARCH_SHEET);
  const main = codeOnly(componentBody(SEARCH_SHEET, 'RetailerSearchSheet'));
  assert.ok(main.includes('const top = searchSheetTop(height, insets.top, fontScale);'));
  // The top edge is its only size input, and the sheet runs to the bottom.
  const block = (name: string) =>
    sheet.slice(sheet.indexOf(`  ${name}: {`), sheet.indexOf('},', sheet.indexOf(`  ${name}: {`)));
  const frame = block('sheet');
  assert.ok(frame.includes("position: 'absolute',"));
  assert.ok(frame.includes('bottom: 0,'));
  assert.ok(!/height|maxHeight|minHeight/.test(frame), 'the sheet sizes itself');
  assert.ok(frame.includes("backgroundColor: color['background/page'],"));
  assert.ok(frame.includes('borderTopLeftRadius: radius[16],'));
  assert.ok(frame.includes('borderTopRightRadius: radius[16],'));
  // The one region that changes fills what the fixed parts leave.
  assert.ok(block('results').includes('flex: 1,'));
  // A neutral dim over the whole step, from the palette, and no glass.
  const backdrop = block('backdrop');
  assert.ok(backdrop.includes("backgroundColor: color['text/primary'],"));
  assert.ok(main.includes('outputRange: [0, SHEET_BACKDROP_OPACITY]'));
  for (const forbidden of ['LinearGradient', 'BlurView', 'shadow', 'rgba(', '#']) {
    assert.ok(!sheet.includes(forbidden), `the sheet uses ${forbidden}`);
  }
  // The hierarchy, in order: handle, heading and Close, field, results, Done.
  const contents = codeOnly(componentBody(SEARCH_SHEET, 'SheetContents'));
  const order = [
    'style={styles.handle}',
    'accessibilityRole="header"',
    'accessibilityLabel={SEARCH_CLOSE_LABEL}',
    '<SearchBar',
    'style={styles.results}',
    'label={SEARCH_DONE_LABEL}',
  ].map((marker) => contents.indexOf(marker));
  assert.ok(
    order.every((index) => index >= 0),
    `a part is missing: ${order.join(', ')}`,
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'the sheet’s parts are out of order',
  );
  // The drag indicator is decoration only.
  const handle = contents.slice(contents.indexOf('<View\n        style={styles.handle}'));
  assert.ok(handle.slice(0, 200).includes('importantForAccessibility="no-hide-descendants"'));
  // Done sits over the bottom inset.
  assert.ok(contents.includes('paddingBottom: bottomInset + spacing[12]'));
});

test('the field autofocuses, the empty sheet instructs, a query finds single-column rows, and no match is one line', () => {
  const contents = codeOnly(componentBody(SEARCH_SHEET, 'SheetContents'));
  const field = contents.slice(
    contents.indexOf('<SearchBar'),
    contents.indexOf('/>', contents.indexOf('<SearchBar')),
  );
  assert.ok(field.includes('placeholder={SEARCH_STORES_LABEL}'));
  assert.ok(field.includes('accessibilityLabel={SEARCH_STORES_LABEL}'));
  // The Stores step focuses the field; the editor's catalog opens on its list.
  assert.ok(field.includes('autoFocus={!catalog}'));
  // The shared Search Bar, whose `Clear` exists only while there is text.
  assert.ok(codeOnly(read('components', 'ui', 'search-bar.tsx')).includes("{value !== '' ? ("));
  // Matched by the catalog rule. On the Stores step nothing is listed before
  // a query; the editor's catalog lists the whole canonical catalog instead.
  assert.ok(contents.includes('const typed = retailerSearchResults(query);'));
  assert.ok(
    contents.includes("const results = catalog && typed === null ? searchRetailers('') : typed;"),
  );
  assert.ok(
    contents.includes(
      '{results === null ? (\n          <Text variant="body-small" color="text/secondary">\n            {SEARCH_INSTRUCTION}',
    ),
  );
  assert.ok(
    contents.includes(
      ') : results.length === 0 ? (\n          <Text variant="body-small" color="text/secondary">\n            {NO_STORES_FOUND}',
    ),
  );
  assert.ok(
    !codeOnly(SEARCH_SHEET).includes('RETAILER_CATALOG'),
    'the sheet lists the catalog itself',
  );
  // Results are rows, one per line, scrolling inside the fixed region — or,
  // in the editor's catalog, rows of the catalog's columns.
  assert.ok(contents.includes('results.map((retailer) => (\n            <RetailerResultRow'));
  assert.ok(contents.includes('catalogRows(results, columns).map((row) => ('));
  const scroll = contents.slice(
    contents.indexOf('<ScrollView'),
    contents.indexOf('>', contents.indexOf('keyboardDismissMode')),
  );
  assert.ok(scroll.includes('keyboardShouldPersistTaps="handled"'));
  assert.ok(scroll.includes('automaticallyAdjustKeyboardInsets'));
  assert.ok(!contents.includes('horizontal'));
  // What was found is announced once per change, never on a re-render, and
  // never for the catalog shown before a query.
  assert.ok(contents.includes('const found = typed === null ? null : typed.length;'));
  assert.ok(
    contents.includes(
      'AccessibilityInfo.announceForAccessibility(searchResultsAnnouncement(found))',
    ),
  );
  assert.ok(contents.includes('}, [found]);'));
  // The heading and both ways out say what they are.
  assert.ok(contents.includes('<Text variant="heading-3">{SEARCH_ALL_STORES_LABEL}</Text>'));
  assert.ok(contents.includes('accessibilityHint={SEARCH_DISMISS_HINT}'));
});

test('a result row is one full-width checkbox element, distinct from a popular tile, with no mark or colour of its own', () => {
  const row = codeOnly(componentBody(SEARCH_SHEET, 'RetailerResultRow'));
  assert.equal((row.match(/accessibilityRole=/g) ?? []).length, 1, 'a second element in a row');
  assert.ok(row.includes('accessibilityRole="checkbox"'));
  assert.ok(row.includes('accessibilityLabel={retailer.name}'));
  assert.ok(row.includes('accessibilityState={{ checked }}'));
  assert.equal((row.match(/<Pressable/g) ?? []).length, 1);
  assert.equal((row.match(/onPress=/g) ?? []).length, 1);
  assert.ok(row.includes('{retailer.name}'));
  // The drawn checkbox at the trailing edge, hidden so only the row speaks.
  assert.ok(row.indexOf('{retailer.name}') < row.indexOf('<CheckIndicator checked={checked} />'));
  assert.ok(
    row.includes(
      'accessible={false}\n        accessibilityElementsHidden\n        importantForAccessibility="no-hide-descendants">\n        <CheckIndicator checked={checked} />',
    ),
  );
  // Chosen: the soft blue and the navy edge, and the filled checkbox.
  assert.ok(row.includes('checked ? styles.rowChosen : styles.rowOpen'));
  const sheet = codeOnly(SEARCH_SHEET);
  const chosen = sheet.slice(
    sheet.indexOf('  rowChosen: {'),
    sheet.indexOf('},', sheet.indexOf('  rowChosen: {')),
  );
  assert.ok(chosen.includes("backgroundColor: color['background/subtle'],"));
  assert.ok(chosen.includes("borderColor: color['action/primary'],"));
  // Not a popular tile: no popular tile, grid or grid columns (the editor's
  // catalog has its own measured column rule, storeCatalogColumns).
  for (const forbidden of ['RetailerTile', 'RetailerGrid', 'retailerGridColumns']) {
    assert.ok(!sheet.includes(forbidden), `the sheet uses ${forbidden}`);
  }
  // No logo, house glyph, monogram, retailer colour or legacy Profile row.
  for (const forbidden of [
    '<Image',
    'RetailerLogo',
    'retailer-logo',
    "'home'",
    'charAt',
    'require(',
    'uri',
    'CheckRow',
    'StoreSelectorContent',
    'storeRows',
  ]) {
    assert.ok(!sheet.includes(forbidden), `the sheet draws ${forbidden}`);
  }
  // The only glyphs are the Close `x` (the field's `search` is the Search Bar's).
  assert.deepEqual(sheet.match(/<Icon name="[^"]+"/g), ['<Icon name="x"']);
});

test('the sheet and the step share the one saved selection; choosing never closes it, and every way out keeps choices', () => {
  // No copy of the selection in either component.
  for (const source of [RETAILERS, SEARCH_SHEET]) {
    assert.ok(!/useState<readonly string\[\]>/.test(source), 'a draft selection');
  }
  const step = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  const sheetUse = step.slice(step.indexOf('<RetailerSearchSheet'));
  assert.ok(sheetUse.includes('selected={selected}'));
  assert.ok(sheetUse.includes('onToggle={onToggle}'));
  // The receipt and the sheet: one selection, one toggle (the count row
  // reads the same `selected`).
  assert.equal((step.match(/selected=\{selected\}/g) ?? []).length, 2);
  assert.equal((step.match(/onToggle=\{onToggle\}/g) ?? []).length, 2);
  assert.ok(
    codeOnly(componentBody(RETAILERS, 'ReceiptContent')).includes(
      'accessibilityLabel={storesCountLabel(selected.length)}',
    ),
  );
  assert.ok(!step.includes('onRemove='), 'a chip removal came back');
  const contents = codeOnly(componentBody(SEARCH_SHEET, 'SheetContents'));
  assert.ok(contents.includes('checked={selected.includes(retailer.id)}'));
  assert.ok(contents.includes('onPress={() => onToggle(retailer.id)}'));
  // Choosing does not close: the row's press is the toggle alone.
  const row = codeOnly(componentBody(SEARCH_SHEET, 'RetailerResultRow'));
  assert.ok(row.includes('onPress={onPress}'));
  assert.ok(!contents.slice(contents.indexOf('<RetailerResultRow')).includes('onClose()'));
  // Close, Done, the backdrop and Android's back all run the one close,
  // which only puts the keyboard away and closes: no commit, no clearing.
  const main = codeOnly(componentBody(SEARCH_SHEET, 'RetailerSearchSheet'));
  assert.ok(main.includes('const close = () => {\n    Keyboard.dismiss();\n    onClose();\n  };'));
  assert.ok(main.includes('onRequestClose={close}'));
  assert.ok(
    main.includes(
      '<Pressable\n          style={StyleSheet.absoluteFill}\n          onPress={close}',
    ),
  );
  assert.ok(main.includes('onClose={close}'));
  assert.equal((contents.match(/onPress=\{onClose\}/g) ?? []).length, 2, 'Close and Done');
  assert.ok(!SEARCH_SHEET.includes('onClear'), 'the sheet can clear the selection');
});

test('the query lives in the sheet’s contents alone: blank on every opening, never saved or handed out', () => {
  const sheet = codeOnly(SEARCH_SHEET);
  const uses = sheet
    .split('\n')
    .filter((line) => /\bquery\b/.test(line))
    .map((line) => line.trim());
  assert.deepEqual(uses, [
    "const [query, setQuery] = useState('');",
    'const typed = retailerSearchResults(query);',
    'value={query}',
  ]);
  // The contents mount with the sheet and go with it, so the query does too.
  const main = codeOnly(componentBody(SEARCH_SHEET, 'RetailerSearchSheet'));
  assert.ok(main.includes('{shown ? (\n            <SheetContents'));
  // Neither the step nor the route ever sees it.
  assert.ok(!/\bquery\b/i.test(codeOnly(RETAILERS)), 'the step holds a query');
  assert.ok(!/\bquery\b|searchKey/i.test(codeOnly(ROUTES.retailers)), 'the route holds a query');
  for (const forbidden of ['AsyncStorage', 'SecureStore', 'saveOnboarding', 'update(']) {
    assert.ok(!sheet.includes(forbidden), `the sheet saves through ${forbidden}`);
  }
});

test('the sheet slides and fades only where motion is allowed; under Reduce Motion it is simply there and gone', () => {
  // One motion rule for the three sheets (2026-10-04): the hook starts the
  // opening slide when the Modal has presented its view (`onShow`), not
  // before — the audit's hard-cut opening — and keeps the Modal through the
  // closing slide. The sheet itself only interpolates `progress`.
  const main = codeOnly(componentBody(SEARCH_SHEET, 'RetailerSearchSheet'));
  assert.ok(
    main.includes('const { shown, progress, onShow, onDismiss } = useSheetMotion(visible);'),
  );
  assert.ok(!main.includes('Animated.timing'), 'the sheet animates on its own');
  const hook = codeOnly(read('hooks', 'use-sheet-motion.ts'));
  assert.ok(hook.includes('if (!visible && motion) setClosing(true);'));
  assert.ok(
    hook.includes(
      "if (action.kind === 'set') {\n      stop();\n      progress.setValue(action.to);",
    ),
  );
  assert.ok(hook.includes('duration: SHEET_MOTION.in,'));
  assert.ok(hook.includes('duration: SHEET_MOTION.out,'));
  assert.ok(hook.includes('useNativeDriver: true,'));
  // The opening waits for the Modal's view, then runs from it.
  assert.ok(hook.includes('if (openOnShow(latest.current)) open();'));
  assert.ok(hook.includes("return presented ? { kind: 'open' } : { kind: 'wait' };") || true);
  assert.ok(
    codeOnly(read('lib', 'sheet-motion.ts')).includes(
      "return presented ? { kind: 'open' } : { kind: 'wait' };",
    ),
  );
  // Opacity and a vertical slide only: no spring, bounce, scale or loop.
  for (const forbidden of ['Animated.spring', 'Animated.loop', 'bounce', 'scale:', 'iterations']) {
    assert.ok(!SEARCH_SHEET.includes(forbidden), `the sheet uses ${forbidden}`);
    assert.ok(!hook.includes(forbidden), `the hook uses ${forbidden}`);
  }
  // The platform's own slide is off: the sheet draws its own, or none.
  assert.ok(main.includes('animationType="none"'));
  // Every sheet shares it.
  for (const source of [
    SEARCH_SHEET,
    STATE_SHEET,
    read('components', 'onboarding', 'allergen-chooser-sheet.tsx'),
  ]) {
    assert.ok(codeOnly(source).includes('useSheetMotion(visible)'));
  }
});

test('the abandoned inline and upward-overlay searches are gone', () => {
  const step = codeOnly(RETAILERS);
  for (const gone of [
    'SearchResults',
    'searchPanelMaxHeight',
    'retailerSearchPlaceholder',
    'PANEL_',
    'SEARCH_RESULTS_LABEL',
    'searchKey',
    'initialQuery',
    'initialSearchOpen',
    'scrollToEnd({ animated: motionAllowed(reduceMotion) });\n    }\n  }, [',
    "pointerEvents={open ? 'none' : 'auto'}",
    'keyboardDidShow',
  ]) {
    assert.ok(!step.includes(gone), `the step still has ${gone}`);
  }
  // The frame's onScroll passthrough now belongs to the Ready CTA rule; the
  // Retailers step itself must still not watch the scroll.
  assert.ok(!codeOnly(RETAILERS).includes('onScroll'), 'Retailers watches the scroll again');
  assert.ok(!codeOnly(ROUTES.retailers).includes('setSearchKey'));
});

test('Profile keeps the shared store selector exactly as it was', () => {
  const content = codeOnly(componentBody(FORM, 'StoreSelectorContent'));
  assert.ok(content.includes('const rows = storeRows(query);'));
  assert.ok(content.includes('onChangeText={setQuery}'));
  assert.ok(content.includes('checked={selected.includes(retailer.id)}'));
  assert.ok(
    content.includes('leading={<RetailerLogo retailerId={retailer.id} name={retailer.name} />}'),
  );
  assert.ok(content.includes('placeholder={STORE_SEARCH_PLACEHOLDER}'));
  assert.ok(codeOnly(componentBody(FORM, 'StoreSelector')).includes('<StoreSelectorContent'));
  // Onboarding no longer mounts it anywhere.
  for (const [name, source] of [
    ['retailers step', RETAILERS],
    ['retailers route', ROUTES.retailers],
  ] as const) {
    assert.ok(!source.includes('StoreSelectorContent'), `${name} mounts the directory`);
  }
});

test('Stores: Continue is always enabled, and Back, Continue, saving and the resume point are as before', () => {
  const route = codeOnly(ROUTES.retailers);
  assert.ok(route.includes("void access.recordShownStep('retailers');"));
  assert.ok(route.includes('onToggle={(id) => update(toggleRetailer(prefs, id))}'));
  assert.ok(route.includes('const next = clearRetailers(prefs);'));
  assert.ok(route.includes('if (next !== prefs) update(next);'));
  // Continue runs through the one shared rule: back to Ready when editing,
  // through the one-time interstitial the first time, straight to Ready after.
  assert.ok(
    route.includes(
      'onContinue={() => continueToPreview(previewBeneath(), access.onboarding.watchBuilt, router)}',
    ),
  );
  assert.ok(route.includes("onBack={() => goBackFrom('retailers', router)}"));
  const step = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  assert.ok(step.includes('<ContinueButton onPress={onContinue} />'));
  assert.ok(step.includes("progress={stepProgress('retailers')}"));
  assert.ok(step.includes('back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}'));
  assert.equal(
    progressAccessibilityLabel(stepProgress('retailers')!),
    'Onboarding progress, step 5 of 5',
  );
});

test('no onboarding screen draws a frame aside (M03 left Stores with the receipt; M04 left the paywall 2026-10-04)', () => {
  for (const [name, source] of [
    ['welcome', WELCOME],
    ['states', STATES],
    ['allergens', ALLERGENS],
    ['retailers', RETAILERS],
    ['preview', PREVIEW],
    ['education', EDUCATION],
    ['panel', PANEL],
    ['onboarding panel', ONBOARDING_PANEL],
  ] as const) {
    assert.ok(!codeOnly(source).includes('aside='), `${name} gained an aside`);
  }
});

test('the approved Stores mock-ups are design references only: no source or config file references them', () => {
  for (const reference of [
    'lotly-onboarding-retailers-popular-grid-target.png',
    'lotly-onboarding-stores-receipt-target.png',
  ]) {
    assert.ok(existsSync(join(SRC, '..', 'assets', 'brand', 'reference', reference)));
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|js|jsx|json)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          if (codeOnly(readFileSync(path, 'utf8')).includes(reference)) hits.push(path);
        }
      }
    };
    walk(SRC);
    const root = join(SRC, '..');
    for (const name of readdirSync(root)) {
      if (/\.(js|cjs|mjs|ts|json)$/.test(name) && name !== 'package-lock.json') {
        if (readFileSync(join(root, name), 'utf8').includes(reference)) hits.push(name);
      }
    }
    assert.deepEqual(hits, []);
  }
  assert.ok(!codeOnly(RETAILERS).includes('brand/reference'));
});
