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
 * thresholded count (or, from P2B3, the server's `unavailable` answer),
 * whether THIS installation has a report, what that report says, and
 * whether a submission or withdrawal succeeded (a scenario may refuse one,
 * the way the server refuses before writing). Nothing else.
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

import type { HazardGuideKey } from '@/content/hazard-guides';
import type { Geography } from '@/domain/recall-types';
import type { ConsumerRiskTier } from '@/domain/risk-tier';
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
  | 'questionnaire_single_state'
  | 'questionnaire_multi_state'
  | 'questionnaire_state_search'
  | 'questionnaire_no_retailer'
  | 'questionnaire_edit'
  | 'questionnaire_submit_refused'
  | 'questionnaire_paused_own_report'
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
  | 'pairs_many'
  // P2B2 Detail scenarios. Still real recalls chosen for their own shape;
  // nothing is simulated on any of them.
  | 'header_image'
  | 'header_no_image'
  | 'name_short'
  | 'name_long'
  | 'geography_nationwide'
  | 'guide_botulism'
  | 'guide_listeria'
  | 'guide_stec'
  | 'guide_undeclared_allergen'
  | 'guide_salmonella'
  | 'guide_hepatitis_a'
  | 'guide_cyclospora'
  | 'health_risk_fallback'
  | 'health_risk_absent'
  | 'pairs_complete'
  | 'pairs_incomplete'
  | 'risk_critical'
  | 'risk_very_high'
  | 'risk_high'
  | 'risk_moderate'
  | 'risk_low'
  | 'risk_pending'
  | 'risk_unknown'
  // P2B7C official imagery. Still real recalls chosen for their own shape;
  // nothing is simulated on any of them.
  | 'images_one'
  | 'images_two'
  | 'images_five'
  | 'images_six'
  | 'images_many'
  | 'images_largest'
  | 'image_portrait'
  | 'image_landscape'
  | 'name_long_images'
  | 'row_image_matched'
  | 'labels_unrendered'
  | 'text_accessibility_large'
  | 'text_accessibility_xxxl';

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
  // P2B3 — the questionnaire's own shapes, decided from the feed row.
  /** Eligible and naming exactly one official state: the yes/no confirm. */
  | 'reportable_single_state'
  /** Eligible and naming several official states: the direct picker, unsearched. */
  | 'reportable_multi_state'
  /** Eligible and nationwide: the picker over every supported jurisdiction, searchable. */
  | 'reportable_nationwide'
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
  | 'pairs_many'
  // P2B2 — decided from the feed row (the same projection fields the
  // Detail model reads).
  /** Nationwide distribution: one sentence, no jurisdiction list, no control. */
  | 'nationwide'
  /** One recall per consumer risk tier, from the real `riskView` of its classification. */
  | 'risk_critical'
  | 'risk_very_high'
  | 'risk_high'
  | 'risk_moderate'
  | 'risk_low'
  | 'risk_pending'
  | 'risk_unknown'
  // P2B2 — confirmed against the real Detail model.
  /** The model resolved a hero image: the header renders the tile. */
  | 'image'
  /** No hero: the identity column takes the whole header row. */
  | 'no_image'
  /** A product name at or under `NAME_SHORT_MAX` characters. */
  | 'name_short'
  /** A product name at or over `NAME_LONG_MIN` characters — wraps beside the hero. */
  | 'name_long'
  /** One recall per reviewed hazard guide, selected by the real guide pipeline. */
  | 'guide_botulism'
  | 'guide_listeria'
  | 'guide_stec'
  | 'guide_undeclared_allergen'
  | 'guide_salmonella'
  | 'guide_hepatitis_a'
  | 'guide_cyclospora'
  /** Health Risk present with the risk-only sentence: no guide, no symptoms, no source. */
  | 'health_risk_fallback'
  /** No Health Risk section at all. */
  | 'health_risk_absent'
  /** A pair group where every code has its date: no blank line. */
  | 'pairs_complete'
  /** A pair group with an undated code: the blank keeps its line. */
  | 'pairs_incomplete'
  // P2B7C — the header's official image set, confirmed against the real
  // Detail model. Each size is its own requirement because the INDICATOR
  // changes shape across them: none, dots, then the numeric counter.
  /** Exactly one official product photo: the static tile, no indicator. */
  | 'images_one'
  /** Exactly two: the smallest paged set, dots. */
  | 'images_two'
  /** Exactly five: the largest set that still uses dots. */
  | 'images_five'
  /** Exactly six: the first set that uses the numeric counter. */
  | 'images_six'
  /** Fifteen or more: a long set on the counter. */
  | 'images_many'
  /** The largest set the live corpus holds, whatever that is today. */
  | 'images_largest'
  /** The header set contains an unusually TALL official photo. */
  | 'image_portrait'
  /** The header set contains an unusually WIDE official photo. */
  | 'image_landscape'
  /** A long product name beside a paged image set — the tightest header. */
  | 'name_long_images'
  /** An affected-product row the allocator matched an image to (Outshine). */
  | 'row_image_matched'
  /** A notice whose official label pages exist and are deliberately unrendered. */
  | 'labels_unrendered';

/** The guide each `guide_*` requirement is satisfied by — one per reviewed guide. */
export const GUIDE_REQUIREMENTS: Record<HazardGuideKey, PreviewCaseRequirement> = {
  botulism: 'guide_botulism',
  listeria: 'guide_listeria',
  stec: 'guide_stec',
  'undeclared-allergen': 'guide_undeclared_allergen',
  salmonella: 'guide_salmonella',
  'hepatitis-a': 'guide_hepatitis_a',
  cyclospora: 'guide_cyclospora',
};

/** The tier each `risk_*` requirement is satisfied by. */
export const RISK_REQUIREMENTS: Record<ConsumerRiskTier, PreviewCaseRequirement> = {
  critical: 'risk_critical',
  very_high: 'risk_very_high',
  high: 'risk_high',
  moderate: 'risk_moderate',
  low: 'risk_low',
  pending: 'risk_pending',
  unknown: 'risk_unknown',
};

/**
 * Product-name thresholds for the short and long header scenarios, in
 * characters of the model's own `productName`. Short fits one line beside
 * the hero on the reference width; long is sure to wrap into several.
 */
export const NAME_SHORT_MAX = 24;
export const NAME_LONG_MIN = 56;

/**
 * What counts as an extreme image shape, as width ÷ height of the source's
 * own published dimensions.
 *
 * Measured over the recorded FDA corpus, whose official photography runs from
 * 0.28 (a tall bag-label shot) to 5.85 (a wide date-code strip). These
 * thresholds are for CHOOSING a screenshot example — nothing in the product
 * lays out by aspect ratio, because every image renders `contain`.
 */
export const EXTREME_PORTRAIT_MAX_ASPECT = 0.5;
export const EXTREME_LANDSCAPE_MIN_ASPECT = 2;

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
  'image',
  'no_image',
  'name_short',
  'name_long',
  ...Object.values(GUIDE_REQUIREMENTS),
  'health_risk_fallback',
  'health_risk_absent',
  'pairs_complete',
  'pairs_incomplete',
  // P2B7C
  'images_one',
  'images_two',
  'images_five',
  'images_six',
  'images_many',
  'images_largest',
  'image_portrait',
  'image_landscape',
  'name_long_images',
  'row_image_matched',
  'labels_unrendered',
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
  /** Whether the model resolved a hero image for the header tile. */
  hasHeroImage: boolean;
  /** Characters in the model's own cleaned product name. */
  productNameLength: number;
  /** Whether the model decided a Health Risk section at all. */
  healthRisk: boolean;
  /** The reviewed guide the real pipeline selected, or null (risk-only or no section). */
  healthGuideKey: HazardGuideKey | null;
  /** Whether any pair group has every code dated. */
  hasCompletePairGroup: boolean;
  /** Whether any pair group carries an undated code (a blank partner line). */
  hasIncompletePairGroup: boolean;
  /**
   * How many official FDA product photos the header set holds — the model's
   * own `productImages.images.length`. There is no cap, so this is also how
   * many pages a shopper can reach.
   */
  productImageCount: number;
  /** How many official FSIS label pages the allocation holds. They render
   * nowhere (founder decision); the count exists so the harness can offer a
   * notice that PROVES nothing renders. */
  labelPageCount: number;
  /** Whether the allocator matched an image to at least one exact
   * affected-product row — the only imagery Affected Products may show. */
  rowImageCount: number;
  /** Whether the rendered header set contains an unusually tall photo. */
  hasExtremePortraitImage: boolean;
  /** Whether it contains an unusually wide one. */
  hasExtremeLandscapeImage: boolean;
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
  /**
   * Whether the simulated summary answers as an available feature. False
   * answers `unavailable` — what the server says while the gate is off —
   * so the paused state can be inspected. It can only ever switch the
   * simulated feature OFF; nothing here switches anything on.
   */
  featureAvailable: boolean;
  /**
   * Whether a simulated submission is refused, the way the server refuses
   * before writing anything, so the recoverable failure can be inspected.
   */
  submissionRefused: boolean;
}

/** A simulated refusal: the server said no before writing, and nothing changed. */
export class PreviewSubmissionRefused extends Error {
  constructor() {
    super('Design Preview: the simulated submission was refused before anything was written');
    this.name = 'PreviewSubmissionRefused';
  }
}

/** How the hub groups its scenario list. */
export type PreviewScenarioGroup =
  'community' | 'questionnaire' | 'disclosure' | 'header' | 'health' | 'risk' | 'imagery';

export interface PreviewScenario {
  id: DesignPreviewScenarioId;
  group: PreviewScenarioGroup;
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

/** The ordinary simulated session: the feature answers as available and submissions succeed. */
const AVAILABLE = { featureAvailable: true, submissionRefused: false } as const;

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
    group: 'community',
    title: 'Detail · below threshold, no personal report',
    expectation: 'The invitation question, then Add your report. No count anywhere.',
    requirement: 'reportable_with_retailers',
    destination: 'detail',
    simulation: { publicCount: null, ownReport: false, ...AVAILABLE },
  },
  {
    id: 'detail_reported',
    group: 'community',
    title: 'Detail · twelve public reports, no personal report',
    expectation: 'The disclosed count replaces the question, then Add your report.',
    requirement: 'reportable_with_retailers',
    destination: 'detail',
    simulation: { publicCount: SIMULATED_REPORTED_COUNT, ownReport: false, ...AVAILABLE },
  },
  {
    id: 'detail_below_threshold_own_report',
    group: 'community',
    title: 'Detail · below threshold, personal report exists',
    expectation: 'Edit your report alone — no count, no invitation.',
    requirement: 'reportable_with_retailers',
    destination: 'detail',
    simulation: { publicCount: null, ownReport: true, ...AVAILABLE },
  },
  {
    id: 'detail_reported_own_report',
    group: 'community',
    title: 'Detail · twelve public reports, personal report exists',
    expectation: 'The disclosed count, then Edit your report.',
    requirement: 'reportable_with_retailers',
    destination: 'detail',
    simulation: { publicCount: SIMULATED_REPORTED_COUNT, ownReport: true, ...AVAILABLE },
  },
  {
    id: 'questionnaire_new',
    group: 'questionnaire',
    title: 'Questionnaire · full new report',
    expectation:
      'State first (a single-state confirm, or the direct picker), the store question, ' +
      'purchase time, review with the one-line disclosure, submit, then the success copy.',
    requirement: 'reportable_with_retailers',
    destination: 'questionnaire',
    simulation: { publicCount: null, ownReport: false, ...AVAILABLE },
  },
  {
    id: 'questionnaire_single_state',
    group: 'questionnaire',
    title: 'Questionnaire · single-state confirmation',
    expectation:
      'The first question is the yes/no confirm for the one official state. No ends the flow with ' +
      'nothing stored; Yes continues.',
    requirement: 'reportable_single_state',
    destination: 'questionnaire',
    simulation: { publicCount: null, ownReport: false, ...AVAILABLE },
  },
  {
    id: 'questionnaire_multi_state',
    group: 'questionnaire',
    title: 'Questionnaire · multi-state picker',
    expectation:
      'The direct state question over exactly the notice’s own jurisdictions, one radio row each, ' +
      'with no search field.',
    requirement: 'reportable_multi_state',
    destination: 'questionnaire',
    simulation: { publicCount: null, ownReport: false, ...AVAILABLE },
  },
  {
    id: 'questionnaire_state_search',
    group: 'questionnaire',
    title: 'Questionnaire · nationwide, searchable state list',
    expectation:
      'Every supported jurisdiction behind the search field. Typing filters the list; the field ' +
      'is never an answer, and an empty match says so.',
    requirement: 'reportable_nationwide',
    destination: 'questionnaire',
    simulation: { publicCount: null, ownReport: false, ...AVAILABLE },
  },
  {
    id: 'questionnaire_no_retailer',
    group: 'questionnaire',
    title: 'Questionnaire · recall naming no retailer',
    expectation: 'The store question is absent entirely: state, then purchase time, then review.',
    requirement: 'reportable_without_retailers',
    destination: 'questionnaire',
    simulation: { publicCount: null, ownReport: false, ...AVAILABLE },
  },
  {
    id: 'questionnaire_edit',
    group: 'questionnaire',
    title: 'Questionnaire · edit and removal',
    expectation:
      'Every answer pre-filled, Update report on review, the removal control beneath it, and the ' +
      'native removal confirm. Cancel changes nothing.',
    requirement: 'reportable_with_retailers',
    destination: 'questionnaire',
    simulation: { publicCount: null, ownReport: true, ...AVAILABLE },
  },
  {
    id: 'questionnaire_submit_refused',
    group: 'questionnaire',
    title: 'Questionnaire · recoverable submission error',
    expectation:
      'Submitting is refused the way the server refuses before writing: the failure renders ' +
      'beneath the action, every answer stays, and Back still works.',
    requirement: 'reportable_with_retailers',
    destination: 'questionnaire',
    simulation: {
      publicCount: null,
      ownReport: false,
      featureAvailable: true,
      submissionRefused: true,
    },
  },
  {
    id: 'questionnaire_paused_own_report',
    group: 'questionnaire',
    title: 'Questionnaire · reporting paused, existing report',
    expectation:
      'The summary answers unavailable while this device holds a report: no form, no submit — the ' +
      'paused message and the removal control alone.',
    requirement: 'reportable_with_retailers',
    destination: 'questionnaire',
    simulation: {
      publicCount: null,
      ownReport: true,
      featureAvailable: false,
      submissionRefused: false,
    },
  },
  {
    id: 'detail_ineligible',
    group: 'community',
    title: 'Detail · ineligible recall (unusable geography)',
    expectation: 'No community block at all — no heading, no control, no spacing. Not simulated.',
    requirement: 'not_reportable',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'detail_production_gated',
    group: 'community',
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
    group: 'disclosure',
    title: 'Detail · five jurisdictions or fewer',
    expectation: 'The whole jurisdiction list renders. No control at all.',
    requirement: 'jurisdictions_few',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'jurisdictions_collapsed',
    group: 'disclosure',
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
    group: 'disclosure',
    title: 'Detail · one affected product',
    expectation:
      'The single row renders normally, with no section-level action beside the heading.',
    requirement: 'products_one',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'products_collapsed',
    group: 'disclosure',
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
    group: 'disclosure',
    title: 'Detail · a product cell holding exactly two values',
    expectation: 'Both values render inline. The cell has no control of its own.',
    requirement: 'cell_two_values',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'cell_collapsed',
    group: 'disclosure',
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
    group: 'disclosure',
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
    group: 'disclosure',
    title: 'Detail · several identifier pairs',
    expectation:
      'Two complete pairs, aligned across both columns, behind ONE See all (N) — tap it and both ' +
      'sides reveal every remaining pair together, still aligned. Neither column can move alone.',
    requirement: 'pairs_many',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'geography_nationwide',
    group: 'disclosure',
    title: 'Detail · nationwide distribution',
    expectation: 'One sentence after the pin, no jurisdiction list and no control.',
    requirement: 'nationwide',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'pairs_complete',
    group: 'disclosure',
    title: 'Detail · a complete identifier/date group',
    expectation: 'Every code has its date on the same line; no blank line anywhere.',
    requirement: 'pairs_complete',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'pairs_incomplete',
    group: 'disclosure',
    title: 'Detail · an incomplete identifier/date group',
    expectation:
      'An undated code keeps a blank line in the date column, so every later pair stays level.',
    requirement: 'pairs_incomplete',
    destination: 'detail',
    simulation: null,
  },
  // ── P2B2: the restyled Detail's own shapes ────────────────────────────────
  {
    id: 'header_image',
    group: 'header',
    title: 'Detail · header with a product image',
    expectation:
      'The risk label, date and save control, then the product name, brand and official link ' +
      'beside the hero tile.',
    requirement: 'image',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'header_no_image',
    group: 'header',
    title: 'Detail · header without a product image',
    expectation: 'No tile and no placeholder: the identity column takes the whole row.',
    requirement: 'no_image',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'name_short',
    group: 'header',
    title: 'Detail · a short product name',
    expectation: 'The name sits on one line beside the hero; nothing stretches to fill.',
    requirement: 'name_short',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'name_long',
    group: 'header',
    title: 'Detail · a long product name',
    expectation: 'The name wraps across several lines beside the hero and is never truncated.',
    requirement: 'name_long',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'guide_botulism',
    group: 'health',
    title: 'Detail · Health Risk from the botulism guide',
    expectation: 'The reviewed risk statement, “Common symptoms” bullets, and the Learn more link.',
    requirement: 'guide_botulism',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'guide_listeria',
    group: 'health',
    title: 'Detail · Health Risk from the Listeria guide',
    expectation: 'The reviewed risk statement, “Common symptoms” bullets, and the Learn more link.',
    requirement: 'guide_listeria',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'guide_stec',
    group: 'health',
    title: 'Detail · Health Risk from the E. coli (STEC) guide',
    expectation: 'The reviewed risk statement, “Common symptoms” bullets, and the Learn more link.',
    requirement: 'guide_stec',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'guide_undeclared_allergen',
    group: 'health',
    title: 'Detail · Health Risk from the undeclared-allergen guide',
    expectation:
      'The allergen-specific risk sentence, “Common symptoms” bullets, and the Learn more link.',
    requirement: 'guide_undeclared_allergen',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'guide_salmonella',
    group: 'health',
    title: 'Detail · Health Risk from the Salmonella guide',
    expectation: 'The reviewed risk statement, “Common symptoms” bullets, and the Learn more link.',
    requirement: 'guide_salmonella',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'guide_hepatitis_a',
    group: 'health',
    title: 'Detail · Health Risk from the hepatitis A guide',
    expectation: 'The reviewed risk statement, “Common symptoms” bullets, and the Learn more link.',
    requirement: 'guide_hepatitis_a',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'guide_cyclospora',
    group: 'health',
    title: 'Detail · Health Risk from the Cyclospora guide',
    expectation: 'The reviewed risk statement, “Common symptoms” bullets, and the Learn more link.',
    requirement: 'guide_cyclospora',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'health_risk_fallback',
    group: 'health',
    title: 'Detail · Health Risk with no reviewed guide',
    expectation: 'The risk-only sentence stands alone: no symptom list and no source link.',
    requirement: 'health_risk_fallback',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'health_risk_absent',
    group: 'health',
    title: 'Detail · no Health Risk section',
    expectation:
      'Where It Was Sold is followed directly by Affected Products — no heading, no divider.',
    requirement: 'health_risk_absent',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'risk_critical',
    group: 'risk',
    title: 'Detail · CRITICAL',
    expectation: 'The canonical bare word in the critical treatment, beside the date.',
    requirement: 'risk_critical',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'risk_very_high',
    group: 'risk',
    title: 'Detail · VERY HIGH',
    expectation: 'The canonical bare words in the very-high treatment.',
    requirement: 'risk_very_high',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'risk_high',
    group: 'risk',
    title: 'Detail · HIGH',
    expectation: 'The canonical bare word in the high treatment.',
    requirement: 'risk_high',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'risk_moderate',
    group: 'risk',
    title: 'Detail · MODERATE',
    expectation: 'The canonical bare word in the moderate treatment.',
    requirement: 'risk_moderate',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'risk_low',
    group: 'risk',
    title: 'Detail · LOW',
    expectation: 'The canonical bare word in the low treatment — never green, never "safe".',
    requirement: 'risk_low',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'risk_pending',
    group: 'risk',
    title: 'Detail · PENDING',
    expectation: 'The soft-blue pending label with no explanatory note beneath it.',
    requirement: 'risk_pending',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'risk_unknown',
    group: 'risk',
    title: 'Detail · UNKNOWN (Public Health Alert)',
    expectation: 'The neutral unknown label beside the PUBLIC HEALTH ALERT notice label.',
    requirement: 'risk_unknown',
    destination: 'detail',
    simulation: null,
  },
  // ── P2B7C: official imagery ───────────────────────────────────────────────
  {
    id: 'images_one',
    group: 'imagery',
    title: 'Detail · one official product photo',
    expectation:
      'The static header tile exactly as before: no dots, no disclosure, nothing to swipe.',
    requirement: 'images_one',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'images_two',
    group: 'imagery',
    title: 'Detail · two official product photos',
    expectation:
      'The same tile, now swipeable: two position dots, the official order, and no page moves ' +
      'on its own. Swiping sideways must not move the page sideways; a vertical drag over the ' +
      'tile still scrolls Detail.',
    requirement: 'images_two',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'images_five',
    group: 'imagery',
    title: 'Detail · five official product photos',
    expectation: 'Five dots — the largest set that still uses them. No numeric counter.',
    requirement: 'images_five',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'images_six',
    group: 'imagery',
    title: 'Detail · six official product photos',
    expectation:
      'The dots are replaced by the compact counter: 1 / 6, updating as you page. Never both.',
    requirement: 'images_six',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'images_many',
    group: 'imagery',
    title: 'Detail · fifteen or more official product photos',
    expectation:
      'The counter reads 1 / N over the WHOLE set — every page is reachable, and paging to the ' +
      'last one proves it. No truncation sentence anywhere.',
    requirement: 'images_many',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'images_largest',
    group: 'imagery',
    title: 'Detail · the largest official set in the live corpus',
    expectation:
      'The outlier (fifty-one photos in the recorded corpus). It must open as fast as any other ' +
      'recall: the pager is virtualized, so only the visible page is mounted and fetched.',
    requirement: 'images_largest',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'image_portrait',
    group: 'imagery',
    title: 'Detail · an unusually tall official photo',
    expectation:
      'The whole photo fits inside the tile, letterboxed on the placeholder colour. Nothing is ' +
      'cropped and nothing is stretched.',
    requirement: 'image_portrait',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'image_landscape',
    group: 'imagery',
    title: 'Detail · an unusually wide official photo',
    expectation: 'The same, on the other axis: contained, never cropped to fill the square.',
    requirement: 'image_landscape',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'name_long_images',
    group: 'imagery',
    title: 'Detail · a long product name beside a paged set',
    expectation:
      'The name wraps beside the tile and is never truncated. At an accessibility text size the ' +
      'header stacks — name at full width, the paged tile beneath it — and stays stacked.',
    requirement: 'name_long_images',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'row_image_matched',
    group: 'imagery',
    title: 'Detail · an image matched to an exact affected-product row',
    expectation:
      'Inside Affected Products: a thumbnail beside the Product value of the row the allocator ' +
      'proved it depicts (the Outshine shape). This is the ONLY imagery that section may show.',
    requirement: 'row_image_matched',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'labels_unrendered',
    group: 'imagery',
    title: 'Detail · a notice whose official label pages are not rendered',
    expectation:
      'An FSIS notice that published rendered label pages. NOTHING renders them: no gallery ' +
      'above the table, no standalone section, and nothing in the header. The pages stay in the ' +
      'allocation for the evidence pipeline (founder decision).',
    requirement: 'labels_unrendered',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'text_accessibility_large',
    group: 'imagery',
    title: 'Detail · paged imagery at accessibility-large text',
    expectation:
      'Set the simulator to an accessibility text size (Settings › Accessibility › Display & ' +
      'Text Size › Larger Text) before opening. The dots, the disclosure and the label heading ' +
      'all grow with the text, the tile keeps its footprint, and no page is left half-shown.',
    requirement: 'images_two',
    destination: 'detail',
    simulation: null,
  },
  {
    id: 'text_accessibility_xxxl',
    group: 'imagery',
    title: 'Detail · paged imagery at accessibility-XXXL text',
    expectation:
      'The largest accessibility size. The header stacks, the product name still wraps without ' +
      'splitting a word, and the set stays on whole pages through the re-layout.',
    requirement: 'images_two',
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
  /** Whether this scenario refuses simulated submissions. */
  readonly refuseSubmissions: boolean;
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
    refuseSubmissions: scenario.simulation?.submissionRefused ?? false,
  };
  return session;
}

function buildSimulation(
  simulation: ScenarioSimulation,
  input: PreviewEntryInput,
): SimulatedShopperState {
  return {
    summary: !simulation.featureAvailable
      ? { status: 'unavailable' }
      : simulation.publicCount === null
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
 *
 * A scenario that simulates a refusal throws instead — synchronously, inside
 * the store's call, which the screen's `await` already sits inside a try —
 * and changes nothing, exactly as the server refuses before writing.
 */
export function recordPreviewSubmission(
  caseId: string,
  draft: ShopperReportDraft,
  now: string,
): MyShopperReport | null {
  const live = liveSession();
  if (live === null || live.caseId !== caseId || live.simulated === null) return null;
  if (live.refuseSubmissions) throw new PreviewSubmissionRefused();

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
  /**
   * The consumer risk tier the real `riskView` derives from the row's
   * classification — the same derivation the Detail model makes, computed by
   * the hub and carried here as data.
   */
  riskTier: ConsumerRiskTier;
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
      case 'pairs_many':
        return facts.maxPairLines > 2;
      case 'image':
        return facts.hasHeroImage;
      case 'no_image':
        return !facts.hasHeroImage;
      case 'name_short':
        return facts.productNameLength > 0 && facts.productNameLength <= NAME_SHORT_MAX;
      case 'name_long':
        return facts.productNameLength >= NAME_LONG_MIN;
      case 'health_risk_fallback':
        return facts.healthRisk && facts.healthGuideKey === null;
      case 'health_risk_absent':
        return !facts.healthRisk;
      case 'pairs_complete':
        return facts.hasCompletePairGroup;
      case 'pairs_incomplete':
        return facts.hasIncompletePairGroup;
      // P2B7C — the exact set sizes, so each rendering shape gets its own
      // real recall rather than one case standing in for several.
      case 'images_one':
        return facts.productImageCount === 1;
      case 'images_two':
        return facts.productImageCount === 2;
      case 'images_five':
        return facts.productImageCount === 5;
      case 'images_six':
        return facts.productImageCount === 6;
      case 'images_many':
        return facts.productImageCount >= 15;
      case 'images_largest':
        return facts.productImageCount >= 20;
      case 'image_portrait':
        return facts.hasExtremePortraitImage;
      case 'image_landscape':
        return facts.hasExtremeLandscapeImage;
      case 'name_long_images':
        return facts.productNameLength >= NAME_LONG_MIN && facts.productImageCount > 1;
      case 'row_image_matched':
        return facts.rowImageCount > 0;
      case 'labels_unrendered':
        return facts.labelPageCount > 0;
      default:
        // The seven guide requirements: the real pipeline's guide, by key.
        return (
          facts.healthGuideKey !== null && GUIDE_REQUIREMENTS[facts.healthGuideKey] === requirement
        );
    }
  }
  // Decided from the feed row's own projection fields.
  if (requirement === 'nationwide') return screened.candidate.geography.scope === 'nationwide';
  if (requirement.startsWith('risk_')) {
    return RISK_REQUIREMENTS[screened.candidate.riskTier] === requirement;
  }
  if (requirement === 'not_reportable') return !screened.reportable;
  if (!screened.reportable) return false;
  switch (requirement) {
    case 'reportable_with_retailers':
      return screened.retailerChoices.length > 0;
    case 'reportable_without_retailers':
      return screened.retailerChoices.length === 0;
    // P2B3 — the state question's three shapes, from the eligibility
    // evaluator's own allowed list and the row's own scope.
    case 'reportable_single_state':
      return screened.allowedStateCodes.length === 1;
    case 'reportable_multi_state':
      return (
        screened.candidate.geography.scope === 'states' && screened.allowedStateCodes.length > 1
      );
    case 'reportable_nationwide':
      return screened.candidate.geography.scope === 'nationwide';
    default:
      return false;
  }
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
