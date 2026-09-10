/**
 * Community shopper reports (P1C) — the typed contracts and pure eligibility
 * logic behind the future P1D questionnaire. No screen, route, or copy lives
 * here; this is the nonvisual foundation only.
 *
 * ## What a report is
 *
 * Structured shopper corroboration for one ACTIVE recall: "I found this
 * product in <state> [at <retailer>], bought <time bucket>". It is not
 * official recall evidence, never feeds Affects Me, personalization,
 * notifications, feed order, or any official field, and it is aggregated
 * publicly only as a thresholded total (SHOPPER_REPORT_VISIBILITY_THRESHOLD).
 *
 * ## Data minimization, by type
 *
 * A draft can express ONLY: a jurisdiction code, an optional exact canonical
 * retailer name, and one purchase-time bucket from the closed vocabulary
 * below. There is deliberately no field for symptoms, illness, consumption,
 * medical information, contact details, exact location, receipts, photos,
 * lot codes, or free text — the server schema cannot store them either.
 *
 * ## Who validates
 *
 * The DATABASE is authoritative: every RPC re-validates the case's
 * lifecycle, geography, and retailer evidence server-side from the current
 * canonical projection. The helpers here exist for usability — building the
 * questionnaire's choices and catching mistakes before a round trip — and
 * they read the SAME projection fields the server reads (lifecycle state,
 * geography scope/states, retailerNames), so agreement is structural, not
 * duplicated policy. When they disagree (a stale client cache), the server
 * answer wins and the client refreshes.
 */

import type { Geography, LifecycleState } from './recall-types';
import { SUPPORTED_STATE_CODES } from './preferences';
import { STATE_TO_POSTAL } from './us-geography';

/**
 * The closed purchase-time vocabulary — the single owner of these tokens.
 * The SQL CHECK constraint and RPC validation mirror this list exactly
 * (parity pinned in src/server/shopper-reports/shopper-reports-migration.test.ts).
 */
export const PURCHASE_WINDOWS = [
  'past_week',
  'past_month',
  'past_three_months',
  'longer_ago',
  'not_sure',
] as const;

export type PurchaseWindow = (typeof PURCHASE_WINDOWS)[number];

export function isPurchaseWindow(value: unknown): value is PurchaseWindow {
  return typeof value === 'string' && (PURCHASE_WINDOWS as readonly string[]).includes(value);
}

/**
 * Reports become publicly visible only at this many qualifying reports.
 * Below it the public summary is a single indistinguishable "below
 * threshold" state — never an exact sub-threshold count.
 */
export const SHOPPER_REPORT_VISIBILITY_THRESHOLD = 3;

/**
 * Retention (founder decision, 2026-09-10): a report expires exactly this
 * many calendar months (UTC) after its most recent MEANINGFUL accepted
 * submission or edit — a value-changing write restarts the clock, an
 * identical retry does not. The boundary is inclusive: a report whose
 * expiry instant has arrived (`expires_at <= now()`) is expired — it stops
 * counting, stops returning from the owner read, and no longer blocks a
 * fresh submission — and the scheduled cleanup physically deletes it within
 * about a day. The SQL mirrors this constant as `interval '12 months'`
 * (parity pinned in shopper-reports-migration.test.ts).
 */
export const SHOPPER_REPORT_RETENTION_MONTHS = 12;

/** What a shopper submits (or re-submits) for one case. */
export interface ShopperReportDraft {
  /** Two-letter jurisdiction code ('CA', 'DC', 'PR'). */
  stateCode: string;
  /**
   * Exact canonical retailer name from the case's own retailerNames, or
   * null for "Not sure" — and always null when the case names no retailer.
   */
  retailerName: string | null;
  purchaseWindow: PurchaseWindow;
}

/** The caller's own current report, as the server returns it. */
export interface MyShopperReport {
  stateCode: string;
  retailerName: string | null;
  purchaseWindow: PurchaseWindow;
  /** Bumped only when a re-submission actually changed a value. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The public thresholded summary. 'unavailable' covers a disabled feature
 * and every ineligible case; 'below_threshold' covers 0, 1, and 2 reports
 * indistinguishably; 'reported' carries the real exact total (>= threshold),
 * never an estimate.
 */
export type ShopperReportSummary =
  { status: 'unavailable' } | { status: 'below_threshold' } | { status: 'reported'; count: number };

/** The projection facts eligibility is a pure function of. */
export interface ReportEligibilityInput {
  state: LifecycleState;
  geography: Geography;
  /** projection.retailerNames; pass [] when the projection lacks the key. */
  retailerNames: readonly string[];
}

export type ReportEligibility =
  | { eligible: false; reason: 'case_not_active' | 'geography_unusable' }
  | {
      eligible: true;
      /**
       * Jurisdiction codes a report may name: the full supported registry
       * for a nationwide case, or exactly the official states otherwise.
       */
      allowedStateCodes: readonly string[];
      /** Exact canonical names the retailer question may offer; [] = no question. */
      retailerChoices: readonly string[];
    };

/**
 * Whether — and with which choices — this case can take a shopper report.
 * Mirrors the server rules; the server remains authoritative.
 */
export function evaluateReportEligibility(input: ReportEligibilityInput): ReportEligibility {
  if (input.state !== 'active') return { eligible: false, reason: 'case_not_active' };

  let allowedStateCodes: readonly string[];
  if (input.geography.scope === 'nationwide') {
    allowedStateCodes = SUPPORTED_STATE_CODES;
  } else if (input.geography.scope === 'states') {
    // Official geography stores full names; reports use postal codes. A name
    // outside the registry cannot be offered (nothing to submit for it).
    allowedStateCodes = input.geography.states
      .map((name) => STATE_TO_POSTAL[name])
      .filter((code): code is string => typeof code === 'string');
    if (allowedStateCodes.length === 0) {
      return { eligible: false, reason: 'geography_unusable' };
    }
  } else {
    return { eligible: false, reason: 'geography_unusable' };
  }

  return {
    eligible: true,
    allowedStateCodes,
    retailerChoices: input.retailerNames.filter((name) => name.trim() !== ''),
  };
}

export type DraftProblem = 'state_not_allowed' | 'retailer_not_offered' | 'purchase_window_invalid';

/**
 * Usability pre-check of a draft against an eligible case's choices. A
 * passing draft can still be refused by the server (the case may have
 * changed since the client loaded it) — the server is authoritative.
 */
export function validateReportDraft(
  draft: ShopperReportDraft,
  eligibility: Extract<ReportEligibility, { eligible: true }>,
): { ok: true } | { ok: false; problem: DraftProblem } {
  if (!eligibility.allowedStateCodes.includes(draft.stateCode)) {
    return { ok: false, problem: 'state_not_allowed' };
  }
  if (draft.retailerName !== null && !eligibility.retailerChoices.includes(draft.retailerName)) {
    return { ok: false, problem: 'retailer_not_offered' };
  }
  if (!isPurchaseWindow(draft.purchaseWindow)) {
    return { ok: false, problem: 'purchase_window_invalid' };
  }
  return { ok: true };
}

/**
 * Validate an untrusted server echo into a well-formed own-report object, or
 * null. Unknown shapes degrade to null (nothing to pre-fill), never to
 * garbage in a form.
 */
export function sanitizeMyShopperReport(raw: unknown): MyShopperReport | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.stateCode !== 'string' ||
    !/^[A-Z]{2}$/.test(value.stateCode) ||
    !isPurchaseWindow(value.purchaseWindow) ||
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }
  const retailerName =
    typeof value.retailerName === 'string' && value.retailerName !== '' ? value.retailerName : null;
  return {
    stateCode: value.stateCode,
    retailerName,
    purchaseWindow: value.purchaseWindow,
    version: value.version,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

/**
 * Validate an untrusted summary response. Anything malformed — including a
 * 'reported' status whose count is not a real integer at or above the
 * threshold — degrades to 'unavailable': the UI may under-show community
 * activity, but it can never fabricate or inflate it.
 */
export function sanitizeReportSummary(raw: unknown): ShopperReportSummary {
  if (typeof raw !== 'object' || raw === null) return { status: 'unavailable' };
  const value = raw as Record<string, unknown>;
  if (value.status === 'below_threshold') return { status: 'below_threshold' };
  if (
    value.status === 'reported' &&
    typeof value.count === 'number' &&
    Number.isInteger(value.count) &&
    value.count >= SHOPPER_REPORT_VISIBILITY_THRESHOLD
  ) {
    return { status: 'reported', count: value.count };
  }
  return { status: 'unavailable' };
}
