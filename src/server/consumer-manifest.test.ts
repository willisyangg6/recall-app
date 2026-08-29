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
