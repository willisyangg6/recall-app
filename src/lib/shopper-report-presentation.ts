/**
 * The consumer contract for community shopper reports (P1D): every word the
 * feature renders, and the pure view models behind them.
 *
 * Screens render these models and compose no wording of their own — the same
 * rule the recall presentation contract follows (lib/recall-presentation.ts).
 * This module is deliberately free of React Native and SecureStore imports so
 * the whole consumer contract is provable in Node; the screens and the
 * network/queue wiring (lib/shopper-report-store.ts) stay thin.
 *
 * ## What the shopper is being asked
 *
 * One question, asked once per recall: did you find THIS product where you
 * shop, and if so — which state, which store (optionally), and roughly when.
 * It is corroboration of the official notice's distribution, never evidence
 * about the shopper: there is no field here for symptoms, illness, purchase
 * proof, free text, or location beyond the state, because the server schema
 * cannot store any of them (docs/recall-shopper-reports.md §2).
 *
 * ## The honesty rules the copy is bound by
 *
 * - A count is rendered ONLY when the server discloses one, which it does
 *   only at SHOPPER_REPORT_VISIBILITY_THRESHOLD or more. Below that the
 *   server returns one indistinguishable state and this module renders an
 *   invitation instead — never "0 reports", never "be the first", never a
 *   hint that anyone has or has not reported.
 * - Nothing here describes the count as verified, confirmed, or official. A
 *   shopper report is what other shoppers said, and the copy says exactly
 *   that much.
 * - `unavailable` renders NOTHING at all. That single response covers a
 *   disabled feature and every ineligible case, so the server gate contains
 *   the entire visible feature and the app holds no second switch that could
 *   drift out of sync with it.
 */

import { stateNameForCode } from '@/domain/preferences';
import {
  PURCHASE_WINDOWS,
  type MyShopperReport,
  type PurchaseWindow,
  type ShopperReportDraft,
  type ShopperReportSummary,
} from '@/domain/shopper-report';

// ── Shared labels ───────────────────────────────────────────────────────────

/** The invitation shown when this installation has not reported. */
export const REPORT_ENTRY_QUESTION = 'Did you find this product here?';
export const REPORT_ADD_ACTION = 'Add your report';
export const REPORT_EDIT_ACTION = 'Edit your report';
export const REPORT_REMOVE_ACTION = 'Remove my report';
export const REPORT_SCREEN_TITLE = 'Share a shopper report';

/**
 * The consumer label for each purchase-time bucket. The tokens are the
 * closed server vocabulary; these are the only words shown for them.
 */
const PURCHASE_WINDOW_LABELS: Record<PurchaseWindow, string> = {
  past_week: 'In the past week',
  past_month: 'In the past month',
  past_three_months: 'In the past three months',
  longer_ago: 'Longer ago',
  not_sure: 'I’m not sure',
};

export function purchaseWindowLabel(window: PurchaseWindow): string {
  return PURCHASE_WINDOW_LABELS[window];
}

export interface ChoiceOption {
  /** The value submitted, or a UI-only sentinel for "Not sure". */
  value: string;
  label: string;
}

export function purchaseWindowOptions(): { value: PurchaseWindow; label: string }[] {
  return PURCHASE_WINDOWS.map((window) => ({
    value: window,
    label: PURCHASE_WINDOW_LABELS[window],
  }));
}

/**
 * The jurisdictions a report may name, as the questionnaire lists them:
 * full state names, alphabetical. A code the registry cannot name is
 * dropped rather than shown as a bare code — the server would refuse it
 * anyway, and an unlabeled option is not a choice a person can make.
 */
export function stateOptions(allowedStateCodes: readonly string[]): ChoiceOption[] {
  return allowedStateCodes
    .map((code) => ({ value: code, label: stateNameForCode(code) ?? '' }))
    .filter((option) => option.label !== '')
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The "Not sure" retailer answer — a UI sentinel, never a stored value. */
export const RETAILER_NOT_SURE = 'not_sure';

export function retailerOptions(retailerChoices: readonly string[]): ChoiceOption[] {
  return [
    ...retailerChoices.map((name) => ({ value: name, label: name })),
    { value: RETAILER_NOT_SURE, label: 'I’m not sure' },
  ];
}

// ── The Detail community block ──────────────────────────────────────────────

/**
 * What renders beneath "Where it was sold", or `null` for "render nothing".
 *
 * Null is the whole gate: an ineligible case and a disabled feature with no
 * existing report both produce it, so no heading, control, or spacing
 * appears in either state.
 *
 * Deliberately minimal (founder correction, 2026-09-10): Detail is a
 * corroboration signal, not a second place to read or confirm what a
 * shopper personally submitted. It never carries this installation's own
 * state, retailer, or purchase timeframe, and it never offers Remove — both
 * live only on the questionnaire's edit screen, one tap away behind
 * `actionLabel`.
 */
export interface CommunityReportsView {
  /**
   * The disclosed community total, or null when the server disclosed none.
   * Present only at or above the visibility threshold, and always the real
   * number the server returned. Never rendered below the threshold, and
   * never alongside `prompt`.
   */
  countLine: string | null;
  /** The invitation — present only below threshold, with no report, and no count. */
  prompt: string | null;
  /** Add your report, or Edit your report once one exists. */
  actionLabel: string;
}

/**
 * The community block for one recall.
 *
 * `summary` is the server's answer and the only source of a count; `report`
 * is this installation's own current report, which only this installation
 * can read.
 *
 * Reading and withdrawing one's own report are never gated by the kill
 * switch (docs/recall-shopper-reports.md §5) — only new collection and the
 * public summary are — so an owner can end up here with `summary.status ===
 * 'unavailable'` and a real `report` at the same time (the feature was
 * switched off after they reported). That combination still renders exactly
 * `actionLabel: REPORT_EDIT_ACTION` and nothing else: no count, no
 * invitation, no public copy of a disabled feature — just enough of the
 * entry point for the owner to reach the removal control one tap away. An
 * ineligible case or a disabled feature with NO existing report renders
 * nothing at all.
 */
export function communityReportsView(
  summary: ShopperReportSummary,
  report: MyShopperReport | null,
): CommunityReportsView | null {
  if (summary.status === 'unavailable') {
    if (report === null) return null;
    return { countLine: null, prompt: null, actionLabel: REPORT_EDIT_ACTION };
  }
  const countLine =
    summary.status === 'reported' ? `${summary.count} shoppers reported finding it here` : null;
  return {
    countLine,
    // The invitation is the LEAD when there is nothing else to lead with.
    // Once a count is disclosed it replaces the question (the frozen
    // contract is "12 shoppers reported finding it here · Add your report",
    // not the count followed by the question again), and a shopper who has
    // already reported is never asked whether they found it.
    prompt: report === null && countLine === null ? REPORT_ENTRY_QUESTION : null,
    actionLabel: report === null ? REPORT_ADD_ACTION : REPORT_EDIT_ACTION,
  };
}

// ── The questionnaire ───────────────────────────────────────────────────────

/**
 * The questions, in order. `retailer` is asked only when the notice itself
 * names safe canonical retailers — there is no free-text fallback, so with
 * no official choices there is no question to ask.
 *
 * There is deliberately no separate "did you find this product?" step
 * (retired, founder correction 2026-09-10): tapping `REPORT_ADD_ACTION`
 * already states that intent, so asking it again was a redundant question.
 * `state` is always first — for a single-state recall it doubles as the
 * find/decline confirmation (`declined` below), because there is nothing
 * else left to ask before the one location that could be true or false.
 */
export type QuestionKey = 'state' | 'retailer' | 'window';

export interface QuestionnaireAnswers {
  /**
   * True once a shopper answers "No" to the single-state confirm — the
   * ONLY way this flow ends without a report. A multi-state or nationwide
   * recall has no path that sets this; picking a state there is itself the
   * whole answer, exactly like tapping the add action already was.
   */
  declined: boolean;
  stateCode: string | null;
  /** A canonical retailer name, RETAILER_NOT_SURE, or null (unanswered). */
  retailer: string | null;
  purchaseWindow: PurchaseWindow | null;
}

export const EMPTY_ANSWERS: QuestionnaireAnswers = {
  declined: false,
  stateCode: null,
  retailer: null,
  purchaseWindow: null,
};

export interface QuestionnaireChoices {
  allowedStateCodes: readonly string[];
  retailerChoices: readonly string[];
}

/** The questions this recall actually asks. */
export function questionnaireSteps(choices: QuestionnaireChoices): QuestionKey[] {
  const steps: QuestionKey[] = ['state'];
  if (choices.retailerChoices.length > 0) steps.push('retailer');
  steps.push('window');
  return steps;
}

/** A one-state recall's location IS a yes/no question — there is nothing to pick. */
export function isSingleStateCase(choices: QuestionnaireChoices): boolean {
  return choices.allowedStateCodes.length === 1;
}

export const STATE_QUESTION_PROMPT = 'What state did you find it in?';

/** "Did you find this product in <State>?" — the single-state confirm. */
export function stateConfirmPrompt(stateCode: string): string {
  return `Did you find this product in ${stateNameForCode(stateCode) ?? stateCode}?`;
}

/** Optional context for the confirm question: why only one state is offered. */
export const STATE_CONFIRM_HELP =
  'Reports can only include locations listed in the official recall.';

export const QUESTION_PROMPTS: Record<Exclude<QuestionKey, 'state'>, string> = {
  retailer: 'Which store did you find it at?',
  window: 'When did you buy it?',
};

/** The prompt for any question key — the one place step headers and the
 * review step both read from, so they can never diverge. */
export function questionPrompt(key: QuestionKey, choices: QuestionnaireChoices): string {
  if (key === 'state') {
    return isSingleStateCase(choices)
      ? stateConfirmPrompt(choices.allowedStateCodes[0])
      : STATE_QUESTION_PROMPT;
  }
  return QUESTION_PROMPTS[key];
}

/** The single-state confirm's two answers. No "I'm not sure": there is only
 * one official location, and either the shopper found it there or they did
 * not — a third option would just be a slower "No". */
export const STATE_CONFIRM_OPTIONS: { value: 'yes' | 'no'; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

/** Whether a question has been answered well enough to move on. */
export function isAnswered(key: QuestionKey, answers: QuestionnaireAnswers): boolean {
  if (key === 'state') return answers.declined || answers.stateCode !== null;
  if (key === 'retailer') return answers.retailer !== null;
  return answers.purchaseWindow !== null;
}

/**
 * Where the flow stands.
 *
 * `declined` is a complete, respectable ending, not a failure: a shopper on
 * a single-state recall who did not find the product there has given a
 * truthful answer, and the app stores nothing and counts nothing for it. It
 * is the one place the questionnaire deliberately ends without a report.
 */
export type QuestionnaireOutcome =
  | { kind: 'incomplete'; next: QuestionKey }
  | { kind: 'declined' }
  | { kind: 'ready'; draft: ShopperReportDraft };

/**
 * The flow's verdict for the current answers, recomputed from scratch — the
 * screen holds answers, never a derived position it could get out of step
 * with. A single-state "No" short-circuits before any other question is
 * even asked, so an uncertain shopper is never walked through a form whose
 * result could not be stored.
 */
export function questionnaireOutcome(
  answers: QuestionnaireAnswers,
  choices: QuestionnaireChoices,
): QuestionnaireOutcome {
  if (answers.declined) return { kind: 'declined' };
  for (const key of questionnaireSteps(choices)) {
    if (!isAnswered(key, answers)) return { kind: 'incomplete', next: key };
  }
  const draft: ShopperReportDraft = {
    stateCode: answers.stateCode as string,
    // "Not sure" is the ABSENCE of a retailer, never a stored string.
    retailerName:
      answers.retailer === null || answers.retailer === RETAILER_NOT_SURE ? null : answers.retailer,
    purchaseWindow: answers.purchaseWindow as PurchaseWindow,
  };
  return { kind: 'ready', draft };
}

/** Pre-fill an edit from the report the server holds. */
export function answersFromReport(report: MyShopperReport): QuestionnaireAnswers {
  return {
    declined: false,
    stateCode: report.stateCode,
    retailer: report.retailerName ?? RETAILER_NOT_SURE,
    purchaseWindow: report.purchaseWindow,
  };
}

/** The chosen answer in the shopper's own words, for the review step. */
export function answerLabel(key: QuestionKey, answers: QuestionnaireAnswers): string | null {
  if (key === 'state') {
    return answers.stateCode === null ? null : (stateNameForCode(answers.stateCode) ?? null);
  }
  if (key === 'retailer') {
    if (answers.retailer === null) return null;
    return answers.retailer === RETAILER_NOT_SURE ? 'I’m not sure' : answers.retailer;
  }
  return answers.purchaseWindow === null ? null : purchaseWindowLabel(answers.purchaseWindow);
}

// ── Point-of-submission disclosure, and the outcomes ────────────────────────

/**
 * The one-line disclosure shown at the moment of submitting, directly above
 * Submit/Update — not buried in a policy a shopper would have to go looking
 * for. `PRIVACY_LINK_LABEL` is the tappable tail of the same sentence
 * ("… official recall information. Learn more."), opening the in-app
 * Privacy & Data Controls document — the app's complete, placeholder-free
 * privacy explanation, which carries the full detail (what is stored, what
 * never is, the visibility threshold, retention). The formal Privacy Policy
 * remains unpublished (unresolved founder/legal inputs —
 * docs/recall-launch-blockers.md), and nothing here may imply otherwise.
 */
export const SUBMISSION_DISCLOSURE =
  'Your anonymous report contributes to community totals and does not change official recall information.';
export const PRIVACY_LINK_LABEL = 'Learn more.';

export const PRIVACY_DOCUMENT_SLUG = 'privacy-data-controls';

export const SUBMIT_ACTION = 'Submit report';
/** The edit screen's submit control reads differently from a first submission. */
export const UPDATE_ACTION = 'Update report';
export const SUBMITTING_LABEL = 'Sending…';

/**
 * Submitted successfully — the exact copy (founder decision, 2026-09-10),
 * with no threshold, count, or other metric restated: the disclosure
 * already said what happens next, and this screen does not repeat it.
 */
export const SUCCESS_TITLE = 'Thanks for contributing!';
export const SUCCESS_BODY = 'Your report helps other shoppers make safer decisions.';

/** The graceful ending for a single-state "No" — nothing stored, nothing counted. */
export const DECLINED_TITLE = 'Thanks — nothing was submitted.';
export const DECLINED_BODY =
  'Only shoppers who found the recalled product add a report, so nothing was saved and nothing ' +
  'was counted. You can come back if you find it later.';

/** Withdrawal succeeded. */
export const REMOVED_TITLE = 'Your report was removed.';
export const REMOVED_BODY = 'It no longer counts toward the total for this recall.';

/**
 * The removal confirmation (founder decision, 2026-09-10) — a native
 * confirm dialog, mirroring the "Reset app and delete my data" pattern
 * (lib/installation-reset.ts): Cancel performs no mutation, and only the
 * destructive action calls the server. It exists only on the edit screen.
 */
export const REMOVE_CONFIRM_TITLE = 'Remove your report?';
export const REMOVE_CONFIRM_BODY = 'This will remove it from community totals.';
export const REMOVE_CONFIRM_CANCEL = 'Cancel';
export const REMOVE_CONFIRM_REMOVE = 'Remove';

/**
 * Shown when the feature is switched off but this installation still has a
 * live report (reading and withdrawing are never gated — §5). Editing is
 * not offered here because a re-submission would be refused server-side
 * regardless of what the form says; only removal, which always works.
 */
export const REPORT_PAUSED_MESSAGE =
  'Shopper reports are temporarily unavailable, so this report can’t be edited right now — but you can still remove it.';

/**
 * Every failure a shopper can hit here — network loss, a case that closed
 * while the form was open, the feature being switched off mid-flow — ends
 * the same way and says the same true thing: nothing was saved. The server
 * refuses before writing in every one of those cases, so this never
 * over-promises, and it never leaks WHICH refusal happened.
 */
export const SUBMIT_FAILURE =
  'Your report could not be sent. Nothing was saved — please try again.';
export const REMOVE_FAILURE =
  'Your report could not be removed. Nothing was changed — please try again.';

export const DONE_ACTION = 'Done';
export const BACK_ACTION = 'Back';
export const NEXT_ACTION = 'Next';
