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
import { confirmedOpen, type OpenEvidenceInput } from './open-evidence';
import { compareRecencyKeys, recencyKey, type RecencyKey } from './recency-order';
import type { PersonalRelevance } from './relevance';

/**
 * The minimum a case must expose to be ranked. `FeedItem` satisfies it. The
 * open-evidence facts are REQUIRED so no surface can split the sections
 * without them — Building, Ready and the Feed tab count one set.
 */
export interface AffectsMeRankable extends OpenEvidenceInput {
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
  /**
   * The COUNTED matches — the primary list, and the one number Building and
   * Ready show: material activity within 60 days, or confirmed open by the
   * agency (lib/open-evidence.ts).
   */
  affects: T[];
  /**
   * Matches outside the window that no agency currently confirms are open:
   * FSIS alerts, FDA recalls whose linked products are Completed/Terminated,
   * unlinked FDA recalls, and FDA evidence older than 21 days.
   */
  older: T[];
}

export interface AffectsMeSectionsResult<T> extends AffectsMeSections<T> {
  /** Every ranked case's key, for card copy ("Updated …") and QA. */
  priorityById: Map<string, AffectsMePriority>;
}

/**
 * Partition the active feed into the two Affects-me sections and rank each.
 *
 * ## Counted: recent OR confirmed open (2026-10-06, founder decision)
 *
 * A match is counted when its material activity is within the 60-day window
 * OR an agency affirmatively shows it is still open — FSIS lifecycle for an
 * FSIS recall, or a current FDA `Ongoing` enforcement status
 * (`confirmedOpen`, which also applies the 21-day evidence expiry against
 * the SAME `now`). Membership only: each section is still sorted ONCE by the
 * shared comparator, with no tier, group or evidence key. A confirmed-open
 * recall from 2024 lands below every in-window recall only because its date
 * is older. "Recent" stays date-only everywhere: All recalls never reads
 * evidence (`buildFeedSections`).
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
    const counted =
      tierForActivityDate(priority.materialActivityAt, now) === 'recent' ||
      confirmedOpen(item, now);
    (counted ? affects : older).push(item);
  }

  const byPriority = (a: T, b: T) =>
    compareAffectsMePriority(priorityById.get(a.id)!, priorityById.get(b.id)!);
  affects.sort(byPriority);
  older.sort(byPriority);

  return { affects, older, priorityById };
}

export { materialActivityAt };
