/**
 * Material activity: the date of a case's most recent AUTHORITATIVE domain
 * event — the one date that may legitimately make a recall feel current.
 *
 * Two dates already exist and neither answers this question:
 *
 *   `lastChangedAt` (row column) is OUR write time. It moves for retailer
 *   backfills, image enrichment, and any maintenance repair. Never consumer
 *   information.
 *
 *   `lastPublicActivityAt` (projection) is source-published and therefore much
 *   better — but it is max(publishedAt, lastModifiedAt) across the case's
 *   records, so it also moves when an agency edits wording, fixes HTML, or
 *   touches `field_last_modified_date` with no consumer-relevant change.
 *   Measured live (2026-08-26): it sits ahead of the last material event on
 *   354 of 895 active cases.
 *
 * The trustworthy signal is the case TIMELINE, which already records the
 * Layer-2 verdict per entry (domain/material-change.ts): `material: true`
 * means a fixed rule fired — expansion, broadening correction, classification
 * assigned/upgraded/downgraded/changed, first illnesses reported, consumer
 * instructions changed, retraction. Those are exactly the notification-
 * eligible events, so "what could raise a recall's prominence" and "what could
 * notify a user" stay one definition rather than two that can drift.
 *
 * `publishedAt` seeds the result because the original announcement is itself
 * an authoritative event — the pipeline records it as a `published` entry with
 * `material: false` (it is the case's founding fact, not a change to one), so
 * seeding rather than counting it keeps that distinction intact.
 *
 * Deliberately NOT counted: `source_updated` bookkeeping entries, agency
 * closure (dashboard-visible, never notification-eligible — and closed cases
 * leave the active feed anyway), repair `corrected` entries (`material:
 * false`, dated by our clock), and anything our own maintenance writes, which
 * never append a timeline entry at all. The flag is what is read, never the
 * kind: `health_impact` and `instructions_changed` write kind
 * `source_updated` with `material: true`, and they count.
 *
 * Since 2026-10-05 this is THE feed date: both feeds and every filtered view
 * order by it and split recent/older on it (lib/recency-order.ts,
 * lib/feed-relevance.ts). `lastPublicActivityAt` is no longer an ordering key
 * anywhere.
 *
 * Material activity is NOT bounded by `lastPublicActivityAt`. Pipeline
 * entries are stamped with the re-projection's `lastPublicActivityAt`, but
 * enforcement-derived classification entries carry FDA's own classification
 * date, and enforcement records are never voiced into `lastPublicActivityAt`
 * — so a classification can, and routinely does, postdate it (live,
 * 2026-10-05: 232 of 911 active cases). Earlier versions of this comment
 * claimed the opposite; nothing may rely on that ordering.
 */

import type { TimelineEntry } from './recall-types';

/**
 * Source dates are day-precision at both agencies ("2026-08-04"); comparing
 * the day alone keeps a plain string comparison total and correct even if a
 * source ever supplies a fuller timestamp.
 */
function day(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * The latest authoritative event date for a case, as `YYYY-MM-DD`.
 * Always ≥ the announcement date; see the header for why it may exceed
 * `lastPublicActivityAt`.
 */
export function materialActivityAt(
  publishedAt: string,
  timeline: readonly TimelineEntry[] | null | undefined,
): string {
  let latest = day(publishedAt);
  for (const entry of timeline ?? []) {
    if (!entry.material) continue;
    const occurred = day(entry.occurredAt);
    if (occurred > latest) latest = occurred;
  }
  return latest;
}

/**
 * True when an authoritative event postdates the original announcement — the
 * condition under which a card may honestly say "Updated <date>" rather than
 * only "Announced <date>".
 */
export function hasMaterialUpdate(
  publishedAt: string,
  timeline: readonly TimelineEntry[] | null | undefined,
): boolean {
  return materialActivityAt(publishedAt, timeline) > day(publishedAt);
}
