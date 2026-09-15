/**
 * The Lotly shopper-report questionnaire (P2B3), pinned at the source level.
 *
 * React Native components cannot render under Node, so — as the
 * feed-design, detail-design and wiring suites do — these tests read the
 * route, its step components, the two new primitives and the development
 * hub as text and pin what the milestone promises: the question order and
 * the unknown-geography omission come from the contract; no free-text field
 * exists; the disclosure, success, submit and update words are the
 * contract's; removal exists only while editing; no health question exists;
 * the server gate is still the only gate and the screen does no count
 * arithmetic; success restates no metric; every surface draws from the
 * tokens and the type scale with the accessibility floor met; and the
 * development preview renders the real steps and never a copy. The
 * behavioural contracts themselves are pinned where they always were (the
 * presentation, wiring and preview-safety suites); this file pins the
 * restyle.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { hitTarget } from '@/constants/design-tokens';
import type { Geography } from '@/domain/recall-types';
import { evaluateReportEligibility } from '@/domain/shopper-report';
import { DESIGN_PREVIEW_SCENARIOS } from '@/lib/design-preview';
import {
  EMPTY_ANSWERS,
  PRIVACY_LINK_HINT,
  PRIVACY_LINK_LABEL,
  questionnaireOutcome,
  questionnaireSteps,
  questionProgressLabel,
  REPORT_UNAVAILABLE,
  reviewRows,
  RETAILER_NOT_SURE,
  SUBMISSION_DISCLOSURE,
  SUBMIT_ACTION,
  SUCCESS_BODY,
  SUCCESS_TITLE,
  UPDATE_ACTION,
} from '@/lib/shopper-report-presentation';

const SRC = join(__dirname, '..');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');

const SCREEN = read('app', 'report', '[id].tsx');
const STEPS = read('components', 'report-questionnaire.tsx');
const BUTTON = read('components', 'ui', 'button.tsx');
const CHOICE = read('components', 'ui', 'choice-row.tsx');
const HUB = read('app', 'design-preview', 'index.tsx');
const STORE = read('lib', 'shopper-report-store.ts');
const PRESENTATION = read('lib', 'shopper-report-presentation.ts');
const ROOT_LAYOUT = read('app', '_layout.tsx');

/** Source with comments removed, so a file may document what it avoids. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');
}

/** The body of one exported component in the step module. */
function step(name: string): string {
  const from = STEPS.indexOf(`export function ${name}(`);
  assert.ok(from !== -1, `${name} is missing`);
  const next = STEPS.indexOf('\nexport ', from + 1);
  return STEPS.slice(from, next === -1 ? STEPS.length : next);
}

const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/;
const OFF_SCALE_NUMBER = /\b(padding|margin|gap|rowGap|columnGap|borderRadius)[A-Za-z]*:\s*-?\d/;

const MULTI = { allowedStateCodes: ['CA', 'NV'], retailerChoices: ['Costco Wholesale'] };
const SINGLE = { allowedStateCodes: ['CA'], retailerChoices: [] };
/** A section shape the product never produces — see the ineligibility test. */
const NO_GEOGRAPHY = { allowedStateCodes: [], retailerChoices: [] };

/** Every way a notice can fail to name a jurisdiction a report could carry. */
const UNUSABLE_GEOGRAPHY: Geography[] = [
  { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
  { scope: 'states', states: [], confidence: 'stated', sourceText: null },
  // A stated place the jurisdiction registry cannot name is no jurisdiction
  // either: there would be nothing to submit for it.
  { scope: 'states', states: ['Atlantis'], confidence: 'stated', sourceText: null },
];

// ── 1. Question order and omissions ─────────────────────────────────────────

test('the question order is state, retailer, timeframe, and the contract decides it', () => {
  assert.deepEqual(questionnaireSteps(MULTI), ['state', 'retailer', 'window']);
  assert.deepEqual(questionnaireSteps(SINGLE), ['state', 'window']);
  // The route walks the contract's steps in order and never reorders them.
  assert.ok(
    SCREEN.includes('const steps: QuestionKey[] = section ? questionnaireSteps(section) : [];'),
  );
  assert.ok(SCREEN.includes('const key = steps[screen.index];'));
  assert.ok(SCREEN.includes("setScreen({ kind: 'question', index: screen.index + 1 });"));
  assert.ok(SCREEN.includes("setScreen({ kind: 'review' });"));
  // The step renders the question the contract names for the key, and says
  // where the shopper is in words.
  assert.ok(STEPS.includes('questionPrompt(stepKey, section)'));
  assert.ok(STEPS.includes('questionProgressLabel(stepIndex, stepCount)'));
  assert.equal(questionProgressLabel(0, 3), 'Question 1 of 3');
  assert.equal(questionProgressLabel(2, 3), 'Question 3 of 3');
});

test('a recall with no official geography is ineligible: no entry point, and no draft is reachable', () => {
  // Final rule (founder decision, 2026-09-14): a report carrying only a
  // purchase timeframe says nothing about WHERE shoppers found the product,
  // which is the whole purpose of the feature, and nothing surfaces it. Such
  // a recall therefore takes no reports at all.
  //
  // The gate is the shared eligibility evaluator — the same rules the server
  // enforces, and the one `communityReportsSection` is built from — so an
  // ineligible recall gets no section, which means no community block, no
  // `Add your report`, and no questionnaire. (That the section itself is
  // null for these shapes is pinned in recall-presentation.test.ts.)
  for (const geography of UNUSABLE_GEOGRAPHY) {
    const eligibility = evaluateReportEligibility({
      state: 'active',
      geography,
      // Even a notice naming stores stays ineligible: a store without a
      // jurisdiction is not the answer the feature exists to collect.
      retailerNames: ['Costco Wholesale'],
    });
    assert.equal(eligibility.eligible, false, `${geography.scope} geography was eligible`);
    assert.equal(eligibility.eligible === false && eligibility.reason, 'geography_unusable');
  }

  // The questionnaire consequently always asks the state question, and asks
  // it first — there is no timeframe-only flow left to model.
  for (const choices of [MULTI, SINGLE, NO_GEOGRAPHY]) {
    assert.equal(questionnaireSteps(choices)[0], 'state');
  }
  // …and no set of answers can reach a draft without a jurisdiction: the
  // flow stays incomplete at `state` rather than inventing one.
  const noState = {
    ...EMPTY_ANSWERS,
    retailer: RETAILER_NOT_SURE,
    purchaseWindow: 'past_month' as const,
  };
  for (const choices of [MULTI, SINGLE, NO_GEOGRAPHY]) {
    assert.deepEqual(questionnaireOutcome(noState, choices), { kind: 'incomplete', next: 'state' });
  }
  // The retired timeframe-only verdict cannot return.
  assert.ok(
    !codeOnly(PRESENTATION).includes("'unsupported'"),
    'the timeframe-only outcome returned',
  );
  // And the development preview offers no stateless questionnaire to imply
  // one is submittable — it shows the screen's honest unavailable state.
  assert.ok(!HUB.includes('the timeframe is the whole form'));
  assert.ok(!codeOnly(HUB).includes('stateless'));
  assert.ok(HUB.includes('<StateMessage {...REPORT_UNAVAILABLE} />'));
});

test('the review shows only the answers that were actually collected', () => {
  // Rows come from the contract, so a question this recall never asked has
  // no row and an unanswered one is omitted rather than shown blank.
  assert.deepEqual(
    reviewRows({ ...EMPTY_ANSWERS, stateCode: 'CA', purchaseWindow: 'past_week' }, SINGLE),
    [
      { key: 'state', prompt: 'Did you find this product in California?', answer: 'California' },
      { key: 'window', prompt: 'When did you buy it?', answer: 'In the past week' },
    ],
  );
  const review = step('ReviewStep');
  assert.ok(review.includes('reviewRows(answers, section)'));
  assert.ok(!review.includes('stateCode'), 'the review reads a state directly');
  assert.ok(!review.includes('retailer'), 'the review reads a retailer directly');
  assert.ok(!review.includes('purchaseWindow'), 'the review reads a timeframe directly');
});

test('the retailer question is absent when the notice names no store', () => {
  assert.deepEqual(questionnaireSteps(SINGLE), ['state', 'window']);
  assert.deepEqual(
    reviewRows({ ...EMPTY_ANSWERS, stateCode: 'CA', purchaseWindow: 'past_week' }, SINGLE).map(
      (row) => row.key,
    ),
    ['state', 'window'],
  );
  // The step draws the store choices only for the retailer key, from the
  // section's own list.
  assert.match(step('QuestionStep'), /\{stepKey === 'retailer' \? \(/);
  assert.ok(step('QuestionStep').includes('retailerOptions(section.retailerChoices)'));
});

// ── 2. No free text, no health question ─────────────────────────────────────

test('there is no free-text field: every answer is a radio row, and the only field filters states', () => {
  for (const [name, source] of [
    ['screen', SCREEN],
    ['steps', STEPS],
  ] as const) {
    assert.ok(!source.includes('<TextInput'), `${name} mounts a raw text field`);
    assert.ok(!source.includes('onChangeText={(text) =>'), `${name} stores typed text`);
  }
  assert.equal((STEPS.match(/<SearchBar\b/g) ?? []).length, 1);
  // The search field's only writer is the picker's local query state.
  const picker = STEPS.slice(STEPS.indexOf('function StatePicker('), STEPS.indexOf('// ── Review'));
  assert.ok(picker.includes("const [query, setQuery] = useState('');"));
  assert.ok(picker.includes('onChangeText={setQuery}'));
  assert.ok(picker.includes('filterStateOptions(options, query)'));
  assert.ok(!picker.includes('onChange(query)'), 'the query became an answer');
  // The field is labelled, explained, and never an answer.
  assert.ok(picker.includes('accessibilityLabel={STATE_SEARCH_LABEL}'));
  assert.ok(picker.includes('accessibilityHint={STATE_SEARCH_HINT}'));
  assert.ok(picker.includes('{STATE_SEARCH_NO_MATCH}'));
  // Every answer control is the shared radio row inside a radio group.
  assert.equal((STEPS.match(/<ChoiceGroup\b/g) ?? []).length, 4);
  assert.ok(!STEPS.includes('<Pressable') || (STEPS.match(/<Pressable\b/g) ?? []).length === 1);
});

test('no health, contact, proof or note question exists anywhere in the flow', () => {
  for (const forbidden of [
    'symptom',
    'illness',
    'sick',
    'email',
    'phone',
    'photo',
    'receipt',
    'comment',
    'note',
    'address',
    'lot code',
  ]) {
    for (const [name, source] of [
      ['screen', SCREEN],
      ['steps', STEPS],
      ['choice row', CHOICE],
      ['button', BUTTON],
    ] as const) {
      assert.ok(!source.toLowerCase().includes(forbidden), `${name} mentions ${forbidden}`);
    }
  }
  // The contract still names exactly three questions.
  assert.match(
    codeOnly(PRESENTATION),
    /export type QuestionKey = 'state' \| 'retailer' \| 'window';/,
  );
});

// ── 3. Copy ─────────────────────────────────────────────────────────────────

test('the disclosure and success copy are exact, and the steps render the constants', () => {
  assert.equal(
    `${SUBMISSION_DISCLOSURE} ${PRIVACY_LINK_LABEL}`,
    'Your anonymous report contributes to community totals and does not change official recall information. Learn more.',
  );
  assert.equal(SUCCESS_TITLE, 'Thanks for contributing!');
  assert.equal(SUCCESS_BODY, 'Your report helps other shoppers make safer decisions.');
  const review = step('ReviewStep');
  assert.ok(review.includes('{SUBMISSION_DISCLOSURE}'));
  assert.ok(review.includes('{PRIVACY_LINK_LABEL}'));
  assert.ok(
    SCREEN.includes("pathname: '/document/[slug]', params: { slug: PRIVACY_DOCUMENT_SLUG }"),
  );
  assert.ok(!SCREEN.includes('privacy-policy') && !STEPS.includes('privacy-policy'));
  // Success renders exactly the two contract strings and the way out.
  assert.ok(
    SCREEN.includes('<OutcomeStep title={SUCCESS_TITLE} body={SUCCESS_BODY} onDone={done} />'),
  );
});

test('only “Learn more.” is interactive: the disclosure sentence is static text', () => {
  const review = step('ReviewStep');
  const block = review.slice(
    review.indexOf('<View style={styles.disclosure}>'),
    review.indexOf('<View style={styles.actions}>'),
  );
  assert.ok(block.includes('{SUBMISSION_DISCLOSURE}'), 'the disclosure block was not found');

  // The sentence renders as an ordinary Text with no press handler and no
  // role — it states a fact, and a statement is not a control.
  const sentence = block.slice(0, block.indexOf('<Pressable'));
  assert.match(
    sentence,
    /<Text variant="body-small" color="text\/secondary">\s*\{SUBMISSION_DISCLOSURE\}/,
  );
  for (const interactive of ['onPress', 'accessibilityRole', 'Pressable']) {
    assert.ok(!sentence.includes(interactive), `the disclosure sentence is ${interactive}`);
  }

  // The link is the tail alone: one Pressable carrying the link role, its
  // own spoken name and hint, and the navigation.
  const link = block.slice(block.indexOf('<Pressable'));
  assert.match(link, /accessibilityRole="link"/);
  assert.match(link, /accessibilityLabel=\{PRIVACY_LINK_LABEL\}/);
  assert.match(link, /accessibilityHint=\{PRIVACY_LINK_HINT\}/);
  assert.match(link, /onPress=\{onOpenPrivacy\}/);
  assert.match(link, /<Text variant="body-small" color="action\/secondary"/);
  assert.equal((block.match(/<Pressable\b/g) ?? []).length, 1, 'the sentence gained a control');

  // …with a real 44pt target from its own row, not a caption-height line,
  // and both halves wrap freely at any type size.
  assert.ok(STEPS.includes('disclosureLink: {'));
  assert.match(STEPS.slice(STEPS.indexOf('disclosureLink: {')), /minHeight: hitTarget\.minimum/);
  assert.ok(!block.includes('numberOfLines'));
  // It still opens Privacy & Data Controls, never the unpublished policy.
  assert.ok(
    SCREEN.includes("pathname: '/document/[slug]', params: { slug: PRIVACY_DOCUMENT_SLUG }"),
  );
  assert.equal(PRIVACY_LINK_HINT, 'Opens Privacy & Data Controls');
});

test('the primary action reads Submit report for a new report and Update report while editing', () => {
  assert.equal(SUBMIT_ACTION, 'Submit report');
  assert.equal(UPDATE_ACTION, 'Update report');
  assert.ok(
    step('ReviewStep').includes("label={props.mode === 'update' ? UPDATE_ACTION : SUBMIT_ACTION}"),
  );
  // The route chooses the mode from the report the server holds, nothing else.
  assert.match(
    SCREEN,
    /return existing \? \(\s*<ReviewStep \{\.\.\.shared\} mode="update" onRemove=\{confirmRemove\} \/>\s*\) : \(\s*<ReviewStep \{\.\.\.shared\} mode="submit" \/>\s*\);/,
  );
  assert.ok(SCREEN.includes('setAnswers(answersFromReport(mine));'), 'editing is not pre-filled');
  // Double submission is impossible: the route ignores a second tap while
  // busy, and the button is inert while busy.
  assert.ok(SCREEN.includes("if (busy || outcome?.kind !== 'ready') return;"));
  assert.ok(step('ReviewStep').includes("busy={busy === 'submit'}"));
  assert.ok(step('ReviewStep').includes('disabled={!canSubmit || busy !== null}'));
  assert.ok(BUTTON.includes('accessibilityState={{ disabled: inert, busy }}'));
  assert.ok(BUTTON.includes('disabled={inert}'));
  // A refusal keeps every answer: the failure is shown, the answers untouched.
  assert.ok(SCREEN.includes('setFailure(SUBMIT_FAILURE);'));
  assert.ok(!SCREEN.includes('setAnswers(EMPTY_ANSWERS)'), 'a failure clears the answers');
  assert.ok(step('ReviewStep').includes('{failure ? <FailureMessage message={failure} /> : null}'));
});

// ── 4. Removal ──────────────────────────────────────────────────────────────

test('removal exists only while editing, behind the native confirmation, and nowhere else', () => {
  const review = step('ReviewStep');
  // The removal control renders inside the update-mode branch alone.
  const remove = review.indexOf('label={REPORT_REMOVE_ACTION}');
  assert.ok(remove !== -1);
  assert.ok(review.lastIndexOf("props.mode === 'update' ? (", remove) !== -1);
  assert.ok(review.includes('onPress={props.onRemove}'));
  assert.ok(!step('QuestionStep').includes('REPORT_REMOVE_ACTION'));
  assert.ok(!step('OutcomeStep').includes('REPORT_REMOVE_ACTION'));
  // The paused state is the one other place, for an owner while the feature is off.
  assert.ok(step('PausedStep').includes('label={REPORT_REMOVE_ACTION}'));
  assert.equal((STEPS.match(/REPORT_REMOVE_ACTION/g) ?? []).length, 3);
  // The route confirms natively; Cancel performs no mutation.
  assert.ok(SCREEN.includes('Alert.alert(REMOVE_CONFIRM_TITLE, REMOVE_CONFIRM_BODY, ['));
  assert.ok(SCREEN.includes("{ text: REMOVE_CONFIRM_CANCEL, style: 'cancel' },"));
  assert.ok(
    SCREEN.includes(
      "{ text: REMOVE_CONFIRM_REMOVE, style: 'destructive', onPress: () => void remove() },",
    ),
  );
  assert.ok(SCREEN.includes('onRemove={confirmRemove}'));
  assert.ok(!STEPS.includes('Alert'), 'a step confirms removal itself');
  // A successful removal ends on the removed outcome, whose only way out is
  // back to Detail — which re-reads the server on focus.
  assert.ok(SCREEN.includes("setScreen({ kind: 'removed' });"));
  assert.ok(SCREEN.includes('const done = () => router.back();'));
});

// ── 5. The gate and the count ───────────────────────────────────────────────

test('the production gate is still the server’s alone, and the flow does no count arithmetic', () => {
  // The route reads the server's summary and treats `unavailable` as the
  // whole gate; it holds no flag of its own and the steps hold none either.
  assert.ok(SCREEN.includes("if (summary.status === 'unavailable') {"));
  assert.ok(SCREEN.includes("setScreen({ kind: 'paused' });"));
  for (const [name, source] of [
    ['screen', SCREEN],
    ['steps', STEPS],
    ['hub', HUB],
    ['store', STORE],
  ] as const) {
    for (const forbidden of [
      'reports_enabled',
      'reportsEnabled',
      'REPORTS_ENABLED',
      'EXPO_PUBLIC_SHOPPER',
    ]) {
      assert.ok(!codeOnly(source).includes(forbidden), `${name} holds a local gate: ${forbidden}`);
    }
  }
  // The steps are network-free: no store, no API, no harness.
  for (const forbidden of [
    'shopper-report-store',
    'report-api',
    'design-preview',
    'fetch(',
    'supabase',
  ]) {
    assert.ok(!STEPS.includes(forbidden), `the steps reach ${forbidden}`);
  }
  // No count is read, moved, added to, or shown anywhere in the flow.
  for (const [name, source] of [
    ['screen', SCREEN],
    ['steps', STEPS],
  ] as const) {
    const code = codeOnly(source);
    assert.doesNotMatch(code, /\bcount\b/i, `${name} reads a count`);
    for (const forbidden of ['THRESHOLD', 'communityReportsView', 'summary.count', 'shoppers']) {
      assert.ok(!code.includes(forbidden), `${name} touches a count: ${forbidden}`);
    }
  }
  // The store's diversions are unchanged: the harness is consulted, the
  // server path is the fallthrough.
  assert.equal((codeOnly(STORE).match(/previewShopperState\(/g) ?? []).length, 2);
});

// ── 6. Tokens, typography, geometry ─────────────────────────────────────────

test('the route, the steps and the primitives draw from the tokens and the type scale only', () => {
  for (const [name, source] of [
    ['screen', SCREEN],
    ['steps', STEPS],
    ['button', BUTTON],
    ['choice row', CHOICE],
  ] as const) {
    const code = codeOnly(source);
    assert.ok(source.includes("from '@/constants/design-tokens'"), `${name} imports the tokens`);
    for (const legacy of [
      'ThemedText',
      'ThemedView',
      "from '@/constants/theme'",
      'Spacing.',
      'Radii.',
      'MaxContentWidth',
      'useTheme',
      'Colors.',
    ]) {
      assert.ok(!source.includes(legacy), `${name} still uses ${legacy}`);
    }
    assert.ok(!HEX_LITERAL.test(code), `${name} spells a colour`);
    assert.ok(
      !OFF_SCALE_NUMBER.test(code),
      `${name} has an off-scale padding, margin, gap or radius`,
    );
    for (const forbidden of ['fontSize:', 'fontWeight:', 'fontFamily:', 'lineHeight:']) {
      assert.ok(!code.includes(forbidden), `${name} sets ${forbidden}`);
    }
    for (const element of code.match(/<Text\b[^>]*>/g) ?? []) assert.match(element, /variant="/);
    // Public Sans throughout: the mono `label` variants are never used here.
    assert.ok(!code.includes('variant="label'), `${name} uses the mono label type`);
    assert.ok(!code.includes('maxFontSizeMultiplier'), `${name} caps Dynamic Type`);
    assert.ok(!code.includes('numberOfLines'), `${name} truncates text`);
    assert.ok(!code.includes('ellipsizeMode'), `${name} truncates text`);
    assert.ok(!code.includes('Animated'), `${name} animates`);
  }
  // Hierarchy: the question, the review title and the outcome title are heading-2.
  assert.ok(step('QuestionStep').includes('<Text variant="heading-2" accessibilityRole="header">'));
  assert.ok(step('ReviewStep').includes('<Text variant="heading-2" accessibilityRole="header">'));
  assert.ok(step('OutcomeStep').includes('<Text variant="heading-2" accessibilityRole="header">'));
  // The warm page, white selection surfaces, approved borders and radii.
  assert.ok(SCREEN.includes('<Surface background="background/page" style={styles.page}>'));
  assert.ok(CHOICE.includes('radius={12}') && CHOICE.includes('border="border/default"'));
  assert.ok(CHOICE.includes("borderColor: color['action/primary']"));
  assert.ok(BUTTON.includes("backgroundColor: color['action/primary']"));
  assert.ok(BUTTON.includes("backgroundColor: color['action/disabled']"));
  assert.ok(BUTTON.includes('borderRadius: radius.full'));
  assert.ok(
    step('ReviewStep').includes(
      '<Surface radius={12} border="border/subtle" style={styles.reviewCard}>',
    ),
  );
  // Content-driven layout: no fixed height anywhere but the radio
  // indicator's ring and dot, which are icon-scale glyphs.
  const heights = [SCREEN, STEPS, BUTTON, CHOICE].flatMap(
    (source) => codeOnly(source).match(/\bheight: [^,]+/g) ?? [],
  );
  assert.deepEqual(heights, ['height: iconSize[20]', 'height: iconSize[12]']);
  // The indicator is centred on the row, never pinned to an unscaled line box.
  assert.ok(CHOICE.includes("alignItems: 'center'"));
  assert.ok(!CHOICE.includes('lineHeight'));
  // Safe area and keyboard.
  assert.ok(SCREEN.includes('paddingBottom: spacing[24] + insets.bottom'));
  assert.ok(SCREEN.includes('keyboardShouldPersistTaps="handled"'));
  assert.ok(SCREEN.includes('keyboardDismissMode="on-drag"'));
  assert.ok(SCREEN.includes('automaticallyAdjustKeyboardInsets'));
  // The screen title and the whole-screen states are the shared ones.
  assert.ok(
    ROOT_LAYOUT.includes(
      `<Stack.Screen name="report/[id]" options={{ title: 'Share a shopper report' }} />`,
    ),
  );
  assert.ok(SCREEN.includes('<StateMessage {...REPORT_LOADING} tone="loading" />'));
  assert.ok(SCREEN.includes('<StateMessage {...REPORT_UNAVAILABLE} />'));
  assert.doesNotMatch(REPORT_UNAVAILABLE.body, /closed|retracted|disabled|ineligible|server/i);
});

// ── 7. Accessibility ────────────────────────────────────────────────────────

test('every control meets the 44pt floor with the right role and state', () => {
  assert.equal(hitTarget.minimum, 44);
  // Buttons and rows are at least the minimum tall; the disclosure link too.
  assert.ok(BUTTON.includes('minHeight: hitTarget.minimum'));
  assert.ok(CHOICE.includes('minHeight: hitTarget.minimum'));
  assert.ok(STEPS.includes('minHeight: hitTarget.minimum'));
  // Radio semantics: a group named by its question, rows that announce checked.
  assert.ok(CHOICE.includes('accessibilityRole="radiogroup"'));
  assert.ok(CHOICE.includes('accessibilityLabel={label}'));
  assert.ok(CHOICE.includes('accessibilityRole="radio"'));
  assert.ok(CHOICE.includes('accessibilityState={{ checked, selected: checked }}'));
  // Selection has a non-colour channel: the indicator's dot.
  assert.ok(CHOICE.includes('{checked ? <View style={styles.dot} /> : null}'));
  // Buttons announce disabled and busy, and swap their word while busy.
  assert.ok(BUTTON.includes('accessibilityRole="button"'));
  assert.ok(BUTTON.includes('{busy && busyLabel !== undefined ? busyLabel : label}'));
  assert.ok(step('ReviewStep').includes('busyLabel={SUBMITTING_LABEL}'));
  assert.ok(step('PausedStep').includes('busyLabel={REMOVING_LABEL}'));
  // Failures are alerts; endings and the paused state are polite live regions.
  assert.ok(step('FailureMessage').includes('accessibilityRole="alert"'));
  assert.ok(step('OutcomeStep').includes('accessibilityLiveRegion="polite"'));
  assert.ok(step('PausedStep').includes('accessibilityLiveRegion="polite"'));
  // Reading order: progress, then the question as a header, then the answers,
  // then the actions — in source order inside the step.
  const question = step('QuestionStep');
  const order = [
    'questionProgressLabel(',
    'accessibilityRole="header"',
    '<ChoiceGroup',
    'label={NEXT_ACTION}',
  ].map((marker) => question.indexOf(marker));
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(
      order[index - 1] !== -1 && order[index - 1] < order[index],
      'the step reads out of order',
    );
  }
  // Every review row is one spoken element: the question, then the answer.
  assert.ok(step('ReviewStep').includes('accessibilityLabel={`${row.prompt} ${row.answer}`}'));
});

// ── 8. The development preview ──────────────────────────────────────────────

test('the preview offers every questionnaire scenario and a gallery of the real steps', () => {
  const ids = DESIGN_PREVIEW_SCENARIOS.map((scenario) => scenario.id);
  for (const required of [
    'questionnaire_new',
    'questionnaire_single_state',
    'questionnaire_multi_state',
    'questionnaire_state_search',
    'questionnaire_no_retailer',
    'questionnaire_edit',
    'questionnaire_submit_refused',
    'questionnaire_paused_own_report',
  ]) {
    assert.ok(ids.includes(required as (typeof ids)[number]), `scenario missing: ${required}`);
  }
  for (const scenario of DESIGN_PREVIEW_SCENARIOS) {
    if (scenario.group !== 'questionnaire') continue;
    assert.equal(scenario.destination, 'questionnaire', scenario.id);
    assert.notEqual(scenario.simulation, null, scenario.id);
  }
  // The gallery renders the real step components — imported, never copied —
  // over a real recall's own choices or the supported-jurisdiction registry.
  assert.ok(HUB.includes('QUESTIONNAIRE STEPS AND STATES'));
  assert.ok(HUB.includes("} from '@/components/report-questionnaire';"));
  for (const component of ['<QuestionStep', '<ReviewStep', '<OutcomeStep', '<PausedStep']) {
    assert.ok(HUB.includes(component), `the gallery lacks ${component}`);
  }
  assert.ok(HUB.includes('allowedStateCodes: SUPPORTED_STATE_CODES'));
  assert.ok(!HUB.includes('function ChoiceRow') && !HUB.includes('function QuestionStep'));
  // The gallery never reads or writes shopper-report state and submits nothing.
  const code = codeOnly(HUB);
  for (const forbidden of [
    'submitReport',
    'withdrawReport',
    'loadReportSummary',
    'loadMyReport',
    'report-api',
    'shopper-report-store',
  ]) {
    assert.ok(!code.includes(forbidden), `the hub calls ${forbidden}`);
  }
  assert.ok(HUB.includes('if (!isDevelopmentBuild())'));
});
