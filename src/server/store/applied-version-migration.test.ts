/**
 * Structural contract of the O3-B1 migration
 * (supabase/migrations/20260907000000_applied_version_contract.sql).
 *
 * The SQL cannot be EXECUTED offline without a database, so this file pins
 * the properties the design depends on — nullable no-default marker columns,
 * the state vocabulary, no blind legacy seeding, the three RPCs with their
 * predicates, and the service-role-only hardening — against the migration
 * text itself. The full transactional behavior is proven behaviorally by
 * MemoryStore (pipeline-atomicity.test.ts); executing the SQL against a real
 * database is deliberately deferred to the separately authorized O3-B3
 * application step, and that remaining integration gap is disclosed in the
 * O3-B1 report.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const MIGRATION_PATH = 'supabase/migrations/20260907000000_applied_version_contract.sql';
const sql = readFileSync(MIGRATION_PATH, 'utf8');
/** Everything before the first function body — the schema-change section. */
const schemaSection = sql.slice(0, sql.indexOf('create or replace function'));

test('the marker columns are nullable with NO defaults — nothing may imply a legacy row was applied', () => {
  for (const column of [
    'apply_state',
    'applied_content_hash',
    'applied_snapshot_seq',
    'applied_at',
  ]) {
    assert.match(sql, new RegExp(`add column ${column}`), `${column} must be added`);
  }
  const alterBlock = sql.match(/alter table public\.source_records\s+add column[\s\S]*?;/)![0];
  assert.doesNotMatch(
    alterBlock,
    /default/i,
    'an ADD COLUMN default would stamp every legacy row — existing rows must stay NULL (legacy_unverified)',
  );
});

test('the stored state vocabulary matches the final state machine and excludes derived states', () => {
  assert.match(sql, /check \(apply_state in \('pending', 'applied', 'applied_degraded'\)\)/);
  // 'superseded' and 'legacy_unverified' are derived/NULL, never stored —
  // they may appear in comments but never in executable SQL.
  const executable = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(executable, /'superseded'/);
  assert.doesNotMatch(executable, /'legacy_unverified'/);
});

test('no SQL statement seeds legacy markers from archived snapshots', () => {
  // The schema section (outside the function bodies) must not UPDATE
  // source_records at all — a blind latest-snapshot backfill was the O3-B0
  // gap G1 and is explicitly forbidden. Marker writes exist only inside the
  // transactional functions, guarded by their monotonic predicates.
  assert.doesNotMatch(
    schemaSection,
    /update\s+public\.source_records/i,
    'legacy marker seeding belongs exclusively to the separately authorized O3-B2 reconciliation',
  );
});

test('the actionable-state partial index exists and covers only pending/degraded', () => {
  assert.match(
    sql,
    /create index source_records_apply_state_idx[\s\S]*?where apply_state in \('pending', 'applied_degraded'\)/,
  );
});

test('the health view is security_invoker and granted to service_role only', () => {
  assert.match(
    sql,
    /create view public\.source_record_apply_health\s+with \(security_invoker = true\)/,
  );
  assert.match(sql, /grant select on public\.source_record_apply_health to service_role;/);
  assert.doesNotMatch(sql, /grant[^;]*source_record_apply_health[^;]*(anon|authenticated)/);
});

test('all three RPCs exist, are revoked from public/anon/authenticated, and granted to service_role', () => {
  for (const fn of ['archive_snapshot', 'apply_case_transition', 'found_recall_case']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`), fn);
    assert.match(
      sql,
      new RegExp(
        `revoke execute on function public\\.${fn}\\([^)]*\\)\\s+from public, anon, authenticated;`,
      ),
      `${fn} must be revoked from client roles`,
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to service_role;`),
      `${fn} must be service-role only`,
    );
    // The repo's lease/watchdog pattern: SECURITY INVOKER, so no definer
    // escalation exists to harden.
  }
  assert.doesNotMatch(sql, /security definer/i);
});

test('archive_snapshot orders by fetched_at, rejects stale before any write, and sets pending atomically', () => {
  const fn = sql.slice(
    sql.indexOf('function public.archive_snapshot'),
    sql.indexOf('function public.apply_case_transition'),
  );
  assert.match(fn, /for update/, 'per-record serialization');
  assert.match(fn, /p_fetched_at < v_latest\.fetched_at/, 'fetched_at monotonicity');
  assert.match(fn, /'status', 'stale'/);
  assert.match(fn, /'status', 'duplicate'/);
  assert.match(fn, /set apply_state = 'pending'/);
  assert.match(fn, /applied_snapshot_seq is null or applied_snapshot_seq < v_seq/);
});

test('apply_case_transition carries the CAS, dedup-idempotent events, and case-scoped monotonic markers', () => {
  const fn = sql.slice(
    sql.indexOf('function public.apply_case_transition'),
    sql.indexOf('function public.found_recall_case'),
  );
  assert.match(fn, /and last_changed_at = p_expected_last_changed_at/, 'the case CAS predicate');
  assert.match(fn, /'status', 'conflict'/);
  assert.match(fn, /delete from public\.affected_products where recall_case_id = p_case_id/);
  assert.match(fn, /on conflict \(dedup_key\) do nothing/, 'event dedup is idempotent success');
  assert.match(fn, /and recall_case_id = p_case_id/, 'markers confined to records of this case');
  assert.match(
    fn,
    /applied_snapshot_seq is null\s+or applied_snapshot_seq <= \(v_item->>'snapshotSeq'\)::bigint/,
    'marker monotonicity',
  );
});

test('found_recall_case is one all-or-nothing block keyed on the existing record identity', () => {
  const fn = sql.slice(sql.indexOf('function public.found_recall_case'));
  assert.match(fn, /when unique_violation then/, 'the identity race rolls the whole block back');
  assert.match(fn, /'status', 'record_exists'/);
  assert.match(
    fn,
    /'initial:' \|\| v_case_id/,
    'the initial dedup key is anchored to the generated case id',
  );
  assert.match(fn, /on conflict \(dedup_key\) do nothing/);
});

test('the migration touches no RLS policies and no client grants', () => {
  assert.doesNotMatch(sql, /create policy|alter policy|drop policy/i);
  assert.doesNotMatch(sql, /grant[^;]+to anon/i);
  assert.doesNotMatch(sql, /grant[^;]+to authenticated/i);
});
