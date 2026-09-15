/**
 * Safety contract for the DEVELOPMENT Design Preview harness.
 *
 * The harness exists to photograph the shopper-report experience while the
 * production gate stays off, so what has to be proven is not that it looks
 * right — screenshots show that — but that it cannot do anything. Four
 * properties carry the whole risk, and each is asserted below:
 *
 *   1. It cannot exist in a release build.
 *   2. It cannot touch the network, so it cannot write to Supabase.
 *   3. It cannot affect any recall but the one case a session names, or any
 *      moment outside an explicitly entered session.
 *   4. It adds no production-visible entry point.
 *
 * Properties 1–3 are behavioural, driven through the real module. Property 4,
 * and the store's diversion order, are pinned against the route sources as
 * text — the same approach navigation-structure.test.ts and
 * profile-structure.test.ts use, because lib/shopper-report-store.ts imports
 * SecureStore (and therefore React Native) and cannot be loaded in this
 * suite at all. That import barrier is itself part of the proof and is
 * asserted: the harness may import nothing capable of I/O.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { HazardGuideKey } from '@/content/hazard-guides';
import type { ConsumerRiskTier } from '@/domain/risk-tier';
import {
  sanitizeReportSummary,
  SHOPPER_REPORT_VISIBILITY_THRESHOLD,
  type ShopperReportDraft,
} from '@/domain/shopper-report';
import {
  activeDesignPreview,
  candidateScore,
  DESIGN_PREVIEW_SCENARIOS,
  enterDesignPreview,
  exitDesignPreview,
  GUIDE_REQUIREMENTS,
  isDevelopmentBuild,
  isDisclosableCount,
  meetsRequirement,
  NAME_LONG_MIN,
  NAME_SHORT_MAX,
  PRESENTATION_REQUIREMENTS,
  previewScenario,
  PreviewSubmissionRefused,
  previewShopperState,
  rankCandidates,
  recordPreviewSubmission,
  recordPreviewWithdrawal,
  resetDesignPreview,
  RISK_REQUIREMENTS,
  screenCandidate,
  SIMULATED_PURCHASE_WINDOW,
  SIMULATED_REPORTED_COUNT,
  type PreviewCandidate,
  type PreviewDetailFacts,
  type PreviewEntryInput,
} from './design-preview';

/**
 * Source with comments removed. Every "must not reference X" assertion below
 * runs over this, so a file may freely DOCUMENT what it deliberately does not
 * do — the same distinction profile-structure.test.ts draws when it pins the
 * category vocabulary — while a real code reference still fails.
 */
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

const CASE = '11111111-1111-4111-8111-111111111111';
const OTHER_CASE = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-13T12:00:00.000Z';

const dev = { ...globalThis } as { __DEV__?: boolean };

/** Run `body` as a development build, then restore the ambient runtime. */
function inDevelopment<T>(body: () => T): T {
  const prior = (globalThis as { __DEV__?: boolean }).__DEV__;
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  try {
    return body();
  } finally {
    exitDesignPreview();
    if (prior === undefined) delete (globalThis as { __DEV__?: boolean }).__DEV__;
    else (globalThis as { __DEV__?: boolean }).__DEV__ = prior;
  }
}

function setDev(value: boolean | undefined): void {
  if (value === undefined) delete (globalThis as { __DEV__?: boolean }).__DEV__;
  else (globalThis as { __DEV__?: boolean }).__DEV__ = value;
}

const ENTRY: PreviewEntryInput = {
  scenarioId: 'detail_reported_own_report',
  caseId: CASE,
  caseTitle: 'A real recall',
  allowedStateCodes: ['CA', 'NV'],
  retailerChoices: ['Costco Wholesale'],
  now: NOW,
};

const DRAFT: ShopperReportDraft = {
  stateCode: 'NV',
  retailerName: null,
  purchaseWindow: 'past_week',
};

// ── 1. Development only ─────────────────────────────────────────────────────

test('the ambient test runtime is not a development build, and entry is refused there', () => {
  // Nothing in this file has touched the global yet: a plain Node process is
  // production as far as the harness is concerned, exactly like a release
  // bundle, where React Native sets __DEV__ to false.
  assert.equal(isDevelopmentBuild(), false);
  assert.equal(enterDesignPreview(ENTRY), null);
  assert.equal(activeDesignPreview(), null);
  assert.equal(previewShopperState(CASE), null);
});

test('a release build (__DEV__ === false) cannot enter preview mode', () => {
  setDev(false);
  try {
    assert.equal(isDevelopmentBuild(), false);
    assert.equal(enterDesignPreview(ENTRY), null);
    assert.equal(activeDesignPreview(), null);
    // And every boundary read falls through to "not simulated", which is what
    // makes the real server path the only path in a release build.
    assert.equal(previewShopperState(CASE), null);
    assert.equal(recordPreviewSubmission(CASE, DRAFT, NOW), null);
    assert.equal(recordPreviewWithdrawal(CASE), false);
  } finally {
    setDev(undefined);
  }
});

test('a session armed in development goes inert the moment the build is not development', () => {
  const armed = inDevelopment(() => {
    assert.notEqual(enterDesignPreview(ENTRY), null);
    assert.notEqual(previewShopperState(CASE), null);
    // Flip the runtime while the session object still exists in memory.
    setDev(false);
    return {
      active: activeDesignPreview(),
      state: previewShopperState(CASE),
      submitted: recordPreviewSubmission(CASE, DRAFT, NOW),
      withdrew: recordPreviewWithdrawal(CASE),
    };
  });
  assert.equal(armed.active, null);
  assert.equal(armed.state, null);
  assert.equal(armed.submitted, null);
  assert.equal(armed.withdrew, false);
});

test('an unknown scenario id is refused even in development', () => {
  inDevelopment(() => {
    assert.equal(enterDesignPreview({ ...ENTRY, scenarioId: 'not-a-scenario' }), null);
    assert.equal(activeDesignPreview(), null);
  });
});

// ── 2. No network, therefore no database write ──────────────────────────────

test('the whole simulated lifecycle issues zero network calls', () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    throw new Error('the Design Preview harness must never reach the network');
  }) as typeof fetch;
  try {
    inDevelopment(() => {
      enterDesignPreview({ ...ENTRY, scenarioId: 'detail_below_threshold' });
      previewShopperState(CASE);
      recordPreviewSubmission(CASE, DRAFT, NOW);
      previewShopperState(CASE);
      recordPreviewWithdrawal(CASE);
      previewShopperState(CASE);
      resetDesignPreview();
      previewShopperState(CASE);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 0);
});

test('the harness imports nothing capable of I/O — it cannot write anywhere', () => {
  const source = codeOnly(readFileSync(join(__dirname, 'design-preview.ts'), 'utf8'));
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
  // Types and pure domain logic only. Anything else — the RPC wrappers, the
  // feed reader, SecureStore, the Supabase client — would put a write path
  // one call away from simulated state.
  // P2B2 added two more pure type imports: the reviewed-guide keys (a static
  // content registry) and the consumer risk tiers.
  assert.deepEqual(imports.sort(), [
    '@/content/hazard-guides',
    '@/domain/recall-types',
    '@/domain/risk-tier',
    '@/domain/shopper-report',
  ]);
  for (const forbidden of [
    'fetch(',
    'report-api',
    'shopper-report-store',
    'SecureStore',
    'AsyncStorage',
    'supabase',
    'submit_shopper_report',
    'withdraw_shopper_report',
    'reports_enabled',
    'shopper_report_config',
  ]) {
    assert.ok(!source.includes(forbidden), `design-preview.ts references ${forbidden}`);
  }
});

test('the store consults the harness BEFORE any server call, and returns when simulated', () => {
  const store = readFileSync(join(__dirname, 'shopper-report-store.ts'), 'utf8');
  const bodyOf = (name: string): string => {
    const start = store.indexOf(`export function ${name}(`);
    const asyncStart = store.indexOf(`export async function ${name}(`);
    const from = start === -1 ? asyncStart : start;
    assert.ok(from !== -1, `${name} is missing from the store`);
    const next = store.indexOf('\nexport ', from + 1);
    return store.slice(from, next === -1 ? store.length : next);
  };
  const before = (body: string, guard: string, server: string) => {
    const g = body.indexOf(guard);
    const s = body.indexOf(server);
    assert.ok(g !== -1, `missing preview guard: ${guard}`);
    assert.ok(s !== -1, `missing server call: ${server}`);
    assert.ok(g < s, `the preview guard must precede ${server}`);
  };

  const submit = bodyOf('submitReport');
  before(submit, 'recordPreviewSubmission(', 'enqueueInstallationMutation(');
  assert.match(submit, /if \(simulated !== null\) return Promise\.resolve\(simulated\);/);

  const withdraw = bodyOf('withdrawReport');
  before(withdraw, 'recordPreviewWithdrawal(', 'enqueueInstallationMutation(');
  assert.match(withdraw, /if \(recordPreviewWithdrawal\(caseId\)\) return Promise\.resolve\(\);/);

  const mine = bodyOf('loadMyReport');
  before(mine, 'previewShopperState(caseId)', 'peekInstallationId()');
  assert.match(mine, /if \(simulated !== null\) return simulated\.report;/);

  const summary = bodyOf('loadReportSummary');
  before(summary, 'previewShopperState(caseId)', 'fetchShopperReportSummary(caseId)');
  assert.match(summary, /if \(simulated !== null\) return Promise\.resolve\(simulated\.summary\);/);
});

// ── 3. Containment: one case, one session ───────────────────────────────────

test('an active session simulates its own case and no other', () => {
  inDevelopment(() => {
    enterDesignPreview(ENTRY);
    assert.notEqual(previewShopperState(CASE), null);
    // Any other recall the founder opens in the same app session keeps the
    // real server answers — preview state cannot leak sideways.
    assert.equal(previewShopperState(OTHER_CASE), null);
    assert.equal(recordPreviewSubmission(OTHER_CASE, DRAFT, NOW), null);
    assert.equal(recordPreviewWithdrawal(OTHER_CASE), false);
  });
});

test('leaving the preview discards every simulated value', () => {
  inDevelopment(() => {
    enterDesignPreview(ENTRY);
    recordPreviewSubmission(CASE, DRAFT, NOW);
    exitDesignPreview();
    assert.equal(activeDesignPreview(), null);
    assert.equal(previewShopperState(CASE), null);
    assert.equal(recordPreviewSubmission(CASE, DRAFT, NOW), null);
    assert.equal(recordPreviewWithdrawal(CASE), false);
  });
});

test('entering a second scenario replaces the first — two are never live at once', () => {
  inDevelopment(() => {
    enterDesignPreview(ENTRY);
    const second = enterDesignPreview({
      ...ENTRY,
      scenarioId: 'detail_below_threshold',
      caseId: OTHER_CASE,
    });
    assert.equal(second?.caseId, OTHER_CASE);
    assert.equal(previewShopperState(CASE), null);
    assert.notEqual(previewShopperState(OTHER_CASE), null);
  });
});

test('the two unsimulated scenarios leave the real server path completely alone', () => {
  for (const scenarioId of ['detail_ineligible', 'detail_production_gated']) {
    inDevelopment(() => {
      const entered = enterDesignPreview({ ...ENTRY, scenarioId });
      assert.notEqual(entered, null, `${scenarioId} should be enterable`);
      assert.equal(entered?.simulated, null);
      // "Not simulated" and "no session" are the same answer at the boundary,
      // so Detail reads the live gate exactly as it does outside the preview.
      assert.equal(previewShopperState(CASE), null);
      assert.equal(recordPreviewSubmission(CASE, DRAFT, NOW), null);
      assert.equal(recordPreviewWithdrawal(CASE), false);
    });
  }
});

// ── The simulated states themselves ─────────────────────────────────────────

test('every required scenario exists, and each names its destination', () => {
  assert.deepEqual(
    DESIGN_PREVIEW_SCENARIOS.map((scenario) => scenario.id),
    [
      'detail_below_threshold',
      'detail_reported',
      'detail_below_threshold_own_report',
      'detail_reported_own_report',
      'questionnaire_new',
      // P2B3: the questionnaire's own shapes and endings.
      'questionnaire_single_state',
      'questionnaire_multi_state',
      'questionnaire_state_search',
      'questionnaire_no_retailer',
      'questionnaire_edit',
      'questionnaire_submit_refused',
      'questionnaire_paused_own_report',
      'detail_ineligible',
      'detail_production_gated',
      'jurisdictions_complete',
      'jurisdictions_collapsed',
      'products_single',
      'products_collapsed',
      'cell_two_values',
      'cell_collapsed',
      'pairs_two',
      'pairs_many',
      // P2B2: the restyled Detail's own shapes. Real recalls, nothing simulated.
      'geography_nationwide',
      'pairs_complete',
      'pairs_incomplete',
      'header_image',
      'header_no_image',
      'name_short',
      'name_long',
      'guide_botulism',
      'guide_listeria',
      'guide_stec',
      'guide_undeclared_allergen',
      'guide_salmonella',
      'guide_hepatitis_a',
      'guide_cyclospora',
      'health_risk_fallback',
      'health_risk_absent',
      'risk_critical',
      'risk_very_high',
      'risk_high',
      'risk_moderate',
      'risk_low',
      'risk_pending',
      'risk_unknown',
    ],
  );
  for (const scenario of DESIGN_PREVIEW_SCENARIOS) {
    assert.ok(scenario.title.length > 0);
    assert.ok(scenario.expectation.length > 0);
    assert.equal(previewScenario(scenario.id)?.id, scenario.id);
    // Every P2B2 scenario opens the real Detail and simulates nothing.
    if (scenario.group === 'header' || scenario.group === 'health' || scenario.group === 'risk') {
      assert.equal(scenario.destination, 'detail');
      assert.equal(scenario.simulation, null);
    }
  }
});

test('P2B3: a scenario can pause the feature or refuse a submission, and nothing else', () => {
  // Pausing answers `unavailable` — what the server says with the gate off —
  // while the owner's report is still readable, so the questionnaire's
  // reduced removal-only screen renders. It switches the simulated feature
  // OFF; no scenario can switch anything on that the server has not.
  inDevelopment(() => {
    enterDesignPreview({ ...ENTRY, scenarioId: 'questionnaire_paused_own_report' });
    const state = previewShopperState(CASE);
    assert.deepEqual(state?.summary, { status: 'unavailable' });
    assert.notEqual(state?.report, null);
    assert.equal(recordPreviewWithdrawal(CASE), true);
    assert.equal(previewShopperState(CASE)?.report, null);
  });
  // A refused submission throws the way the server refuses before writing:
  // synchronously inside the store's call, changing nothing at all.
  inDevelopment(() => {
    enterDesignPreview({ ...ENTRY, scenarioId: 'questionnaire_submit_refused' });
    assert.equal(previewShopperState(CASE)?.report, null);
    assert.throws(() => recordPreviewSubmission(CASE, DRAFT, NOW), PreviewSubmissionRefused);
    assert.equal(previewShopperState(CASE)?.report, null);
    assert.deepEqual(previewShopperState(CASE)?.summary, { status: 'below_threshold' });
  });
  // Every other scenario is available and accepts submissions, exactly as before.
  for (const scenario of DESIGN_PREVIEW_SCENARIOS) {
    if (scenario.simulation === null) continue;
    const paused = scenario.id === 'questionnaire_paused_own_report';
    const refused = scenario.id === 'questionnaire_submit_refused';
    assert.equal(scenario.simulation.featureAvailable, !paused, scenario.id);
    assert.equal(scenario.simulation.submissionRefused, refused, scenario.id);
    // A paused scenario names an owner, so the reduced screen has a report to remove.
    if (paused) assert.equal(scenario.simulation.ownReport, true);
  }
  // Both new scenarios open the real questionnaire, never a copy.
  for (const id of ['questionnaire_paused_own_report', 'questionnaire_submit_refused'] as const) {
    assert.equal(previewScenario(id)?.destination, 'questionnaire');
  }
});

test('P2B3: the state question’s three shapes are decided from the feed row', () => {
  const single = screenCandidate(noRetailer);
  const multi = screenCandidate(multiState);
  const nationwide = screenCandidate({
    ...multiState,
    id: 'n',
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
  });
  assert.equal(meetsRequirement(single, 'reportable_single_state'), true);
  assert.equal(meetsRequirement(multi, 'reportable_single_state'), false);
  assert.equal(meetsRequirement(multi, 'reportable_multi_state'), true);
  assert.equal(meetsRequirement(single, 'reportable_multi_state'), false);
  assert.equal(meetsRequirement(nationwide, 'reportable_multi_state'), false);
  assert.equal(meetsRequirement(nationwide, 'reportable_nationwide'), true);
  assert.equal(meetsRequirement(multi, 'reportable_nationwide'), false);
  // An ineligible recall satisfies none of them.
  for (const requirement of [
    'reportable_single_state',
    'reportable_multi_state',
    'reportable_nationwide',
  ] as const) {
    assert.equal(meetsRequirement(screenCandidate(unknownGeography), requirement), false);
    assert.equal(meetsRequirement(screenCandidate(closed), requirement), false);
    assert.ok(!PRESENTATION_REQUIREMENTS.includes(requirement), `${requirement} needs no probe`);
  }
});

test('the harness can only ever disclose a count the real server would disclose', () => {
  assert.equal(SIMULATED_REPORTED_COUNT, 12);
  assert.ok(isDisclosableCount(SIMULATED_REPORTED_COUNT));
  assert.ok(SIMULATED_REPORTED_COUNT >= SHOPPER_REPORT_VISIBILITY_THRESHOLD);
  for (const below of [0, 1, 2]) assert.equal(isDisclosableCount(below), false);
  // No scenario may configure a sub-threshold count: below the threshold the
  // server returns one indistinguishable state, and so must the preview.
  for (const scenario of DESIGN_PREVIEW_SCENARIOS) {
    const count = scenario.simulation?.publicCount ?? null;
    if (count !== null) assert.ok(isDisclosableCount(count), `${scenario.id} discloses ${count}`);
  }
});

test('every simulated summary survives the real sanitizer unchanged', () => {
  for (const scenario of DESIGN_PREVIEW_SCENARIOS) {
    inDevelopment(() => {
      enterDesignPreview({ ...ENTRY, scenarioId: scenario.id });
      const state = previewShopperState(CASE);
      if (state === null) return;
      // The harness cannot fabricate a summary the app's own sanitizer would
      // reject or downgrade — it produces the server's own vocabulary.
      assert.deepEqual(sanitizeReportSummary(state.summary), state.summary);
    });
  }
});

test('the four Detail states carry exactly the summary and report they promise', () => {
  const expected: Record<string, { count: number | null; report: boolean }> = {
    detail_below_threshold: { count: null, report: false },
    detail_reported: { count: 12, report: false },
    detail_below_threshold_own_report: { count: null, report: true },
    detail_reported_own_report: { count: 12, report: true },
  };
  for (const [scenarioId, want] of Object.entries(expected)) {
    inDevelopment(() => {
      enterDesignPreview({ ...ENTRY, scenarioId });
      const state = previewShopperState(CASE);
      assert.ok(state !== null, scenarioId);
      assert.deepEqual(
        state.summary,
        want.count === null
          ? { status: 'below_threshold' }
          : { status: 'reported', count: want.count },
      );
      assert.equal(state.report !== null, want.report, scenarioId);
    });
  }
});

test('a simulated pre-existing report only ever names the case’s OWN allowed answers', () => {
  inDevelopment(() => {
    enterDesignPreview(ENTRY);
    const report = previewShopperState(CASE)?.report;
    assert.ok(report);
    // Not invented: the first jurisdiction the notice lists and the first
    // retailer it names, both handed in from the real projection.
    assert.equal(report.stateCode, 'CA');
    assert.ok(ENTRY.allowedStateCodes.includes(report.stateCode));
    assert.equal(report.retailerName, 'Costco Wholesale');
    assert.ok(ENTRY.retailerChoices.includes(report.retailerName));
    assert.equal(report.purchaseWindow, SIMULATED_PURCHASE_WINDOW);
    assert.equal(report.version, 1);
  });
});

test('a recall naming no retailer yields a simulated report with no retailer', () => {
  inDevelopment(() => {
    enterDesignPreview({ ...ENTRY, retailerChoices: [] });
    assert.equal(previewShopperState(CASE)?.report?.retailerName, null);
  });
});

// ── Simulated submission and removal ────────────────────────────────────────

test('a simulated submission is remembered, so returning to Detail offers Edit', () => {
  inDevelopment(() => {
    enterDesignPreview({ ...ENTRY, scenarioId: 'detail_below_threshold' });
    assert.equal(previewShopperState(CASE)?.report, null);
    const stored = recordPreviewSubmission(CASE, DRAFT, '2026-09-13T13:00:00.000Z');
    assert.ok(stored);
    assert.equal(stored.stateCode, 'NV');
    assert.equal(stored.version, 1);
    // What Detail reads on focus now has a report, which is what turns the
    // block's action into "Edit your report".
    assert.deepEqual(previewShopperState(CASE)?.report, stored);
  });
});

test('a simulated removal returns the case to the no-personal-report state', () => {
  inDevelopment(() => {
    enterDesignPreview({ ...ENTRY, scenarioId: 'detail_below_threshold_own_report' });
    assert.notEqual(previewShopperState(CASE)?.report, null);
    assert.equal(recordPreviewWithdrawal(CASE), true);
    assert.equal(previewShopperState(CASE)?.report, null);
    // The public summary is untouched by a removal, exactly as the scenario
    // configured it — only this device's own report went away.
    assert.deepEqual(previewShopperState(CASE)?.summary, { status: 'below_threshold' });
  });
});

test('a simulated edit bumps the version; an identical re-submission changes nothing', () => {
  inDevelopment(() => {
    enterDesignPreview(ENTRY);
    const original = previewShopperState(CASE)?.report;
    assert.ok(original);
    const identical = recordPreviewSubmission(
      CASE,
      {
        stateCode: original.stateCode,
        retailerName: original.retailerName,
        purchaseWindow: original.purchaseWindow,
      },
      '2026-09-13T14:00:00.000Z',
    );
    // Mirrors the server's idempotent upsert: no version bump, no new
    // timestamp, no movement in any count.
    assert.deepEqual(identical, original);

    const edited = recordPreviewSubmission(CASE, DRAFT, '2026-09-13T15:00:00.000Z');
    assert.ok(edited);
    assert.equal(edited.version, 2);
    assert.equal(edited.createdAt, original.createdAt);
    assert.equal(edited.updatedAt, '2026-09-13T15:00:00.000Z');
  });
});

test('the disclosed count never moves, so the frozen copy stays photographable', () => {
  inDevelopment(() => {
    enterDesignPreview({ ...ENTRY, scenarioId: 'detail_reported' });
    recordPreviewSubmission(CASE, DRAFT, NOW);
    assert.deepEqual(previewShopperState(CASE)?.summary, { status: 'reported', count: 12 });
    recordPreviewWithdrawal(CASE);
    assert.deepEqual(previewShopperState(CASE)?.summary, { status: 'reported', count: 12 });
  });
});

test('reset restores the scenario’s opening state without re-entering it', () => {
  inDevelopment(() => {
    enterDesignPreview({ ...ENTRY, scenarioId: 'detail_reported_own_report' });
    const opening = previewShopperState(CASE)?.report;
    recordPreviewWithdrawal(CASE);
    assert.equal(previewShopperState(CASE)?.report, null);
    resetDesignPreview();
    assert.deepEqual(previewShopperState(CASE)?.report, opening);
  });
});

// ── Choosing a real recall ──────────────────────────────────────────────────

const multiState: PreviewCandidate = {
  id: 'a',
  title: 'Multi-state recall with retailers',
  state: 'active',
  geography: {
    scope: 'states',
    states: ['California', 'Nevada'],
    confidence: 'stated',
    sourceText: null,
  },
  retailerNames: ['Costco Wholesale'],
  productLineCount: 4,
  lastPublicActivityAt: '2026-09-01T00:00:00.000Z',
  riskTier: 'high',
};
const noRetailer: PreviewCandidate = {
  ...multiState,
  id: 'b',
  title: 'Single-state recall naming no retailer',
  geography: { scope: 'states', states: ['California'], confidence: 'stated', sourceText: null },
  retailerNames: [],
};
const unknownGeography: PreviewCandidate = {
  ...multiState,
  id: 'c',
  title: 'Unusable geography',
  geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
};
const closed: PreviewCandidate = { ...multiState, id: 'd', state: 'closed' };
const ALL = [multiState, noRetailer, unknownGeography, closed];

test('candidates are screened by the SHARED eligibility evaluator, not a second rule', () => {
  assert.equal(screenCandidate(multiState).reportable, true);
  assert.deepEqual(screenCandidate(multiState).allowedStateCodes, ['CA', 'NV']);
  assert.deepEqual(screenCandidate(multiState).retailerChoices, ['Costco Wholesale']);
  assert.equal(screenCandidate(noRetailer).reportable, true);
  assert.deepEqual(screenCandidate(noRetailer).retailerChoices, []);
  // Unusable geography and a non-active case are exactly what the server
  // refuses, so they are exactly what the "no entry point" scenario needs.
  assert.equal(screenCandidate(unknownGeography).reportable, false);
  assert.equal(screenCandidate(closed).reportable, false);
});

test('each requirement selects the recalls its scenario actually needs', () => {
  assert.deepEqual(
    rankCandidates(ALL, 'reportable_with_retailers').map((s) => s.candidate.id),
    ['a'],
  );
  assert.deepEqual(
    rankCandidates(ALL, 'reportable_without_retailers').map((s) => s.candidate.id),
    ['b'],
  );
  assert.deepEqual(
    rankCandidates(ALL, 'not_reportable')
      .map((s) => s.candidate.id)
      .sort(),
    ['c', 'd'],
  );
  assert.equal(meetsRequirement(screenCandidate(multiState), 'not_reportable'), false);
});

test('ranking prefers known geography, then a retailer, then product lines', () => {
  assert.ok(
    candidateScore(screenCandidate(multiState)) > candidateScore(screenCandidate(noRetailer)),
  );
  assert.ok(
    candidateScore(screenCandidate(noRetailer)) > candidateScore(screenCandidate(unknownGeography)),
  );
  const sparse = screenCandidate({ ...multiState, productLineCount: 0 });
  assert.ok(candidateScore(screenCandidate(multiState)) > candidateScore(sparse));
});

test('a presentation requirement is never satisfied by an unconfirmed case', () => {
  // These scenarios describe a recall's disclosure SHAPE, which only the real
  // Detail model knows. Until a case has been confirmed against it, the
  // answer is "not yet known" — never "yes".
  const screened = screenCandidate(multiState);
  for (const requirement of PRESENTATION_REQUIREMENTS) {
    assert.equal(meetsRequirement(screened, requirement, null), false, requirement);
  }
  assert.deepEqual(rankCandidates(ALL, 'cell_many_values'), []);
});

test('confirmed detail facts decide each presentation requirement exactly', () => {
  const screened = screenCandidate(multiState);
  const facts = (over: Partial<PreviewDetailFacts>): PreviewDetailFacts => ({
    jurisdictionCount: 0,
    productRowCount: 0,
    maxCellValues: 0,
    hasTwoValueCell: false,
    maxPairLines: 0,
    hasTwoLinePairGroup: false,
    hasHeroImage: false,
    productNameLength: 0,
    healthRisk: false,
    healthGuideKey: null,
    hasCompletePairGroup: false,
    hasIncompletePairGroup: false,
    ...over,
  });
  const ok = (requirement: Parameters<typeof meetsRequirement>[1], f: PreviewDetailFacts) =>
    meetsRequirement(screened, requirement, f);

  // Five or fewer jurisdictions renders complete; six starts disclosing. A
  // case with none is not a jurisdiction example at all.
  assert.equal(ok('jurisdictions_few', facts({ jurisdictionCount: 5 })), true);
  assert.equal(ok('jurisdictions_few', facts({ jurisdictionCount: 6 })), false);
  assert.equal(ok('jurisdictions_few', facts({ jurisdictionCount: 0 })), false);
  assert.equal(ok('jurisdictions_many', facts({ jurisdictionCount: 6 })), true);
  assert.equal(ok('jurisdictions_many', facts({ jurisdictionCount: 5 })), false);

  // One product row has no section control; two or more do.
  assert.equal(ok('products_one', facts({ productRowCount: 1 })), true);
  assert.equal(ok('products_one', facts({ productRowCount: 2 })), false);
  assert.equal(ok('products_many', facts({ productRowCount: 2 })), true);
  assert.equal(ok('products_many', facts({ productRowCount: 1 })), false);

  // A cell discloses above two values, so both examples are needed.
  assert.equal(ok('cell_two_values', facts({ hasTwoValueCell: true })), true);
  assert.equal(ok('cell_two_values', facts({ hasTwoValueCell: false })), false);
  assert.equal(ok('cell_many_values', facts({ maxCellValues: 3 })), true);
  assert.equal(ok('cell_many_values', facts({ maxCellValues: 2 })), false);

  // A pair group discloses above two PAIRS, and is measured apart from
  // independent fields so neither scenario can stand in for the other.
  assert.equal(ok('pairs_two', facts({ hasTwoLinePairGroup: true })), true);
  assert.equal(ok('pairs_two', facts({ hasTwoLinePairGroup: false })), false);
  assert.equal(ok('pairs_many', facts({ maxPairLines: 3 })), true);
  assert.equal(ok('pairs_many', facts({ maxPairLines: 2 })), false);
  // A long unpaired field never satisfies a pair scenario, and vice versa.
  assert.equal(ok('pairs_many', facts({ maxCellValues: 9 })), false);
  assert.equal(ok('cell_many_values', facts({ maxPairLines: 9 })), false);

  // P2B2 — the header, health and pair-completeness shapes.
  assert.equal(ok('image', facts({ hasHeroImage: true })), true);
  assert.equal(ok('image', facts({ hasHeroImage: false })), false);
  assert.equal(ok('no_image', facts({ hasHeroImage: false })), true);
  assert.equal(ok('name_short', facts({ productNameLength: NAME_SHORT_MAX })), true);
  assert.equal(ok('name_short', facts({ productNameLength: NAME_SHORT_MAX + 1 })), false);
  assert.equal(ok('name_short', facts({ productNameLength: 0 })), false);
  assert.equal(ok('name_long', facts({ productNameLength: NAME_LONG_MIN })), true);
  assert.equal(ok('name_long', facts({ productNameLength: NAME_LONG_MIN - 1 })), false);
  // A guide requirement is satisfied only by the real pipeline's own key,
  // and only when the model actually decided a Health Risk section.
  assert.equal(ok('guide_listeria', facts({ healthRisk: true, healthGuideKey: 'listeria' })), true);
  assert.equal(
    ok('guide_listeria', facts({ healthRisk: true, healthGuideKey: 'salmonella' })),
    false,
  );
  assert.equal(ok('guide_listeria', facts({ healthRisk: true, healthGuideKey: null })), false);
  assert.equal(ok('health_risk_fallback', facts({ healthRisk: true, healthGuideKey: null })), true);
  assert.equal(
    ok('health_risk_fallback', facts({ healthRisk: true, healthGuideKey: 'stec' })),
    false,
  );
  assert.equal(ok('health_risk_absent', facts({ healthRisk: false })), true);
  assert.equal(ok('health_risk_absent', facts({ healthRisk: true })), false);
  assert.equal(ok('pairs_complete', facts({ hasCompletePairGroup: true })), true);
  assert.equal(ok('pairs_incomplete', facts({ hasIncompletePairGroup: true })), true);
  assert.equal(ok('pairs_incomplete', facts({ hasCompletePairGroup: true })), false);
  for (const key of Object.keys(GUIDE_REQUIREMENTS) as HazardGuideKey[]) {
    assert.ok(PRESENTATION_REQUIREMENTS.includes(GUIDE_REQUIREMENTS[key]), key);
  }
});

test('nationwide and the risk tiers are decided from the feed row, with no probe needed', () => {
  const nationwide: PreviewCandidate = {
    ...multiState,
    id: 'n',
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: null },
  };
  assert.equal(meetsRequirement(screenCandidate(nationwide), 'nationwide'), true);
  assert.equal(meetsRequirement(screenCandidate(multiState), 'nationwide'), false);
  for (const tier of Object.keys(RISK_REQUIREMENTS) as ConsumerRiskTier[]) {
    const requirement = RISK_REQUIREMENTS[tier];
    assert.equal(
      meetsRequirement(screenCandidate({ ...multiState, riskTier: tier }), requirement),
      true,
    );
    assert.equal(
      meetsRequirement(
        screenCandidate({ ...multiState, riskTier: tier === 'low' ? 'high' : 'low' }),
        requirement,
      ),
      false,
    );
    assert.ok(!PRESENTATION_REQUIREMENTS.includes(requirement), `${requirement} needs no probe`);
  }
  assert.ok(!PRESENTATION_REQUIREMENTS.includes('nationwide'));
});

test('an empty corpus yields no candidate rather than an unsuitable one', () => {
  for (const requirement of [
    'reportable_with_retailers',
    'reportable_without_retailers',
    'not_reportable',
    ...PRESENTATION_REQUIREMENTS,
  ] as const) {
    assert.deepEqual(rankCandidates([], requirement), []);
  }
});

// ── 4. No production-visible surface ────────────────────────────────────────

const APP = join(__dirname, '..', 'app');
const readApp = (...parts: string[]): string => readFileSync(join(APP, ...parts), 'utf8');

test('the Profile row is behind the bare __DEV__ identifier, so release bundles drop it', () => {
  const profile = codeOnly(readApp('(tabs)', 'profile.tsx'));
  const guard = profile.indexOf('{__DEV__ ? (');
  assert.ok(guard !== -1, 'the Design Preview row must be wrapped in a __DEV__ branch');
  // The label, the destination, and the word "Development" all live INSIDE
  // that branch — nothing about the harness survives the elimination.
  const branch = profile.slice(guard);
  for (const marker of ['Design Preview', '/design-preview', '<DevelopmentEntry']) {
    assert.equal(
      profile.indexOf(marker) >= guard,
      true,
      `${marker} appears outside the __DEV__ branch`,
    );
    assert.ok(branch.includes(marker));
  }
  // A runtime flag would be a switch someone could set; the bare identifier
  // is replaced at build time and cannot be.
  for (const forbidden of ['isDevelopmentBuild', 'enterDesignPreview']) {
    assert.ok(!profile.includes(forbidden), `Profile must not reference ${forbidden}`);
  }
  // The entry component is the second lock on the same door: it renders
  // nothing outside a development build, whoever mounts it.
  const entry = codeOnly(
    readFileSync(join(__dirname, '..', 'components', 'profile', 'development-entry.tsx'), 'utf8'),
  );
  assert.ok(entry.includes('if (!__DEV__) return null;'));
  assert.ok(!entry.includes('isDevelopmentBuild'));
});

test('nothing but Profile’s development branch links to the harness', () => {
  for (const file of [
    ['(tabs)', 'index.tsx'],
    ['(tabs)', 'saved.tsx'],
    ['(tabs)', '_layout.tsx'],
    ['_layout.tsx'],
    ['recall', '[id].tsx'],
    ['report', '[id].tsx'],
    ['document', '[slug].tsx'],
    ['settings', 'index.tsx'],
    ['settings', 'personalization.tsx'],
    ['settings', 'notifications.tsx'],
  ]) {
    const source = codeOnly(readApp(...file));
    assert.ok(!source.includes('design-preview'), `${file.join('/')} references design-preview`);
    assert.ok(!source.includes('Design Preview'), `${file.join('/')} names Design Preview`);
  }
});

test('the product screens still read the real server — the harness touches neither', () => {
  const detail = readApp('recall', '[id].tsx');
  const questionnaire = readApp('report', '[id].tsx');
  const block = readFileSync(
    join(__dirname, '..', 'components', 'community-reports-section.tsx'),
    'utf8',
  );
  for (const source of [detail, questionnaire, block].map(codeOnly)) {
    for (const forbidden of ['design-preview', 'previewShopperState', 'isDevelopmentBuild']) {
      assert.ok(!source.includes(forbidden), `a product screen references ${forbidden}`);
    }
  }
  // The block and the questionnaire still read shopper-report state through
  // the one store, which is the only reason the preview needs no copies of
  // them — and the only place a diversion can live.
  assert.match(block, /from '@\/lib\/shopper-report-store'/);
  assert.match(questionnaire, /from '@\/lib\/shopper-report-store'/);
});

test('the harness hub is not a tab and holds no product copy of its own', () => {
  const hub = codeOnly(readApp('design-preview', 'index.tsx'));
  // It arms a session and pushes the REAL screens; it renders no community
  // block, no questionnaire, and none of the frozen consumer copy.
  assert.match(hub, /router\.push\(/);
  assert.match(hub, /pathname: '\/recall\/\[id\]'/);
  assert.match(hub, /pathname: '\/report\/\[id\]'/);
  for (const forbidden of [
    'CommunityReportsBlock',
    'shoppers reported finding it here',
    'Did you find this product here?',
    'Add your report',
    'Edit your report',
    'Thanks for contributing!',
    'submitReport',
    'withdrawReport',
    'loadReportSummary',
    'loadMyReport',
  ]) {
    assert.ok(!hub.includes(forbidden), `the hub reimplements or calls ${forbidden}`);
  }
  // And it says what it is, on the hub itself and nowhere else.
  assert.match(hub, /Local development tooling/);
});

test('no local feature flag can enable shopper reporting in the normal app', () => {
  // The app still holds no copy of the server gate anywhere: the only switch
  // is `shopper_report_config.reports_enabled`, which lives in Postgres.
  for (const source of [
    readFileSync(join(__dirname, 'design-preview.ts'), 'utf8'),
    readFileSync(join(__dirname, 'shopper-report-store.ts'), 'utf8'),
    readFileSync(join(__dirname, 'shopper-report-presentation.ts'), 'utf8'),
    readFileSync(join(__dirname, 'report-api.ts'), 'utf8'),
    readApp('design-preview', 'index.tsx'),
  ].map(codeOnly)) {
    for (const forbidden of ['reportsEnabled', 'REPORTS_ENABLED', 'EXPO_PUBLIC_SHOPPER']) {
      assert.ok(!source.includes(forbidden), `a local gate appeared: ${forbidden}`);
    }
  }
  assert.equal(dev.__DEV__, undefined);
});
