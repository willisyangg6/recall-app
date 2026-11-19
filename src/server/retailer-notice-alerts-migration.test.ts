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
  assert.doesNotMatch(SQL, /\bpolicy\b|disable row level security/i);
  // The only grant statements re-assert the export's own, unchanged from
  // 20261018000000: the re-bodied function keeps exactly its callers.
  const grants = [...SQL.matchAll(/^(?:grant|revoke)\b[^;]*;/gim)].map((m) =>
    m[0].replace(/\s+/g, ' '),
  );
  assert.deepEqual(grants, [
    'revoke execute on function public.export_installation_data(text) from public;',
    'grant execute on function public.export_installation_data(text) to anon, authenticated, service_role;',
  ]);
  assert.match(SQL, /raise exception 'notification_events is reachable by a client role/);
});

test('additive only: no row is rewritten and nothing is dropped', () => {
  assert.doesNotMatch(SQL, /\b(update|delete|truncate|drop table|drop column)\b/i);
});

test('the privacy export keeps every field and adds the retailer notice id', () => {
  const body = SQL.slice(
    SQL.indexOf('create or replace function public.export_installation_data('),
  );
  assert.match(
    body,
    /'recall_id', e\.recall_case_id,\s*'retailer_notice_id', e\.retailer_notice_id,/,
  );
  assert.match(body, /security definer\s*set search_path = public/);
  // Exactly one key differs from the previous definition.
  const previous = readFileSync(
    join(__dirname, '..', '..', 'supabase', 'migrations', '20261018000000_push_entitlement.sql'),
    'utf8',
  ).replace(/--.*$/gm, '');
  const fn = (sql: string) =>
    sql
      .slice(sql.indexOf('create or replace function public.export_installation_data('))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  const before = fn(previous).slice(
    0,
    fn(previous).indexOf('to anon, authenticated, service_role;') + 1,
  );
  const after = fn(SQL).slice(0, fn(SQL).indexOf('to anon, authenticated, service_role;') + 1);
  assert.deepEqual(
    after.filter((line) => !before.includes(line)),
    ["'retailer_notice_id', e.retailer_notice_id,"],
  );
  assert.equal(after.length, before.length + 1);
});
