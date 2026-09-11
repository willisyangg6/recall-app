/**
 * The consumer contract for community shopper reports (P1D, corrected
 * 2026-09-10).
 *
 * These tests are about what a shopper is TOLD and what they can express:
 * that a count is never shown unless the server disclosed one, that the
 * feature's whole visible surface disappears with the server gate (except
 * the one narrow exception for an existing owner's removal path), that a
 * single-state "No" is a complete answer which stores nothing, and that the
 * questionnaire cannot produce a draft the server would have to refuse.
 * How the screens lay it out is pinned in the wiring suite; what the server
 * does with a draft is pinned in src/server/shopper-reports/.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SHOPPER_REPORT_VISIBILITY_THRESHOLD, type MyShopperReport } from '@/domain/shopper-report';
import {
  answerLabel,
  answersFromReport,
  communityReportsView,
  EMPTY_ANSWERS,
  isAnswered,
  isSingleStateCase,
  PRIVACY_DOCUMENT_SLUG,
  PRIVACY_LINK_LABEL,
  purchaseWindowLabel,
  purchaseWindowOptions,
  questionnaireOutcome,
  questionnaireSteps,
  questionPrompt,
  REPORT_ADD_ACTION,
  REPORT_EDIT_ACTION,
  REPORT_ENTRY_QUESTION,
  RETAILER_NOT_SURE,
  retailerOptions,
  STATE_CONFIRM_OPTIONS,
  STATE_QUESTION_PROMPT,
  stateConfirmPrompt,
  stateOptions,
  SUBMISSION_DISCLOSURE,
  SUBMIT_FAILURE,
  SUCCESS_BODY,
  SUCCESS_TITLE,
  type QuestionnaireAnswers,
  type QuestionnaireChoices,
} from './shopper-report-presentation';

const MULTI: QuestionnaireChoices = {
  allowedStateCodes: ['CA', 'NV'],
  retailerChoices: ['Costco Wholesale', 'Sprouts Farmers Market'],
};
const SINGLE: QuestionnaireChoices = { allowedStateCodes: ['CA'], retailerChoices: [] };
const SINGLE_WITH_RETAILERS: QuestionnaireChoices = {
  allowedStateCodes: ['CA'],
  retailerChoices: ['Costco Wholesale'],
};

const MINE: MyShopperReport = {
  stateCode: 'CA',
  retailerName: 'Costco Wholesale',
  purchaseWindow: 'past_week',
  version: 1,
  createdAt: '2026-09-11T00:00:00.000Z',
  updatedAt: '2026-09-11T00:00:00.000Z',
};

// ── The Detail community block ──────────────────────────────────────────────

test('an unavailable summary with no report renders nothing — the server gate is the whole switch', () => {
  assert.equal(communityReportsView({ status: 'unavailable' }, null), null);
});

test('an unavailable summary with an existing report preserves ONLY the edit entry point', () => {
  // Reading and withdrawing your own report are never gated (docs
  // §5) — this is the one place an owner still gets an entry point while
  // the feature is off, and it must carry no public copy of a disabled
  // feature: no count, no invitation.
  const view = communityReportsView({ status: 'unavailable' }, MINE);
  assert.ok(view);
  assert.equal(view.countLine, null);
  assert.equal(view.prompt, null);
  assert.equal(view.actionLabel, REPORT_EDIT_ACTION);
});

test('below the threshold the block invites, and discloses no number of any kind', () => {
  const view = communityReportsView({ status: 'below_threshold' }, null);
  assert.ok(view);
  assert.equal(view.countLine, null, 'a count leaked below the threshold');
  assert.equal(view.prompt, REPORT_ENTRY_QUESTION);
  assert.equal(view.actionLabel, REPORT_ADD_ACTION);
  // Nothing in the rendered strings implies how many people reported —
  // "0", "no one", "be the first", and "1" would each leak a sub-threshold
  // fact the server deliberately withheld.
  const rendered = [view.countLine, view.prompt].filter(Boolean).join(' ');
  assert.doesNotMatch(rendered, /\b0\b|\bno one\b|\bfirst\b|\bnobody\b|\bnone\b|\b1 shopper\b/i);
});

test('at or above the threshold the real count renders, never padded or rounded', () => {
  for (const count of [SHOPPER_REPORT_VISIBILITY_THRESHOLD, 4, 12, 137]) {
    const view = communityReportsView({ status: 'reported', count }, null);
    assert.ok(view);
    assert.equal(view.countLine, `${count} shoppers reported finding it here`);
  }
});

test('the two documented Detail strings render exactly as the contract states them', () => {
  // docs/recall-shopper-reports.md §1: the invitation and the disclosed
  // total, each followed by the same action control.
  const below = communityReportsView({ status: 'below_threshold' }, null);
  assert.equal(
    `${below?.prompt} ${below?.actionLabel}`,
    'Did you find this product here? Add your report',
  );
  const at = communityReportsView({ status: 'reported', count: 12 }, null);
  assert.equal(
    `${at?.countLine} · ${at?.actionLabel}`,
    '12 shoppers reported finding it here · Add your report',
  );
  // …and each string is the whole lead: a disclosed count REPLACES the
  // question rather than appearing above it. (Caught in simulator QA, where
  // the block rendered both lines at once — per-field assertions had each
  // passed while the rendered block still broke the contract.)
  assert.equal(at?.prompt, null, 'the question renders beneath a disclosed count');
  assert.equal(below?.countLine, null);
  for (const summary of [
    { status: 'below_threshold' } as const,
    { status: 'reported', count: 3 } as const,
    { status: 'reported', count: 40 } as const,
  ]) {
    for (const report of [null, MINE]) {
      const view = communityReportsView(summary, report);
      assert.ok(view);
      const lead = [view.countLine, view.prompt].filter(Boolean);
      assert.ok(
        lead.length >= 1 || report !== null,
        'the block rendered with no lead line for an installation with no report',
      );
      assert.ok(
        !(view.countLine !== null && view.prompt !== null),
        'count and question rendered together',
      );
    }
  }
});

test('nothing describes community reports as verified, confirmed, or official', () => {
  const strings = [
    REPORT_ENTRY_QUESTION,
    REPORT_ADD_ACTION,
    REPORT_EDIT_ACTION,
    SUCCESS_TITLE,
    SUCCESS_BODY,
    communityReportsView({ status: 'reported', count: 9 }, null)?.countLine ?? '',
  ].join('\n');
  assert.doesNotMatch(strings, /\bverified\b|\bconfirmed\b|\bofficial\b|\bproven\b|\bvalidated\b/i);
  // Nor as a safety instruction, a recall fact, or medical advice.
  assert.doesNotMatch(strings, /\brecalled in\b|\bdo not eat\b|\bsymptom|\billness|\bsick\b/i);
  // The disclosure DOES say "official" — but only to state the boundary
  // (a report never changes official recall information), never to claim
  // the report itself is official.
  assert.match(SUBMISSION_DISCLOSURE, /does not change official recall information/i);
  assert.doesNotMatch(
    SUBMISSION_DISCLOSURE,
    /\bverified\b|\bconfirmed\b|\bproven\b|\bvalidated\b/i,
  );
});

test('an owner with a report sees the action change to Edit, and never a personal-detail sentence', () => {
  for (const summary of [
    { status: 'below_threshold' } as const,
    { status: 'reported', count: 5 } as const,
  ]) {
    const view = communityReportsView(summary, MINE);
    assert.ok(view);
    assert.equal(view.prompt, null, 'an owner is asked to report again');
    assert.equal(view.actionLabel, REPORT_EDIT_ACTION);
    // Detail carries no personal-report sentence, and no removal control:
    // the view model exposes exactly countLine, prompt, and actionLabel.
    assert.deepEqual(Object.keys(view).sort(), ['actionLabel', 'countLine', 'prompt']);
  }
});

// ── The questionnaire ────────────────────────────────────────────────────────

test('there is no generic found-it step — state is always first', () => {
  assert.deepEqual(questionnaireSteps(MULTI), ['state', 'retailer', 'window']);
  assert.deepEqual(questionnaireSteps(SINGLE), ['state', 'window']);
  assert.deepEqual(questionnaireSteps(SINGLE_WITH_RETAILERS), ['state', 'retailer', 'window']);
});

test('the retailer question exists only when the notice itself names stores', () => {
  assert.deepEqual(questionnaireSteps(MULTI), ['state', 'retailer', 'window']);
  assert.deepEqual(questionnaireSteps({ allowedStateCodes: ['CA'], retailerChoices: [] }), [
    'state',
    'window',
  ]);
});

test('a single-state recall asks a yes/no confirm, with no "not sure" for state', () => {
  assert.equal(isSingleStateCase(SINGLE), true);
  assert.equal(isSingleStateCase(MULTI), false);
  assert.equal(questionPrompt('state', SINGLE), 'Did you find this product in California?');
  assert.equal(stateConfirmPrompt('CA'), 'Did you find this product in California?');
  assert.deepEqual(
    STATE_CONFIRM_OPTIONS.map((option) => option.value),
    ['yes', 'no'],
  );
  for (const option of STATE_CONFIRM_OPTIONS) {
    assert.doesNotMatch(option.label, /not sure/i);
  }
});

test('a multi-state or nationwide recall asks the direct state-picker question', () => {
  assert.equal(questionPrompt('state', MULTI), STATE_QUESTION_PROMPT);
  assert.equal(STATE_QUESTION_PROMPT, 'What state did you find it in?');
});

test('a single-state "No" declines cleanly, before any other question is asked', () => {
  const outcome = questionnaireOutcome({ ...EMPTY_ANSWERS, declined: true }, SINGLE);
  assert.deepEqual(outcome, { kind: 'declined' });
  // Declining never yields a draft, so nothing can be sent for it.
  assert.notEqual(outcome.kind, 'ready');
});

test('a multi-state or nationwide recall has no decline path at all', () => {
  // There is no answer shape that sets `declined` for these cases — picking
  // a state is itself the complete answer, exactly like tapping the add
  // action already communicated intent.
  const picked: QuestionnaireAnswers = { ...EMPTY_ANSWERS, stateCode: 'CA' };
  assert.notEqual(questionnaireOutcome(picked, MULTI).kind, 'declined');
});

test('the flow reports the next unanswered question and never skips ahead', () => {
  let answers: QuestionnaireAnswers = { ...EMPTY_ANSWERS };
  assert.deepEqual(questionnaireOutcome(answers, MULTI), { kind: 'incomplete', next: 'state' });
  answers = { ...answers, stateCode: 'CA' };
  assert.deepEqual(questionnaireOutcome(answers, MULTI), {
    kind: 'incomplete',
    next: 'retailer',
  });
  answers = { ...answers, retailer: 'Costco Wholesale' };
  assert.deepEqual(questionnaireOutcome(answers, MULTI), { kind: 'incomplete', next: 'window' });
});

test('a complete flow produces exactly the draft the server contract accepts', () => {
  const outcome = questionnaireOutcome(
    {
      declined: false,
      stateCode: 'CA',
      retailer: 'Costco Wholesale',
      purchaseWindow: 'past_month',
    },
    MULTI,
  );
  assert.equal(outcome.kind, 'ready');
  assert.deepEqual(outcome.kind === 'ready' ? outcome.draft : null, {
    stateCode: 'CA',
    retailerName: 'Costco Wholesale',
    purchaseWindow: 'past_month',
  });
});

test('a single-state "Yes" produces the same shape of ready draft as a multi-state pick', () => {
  const outcome = questionnaireOutcome(
    { declined: false, stateCode: 'CA', retailer: null, purchaseWindow: 'past_week' },
    SINGLE,
  );
  assert.equal(outcome.kind, 'ready');
  assert.deepEqual(outcome.kind === 'ready' ? outcome.draft : null, {
    stateCode: 'CA',
    retailerName: null,
    purchaseWindow: 'past_week',
  });
});

test('“I’m not sure” about the store is the ABSENCE of a store, never a stored string', () => {
  const outcome = questionnaireOutcome(
    { declined: false, stateCode: 'NV', retailer: RETAILER_NOT_SURE, purchaseWindow: 'longer_ago' },
    MULTI,
  );
  assert.equal(outcome.kind === 'ready' && outcome.draft.retailerName, null);
  // And a recall with no store question submits a null retailer too.
  const noStores = questionnaireOutcome(
    { declined: false, stateCode: 'CA', retailer: null, purchaseWindow: 'past_week' },
    SINGLE,
  );
  assert.equal(noStores.kind === 'ready' && noStores.draft.retailerName, null);
});

test('the questionnaire can only offer choices the server would accept', () => {
  // States: exactly the case's own official jurisdictions, named in full.
  assert.deepEqual(stateOptions(MULTI.allowedStateCodes), [
    { value: 'CA', label: 'California' },
    { value: 'NV', label: 'Nevada' },
  ]);
  // An unnameable code is dropped rather than shown as a bare code.
  assert.deepEqual(stateOptions(['CA', 'ZZ']), [{ value: 'CA', label: 'California' }]);
  // Retailers: the notice's own names plus the not-sure escape, nothing else.
  assert.deepEqual(
    retailerOptions(MULTI.retailerChoices).map((option) => option.value),
    ['Costco Wholesale', 'Sprouts Farmers Market', RETAILER_NOT_SURE],
  );
  // Purchase windows: the closed server vocabulary, each with one label.
  const windows = purchaseWindowOptions();
  assert.deepEqual(
    windows.map((option) => option.value),
    ['past_week', 'past_month', 'past_three_months', 'longer_ago', 'not_sure'],
  );
  for (const option of windows)
    assert.equal(option.label, purchaseWindowLabel(option.value as never));
  assert.equal(new Set(windows.map((option) => option.label)).size, windows.length);
});

test('editing starts from the report the server holds, not from an empty form', () => {
  const answers = answersFromReport(MINE);
  assert.deepEqual(answers, {
    declined: false,
    stateCode: 'CA',
    retailer: 'Costco Wholesale',
    purchaseWindow: 'past_week',
  });
  // Round-trip: pre-filling an unchanged edit reproduces the same draft, so
  // re-submitting without changing anything is the server's no-op retry.
  const outcome = questionnaireOutcome(answers, MULTI);
  assert.deepEqual(outcome.kind === 'ready' ? outcome.draft : null, {
    stateCode: 'CA',
    retailerName: 'Costco Wholesale',
    purchaseWindow: 'past_week',
  });
  // A stored report with no store pre-fills as "I'm not sure".
  assert.equal(answersFromReport({ ...MINE, retailerName: null }).retailer, RETAILER_NOT_SURE);
});

test('every question has words, and answered-ness is explicit', () => {
  for (const key of questionnaireSteps(MULTI)) {
    assert.ok(questionPrompt(key, MULTI).endsWith('?'), `${key} is not phrased as a question`);
    assert.equal(isAnswered(key, EMPTY_ANSWERS), false, `${key} counts as answered when empty`);
  }
  const full: QuestionnaireAnswers = {
    declined: false,
    stateCode: 'CA',
    retailer: RETAILER_NOT_SURE,
    purchaseWindow: 'not_sure',
  };
  assert.deepEqual(
    questionnaireSteps(MULTI).map((key) => answerLabel(key, full)),
    ['California', 'I’m not sure', 'I’m not sure'],
  );
  // A single-state decline counts as answered (it is a complete outcome),
  // even though no state was ever picked.
  assert.equal(isAnswered('state', { ...EMPTY_ANSWERS, declined: true }), true);
});

// ── The point-of-submission disclosure ──────────────────────────────────────

test('the one-line disclosure states the effect and non-effect, and points to Learn more', () => {
  assert.match(SUBMISSION_DISCLOSURE, /anonymous/i);
  assert.match(SUBMISSION_DISCLOSURE, /community totals/i);
  assert.match(SUBMISSION_DISCLOSURE, /does not change official recall information/i);
  assert.equal(PRIVACY_LINK_LABEL, 'Learn more.');
  // Short enough that it is actually read at the moment of submitting.
  assert.ok(SUBMISSION_DISCLOSURE.length <= 200, 'the disclosure grew past one line');
});

test('the disclosure links to the app’s real privacy document, not an unpublished policy', () => {
  // The formal Privacy Policy is still blocked on founder/legal inputs
  // (docs/recall-launch-blockers.md) and must not be exposed; the in-app
  // Privacy & Data Controls document is the complete, placeholder-free
  // explanation, and it is what this link opens.
  assert.equal(PRIVACY_DOCUMENT_SLUG, 'privacy-data-controls');
});

test('a failed submission promises nothing it cannot keep, and leaks no reason', () => {
  // Offline, case closed mid-flow, or feature switched off — the server
  // refuses before writing in every case, so "nothing was saved" is always
  // true, and the shopper is never told which refusal happened.
  assert.match(SUBMIT_FAILURE, /[Nn]othing was saved/);
  assert.doesNotMatch(SUBMIT_FAILURE, /closed|retracted|disabled|not available|ineligible|server/i);
});

// ── Success ──────────────────────────────────────────────────────────────────

test('the exact success copy carries no metric, count, or threshold', () => {
  assert.equal(SUCCESS_TITLE, 'Thanks for contributing!');
  assert.equal(SUCCESS_BODY, 'Your report helps other shoppers make safer decisions.');
  const combined = `${SUCCESS_TITLE} ${SUCCESS_BODY}`;
  assert.equal(
    combined,
    'Thanks for contributing! Your report helps other shoppers make safer decisions.',
  );
  assert.doesNotMatch(combined, /\d/, 'the success copy names a number');
  assert.doesNotMatch(combined, new RegExp(String(SHOPPER_REPORT_VISIBILITY_THRESHOLD)));
});
