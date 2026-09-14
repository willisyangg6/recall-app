/**
 * Design Preview — a DEVELOPMENT-ONLY harness, not a product feature.
 *
 * It exists for one purpose: letting the founder walk the already-shipped
 * shopper-report experience (P1D) in a simulator and capture holistic
 * screenshots for the designer, while the production feature gate
 * (`shopper_report_config.reports_enabled`) stays off and nothing is written
 * to Supabase. It enables nothing, and it is not a step toward enablement —
 * see docs/recall-design-preview.md.
 *
 * ## What is real, and what is simulated
 *
 * REAL, always: the recall itself. Every screen the preview opens is the
 * production screen, rendering the production components against the live
 * read-only feed — the same title, brand, geography, retailers, Health Risk,
 * Affected Products, photos and official links a shopper would see. This
 * module never fabricates a recall fact, and it cannot: it holds no recall
 * content at all, only a case id and the choices that case's own projection
 * already allows.
 *
 * SIMULATED, only inside an explicitly entered session: the four values the
 * shopper-report boundary would otherwise ask the server for — the public
 * thresholded count, whether THIS installation has a report, what that
 * report says, and whether a submission or withdrawal succeeded. Nothing
 * else.
 *
 * ## Why the boundary is here
 *
 * lib/shopper-report-store.ts is the single seam both the Detail community
 * block and the questionnaire read through. Diverting it means the preview
 * renders the production components verbatim — no preview copies of Detail,
 * the community block, or the questionnaire exist — and it means a simulated
 * session never reaches lib/report-api.ts, which owns every shopper-report
 * `fetch`. Zero network mutations is therefore structural, not a promise.
 *
 * ## Three containments
 *
 * 1. DEVELOPMENT ONLY. `enterDesignPreview` refuses unless the runtime is a
 *    development build, so a release binary can hold no session and every
 *    read below falls through to the real server path.
 * 2. ONE CASE. A session names exactly one case id; any other recall in the
 *    same app session keeps the real server answers. Preview state cannot
 *    leak sideways into the normal app.
 * 3. IN MEMORY. The session is module state and nothing else — no
 *    SecureStore, no AsyncStorage, no cache, no file. Leaving the preview or
 *    reloading the app discards it completely.
 *
 * The production gate is never consulted, copied, or overridden here. A
 * simulated summary answers a question the app would have asked the server;
 * it does not switch anything on, and outside a session this module answers
 * nothing at all.
 */

import type { Geography } from '@/domain/recall-types';
import {
  evaluateReportEligibility,
  SHOPPER_REPORT_VISIBILITY_THRESHOLD,
  type MyShopperReport,
  type PurchaseWindow,
  type ShopperReportDraft,
  type ShopperReportSummary,
} from '@/domain/shopper-report';

// ── The development gate ────────────────────────────────────────────────────

/**
 * Whether this is a development build. Read off the global rather than the
 * bare `__DEV__` identifier so the guard itself is exercisable in the Node
 * test suite — React Native sets `global.__DEV__` in both configurations, and
 * anything that is not exactly `true` (a release bundle, a plain Node
 * process, a web build) is treated as production.
 *
 * Screens use the bare `__DEV__` identifier instead, so Metro can eliminate a
 * development-only row from a release bundle outright.
 */
export function isDevelopmentBuild(): boolean {
  return (globalThis as { __DEV__?: boolean }).__DEV__ === true;
}

// ── Scenarios ───────────────────────────────────────────────────────────────

export type DesignPreviewScenarioId =
  | 'detail_below_threshold'
  | 'detail_reported'
  | 'detail_below_threshold_own_report'
  | 'detail_reported_own_report'
  | 'questionnaire_new'
  | 'questionnaire_edit'
  | 'questionnaire_no_retailer'
  | 'detail_ineligible'
  | 'detail_production_gated'
  // Presentation states. None of these simulates anything: they are real
  // recalls chosen because their own shape exercises a disclosure.
  | 'jurisdictions_complete'
  | 'jurisdictions_collapsed'
  | 'products_single'
  | 'products_collapsed'
  | 'cell_two_values'
  | 'cell_collapsed'
  | 'pairs_two'
  | 'pairs_many';

/**
 * What kind of real recall a scenario needs to be shown on.
 *
 * The first three are decided by the shopper-report eligibility rules and
 * need nothing but a feed row. The rest describe a recall's PRESENTATION
 * shape — how many jurisdictions, product rows, or values in a cell — and are
 * decided from the real Detail model, so the hub confirms them against a
 * fetched detail rather than guessing from a feed row.
 */
export type PreviewCaseRequirement =
  /** Eligible for reports AND naming at least one canonical retailer. */
  | 'reportable_with_retailers'
  /** Eligible for reports but naming no safe retailer — the store question is skipped. */
  | 'reportable_without_retailers'
  /** Ineligible (unknown or unusable geography): no community entry point at all. */
  | 'not_reportable'
  /** Five jurisdictions or fewer: the whole list renders, with no control. */
  | 'jurisdictions_few'
  /** More than five: the first five render behind a "See all (N)". */
  | 'jurisdictions_many'
  /** Exactly one affected-product row: no section-level control. */
  | 'products_one'
  /** More than one row: the first renders behind a "See all (N)". */
  | 'products_many'
  /** Some UNPAIRED cell holds exactly two values: both render, no control. */
  | 'cell_two_values'
  /** Some UNPAIRED cell holds more than two: the first two render behind a control. */
  | 'cell_many_values'
  /** A code/date pair group of exactly two pairs: aligned, with no control. */
  | 'pairs_two'
  /** A pair group of more than two pairs: two pairs, then one shared control. */
  | 'pairs_many';

/** Which requirements need a confirmed Detail model rather than a feed row. */
export const PRESENTATION_REQUIREMENTS: readonly PreviewCaseRequirement[] = [
  'jurisdictions_few',
  'jurisdictions_many',
  'products_one',
  'products_many',
  'cell_two_values',
  'cell_many_values',
  'pairs_two',
  'pairs_many',
];

/**
 * What the REAL Detail model produced for one case — read from
 * `buildDetailModel`, never guessed. These are the facts the presentation
 * requirements are decided by.
 */
export interface PreviewDetailFacts {
  /** Jurisdictions the Where-it-was-sold list would render. */
  jurisdictionCount: number;
  /** Affected-product rows the expanded table would render. */
  productRowCount: number;
  /**
   * The largest number of values any single UNPAIRED cell holds. Paired cells
   * are excluded deliberately: their disclosure belongs to the coordinated
   * group, not to an independent field, so the two kinds of scenario can
   * never stand in for each other.
   */
  maxCellValues: number;
  /** Whether any UNPAIRED cell holds exactly two values. */
  hasTwoValueCell: boolean;
  /** The largest number of lines any single identifier pair group holds. */
  maxPairLines: number;
  /** Whether any pair group holds exactly two lines (so it needs no control). */
  hasTwoLinePairGroup: boolean;
}

export type PreviewDestination = 'detail' | 'questionnaire';

/**
 * The simulated half of a scenario, or null for "simulate nothing".
 *
 * Null is load-bearing: the two scenarios that demonstrate the REAL gated
 * behaviour (an ineligible recall, and the production gate being off) must
 * not be simulated at all, or they would prove nothing. Those sessions leave
 * the boundary untouched, so the screens read the real server exactly as they
 * do outside the preview.
 */
export interface ScenarioSimulation {
  /**
   * The disclosed public total, or null for the server's indistinguishable
   * below-threshold answer. A number here is always at or above the
   * visibility threshold — the server discloses no other count, and neither
   * may a preview of it.
   */
  publicCount: number | null;
  /** Whether this installation already has a report on the case. */
  ownReport: boolean;
}

export interface PreviewScenario {
  id: DesignPreviewScenarioId;
  /** The hub's label for the state being previewed. */
  title: string;
  /** What the founder should expect to see once it opens. */
  expectation: string;
  requirement: PreviewCaseRequirement;
  destination: PreviewDestination;
  simulation: ScenarioSimulation | null;
}

/**
 * The count the "twelve reports" scenarios disclose. Twelve is the number the
 * frozen consumer contract is written against
 * (docs/recall-shopper-reports.md §1); it is simulated, and it is the only
 * count this harness can produce.
 */
export const SIMULATED_REPORTED_COUNT = 12;

/**
 * The purchase-time bucket a simulated pre-existing report carries. One token
 * from the closed server vocabulary — the questionnaire's own edit pre-fill
 * has to show something, and inventing a sixth bucket is not an option.
 */
export const SIMULATED_PURCHASE_WINDOW: PurchaseWindow = 'past_month';

/**
 * Every state worth screenshotting, in the order the hub lists them. The
 * first four are the Detail rendering matrix
 * (docs/recall-shopper-reports.md §10); the next three are the questionnaire;
 * the last two are the states where nothing renders, which are as much a part
 * of the product as the states where something does.
 */
export const DESIGN_PREVIEW_SCENARIOS: readonly PreviewScenario[] = [
  {
    id: 'detail_below_threshold',
    title: 'Detail · below threshold, no personal report',
    expectation: 'The invitation question, then Add your report. No count anywhere.',
    requirement: 'reportable_with_retailers',
    destination: 'detail',
    simulation: { publicCount: null, ownReport: false },
  },
  {
    id: 'detail_reported',
    title: 'Detail · twelve public reports, no personal report',
    expectation: 'The disclosed count replaces the question, then Add your report.',
    requirement: 'reportable_with_retailers',
    destination: 'detail',
    simulation: { publicCount: SIMULATED_REPORTED_COUNT, ownReport: false },
  },
  {
    id: 'detail_below_threshold_own_report',
    title: 'Detail · below threshold, personal report exists',
    expectation: 'Edit your report alone — no count, no invitation.',
    requirement: 'reportable_with_retailers',
    destination: 'detail',
    simulation: { publicCount: null, ownReport: true },
  },
  {
    id: 'detail_reported_own_report',
    title: 'Detail · twelve public reports, personal report exists',
    expectation: 'The disclosed count, then Edit your report.',
    requirement: 'reportable_with_retailers',
    destination: 'detail',
    simulation: { publicCount: SIMULATED_REPORTED_COUNT, ownReport: true },
  },
  {
    id: 'questionnaire_new',
    title: 'Questionnaire · full new report',
    expectation:
      'State first (a single-state confirm, or the direct picker), the store question, ' +
      'purchase time, review with the one-line disclosure, submit, then the success copy.',
    requirement: 'reportable_with_retailers',
    destination: 'questionnaire',
    simulation: { publicCount: null, ownReport: false },
  },
  {
    id: 'questionnaire_edit',
    title: 'Questionnaire · edit and removal',
    expectation:
      'Every answer pre-filled, Update report on review, Remove my report, and the removal confirm.',
    requirement: 'reportable_with_retailers',
    destination: 'questionnaire',
    simulation: { publicCount: null, ownReport: true },
  },
  {
    id: 'questionnaire_no_retailer',
    title: 'Questionnaire · recall naming no retailer',
    expectation: 'The store question is absent entirely: state, then purchase time, then review.',
    requirement: 'reportable_without_retailers',
    destination: 'questionnaire',
    simulation: { publicCount: null, ownReport: false },
  },
  {
    id: 'detail_ineligible',
    title: 'Detail · ineligible recall (unusable geography)',
    expectation: 'No community block at all — no heading, no control, no spacing. Not simulated.',
    requirement: 'not_reportable',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'detail_production_gated',
    title: 'Detail · the real production gate, unsimulated',
    expectation:
      'An eligible recall with the real server answering. The gate is off, so nothing renders. ' +
      'Not simulated — this is the live behaviour.',
    requirement: 'reportable_with_retailers',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'jurisdictions_complete',
    title: 'Detail · five jurisdictions or fewer',
    expectation: 'The whole jurisdiction list renders. No control at all.',
    requirement: 'jurisdictions_few',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'jurisdictions_collapsed',
    title: 'Detail · more than five jurisdictions',
    expectation:
      'The first five in the notice’s own order, then See all (N). Tapping expands in place; ' +
      'the action becomes Show less. The community block stays beneath the whole statement.',
    requirement: 'jurisdictions_many',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'products_single',
    title: 'Detail · one affected product',
    expectation:
      'The single row renders normally, with no section-level action beside the heading.',
    requirement: 'products_one',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'products_collapsed',
    title: 'Detail · several affected products',
    expectation:
      'Exactly the first row in source order, with See all (N) beside the Affected Products ' +
      'heading. Expanding shows every row; the action becomes Show less.',
    requirement: 'products_many',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'cell_two_values',
    title: 'Detail · a product cell holding exactly two values',
    expectation: 'Both values render inline. The cell has no control of its own.',
    requirement: 'cell_two_values',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'cell_collapsed',
    title: 'Detail · an UNPAIRED cell holding more than two values',
    expectation:
      'The first two values, then that cell’s own See all (N). Expanding affects only that ' +
      'field — sibling cells and rows are untouched.',
    requirement: 'cell_many_values',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'pairs_two',
    title: 'Detail · two identifier pairs',
    expectation:
      'A code column and its date column aligned line for line, two complete pairs, and no ' +
      'control at all.',
    requirement: 'pairs_two',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'pairs_many',
    title: 'Detail · several identifier pairs',
    expectation:
      'Two complete pairs, aligned across both columns, behind ONE See all (N) — tap it and both ' +
      'sides reveal every remaining pair together, still aligned. Neither column can move alone.',
    requirement: 'pairs_many',
    destination: 'detail',
    simulation: null,
  },
];

export function previewScenario(id: string): PreviewScenario | null {
  return DESIGN_PREVIEW_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

// ── The session ─────────────────────────────────────────────────────────────

/** The simulated answers the shopper-report boundary returns inside a session. */
export interface SimulatedShopperState {
  summary: ShopperReportSummary;
  report: MyShopperReport | null;
}

export interface DesignPreviewSession {
  scenarioId: DesignPreviewScenarioId;
  /** The ONE real case this session simulates. Every other case is untouched. */
  caseId: string;
  caseTitle: string;
  /** Null means "simulate nothing" — the screens read the real server. */
  simulated: SimulatedShopperState | null;
}

interface InternalSession extends DesignPreviewSession {
  /** The scenario's opening state, so Reset can restore it without re-entering. */
  readonly initial: SimulatedShopperState | null;
}

/**
 * In-memory and nowhere else. Not persisted, not cached, not shared with
 * another screen, and gone on reload.
 */
let session: InternalSession | null = null;

/**
 * The live session, or null. Re-checks the development gate on every read, so
 * even a session that somehow existed could not act in a release build.
 */
function liveSession(): InternalSession | null {
  if (!isDevelopmentBuild()) return null;
  return session;
}

export function activeDesignPreview(): DesignPreviewSession | null {
  return liveSession();
}

export interface PreviewEntryInput {
  scenarioId: string;
  caseId: string;
  caseTitle: string;
  /**
   * The jurisdictions the case's OWN projection allows, as the shared detail
   * model computed them. A simulated pre-existing report names one of these
   * and never a state the notice does not list.
   */
  allowedStateCodes: readonly string[];
  /** The case's OWN canonical retailer names, from the same model. */
  retailerChoices: readonly string[];
  /** ISO timestamp for a simulated report's created/updated fields. */
  now: string;
}

/**
 * Enter a preview session, or return null when it is refused — a release
 * build, or an unknown scenario. Entering REPLACES any prior session, so two
 * scenarios can never be simulated at once.
 */
export function enterDesignPreview(input: PreviewEntryInput): DesignPreviewSession | null {
  if (!isDevelopmentBuild()) return null;
  const scenario = previewScenario(input.scenarioId);
  if (scenario === null) return null;

  const initial = scenario.simulation === null ? null : buildSimulation(scenario.simulation, input);
  session = {
    scenarioId: scenario.id,
    caseId: input.caseId,
    caseTitle: input.caseTitle,
    simulated: initial,
    initial,
  };
  return session;
}

function buildSimulation(
  simulation: ScenarioSimulation,
  input: PreviewEntryInput,
): SimulatedShopperState {
  return {
    summary:
      simulation.publicCount === null
        ? { status: 'below_threshold' }
        : { status: 'reported', count: simulation.publicCount },
    report: simulation.ownReport ? simulatedExistingReport(input) : null,
  };
}

/**
 * A pre-existing report built from the case's OWN allowed answers: the first
 * jurisdiction the notice lists, the first retailer it names (or none, which
 * is what "not sure" stores), and one purchase bucket. Nothing here is a
 * recall fact — these are the choices the real questionnaire would have
 * offered on this exact case.
 */
function simulatedExistingReport(input: PreviewEntryInput): MyShopperReport | null {
  const stateCode = input.allowedStateCodes[0];
  if (stateCode === undefined) return null;
  return {
    stateCode,
    retailerName: input.retailerChoices[0] ?? null,
    purchaseWindow: SIMULATED_PURCHASE_WINDOW,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Restore the scenario's opening state, discarding simulated edits. */
export function resetDesignPreview(): void {
  if (session === null) return;
  session = { ...session, simulated: session.initial };
}

/** Leave the preview. Every simulated value is discarded. */
export function exitDesignPreview(): void {
  session = null;
}

// ── The shopper-report boundary ─────────────────────────────────────────────

/**
 * The simulated answers for `caseId`, or null for "not simulated — use the
 * real server". Null covers every normal path: no session, a different
 * recall, a release build, and the two deliberately unsimulated scenarios.
 */
export function previewShopperState(caseId: string): SimulatedShopperState | null {
  const live = liveSession();
  if (live === null || live.caseId !== caseId) return null;
  return live.simulated;
}

/**
 * Record a simulated submission and return the stored report, or null when
 * this call is not inside a simulation — in which case the caller must use
 * the real server path untouched.
 *
 * Mirrors the server's idempotence (docs/recall-shopper-reports.md §5): an
 * identical re-submission changes nothing at all, including the version and
 * the timestamps. The public count deliberately does NOT move — a scenario's
 * count is the exact state being screenshotted, and a submission that
 * silently turned "12 shoppers reported finding it here" into thirteen would
 * make the frozen copy unphotographable.
 */
export function recordPreviewSubmission(
  caseId: string,
  draft: ShopperReportDraft,
  now: string,
): MyShopperReport | null {
  const live = liveSession();
  if (live === null || live.caseId !== caseId || live.simulated === null) return null;

  const prior = live.simulated.report;
  const unchanged =
    prior !== null &&
    prior.stateCode === draft.stateCode &&
    prior.retailerName === draft.retailerName &&
    prior.purchaseWindow === draft.purchaseWindow;
  if (unchanged) return prior;

  const report: MyShopperReport = {
    stateCode: draft.stateCode,
    retailerName: draft.retailerName,
    purchaseWindow: draft.purchaseWindow,
    version: prior === null ? 1 : prior.version + 1,
    createdAt: prior === null ? now : prior.createdAt,
    updatedAt: now,
  };
  session = { ...live, simulated: { ...live.simulated, report } };
  return report;
}

/**
 * Record a simulated withdrawal. Returns true when the preview handled it, so
 * the caller knows not to contact the server; false means this call is
 * outside a simulation and must take the real path.
 */
export function recordPreviewWithdrawal(caseId: string): boolean {
  const live = liveSession();
  if (live === null || live.caseId !== caseId || live.simulated === null) return false;
  session = { ...live, simulated: { ...live.simulated, report: null } };
  return true;
}

// ── Choosing a real recall ──────────────────────────────────────────────────

/**
 * The facts the hub screens a real feed item on. Every field comes from the
 * live feed row; none is invented here.
 */
export interface PreviewCandidate {
  id: string;
  title: string;
  state: 'active' | 'closed' | 'retracted';
  geography: Geography;
  /** projection.retailerNames, exactly as the feed row carries it. */
  retailerNames: readonly string[];
  /** How many affected-product lines the notice carries. */
  productLineCount: number;
  lastPublicActivityAt: string;
}

/** A candidate resolved against the same eligibility rules the server enforces. */
export interface ScreenedCandidate {
  candidate: PreviewCandidate;
  reportable: boolean;
  allowedStateCodes: readonly string[];
  retailerChoices: readonly string[];
}

/**
 * Run one feed item through the SHARED eligibility evaluator — the same pure
 * function the Detail model and the server's SQL both mirror — so a candidate
 * the hub offers is a candidate the real screens will actually treat that way.
 */
export function screenCandidate(candidate: PreviewCandidate): ScreenedCandidate {
  const eligibility = evaluateReportEligibility({
    state: candidate.state,
    geography: candidate.geography,
    retailerNames: candidate.retailerNames,
  });
  return eligibility.eligible
    ? {
        candidate,
        reportable: true,
        allowedStateCodes: eligibility.allowedStateCodes,
        retailerChoices: eligibility.retailerChoices,
      }
    : { candidate, reportable: false, allowedStateCodes: [], retailerChoices: [] };
}

export function meetsRequirement(
  screened: ScreenedCandidate,
  requirement: PreviewCaseRequirement,
  facts: PreviewDetailFacts | null = null,
): boolean {
  if (PRESENTATION_REQUIREMENTS.includes(requirement)) {
    // Unconfirmed means "not yet known", never "yes": the hub offers a
    // presentation scenario only once the real Detail model has proven the
    // case actually has that shape.
    if (facts === null) return false;
    switch (requirement) {
      case 'jurisdictions_few':
        return facts.jurisdictionCount > 0 && facts.jurisdictionCount <= 5;
      case 'jurisdictions_many':
        return facts.jurisdictionCount > 5;
      case 'products_one':
        return facts.productRowCount === 1;
      case 'products_many':
        return facts.productRowCount > 1;
      case 'cell_two_values':
        return facts.hasTwoValueCell;
      case 'cell_many_values':
        return facts.maxCellValues > 2;
      case 'pairs_two':
        return facts.hasTwoLinePairGroup;
      default:
        return facts.maxPairLines > 2;
    }
  }
  if (requirement === 'not_reportable') return !screened.reportable;
  if (!screened.reportable) return false;
  return requirement === 'reportable_with_retailers'
    ? screened.retailerChoices.length > 0
    : screened.retailerChoices.length === 0;
}

/**
 * How well a candidate suits a screenshot, following the brief's preference
 * order: known state geography first, then a canonical retailer, then
 * affected-product lines. Recency breaks ties, so the founder lands on
 * something current rather than something from last year.
 */
export function candidateScore(screened: ScreenedCandidate): number {
  let score = 0;
  if (screened.candidate.geography.scope === 'states') score += 8;
  if (screened.retailerChoices.length > 0) score += 4;
  if (screened.candidate.productLineCount > 0) score += 2;
  if (screened.candidate.geography.confidence === 'stated') score += 1;
  return score;
}

/**
 * The candidates that fit a requirement, best first. Pure and total: an empty
 * result means this corpus offers no recall for that scenario, which the hub
 * says plainly rather than substituting an unsuitable one.
 */
export function rankCandidates(
  items: readonly PreviewCandidate[],
  requirement: PreviewCaseRequirement,
  factsFor: (id: string) => PreviewDetailFacts | null = () => null,
): ScreenedCandidate[] {
  return items
    .map(screenCandidate)
    .filter((screened) => meetsRequirement(screened, requirement, factsFor(screened.candidate.id)))
    .sort((a, b) => {
      const byScore = candidateScore(b) - candidateScore(a);
      if (byScore !== 0) return byScore;
      return b.candidate.lastPublicActivityAt.localeCompare(a.candidate.lastPublicActivityAt);
    });
}

/** Guard: the harness may only ever disclose a count the server itself would. */
export function isDisclosableCount(count: number): boolean {
  return Number.isInteger(count) && count >= SHOPPER_REPORT_VISIBILITY_THRESHOLD;
}
