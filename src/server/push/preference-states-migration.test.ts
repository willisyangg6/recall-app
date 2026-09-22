/**
 * P2B7U expand migration — textual pins on the SQL itself.
 *
 * This suite exists to make one class of mistake impossible to ship: a
 * DESTRUCTIVE statement in a migration whose whole job is to be additive. An
 * earlier draft of this file's subject added `state_codes` and, in the same
 * transaction, dropped `state_code` and the singular RPC signature. Applying
 * that would have opened a window — between the migration and the new bundle
 * reaching devices — in which the DEPLOYED app called an RPC signature that no
 * longer existed and the delivery worker selected a column that no longer
 * existed. Expand, deploy, then contract; and the guard below fails the build
 * if the expand phase ever grows a contract phase's statements.
 *
 * Behaviour is proven for real, against Postgres and PostgREST, in
 * preference-states-live.test.ts on the local disposable stack. Text pins what
 * may not be written; the live suite pins what actually happens.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { SUPPORTED_STATE_CODES } from '../../domain/preferences';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const MIGRATION_FILE = '20260921000000_installation_preference_states_expand.sql';
const MIGRATION = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
/** Statements only — comments stripped, so a commented-out line satisfies nothing. */
const SQL = MIGRATION.replace(/^\s*--.*$/gm, '');

test('the migration is forward-only and appended to the end of the chain', () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  assert.equal(files[files.length - 1], MIGRATION_FILE);
  assert.match(MIGRATION_FILE, /^\d{14}_[a-z_]+\.sql$/);
  // One migration per milestone: the destructive draft was REPLACED, not
  // patched over with a second file, so an unapplied mistake never reaches
  // production even as an intermediate state.
  assert.equal(
    files.filter((name) => name.includes('installation_preference_states')).length,
    1,
    'a second preference-states migration is stacked over this one',
  );
});

// ── The guard: nothing destructive may appear in an expand phase ────────────

test('the expand migration contains no destructive statement of any kind', () => {
  const forbidden: [RegExp, string][] = [
    [/\bdrop\s+column\b/i, 'DROP COLUMN'],
    [/\bdrop\s+table\b/i, 'DROP TABLE'],
    [/\bdrop\s+function\b/i, 'DROP FUNCTION'],
    [/\bdrop\s+type\b/i, 'DROP TYPE'],
    [/\bdrop\s+index\b/i, 'DROP INDEX'],
    [/\bdrop\s+constraint\b/i, 'DROP CONSTRAINT'],
    [/\bdrop\s+trigger\b/i, 'DROP TRIGGER'],
    [/\bdrop\s+policy\b/i, 'DROP POLICY'],
    [/\bdrop\s+schema\b/i, 'DROP SCHEMA'],
    [/\brename\s+to\b/i, 'RENAME TO'],
    [/\brename\s+column\b/i, 'RENAME COLUMN'],
    [/\balter\s+column\b[\s\S]{0,80}?\btype\b/i, 'ALTER COLUMN … TYPE'],
    [/\bset\s+not\s+null\b/i, 'SET NOT NULL on an existing column'],
    [/\btruncate\b/i, 'TRUNCATE'],
    [/\bdelete\s+from\b/i, 'DELETE FROM'],
  ];
  for (const [pattern, name] of forbidden) {
    assert.ok(!pattern.test(SQL), `the expand migration contains ${name}`);
  }
  // The only DROPs a migration like this could excuse are `drop ... if exists`
  // guards; there are none, so the blanket rule above stands unqualified.
  assert.ok(!/\bdrop\b/i.test(SQL), 'the expand migration contains a DROP');
});

test('the singular column and the singular RPC signature both survive', () => {
  // The column is never mentioned in a destructive position, and it is still
  // written by the upsert — it is a maintained projection, not a leftover.
  assert.match(SQL, /insert into public\.installation_preferences\s*\n?\s*\([^)]*\bstate_code\b/);
  assert.match(
    SQL,
    /set state_codes = excluded\.state_codes,\s*\n\s*state_code = excluded\.state_code/,
  );
  // The singular RPC is re-created with its EXACT original signature, so
  // PostgREST keeps dispatching the deployed app's request body to it.
  assert.match(
    SQL,
    /create or replace function public\.set_installation_preferences\(\s*p_installation_id text,\s*p_state_code text,\s*p_allergens text\[\],\s*p_retailer_ids text\[\]\s*\)/,
  );
  assert.ok(
    SQL.includes(
      'grant execute on function public.set_installation_preferences(text, text, text[], text[])',
    ),
    'the singular signature lost its grants',
  );
});

test('the plural RPC is added alongside, as an overload', () => {
  assert.match(
    SQL,
    /create or replace function public\.set_installation_preferences\(\s*p_installation_id text,\s*p_state_codes text\[\],\s*p_allergens text\[\],\s*p_retailer_ids text\[\]\s*\)/,
  );
  assert.ok(
    SQL.includes(
      'grant execute on function public.set_installation_preferences(text, text[], text[], text[])',
    ),
  );
  // Two entry points, ONE implementation — they cannot drift apart in what
  // they accept or in what they write.
  assert.equal(
    (SQL.match(/perform public\.apply_installation_preferences\(/g) ?? []).length,
    2,
    'an entry point stopped delegating to the shared implementation',
  );
  // The shared implementation is not reachable over the Data API.
  assert.ok(
    SQL.includes(
      'revoke execute on function public.apply_installation_preferences(text, text[], text[], text[]) from anon, authenticated',
    ),
  );
});

test('the column is added idempotently and the backfill can run twice', () => {
  assert.match(SQL, /add column if not exists state_codes text\[\] not null default '\{\}'/);
  // The guard is what makes a second run a no-op: after the first, no row that
  // has a state_code still holds an empty array.
  assert.match(
    SQL,
    /update public\.installation_preferences\s*\n\s*set state_codes = array\[state_code\]\s*\n\s*where state_code is not null\s*\n\s*and state_codes = '\{\}'/,
  );
});

test('the historical backfill does not move the delivery-safety horizon', () => {
  const backfill = SQL.slice(
    SQL.indexOf('update public.installation_preferences'),
    SQL.indexOf('create or replace function public.apply_installation_preferences'),
  );
  assert.ok(backfill.length > 0);
  assert.ok(!backfill.includes('updated_at'), 'the backfill writes updated_at');
  assert.ok(!backfill.includes('now()'), 'the backfill stamps a time');
  // The RPC still refuses to move it for an identical write, and the
  // projection is part of that comparison so a drifted row self-heals.
  assert.match(SQL, /if found\s*\n\s*and v_existing\.state_codes = v_states/);
  assert.match(SQL, /and v_existing\.state_code is not distinct from v_states\[1\]/);
  assert.ok(SQL.includes('return;'), 'the identical-values early return is gone');
});

test('the security model and the closed vocabularies are carried over unchanged', () => {
  // Three functions, every one SECURITY DEFINER with a pinned search_path.
  assert.equal((SQL.match(/security definer/g) ?? []).length, 3);
  assert.equal((SQL.match(/set search_path = public/g) ?? []).length, 3);
  assert.match(SQL, /p_installation_id !~ '\^\[A-Za-z0-9-\]\{16,64\}\$'/);
  // No policy is created, and no table grant reaches a public role.
  assert.doesNotMatch(SQL, /create\s+policy/i);
  for (const line of SQL.split('\n')) {
    if (!/^\s*grant\b/i.test(line) || /grant execute/i.test(line)) continue;
    assert.match(line, /to service_role/, `a table grant names an unexpected role: ${line.trim()}`);
  }
  // The state vocabulary in the RPC is exactly the app's closed 52.
  const listed = [...SQL.matchAll(/'([A-Z]{2})'/g)].map((m) => m[1]);
  const inRpc = new Set(listed.filter((code) => SUPPORTED_STATE_CODES.includes(code)));
  assert.equal(inRpc.size, 52);
  assert.deepEqual([...inRpc].sort(), [...SUPPORTED_STATE_CODES].sort());
  assert.match(SQL, /array_length\(p_state_codes, 1\) > 52/);
  assert.match(SQL, /array_agg\(distinct t order by t\), '\{\}'\)\s*into v_states/);
});

test('the migration touches nothing outside installation_preferences', () => {
  const tables = [
    ...SQL.matchAll(/\b(?:alter table|update|insert into|drop table)\s+(public\.\w+|\w+\.\w+)/gi),
  ].map((m) => m[1]);
  assert.ok(tables.length >= 3, 'the write statements were not found at all');
  for (const table of tables) {
    assert.equal(table, 'public.installation_preferences', `the migration writes ${table}`);
  }
  for (const forbidden of [
    'recall_cases',
    'notification_events',
    'notification_deliveries',
    'push_subscriptions',
    'push_delivery_config',
    'ingest_runs',
    'shopper_reports',
  ]) {
    assert.ok(!SQL.includes(forbidden), `the migration references ${forbidden}`);
  }
});
