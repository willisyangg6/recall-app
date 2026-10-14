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
 * morning. No exemptions: retractions are held too.
 *
 * Public wording describes SENDING, never arrival (Terms §6).
 */

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
