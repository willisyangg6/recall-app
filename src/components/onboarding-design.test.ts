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
  CLEAR_STATES_HINT,
  CONTINUE_CTA,
  EDUCATION_BODY,
  EDUCATION_CTA,
  EDUCATION_HEADLINE,
  EDUCATION_PREVIEW_BODY,
  EDUCATION_PREVIEW_TITLE,
  EDUCATION_REASSURANCE,
  EDUCATION_SECONDARY,
  EDUCATION_SUCCESS,
  INDEPENDENCE_NOTE,
  PREFERENCES_SET_CONFIRMATION,
  PREVIEW_BODY,
  PREVIEW_BODY_EMPTY,
  PREVIEW_CTA,
  PREVIEW_EDIT,
  PREVIEW_HEADLINE,
  PREVIEW_MATCH_HEADING,
  PREVIEW_NONE,
  PREVIEW_ROW_COMPLETED,
  PREVIEW_SUMMARY_LABELS,
  PREVIEW_SUMMARY_TITLE,
  RETAILERS_BODY,
  RETAILERS_HEADLINE,
  STATES_BODY,
  STATES_HEADLINE,
  STATES_REQUIRED_NOTE,
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
import { POPULAR_RETAILERS, READY_MASCOT_SIZE } from '@/lib/retailer-grid';
import { HELPER_MASCOT_SIZE, HIDE_MASCOT_AT_SCALE } from '@/lib/state-map';
import { retailerLogoCoverage } from '@/lib/retailer-logos';
import { STATE_CLEAR_HINT } from '@/lib/personalization-screen';
import {
  COUNTED_STEPS,
  filledSegments,
  motionAllowed,
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
const PROBLEM = read('components', 'onboarding', 'problem-steps.tsx');
const BUILDING = read('components', 'onboarding', 'building-step.tsx');
const PREVIEW = read('components', 'onboarding', 'preview-step.tsx');
const CAROUSEL = read('components', 'onboarding', 'ready-carousel.tsx');
const EDUCATION = read('components', 'onboarding', 'notification-education.tsx');
const SAMPLE = read('components', 'onboarding', 'sample-recall-card.tsx');
const PANEL = read('components', 'paywall', 'paywall-panel.tsx');
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
  // ClearAction (P2B7Z), always rendered.
  const allergens = componentBody(ALLERGENS, 'AllergensStep');
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

  // Retailers is the exception by design: its summary, and the Clear inside
  // it, exist only while something is chosen (pinned in the Retailers tests
  // below). The handler still refuses an empty clear.
  const retailers = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  assert.ok(retailers.includes('if (selected.length === 0) return;'));
});

test('the count line above every list is unconditional, so a selection change never moves the rows', () => {
  for (const [name, source, label] of [
    ['states', STATES, 'stateCountLabel(draft.length)'],
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

test('States alone can refuse Continue, and says why in a permanently allocated line', () => {
  const states = codeOnly(STATES);
  assert.ok(states.includes('const canContinue = canContinueFromStates(draft);'));
  assert.ok(states.includes('disabled={!canContinue}'));
  // P2B7Y closeout: the sentence itself is ALWAYS laid out, so the footer's
  // height cannot depend on whether it is showing — a ' ' placeholder was one
  // line tall while the sentence wraps to three at the accessibility sizes,
  // which moved Continue when the last state was cleared. Inactive, it is
  // invisible and hidden from assistive technology.
  const note = states.slice(
    states.indexOf('<Text\n            variant="caption"'),
    states.indexOf('</Text>', states.indexOf('<Text\n            variant="caption"')),
  );
  assert.ok(note.includes('{STATES_REQUIRED_NOTE}'), 'the reason line is not always laid out');
  // The words never swap for a placeholder: the child is the sentence alone.
  assert.equal(note.slice(note.lastIndexOf('>') + 1).trim(), '{STATES_REQUIRED_NOTE}');
  assert.ok(note.includes('style={[styles.note, canContinue && styles.noteInactive]}'));
  assert.ok(note.includes('accessibilityElementsHidden={canContinue}'));
  assert.ok(
    note.includes("importantForAccessibility={canContinue ? 'no-hide-descendants' : 'auto'}"),
  );
  assert.ok(states.includes('noteInactive: {\n    opacity: 0,\n  },'));
  // Hidden by opacity, never by removal or a zero size: the slot keeps its height.
  const inactive = states.slice(
    states.indexOf('noteInactive: {'),
    states.indexOf('},', states.indexOf('noteInactive: {')),
  );
  for (const forbidden of ['display', 'height', 'maxHeight', 'position']) {
    assert.ok(!inactive.includes(forbidden), `the inactive note uses ${forbidden}`);
  }
  assert.ok(states.includes('accessibilityHint={canContinue ? undefined : STATES_REQUIRED_NOTE}'));
  assert.equal(STATES_REQUIRED_NOTE, 'Choose at least one state to continue.');
  // Allergens and retailers: Continue is never disabled.
  for (const [name, source] of [
    ['allergens', ALLERGENS],
    ['retailers', RETAILERS],
  ] as const) {
    const code = codeOnly(source);
    assert.ok(code.includes('footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}'), name);
    assert.ok(!code.includes('canContinue'), `${name} gates Continue`);
  }
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
  for (const name of ['states', 'allergens', 'retailers', 'preview'] as const) {
    assert.ok(ROUTES[name].includes('useOnboardingPreferences()'), `${name} reads its own copy`);
  }
  // The edits are the shared rules — the same functions Profile's editor uses.
  assert.ok(ROUTES.states.includes('update(withStates(prefs, codes))'));
  assert.ok(ROUTES.allergens.includes('update(toggleAllergen(prefs, token))'));
  assert.ok(ROUTES.allergens.includes('const next = clearAllergens(prefs);'));
  assert.ok(ROUTES.allergens.includes('if (next !== prefs) update(next);'));
  assert.ok(ROUTES.retailers.includes('update(toggleRetailer(prefs, id))'));
  // The selectors ARE the shared selectors.
  assert.ok(STATES.includes('<StateSelectorContent'));
  // Retailers draws its own tiles and search; the shared store selector
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
  assert.equal(STATES_HEADLINE, 'Which states matter to you?');
  assert.equal(STATES_BODY, 'Choose every state where you or your household buys food.');
  assert.equal(ALLERGENS_HEADLINE, 'Any allergens to watch?');
  assert.equal(
    ALLERGENS_BODY,
    'Select any that matter to you or your household. Leave this blank if none.',
  );
  assert.equal(RETAILERS_HEADLINE, 'Where do you shop?');
  // The polish pass removed `This is optional.` (the step stays optional:
  // Continue is never disabled).
  assert.equal(
    RETAILERS_BODY,
    'Choose the retailers you want Lotly to watch for in recall notices.',
  );
  assert.ok(!RETAILERS_BODY.includes('optional'));
  assert.equal(ONBOARDING_COPY.POPULAR_STORES_LABEL, 'Popular stores');
  assert.ok(!('NO_STORES_YET' in ONBOARDING_COPY), 'the empty summary came back');
  assert.equal(ONBOARDING_COPY.CLEAR_STORES_LABEL, 'Clear');
  assert.equal(ONBOARDING_COPY.SEARCH_ALL_STORES_PLACEHOLDER, 'Not listed? Search all stores');
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
  // The building interstitial's captions, truthful at both zeros.
  assert.equal(ONBOARDING_COPY.buildingStatesCaption(), 'Checking recalls in your selected states');
  assert.equal(ONBOARDING_COPY.buildingAllergensCaption(true), 'Matching the allergens you watch');
  assert.equal(ONBOARDING_COPY.buildingAllergensCaption(false), 'Keeping allergen matching broad');
  assert.equal(ONBOARDING_COPY.buildingStoresCaption(true), 'Watching the stores you chose');
  assert.equal(ONBOARDING_COPY.buildingStoresCaption(false), 'Scanning recalls across all stores');
  assert.equal(ONBOARDING_COPY.BUILDING_FEED_CAPTION, 'Building your Affects You feed');
  assert.equal(ONBOARDING_COPY.BUILDING_DONE_CAPTION, 'Your recall watch is ready');
  assert.equal(PREVIEW_HEADLINE, 'Your recall watch is ready.');
  // The Ready body (the approved carousel target): the found claim stands
  // only when something was found.
  assert.equal(PREVIEW_BODY, 'Here’s what Lotly found for your household.');
  assert.equal(
    PREVIEW_BODY_EMPTY,
    'Lotly will keep checking for recalls that match your household.',
  );
  assert.equal(PREVIEW_SUMMARY_TITLE, 'Your preferences are set');
  // Option 2 (2026-09-26): Profile's own row names, so the app says store.
  assert.deepEqual(PREVIEW_SUMMARY_LABELS, {
    states: 'States',
    allergens: 'Allergens',
    retailers: 'Stores',
  });
  assert.equal(PREVIEW_ROW_COMPLETED, 'completed');
  // The Ready/paywall split (2026-09-28): the carousel's copy, and none of
  // the merged step's purchase copy.
  assert.equal(PREVIEW_MATCH_HEADING, 'See what affects you today');
  assert.equal(ONBOARDING_COPY.matchCountLabel(1), '1 recall for your watch');
  assert.equal(ONBOARDING_COPY.matchCountLabel(2), '2 recalls for your watch');
  assert.equal(ONBOARDING_COPY.matchCountLabel(3), '3 recalls for your watch');
  assert.equal(ONBOARDING_COPY.PREVIEW_LOCKED_STRIP, 'More matching recalls are locked');
  assert.equal(ONBOARDING_COPY.PREVIEW_EMPTY_TITLE, 'Nothing currently matches your watch.');
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
  assert.equal(PREVIEW_EDIT, 'Edit preferences');
  assert.equal(
    INDEPENDENCE_NOTE,
    'Lotly is independent and is not affiliated with the FDA or USDA.',
  );
  assert.equal(EDUCATION_SUCCESS, 'Subscription active');
  assert.equal(EDUCATION_HEADLINE, 'Get alerts when a recall matches.');
  assert.equal(
    EDUCATION_BODY,
    'Turn on notifications so Lotly can tell you when a new recall matches your profile.',
  );
  assert.equal(EDUCATION_PREVIEW_TITLE, 'Recall matches your profile');
  assert.equal(EDUCATION_PREVIEW_BODY, 'Gummy Products may contain undeclared peanut.');
  assert.equal(EDUCATION_CTA, 'Turn on notifications');
  assert.equal(EDUCATION_SECONDARY, 'Not now');
  assert.equal(EDUCATION_REASSURANCE, 'You can change this anytime in Settings.');
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
    ['states', STATES, ['STATES_HEADLINE', 'STATES_BODY', 'CONTINUE_CTA']],
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
        'SEARCH_ALL_STORES_PLACEHOLDER',
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
        'PREVIEW_BODY',
        'PREVIEW_BODY_EMPTY',
        'PREVIEW_EDIT',
        'PREVIEW_MATCH_HEADING',
        'matchCountLabel',
        'PREVIEW_CTA',
        'PREVIEW_NONE',
        'PREVIEW_SUMMARY_TITLE',
        'PREVIEW_SUMMARY_LABELS',
        'PREVIEW_ROW_COMPLETED',
      ],
    ],
    [
      'education',
      EDUCATION,
      [
        'EDUCATION_SUCCESS',
        'EDUCATION_HEADLINE',
        'EDUCATION_BODY',
        'EDUCATION_CTA',
        'EDUCATION_SECONDARY',
        'EDUCATION_REASSURANCE',
        'EDUCATION_PREVIEW_TITLE',
        'EDUCATION_PREVIEW_BODY',
      ],
    ],
    ['feed', FEED, ['PREFERENCES_SET_CONFIRMATION']],
  ] as const) {
    for (const constant of constants) {
      assert.ok(codeOnly(source).includes(constant), `${name} does not render ${constant}`);
    }
  }
  assert.equal(PREVIEW_NONE, 'None');
});

test('the Ready summary keeps all three rows in order and shows None for an empty optional group', () => {
  const code = codeOnly(componentBody(PREVIEW, 'PreviewStep'));
  const states = code.indexOf("key: 'states',\n      names: summary.states,");
  const allergens = code.indexOf("key: 'allergens',\n      names: summary.allergens,");
  const stores = code.indexOf("key: 'retailers',\n      names: summary.retailers,");
  assert.ok(states > 0 && states < allergens && allergens < stores, 'the rows moved or went');
  assert.ok(!code.includes('rows.filter('), 'an empty row is removed');
  const row = codeOnly(componentBody(PREVIEW, 'SummaryRow'));
  // A row shows every name unless it is handed a compacted value (the
  // Stores row, lib/ready-presentation `storeSummaryText`); it SPEAKS every
  // name either way.
  assert.ok(row.includes("{names.length === 0 ? PREVIEW_NONE : (shown ?? names.join(', '))}"));
  assert.ok(code.includes('shown: storeSummaryText(summary.retailers),'));
  assert.equal((code.match(/shown: /g) ?? []).length, 1, 'a row other than Stores is compacted');
  // One soft-blue card, headed, with no nested white card and no lift.
  assert.ok(
    code.includes('<Surface background="background/subtle" radius={16} style={styles.summary}>'),
  );
  assert.ok(code.includes('<Text variant="heading-3" accessibilityRole="header">'));
  assert.ok(code.includes('{PREVIEW_SUMMARY_TITLE}'));
  // Three flat surfaces and no more: the summary card, the locked strip and
  // the honest empty/checking card. Nothing is nested inside the summary.
  assert.equal((codeOnly(PREVIEW).match(/<Surface\b/g) ?? []).length, 3, 'a surface came or went');
  assert.ok(!codeOnly(PREVIEW).includes('elevation='), 'a Ready surface has a shadow');
});

test('each Ready row is its artwork at the leading edge, the label over its values, and the completed check at the trailing edge', () => {
  const step = codeOnly(componentBody(PREVIEW, 'PreviewStep'));
  assert.ok(step.includes('artwork: <Icon name="map-pin" size={24} color="icon/primary" />,'));
  assert.ok(step.includes('artwork: <AllergenArtworkMark artwork={allergens} />,'));
  assert.ok(
    step.includes('artwork: <Icon name="shopping-cart" size={24} color="icon/primary" />,'),
  );
  assert.ok(step.includes('const allergens = allergenArtwork(prefs.allergens);'));
  const row = codeOnly(componentBody(PREVIEW, 'SummaryRow'));
  // Artwork, text, check — and, stacked at the accessibility sizes, artwork
  // and check on a top line with the text beneath.
  assert.ok(
    row.includes('{leading}\n          {text}\n          {check}'),
    'not artwork, text, check',
  );
  assert.ok(row.includes('{leading}\n            {check}\n          </View>\n          {text}'));
  assert.ok(row.includes('<View style={styles.well}>{artwork}</View>'));
  assert.equal((row.match(/<Icon name="check"/g) ?? []).length, 1);
  assert.ok(
    row.indexOf('<Icon name="check"') > row.indexOf('style={styles.checkSlot}'),
    'the check is not in its own slot',
  );
  // Every row's artwork sits in the same white well; the check in a pale circle.
  const block = (name: string) => {
    const code = codeOnly(PREVIEW);
    const start = code.indexOf(`  ${name}: {`);
    return code.slice(start, code.indexOf('},', start));
  };
  assert.ok(block('well').includes('width: ROW_WELL_SIZE,'));
  assert.ok(block('well').includes('height: ROW_WELL_SIZE,'));
  assert.ok(block('well').includes("backgroundColor: color['background/surface'],"));
  assert.ok(block('checkCircle').includes('borderRadius: radius.full,'));
  assert.ok(block('checkWash').includes("backgroundColor: color['background/surface'],"));
  // Neither line is the secondary grey on the soft blue (3.2:1, below AA),
  // and both are Public Sans: the label is the smaller medium `caption`, the
  // values `body` — never the mono metadata `label` type.
  assert.ok(row.includes('<Text variant="caption">{label}</Text>'));
  assert.ok(!row.includes('variant="label"'), 'a category label is mono');
  // The check is the map pin's and cart's navy, at the 20pt icon step.
  assert.ok(row.includes('<Icon name="check" size={20} color="icon/primary" />'));
  assert.ok(!row.includes('text/secondary'), 'a row line is grey on the soft blue');
});

test('each Ready row is heard once with its complete selection; its artwork and check never are', () => {
  const row = codeOnly(componentBody(PREVIEW, 'SummaryRow'));
  assert.ok(
    row.includes(
      'accessible\n      accessibilityLabel={summaryRowLabel(label, names, PREVIEW_NONE, PREVIEW_ROW_COMPLETED)}>',
    ),
  );
  assert.ok(row.includes('<View {...DECORATIVE} style={stacked ? styles.leadingStacked : null}>'));
  assert.ok(row.includes('<View {...DECORATIVE} style={styles.checkSlot}>'));
  const decorative = codeOnly(PREVIEW).slice(
    codeOnly(PREVIEW).indexOf('const DECORATIVE = {'),
    codeOnly(PREVIEW).indexOf('} as const;'),
  );
  for (const hidden of [
    'accessible: false,',
    'accessibilityElementsHidden: true,',
    "importantForAccessibility: 'no-hide-descendants',",
    "pointerEvents: 'none',",
  ]) {
    assert.ok(decorative.includes(hidden), `the decoration lacks ${hidden}`);
  }
  // The pictograms and the +N are inside the hidden leading group, never labelled.
  const leading = row.slice(row.indexOf('const leading = ('), row.indexOf('const check = ('));
  assert.ok(leading.includes('{moreLabel(more)}'));
  assert.ok(
    !codeOnly(componentBody(PREVIEW, 'AllergenArtworkMark')).includes('accessibilityLabel'),
  );
});

test('the Allergens well draws the approved pictograms untinted, through the one allergen-assets map', () => {
  const code = codeOnly(PREVIEW);
  assert.ok(code.includes("import { allergenPictogram } from '@/lib/allergen-assets';"));
  const pictogram = codeOnly(componentBody(PREVIEW, 'Pictogram'));
  assert.ok(pictogram.includes('source={allergenPictogram(token) ?? undefined}'));
  assert.ok(pictogram.includes('resizeMode="contain"'));
  assert.ok(pictogram.includes('style={{ width: side, height: side }}'));
  // Never tinted: tinted navy, tree nuts and egg stop reading (founder, 2026-09-26).
  assert.ok(!code.includes('tintColor'), 'a pictogram is tinted');
  const mark = codeOnly(componentBody(PREVIEW, 'AllergenArtworkMark'));
  assert.ok(mark.includes("if (artwork.kind === 'none') return <View style={styles.dash} />;"));
  assert.ok(mark.includes('<Pictogram token={first} side={PICTOGRAM_SINGLE} />'));
  assert.ok(mark.includes('<Pictogram token={second} side={PICTOGRAM_PAIR} />'));
  const step = codeOnly(componentBody(PREVIEW, 'PreviewStep'));
  assert.ok(step.includes("more: allergens.kind === 'pictograms' ? allergens.more : 0,"));
  // No second map: the pictograms are required by lib/allergen-assets.ts alone.
  const requiring: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        if (/assets\/icons\/allergen-[a-z-]+-1024\.png/.test(readFileSync(path, 'utf8'))) {
          requiring.push(path.slice(SRC.length + 1));
        }
      }
    }
  };
  walk(SRC);
  assert.deepEqual(requiring, [join('lib', 'allergen-assets.ts')]);
});

test('the trust-peek mascot is drawn whole over the card, decorative and untouchable, and settles once only without Reduce Motion', () => {
  const code = codeOnly(PREVIEW);
  assert.ok(
    code.includes("require('@/assets/brand/production/lotly-mascot-ready-trust-peek-1024.png')"),
    'Ready does not draw the trust-peek mascot',
  );
  assert.equal((code.match(/require\(/g) ?? []).length, 1, 'Ready bundles a second picture');
  const mascot = codeOnly(componentBody(PREVIEW, 'TrustPeek'));
  assert.ok(mascot.includes('source={MASCOT}'));
  assert.ok(mascot.includes('resizeMode="contain"'));
  assert.ok(mascot.includes('style={{ width: size, height: size }}'));
  assert.ok(mascot.includes('{...DECORATIVE}'));
  for (const forbidden of ['tintColor', "'cover'", '"cover"', 'Animated.loop', 'iterations']) {
    assert.ok(!mascot.includes(forbidden), `the mascot uses ${forbidden}`);
  }
  // The other onboarding mascots' entrance, decided once.
  assert.ok(mascot.includes('const [animate] = useState(() => motionAllowed(reduceMotion));'));
  assert.ok(mascot.includes('new Animated.Value(animate ? 0 : 1)'));
  assert.ok(mascot.includes('if (!animate) return;'));
  assert.ok(mascot.includes('delay: MASCOT_ENTRANCE.delay,'));
  // The card's sibling, drawn after it (so over its edge), never inside it,
  // with the drawing's full height reserved above the card.
  const step = codeOnly(componentBody(PREVIEW, 'PreviewStep'));
  // The room above the card is the reserve — the lift less the crest's
  // allowed rise beside the body paragraph — and the seat is unmoved: the
  // mascot's top keeps the same distance to the card it always had.
  assert.ok(step.includes('const reserve = readyMascotReserve(size, fontScale);'));
  assert.ok(step.includes('<View style={{ paddingTop: reserve }}>'));
  assert.ok(step.indexOf('</Surface>') < step.indexOf('<TrustPeek'), 'the mascot is in the card');
  assert.ok(step.includes('const size = readyMascotSize(height, fontScale);'));
  // The cliff: while the crest rises, the BODY alone gives up the mascot's
  // width (the headline keeps the full line) and wraps left of the drawing.
  assert.ok(step.includes('const bodyInset = readyBodyAside(size, fontScale);'));
  assert.ok(step.includes('bodyInset={bodyInset}'));
  assert.ok(step.includes('top={reserve - readyMascotOffset(size)}'));
  assert.ok(step.includes('right={readyMascotRight(size)}'));
  // The heading and the first row keep clear of the shield; from the
  // accessibility sizes the rows stack and the heading drops beneath it.
  assert.ok(step.includes('<View style={summaryHeadingLayout(size, fontScale)}>'));
  assert.ok(step.includes('const stacked = summaryStacked(fontScale);'));
});

test('Ready: Back, Edit preferences, See my plan and the resume point are wired for the split flow', () => {
  const route = codeOnly(ROUTES.preview);
  assert.ok(route.includes("void access.recordShownStep('preview');"));
  assert.ok(route.includes("onEdit={() => router.push(onboardingRoute('states'))}"));
  assert.ok(route.includes("onBack={() => goBackFrom('preview', router)}"));
  assert.ok(route.includes("onSeePlan={() => router.push(onboardingRoute('paywall'))}"));
  assert.ok(route.includes('prefs={load.prefs}'));
  // The preview is the REAL feed through the REAL matching layer, built in
  // lib/ready-preview.ts — no onboarding-only matcher, no fixture data.
  assert.ok(route.includes('const feed = useFeed();'));
  assert.ok(route.includes('buildReadyPreview(feedInput, load.prefs, todayIso())'));
  assert.ok(!route.includes('onViewPlans'), 'the View plans step came back');
  assert.ok(!route.includes('usePurchaseFlow'), 'Ready grew purchase machinery back');
  const step = codeOnly(componentBody(PREVIEW, 'PreviewStep'));
  assert.ok(step.includes('back={{ label: BACK_LABEL, hint: BACK_HINT, onPress: onBack }}'));
  // No progress bar on Ready (stepProgress('preview') is null), and the one
  // pinned action is See my plan.
  assert.ok(step.includes("progress={stepProgress('preview')}"));
  assert.ok(
    step.includes(
      '<Button label={PREVIEW_CTA} accessibilityHint={PREVIEW_CTA_HINT} onPress={onSeePlan} />',
    ),
  );
  // Edit preferences is a quiet text action, not a second large button.
  assert.ok(step.includes('accessibilityLabel={PREVIEW_EDIT}'));
  assert.ok(step.includes('accessibilityHint={PREVIEW_EDIT_HINT}'));
  assert.ok(step.includes('hitSlop={EDIT_HIT_SLOP}'));
  assert.ok(step.includes('onPress={onEdit}'));
  assert.ok(!step.includes('label={PREVIEW_EDIT}'), 'Edit preferences is a Button again');
  // No example recall, no notification preview, no purchase UI of any kind.
  for (const gone of [
    'SampleRecallCard',
    'PREVIEW_EXAMPLE_LABEL',
    'EDUCATION_PREVIEW',
    'notification-education',
    'usePurchaseFlow',
    'PurchasePlans',
    'PurchaseCta',
    'PurchaseTerms',
    'PAYWALL_BENEFITS',
    'paywall-panel',
    'INDEPENDENCE_NOTE',
    'footerMode',
  ]) {
    assert.ok(!codeOnly(PREVIEW).includes(gone), `Ready draws ${gone}`);
  }
  // The step reads the saved preferences and never writes them.
  for (const forbidden of ['savePreferences', 'update(', 'useOnboardingPreferences']) {
    assert.ok(!codeOnly(PREVIEW).includes(forbidden), `the step reaches ${forbidden}`);
  }
});

// ── The permission rule ─────────────────────────────────────────────────────

test('the notification permission is reachable from the education primary action alone — never on mount, never from Not now', () => {
  const route = codeOnly(ROUTES.education);
  assert.equal(
    (route.match(/enableRecallAlerts/g) ?? []).length,
    2,
    'once as an import, once on the press',
  );
  assert.ok(route.includes('await enableRecallAlerts();'));
  assert.ok(!route.includes('useEffect'), 'nothing runs on mount');
  assert.ok(!route.includes('useFocusEffect'), 'nothing runs on focus');
  const skip = route.slice(
    route.indexOf('const skip = () => {'),
    route.indexOf('return <NotificationEducation'),
  );
  assert.ok(!skip.includes('enableRecallAlerts'), 'Not now reaches the prompt');
  assert.ok(!skip.includes('getAlertStatus'), 'Not now reads the permission');
  assert.ok(skip.includes('access.completeNotificationEducation()'));
  // Both choices complete the education, so both enter the Feed through the gate.
  assert.equal((route.match(/access\.completeNotificationEducation\(\)/g) ?? []).length, 2);
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
  assert.ok(feed.includes('if (access.consumePreferencesSetNotice()) setPreferencesSet(true);'));
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
  assert.ok(codeOnly(PANEL).includes("backgroundColor: color['background/accent']"));
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
  assert.ok(PANEL.includes('<BenefitChecks items={PAYWALL_BENEFITS} />'));
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

test('the paywall and education keep the shared frame, and the paywall keeps its four footer actions in one toolbar', () => {
  assert.ok(codeOnly(PANEL).includes('<OnboardingFrame'));
  assert.ok(codeOnly(EDUCATION).includes('<OnboardingFrame'));
  assert.ok(codeOnly(PANEL).includes('accessibilityRole="toolbar"'));
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
  assert.ok(terms.includes('{PAYWALL_DISCLOSURE}'));
  assert.ok(slots.includes('const terms = <PurchaseTerms purchase={purchase} />;'));
  assert.ok(slots.includes("{placement === 'sticky' ? terms : null}"));
  assert.ok(slots.includes("inlineTerms: placement === 'inline' ? terms : null,"));
  assert.ok(
    slots.indexOf('<PurchaseCta purchase={purchase} />') <
      slots.indexOf("{placement === 'sticky' ? terms : null}"),
    'the primary action stays in the sticky footer',
  );
  const panel = codeOnly(componentBody(PANEL, 'PaywallPanel'));
  assert.ok(panel.includes('footer={slots.footer}>'));
  assert.ok(panel.indexOf('{children}') < panel.indexOf('{slots.inlineTerms}'));
  // The split (2026-09-28): Ready draws no terms, disclosure or legal links.
  for (const gone of ['PurchaseTerms', 'PAYWALL_DISCLOSURE', 'usePurchaseFooterSlots']) {
    assert.ok(!codeOnly(PREVIEW).includes(gone), `Ready draws ${gone}`);
  }
});

test('the deck: uniform real cards, depth behind the active card, the frosted real fourth as the final page', () => {
  const deck = codeOnly(componentBody(CAROUSEL, 'ReadyCarousel'));
  // Horizontal, snapping one card at a time, by the shared geometry.
  assert.ok(deck.includes('horizontal'));
  assert.ok(deck.includes('snapToInterval={stride}'));
  assert.ok(deck.includes('const stride = carouselSnapInterval(usableWidth);'));
  assert.ok(deck.includes('decelerationRate="fast"'));
  assert.ok(deck.includes('disableIntervalMomentum'));
  // Depth, not a list: the waiting card scaled and tucked behind the active
  // one, driven ONLY by the scroll position (direct manipulation), under a
  // descending z-order so the active card covers it.
  assert.ok(deck.includes('outputRange: [DECK_NEXT_SCALE, 1]'));
  assert.ok(deck.includes('outputRange: [-DECK_TUCK, 0]'));
  assert.ok(deck.includes('zIndex: items.length - index'));
  assert.ok(deck.includes('nativeEvent: { contentOffset: { x: scrollX } }'));
  // The REAL shared card surface over the REAL feed model, in its uniform
  // variant, media through the shared tile, no save control.
  assert.ok(deck.includes('<RecallCardSurface'));
  assert.ok(deck.includes('model={item.model}'));
  assert.ok(deck.includes('uniform={uniform}'));
  assert.ok(deck.includes('const rule = previewCardLayout(fontScale);'));
  assert.ok(deck.includes('statusMinHeight: deckStatusHeight(rule.statusMinHeight, statusRows),'));
  assert.ok(deck.includes('<MediaTile'));
  assert.ok(deck.includes('trailing={null}'));
  assert.ok(
    deck.includes('accessibilityLabel={matchAccessibilityLabel(item.model, index, models.length)}'),
  );
  // The locked card is the LAST item and only when a real one exists; it is
  // the real next recall's own uniform card, frosted, with one lock and NO
  // text of its own; to assistive technology one concise button, the card
  // beneath hidden entirely.
  assert.ok(deck.includes("...(locked ? [{ kind: 'locked', model: locked } as DeckItem] : [])"));
  const locked = codeOnly(componentBody(CAROUSEL, 'LockedCard'));
  assert.ok(locked.includes('accessibilityRole="button"'));
  assert.ok(locked.includes('accessibilityLabel={PREVIEW_LOCKED_CARD_TITLE}'));
  assert.ok(locked.includes('accessibilityElementsHidden'));
  assert.ok(locked.includes('importantForAccessibility="no-hide-descendants"'));
  assert.ok(locked.includes('uniform={uniform}'));
  // A real blur over the whole card; under Reduce Transparency, an opaque
  // frost — illegible either way.
  assert.ok(
    locked.includes('<BlurView intensity={FROST_INTENSITY} tint="light" style={styles.frost} />'),
  );
  assert.ok(locked.includes('<View style={[styles.frost, styles.frostOpaque]} />'));
  assert.ok(locked.includes('reduceTransparency ? ('));
  assert.ok(locked.includes('<Icon name="lock" size={24} color="icon/primary" />'));
  assert.ok(!locked.includes('<Text'), 'the locked card explains itself in words');
  assert.ok(locked.includes('alt=""'), 'the frosted image is named to assistive technology');
  // No arrows, no instruction copy, no auto-advance, no loop, no glass.
  for (const forbidden of [
    'Swipe to view',
    'chevron-right',
    'chevron-left',
    'Animated.loop',
    'setInterval',
    'setTimeout',
    'scrollToIndex',
    'scrollToOffset',
    'LinearGradient',
    'GlassView',
  ]) {
    assert.ok(!codeOnly(CAROUSEL).includes(forbidden), `the carousel has ${forbidden}`);
  }
  // The dots count only the readable matches and are decorative.
  assert.ok(deck.includes('const dots = models.length >= 2 ? models.length : 0;'));
  assert.ok(deck.includes('accessibilityElementsHidden'));
});

test('the dedicated paywall: M04 beside the heading, check-row benefits, the plans, the note and the shared footer', () => {
  const panel = codeOnly(componentBody(PANEL, 'PaywallPanel'));
  const order = [
    'aside={fontScale < HIDE_MASCOT_AT_SCALE ? <WatchfulMascot /> : null}',
    '<BenefitChecks items={PAYWALL_BENEFITS} />',
    '<PurchasePlans purchase={purchase} />',
    '{children}',
    '{INDEPENDENCE_NOTE}',
    '{slots.inlineTerms}',
  ].map((marker) => {
    const at = panel.indexOf(marker);
    assert.ok(at > 0, `the paywall lacks ${marker}`);
    return at;
  });
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'the paywall is out of order',
  );
  // The benefits are navy check rows; the check is drawing.
  const checks = codeOnly(componentBody(PANEL, 'BenefitChecks'));
  assert.ok(checks.includes('<Icon name="check" size={20} color="icon/primary" />'));
  // The mascot: M04, decorative and untouchable, the shared one-time entrance.
  const mascot = codeOnly(componentBody(PANEL, 'WatchfulMascot'));
  assert.ok(mascot.includes('accessibilityElementsHidden'));
  assert.ok(mascot.includes('pointerEvents="none"'));
  assert.ok(mascot.includes('const [animate] = useState(() => motionAllowed(reduceMotion));'));
  assert.ok(PANEL.includes("require('@/assets/brand/production/lotly-mascot-watchful-1024.png')"));
  // The Annual card: BEST VALUE on the card's corner (a tab of it), the
  // chosen plan's 2px primary border; the badge is drawing because the
  // radio's own label already speaks Best value.
  const card = codeOnly(componentBody(PANEL, 'PlanCard'));
  assert.ok(
    card.includes('<View style={[styles.badge, styles.badgeCorner]} {...BADGE_DECORATIVE}>'),
  );
  assert.ok(/planSelected: \{[^}]*borderWidth: 2/s.test(PANEL));
  // No Ready content on the paywall.
  for (const gone of [
    'PREVIEW_SUMMARY_TITLE',
    'SampleRecallCard',
    'EDUCATION_PREVIEW',
    'progress=',
    'PREVIEW_HEADLINE',
    'ReadyCarousel',
  ]) {
    assert.ok(!codeOnly(PANEL).includes(gone), `the paywall draws ${gone}`);
  }
  // The entitled panel: no plans, no store, and a Continue.
  const entitled = codeOnly(componentBody(PANEL, 'EntitledPaywallPanel'));
  assert.ok(entitled.includes('{EDUCATION_SUCCESS}'));
  assert.ok(entitled.includes('<Button label={CONTINUE_CTA} onPress={onContinue} />'));
  assert.ok(!entitled.includes('PurchasePlans') && !entitled.includes('PurchaseCta'));
});

test('Edit preferences lives inside the summary card, quiet and 44pt, and still speaks its full scope', () => {
  const ready = codeOnly(componentBody(PREVIEW, 'PreviewStep'));
  const surfaceOpen = ready.indexOf('<Surface background="background/subtle"');
  const surfaceClose = ready.indexOf('</Surface>');
  const edit = ready.indexOf('accessibilityLabel={PREVIEW_EDIT}');
  assert.ok(surfaceOpen > 0 && edit > surfaceOpen && edit < surfaceClose, 'Edit left the card');
  assert.ok(ready.includes('accessibilityHint={PREVIEW_EDIT_HINT}'));
  assert.ok(ready.includes('hitSlop={EDIT_HIT_SLOP}'));
  assert.ok(ready.includes('onPress={onEdit}'));
  // A text action with the chevron affordance, never a second large button,
  // in action/primary: action/secondary on the soft blue is 4.1:1, below AA.
  assert.ok(ready.includes('<Text variant="body-small-bold" color="action/primary">'));
  assert.ok(ready.includes('<Icon name="chevron-right" size={16} color="icon/primary" />'));
  assert.ok(!ready.includes('label={PREVIEW_EDIT}'), 'Edit preferences is a Button again');
  assert.ok(!ready.includes('color="action/secondary"'), 'the below-AA blue came back');
});

test('the Ready step is the approved order: summary card, Edit inside it, the preview heading, pill, deck, locked strip, See my plan', () => {
  const ready = codeOnly(componentBody(PREVIEW, 'PreviewStep'));
  const order = [
    '<Surface background="background/subtle" radius={16} style={styles.summary}>',
    'onPress={onEdit}',
    '</Surface>',
    '{PREVIEW_MATCH_HEADING}',
    'matchCountLabel(',
    '<ReadyCarousel',
    '{PREVIEW_LOCKED_STRIP}',
  ].map((marker) => {
    const at = ready.indexOf(marker);
    assert.ok(at > 0, `Ready lacks ${marker}`);
    return at;
  });
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'the Ready step is out of order',
  );
  // The deck is handed the REAL locked recall (or null), never a boolean.
  assert.ok(ready.includes('locked={preview.locked}'));
  // The pill is the Affects You treatment: personalization, never safety.
  assert.ok(PREVIEW.includes("relevancePalette['affects-you'].background"));
  // The locked strip is unchanged: shown when more real matches exist, the
  // same words, the same action as the CTA.
  assert.ok(ready.includes('{hasLockedMatches(preview) ? ('));
  assert.ok(ready.includes('{PREVIEW_MONITORING_NOTE}'));
  assert.equal(ONBOARDING_COPY.PREVIEW_LOCKED_STRIP, 'More matching recalls are locked');
  assert.equal((ready.match(/onSeePlan/g) ?? []).length, 5, 'a locked path bypasses the paywall');
  // Zero matches: no deck, no dots, no locked strip — one honest card.
  assert.ok(ready.includes('PREVIEW_EMPTY_TITLE'));
  assert.ok(ready.includes('PREVIEW_UNAVAILABLE_TITLE'));
  assert.ok(ready.includes('PREVIEW_CHECKING_TITLE'));
  assert.ok(ready.includes('body={found ? PREVIEW_BODY : PREVIEW_BODY_EMPTY}'));
  for (const forbidden of [
    'useAccess',
    'loadOfferings',
    '.purchase(',
    '.restore(',
    'applyEntitlement',
    'Linking',
    'useState',
  ]) {
    assert.ok(!ready.includes(forbidden), `the Ready step holds ${forbidden}`);
  }
  assert.equal((codeOnly(PREVIEW).match(/require\(/g) ?? []).length, 1);
});

// ── The building interstitial and the onboarding paywall (2026-09-28) ───────

test('the interstitial plays once, replaces itself with Ready, prefetches the feed, and never traps', () => {
  const route = codeOnly(ROUTES.building);
  assert.ok(route.includes("void access.recordShownStep('building');"));
  // The prefetch: mounting the shared feed session during the play.
  assert.ok(route.includes('useFeed();'));
  assert.ok(route.includes('void access.completeWatchBuild();'));
  assert.ok(route.includes('buildingDone(router);'));
  // A failed preference read routes on rather than trapping.
  assert.ok(route.includes("load.status === 'failed' || load.status === 'unsupported'"));
  // buildingDone REPLACES, so Back from Ready pops to Stores; Stores'
  // Continue plays it only once and keeps the edit path direct.
  const nav = codeOnly(read('lib', 'onboarding-navigation.ts'));
  assert.ok(nav.includes("navigator.replace(onboardingRoute('preview'));"));
  assert.ok(nav.includes("else navigator.push(onboardingRoute('building'));"));
  assert.ok(nav.includes("if (previewBeneath) navigator.dismissTo(onboardingRoute('preview'));"));
  assert.ok(nav.includes("else if (watchBuilt) navigator.push(onboardingRoute('preview'));"));
  const step = codeOnly(componentBody(BUILDING, 'BuildingStep'));
  // One play, ref-guarded; the sequence and timing are lib/building-watch's.
  assert.ok(step.includes('buildingSequence(prefs)'));
  assert.ok(step.includes('if (finished.current) return;'));
  // Reduce Motion: the finished checklist at once and a readable minimum —
  // no sequential build-up, and nothing loops anywhere.
  assert.ok(step.includes('motionAllowed(reduceMotion)'));
  assert.ok(step.includes('animate ? 0 : doneAt'));
  assert.ok(step.includes('animate ? DONE_MS : REDUCED_MOTION_MS'));
  for (const forbidden of ['Animated.loop', 'setInterval', 'Animated.spring', 'iterations']) {
    assert.ok(!codeOnly(BUILDING).includes(forbidden), `the interstitial uses ${forbidden}`);
  }
  // The checklist is ONE spoken element; the mascot is decorative; exactly
  // two announcements — the start and the completion — never per frame.
  assert.ok(step.includes('accessibilityRole="progressbar"'));
  assert.ok(step.includes('accessibilityLabel={BUILDING_ACCESSIBILITY_LABEL}'));
  assert.equal((codeOnly(BUILDING).match(/announceForAccessibility/g) ?? []).length, 2);
  assert.ok(codeOnly(BUILDING).includes('lotly-mascot-watchful-1024.png'));
  assert.ok(step.includes('{...DECORATIVE}'));
});

test('the onboarding paywall route: the shared flow, its resume point, Back to Ready, and the entitled Continue', () => {
  const route = codeOnly(ROUTES.onboardingPaywall);
  assert.ok(route.includes("void access.recordShownStep('paywall');"));
  assert.ok(route.includes("goBackFrom('paywall', router)"));
  // Already entitled: never asked to purchase again.
  assert.ok(route.includes('isEntitled(access.entitlement)'));
  assert.ok(route.includes('<EntitledPaywallPanel'));
  assert.ok(route.includes('onContinue={() => void access.completePersonalization()}'));
  // Otherwise: the one shared purchase flow, controls included.
  assert.ok(route.includes('usePurchaseFlow()'));
  assert.ok(route.includes('{developmentControls}'));
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
  for (const [name, source] of [
    ['progress', PROGRESS],
    ['states', STATES],
    ['preview', PREVIEW],
  ] as const) {
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

// ── P2B7Y: the States step, Map and List ────────────────────────────────────

test('Map and List read and change ONE draft, through the shared selector rules', () => {
  const step = codeOnly(componentBody(STATES, 'StatesStep'));
  assert.equal((step.match(/useState<readonly string\[\]>/g) ?? []).length, 1, 'a second draft');
  assert.ok(step.includes('const [draft, setDraft] = useState<readonly string[]>(selected);'));
  // Map mode toggles and clears the draft through the shared rules…
  assert.ok(
    step.includes('const toggle = (code: string) => commit(toggleStateCode(draft, code));'),
  );
  assert.ok(step.includes('<StateMap selected={draft} onToggle={toggle} />'));
  // …and List mode is the shared selector, seeded from the draft, reporting
  // into the same commit, which is the one path to the route's save.
  assert.ok(step.includes('selected={draft}'));
  assert.ok(step.includes('onDraftChange={commit}'));
  assert.ok(step.includes('setDraft(codes);') && step.includes('onChange(codes);'));
  // Map is the default, and the mode is the only thing a switch changes.
  assert.ok(STATES.includes('initialMode = DEFAULT_SELECTION_MODE'));
  assert.ok(step.includes("{mode === 'map' ? ("));
  // No location permission and no inferred state.
  for (const forbidden of ['expo-location', 'Location', 'geolocation', 'getCurrentPosition']) {
    assert.ok(!codeOnly(STATES).includes(forbidden), `the step reaches ${forbidden}`);
    assert.ok(!codeOnly(STATE_MAP).includes(forbidden), `the map reaches ${forbidden}`);
  }
});

test('on the map, the count line and Clear selection are always allocated, and an empty clear changes nothing', () => {
  const step = codeOnly(componentBody(STATES, 'StatesStep'));
  const row = step.slice(
    step.indexOf('<View style={styles.countRow}>'),
    step.indexOf('<View style={styles.chosen}>'),
  );
  assert.ok(row.includes('<SelectionCount text={stateCountLabel(draft.length)} />'));
  assert.ok(row.includes('label={CLEAR_SELECTION_LABEL}'));
  assert.ok(row.includes('disabled={draft.length === 0}'));
  assert.ok(!/\?\s*\(/.test(row) && !row.includes('&&'), 'the count row is conditional');
  // The handler's own guard: clearStateDraft hands back the same reference
  // for an empty draft, and then nothing is committed or saved.
  assert.ok(step.includes('const next = clearStateDraft(draft);'));
  assert.ok(step.includes('if (next !== draft) commit(next);'));
});

test('every chosen state is listed by name with a removal control that names it', () => {
  const chosen = codeOnly(componentBody(STATES, 'ChosenState'));
  assert.ok(chosen.includes('accessibilityRole="button"'));
  assert.ok(chosen.includes('accessibilityLabel={removeStateLabel(code)}'));
  assert.ok(chosen.includes('{stateSpokenName(code)}'));
  assert.ok(
    chosen.includes('minHeight: hitTarget.minimum') ||
      STATES.includes('minHeight: hitTarget.minimum'),
  );
  assert.ok(codeOnly(STATES).includes('{draft.map((code) => ('));
});

test('the Map / List control reports its mode, and every map target is a named checkbox', () => {
  const modes = codeOnly(componentBody(STATES, 'ModeSwitch'));
  assert.ok(modes.includes('accessibilityRole="button"'));
  assert.ok(modes.includes('accessibilityState={{ selected: active }}'));
  assert.ok(modes.includes('accessibilityLabel={label}'));
  // Not colour alone: the active word turns bold too.
  assert.ok(modes.includes("variant={active ? 'body-small-bold' : 'body-small'}"));
  const map = codeOnly(STATE_MAP);
  // The drawing is hidden and touches nothing; each jurisdiction is a
  // checkbox element named in full, activated without a finger touch.
  assert.equal((map.match(/importantForAccessibility="no-hide-descendants"/g) ?? []).length, 2);
  assert.ok(map.includes('accessibilityRole="checkbox"'));
  assert.ok(map.includes('accessibilityLabel={stateSpokenName(mark.code)}'));
  assert.ok(map.includes('accessibilityState={{ checked }}'));
  assert.ok(map.includes('onAccessibilityTap={() => onToggle(mark.code)}'));
  assert.ok(map.includes('accessibilityLabel={stateSpokenName(inset.code)}'));
  // The whole panel is one press target that asks the shared hit test.
  assert.ok(map.includes('stateAtPoint('));
  assert.ok(map.includes('accessibilityState={{ expanded: enlarged }}'));
  // Chosen shapes are more than a fill: a check, a marker or a badge.
  assert.ok(map.includes('<Icon name="check"'));
});

test('M02 sits beside the heading in the frame’s aside, at the aside standard: decorative, hidden, touching nothing, gone at accessibility sizes', () => {
  const mascot = codeOnly(componentBody(STATES, 'HelperMascot'));
  assert.ok(mascot.includes("require('@/assets/brand/production/lotly-mascot-helper-1024.png')"));
  assert.ok(mascot.includes('pointerEvents="none"'));
  assert.ok(mascot.includes('accessible={false}'));
  assert.ok(mascot.includes('accessibilityElementsHidden'));
  assert.ok(mascot.includes('importantForAccessibility="no-hide-descendants"'));
  assert.ok(mascot.includes('resizeMode="contain"'));
  assert.ok(mascot.includes('style={{ width: HELPER_MASCOT_SIZE, height: HELPER_MASCOT_SIZE }}'));
  assert.ok(!mascot.includes("position: 'absolute'"), 'the mascot floats over something');
  // Polish pass: the frame's heading aside — the Stores mascot's system — at
  // the same 120pt, yielding its room from the accessibility sizes; the
  // Map / List control takes the full content width beneath.
  const step = codeOnly(componentBody(STATES, 'StatesStep'));
  assert.ok(step.includes('aside={fontScale < HIDE_MASCOT_AT_SCALE ? <HelperMascot /> : null}'));
  assert.equal(HELPER_MASCOT_SIZE, READY_MASCOT_SIZE, 'the two selector mascots differ in size');
  assert.equal(HIDE_MASCOT_AT_SCALE, 1.5);
  assert.ok(!step.includes('styles.modeRow'), 'the control shares its row with the mascot again');
  assert.equal((step.match(/<HelperMascot \/>/g) ?? []).length, 1);
});

test('the States screen borrows no severity, relevance or harm palette', () => {
  for (const [name, source] of [
    ['states', STATES],
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

test('onboarding’s Clear selection says what it does there; the settings sheet keeps its Done wording', () => {
  // The onboarding step saves every change at once, so its Clear hint must
  // not promise a Done that does not exist — in either mode.
  assert.equal(CLEAR_SELECTION_LABEL, 'Clear selection');
  assert.equal(CLEAR_STATES_HINT, 'Unchecks every state.');
  const step = codeOnly(componentBody(STATES, 'StatesStep'));
  assert.ok(step.includes('clearHint={CLEAR_STATES_HINT}'), 'List mode inherits the sheet hint');
  assert.ok(step.includes('accessibilityHint={CLEAR_STATES_HINT}'), 'Map mode lost its hint');
  assert.ok(!codeOnly(STATES).includes('STATE_CLEAR_HINT'));
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
  const step = codeOnly(componentBody(ALLERGENS, 'AllergensStep'));
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

// ── Retailers: Popular stores (2026-09-24) ──────────────────────────────────

test('Retailers is one screen: the ten tiles from the curated list in the shared column rule, with no second mode', () => {
  const step = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  // No mode, no way to another presentation, no full-catalog directory.
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
  ]) {
    assert.ok(!codeOnly(RETAILERS).includes(gone), `the step still has ${gone}`);
  }
  assert.ok(!ROUTES.retailers.includes('initialMode'));
  // Every curated store, as a tile, from the one typed list and nothing else.
  assert.ok(step.includes('<RetailerGrid\n          retailers={POPULAR_RETAILERS}'));
  const grid = codeOnly(componentBody(RETAILERS, 'RetailerGrid'));
  assert.ok(grid.includes('retailerGridRows(retailers, columns).map((row) =>'));
  assert.ok(grid.includes('<RetailerTile\n'));
  assert.ok(grid.includes('checked={selected.includes(retailer.id)}'));
  assert.ok(grid.includes('onPress={() => onToggle(retailer.id)}'));
  assert.ok(grid.includes('{row.length < columns ? <View style={styles.gridSpacer} /> : null}'));
  assert.ok(step.includes('const { width, fontScale } = useWindowDimensions();'));
  assert.ok(step.includes('const columns = retailerGridColumns(width, fontScale);'));
  assert.equal(POPULAR_RETAILERS.length, 10);
  // The section is `Popular stores`, a header; no rank, number or size claim.
  assert.ok(step.includes('<Text variant="heading-3" accessibilityRole="header">'));
  for (const forbidden of ['largest', 'biggest', 'top 10', 'ranked', 'near']) {
    assert.ok(!RETAILERS.toLowerCase().includes(`'${forbidden}`), `the step claims ${forbidden}`);
  }
  // The tile draws from the geometry the rule measured against.
  const code = codeOnly(RETAILERS);
  for (const key of ['gap', 'minHeight', 'paddingHorizontal', 'paddingVertical']) {
    assert.ok(code.includes(`${key}: TILE.${key},`), `the tile's ${key} left the shared geometry`);
  }
});

test('each popular tile is ONE checkbox element: the canonical name, its state, the whole tile its target', () => {
  const tile = codeOnly(componentBody(RETAILERS, 'RetailerTile'));
  assert.equal((tile.match(/accessibilityRole=/g) ?? []).length, 1, 'a second element in a tile');
  assert.ok(tile.includes('accessibilityRole="checkbox"'));
  assert.ok(tile.includes('accessibilityLabel={retailer.name}'));
  assert.ok(tile.includes('accessibilityState={{ checked }}'));
  assert.equal((tile.match(/<Pressable/g) ?? []).length, 1);
  assert.equal((tile.match(/onPress=/g) ?? []).length, 1);
  // The name is the catalog's own, in full: no short form, no truncation.
  assert.ok(tile.includes('{retailer.name}'));
  // The shared checkbox, hidden, so only the tile speaks; colour is never alone.
  assert.ok(
    tile.includes(
      '<View\n            accessible={false}\n            accessibilityElementsHidden\n            importantForAccessibility="no-hide-descendants">\n            <CheckIndicator checked={checked} fill={fill} />',
    ),
  );
  assert.ok(tile.includes('<View style={[styles.tile, pressed && styles.pressed]}>'));
  assert.ok(!tile.includes('checked &&'), 'a checked-only style reached the tile');
  assert.ok(tile.includes('<View style={[styles.layer, styles.layerOpen]} />'));
  assert.ok(
    tile.includes(
      '<Animated.View style={[styles.layer, styles.layerChosen, { opacity: fill }]} />',
    ),
  );
  const code = codeOnly(RETAILERS);
  assert.ok(code.includes("backgroundColor: color['background/subtle'],"));
  assert.ok(code.includes("borderColor: color['action/primary'],"));
  assert.ok(code.includes("borderColor: color['border/default'],"));
  // Motion: opacity only, and immediate under Reduce Motion.
  assert.ok(
    tile.includes('if (!motionAllowed(reduceMotion)) {\n      fill.setValue(to);\n      return;'),
  );
  assert.ok(code.includes('export const SELECTION_FADE_MS = 150;'));
  for (const forbidden of ['Animated.loop', 'Animated.spring', 'iterations', 'scale:']) {
    assert.ok(!code.includes(forbidden), `the retailers step uses ${forbidden}`);
  }
});

test('popular tiles carry no retailer mark, monogram, glyph or brand colour, and no logo mechanism was added', () => {
  const tile = codeOnly(componentBody(RETAILERS, 'RetailerTile'));
  for (const forbidden of [
    '<Image',
    '<Icon',
    'RetailerLogo',
    'require(',
    'uri',
    "'home'",
    'charAt',
  ]) {
    assert.ok(!tile.includes(forbidden), `a popular tile draws ${forbidden}`);
  }
  const code = codeOnly(RETAILERS);
  assert.ok(!code.includes('retailer-logo'), 'the step reaches the logo pipeline');
  assert.ok(!code.includes('uri:') && !code.includes('http'), 'the step fetches an image');
  for (const forbidden of ['shadow', 'LinearGradient', 'BlurView', 'riskPalette', 'Modal']) {
    assert.ok(!code.includes(forbidden), `the retailers step uses ${forbidden}`);
  }
  // One restrained existing lift, the Search Bar's, on the trigger alone.
  assert.equal((code.match(/elevation/g) ?? []).length, 1);
  assert.ok(codeOnly(componentBody(RETAILERS, 'SearchTrigger')).includes('elevation="card"'));
  // The pipeline is untouched: nothing in the manifest, no bundled marks.
  assert.deepEqual(retailerLogoCoverage().withLogo, []);
  assert.ok(!existsSync(join(SRC, '..', 'assets', 'retailer-logos')), 'retailer marks were added');
  const logo = codeOnly(read('components', 'ui', 'retailer-logo.tsx'));
  assert.ok(logo.includes('const MARKS: Readonly<Record<string, ImageSourcePropType>> = {};'));
});

test('Stores has no blue summary and no chips: one quiet count row whose slot never comes or goes', () => {
  const step = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  // The summary surface, its chips and their copy are gone entirely.
  for (const gone of ['SelectedStores', 'chipScroll', 'removeStoreLabel', 'yourStoresTitle']) {
    assert.ok(!codeOnly(RETAILERS).includes(gone), `Retailers still has ${gone}`);
  }
  // The one soft blue left is the tiles' own checked state (their approved
  // selected surface), never a container around the selection.
  assert.equal(
    (codeOnly(RETAILERS).match(/color\['background\/subtle'\]/g) ?? []).length,
    1,
    'a blue surface came back',
  );
  assert.ok(/layerChosen: \{\s*backgroundColor: color\['background\/subtle'\]/.test(RETAILERS));
  // The quiet row: the count (which also covers search-only choices) and a
  // compact Clear, no surface. Its SLOT is always laid out and only its
  // visibility follows the selection, so the grid never moves.
  assert.ok(step.includes('{storesCountLabel(selected.length)}'));
  assert.ok(step.includes('<ClearAction onPress={clear} />'));
  assert.ok(
    step.includes('style={[styles.countRow, selected.length === 0 && styles.countRowIdle]}'),
  );
  assert.ok(step.includes('accessibilityElementsHidden={selected.length === 0}'));
  assert.ok(!/selected\.length > 0 \? \(/.test(step), 'the row mounts conditionally again');
  assert.ok(/countRowIdle: \{\s*opacity: 0,\s*\}/.test(RETAILERS));
  assert.ok(!/countRow: \{[^}]*backgroundColor/s.test(RETAILERS), 'the count row grew a surface');
  // Clear is still a TRUE no-op with nothing chosen.
  assert.ok(step.includes('if (selected.length === 0) return;'));
});

test('the search trigger sits beneath the ten: drawn as the Search Bar, a button without a chevron or a field', () => {
  const step = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  const section = step.slice(step.indexOf('<View style={styles.section}>'));
  assert.ok(
    section.indexOf('retailers={POPULAR_RETAILERS}') < section.indexOf('<SearchTrigger'),
    'the trigger is not below the popular stores',
  );
  assert.ok(
    section.indexOf('<SearchTrigger') < section.indexOf('</View>'),
    'the trigger left the section',
  );
  assert.ok(step.includes('<SearchTrigger ref={trigger} onPress={() => setSearchOpen(true)} />'));
  const trigger = codeOnly(componentBody(RETAILERS, 'SearchTrigger'));
  assert.ok(trigger.includes('accessibilityRole="button"'));
  assert.ok(trigger.includes('accessibilityLabel={SEARCH_ALL_STORES_LABEL}'));
  assert.ok(trigger.includes('accessibilityHint={SEARCH_ALL_STORES_HINT}'));
  assert.ok(trigger.includes('{SEARCH_ALL_STORES_PLACEHOLDER}'));
  assert.ok(trigger.includes('<Icon name="search" size={20} color="icon/secondary" />'));
  assert.ok(trigger.includes('<Surface radius={12} elevation="card"'));
  // A button, never a second editable field, and never a way to another screen.
  const code = codeOnly(RETAILERS);
  for (const forbidden of ['<TextInput', '<SearchBar', 'chevron', 'router', 'Link']) {
    assert.ok(!code.includes(forbidden), `the step has ${forbidden}`);
  }
  assert.ok(
    code.includes('minHeight: layout.searchBarHeight,'),
    'the trigger is not the bar’s height',
  );
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
  assert.ok(step.includes('onClosed={focusTrigger}'));
  // Focus goes back to the trigger once the sheet has gone.
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
  assert.ok(field.includes('autoFocus'));
  // The shared Search Bar, whose `Clear` exists only while there is text.
  assert.ok(codeOnly(read('components', 'ui', 'search-bar.tsx')).includes("{value !== '' ? ("));
  // Matched by the catalog rule, never the whole catalog before a query.
  assert.ok(contents.includes('const results = retailerSearchResults(query);'));
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
  // Results are rows, one per line, scrolling inside the fixed region.
  assert.ok(contents.includes('results.map((retailer) => (\n            <RetailerResultRow'));
  const scroll = contents.slice(
    contents.indexOf('<ScrollView'),
    contents.indexOf('>', contents.indexOf('keyboardDismissMode')),
  );
  assert.ok(scroll.includes('keyboardShouldPersistTaps="handled"'));
  assert.ok(scroll.includes('automaticallyAdjustKeyboardInsets'));
  assert.ok(!contents.includes('horizontal'));
  // What was found is announced once per change, never on a re-render.
  assert.ok(contents.includes('const found = results === null ? null : results.length;'));
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
  // Not a popular tile: no tile, no grid, no columns.
  for (const forbidden of [
    'RetailerTile',
    'RetailerGrid',
    'retailerGridColumns',
    'TILE',
    'columns',
  ]) {
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
  // The grid and the sheet: one selection, one toggle (the summary and its
  // chips are gone; the quiet count row reads the same `selected`).
  assert.equal((step.match(/selected=\{selected\}/g) ?? []).length, 2);
  assert.equal((step.match(/onToggle=\{onToggle\}/g) ?? []).length, 2);
  assert.ok(step.includes('{storesCountLabel(selected.length)}'));
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
    'const results = retailerSearchResults(query);',
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
  const main = codeOnly(componentBody(SEARCH_SHEET, 'RetailerSearchSheet'));
  assert.ok(main.includes('if (!visible && motionAllowed(reduceMotion)) setClosing(true);'));
  assert.ok(
    main.includes(
      'if (!motionAllowed(reduceMotion)) {\n      progress.setValue(to);\n      return;\n    }',
    ),
  );
  assert.ok(main.includes('duration: visible ? SHEET_MOTION.in : SHEET_MOTION.out,'));
  assert.ok(main.includes('useNativeDriver: true,'));
  // Once gone it rests off the screen, whichever way it closed.
  assert.ok(
    main.includes('if (!visible && !closing) {\n      progress.setValue(0);\n      return;\n    }'),
  );
  // Opacity and a vertical slide only: no spring, bounce, scale or loop.
  for (const forbidden of ['Animated.spring', 'Animated.loop', 'bounce', 'scale:', 'iterations']) {
    assert.ok(!SEARCH_SHEET.includes(forbidden), `the sheet uses ${forbidden}`);
  }
  // The platform's own slide is off: the sheet draws its own, or none.
  assert.ok(main.includes('animationType="none"'));
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

test('Retailers: Continue is always enabled, and Back, Continue, saving and the resume point are as before', () => {
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
  assert.ok(step.includes('footer={<Button label={CONTINUE_CTA} onPress={onContinue} />}'));
  assert.ok(step.includes("progress={stepProgress('retailers')}"));
  assert.equal(
    progressAccessibilityLabel(stepProgress('retailers')!),
    'Onboarding progress, step 5 of 5',
  );
});

test('M03 stands beside the heading, whole, decorative and untouchable, and settles once only without Reduce Motion', () => {
  const code = codeOnly(RETAILERS);
  assert.ok(
    code.includes("require('@/assets/brand/production/lotly-mascot-ready-1024.png')"),
    'Retailers does not draw M03',
  );
  assert.equal((code.match(/require\(/g) ?? []).length, 1, 'Retailers bundles a second picture');
  assert.equal((code.match(/<Image\b/g) ?? []).length, 1);
  const mascot = codeOnly(componentBody(RETAILERS, 'ReadyMascot'));
  assert.ok(mascot.includes('resizeMode="contain"'));
  assert.ok(mascot.includes('style={{ width: READY_MASCOT_SIZE, height: READY_MASCOT_SIZE }}'));
  for (const hidden of [
    'pointerEvents="none"',
    'accessible={false}',
    'accessibilityElementsHidden',
    'importantForAccessibility="no-hide-descendants"',
  ]) {
    assert.ok(mascot.includes(hidden), `the mascot lacks ${hidden}`);
  }
  for (const forbidden of ['tintColor', "'cover'", '"cover"', 'Animated.loop', 'iterations']) {
    assert.ok(!mascot.includes(forbidden), `the mascot uses ${forbidden}`);
  }
  // The helper mascot's entrance, decided once, skipped unless Reduce Motion is known off.
  assert.ok(mascot.includes('const [animate] = useState(() => motionAllowed(reduceMotion));'));
  assert.ok(mascot.includes('new Animated.Value(animate ? 0 : 1)'));
  assert.ok(mascot.includes('if (!animate) return;'));
  assert.ok(mascot.includes('delay: MASCOT_ENTRANCE.delay,'));
  // Beside the heading through the frame's aside, and yielding at AX sizes.
  const step = codeOnly(componentBody(RETAILERS, 'RetailersStep'));
  assert.ok(step.includes('aside={showReadyMascot(fontScale) ? <ReadyMascot /> : null}'));
  assert.equal(READY_MASCOT_SIZE, 120);
  const frame = codeOnly(FRAME);
  assert.ok(frame.includes('{aside ? ('));
  assert.ok(frame.includes('{heading}\n            {aside}'));
  // The frame gives the aside its own width and the text the rest.
  assert.ok(frame.includes('headingBeside: {\n    flex: 1,\n  },'));
  for (const [name, source] of [
    ['welcome', WELCOME],
    ['allergens', ALLERGENS],
    ['preview', PREVIEW],
    ['education', EDUCATION],
  ] as const) {
    assert.ok(!codeOnly(source).includes('aside='), `${name} gained an aside`);
  }
  // The polish pass gave States (M02) and the paywall (M04) the same aside
  // system; no other screen has one.
  for (const [name, source] of [
    ['states', STATES],
    ['panel', PANEL],
  ] as const) {
    assert.ok(
      codeOnly(source).includes('aside={fontScale < HIDE_MASCOT_AT_SCALE ?'),
      `${name} lost its aside`,
    );
  }
});

test('the approved Retailers mock-up is a design reference only: no source or config file references it', () => {
  const reference = 'lotly-onboarding-retailers-popular-grid-target.png';
  assert.ok(existsSync(join(SRC, '..', 'assets', 'brand', 'reference', reference)));
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
  const root = join(SRC, '..');
  for (const name of readdirSync(root)) {
    if (/\.(js|cjs|mjs|ts|json)$/.test(name) && name !== 'package-lock.json') {
      if (readFileSync(join(root, name), 'utf8').includes(reference)) hits.push(name);
    }
  }
  assert.deepEqual(hits, []);
  assert.ok(!codeOnly(RETAILERS).includes('brand/reference'));
});
