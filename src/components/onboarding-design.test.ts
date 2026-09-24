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
 * height around text; and the Welcome seats the approved M01 mascot on the
 * real example card, invents no mark, and plays its one entrance only when
 * Reduce Motion is off.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

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
  PREVIEW_CTA,
  PREVIEW_EDIT,
  PREVIEW_EXAMPLE_LABEL,
  PREVIEW_HEADLINE,
  PREVIEW_NONE,
  PREVIEW_SUMMARY_LABELS,
  RETAILERS_BODY,
  RETAILERS_HEADLINE,
  STATES_BODY,
  STATES_HEADLINE,
  STATES_REQUIRED_NOTE,
  WELCOME_BODY,
  WELCOME_CTA,
  WELCOME_EXAMPLE_LABEL,
  WELCOME_HEADLINE,
  WELCOME_TRUST_NOTE,
  WORDMARK,
} from '@/lib/onboarding-copy';
import * as ONBOARDING_COPY from '@/lib/onboarding-copy';
import { SAMPLE_RECALL_MODEL } from '@/lib/onboarding-sample';
import { STATE_CLEAR_HINT } from '@/lib/personalization-screen';
import {
  COUNTED_STEPS,
  filledSegments,
  motionAllowed,
  progressAccessibilityLabel,
  stepProgress,
} from '@/lib/onboarding-state';
import {
  CARD_PADDING,
  entranceEndMs,
  LABEL_ALLOWANCE,
  MASCOT_ART_TOP,
  MASCOT_EDGE,
  MASCOT_MAX,
  MASCOT_MIN,
  mascotLift,
  mascotOffset,
  mascotSize,
  PAW_DEPTH,
  peekReserve,
  WELCOME_ENTRANCE,
  welcomeEntrance,
} from '@/lib/welcome-presentation';

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

const FRAME = read('components', 'onboarding', 'onboarding-frame.tsx');
const WELCOME = read('components', 'onboarding', 'welcome-content.tsx');
const STATES = read('components', 'onboarding', 'states-step.tsx');
const ALLERGENS = read('components', 'onboarding', 'allergens-step.tsx');
const RETAILERS = read('components', 'onboarding', 'retailers-step.tsx');
const PREVIEW = read('components', 'onboarding', 'preview-step.tsx');
const EDUCATION = read('components', 'onboarding', 'notification-education.tsx');
const SAMPLE = read('components', 'onboarding', 'sample-recall-card.tsx');
const PANEL = read('components', 'paywall', 'paywall-panel.tsx');
const FORM = read('components', 'settings', 'personalization-form.tsx');
const ROUTES = {
  welcome: read('app', 'onboarding', 'welcome.tsx'),
  states: read('app', 'onboarding', 'states.tsx'),
  allergens: read('app', 'onboarding', 'allergens.tsx'),
  retailers: read('app', 'onboarding', 'retailers.tsx'),
  preview: read('app', 'onboarding', 'preview.tsx'),
  education: read('app', 'onboarding', 'notifications.tsx'),
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

  // Allergens: its own fixed one-element controls slot.
  const allergens = componentBody(ALLERGENS, 'AllergensStep');
  const allergenControls = allergens.slice(
    allergens.indexOf('const controls = ('),
    allergens.indexOf('return ('),
  );
  assert.ok(allergenControls.includes('label={CLEAR_SELECTION_LABEL}'));
  assert.ok(
    !/\?\s*\(/.test(allergenControls) && !allergenControls.includes('&&'),
    'Clear selection is conditional on Allergens',
  );
  assert.ok(allergenControls.includes('disabled={selected.length === 0}'));
  assert.ok(
    allergens.includes('if (selected.length === 0) return;'),
    'an empty clear must be a true no-op',
  );
  assert.ok(allergens.includes('<View style={styles.controls}>{controls}</View>'));

  // Retailers: the search, then Clear — a fixed two-element column.
  const retailers = componentBody(RETAILERS, 'RetailersStep');
  const retailerControls = retailers.slice(
    retailers.indexOf('<View style={styles.controls}>'),
    retailers.indexOf('<View style={styles.rows}>'),
  );
  assert.ok(retailerControls.includes('{controls}'));
  assert.ok(retailerControls.includes('label={CLEAR_SELECTION_LABEL}'));
  assert.ok(
    !/\?\s*\(/.test(retailerControls) && !retailerControls.includes('&&'),
    'Clear selection is conditional on Retailers',
  );
  assert.ok(retailerControls.includes('disabled={selected.length === 0}'));
  assert.ok(retailers.includes('if (selected.length === 0) return;'));
});

test('the count line above every list is unconditional, so a selection change never moves the rows', () => {
  for (const [name, source, label] of [
    ['states', STATES, 'stateCountLabel(draft.length)'],
    ['allergens', ALLERGENS, 'allergenCountLabel(selected.length)'],
    ['retailers', RETAILERS, 'storeCountLabel(selected.length)'],
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
  assert.ok(ROUTES.retailers.includes('update(toggleRetailer(prefs, id))'));
  // The selectors ARE the shared selectors.
  assert.ok(STATES.includes('<StateSelectorContent'));
  assert.ok(RETAILERS.includes('<StoreSelectorContent'));
  assert.ok(ALLERGENS.includes('CONSUMER_ALLERGENS.map((option) =>'));
  // The Preview summary reads the Profile card's own summary rule.
  assert.ok(PREVIEW.includes('summarizePreferences(prefs)'));
});

// ── Copy, verbatim ──────────────────────────────────────────────────────────

test('the founder’s onboarding copy, verbatim, rendered from the copy module', () => {
  assert.equal(WORDMARK, 'lotly');
  assert.equal(WELCOME_HEADLINE, 'Food recalls, made personal.');
  assert.equal(
    WELCOME_BODY,
    'Tell us where you shop and what your household avoids. Lotly shows you the recalls that matter.',
  );
  assert.equal(WELCOME_EXAMPLE_LABEL, 'Example');
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
  assert.equal(
    RETAILERS_BODY,
    'Choose the retailers you want Lotly to watch for in recall notices. This is optional.',
  );
  assert.equal(CONTINUE_CTA, 'Continue');
  assert.equal(PREVIEW_HEADLINE, 'Your recall watch is ready.');
  assert.equal(PREVIEW_BODY, 'Lotly will flag notices that match your profile with Affects You.');
  assert.deepEqual(PREVIEW_SUMMARY_LABELS, {
    states: 'States',
    allergens: 'Allergens',
    retailers: 'Retailers',
  });
  assert.equal(PREVIEW_EXAMPLE_LABEL, 'Example match');
  assert.equal(PREVIEW_CTA, 'View plans');
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
        'WELCOME_EXAMPLE_LABEL',
        'WELCOME_TRUST_NOTE',
        'WELCOME_CTA',
        'WORDMARK',
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
      ['RETAILERS_HEADLINE', 'RETAILERS_BODY', 'CONTINUE_CTA', 'CLEAR_SELECTION_LABEL'],
    ],
    [
      'preview',
      PREVIEW,
      [
        'PREVIEW_HEADLINE',
        'PREVIEW_BODY',
        'PREVIEW_CTA',
        'PREVIEW_EDIT',
        'PREVIEW_EXAMPLE_LABEL',
        'INDEPENDENCE_NOTE',
        'PREVIEW_NONE',
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

test('the Preview keeps all three summary rows and shows None for an empty optional group', () => {
  const code = codeOnly(PREVIEW);
  assert.ok(code.includes("{ key: 'states', names: summary.states }"));
  assert.ok(code.includes("{ key: 'allergens', names: summary.allergens }"));
  assert.ok(code.includes("{ key: 'retailers', names: summary.retailers }"));
  assert.ok(code.includes("{row.names.length === 0 ? PREVIEW_NONE : row.names.join(', ')}"));
  assert.ok(!code.includes('rows.filter('), 'an empty row is removed');
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
  // Both screens label it above the card.
  assert.ok(WELCOME.includes('label={WELCOME_EXAMPLE_LABEL}'));
  assert.ok(PREVIEW.includes('<SampleRecallCard label={PREVIEW_EXAMPLE_LABEL} />'));
  // The optional peek and entrance are Welcome's alone; the Preview's card is as it was.
  assert.ok(!PREVIEW.includes('peek=') && !PREVIEW.includes('motion='));
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

// ── Welcome: M01 peeking over the real example card ─────────────────────────

test('Welcome draws M01 whole, seated on the real example card, decorative and out of the way', () => {
  const code = codeOnly(WELCOME);
  // M01, the approved welcome-peek asset, and no other picture: the old
  // standalone mascot is gone.
  assert.ok(
    code.includes("require('@/assets/brand/production/lotly-mascot-welcome-peek-1024.png')"),
    'Welcome does not draw M01',
  );
  assert.ok(!code.includes('lotly-mascot-transparent.png'), 'the standalone mascot came back');
  assert.equal((code.match(/require\(/g) ?? []).length, 1, 'Welcome bundles a second picture');
  assert.equal((code.match(/<Image\b/g) ?? []).length, 1);
  // Drawn whole: contain, never cover or stretch, and never on a dark surface.
  assert.ok(code.includes('resizeMode="contain"'));
  assert.ok(!code.includes("'cover'") && !code.includes('"cover"'), 'the mascot can be cropped');
  assert.ok(!code.includes('background/brand'), 'the mascot sits on a dark surface');
  // Given a width and a height (aspectRatio alone drew it at 1024pt on device).
  assert.ok(code.includes('style={{ width: size, height: size }}'));
  // The real card, not a picture of one: the mascot is the card's `peek`,
  // seated so its flat cut lands on the card's top border.
  const welcome = codeOnly(componentBody(WELCOME, 'WelcomeContent'));
  assert.ok(welcome.includes('<SampleRecallCard'));
  assert.ok(welcome.includes('peek={'));
  assert.ok(welcome.includes('top: -mascotOffset(size)'));
  assert.ok(code.includes("position: 'absolute'") && code.includes('right: 0,'));
  // Decorative, and never in the way: no touches, not in the accessibility tree.
  const peek = welcome.slice(welcome.indexOf('peek={'), welcome.indexOf('<Image'));
  assert.ok(peek.includes('pointerEvents="none"'));
  assert.ok(peek.includes('accessible={false}'));
  assert.ok(peek.includes('accessibilityElementsHidden'));
  assert.ok(peek.includes('importantForAccessibility="no-hide-descendants"'));
  // In the card component the peek is the card's SIBLING, after it: drawn over
  // the card, outside the card's accessibility element and its entrance.
  const sample = codeOnly(SAMPLE);
  const card = sample.indexOf('accessibilityLabel={`${label}. ${SAMPLE_ACCESSIBILITY}`}');
  const cardEnd = sample.indexOf('</Animated.View>', card);
  assert.ok(card > 0 && cardEnd > card);
  assert.ok(sample.indexOf('{peek}') > cardEnd, 'the peek is inside the card element');
  // The name is set in the type system, lowercase, from the copy module.
  assert.ok(code.includes('<Text variant="heading-2" color="text/primary">'));
  assert.ok(code.includes('{WORDMARK}'));
  // Nothing invented: no traced wordmark, logo file, or alarm imagery.
  for (const forbidden of [
    'logo.png',
    'wordmark.png',
    'shield',
    'siren',
    'cart',
    'LinearGradient',
  ]) {
    assert.ok(!code.includes(forbidden), `Welcome renders ${forbidden}`);
  }
});

test('M01 scales between its bounds, its paws stay inside the card padding, and it never reaches the text above', () => {
  assert.equal(mascotSize(667), MASCOT_MIN, 'iPhone SE');
  assert.equal(mascotSize(874), MASCOT_MAX, 'iPhone 17 / 17 Pro');
  assert.equal(mascotSize(956), MASCOT_MAX, 'the largest phones stop at the ceiling');
  assert.equal(mascotSize(0), MASCOT_MIN);
  for (const height of [568, 667, 736, 812, 844, 874, 926, 956, 1366]) {
    const size = mascotSize(height);
    assert.equal(size % 4, 0, `${height}pt window gives an off-grid ${size}`);
    assert.ok(size >= MASCOT_MIN && size <= MASCOT_MAX);
  }
  // The card's padding is the one the paws must stay inside.
  assert.ok(read('components', 'recall-card.tsx').includes('padding: spacing[12],'));
  assert.equal(CARD_PADDING, 12);
  for (const size of [MASCOT_MIN, MASCOT_MAX]) {
    // The flat cut is seated on the border; the paws end above the first row.
    assert.equal(mascotOffset(size), Math.round(size * MASCOT_EDGE));
    assert.ok(size * PAW_DEPTH < CARD_PADDING - 1, `${size}pt paws reach the card's badges`);
    // The block reserves the standing height beside the label, so the drawing
    // never overlaps the body text above it.
    assert.equal(mascotLift(size), Math.ceil(size * (MASCOT_EDGE - MASCOT_ART_TOP)));
    assert.equal(peekReserve(size) + LABEL_ALLOWANCE, mascotLift(size));
  }
  const welcome = codeOnly(componentBody(WELCOME, 'WelcomeContent'));
  assert.ok(welcome.includes('paddingTop: peekReserve(size)'));
});

test('Welcome is one promise, one example and one action: the three-bullet marketing block is gone', () => {
  // The benefit copy no longer exists, and Welcome renders no list of claims.
  assert.ok(!('WELCOME_BENEFITS' in ONBOARDING_COPY), 'the Welcome benefits came back');
  const welcome = codeOnly(componentBody(WELCOME, 'WelcomeContent'));
  assert.ok(!welcome.includes('BenefitList'), 'Welcome renders the benefit rows again');
  assert.ok(!welcome.includes('accessibilityRole="list"'));
  // One example (the shared card surface), one source note, one action.
  assert.equal((welcome.match(/<SampleRecallCard\b/g) ?? []).length, 1);
  assert.equal((welcome.match(/<Button /g) ?? []).length, 1);
  assert.ok(welcome.includes('{WELCOME_TRUST_NOTE}'));
  // The paywall still owns its benefit list, unchanged.
  assert.ok(PANEL.includes('<BenefitList items={PAYWALL_BENEFITS} />'));
});

test('Get started still advances through the existing onboarding action', () => {
  // The component hands the press to its caller, from the sticky footer.
  const welcome = codeOnly(componentBody(WELCOME, 'WelcomeContent'));
  assert.ok(welcome.includes('footer={<Button label={WELCOME_CTA} onPress={onGetStarted} />}'));
  // The route is unchanged: record Welcome as the resume point, push States.
  const route = codeOnly(ROUTES.welcome);
  assert.ok(route.includes("void access.recordShownStep('welcome');"));
  assert.ok(
    route.includes(
      "return <WelcomeContent onGetStarted={() => router.push(onboardingRoute('states'))} />;",
    ),
  );
});

test('the entrance plays once in under a second, loops nothing, and is skipped under Reduce Motion', () => {
  // The timeline: the heading, then the mascot rising from behind the card,
  // then the card following it as one moment; done within 900ms.
  assert.ok(entranceEndMs() >= 600 && entranceEndMs() <= 900, `ends at ${entranceEndMs()}ms`);
  assert.ok(WELCOME_ENTRANCE.mascotFade.delay > WELCOME_ENTRANCE.heading.delay);
  assert.equal(WELCOME_ENTRANCE.mascotRise.delay, WELCOME_ENTRANCE.mascotFade.delay);
  assert.ok(WELCOME_ENTRANCE.card.delay > WELCOME_ENTRANCE.mascotFade.delay, 'the card leads');
  // The card follows while the mascot is still arriving: one moment, not two.
  assert.ok(
    WELCOME_ENTRANCE.card.delay <
      WELCOME_ENTRANCE.mascotRise.delay + WELCOME_ENTRANCE.mascotRise.duration,
  );
  // Reduce Motion means the final state at once.
  assert.equal(welcomeEntrance(true), 'show');
  assert.equal(welcomeEntrance(false), 'animate');

  const code = codeOnly(WELCOME);
  // The setting is read, an unreadable setting counts as on, and "show" sets
  // every value to its end state with no animation.
  assert.ok(code.includes('AccessibilityInfo.isReduceMotionEnabled()'));
  assert.ok(code.includes('.catch(() => true)'));
  assert.ok(code.includes("if (welcomeEntrance(reduceMotion) === 'show') {"));
  assert.ok(code.includes('for (const value of values) value.setValue(1);'));
  // React Native's own Animated, on the native driver; nothing repeats.
  assert.ok(code.includes('useNativeDriver: true'));
  for (const forbidden of [
    'Animated.loop',
    'iterations',
    'setInterval',
    'requestAnimationFrame',
    'react-native-reanimated',
    "from 'moti'",
    'lottie',
  ]) {
    assert.ok(!code.includes(forbidden), `the entrance uses ${forbidden}`);
  }
  // The action never animates: the footer is the plain shared Button.
  const welcome = codeOnly(componentBody(WELCOME, 'WelcomeContent'));
  assert.ok(welcome.includes('footer={<Button label={WELCOME_CTA} onPress={onGetStarted} />}'));
  // The mascot, the card and the source note each carry their own entrance.
  assert.ok(welcome.includes('motion.mascot'));
  assert.equal((welcome.match(/motion\.card/g) ?? []).length, 2, 'the card and the source note');
  // Only Welcome passes a heading motion to the shared frame.
  for (const [name, source] of [
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

test('at the accessibility text sizes the paywall’s disclosure and actions leave the sticky footer for the content, read reactively', () => {
  const panel = codeOnly(PANEL);
  // The reader's text scale is an input, read so a change moves the block
  // rather than waiting for a cold launch — the settings selector's technique.
  assert.ok(panel.includes('const { fontScale } = useWindowDimensions();'));
  assert.ok(panel.includes('const placement = paywallFooterPlacement(fontScale);'));
  // One block, drawn once, placed in exactly one of the two slots: the
  // sticky footer keeps the notice and the primary action at every size.
  assert.equal(panel.split('accessibilityRole="toolbar"').length, 2, 'the toolbar is drawn once');
  assert.ok(panel.includes("{placement === 'sticky' ? terms : null}"));
  assert.ok(
    panel.includes(
      "{placement === 'inline' ? <View style={styles.inlineTerms}>{terms}</View> : null}",
    ),
  );
  assert.ok(
    panel.indexOf('onPress={onSubscribe}') <
      panel.indexOf("{placement === 'sticky' ? terms : null}"),
    'the primary action stays in the sticky footer',
  );
  assert.ok(
    panel.indexOf('{children}') < panel.indexOf("{placement === 'inline'"),
    'inline, the block is the last thing in the content, directly above the sticky action',
  );
});

// ── P2B7Y: the four-step progress ───────────────────────────────────────────

test('the progress speaks its step by name, fills every step up to the current one, and appears on the four counted steps only', () => {
  assert.deepEqual(
    COUNTED_STEPS.map((step) => progressAccessibilityLabel(stepProgress(step)!)),
    [
      'Step 1 of 4: States',
      'Step 2 of 4: Allergens',
      'Step 3 of 4: Stores',
      'Step 4 of 4: Preview',
    ],
  );
  assert.deepEqual(filledSegments({ index: 1, total: 4 }), [true, false, false, false]);
  assert.deepEqual(filledSegments({ index: 3, total: 4 }), [true, true, true, false]);
  // One element, spoken once; the `1 of 4` words stay visible.
  const progress = codeOnly(componentBody(PROGRESS, 'OnboardingProgress'));
  assert.ok(progress.includes('accessibilityLabel={progressAccessibilityLabel(progress)}'));
  assert.ok(progress.includes('{progressLabel(progress)}'));
  // Its own named token for the filled segments; the quiet track for the rest.
  const code = codeOnly(PROGRESS);
  assert.ok(code.includes("backgroundColor: color['onboarding/progress']"));
  assert.ok(code.includes("backgroundColor: color['background/subtle']"));
  // The frame draws it only when a step passes progress, and exactly the
  // four counted steps (and their pending state) do; Welcome, the paywall and
  // the education pass none.
  assert.ok(codeOnly(FRAME).includes('<OnboardingProgress progress={progress} />'));
  assert.ok(codeOnly(FRAME).includes('{progress ? ('));
  for (const [name, source] of [
    ['states', STATES],
    ['allergens', ALLERGENS],
    ['retailers', RETAILERS],
    ['preview', PREVIEW],
  ] as const) {
    assert.ok(source.includes('progress={stepProgress('), `${name} has no progress`);
  }
  for (const [name, source] of [
    ['welcome', WELCOME],
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
  ] as const) {
    const code = codeOnly(source);
    // Decided on the first render; the final state is drawn at once otherwise.
    assert.ok(code.includes('const [animate] = useState(() => motionAllowed(reduceMotion));'));
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

test('M02 sits beside the Map / List control: decorative, hidden, touching nothing, never over the map', () => {
  const mascot = codeOnly(componentBody(STATES, 'HelperMascot'));
  assert.ok(mascot.includes("require('@/assets/brand/production/lotly-mascot-helper-1024.png')"));
  assert.ok(mascot.includes('pointerEvents="none"'));
  assert.ok(mascot.includes('accessible={false}'));
  assert.ok(mascot.includes('accessibilityElementsHidden'));
  assert.ok(mascot.includes('importantForAccessibility="no-hide-descendants"'));
  assert.ok(mascot.includes('resizeMode="contain"'));
  assert.ok(mascot.includes('style={{ width: HELPER_MASCOT_SIZE, height: HELPER_MASCOT_SIZE }}'));
  assert.ok(!mascot.includes("position: 'absolute'"), 'the mascot floats over something');
  // In the control's row, not the map's; yielding its room at large text.
  const step = codeOnly(componentBody(STATES, 'StatesStep'));
  const row = step.slice(
    step.indexOf('<View style={styles.modeRow}>'),
    step.indexOf("{mode === 'map'"),
  );
  assert.ok(row.includes('<HelperMascot />'));
  assert.ok(row.includes('fontScale < HIDE_MASCOT_AT_SCALE'));
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
