/**
 * Confirmed-open evidence (2026-10-06): when an agency affirmatively shows a
 * recall is still open, so Affects You may count a match older than the
 * 60-day window. A leaf module — no server imports — read by the Affects-me
 * sections (and through them Building and Ready) and by the baseline recorder.
 *
 * Two sources, and nothing else:
 *
 *   - FSIS: a recall (not a Public Health Alert) whose lifecycle is active.
 *     FSIS's own `field_recall_type` is `Active Recall` — `Closed Recall`
 *     becomes `closed` and leaves the feed, PHAs carry their own notice type —
 *     re-read every 30 minutes by the heartbeat-monitored FSIS ingest. FSIS
 *     alerts have no closure mechanism, so they never qualify by age.
 *   - FDA: `fdaOngoingAsOf`, the openFDA export date on which at least one of
 *     the case's accepted, linked enforcement products was `Ongoing`
 *     (server: src/server/fda-enforcement/open-evidence.ts). Lifecycle is
 *     never used for FDA: Lotly has no FDA closure signal, so `active` there
 *     means only "not recorded as closed".
 *
 * Evidence expiry is evaluated HERE, on the device, against the same clock
 * as the 60-day window: FDA evidence counts while its export date is at most
 * `OPEN_EVIDENCE_MAX_AGE_DAYS` old. The weekly refresh normally moves it
 * every 7 days; if refreshes stop, devices stop counting it on their own, with
 * no server involved. The recall itself is never hidden — it moves to Older
 * notices. Nothing here is ever shown to a shopper (no freshness copy).
 */

import type { FeedItem } from './recall-feed';

/** FDA evidence older than this stops counting (two missed weekly exports plus slack). */
export const OPEN_EVIDENCE_MAX_AGE_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The facts the rule reads — FeedItem satisfies it. */
export type OpenEvidenceInput = Pick<
  FeedItem,
  'sourceAgency' | 'noticeType' | 'state' | 'fdaOngoingAsOf'
>;

/**
 * The strict reader for the stored column: a calendar date `YYYY-MM-DD` that
 * is a real date, else null. A malformed value can never confirm anything.
 */
export function readFdaOngoingAsOf(raw: unknown): string | null {
  if (typeof raw !== 'string' || !ISO_DATE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? null : raw;
}

/**
 * Whether FDA evidence dated `asOf` still counts at `now`. Same convention as
 * the 60-day window (`tierForActivityDate`): the date is midnight UTC and the
 * age is measured in milliseconds. A future date (a clock behind) counts.
 */
export function fdaEvidenceCurrent(asOf: string, now: Date): boolean {
  const ageMs = now.getTime() - new Date(`${asOf}T00:00:00Z`).getTime();
  return ageMs <= OPEN_EVIDENCE_MAX_AGE_DAYS * DAY_MS;
}

export function fsisConfirmedOpen(
  item: Pick<OpenEvidenceInput, 'sourceAgency' | 'noticeType' | 'state'>,
): boolean {
  return item.sourceAgency === 'FSIS' && item.noticeType === 'recall' && item.state === 'active';
}

/**
 * Agency evidence that this recall is still open, as of `now`. Membership
 * only: never a label, never an order, never push.
 */
export function confirmedOpen(item: OpenEvidenceInput, now: Date): boolean {
  if (fsisConfirmedOpen(item)) return true;
  if (item.sourceAgency !== 'FDA' || item.fdaOngoingAsOf === null) return false;
  return fdaEvidenceCurrent(item.fdaOngoingAsOf, now);
}
