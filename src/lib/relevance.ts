/**
 * Personal relevance (Phase C3): ONE deterministic evaluation shared by the
 * Home "Affects me" feed, the detail screen's "Why this may affect you"
 * section, and push delivery eligibility — so what the app shows and what the
 * server sends can never disagree.
 *
 * Principles (architecture Part 5.3 + C3 brief):
 * - Geography is tri-state. `unknown` is never treated as "does not affect
 *   you" — a wrong "doesn't affect you" is dangerous.
 * - Allergen and retailer matches are POSITIVE signals only. Their absence
 *   proves nothing: retailer and allergen metadata is incomplete at the
 *   source. They never exclude a recall — with exactly one exception, below.
 * - Authoritative geographic exclusion wins over personal signals: a recall
 *   stated to be sold only in Maine is not "affects me" for a California
 *   user, undeclared peanuts or not.
 * - THE ONE EXCLUSION (C5.2B): a recall the source proves is allergen-only,
 *   with its allergens named, and none of them selected. A milk-only recall
 *   is not information a peanut-allergic shopper needs, however close to home
 *   it happened. This is narrow on purpose — it needs the agency's own hazard
 *   category AND a named allergen (domain/allergen-only.ts). A general or
 *   mixed hazard is never withheld, and everything withheld stays in All
 *   Recalls.
 * - No inference: no headquarters geography, no retail-footprint knowledge,
 *   no allergy severity. Facts come from the case; choices from preferences.
 */

import { isKnownAllergenMismatch, type HazardFacts } from '@/domain/allergen-only';
import { normalizedAllergenTokens } from '@/domain/hazard';
import {
  allergenLabelForToken,
  CONSUMER_ALLERGENS,
  stateNameForCode,
  type UserRecallPreferences,
} from '@/domain/preferences';
import type { Geography } from '@/domain/recall-types';
import { canonicalRetailerIds, retailerById } from '@/domain/retailer-catalog';

/** Tri-state geographic relevance. `unknown` preserves source uncertainty. */
export type GeographicRelevance = 'matches' | 'does_not_match' | 'unknown';

export type PersonalReasonKind =
  'allergen' | 'retailer' | 'state' | 'nationwide' | 'unknown_geography';

/** One user-facing, source-grounded reason ("Your allergen · Sesame"). */
export interface PersonalReason {
  kind: PersonalReasonKind;
  label: string;
}

export interface PersonalRelevance {
  geographic: GeographicRelevance;
  /** Selected allergen tokens the case authoritatively involves. */
  matchedAllergens: string[];
  /** Selected canonical retailer ids the case's stated retailers resolve to. */
  matchedRetailers: string[];
  /** Belongs in the primary "Affects me" list / qualifies for delivery. */
  affectsMe: boolean;
  /**
   * Chip-ready reasons, strongest first (allergen, retailer, geography).
   * Empty when there is nothing personal to say — an authoritative
   * geographic exclusion, or unknown geography with no personal signal —
   * so no UI ever renders an empty or misleading personalization block.
   */
  reasons: PersonalReason[];
}

/**
 * The case facts relevance reads — satisfied by FeedItem and CaseProjection.
 *
 * `hazardCategory` and `reasonText` are REQUIRED, not optional, so a surface
 * physically cannot evaluate relevance without the facts the allergen-only
 * rule needs. That is what keeps Home, the detail screen and push classifying
 * a recall the same way; an optional field would let one of them silently
 * fall back to the pre-C5.2B answer.
 */
export interface RelevanceInput extends HazardFacts {
  geography: Geography;
  retailerNames: string[];
}

const ALLERGEN_ORDER = new Map(CONSUMER_ALLERGENS.map((a, index) => [a.token, index]));

function geographicRelevance(geography: Geography, stateName: string | null): GeographicRelevance {
  // Nationwide affects every state — true whether or not one is selected.
  if (geography.scope === 'nationwide') return 'matches';
  if (geography.scope === 'unknown') return 'unknown';
  // A known state list can only be assessed against a chosen state.
  if (stateName === null) return 'unknown';
  return geography.states.includes(stateName) ? 'matches' : 'does_not_match';
}

/**
 * Evaluate one case against one set of preferences. Pure and deterministic.
 *
 * "Affects me" semantics:
 * - state chosen:   geography matches, OR geography unknown with at least one
 *   allergen/retailer signal. An authoritative exclusion is final — personal
 *   signals never override it (the match data stays available internally).
 * - no state chosen: geographic relevance cannot be personal, so only
 *   allergen/retailer signals qualify (nationwide items remain in All
 *   Recalls, and the UI asks for a state instead of pretending).
 * - known allergen mismatch: withheld regardless of geography or retailer.
 *   Order matters — this is applied AFTER geographic exclusion and BEFORE the
 *   positive signals, so a retailer match can never resurrect a recall the
 *   source proves does not involve the user's allergens.
 */
export function evaluatePersonalRelevance(
  input: RelevanceInput,
  prefs: UserRecallPreferences,
): PersonalRelevance {
  const stateName = stateNameForCode(prefs.state);
  const geographic = geographicRelevance(input.geography, stateName);

  const caseAllergens = normalizedAllergenTokens(input.pathogenOrAllergen);
  const matchedAllergens = caseAllergens
    .filter((token) => prefs.allergens.includes(token))
    .sort((a, b) => (ALLERGEN_ORDER.get(a) ?? 99) - (ALLERGEN_ORDER.get(b) ?? 99));

  const matchedRetailers = canonicalRetailerIds(input.retailerNames).filter((id) =>
    prefs.retailers.includes(id),
  );

  const hasSignal = matchedAllergens.length > 0 || matchedRetailers.length > 0;
  // The source proves this recall is about allergens, names them, and none is
  // one the user selected. Geography and retailer cannot speak to that.
  const knownAllergenMismatch = isKnownAllergenMismatch(input, prefs.allergens);
  const affectsMe =
    geographic === 'does_not_match'
      ? false
      : knownAllergenMismatch
        ? false
        : stateName !== null && geographic === 'matches'
          ? true
          : hasSignal;

  const reasons: PersonalReason[] = [];
  // A withheld recall has no personalized reason to give: "Sold at Costco" on
  // a milk recall a peanut user was never shown would explain nothing.
  if (geographic !== 'does_not_match' && !knownAllergenMismatch) {
    for (const token of matchedAllergens) {
      reasons.push({ kind: 'allergen', label: `Your allergen · ${allergenLabelForToken(token)}` });
    }
    for (const id of matchedRetailers) {
      const retailer = retailerById(id);
      if (retailer) reasons.push({ kind: 'retailer', label: `Sold at ${retailer.name}` });
    }
    if (input.geography.scope === 'nationwide') {
      reasons.push({ kind: 'nationwide', label: 'Nationwide recall' });
    } else if (geographic === 'matches' && stateName !== null) {
      reasons.push({ kind: 'state', label: `Affects ${stateName}` });
    } else if (geographic === 'unknown' && hasSignal) {
      // Context for the signals above — never a reason on its own.
      reasons.push({ kind: 'unknown_geography', label: 'Location not specified' });
    }
  }

  return { geographic, matchedAllergens, matchedRetailers, affectsMe, reasons };
}

/**
 * Push delivery policy (C3 §24): personalization gates delivery only once a
 * state is chosen. Until then the pre-C3 behavior stands — every deliverable
 * event qualifies — because allergen/retailer preferences alone are positive
 * signals, not exclusion filters, and recalls are safety information.
 */
export function pushEligible(input: RelevanceInput, prefs: UserRecallPreferences | null): boolean {
  if (prefs === null || prefs.state === null) return true;
  return evaluatePersonalRelevance(input, prefs).affectsMe;
}
