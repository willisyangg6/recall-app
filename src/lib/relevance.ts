/**
 * Personal-relevance matching — the foundation for the future default Home
 * experience (founder product decision: once preferences exist, Home defaults
 * to "Affects me", with "All recalls" always one tap away; personalization
 * organizes the full truth and never deletes or permanently hides it).
 *
 * This module is deliberately pure and UI-free: no preferences are stored
 * anywhere yet, and nothing renders relevance badges until real user
 * preferences exist. It exists so the read model's shape is proven against
 * the intended filters (state, allergens, retailers) before onboarding is
 * built.
 *
 * Geographic semantics follow architecture Part 5.3: unknown distribution is
 * surfaced as its own labeled category — never silently excluded, because a
 * wrong "doesn't affect you" is dangerous.
 */

import { normalizedAllergenTokens } from '@/domain/hazard';
import type { FeedItem } from './recall-feed';

/** Future user preferences (manual input at onboarding — never location APIs). */
export interface RelevanceProfile {
  /** Full state name, e.g. "California". */
  state?: string | null;
  /** Canonical allergen tokens from domain/hazard normalizedAllergenTokens. */
  allergens?: string[];
  /** Store names the user shops at, matched against source-stated retailers. */
  retailers?: string[];
}

export type GeographicRelevance = 'affects_area' | 'unknown_distribution' | 'not_matched';

export interface CaseRelevance {
  geographic: GeographicRelevance;
  /** Why this case is personally relevant (empty = no personal signal). */
  signals: string[];
}

type RelevanceInput = Pick<
  FeedItem,
  'geography' | 'pathogenOrAllergen' | 'retailerNames' | 'sourceAgency'
>;

export function caseRelevance(item: RelevanceInput, profile: RelevanceProfile): CaseRelevance {
  const signals: string[] = [];

  let geographic: GeographicRelevance;
  if (item.geography.scope === 'nationwide') {
    geographic = 'affects_area';
    signals.push('Distributed nationwide');
  } else if (item.geography.scope === 'unknown') {
    geographic = 'unknown_distribution';
  } else if (profile.state && item.geography.states.includes(profile.state)) {
    geographic = 'affects_area';
    signals.push(`Affects ${profile.state}`);
  } else if (!profile.state) {
    geographic = 'unknown_distribution';
  } else {
    geographic = 'not_matched';
  }

  const allergens = normalizedAllergenTokens(item.pathogenOrAllergen);
  const matched = allergens.filter((a) => (profile.allergens ?? []).includes(a));
  if (matched.length > 0) {
    signals.push(`Matches your allergen preference: ${matched.join(', ')}`);
  }

  const retailerMatch = item.retailerNames.find((name) =>
    (profile.retailers ?? []).some((r) => name.toLowerCase().includes(r.toLowerCase())),
  );
  if (retailerMatch) {
    signals.push(`Sold at ${retailerMatch}`);
  }

  return { geographic, signals };
}
