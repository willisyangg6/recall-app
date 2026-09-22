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
 * - Geography is a SET on both sides (P2B7U): the source's stated states,
 *   and the jurisdictions the shopper chose. One state in common is a match;
 *   an exclusion requires the source to name none of them.
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
  hasAnyPreference,
  stateNamesForCodes,
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

/**
 * The geographic comparison, over a SET of chosen jurisdictions (P2B7U).
 *
 * The only thing multi-select changed here is the comparison itself: one
 * `includes` became an intersection. Every surrounding rule is the one it
 * always was —
 *
 * - nationwide matches whatever the shopper chose (and whether they chose);
 * - unknown stays unknown, never "does not affect you";
 * - no jurisdiction chosen is not an answer about geography, so it is
 *   `unknown` — the same answer the empty profile got before;
 * - a known state list is an exclusion only when it names NONE of the
 *   chosen jurisdictions. One is enough to match, because a person who
 *   shops in two states is reached by a recall in either of them.
 */
function geographicRelevance(geography: Geography, stateNames: string[]): GeographicRelevance {
  // Nationwide affects every state — true whether or not one is selected.
  if (geography.scope === 'nationwide') return 'matches';
  if (geography.scope === 'unknown') return 'unknown';
  // A known state list can only be assessed against a chosen jurisdiction.
  if (stateNames.length === 0) return 'unknown';
  return stateNames.some((name) => geography.states.includes(name)) ? 'matches' : 'does_not_match';
}

/**
 * Evaluate one case against one set of preferences. Pure and deterministic.
 *
 * "Affects me" semantics:
 * - any jurisdiction chosen: geography matches, OR geography unknown with at
 *   least one allergen/retailer signal. An authoritative exclusion is final —
 *   personal signals never override it (the match data stays available
 *   internally).
 * - no jurisdiction chosen: geographic relevance cannot be personal, so only
 *   allergen/retailer signals qualify (nationwide items remain in All
 *   Recalls, and the UI asks for a jurisdiction instead of pretending).
 * - known allergen mismatch: withheld regardless of geography or retailer.
 *   Order matters — this is applied AFTER geographic exclusion and BEFORE the
 *   positive signals, so a retailer match can never resurrect a recall the
 *   source proves does not involve the user's allergens.
 */
export function evaluatePersonalRelevance(
  input: RelevanceInput,
  prefs: UserRecallPreferences,
): PersonalRelevance {
  const stateNames = stateNamesForCodes(prefs.states);
  const geographic = geographicRelevance(input.geography, stateNames);

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
        : stateNames.length > 0 && geographic === 'matches'
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
    } else if (geographic === 'matches') {
      // One reason per jurisdiction the source itself names, in the canonical
      // order — the same shape the allergen and retailer reasons have, so a
      // single-jurisdiction profile reads exactly as it did before P2B7U.
      for (const name of stateNames) {
        if (input.geography.states.includes(name)) {
          reasons.push({ kind: 'state', label: `Affects ${name}` });
        }
      }
    } else if (geographic === 'unknown' && hasSignal) {
      // Context for the signals above — never a reason on its own.
      reasons.push({ kind: 'unknown_geography', label: 'Location not specified' });
    }
  }

  return { geographic, matchedAllergens, matchedRetailers, affectsMe, reasons };
}

/**
 * The ONE Affects-You verdict every card surface renders (P2B7N.1).
 *
 * ## Why this exists
 *
 * "Affects you" is a claim about the CURRENT user, not a property of the
 * recall, so every surface that shows it has to answer the same question
 * from the same two inputs: this case's facts, and the preferences saved on
 * this device right now. Before this function each surface answered for
 * itself — and the Saved tab, which had no preferences in scope at all,
 * answered `false` for every card. The same recall therefore read as
 * relevant in the Feed and irrelevant in Saved, which is the one thing a
 * personalization label may never do: a shopper who saved a recall BECAUSE
 * it affects them opened Saved and was told, silently, that it does not.
 *
 * So the verdict is a function, not a screen decision, and the card builder
 * (`buildHomeCardModel`) is its only caller on the card path. A surface
 * hands over the case and the preferences; it has no boolean to pass, and
 * therefore no boolean it can get wrong.
 *
 * ## Why `null` and "no preferences" are the same answer
 *
 * `null` is preferences not yet read (or a platform without preference
 * storage); an empty profile is a user who has chosen nothing. Neither is a
 * match, and neither may be reported as one. The `hasAnyPreference` gate is
 * explicit rather than incidental: `evaluatePersonalRelevance` already
 * returns `affectsMe: false` for a profile with no state, no allergen and
 * no retailer, but relying on that would make the card's behaviour a
 * side effect of the matcher's internals rather than a stated rule.
 *
 * This is deliberately NOT a stored snapshot. Saving a recall records an
 * id and nothing else (`lib/saved-recalls.ts`), so the verdict is recomputed
 * from today's preferences on every render: change a preference and both
 * surfaces change together, because both are reading the same live answer.
 */
export function affectsYouVerdict(
  input: RelevanceInput,
  prefs: UserRecallPreferences | null,
): boolean {
  if (prefs === null || !hasAnyPreference(prefs)) return false;
  return evaluatePersonalRelevance(input, prefs).affectsMe;
}

/**
 * Push delivery policy (C3 §24): personalization gates delivery only once a
 * jurisdiction is chosen. Until then the pre-C3 behavior stands — every
 * deliverable event qualifies — because allergen/retailer preferences alone
 * are positive signals, not exclusion filters, and recalls are safety
 * information. An empty jurisdiction list is exactly the old `null` state:
 * no location preference, so delivery is not narrowed.
 */
export function pushEligible(input: RelevanceInput, prefs: UserRecallPreferences | null): boolean {
  if (prefs === null || prefs.states.length === 0) return true;
  return evaluatePersonalRelevance(input, prefs).affectsMe;
}
