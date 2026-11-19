/**
 * The approval migration's privacy and visibility contract, pinned on the SQL.
 * The behaviour itself is proved against a real stack by
 * retailer-notice-live.test.ts.
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
    '..',
    'supabase',
    'migrations',
    '20261115000000_retailer_notice_approvals.sql',
  ),
  'utf8',
)
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ');

const READ_PATH = SQL.slice(
  SQL.indexOf('create function public.consumer_retailer_notices()'),
  SQL.indexOf('revoke execute on function public.consumer_retailer_notices()'),
);

test('the approval table is private: RLS, no policy, no client grant, no delete', () => {
  assert.match(SQL, /alter table public\.retailer_notice_approvals enable row level security;/);
  assert.match(
    SQL,
    /revoke all on public\.retailer_notice_approvals from public, anon, authenticated;/,
  );
  assert.match(
    SQL,
    /grant select, insert, update on public\.retailer_notice_approvals to service_role;/,
  );
  assert.doesNotMatch(SQL, /create policy/i);
  assert.doesNotMatch(
    SQL,
    /grant [^;]*on (table )?public\.retailer_notice[^;]* to [^;]*\b(anon|authenticated)\b/,
  );
});

test('one live approval per notice, bound to a document hash, no foreign key into cases', () => {
  assert.match(
    SQL,
    /create unique index retailer_notice_approvals_one_live on public\.retailer_notice_approvals \(notice_id\) where withdrawn_at is null;/,
  );
  assert.match(
    SQL,
    /document_content_hash text not null check \(document_content_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/,
  );
  assert.doesNotMatch(SQL, /references public\.recall_cases/);
});

test('the read path returns only display-safe columns', () => {
  assert.match(
    READ_PATH,
    /returns table \( id uuid, publisher text, document_url text, notice_date date, approved_at timestamptz, fields jsonb \)/,
  );
  for (const secret of [
    'field_evidence',
    'review_notes',
    'approved_by',
    'document_bytes',
    'extracted_text',
    'evidence',
  ]) {
    assert.ok(!new RegExp(`select[^;]*\\b${secret}\\b[^;]*from`).test(READ_PATH), secret);
  }
});

test('the read path hides a notice unless every visibility condition holds', () => {
  for (const condition of [
    'a.withdrawn_at is null',
    'a.agency_case_id is null',
    'a.document_content_hash = n.document_content_hash',
    "n.decision = 'new_candidate'",
    "n.notice_kind = 'recall'",
    "n.food_status = 'food'",
    "n.document_extraction = 'text'",
  ]) {
    assert.ok(READ_PATH.includes(condition), condition);
  }
});

test('the read path is a definer function with a pinned search path, executable by clients only', () => {
  assert.match(READ_PATH, /language sql stable security definer set search_path = ''/);
  assert.match(
    SQL,
    /revoke execute on function public\.consumer_retailer_notices\(\) from public;/,
  );
  assert.match(
    SQL,
    /grant execute on function public\.consumer_retailer_notices\(\) to anon, authenticated, service_role;/,
  );
});

test('the migration touches no existing table and never names the case or ledger tables', () => {
  assert.doesNotMatch(
    SQL,
    /\b(alter|drop|truncate|update|insert into|delete from) (table )?public\.(?!retailer_notice_approvals)/i,
  );
  assert.doesNotMatch(SQL, /recall_cases|notification_events|source_records|affected_products/);
});

// ── 20261118000000: the read path recreated with the derived category ──────

const PUBLISHERS_SQL = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'supabase',
    'migrations',
    '20261118000000_retailer_notice_publishers.sql',
  ),
  'utf8',
)
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ');

const BODY = (sql: string) =>
  sql
    .slice(sql.indexOf(' as $$'), sql.indexOf('$$;', sql.indexOf(' as $$')))
    .replace(/, a\.product_categories/, '');

test('the recreated read path keeps every condition and adds only the derived category', () => {
  const recreated = PUBLISHERS_SQL.slice(
    PUBLISHERS_SQL.indexOf('create function public.consumer_retailer_notices()'),
  );
  assert.match(
    recreated,
    /returns table \( id uuid, publisher text, document_url text, notice_date date, approved_at timestamptz, fields jsonb, product_categories jsonb \)/,
  );
  // Same body as the applied read path, apart from the one added column.
  assert.ok(BODY(READ_PATH).includes("n.decision = 'new_candidate'"));
  assert.equal(BODY(recreated), BODY(READ_PATH));
  assert.match(recreated, /security definer set search_path = ''/);
  assert.match(
    recreated,
    /revoke execute on function public\.consumer_retailer_notices\(\) from public; grant execute on function public\.consumer_retailer_notices\(\) to anon, authenticated, service_role;/,
  );
  assert.match(PUBLISHERS_SQL, /add column product_categories jsonb;/);
  assert.doesNotMatch(PUBLISHERS_SQL, /recall_cases|notification_|source_records/);
});
