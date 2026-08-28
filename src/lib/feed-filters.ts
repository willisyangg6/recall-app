/**
 * All-Recalls browsing filters (C6) — pure, session-only view state.
 *
 * These are NOT preferences. They filter what the complete All Recalls feed
 * currently shows; they never touch the Affects-Me profile, its eligibility,
 * or its ranking, and they are never persisted. The underlying loaded corpus
 * is never mutated — filtering always derives a new view.
 *
 * Composition contract:
 *   within one dimension  → OR   (California OR Texas)
 *   across dimensions     → AND  ((California OR Texas) AND (Critical OR High))
 *
 * LOCATION uses the canonical tri-state geography (domain/recall-types):
 *   - scope 'states'     → matches when the stated list names a selected
 *                          jurisdiction (the same 52-jurisdiction vocabulary
 *                          preferences and geography normalize to)
 *   - scope 'nationwide' → matches every selected jurisdiction
 *   - scope 'unknown'    → matches NO location filter. Unknown is not
 *                          nationwide and not "not here"; a state filter only
 *                          shows notices known to apply. No inference from
 *                          headquarters, firm address, or retailer footprint.
 *
 * RISK uses the canonical consumer tiers (domain/risk-tier) exactly — the
 * seven values including the non-scale states Pending and Not rated, never
 * renamed, never collapsed, always derived from the official classification
 * set (never from card copy).
 */

import { stateNameForCode } from '@/domain/preferences';
import type { Classification, Geography } from '@/domain/recall-types';
import { consumerRiskTier, type ConsumerRiskTier } from '@/domain/risk-tier';
import { RISK_PRIORITY } from './affects-me-ranking';

/** The filterable slice of a feed item. `FeedItem` satisfies it. */
export interface FilterableRecall {
  classification: Classification;
  geography: Geography;
}

export interface FeedFilterState {
  /** Selected jurisdiction postal codes ('CA', 'DC', 'PR'). OR within. */
  stateCodes: string[];
  /** Selected canonical consumer risk tiers. OR within. */
  riskTiers: ConsumerRiskTier[];
}

export const EMPTY_FEED_FILTERS: FeedFilterState = { stateCodes: [], riskTiers: [] };

export function hasActiveFilters(filters: FeedFilterState): boolean {
  return filters.stateCodes.length > 0 || filters.riskTiers.length > 0;
}

/** Number of active dimensions+selections, for the temporary UI's chip badges. */
export function activeFilterCount(filters: FeedFilterState): number {
  return filters.stateCodes.length + filters.riskTiers.length;
}

/**
 * The complete canonical tier vocabulary in its canonical order — what the
 * Risk sheet offers. All seven, including the non-scale states, each under
 * its existing name (labels come from riskTierWord, never invented here).
 */
export const RISK_FILTER_TIERS: ConsumerRiskTier[] = [
  'critical',
  'high',
  'moderate',
  'low',
  'minimal',
  'pending',
  'unrated',
];

/**
 * How a notice qualifies for an ACTIVE location selection (C6.1):
 *
 *   0  explicit — the notice's own state list names at least one selected
 *      jurisdiction. Every explicit match is the same weight: "California",
 *      "California + Texas", and "California + 40 others" are one tier. A
 *      narrower list is not better evidence that the product reached you, so
 *      list length is never rewarded or penalised.
 *   1  nationwide — canonically nationwide, so it does reach the selected
 *      jurisdiction, but it says nothing SPECIFIC about it.
 *   null  excluded — stated distribution names only unselected jurisdictions,
 *      or geography is unknown. Unknown is not nationwide and not "not here";
 *      it simply cannot answer the question the filter asks.
 *
 * Only the canonical geography projection is consulted — never headquarters,
 * recalling-firm address, retailer footprint, or prose.
 *
 * @param stateCodes MUST be non-empty; with no selection there is no tier to
 * assign (the filter is inactive) and this returns null.
 */
export type LocationMatchTier = 0 | 1;

export function locationMatchTier(
  geography: Geography,
  stateCodes: string[],
): LocationMatchTier | null {
  if (stateCodes.length === 0) return null;
  if (geography.scope === 'states') {
    const explicit = stateCodes.some((code) => {
      const name = stateNameForCode(code);
      return name !== null && geography.states.includes(name);
    });
    return explicit ? 0 : null;
  }
  if (geography.scope === 'nationwide') return 1;
  return null;
}

/**
 * Membership is DERIVED from the tier, so what the filter admits and how the
 * results are ordered can never disagree.
 */
export function matchesLocationFilter(geography: Geography, stateCodes: string[]): boolean {
  if (stateCodes.length === 0) return true;
  return locationMatchTier(geography, stateCodes) !== null;
}

export function matchesRiskFilter(
  classification: Classification,
  tiers: ConsumerRiskTier[],
): boolean {
  if (tiers.length === 0) return true;
  return tiers.includes(consumerRiskTier(classification));
}

/**
 * Apply every active dimension (AND across, OR within). Returns the SAME
 * array instance when nothing is active, so a cleared filter bar is a strict
 * no-op and All Recalls provably renders its unfiltered self.
 */
export function applyFeedFilters<T extends FilterableRecall>(
  items: T[],
  filters: FeedFilterState,
): T[] {
  if (!hasActiveFilters(filters)) return items;
  return items.filter(
    (item) =>
      matchesLocationFilter(item.geography, filters.stateCodes) &&
      matchesRiskFilter(item.classification, filters.riskTiers),
  );
}

/**
 * Location-aware ordering for one ALREADY-SECTIONED list (C6.1).
 *
 * The full ordering the user sees is four levels deep:
 *
 *   1. location tier   explicit selected-jurisdiction match, then nationwide
 *   2. consumer risk   the canonical display sequence (RISK_PRIORITY)
 *   3. activity date   newest first
 *   4. case id         the existing total tie-break
 *
 * Levels 3–4 are INHERITED, not restated: this is a stable sort (guaranteed
 * by ES2019+) keyed only on levels 1–2, applied to a list `buildFeedSections`
 * has already put in its canonical order. So each section keeps its own
 * notion of "activity date" — `lastPublicActivityAt` for Recent activity,
 * `publishedAt` for Older active notices — and its id tie-break, and those
 * definitions cannot drift out of sync with a copy kept here.
 *
 * Location specificity outranks risk and recency on purpose: a notice that
 * names your state is more useful than a newer or more severe one that merely
 * also reaches it. Ordering never changes MEMBERSHIP — sectioning already
 * happened, so an old notice cannot be promoted into Recent activity by
 * matching the selected location.
 *
 * The risk sequence is imported rather than redeclared so All Recalls and
 * Affects me can never disagree about how tiers sequence (Pending/Unrated sit
 * between Moderate and Low — they are not a low severity, they are none).
 *
 * @returns the SAME array instance when no jurisdiction is selected, so an
 * inactive Location filter provably leaves All Recalls untouched; otherwise a
 * new array — the input is never sorted in place.
 */
export function orderByLocationTiers<T extends FilterableRecall>(
  items: T[],
  stateCodes: string[],
): T[] {
  if (stateCodes.length === 0) return items;
  return [...items].sort((a, b) => {
    // `2` is unreachable after filtering (an excluded notice is not in the
    // list) and exists only to keep the comparator total.
    const tierA = locationMatchTier(a.geography, stateCodes) ?? 2;
    const tierB = locationMatchTier(b.geography, stateCodes) ?? 2;
    return (
      tierA - tierB ||
      RISK_PRIORITY[consumerRiskTier(a.classification)] -
        RISK_PRIORITY[consumerRiskTier(b.classification)]
    );
  });
}
