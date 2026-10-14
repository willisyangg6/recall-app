/**
 * Privacy requests (2026-10-13): the shared contract between the app, the
 * operator CLI and the migration. The behaviour on a real database is in
 * src/server/push/privacy-requests-live.test.ts.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildExportDocument,
  DATA_PROCESSORS,
  EXPORT_FIELDS,
  exportFileName,
  formatRequestCode,
  normalizeRequestCode,
  parseServerDataExport,
  REQUEST_CODE_ALPHABET,
  REQUEST_CODE_FACTS,
  REQUEST_CODE_INTRO,
  REQUEST_CODE_LENGTH,
  REQUEST_CODE_LIFETIME_DAYS,
  REQUEST_TIMING_COPY,
  requestCodeShownCopy,
  requestEmailUrl,
  serverDataSections,
  serverHoldsNothing,
  SUPPORT_EMAIL,
  type ServerDataExport,
} from './privacy-requests';
import * as copy from './privacy-requests';
import { documentPlainText } from '@/content/document-model';
import { documentBySlug } from '@/content';

const MIGRATION = readFileSync(
  join(__dirname, '..', '..', 'supabase', 'migrations', '20261016000000_privacy_requests.sql'),
  'utf8',
);

const EMPTY: ServerDataExport = {
  exported_at: '2026-10-13T17:00:00.000Z',
  preferences: null,
  push_registrations: [],
  alert_order: null,
  alerts_sent: [],
  last_opened_on: null,
  shopper_reports: [],
  request_codes: [],
};

const FULL: ServerDataExport = {
  exported_at: '2026-10-13T17:00:00.000Z',
  preferences: {
    state_codes: ['CA', 'NY'],
    allergens: ['peanut', 'sesame'],
    retailer_ids: ['walmart'],
    updated_at: '2026-10-12T08:00:00Z',
  },
  push_registrations: [
    {
      platform: 'ios',
      app_version: '1.0.0',
      enabled: true,
      enabled_at: '2026-10-01T00:00:00Z',
      last_seen_at: '2026-10-12T00:00:00Z',
      push_token: '…wxyz',
    },
  ],
  alert_order: { last_sequence: 3, last_operation: 'register' },
  alerts_sent: [{ created_at: '2026-10-05T10:00:00Z', recall_id: 'r1', status: 'receipt_ok' }],
  last_opened_on: '2026-10-13',
  shopper_reports: [
    { state_code: 'CA', retailer_name: 'Walmart', updated_at: '2026-10-02T00:00:00Z' },
  ],
  request_codes: [{ purpose: 'access', expires_at: '2026-10-27T00:00:00Z', used_at: null }],
};

test('the code contract matches the migration: alphabet, length, lifetime', () => {
  assert.equal(REQUEST_CODE_ALPHABET.length, 32);
  assert.equal(new Set(REQUEST_CODE_ALPHABET).size, 32);
  assert.ok(MIGRATION.includes(`v_alphabet constant text := '${REQUEST_CODE_ALPHABET}'`));
  assert.ok(MIGRATION.includes(`for v_index in 0..${REQUEST_CODE_LENGTH - 1} loop`));
  assert.ok(MIGRATION.includes(`gen_random_bytes(${REQUEST_CODE_LENGTH})`));
  assert.ok(MIGRATION.includes(`interval '${REQUEST_CODE_LIFETIME_DAYS} days'`));
  // 5 bits a character: about 60 bits of entropy.
  assert.equal(Math.log2(REQUEST_CODE_ALPHABET.length) * REQUEST_CODE_LENGTH, 60);
  for (const ambiguous of 'ILOU') assert.ok(!REQUEST_CODE_ALPHABET.includes(ambiguous));
});

test('a code is accepted however it is written back, and only a code is', () => {
  assert.equal(normalizeRequestCode('7K3M-QX9P-2HTB'), '7K3MQX9P2HTB');
  assert.equal(normalizeRequestCode(' 7k3m qx9p 2htb '), '7K3MQX9P2HTB');
  // Crockford reading: O is 0, I and L are 1.
  assert.equal(normalizeRequestCode('O0IL-AAAA-BBBB'), '0011AAAABBBB');
  assert.equal(normalizeRequestCode('7K3M-QX9P-2HT'), null, 'too short');
  assert.equal(normalizeRequestCode('7K3M-QX9P-2HTBB'), null, 'too long');
  assert.equal(normalizeRequestCode('7K3M-QX9P-2HTU'), null, 'U is not in the alphabet');
  assert.equal(normalizeRequestCode('7K3M_QX9P_2HTB'), null);
  assert.equal(normalizeRequestCode(''), null);
  assert.equal(formatRequestCode('7K3MQX9P2HTB'), '7K3M-QX9P-2HTB');
});

test('the email names the purpose and carries the code, to the support address only', () => {
  const url = requestEmailUrl('delete', '7K3MQX9P2HTB');
  assert.ok(url.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`));
  const body = decodeURIComponent(url.split('&body=')[1] ?? '');
  assert.match(body, /Request code: 7K3M-QX9P-2HTB/);
  assert.match(body, /Delete my data/);
  assert.match(decodeURIComponent(requestEmailUrl('access', 'X'.repeat(12))), /a copy/);
  assert.match(requestCodeShownCopy('access', '2026-10-27T17:00:00Z'), /before 27 Oct 2026/);
});

test('the server answer is parsed strictly', () => {
  assert.deepEqual(parseServerDataExport(EMPTY), EMPTY);
  assert.equal(parseServerDataExport(null), null);
  assert.equal(parseServerDataExport({ ...EMPTY, alerts_sent: null }), null);
  assert.equal(parseServerDataExport({ ...EMPTY, exported_at: 5 }), null);
  assert.ok(serverHoldsNothing(EMPTY));
  assert.ok(!serverHoldsNothing(FULL));
  assert.ok(!serverHoldsNothing({ ...EMPTY, request_codes: [{ purpose: 'access' }] }));
});

test('every group the server holds is shown, with None where it holds nothing', () => {
  const titles = serverDataSections(EMPTY).map((section) => section.title);
  assert.deepEqual(titles, [
    'Your choices',
    'Recall alerts registration',
    'Alerts sent',
    'Last opened',
    'Shopper reports',
    'Request codes',
  ]);
  for (const section of serverDataSections(EMPTY)) assert.deepEqual(section.lines, ['None']);

  const lines = serverDataSections(FULL).flatMap((section) => section.lines);
  assert.ok(lines.includes('States: CA, NY'));
  assert.ok(lines.includes('Allergens: Peanuts, Sesame'));
  assert.ok(lines.includes('Stores: Walmart'));
  assert.ok(lines.includes('Delivery token ending wxyz'));
  assert.ok(lines.includes('1 alert'));
  assert.ok(lines.includes('13 Oct 2026'));
  assert.ok(lines.includes('CA, Walmart, 2 Oct 2026'));
  assert.ok(lines.includes('Copy of data, expires 27 Oct 2026'));
});

test('the allergen consent record appears once the consent columns exist', () => {
  const withConsent = {
    ...FULL,
    preferences: {
      ...FULL.preferences,
      allergen_consent_version: 'allergens-v1',
      allergen_consent_at: '2026-10-11T00:00:00Z',
    },
  };
  const lines = serverDataSections(withConsent).flatMap((section) => section.lines);
  assert.ok(lines.includes('Allergen alerts consent: given on 11 Oct 2026'));
});

test('the export file names its processors and carries no installation id', () => {
  const document = buildExportDocument(FULL);
  assert.equal(document.format, 'lotly-server-data/3');
  // What is left out, what is elsewhere, and how to ask for it: all in the file.
  assert.equal(document.redactions.length, 5);
  assert.match(document.redactions[2], /purchase identifier .* last four characters/);
  assert.match(document.redactions[3], /scrambled form .* left out/);
  assert.match(document.redactions[0], /installation identifier.*never shows, shares or emails/);
  assert.match(document.redactions[1], /last four characters/);
  assert.ok(document.not_included.some((item) => /hosting providers/.test(item)));
  assert.ok(document.not_included.some((item) => /Apple and RevenueCat/.test(item)));
  // The consent-revocation key is explained, never exported, and never called
  // anonymous: Lotly holds the HMAC key, so it is pseudonymous personal data.
  const revocationKey = document.not_included.find((item) => /^Consent-revocation key/.test(item));
  assert.ok(revocationKey, 'the export explains the consent-revocation key');
  assert.match(revocationKey, /keyed hash of Apple’s identifier/);
  assert.match(revocationKey, /still information about you, because Lotly can match it/);
  assert.doesNotMatch(revocationKey, /anonym/i);
  for (const fields of Object.values(EXPORT_FIELDS)) {
    assert.ok(!(fields as readonly string[]).includes('app_transaction_hmac'));
  }
  assert.match(document.requesting_more, new RegExp(SUPPORT_EMAIL.replace('.', '\\.')));
  assert.match(document.requesting_more, /request code for a copy of your data/);
  assert.equal(document.processors_checked_on, '2026-10-13');
  assert.deepEqual(
    document.processors.map((processor) => processor.name),
    ['Supabase', 'Expo', 'Apple', 'RevenueCat', 'Google (Gmail)'],
  );
  for (const processor of DATA_PROCESSORS) {
    assert.match(processor.privacy, /^https:\/\//);
    // A privacy contact route for each: an address or a contact page.
    assert.match(processor.contact, /^(https:\/\/|[a-z]+@[a-z.]+$)/);
  }
  assert.ok(!JSON.stringify(document).includes('installation_id'));
  assert.equal(exportFileName(FULL), 'lotly-server-data-2026-10-13.json');
});

test('the copy follows the app copy rules: no em dashes, no installation id requested', () => {
  const strings = Object.values(copy).flatMap((value) =>
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : value && typeof value === 'object'
          ? Object.values(value).filter((item): item is string => typeof item === 'string')
          : [],
  );
  assert.ok(strings.length > 20);
  for (const text of strings) assert.ok(!text.includes('—'), `em dash in: ${text}`);
  assert.ok(
    REQUEST_CODE_FACTS.some((fact) => /never ask for your installation identifier/.test(fact)),
  );
  assert.ok(REQUEST_CODE_INTRO.includes(SUPPORT_EMAIL));
});

test('the public timing is the strictest clause of every applicable request clock', () => {
  // 45 days from receipt (WA, CT; NV counts from authentication, later);
  // deletion within 30 days of the check (NV 603A.515); one explained
  // extension (all three). Shorter clocks live in the operator runbook.
  assert.match(REQUEST_TIMING_COPY, /within 45 days of receiving your request/);
  assert.match(REQUEST_TIMING_COPY, /deletes within 30 days of checking your code/);
  assert.match(REQUEST_TIMING_COPY, /a deletion is never extended/);
  assert.match(REQUEST_TIMING_COPY, /extend it once, by up to 45 more days/);
  assert.match(REQUEST_TIMING_COPY, /tells you why within the first 45 days/);
  // The runbook states the same operating rules.
  const runbook = readFileSync(join(__dirname, '..', '..', 'docs', 'recall-operations.md'), 'utf8');
  assert.match(runbook, /never later than 30 days\*\* after the check/);
  assert.match(runbook, /no extension for deletion/);
  assert.match(runbook, /at most one extension, of\s+up to 45 days/);
  const privacy = documentPlainText(documentBySlug('privacy-data-controls')!);
  assert.ok(privacy.includes(REQUEST_TIMING_COPY), 'the document uses the one timing sentence');
  assert.ok(!/answers within 45 days\./.test(privacy), 'no bare 45-day promise remains');
});

test('Google is named only for the support mailbox: Lotly is iPhone-only', () => {
  const google = DATA_PROCESSORS.find((processor) => processor.name === 'Google (Gmail)');
  assert.ok(google);
  assert.match(google.role, /support mailbox/);
  assert.match(google.role, /Only if you email Lotly/);
  assert.match(google.role, /The app sends Google nothing/);
  const privacy = documentPlainText(documentBySlug('privacy-data-controls')!);
  assert.ok(!/Google’s notification|Google's notification/.test(privacy), 'no Google push path');
  assert.match(privacy, /Apple’s notification service to your iPhone/);
  assert.match(privacy, /Google hosts its support mailbox/);
});
