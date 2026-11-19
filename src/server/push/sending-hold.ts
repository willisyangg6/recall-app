/**
 * The overnight sending hold (founder decision D1, approved 2026-10-14):
 * Lotly sends no alert while it is 22:00–09:59 in America/New_York. An alert
 * that becomes due in those hours is sent by the first push run after 10:00
 * New York time.
 *
 * Time zone, not offset: the hour is read in the IANA zone America/New_York,
 * so daylight saving is handled by the zone database itself. In UTC the hold
 * is 02:00–13:59 during daylight time and 03:00–14:59 during standard time.
 * On the night the clocks change, both 01:xx hours fall inside the hold.
 *
 * What it changes: only WHEN a queued delivery is handed to Expo. Matching,
 * horizons, the entitlement gate and every other eligibility rule decide
 * exactly as before, and deliveries are still created during the hold. A held
 * row stays queued and is judged again at the send (including the clock
 * gate), so an alert whose subscription expired overnight is not sent in the
 * morning. Under the default scope, `all`, there are no exemptions:
 * retractions are held too. The opt-in scope below is the only exception.
 *
 * Public wording describes SENDING, never arrival (Terms §6).
 */

import { lateAnnouncementDate } from './format';

export const HOLD_TIME_ZONE = 'America/New_York';
/** First held hour, inclusive (22:00). */
export const HOLD_START_HOUR = 22;
/** First sending hour after the hold (10:00). */
export const HOLD_END_HOUR = 10;

const hourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: HOLD_TIME_ZONE,
  hour: 'numeric',
  hourCycle: 'h23',
});

/** The hour (0–23) in New York at `instant`. */
export function newYorkHour(instant: Date): number {
  const hour = Number(hourFormat.format(instant));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    // Never guess: an unreadable clock holds (fail closed).
    return HOLD_START_HOUR;
  }
  return hour;
}

/** True while sending is held: 22:00–09:59 New York time. */
export function isSendingHeld(instant: Date): boolean {
  const hour = newYorkHour(instant);
  return hour >= HOLD_START_HOUR || hour < HOLD_END_HOUR;
}

// ── Hold scope (alert timing, 2026-11-19; proposed, off until the founder sets it) ──
//
// The proposed product policy: new matching recall alerts are sent without
// the blanket overnight delay. `except_new_recalls` implements exactly that
// and nothing wider. During the hold hours, a due delivery is sent at once
// only when ALL of these are true; everything else waits for 10:00 as before:
//
// 1. Its event is a new-recall alert (`initial`). Updates, classifications
//    and retractions stay held: the weekly openFDA reconcile emits a batch of
//    "classified" updates on weeks-old recalls, and its 09:15 UTC schedule
//    (04:15–05:15 New York) falls inside the hold.
// 2. The agency announced it within the late-alert window: fewer than
//    LATE_ALERT_DAYS New York calendar days before the send (format.ts), with
//    a readable date. An older recall Lotly has only just found is not urgent
//    and gets the dated wording in the morning.
// 3. Its event was ledgered within OVERNIGHT_FRESH_HOURS of the send. A row
//    that has waited longer (provider or entitlement backlog, retries) is
//    released in the morning, so recovering from an outage at night can never
//    release a backlog at 3 a.m.
//
// Unset, empty or unrecognized settings keep the D1 rule (`all`): a typo can
// never widen overnight sending. Nothing else about eligibility changes.

export type SendingHoldScope = 'all' | 'except_new_recalls';

/** Name of the repository variable the push steps pass through. */
export const SENDING_HOLD_SCOPE_ENV = 'PUSH_OVERNIGHT_HOLD';

/** A queued row older than this is never sent during the hold. */
export const OVERNIGHT_FRESH_HOURS = 12;

export function sendingHoldScopeFromEnv(env: Record<string, string | undefined>): SendingHoldScope {
  return env[SENDING_HOLD_SCOPE_ENV]?.trim() === 'except_new_recalls'
    ? 'except_new_recalls'
    : 'all';
}

/** The event facts the exemption reads (a DeliverableEvent satisfies it). */
export interface HoldExemptionEvent {
  kind: string;
  createdAt: string;
  projection: { publishedAt: string };
}

/** True when this event's due delivery may be sent during the hold hours. */
export function sendsDuringHold(
  scope: SendingHoldScope,
  event: HoldExemptionEvent,
  instant: Date,
): boolean {
  if (scope !== 'except_new_recalls') return false;
  if (event.kind !== 'initial') return false;
  const published = event.projection.publishedAt ?? '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(published)) return false; // unreadable: hold
  if (lateAnnouncementDate(published, instant.toISOString()) !== null) return false;
  const ledgered = new Date(event.createdAt).getTime();
  if (Number.isNaN(ledgered)) return false;
  const age = instant.getTime() - ledgered;
  return age >= 0 && age <= OVERNIGHT_FRESH_HOURS * 3_600_000;
}
