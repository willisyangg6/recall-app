/**
 * Allergen consent (2026-10-13) — the pure part: the record kept on this
 * device, what the server may be sent, when to ask, and the exact copy.
 *
 * ## The rule
 *
 * Allergens always work ON THIS iPHONE (Affects Me, labels): they are read
 * from local preferences and never depend on consent. Lotly's SERVER
 * receives them only when the shopper chose "Use for alerts" under the
 * current consent text (`ALLERGEN_CONSENT_VERSION`). Otherwise every mirror
 * sends no allergens and no consent version, and the server keeps none
 * (supabase/migrations/20261014000000_allergen_consent.sql enforces the same
 * rule for every client, including older ones).
 *
 * ## The two choices are equal
 *
 * Neither is pre-selected, both have the same weight, and declining changes
 * nothing about the app except which alerts can be sent. The consent is
 * asked separately from the Terms and is never bundled with another action.
 *
 * ## What declining changes, exactly
 *
 * The push worker runs the same relevance rules; it is simply not given the
 * allergens. So recalls that qualify ONLY through an allergen match send no
 * alert: every allergen-only recall, and a recall with no stated
 * distribution that matches only an allergen. A profile whose only choices
 * are allergens receives no alerts at all.
 */

/** The consent text version the server accepts (apply_installation_preferences). */
export const ALLERGEN_CONSENT_VERSION = 'allergens-v1';

export type AllergenConsentDecision = 'granted' | 'declined' | 'withdrawn';

export interface AllergenConsentRecord {
  decision: AllergenConsentDecision;
  /** The consent text the decision was made under. */
  version: string;
  /** ISO time of the decision. */
  at: string;
}

/** Parse a stored record; anything unreadable is "no decision". */
export function parseAllergenConsent(raw: string | null): AllergenConsentRecord | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<AllergenConsentRecord>;
    if (
      (value.decision === 'granted' ||
        value.decision === 'declined' ||
        value.decision === 'withdrawn') &&
      typeof value.version === 'string' &&
      typeof value.at === 'string'
    ) {
      return { decision: value.decision, version: value.version, at: value.at };
    }
  } catch {
    // Fall through: an unreadable record is no decision, never consent.
  }
  return null;
}

/**
 * The time to record for a new decision: now, but strictly after the
 * previous decision's time. The server keeps the decision with the latest
 * time, so a device clock moved backwards must never make a newer withdrawal
 * look older than the grant it replaces.
 */
export function nextDecisionTime(prior: AllergenConsentRecord | null, now: Date): string {
  const priorMs = prior ? Date.parse(prior.at) : Number.NaN;
  const ms = Number.isFinite(priorMs) && priorMs >= now.getTime() ? priorMs + 1 : now.getTime();
  return new Date(ms).toISOString();
}

export function serializeAllergenConsent(record: AllergenConsentRecord): string {
  return JSON.stringify(record);
}

/**
 * The consent version to send with a mirror, or null. Consent counts only
 * when it was granted under the CURRENT text: a grant under an older text is
 * not consent to the current one.
 */
export function serverAllergenConsent(record: AllergenConsentRecord | null): string | null {
  return record?.decision === 'granted' && record.version === ALLERGEN_CONSENT_VERSION
    ? ALLERGEN_CONSENT_VERSION
    : null;
}

/** The allergens a mirror may carry: the chosen ones with consent, none without. */
export function allergensForServer(
  allergens: readonly string[],
  record: AllergenConsentRecord | null,
): string[] {
  return serverAllergenConsent(record) === null ? [] : [...allergens];
}

/**
 * Whether to ask: allergens are chosen and the shopper has not decided under
 * the current text. A decline or a withdrawal is respected — Lotly never
 * re-asks on its own; the shopper can opt in from Privacy & Data Controls.
 */
export function shouldAskAllergenConsent(
  allergens: readonly string[],
  record: AllergenConsentRecord | null,
): boolean {
  if (allergens.length === 0) return false;
  if (record === null) return true;
  return record.decision === 'granted' && record.version !== ALLERGEN_CONSENT_VERSION;
}

/**
 * Edit preferences asks only when THIS save makes consent newly needed: it
 * adds an allergen that was not chosen before the edit, and no decision is
 * recorded. A save that adds none — including a later save after the sheet
 * was closed without answering — never asks again.
 */
export function consentNewlyNeededBySave(
  before: readonly string[],
  after: readonly string[],
  record: AllergenConsentRecord | null,
): boolean {
  if (!shouldAskAllergenConsent(after, record)) return false;
  return after.some((token) => !before.includes(token));
}

/** Allergens are the shopper's ONLY alert signal (no states, no stores). */
export function allergensAreOnlyAlertChoice(prefs: {
  states: readonly string[];
  allergens: readonly string[];
  retailers: readonly string[];
}): boolean {
  return prefs.allergens.length > 0 && prefs.states.length === 0 && prefs.retailers.length === 0;
}

// ── Copy (founder review; a tested contract) ────────────────────────────────

export const CONSENT_TITLE = 'Use your allergens for recall alerts?';

export const CONSENT_PARAGRAPHS: readonly string[] = [
  'Lotly can keep the allergens you chose on its server so it can send you alerts for recalls that involve them.',
  'They’re stored with a random identifier, never your name, on Lotly’s server (Supabase, in Northern California). Alerts are delivered through Expo and Apple and contain only public recall details.',
  'Lotly never uses them for ads and never sells them. You can turn this off at any time in Profile → Privacy & Data Controls, and Lotly removes its server copy as soon as your iPhone is online.',
  'If you keep them on this iPhone only, Lotly still uses them here to show which recalls may matter to you, but it won’t send alerts for recalls that only an allergen match would qualify, like allergen-only recalls.',
];

/** Shown only when allergens are the shopper's only alert choice. */
export const CONSENT_ONLY_CHOICE_NOTE =
  'Right now your allergens are your only alert choice. Without this, Lotly won’t send you recall alerts unless you also choose states or stores.';

export const CONSENT_GRANT_LABEL = 'Use for alerts';
export const CONSENT_DECLINE_LABEL = 'Keep on this iPhone only';
export const CONSENT_PRIVACY_LINK_LABEL = 'Privacy & Data Controls';

// Privacy & Data Controls status card.
export const CONSENT_STATUS_TITLE = 'Allergens and alerts';
export const CONSENT_STATUS_GRANTED =
  'Your allergens are used for recall alerts and kept on Lotly’s server.';
export const CONSENT_STATUS_NOT_GRANTED =
  'Your allergens stay on this iPhone. Lotly’s server doesn’t have them, and alerts don’t use them.';
/** Withdrawal recorded on this iPhone, server not yet told (offline). */
export const CONSENT_STATUS_WITHDRAW_PENDING =
  'Your allergens stay on this iPhone. Removing them from Lotly’s server will finish when your iPhone is back online.';
/** Consent recorded on this iPhone, server not yet told (offline). */
export const CONSENT_STATUS_GRANT_PENDING =
  'Your allergens will be used for recall alerts once your iPhone is back online and Lotly’s server receives them.';
export const CONSENT_WITHDRAW_LABEL = 'Stop using allergens for alerts';
export const CONSENT_OPT_IN_LABEL = 'Use allergens for alerts';

// Notifications screen.
export const CONSENT_NOTIFICATIONS_NOTE =
  'Your allergens stay on this iPhone, so allergen-only recalls don’t send alerts. You can change this in Profile → Privacy & Data Controls.';

/**
 * The Privacy & Data Controls status line. While the server has not
 * confirmed the newest decision (`pending`), it never claims the server's
 * state: a withdrawal says removal will finish once the iPhone is online.
 */
export function consentStatusLine(granted: boolean, pending: boolean): string {
  if (granted) return pending ? CONSENT_STATUS_GRANT_PENDING : CONSENT_STATUS_GRANTED;
  return pending ? CONSENT_STATUS_WITHDRAW_PENDING : CONSENT_STATUS_NOT_GRANTED;
}
