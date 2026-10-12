/**
 * Inactivity retention (20261013000000) — the properties only the SQL can
 * show. The behavior itself (who is deleted, concurrency, recovery) was run
 * on an isolated local stack; see docs/recall-operations.md.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'supabase',
    'migrations',
    '20261013000000_installation_inactivity_retention.sql',
  ),
  'utf8',
);
const SQL = MIGRATION.replace(/--.*$/gm, '');

function body(name: string): string {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  return SQL.slice(start, SQL.indexOf('$$;', SQL.indexOf('$$', start) + 2));
}

test('the purge ships switched off, and the job deletes nothing until it is switched on', () => {
  assert.match(SQL, /purge_enabled boolean not null default false/);
  assert.match(
    SQL,
    /insert into public\.installation_retention_config \(id, purge_enabled\) values \(true, false\)/,
  );
  const purge = body('purge_inactive_installations');
  assert.ok(
    purge.indexOf('purge_enabled') < purge.indexOf('for v_id in'),
    'the switch is read before anything is selected',
  );
  assert.match(SQL, /cron\.schedule\(\s*'recall-installation-inactivity-purge'/);
});

test('no deletion before the grace date, and the switch cannot go on without one', () => {
  assert.match(SQL, /deletions_start_on date,/);
  assert.match(
    SQL,
    /constraint purge_needs_grace_date check \(not purge_enabled or deletions_start_on is not null\)/,
  );
  const purge = body('purge_inactive_installations');
  const gate = purge.slice(0, purge.indexOf('for v_id in'));
  assert.match(gate, /c\.purge_enabled/);
  assert.match(gate, /c\.deletions_start_on is not null/);
  assert.match(gate, />= c\.deletions_start_on/);
  assert.match(body('preview_inactive_installation_purge'), /deleting_now/);
});

test('the cutoff is 12 calendar months, and the decision is re-made under the locks', () => {
  const purge = body('purge_inactive_installations');
  assert.match(purge, /now\(\) - interval '12 months'/);
  const lock = purge.indexOf('pg_advisory_xact_lock');
  const rowLock = purge.indexOf('for update');
  const recheck = purge.indexOf('installation_last_activity(v_id) < v_cutoff');
  const remove = purge.indexOf('delete_installation_data(v_id)');
  assert.ok(lock > 0 && lock < rowLock && rowLock < recheck && recheck < remove);
  // Deletion goes through the one reset function — never its own deletes.
  assert.doesNotMatch(purge, /delete from/);
});

test('only well-formed ids are candidates, so one bad row cannot stall every purge', () => {
  const candidates = body('inactive_installation_candidates');
  assert.ok(candidates.includes(String.raw`where ids.installation_id ~ '^[A-Za-z0-9-]{16,64}$'`));
});

test('the check-in RPC takes the same per-installation lock as the purge', () => {
  const rpc = body('record_installation_activity');
  const lockExpression = "hashtextextended('installation:' || p_installation_id, 0)";
  assert.ok(rpc.includes(lockExpression));
  assert.ok(
    body('purge_inactive_installations').includes("hashtextextended('installation:' || v_id, 0)"),
  );
  assert.ok(rpc.includes(String.raw`'^[A-Za-z0-9-]{16,64}$'`));
  // Stores a UTC date and never moves it backwards.
  assert.match(rpc, /\(now\(\) at time zone 'utc'\)::date/);
  assert.match(rpc, /greatest\(public\.installation_activity\.last_active_on/);
});

test('activity is what the app does — never what background jobs or sends do', () => {
  const last = body('installation_last_activity');
  for (const signal of [
    'installation_activity',
    'installation_preferences',
    'registered_at',
    'last_seen_at',
    'enabled_at',
    'push_installation_sequences',
    'shopper_reports',
  ]) {
    assert.ok(last.includes(signal), `${signal} counts`);
  }
  for (const background of [
    'disabled_at',
    'disabled_reason',
    'last_token_error',
    'notification_deliveries',
    'notification_events',
    'ingest',
  ]) {
    assert.ok(!last.includes(background), `${background} is not user activity`);
  }
});

test('only the check-in is client-callable; the purge, preview and inputs are service-role only', () => {
  assert.match(
    SQL,
    /grant execute on function public\.record_installation_activity\(text\)\s*to anon, authenticated, service_role/,
  );
  for (const fn of [
    'installation_last_activity(text)',
    'inactive_installation_candidates(timestamptz, integer)',
    'preview_inactive_installation_purge()',
    'purge_inactive_installations(integer)',
  ]) {
    const escaped = fn.replace(/[()]/g, '\\$&');
    assert.match(SQL, new RegExp(`revoke execute on function public\\.${escaped} from public`));
    assert.match(SQL, new RegExp(`grant execute on function public\\.${escaped} to service_role;`));
    assert.doesNotMatch(SQL, new RegExp(`function public\\.${escaped}\\s*to anon`));
  }
  // The new tables are service-role only (no client table grants).
  assert.doesNotMatch(
    SQL,
    /on public\.installation_(activity|retention_config) to (anon|authenticated)/,
  );
});

test('existing installations are seeded so none can be deleted within 12 months of shipping', () => {
  assert.match(
    SQL,
    /insert into public\.installation_activity \(installation_id, last_active_on\)\s*select/,
  );
  assert.match(SQL, /on conflict \(installation_id\) do nothing/);
});
