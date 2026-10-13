/**
 * Privacy-rights requests (2026-10-13, proposal §3): the shared, pure part.
 *
 * Two routes, one module of words and shapes:
 *
 *   - "Show what Lotly's server holds": the app reads this installation's
 *     server rows through `export_installation_data` and shows them, and can
 *     share them as a JSON file. The same document is what the operator
 *     emails in reply to an email request for a copy
 *     (scripts/privacy-request.ts), so both carry `buildExportDocument`.
 *   - "Get a request code": the app asks the server for a one-time code for
 *     ONE purpose, a copy of the data or its deletion, and shows it once.
 *     The server keeps only the code's SHA-256; the code itself lives in the
 *     create call's response and on screen, and is never stored or logged
 *     on the device.
 *
 * Pure and dependency-free, so the screens, the operator CLI and the tests
 * all read the same contract. The migration (20261016000000) is the other
 * half: the alphabet, the length and the 14 days are pinned against it.
 */

import { allergenLabelForToken } from '@/domain/preferences';
import { retailerById } from '@/domain/retailer-catalog';

/** Crockford base 32: digits and letters without I, L, O and U. */
export const REQUEST_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const REQUEST_CODE_LENGTH = 12;
export const REQUEST_CODE_LIFETIME_DAYS = 14;
export const SUPPORT_EMAIL = 'lotlysupport@gmail.com';

export type RequestPurpose = 'access' | 'delete';

/**
 * A code as a person might type or paste it, reduced to its canonical form,
 * or null when it cannot be a code. Spaces and hyphens are ignored, case is
 * ignored, and the letters Crockford reads as digits (O as 0, I and L as 1)
 * are accepted, so a code read aloud or retyped from an email still matches.
 */
export function normalizeRequestCode(input: string): string | null {
  const reduced = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (reduced.length !== REQUEST_CODE_LENGTH) return null;
  for (const character of reduced) {
    if (!REQUEST_CODE_ALPHABET.includes(character)) return null;
  }
  return reduced;
}

/** Shown in three groups of four, the way it is easiest to read and type. */
export function formatRequestCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

// ── Copy ────────────────────────────────────────────────────────────────────

export const SERVER_DATA_ACTION_LABEL = 'Show what Lotly’s server holds';
export const REQUEST_CODE_ACTION_LABEL = 'Get a request code';
export const PRIVACY_REQUESTS_HEADING = 'Your data';
export const PRIVACY_REQUESTS_SUPPORTING_COPY =
  'See everything Lotly’s server keeps for this installation, or get a code to ask by ' +
  'email for a copy of your data or for its deletion.';

export const SERVER_DATA_SCREEN_TITLE = 'Server Data';
export const SERVER_DATA_INTRO =
  'This is everything Lotly’s server holds for this installation, read just now. ' +
  'Your saved recalls, search text and other choices kept only on this iPhone are not ' +
  'listed, because the server does not have them.';
/**
 * The one public statement of timing (2026-10-13), checked against every
 * request type in the laws Lotly is built to follow (WA RCW 19.373.040, NV
 * NRS 603A.510–.520, CT CGS 42-518). Each clause is the strictest of them:
 * an answer within 45 days of RECEIPT (WA and CT count from receipt; NV from
 * authentication, which is later); deletion within 30 days of checking the
 * code (NV 603A.515), which has no extension; for other requests one
 * extension of at most 45 days, explained inside the first 45 (all three). Shorter clocks for other request types (CT: stop using data after
 * consent is withdrawn within 15 days) and the appeal clocks are in the
 * operator runbook, docs/recall-operations.md, "Request deadlines".
 */
export const REQUEST_TIMING_COPY =
  'Lotly answers within 45 days of receiving your request, and deletes within 30 days of ' +
  'checking your code (usually the same day); a deletion is never extended. If another ' +
  'request needs more time, Lotly can extend it once, by up to 45 more days, and tells you ' +
  'why within the first 45 days.';

export const SERVER_DATA_REDACTION_NOTE =
  'Left out on purpose: the installation identifier, which works like a password for this ' +
  'data, and all but the last four characters of the delivery token. To ask for anything ' +
  'not listed here, get a request code for a copy of your data and say what you want when ' +
  `you email ${SUPPORT_EMAIL}.`;
export const SERVER_DATA_EMPTY = 'Lotly’s server holds nothing for this installation.';
export const SERVER_DATA_FAILURE =
  'Lotly’s server could not be reached. Check your connection and try again.';
export const SERVER_DATA_RETRY_LABEL = 'Try again';
export const SERVER_DATA_SHARE_LABEL = 'Share as file';
export const SERVER_DATA_SHARE_FAILURE = 'The file could not be shared. Try again.';
export const SERVER_DATA_LOADING_LABEL = 'Reading';

export const REQUEST_CODE_SCREEN_TITLE = 'Request Code';
export const REQUEST_CODE_INTRO =
  'You can see your data and delete it right here in the app. If you would rather ask ' +
  'us by email, create a code for one request and send it to ' +
  `${SUPPORT_EMAIL}. The code lets us find this installation for that request only.`;
export const REQUEST_CODE_PURPOSE_QUESTION = 'What would you like?';
export const REQUEST_PURPOSE_LABEL: Record<RequestPurpose, string> = {
  access: 'Email me a copy of my data',
  delete: 'Delete my data',
};
export const REQUEST_CODE_CREATE_LABEL = 'Create code';
export const REQUEST_CODE_CREATING_LABEL = 'Creating';
export const REQUEST_CODE_EMAIL_LABEL = 'Email the code';
export const REQUEST_CODE_FAILURE =
  'A code could not be created. Check your connection and try again.';
export const REQUEST_CODE_NO_MAIL_APP = `No email app is set up on this iPhone. Copy the code (touch and hold it) and email it to ${SUPPORT_EMAIL}.`;
export const REQUEST_CODE_NOTHING_HELD =
  'Lotly’s server holds nothing for this installation yet, so there is nothing to request.';
export const REQUEST_CODE_FACTS = [
  `It works once and expires after ${REQUEST_CODE_LIFETIME_DAYS} days.`,
  'It cannot change anything by itself. We use it only to find this installation for the request you chose.',
  'Lotly keeps only a scrambled form of it, so we cannot show it to you again. Leaving this screen hides it; you can always create a new one.',
  'We will never ask for your installation identifier. Do not send it.',
] as const;

export function requestCodeShownCopy(purpose: RequestPurpose, expiresAt: string): string {
  const what = purpose === 'access' ? 'a copy of your data' : 'deletion of your data';
  return `Your code for ${what}. Send it to ${SUPPORT_EMAIL} before ${formatDate(expiresAt)}.`;
}

/** The email the "Email the code" button opens, ready to send. */
export function requestEmailUrl(purpose: RequestPurpose, code: string): string {
  const subject =
    purpose === 'access' ? 'Lotly data request: a copy' : 'Lotly data request: deletion';
  const body =
    `Request code: ${formatRequestCode(code)}\n` +
    `Request: ${purpose === 'access' ? 'Email me a copy of my data' : 'Delete my data'}\n`;
  return (
    `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}

// ── The server's answer ─────────────────────────────────────────────────────

/** `export_installation_data`'s JSON, as far as the app reads it. */
export interface ServerDataExport {
  exported_at: string;
  preferences: Record<string, unknown> | null;
  push_registrations: Record<string, unknown>[];
  alert_order: Record<string, unknown> | null;
  alerts_sent: Record<string, unknown>[];
  last_opened_on: string | null;
  shopper_reports: Record<string, unknown>[];
  request_codes: Record<string, unknown>[];
}

export function parseServerDataExport(body: unknown): ServerDataExport | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const list = (value: unknown) =>
    Array.isArray(value) ? (value as Record<string, unknown>[]) : null;
  const object = (value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const registrations = list(record.push_registrations);
  const sent = list(record.alerts_sent);
  const reports = list(record.shopper_reports);
  const codes = list(record.request_codes);
  if (typeof record.exported_at !== 'string' || !registrations || !sent || !reports || !codes) {
    return null;
  }
  return {
    exported_at: record.exported_at,
    preferences: object(record.preferences),
    push_registrations: registrations,
    alert_order: object(record.alert_order),
    alerts_sent: sent,
    last_opened_on: typeof record.last_opened_on === 'string' ? record.last_opened_on : null,
    shopper_reports: reports,
    request_codes: codes,
  };
}

export function serverHoldsNothing(data: ServerDataExport): boolean {
  return (
    data.preferences === null &&
    data.push_registrations.length === 0 &&
    data.alert_order === null &&
    data.alerts_sent.length === 0 &&
    data.last_opened_on === null &&
    data.shopper_reports.length === 0 &&
    data.request_codes.length === 0
  );
}

/** One titled group of plain-language lines on the Server Data screen. */
export interface ServerDataSection {
  title: string;
  lines: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function listOrNone(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'None';
}

/** A date for people: 12 Oct 2026, in UTC so it never shifts a day. */
export function formatDate(iso: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function dateOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? formatDate(value) : null;
}

/**
 * The export as plain-language sections. Every row the server returned is
 * represented: each group appears whether it holds something or not, so
 * "None" is a statement about the server, not an omission of the screen.
 */
export function serverDataSections(data: ServerDataExport): ServerDataSection[] {
  const prefs = data.preferences;
  const preferenceLines = prefs
    ? [
        `States: ${listOrNone(strings(prefs.state_codes))}`,
        `Allergens: ${listOrNone(strings(prefs.allergens).map(allergenLabelForToken))}`,
        `Stores: ${listOrNone(strings(prefs.retailer_ids).map((id) => retailerById(id)?.name ?? id))}`,
        ...(typeof prefs.allergen_consent_version === 'string'
          ? [
              `Allergen alerts consent: given${
                dateOf(prefs.allergen_consent_at) ? ` on ${dateOf(prefs.allergen_consent_at)}` : ''
              }`,
            ]
          : []),
        ...(dateOf(prefs.updated_at) ? [`Last changed: ${dateOf(prefs.updated_at)}`] : []),
      ]
    : ['None'];

  const registrationLines =
    data.push_registrations.length > 0
      ? data.push_registrations.flatMap((registration) => [
          `${registration.enabled === true ? 'On' : 'Off'}, ${
            registration.platform === 'android' ? 'Android' : 'iPhone'
          }${typeof registration.app_version === 'string' ? `, app ${registration.app_version}` : ''}`,
          `Delivery token ending ${String(registration.push_token ?? '').replace('…', '')}`,
          ...(dateOf(registration.enabled_at)
            ? [`Turned on: ${dateOf(registration.enabled_at)}`]
            : []),
          ...(dateOf(registration.last_seen_at)
            ? [`Last refreshed: ${dateOf(registration.last_seen_at)}`]
            : []),
          ...(dateOf(registration.disabled_at)
            ? [`Turned off: ${dateOf(registration.disabled_at)}`]
            : []),
        ])
      : ['None'];

  const sentLines =
    data.alerts_sent.length > 0
      ? [
          `${data.alerts_sent.length} ${data.alerts_sent.length === 1 ? 'alert' : 'alerts'}`,
          ...data.alerts_sent
            .map((alert) => dateOf(alert.created_at))
            .filter((date): date is string => date !== null)
            .map((date) => `Sent ${date}`),
        ]
      : ['None'];

  const reportLines =
    data.shopper_reports.length > 0
      ? data.shopper_reports.map(
          (report) =>
            `${typeof report.state_code === 'string' ? report.state_code : 'A state'}` +
            `${typeof report.retailer_name === 'string' ? `, ${report.retailer_name}` : ''}` +
            `${dateOf(report.updated_at) ? `, ${dateOf(report.updated_at)}` : ''}`,
        )
      : ['None'];

  const codeLines =
    data.request_codes.length > 0
      ? data.request_codes.map((code) => {
          const what = code.purpose === 'delete' ? 'Deletion' : 'Copy of data';
          const state =
            typeof code.used_at === 'string'
              ? `used ${dateOf(code.used_at)}`
              : `expires ${dateOf(code.expires_at) ?? ''}`.trim();
          return `${what}, ${state}`;
        })
      : ['None'];

  return [
    { title: 'Your choices', lines: preferenceLines },
    { title: 'Recall alerts registration', lines: registrationLines },
    { title: 'Alerts sent', lines: sentLines },
    {
      title: 'Last opened',
      lines: [data.last_opened_on ? formatDate(data.last_opened_on) : 'None'],
    },
    { title: 'Shopper reports', lines: reportLines },
    { title: 'Request codes', lines: codeLines },
  ];
}

// ── The export document ─────────────────────────────────────────────────────

/**
 * Who processes Lotly's data, each with its own privacy policy and the
 * privacy contact route that policy names (Washington's My Health My Data
 * Act asks for processors to be named with contact routes). Mirrors the
 * provider table in docs/recall-privacy-policy-draft.md; the website host is
 * left out because it never receives installation data.
 *
 * Every URL and contact was checked against the provider's own published
 * policy on 2026-10-13 (HTTP 200, the policy names the route):
 *   Supabase    privacy policy names privacy@supabase.com
 *   Expo        policy (updated 2025-10-21) sends questions to its contact form
 *   Apple       Customer Privacy Policy links "Contact Privacy"
 *   RevenueCat  policy (updated June 2026) names compliance@revenuecat.com
 *   Google      policy (effective 2026-10-01) links its privacy contact page
 */
export const PROCESSORS_VERIFIED_ON = '2026-10-13';
export const DATA_PROCESSORS = [
  {
    name: 'Supabase',
    role: 'Database and image hosting: stores everything in server_data',
    privacy: 'https://supabase.com/privacy',
    contact: 'privacy@supabase.com',
  },
  {
    name: 'Expo',
    role: 'Push service: receives the delivery token and alert text to deliver alerts',
    privacy: 'https://expo.dev/privacy',
    contact: 'https://expo.dev/contact',
  },
  {
    name: 'Apple',
    role: 'App Store purchases, and the push notification service that delivers alerts',
    privacy: 'https://www.apple.com/legal/privacy/',
    contact: 'https://www.apple.com/legal/privacy/contact/',
  },
  {
    name: 'RevenueCat',
    role: 'Checks and restores subscriptions under a separate purchase identifier',
    privacy: 'https://www.revenuecat.com/privacy',
    contact: 'compliance@revenuecat.com',
  },
  {
    name: 'Google (Gmail)',
    // Lotly is iPhone-only: Google's notification service (FCM) is not used,
    // and the app sends Google nothing. Gmail hosts the support mailbox, so
    // it processes data only when someone emails Lotly.
    role:
      `Hosts Lotly’s support mailbox (${SUPPORT_EMAIL}). Only if you email Lotly: it holds ` +
      'your email address, your messages and any request code you send. The app sends Google nothing.',
    privacy: 'https://policies.google.com/privacy',
    contact: 'https://support.google.com/policies/answer/9581826',
  },
] as const;

/**
 * The approved export fields, group by group (2026-10-13). This is the same
 * explicit list `export_installation_data` builds (migration 20261016000000):
 * a database column is exported only once it is named in both places, so a
 * column a later migration adds (an internal hash, an age or consent-
 * revocation key) never reaches an export by accident. The migration test
 * holds the two lists equal, and the live test proves a new column stays out.
 */
export const EXPORT_FIELDS = {
  preferences: [
    'state_codes',
    'allergens',
    'retailer_ids',
    'allergen_consent_version',
    'allergen_consent_at',
    'allergen_consent_decided_at',
    'created_at',
    'updated_at',
  ],
  push_registrations: [
    'platform',
    'app_version',
    'enabled',
    'enabled_at',
    'registered_at',
    'last_seen_at',
    'disabled_at',
    'disabled_reason',
    'push_token',
    'last_token_error',
  ],
  alert_order: ['last_sequence', 'last_operation', 'updated_at'],
  alerts_sent: ['recall_id', 'kind', 'created_at', 'sent_at', 'status', 'failure_code'],
  shopper_reports: [
    'recall_id',
    'state_code',
    'retailer_name',
    'purchase_window',
    'created_at',
    'updated_at',
  ],
  request_codes: ['purpose', 'created_at', 'expires_at', 'used_at'],
} as const;

/**
 * What the export deliberately leaves out of the server's own rows, and why,
 * in plain language. The first two are credentials, not information about
 * the person: anyone holding the installation identifier can read and delete
 * this installation's data, and the full push token lets anyone with Expo
 * access send this iPhone a notification. Neither is ever shown, shared or
 * emailed, including in answer to a request. The rest are Lotly's own
 * check values and bookkeeping, which say nothing new about the person.
 */
export const EXPORT_REDACTIONS = [
  'The installation identifier, the random number that ties these records together, is left out everywhere. It works like a password for this data, so Lotly never shows, shares or emails it.',
  'The push delivery token is shortened to its last four characters, in its own field and inside any stored delivery error, because the full token can be used to send this iPhone notifications.',
  'Request codes are listed by what they are for and their dates. The code itself is never stored: Lotly keeps only a scrambled form of it, used only to check a code you send, which cannot be turned back into the code. That scrambled form is left out.',
  'Lotly’s internal bookkeeping is left out: row numbers that link its tables, an edit counter on shopper reports, an older one-state copy of the first state in your list, and an account field that is never filled in. None of it says anything new about you.',
] as const;

/** Personal data that exists but is not in this file, and where it is. */
export const EXPORT_NOT_INCLUDED = [
  'What is kept only on this iPhone: your choices as the app holds them, saved recalls, the alerts setting and setup progress. Lotly’s server does not have them; you can see them in the app.',
  'Connection logs at Lotly’s hosting providers (such as IP addresses), kept under each provider’s own settings; Lotly’s database host keeps them for 7 days.',
  'Subscription records held by Apple and RevenueCat, under a separate purchase identifier.',
  `Emails you sent to ${SUPPORT_EMAIL}, and Lotly’s replies.`,
] as const;

export const EXPORT_REQUEST_MORE =
  `To ask for any of the data listed under not_included, or anything else you think Lotly holds about you, ` +
  `email ${SUPPORT_EMAIL}. In the app, get a request code for a copy of your data (Privacy & Data Controls, ` +
  'Your data, Get a request code) and include it, and say what you are asking for. ' +
  `${REQUEST_TIMING_COPY} ` +
  'Lotly will still not send the installation identifier or the full push token, for the reasons above.';

export const EXPORT_FORMAT = 'lotly-server-data/2';

/** The file shared from the app and emailed by the operator: one shape. */
export function buildExportDocument(data: ServerDataExport) {
  return {
    format: EXPORT_FORMAT,
    about:
      'Everything Lotly’s server held for one app installation when this file was made, ' +
      'except what is listed under redactions.',
    redactions: EXPORT_REDACTIONS,
    not_included: EXPORT_NOT_INCLUDED,
    requesting_more: EXPORT_REQUEST_MORE,
    contact: SUPPORT_EMAIL,
    processors: DATA_PROCESSORS,
    processors_checked_on: PROCESSORS_VERIFIED_ON,
    server_data: data,
  };
}

/** The shared file's name: no identifier, only the date it was read. */
export function exportFileName(data: ServerDataExport): string {
  return `lotly-server-data-${data.exported_at.slice(0, 10)}.json`;
}
