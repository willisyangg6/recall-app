/**
 * 20261119000000_retailer_notice_alerts.sql: additive, exactly one subject
 * per notification event, no client reach (docs/recall-push-delivery.md,
 * "Retailer-only notices").
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const SQL = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '20261119000000_retailer_notice_alerts.sql',
  ),
  'utf8',
).replace(/--.*$/gm, '');

test('every event names exactly one subject: an agency case or a retailer notice', () => {
  assert.match(SQL, /alter column recall_case_id drop not null/);
  assert.match(
    SQL,
    /add column retailer_notice_id uuid references public\.retailer_notices \(id\)/,
  );
  assert.match(SQL, /check \(num_nonnulls\(recall_case_id, retailer_notice_id\) = 1\)/);
});

test('no grant changes, and the migration refuses to finish if a client role can reach the ledger', () => {
  assert.doesNotMatch(SQL, /\bgrant\b|\bpolicy\b|disable row level security/i);
  assert.match(SQL, /raise exception 'notification_events is reachable by a client role/);
});

test('additive only: no row is rewritten and nothing is dropped', () => {
  assert.doesNotMatch(SQL, /\b(update|delete|truncate|drop table|drop column)\b/i);
});
