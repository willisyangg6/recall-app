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
 * leave the active feed anyway), and anything our own maintenance writes,
 * which never append a timeline entry at all.
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
 * Always ≥ the announcement date, and never later than
 * `lastPublicActivityAt` (every material entry is stamped with the
 * source-published activity date of the re-projection that created it).
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
