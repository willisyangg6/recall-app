/**
 * Shopper-report domain foundation (P1C): the closed purchase vocabulary,
 * pure eligibility over the same projection facts the server validates
 * against, draft pre-checks, and the untrusted-response sanitizers (which
 * must degrade — never fabricate). Server-side semantics are proven in
 * src/server/shopper-reports/; this file owns the client-safe pure layer.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SUPPORTED_STATE_CODES } from './preferences';
import {
  evaluateReportEligibility,
  isPurchaseWindow,
  PURCHASE_WINDOWS,
  sanitizeMyShopperReport,
  sanitizeReportSummary,
  SHOPPER_REPORT_VISIBILITY_THRESHOLD,
  validateReportDraft,
  type ReportEligibility,
} from './shopper-report';
import type { Geography } from './recall-types';

const states = (names: string[]): Geography => ({
  scope: 'states',
  states: names,
  confidence: 'stated',
  sourceText: names.join(', '),
});

const NATIONWIDE: Geography = {
  scope: 'nationwide',
  states: [],
  confidence: 'stated',
  sourceText: 'Nationwide',
};

const UNKNOWN: Geography = {
  scope: 'unknown',
  states: [],
  confidence: 'inferred',
  sourceText: null,
};

test('the purchase vocabulary is the closed five-bucket set', () => {
  assert.deepEqual(PURCHASE_WINDOWS, [
    'past_week',
    'past_month',
    'past_three_months',
    'longer_ago',
    'not_sure',
  ]);
  for (const window of PURCHASE_WINDOWS) assert.ok(isPurchaseWindow(window));
  for (const bad of ['yesterday', '', 'PAST_WEEK', null, undefined, 3]) {
    assert.equal(isPurchaseWindow(bad), false, JSON.stringify(bad ?? String(bad)));
  }
});

test('a multi-state active case offers exactly the official states, as postal codes', () => {
  const eligibility = evaluateReportEligibility({
    state: 'active',
    geography: states(['California', 'Nevada', 'District of Columbia']),
    retailerNames: ['Costco Wholesale'],
  });
  assert.ok(eligibility.eligible);
  assert.deepEqual(eligibility.allowedStateCodes, ['CA', 'NV', 'DC']);
  assert.deepEqual(eligibility.retailerChoices, ['Costco Wholesale']);
});

test('a nationwide case offers the full supported jurisdiction registry', () => {
  const eligibility = evaluateReportEligibility({
    state: 'active',
    geography: NATIONWIDE,
    retailerNames: [],
  });
  assert.ok(eligibility.eligible);
  assert.equal(eligibility.allowedStateCodes, SUPPORTED_STATE_CODES);
  assert.equal(eligibility.allowedStateCodes.length, 52);
  assert.deepEqual(eligibility.retailerChoices, []);
});

test('closed, retracted, and unknown-geography cases are ineligible', () => {
  assert.deepEqual(
    evaluateReportEligibility({ state: 'closed', geography: NATIONWIDE, retailerNames: [] }),
    { eligible: false, reason: 'case_not_active' },
  );
  assert.deepEqual(
    evaluateReportEligibility({ state: 'retracted', geography: NATIONWIDE, retailerNames: [] }),
    { eligible: false, reason: 'case_not_active' },
  );
  assert.deepEqual(
    evaluateReportEligibility({ state: 'active', geography: UNKNOWN, retailerNames: [] }),
    { eligible: false, reason: 'geography_unusable' },
  );
});

test('official states that cannot map to a supported code make geography unusable, not guessed', () => {
  // A malformed stored name (nothing in the current corpus produces one)
  // must fail closed rather than invent a jurisdiction to offer.
  assert.deepEqual(
    evaluateReportEligibility({
      state: 'active',
      geography: states(['Atlantis']),
      retailerNames: [],
    }),
    { eligible: false, reason: 'geography_unusable' },
  );
  // A partially mappable list offers only what maps.
  const partial = evaluateReportEligibility({
    state: 'active',
    geography: states(['Atlantis', 'Texas']),
    retailerNames: [],
  });
  assert.ok(partial.eligible);
  assert.deepEqual(partial.allowedStateCodes, ['TX']);
});

test('draft pre-check mirrors the server rules over the offered choices', () => {
  const eligibility = evaluateReportEligibility({
    state: 'active',
    geography: states(['California']),
    retailerNames: ['Costco Wholesale'],
  }) as Extract<ReportEligibility, { eligible: true }>;

  assert.deepEqual(
    validateReportDraft(
      { stateCode: 'CA', retailerName: 'Costco Wholesale', purchaseWindow: 'past_week' },
      eligibility,
    ),
    { ok: true },
  );
  // "Not sure" — no retailer — always passes the retailer rule.
  assert.deepEqual(
    validateReportDraft(
      { stateCode: 'CA', retailerName: null, purchaseWindow: 'not_sure' },
      eligibility,
    ),
    { ok: true },
  );
  assert.deepEqual(
    validateReportDraft(
      { stateCode: 'TX', retailerName: null, purchaseWindow: 'past_week' },
      eligibility,
    ),
    { ok: false, problem: 'state_not_allowed' },
  );
  assert.deepEqual(
    validateReportDraft(
      { stateCode: 'CA', retailerName: 'Walmart', purchaseWindow: 'past_week' },
      eligibility,
    ),
    { ok: false, problem: 'retailer_not_offered' },
  );
  assert.deepEqual(
    validateReportDraft(
      { stateCode: 'CA', retailerName: null, purchaseWindow: 'whenever' as never },
      eligibility,
    ),
    { ok: false, problem: 'purchase_window_invalid' },
  );
});

test('the own-report sanitizer accepts the server shape and degrades everything else to null', () => {
  const good = {
    stateCode: 'CA',
    retailerName: null,
    purchaseWindow: 'past_week',
    version: 2,
    createdAt: '2026-09-10T12:00:00.000Z',
    updatedAt: '2026-09-10T13:00:00.000Z',
  };
  assert.deepEqual(sanitizeMyShopperReport(good), good);
  assert.deepEqual(sanitizeMyShopperReport({ ...good, retailerName: 'Costco Wholesale' }), {
    ...good,
    retailerName: 'Costco Wholesale',
  });
  for (const bad of [
    null,
    undefined,
    'a string',
    {},
    { ...good, stateCode: 'California' },
    { ...good, purchaseWindow: 'whenever' },
    { ...good, version: 0 },
    { ...good, version: 1.5 },
    { ...good, createdAt: 42 },
  ]) {
    assert.equal(sanitizeMyShopperReport(bad), null, JSON.stringify(bad ?? String(bad)));
  }
});

test('the summary sanitizer can under-show but can never fabricate or inflate', () => {
  assert.deepEqual(sanitizeReportSummary({ status: 'below_threshold' }), {
    status: 'below_threshold',
  });
  assert.deepEqual(sanitizeReportSummary({ status: 'reported', count: 12 }), {
    status: 'reported',
    count: 12,
  });
  assert.deepEqual(
    sanitizeReportSummary({ status: 'reported', count: SHOPPER_REPORT_VISIBILITY_THRESHOLD }),
    {
      status: 'reported',
      count: SHOPPER_REPORT_VISIBILITY_THRESHOLD,
    },
  );
  // A "reported" claim BELOW the threshold is a contract violation — the
  // sanitizer refuses it rather than displaying a sub-threshold count.
  for (const bad of [
    null,
    'ok',
    {},
    { status: 'reported' },
    { status: 'reported', count: 2 },
    { status: 'reported', count: 3.5 },
    { status: 'reported', count: '12' },
    { status: 'surprise' },
  ]) {
    assert.deepEqual(
      sanitizeReportSummary(bad),
      { status: 'unavailable' },
      JSON.stringify(bad ?? String(bad)),
    );
  }
});
