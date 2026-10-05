/**
 * "Affects me" sections and ordering: ONE deterministic, pure ranking shared
 * by every Affects-me surface (the Feed tab, the Ready preview, the Building
 * count), so the order can never depend on which component happened to
 * render.
 *
 * This module changes ORDER and SECTION ONLY. It never decides whether a
 * notice affects the user — that stays `evaluatePersonalRelevance`
 * (lib/relevance.ts), untouched — and it never touches push eligibility or
 * lifecycle.
 *
 * ## Newest first (2026-10-05, founder decision)
 *
 * The order is `lib/recency-order.ts`: material activity, then announcement
 * date, then case id — the same comparator All recalls and every filtered view
 * use. The C3.2 lexicographic tuple that led with consumer risk, then
 * geographic confidence, then allergen-over-store signal strength is retired:
 * a Pending recall announced today sits above a Critical recall from August,
 * a recall matching three stores sits where its dates put it, and the only
 * thing that can move a recall up is an authoritative agency event. There is
 * no seen/acknowledged record, no viewed demotion, no pin and no urgency
 * override.
 *
 * Risk is a LABEL on the card (lib/risk-display.ts), never a position in the
 * list; Pending and Unknown stay distinct labels and are never relabeled.
 */

import { materialActivityAt } from '@/domain/material-activity';
import type { TimelineEntry } from '@/domain/recall-types';
import { tierForActivityDate } from './feed-relevance';
import { compareRecencyKeys, recencyKey, type RecencyKey } from './recency-order';
import type { PersonalRelevance } from './relevance';

/** The minimum a case must expose to be ranked. `FeedItem` satisfies it. */
export interface AffectsMeRankable {
  id: string;
  publishedAt: string;
  timeline: TimelineEntry[];
}

/**
 * The complete sort key for one case — exactly the shared recency key. Every
 * field is derived, never stored. Kept under its own name so Affects-me
 * callers (the QA report, the tests) read one type.
 */
export type AffectsMePriority = RecencyKey;

export function affectsMePriority(item: AffectsMeRankable): AffectsMePriority {
  return recencyKey(item);
}

/**
 * Total order over priorities. Never returns 0 for two distinct cases: the id
 * tie-break guarantees the same input always renders in the same sequence.
 */
export function compareAffectsMePriority(a: AffectsMePriority, b: AffectsMePriority): number {
  return compareRecencyKeys(a, b);
}

/**
 * Human-readable priority, for QA review and debugging only. Never rendered to
 * consumers: sort keys are internal, and a numeric relevance score has no
 * honest consumer meaning.
 */
export function explainAffectsMePriority(priority: AffectsMePriority): string {
  return `activity ${priority.materialActivityAt} · announced ${priority.publishedAt}`;
}

export interface AffectsMeSections<T> {
  /** Qualifying notices with recent material activity — the primary list. */
  affects: T[];
  /** Qualifying notices whose last authoritative event is older than 60 days. */
  older: T[];
}

export interface AffectsMeSectionsResult<T> extends AffectsMeSections<T> {
  /** Every ranked case's key, for card copy ("Updated …") and QA. */
  priorityById: Map<string, AffectsMePriority>;
}

/**
 * Partition the active feed into the two Affects-me sections and rank each.
 *
 * Recency uses MATERIAL activity, not `lastPublicActivityAt`: an authoritative
 * expansion or classification today legitimately returns an older recall to the
 * top, while an agency wording edit — or any of our own maintenance writes —
 * cannot. All recalls uses the same date for its own window
 * (`buildFeedSections`), so the two views share one definition of "recent".
 *
 * There is no third "Location not specified" section (removed in C5.2B). A
 * notice that states no distribution and matches nothing personal said nothing
 * about this user, and a section of them was a large, permanently-collapsed
 * list that neither answered "does this affect me" nor could be acted on. It
 * is not moved into Older Active Notices either — those hold QUALIFYING
 * notices. All Recalls remains the complete, unfiltered safety net, and an
 * unknown-location notice that DOES match an allergen or retailer still ranks
 * in the main flow, carrying its honest "Location not specified" context.
 *
 * Sections are disjoint and exhaustive over the qualifying set by
 * construction: `affects` and `older` take exactly the cases where
 * `affectsMe` holds, split by one boundary. Every other case appears in
 * neither. The relevance verdict decides MEMBERSHIP only; nothing in it
 * is compared when ordering.
 */
export function buildAffectsMeSections<T extends AffectsMeRankable>(
  items: readonly T[],
  relevanceOf: (item: T) => PersonalRelevance,
  options: { now?: Date } = {},
): AffectsMeSectionsResult<T> {
  const now = options.now ?? new Date();
  const affects: T[] = [];
  const older: T[] = [];
  const priorityById = new Map<string, AffectsMePriority>();

  for (const item of items) {
    const priority = affectsMePriority(item);
    priorityById.set(item.id, priority);
    if (!relevanceOf(item).affectsMe) continue;
    const tier = tierForActivityDate(priority.materialActivityAt, now);
    (tier === 'recent' ? affects : older).push(item);
  }

  const byPriority = (a: T, b: T) =>
    compareAffectsMePriority(priorityById.get(a.id)!, priorityById.get(b.id)!);
  affects.sort(byPriority);
  older.sort(byPriority);

  return { affects, older, priorityById };
}

export { materialActivityAt };
