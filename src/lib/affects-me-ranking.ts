/**
 * "Affects me" ordering (Phase C3.2): ONE deterministic, pure ranking shared by
 * every Affects-me surface, so the order can never depend on which component
 * happened to render.
 *
 * This module changes ORDER ONLY. It never decides whether a notice affects
 * the user — that stays `evaluatePersonalRelevance` (lib/relevance.ts),
 * untouched — and it never touches All Recalls, push eligibility, or lifecycle.
 *
 * ## Lexicographic, not additive
 *
 * The comparison is a tuple compared left to right, each dimension fully
 * deciding before the next is consulted. A points-based score was rejected
 * outright: with weights, two retailer matches could out-rank a Critical
 * classification, and no one could explain afterwards why a card was second.
 * Here every position is answerable in one sentence.
 *
 *   1. consumer risk         — how bad is this if it reaches you
 *   2. geographic confidence — do we KNOW it reached your area
 *   3. personal signal       — allergen (a direct hazard relationship) then
 *                              retailer (only where you shop)
 *   4. material activity     — newest authoritative event first
 *   5. announcement date     — newest first
 *   6. case id               — total order, so renders never reshuffle
 *
 * Dimensions 1–3 are small integers where LOWER is more prominent; 4–5 are
 * dates compared descending; 6 breaks every remaining tie.
 */

import { materialActivityAt } from '@/domain/material-activity';
import type { Classification, TimelineEntry } from '@/domain/recall-types';
import { consumerRiskTier, type ConsumerRiskTier } from '@/domain/risk-tier';
import { tierForActivityDate } from './feed-relevance';
import type { PersonalRelevance } from './relevance';

/** The minimum a case must expose to be ranked. `FeedItem` satisfies it. */
export interface AffectsMeRankable {
  id: string;
  classification: Classification;
  publishedAt: string;
  timeline: TimelineEntry[];
}

/**
 * ORDERING ONLY — not a severity scale, and deliberately not
 * `RISK_TIER_RANK` (domain/risk-tier.ts), which ranks the non-scale states
 * `null` precisely because they have no severity.
 *
 * Pending and Unrated share one position between Moderate and Low. A notice
 * the agency has not classified yet, or never will (a public health alert),
 * must not sink below one the agency actively rated Low or Minimal — but
 * neither may it be presented AS Moderate. Sharing a rank says exactly that
 * and nothing more: they are grouped for sequence, are never relabeled, and no
 * risk level is inferred for them anywhere (see lib/risk-display.ts, which
 * still badges them "Pending" / "Not rated").
 */
const RISK_PRIORITY: Record<ConsumerRiskTier, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  pending: 3,
  unrated: 3,
  low: 4,
  minimal: 5,
};

/**
 * Explicit state inclusion and nationwide distribution are the SAME confidence:
 * both are the agency saying the product reached the user's area. Which one it
 * was is explained by the relevance reason ("Affects California" /
 * "Nationwide recall"), never by the position in the list.
 *
 * `2` exists only so the comparator is total for an input it should never
 * receive: an authoritative geographic exclusion is not "affects me" at all
 * (relevance.ts), so it is filtered out before ranking.
 */
function geographyPriority(relevance: PersonalRelevance): 0 | 1 | 2 {
  if (relevance.geographic === 'matches') return 0;
  if (relevance.geographic === 'unknown') return 1;
  return 2;
}

/**
 * Boolean categories, never counts: three selected retailers matching is the
 * same fact as one matching — the user shops there. Allergen outranks retailer
 * because an allergen match is a direct hazard relationship with the recalled
 * product, while a retailer match only says the user shops where it was sold;
 * it never implies they bought it.
 */
function signalPriority(relevance: PersonalRelevance): 0 | 1 | 2 | 3 {
  const allergen = relevance.matchedAllergens.length > 0;
  const retailer = relevance.matchedRetailers.length > 0;
  if (allergen && retailer) return 0;
  if (allergen) return 1;
  if (retailer) return 2;
  return 3;
}

/** The complete sort key for one case. Every field is derived, never stored. */
export interface AffectsMePriority {
  /** 0 Critical · 1 High · 2 Moderate · 3 Pending/Unrated · 4 Low · 5 Minimal */
  riskPriority: number;
  /** Carried for explanation only; never itself compared. */
  riskTier: ConsumerRiskTier;
  /** 0 confirmed (state or nationwide) · 1 unknown · 2 excluded (unreachable) */
  geographyPriority: 0 | 1 | 2;
  /** 0 allergen+retailer · 1 allergen · 2 retailer · 3 neither */
  signalPriority: 0 | 1 | 2 | 3;
  /** Latest authoritative event, `YYYY-MM-DD`; newest first. */
  materialActivityAt: string;
  /** Original announcement, `YYYY-MM-DD`; newest first. */
  publishedAt: string;
  /** Stable identifier; the final, total tie-break. */
  id: string;
}

export function affectsMePriority(
  item: AffectsMeRankable,
  relevance: PersonalRelevance,
): AffectsMePriority {
  const riskTier = consumerRiskTier(item.classification);
  return {
    riskPriority: RISK_PRIORITY[riskTier],
    riskTier,
    geographyPriority: geographyPriority(relevance),
    signalPriority: signalPriority(relevance),
    materialActivityAt: materialActivityAt(item.publishedAt, item.timeline),
    publishedAt: item.publishedAt.slice(0, 10),
    id: item.id,
  };
}

/**
 * Total order over priorities. Never returns 0 for two distinct cases: the id
 * tie-break guarantees the same input always renders in the same sequence.
 */
export function compareAffectsMePriority(a: AffectsMePriority, b: AffectsMePriority): number {
  return (
    a.riskPriority - b.riskPriority ||
    a.geographyPriority - b.geographyPriority ||
    a.signalPriority - b.signalPriority ||
    b.materialActivityAt.localeCompare(a.materialActivityAt) ||
    b.publishedAt.localeCompare(a.publishedAt) ||
    a.id.localeCompare(b.id)
  );
}

const GEOGRAPHY_WORD = ['confirmed geography', 'unknown geography', 'excluded'] as const;
const SIGNAL_WORD = ['allergen + retailer', 'allergen', 'retailer', 'no personal signal'] as const;

/**
 * Human-readable priority, for QA review and debugging only. Never rendered to
 * consumers: sort keys are internal, and a numeric relevance score has no
 * honest consumer meaning.
 */
export function explainAffectsMePriority(priority: AffectsMePriority): string {
  return [
    priority.riskTier,
    GEOGRAPHY_WORD[priority.geographyPriority],
    SIGNAL_WORD[priority.signalPriority],
    `activity ${priority.materialActivityAt}`,
    `announced ${priority.publishedAt}`,
  ].join(' · ');
}

export interface AffectsMeSections<T> {
  /** Qualifying notices with recent material activity — the primary list. */
  affects: T[];
  /**
   * Recent notices that state no distribution and match nothing personal.
   * Kept visible behind their own disclosure, never labeled "doesn't affect
   * you" — the existing honest-uncertainty treatment, now deterministically
   * ordered like everything else.
   */
  unknown: T[];
  /** Qualifying notices whose last authoritative event is older than 60 days. */
  older: T[];
}

export interface AffectsMeSectionsResult<T> extends AffectsMeSections<T> {
  /** Every ranked case's key, for card copy ("Updated …") and QA. */
  priorityById: Map<string, AffectsMePriority>;
}

/**
 * Partition the active feed into the three Affects-me sections and rank each.
 *
 * Recency uses MATERIAL activity, not `lastPublicActivityAt`: an authoritative
 * expansion or classification today legitimately returns an older recall to the
 * top, while an agency wording edit — or any of our own maintenance writes —
 * cannot. Because every material entry is stamped with the source-published
 * activity date, material activity is always ≤ `lastPublicActivityAt`, so this
 * window is a strict tightening of the All Recalls one, never a widening.
 *
 * Sections are disjoint by construction: `affects` and `older` take exactly the
 * qualifying cases, split by one boundary, and `unknown` takes only cases that
 * do not qualify. Every case lands in at most one.
 */
export function buildAffectsMeSections<T extends AffectsMeRankable>(
  items: readonly T[],
  relevanceOf: (item: T) => PersonalRelevance,
  options: { stateChosen: boolean; now?: Date },
): AffectsMeSectionsResult<T> {
  const now = options.now ?? new Date();
  const affects: T[] = [];
  const unknown: T[] = [];
  const older: T[] = [];
  const priorityById = new Map<string, AffectsMePriority>();

  for (const item of items) {
    const relevance = relevanceOf(item);
    const priority = affectsMePriority(item, relevance);
    priorityById.set(item.id, priority);
    if (relevance.affectsMe) {
      const tier = tierForActivityDate(priority.materialActivityAt, now);
      (tier === 'recent' ? affects : older).push(item);
      continue;
    }
    // Honest uncertainty is only meaningful once a state is chosen; without
    // one nearly everything reads as unknown and the section would be the
    // whole feed under a misleading heading.
    if (
      options.stateChosen &&
      relevance.geographic === 'unknown' &&
      tierForActivityDate(priority.materialActivityAt, now) === 'recent'
    ) {
      unknown.push(item);
    }
  }

  const byPriority = (a: T, b: T) =>
    compareAffectsMePriority(priorityById.get(a.id)!, priorityById.get(b.id)!);
  affects.sort(byPriority);
  unknown.sort(byPriority);
  older.sort(byPriority);

  return { affects, unknown, older, priorityById };
}
