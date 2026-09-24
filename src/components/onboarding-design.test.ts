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
 * height around text; and the Welcome shows no invented brand mark.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ALLERGENS_BODY,
  ALLERGENS_HEADLINE,
  allergenCountLabel,
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
  WELCOME_BENEFITS,
  WELCOME_BODY,
  WELCOME_CTA,
  WELCOME_HEADLINE,
  WELCOME_TRUST_NOTE,
  WORDMARK,
} from '@/lib/onboarding-copy';
import { SAMPLE_RECALL_MODEL } from '@/lib/onboarding-sample';

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
  assert.ok(
    states.includes("{canContinue ? ' ' : STATES_REQUIRED_NOTE}"),
    'the reason line is not permanently allocated',
  );
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
  assert.equal(WORDMARK, 'Lotly');
  assert.equal(WELCOME_HEADLINE, 'Food recalls, filtered for you.');
  assert.equal(
    WELCOME_BODY,
    'Lotly turns FDA and USDA recall notices into clear alerts based on where you shop and what you avoid.',
  );
  assert.deepEqual(WELCOME_BENEFITS, [
    'Personalized to your household',
    'Clear product photos and details',
    'Alerts when a recall matches',
  ]);
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
        'WELCOME_BENEFITS',
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
  assert.ok(WELCOME.includes('<SampleRecallCard label={WELCOME_EXAMPLE_LABEL} />'));
  assert.ok(PREVIEW.includes('<SampleRecallCard label={PREVIEW_EXAMPLE_LABEL} />'));
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

test('the Welcome invents no brand mark: the wordmark is the product name in the display type', () => {
  const code = codeOnly(WELCOME);
  assert.ok(code.includes('lead={<Text variant="display">{WORDMARK}</Text>}'));
  assert.ok(code.includes('{WORDMARK}'));
  for (const forbidden of ['logo.png', 'wordmark.png', 'shield', 'siren', 'cart', 'Image']) {
    assert.ok(!code.includes(forbidden), `Welcome renders ${forbidden}`);
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
