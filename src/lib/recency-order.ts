/**
 * The one feed order (2026-10-05, founder decision): newest first, by the
 * agency's own dates, with a total tie-break. Every consumer surface that
 * orders recalls — All recalls (both sections), Affects You (both sections),
 * every filtered view including Location, and the Ready preview — sorts with
 * this comparator and nothing else, so no two screens can sequence the same
 * recalls differently.
 *
 *   1. material activity  — the announcement, or the latest MATERIAL timeline
 *                           entry (domain/material-activity.ts); newest first
 *   2. announcement date  — newest first
 *   3. case id            — ascending; a total order, so renders never reshuffle
 *
 * What is deliberately NOT here: consumer risk tier, geographic confidence,
 * allergen or store match strength, anything the shopper has seen or
 * acknowledged, pins, or any urgency override. Severity is a label on the
 * card, never a position in the list. `lastPublicActivityAt` is not here
 * either: it moves on an agency wording edit, which is public activity but
 * not news. Our own write times (`last_changed_at`, the ledger's
 * `created_at`) are never read.
 *
 * Dates are compared as `YYYY-MM-DD` strings: both agencies publish day
 * precision, and a plain string comparison stays total and correct if a source
 * ever supplies a fuller timestamp.
 */

import { materialActivityAt } from '@/domain/material-activity';
import type { TimelineEntry } from '@/domain/recall-types';

/** The minimum a case must expose to be ordered. `FeedItem` satisfies it. */
export interface RecencyRankable {
  id: string;
  publishedAt: string;
  timeline: readonly TimelineEntry[];
}

/** The complete sort key for one case. Every field is derived, never stored. */
export interface RecencyKey {
  /** Latest authoritative event, `YYYY-MM-DD`; newest first. */
  materialActivityAt: string;
  /** Original announcement, `YYYY-MM-DD`; newest first. */
  publishedAt: string;
  /** Stable identifier; the final, total tie-break. */
  id: string;
}

export function recencyKey(item: RecencyRankable): RecencyKey {
  return {
    materialActivityAt: materialActivityAt(item.publishedAt, item.timeline),
    publishedAt: item.publishedAt.slice(0, 10),
    id: item.id,
  };
}

/**
 * Total order over keys. Never returns 0 for two distinct cases: the id
 * tie-break guarantees the same input always renders in the same sequence.
 */
export function compareRecencyKeys(a: RecencyKey, b: RecencyKey): number {
  return (
    b.materialActivityAt.localeCompare(a.materialActivityAt) ||
    b.publishedAt.localeCompare(a.publishedAt) ||
    a.id.localeCompare(b.id)
  );
}

/** The comparator over cases, for a plain `Array.prototype.sort`. */
export function compareRecency(a: RecencyRankable, b: RecencyRankable): number {
  return compareRecencyKeys(recencyKey(a), recencyKey(b));
}

/**
 * A new array in newest-first order; the input is never sorted in place.
 * Returns the SAME array instance for an empty or single-item list, so a
 * no-op can be proven by identity where a caller cares.
 */
export function sortNewestFirst<T extends RecencyRankable>(items: readonly T[]): T[] {
  if (items.length < 2) return items as T[];
  return [...items].sort(compareRecency);
}
