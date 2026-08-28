/**
 * The watchdog's cross-file contract, asserted against the migration SQL and
 * the CLI scripts as text (same approach as workflow-schedule.test.ts: these
 * are one-line values whose silent drift would break production behavior, and
 * a CI-gating test should not depend on a SQL parser).
 *
 * What is pinned and why:
 *  - the atomic claim protection (advisory lock) and every cooldown clause —
 *    removing either reintroduces the read-then-insert dispatch race
 *  - RLS + grants: the watchdog tables and RPCs are server-only; the
 *    publishable key (anon role) must have no path to them
 *  - the decision vocabulary, identical in SQL and in the Edge Function core
 *  - the GitHub target, identical in SQL defaults and in the core constants,
 *    and pointing at the real workflow file on the real branch
 *  - freshness reads ONLY the two primary source jobs — never push, labels,
 *    or enforcement
 *  - no secret material anywhere in the migration or the cron command
 *  - scheduler:status stays read-only; scheduler:probe dispatches only
 *    behind the explicit --dispatch flag
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  WATCHDOG_DECISIONS,
  WATCHDOG_TARGET,
} from '../../../supabase/functions/ingest-watchdog/core';

const ROOT = join(__dirname, '..', '..', '..');
const migration = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20260901000000_scheduler_watchdog.sql'),
  'utf8',
);
const statusScript = readFileSync(join(ROOT, 'scripts', 'scheduler-status.ts'), 'utf8');
const probeScript = readFileSync(join(ROOT, 'scripts', 'scheduler-probe.ts'), 'utf8');

// ── Atomic claim ─────────────────────────────────────────────────────────────

test('the tick serializes concurrent invocations on a transaction advisory lock', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('recall_watchdog_dispatch'\)\)/);
});

test('every cooldown clause is present: accepted, in-flight claim TTL, failure backoff', () => {
  assert.match(
    migration,
    /status = 'accepted'\s*\n?\s*and claimed_at > v_now - make_interval\(mins => cfg\.cooldown_minutes\)/,
  );
  assert.match(
    migration,
    /status = 'claimed'\s*\n?\s*and claimed_at > v_now - make_interval\(mins => cfg\.claim_ttl_minutes\)/,
  );
  assert.match(
    migration,
    /status = 'failed'\s*\n?\s*and coalesce\(finalized_at, claimed_at\) > v_now - make_interval\(mins => cfg\.failure_backoff_minutes\)/,
  );
});

test('a probe computes the decision but never inserts a claim row', () => {
  assert.match(migration, /if not p_probe then\s*\n\s*insert into public\.watchdog_dispatches/);
});

test('finalize only ever touches a still-claimed row', () => {
  assert.match(migration, /where id = p_claim_id and status = 'claimed'/);
});

// ── Server-only security ─────────────────────────────────────────────────────

test('every watchdog table enables RLS', () => {
  for (const table of ['watchdog_config', 'watchdog_dispatches', 'watchdog_invocations']) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`),
      `${table} missing RLS`,
    );
  }
});

test('nothing is granted to anon, authenticated, or public — the publishable key has no path in', () => {
  assert.ok(!/grant[^;]+to[^;]*\banon\b/.test(migration), 'grant to anon found');
  assert.ok(!/grant[^;]+to[^;]*\bauthenticated\b/.test(migration), 'grant to authenticated found');
  assert.ok(!/grant[^;]+to[^;]*\bpublic\b/i.test(migration), 'grant to public found');
  assert.ok(!/create policy/i.test(migration), 'no policies expected — service-role only');
});

test('both RPCs are revoked from public/anon/authenticated and granted only to service_role', () => {
  assert.match(
    migration,
    /revoke execute on function public\.watchdog_tick\(boolean, boolean, text\)\s*\n?\s*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke execute on function public\.watchdog_finalize_dispatch\(uuid, boolean, integer, bigint, text, integer\)\s*\n?\s*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.watchdog_tick\(boolean, boolean, text\) to service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.watchdog_finalize_dispatch\(uuid, boolean, integer, bigint, text, integer\)\s*\n?\s*to service_role/,
  );
});

test('no secret material and no secret-bearing column exists in the migration', () => {
  // Value patterns for the credentials this system uses.
  assert.ok(!/sb_secret_/.test(migration));
  assert.ok(!/github_pat_|ghp_/.test(migration));
  assert.ok(!/eyJ[A-Za-z0-9]/.test(migration), 'JWT-shaped literal found');
  // The cron command reads Vault BY NAME at tick time.
  assert.match(migration, /vault\.decrypted_secrets\s*\n?\s*where name = 'watchdog_function_url'/);
  assert.match(migration, /vault\.decrypted_secrets\s*\n?\s*where name = 'watchdog_shared_secret'/);
  // Only the token's EXPIRY date is stored, never the token.
  assert.match(migration, /github_token_expires_at timestamptz/);
  assert.ok(!/github_token text|token text/.test(migration), 'a token column must not exist');
});

// ── Scope containment ────────────────────────────────────────────────────────

test('the migration never touches leases, consumer data, or the notification ledger', () => {
  // Comments may (and do) EXPLAIN the boundary; the executable SQL must not
  // cross it.
  const sqlOnly = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  for (const forbidden of [
    'job_leases',
    'recall_cases',
    'notification_events',
    'notification_deliveries',
    'push_subscriptions',
    'push_delivery_config',
  ]) {
    assert.ok(!sqlOnly.includes(forbidden), `migration SQL references ${forbidden}`);
  }
});

test('freshness is decided by the two primary source jobs and nothing else', () => {
  assert.match(
    migration,
    /job_name = 'fda_announcements' and outcome in \('succeeded', 'partial'\)/,
  );
  assert.match(migration, /job_name = 'fsis_ingest' and outcome in \('succeeded', 'partial'\)/);
  for (const nonPrimary of ['fsis_labels', 'fda_enforcement', 'push_delivery']) {
    assert.ok(!migration.includes(nonPrimary), `${nonPrimary} must not drive dispatch`);
  }
});

test('retention deletes expired history only, by age against retention_days', () => {
  assert.match(
    migration,
    /delete from public\.watchdog_invocations\s*\n?\s*where invoked_at < v_now - make_interval\(days => cfg\.retention_days\)/,
  );
  assert.match(
    migration,
    /delete from public\.watchdog_dispatches\s*\n?\s*where claimed_at < v_now - make_interval\(days => cfg\.retention_days\)/,
  );
  // Exactly two deletes in the whole migration — retention and nothing else.
  assert.equal((migration.match(/delete from/g) ?? []).length, 2);
});

// ── The shared decision vocabulary and GitHub target ─────────────────────────

test('the SQL decision CHECK matches the Edge Function decision vocabulary exactly', () => {
  const check = migration.match(/decision in \(([^)]+)\)/);
  assert.ok(check, 'decision CHECK not found');
  const sqlDecisions = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(sqlDecisions, [...WATCHDOG_DECISIONS].sort());
});

test('the SQL target defaults match the core constants and the real repository layout', () => {
  assert.match(migration, new RegExp(`default '${WATCHDOG_TARGET.repository}'`));
  assert.match(migration, new RegExp(`default '${WATCHDOG_TARGET.workflow}'`));
  assert.match(migration, new RegExp(`default '${WATCHDOG_TARGET.ref}'`));
});

test('the reliability-contract numbers hold: 40m stale, 20m cooldown, 5m cron, 30d retention', () => {
  assert.match(migration, /stale_after_minutes integer not null default 40/);
  assert.match(migration, /cooldown_minutes integer not null default 20/);
  assert.match(migration, /retention_days integer not null default 30/);
  assert.match(migration, /'\*\/5 \* \* \* \*'/);
  assert.match(migration, /cron\.schedule\(\s*\n?\s*'recall-ingest-watchdog'/);
});

// ── CLI safety ───────────────────────────────────────────────────────────────

test('scheduler:status is read-only — no insert, update, delete, upsert, or rpc', () => {
  for (const writer of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(']) {
    assert.ok(!statusScript.includes(writer), `scheduler-status.ts uses ${writer}`);
  }
  assert.ok(!statusScript.includes('/functions/v1/'), 'status must not invoke the function');
});

test('the probe dispatches only behind the explicit --dispatch flag', () => {
  assert.match(probeScript, /dispatch \? 'force-dispatch' : 'probe'/);
  assert.match(probeScript, /--dispatch/);
  assert.match(probeScript, /CONTROLLED DISPATCH/);
});
