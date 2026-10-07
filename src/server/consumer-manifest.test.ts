/**
 * Migration pins for the consumer feed manifest (C8) — the repo's standing
 * migration-security pattern (see watchdog/contract.test.ts): the SQL is
 * read as text, comments are stripped so a commented-out line can never
 * satisfy a pin, and the security-load-bearing statements are asserted
 * exactly. Deliberately no SQL parser — the pins break loudly when the
 * migration is edited, which is the point.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(__dirname, '..', '..');
const MIGRATION = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20260904000000_consumer_feed_manifest.sql'),
  'utf8',
);
/** Comment lines removed: a pin must match live SQL, never prose. */
const SQL = MIGRATION.replace(/^\s*--.*$/gm, '');

const CLIENT = readFileSync(join(ROOT, 'src', 'lib', 'recall-feed.ts'), 'utf8');

test('the manifest is a security_invoker view — anon reads through recall_cases RLS', () => {
  assert.match(
    SQL,
    /create view public\.consumer_feed_manifest\s*\n?\s*with \(security_invoker = true\)/,
  );
  assert.doesNotMatch(SQL, /security definer/i);
  assert.doesNotMatch(SQL, /create policy/i);
  assert.doesNotMatch(SQL, /alter table/i);
  assert.doesNotMatch(SQL, /create table/i);
});

test('the view restates the consumer read contract: active and unmerged only', () => {
  assert.match(SQL, /where rc\.state = 'active'\s*\n?\s*and rc\.merged_into is null/);
});

test('the version token hashes the exact client-visible representation', () => {
  // projection (which the generated feed columns derive from), the timeline,
  // and the embedded product names in ordinal order — the three inputs of
  // FEED_SELECT. A missing input would let that class of change go
  // undetected in every client cache.
  assert.match(SQL, /md5\(/);
  assert.match(SQL, /rc\.projection::text/);
  assert.match(SQL, /rc\.timeline::text/);
  assert.match(SQL, /string_agg\(ap\.name, chr\(31\) order by ap\.ordinal\)/);
  assert.match(SQL, /from public\.affected_products ap/);
  assert.match(SQL, /where ap\.recall_case_id = rc\.id/);
});

test('the grant surface is select-only, to exactly the feed-reading roles', () => {
  assert.match(
    SQL,
    /grant select on public\.consumer_feed_manifest to anon, authenticated, service_role;/,
  );
  const grants = SQL.match(/^\s*grant\b.*$/gim) ?? [];
  assert.equal(grants.length, 1, 'exactly one grant statement');
  assert.doesNotMatch(SQL, /grant (insert|update|delete|all)/i);
});

test('the migration touches nothing beyond the two feed tables', () => {
  // Scope containment (contract.test.ts pattern): server-only and
  // installation-facing tables must not appear in this migration at all —
  // the manifest can leak nothing it never references.
  for (const forbidden of [
    'source_records',
    'source_snapshots',
    'notification_events',
    'notification_deliveries',
    'push_subscriptions',
    'push_delivery_config',
    'installation_preferences',
    'ingest_runs',
    'job_leases',
    'watchdog_config',
    'watchdog_dispatches',
    'watchdog_invocations',
    'product_visuals',
    'vault',
    'secret',
  ]) {
    assert.equal(SQL.includes(forbidden), false, `migration must not reference ${forbidden}`);
  }
});

test('the client manifest query requests only id and version', () => {
  // The warm-refresh request IS the recurring cost this milestone exists to
  // bound; pin its column list the way contract.test.ts pins CLI reads.
  assert.match(CLIENT, /consumer_feed_manifest\?select=id,version/);
});

test('the by-id row fetch keeps the frozen consumer contract filters', () => {
  const byIds = CLIENT.slice(CLIENT.indexOf('export async function fetchFeedItemsByIds'));
  assert.match(byIds, /state=eq\.active/);
  assert.match(byIds, /FEED_SELECT/);
  assert.match(byIds, /affected_products\.order=ordinal\.asc/);
});

// ── FDA open evidence (2026-10-06): the view recreated, additively ──────────

const EVIDENCE_SQL = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20261006000000_fda_ongoing_evidence.sql'),
  'utf8',
).replace(/^\s*--.*$/gm, '');

test('open evidence: one nullable column, and nothing dropped, written or widened', () => {
  assert.match(
    EVIDENCE_SQL,
    /alter table public\.recall_cases\s+add column fda_ongoing_as_of date null;/,
  );
  for (const forbidden of [
    /\bdrop\b/i,
    /\bupdate\b/i,
    /\binsert\b/i,
    /\bdelete\b/i,
    /security definer/i,
    /create policy/i,
  ]) {
    assert.doesNotMatch(EVIDENCE_SQL, forbidden);
  }
  for (const forbidden of [
    'source_records',
    'source_snapshots',
    'notification_events',
    'push_',
    'installation_',
  ]) {
    assert.equal(
      EVIDENCE_SQL.includes(forbidden),
      false,
      `migration must not reference ${forbidden}`,
    );
  }
});

test('open evidence: the recreated view keeps the C8 security and read contract', () => {
  assert.match(
    EVIDENCE_SQL,
    /create or replace view public\.consumer_feed_manifest\s*\n?\s*with \(security_invoker = true\)/,
  );
  assert.match(EVIDENCE_SQL, /where rc\.state = 'active'\s*\n?\s*and rc\.merged_into is null/);
  const grants = EVIDENCE_SQL.match(/^\s*grant\b.*$/gim) ?? [];
  assert.deepEqual(
    grants.map((line) => line.trim()),
    ['grant select on public.consumer_feed_manifest to anon, authenticated, service_role;'],
  );
});

test('open evidence: the token is the C8 token, plus the date only when one exists', () => {
  // Every C8 input, unchanged…
  assert.match(EVIDENCE_SQL, /rc\.projection::text/);
  assert.match(EVIDENCE_SQL, /rc\.timeline::text/);
  assert.match(EVIDENCE_SQL, /string_agg\(ap\.name, chr\(31\) order by ap\.ordinal\)/);
  // …and the evidence appended so that NULL appends nothing: applying the
  // migration moves no token, and re-downloads nothing on any device.
  assert.match(
    EVIDENCE_SQL,
    /\|\| case\s+when rc\.fda_ongoing_as_of is null then ''\s+else '\|' \|\| rc\.fda_ongoing_as_of::text\s+end/,
  );
});

test('the client serves the column it hashes', () => {
  assert.match(CLIENT, /'fda_ongoing_as_of'/);
});
