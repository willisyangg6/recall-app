/**
 * Shopper reports (P1C) — textual pins against the migration SQL itself, for
 * the properties that only exist in the SQL: RLS with no policies, the
 * service-role-only table surface, SECURITY DEFINER + pinned search_path on
 * every RPC, the revoke/grant surface, validation-shape parity with the
 * other installation RPCs, the jurisdiction mapping's parity with
 * domain/us-geography, the purchase-window enum's parity with
 * domain/shopper-report, the visibility threshold, the non-leaking
 * below-threshold shape, the delete_installation_data extension, and the
 * migration's scope (no shared table is written). Same pin style as
 * installation-deletion.test.ts. Behavioral proofs live in
 * shopper-reports.test.ts and run live over PostgREST on the disposable
 * stack.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  PURCHASE_WINDOWS,
  SHOPPER_REPORT_RETENTION_MONTHS,
  SHOPPER_REPORT_VISIBILITY_THRESHOLD,
} from '../../domain/shopper-report';
import { POSTAL_TO_STATE } from '../../domain/us-geography';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const MIGRATION_FILE = '20260910000000_shopper_reports.sql';
const MIGRATION = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
/** Statements only — comments stripped, so a commented-out line can never satisfy a pin. */
const SQL = MIGRATION.replace(/^\s*--.*$/gm, '');

test('the migration is forward-only: last in the chain, standard name shape', () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  assert.equal(files[files.length - 1], MIGRATION_FILE);
  assert.match(MIGRATION_FILE, /^\d{14}_[a-z_]+\.sql$/);
});

test('both tables enable RLS and the migration creates NO policy', () => {
  assert.ok(SQL.includes('alter table public.shopper_reports enable row level security'));
  assert.ok(SQL.includes('alter table public.shopper_report_config enable row level security'));
  // No policies means the publishable key has no direct row path at all —
  // with the explicit-grant Data API default, no grant + no policy = no
  // read or write in any direction.
  assert.doesNotMatch(SQL, /create\s+policy/i, 'a policy would open a direct row path');
});

test('raw rows are service-role only: no table grant names anon or authenticated', () => {
  for (const line of SQL.split('\n')) {
    if (!/^\s*grant\b/i.test(line) || /grant execute/i.test(line)) continue;
    assert.ok(
      !/anon|authenticated/.test(line),
      `a table grant reaches a public role: ${line.trim()}`,
    );
    assert.match(line, /to service_role/, `a table grant names an unexpected role: ${line.trim()}`);
  }
});

test('every RPC is SECURITY DEFINER with the pinned search_path; the mapping stays pure', () => {
  const bodies = SQL.split(/create or replace function/).slice(1);
  assert.equal(
    bodies.length,
    7,
    'expected the mapping + 4 RPCs + the expiry cleanup + the deletion replacement',
  );
  for (const body of bodies) {
    const head = body.split('$$')[0];
    const name = head.trim().split('(')[0];
    if (name.includes('shopper_report_state_name')) {
      // A pure IMMUTABLE lookup with no table access needs no definer.
      assert.match(head, /immutable/);
      continue;
    }
    assert.match(head, /security definer/, `${name} is not SECURITY DEFINER`);
    assert.match(head, /set search_path = public/, `${name} lacks the pinned search_path`);
  }
});

test('the execute surface: PUBLIC revoked on all seven; anon reaches exactly the five RPCs', () => {
  const revokes = SQL.match(/revoke execute on function [^;]+ from public/g) ?? [];
  assert.equal(revokes.length, 7, 'every created function must revoke PUBLIC execute');

  const anonGrants = (SQL.match(/grant execute on function [^;]+/g) ?? []).filter((grant) =>
    /\banon\b/.test(grant),
  );
  const granted = anonGrants.map((grant) => grant.match(/function public\.(\w+)/)?.[1]).sort();
  assert.deepEqual(granted, [
    'delete_installation_data',
    'get_my_shopper_report',
    'get_shopper_report_summary',
    'submit_shopper_report',
    'withdraw_shopper_report',
  ]);
  // The internal jurisdiction mapping and the expiry cleanup are
  // deliberately not public surface.
  assert.ok(!granted.includes('shopper_report_state_name'));
  assert.ok(!granted.includes('cleanup_expired_shopper_reports'));
});

test('the SQL jurisdiction mapping is exactly domain/us-geography POSTAL_TO_STATE', () => {
  const literal = SQL.match(/select '(\{[\s\S]*?\})'::jsonb/)?.[1];
  assert.ok(literal, 'the jurisdiction mapping literal is missing');
  assert.deepEqual(JSON.parse(literal), POSTAL_TO_STATE);
});

test('the purchase-window vocabulary matches domain/shopper-report in the CHECK and the RPC', () => {
  const expected = PURCHASE_WINDOWS.map((w) => `'${w}'`).join(', ');
  const occurrences = SQL.split(`(${expected})`).length - 1;
  // Once in the column CHECK constraint, once in submit's validation.
  assert.equal(occurrences, 2, 'the closed purchase vocabulary must appear in CHECK and RPC');
});

test('installation ids keep the exact closed shape every other installation RPC enforces', () => {
  const validation = String.raw`p_installation_id !~ '^[A-Za-z0-9-]{16,64}$'`;
  // submit, get, withdraw, delete — each validates before touching a row.
  assert.equal(SQL.split(validation).length - 1, 4);
  assert.ok(
    SQL.includes(String.raw`installation_id ~ '^[A-Za-z0-9-]{16,64}$'`),
    'the column CHECK backstop is missing',
  );
});

test('one report per installation and case is a database constraint, not application memory', () => {
  assert.match(SQL, /unique \(installation_id, recall_case_id\)/);
  assert.match(SQL, /on conflict \(installation_id, recall_case_id\) do update/);
});

test('the visibility threshold is the domain constant, and below it no count is built', () => {
  assert.ok(SQL.includes(`if v_count < ${SHOPPER_REPORT_VISIBILITY_THRESHOLD} then`));
  // The hidden branch builds exactly {"status":"below_threshold"} — one
  // literal serving 0, 1, and 2 alike, with no count key that could leak.
  const hidden = SQL.match(/jsonb_build_object\('status', 'below_threshold'[^)]*\)/g) ?? [];
  assert.equal(hidden.length, 1);
  assert.ok(!hidden[0].includes('count'));
  // The exact total appears only in the visible branch.
  const visible = SQL.match(/jsonb_build_object\('status', 'reported', 'count', v_count\)/g) ?? [];
  assert.equal(visible.length, 1);
});

test('the summary body never touches state, retailer, installation, or row aggregation', () => {
  const summaryBody = SQL.split('get_shopper_report_summary')[1]?.split('$$;')[0] ?? '';
  assert.ok(summaryBody.length > 0);
  assert.doesNotMatch(summaryBody, /retailer_name|state_code|installation_id|jsonb_agg|array_agg/);
});

test('the report table stores exactly the authorized fields — nothing free-text or health-shaped', () => {
  const createBlock = SQL.match(/create table public\.shopper_reports \(([\s\S]*?)\n\);/)?.[1];
  assert.ok(createBlock);
  const columns = createBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-z_]+ (uuid|text|integer|timestamptz)\b/.test(line))
    .map((line) => line.split(' ')[0])
    .sort();
  assert.deepEqual(columns, [
    'created_at',
    'expires_at',
    'id',
    'installation_id',
    'purchase_window',
    'recall_case_id',
    'retailer_name',
    'state_code',
    'updated_at',
    'version',
  ]);
  const forbidden = [
    'symptom',
    'illness',
    'email',
    'phone',
    'address',
    'photo',
    'receipt',
    'note',
    'comment',
    'ip_',
    'lot_',
  ];
  for (const field of forbidden) {
    assert.ok(!createBlock.includes(field), `schema carries a forbidden field: ${field}`);
  }
});

test('retailer validation is exact membership in the case projection — no catalog, no free text', () => {
  assert.ok(
    SQL.includes(
      String.raw`coalesce(v_case.projection -> 'retailerNames', '[]'::jsonb) ? p_retailer_name`,
    ),
  );
  // No reference to the personalization retailer catalog: a legitimate
  // notice identity outside the catalog stays submittable.
  assert.doesNotMatch(SQL, /retailer_catalog|retailer_ids/);
});

test('eligibility reads the canonical projection: active, non-merged, usable geography', () => {
  assert.ok(SQL.includes(`v_case.merged_into is not null or v_case.state <> 'active'`));
  assert.ok(SQL.includes(`v_case.projection -> 'geography' ->> 'scope'`));
  assert.ok(SQL.includes(`v_case.projection -> 'geography' -> 'states' ? v_state_name`));
});

test('the kill switch defaults OFF, is seeded OFF, and gates only submit and the public summary', () => {
  assert.match(SQL, /reports_enabled boolean not null default false/);
  assert.match(
    SQL,
    /insert into public\.shopper_report_config \(id, reports_enabled\) values \(true, false\)/,
  );
  const gated = SQL.match(/where reports_enabled/g) ?? [];
  assert.equal(gated.length, 2, 'exactly submit + summary consult the gate');
  const getBody = SQL.split('get_my_shopper_report')[1]?.split('$$;')[0] ?? '';
  const withdrawBody = SQL.split('withdraw_shopper_report')[1]?.split('$$;')[0] ?? '';
  for (const body of [getBody, withdrawBody]) {
    assert.ok(body.length > 0);
    assert.ok(!body.includes('reports_enabled'), 'own-data access must never be gated');
  }
});

test('delete_installation_data keeps every C7.1 delete and adds shopper reports atomically', () => {
  const deletion = SQL.split('create or replace function public.delete_installation_data')[1] ?? '';
  assert.ok(deletion.includes('for update'), 'the delivery-worker serialization lock survives');
  const deletes = deletion.match(/delete from\s+[a-z_.]+/g) ?? [];
  assert.deepEqual(deletes.sort(), [
    'delete from public.installation_preferences',
    'delete from public.notification_deliveries',
    'delete from public.push_subscriptions',
    'delete from public.shopper_reports',
  ]);
  // FK order preserved: deliveries before their subscriptions.
  assert.ok(
    deletion.indexOf('delete from public.notification_deliveries') <
      deletion.indexOf('delete from public.push_subscriptions'),
  );
});

test('withdrawal is physical deletion — no tombstone, no analytics copy, no soft-delete flag', () => {
  const withdrawBody = SQL.split('withdraw_shopper_report')[1]?.split('$$;')[0] ?? '';
  assert.match(withdrawBody, /delete from public\.shopper_reports/);
  assert.doesNotMatch(SQL, /deleted_at|archived|tombstone|soft_delete/i);
});

test('the migration touches no shared table beyond reading recall_cases and the C7.1 deletes', () => {
  for (const shared of [
    'notification_events',
    'source_records',
    'source_snapshots',
    'affected_products',
    'ingest_runs',
    'job_leases',
    'push_delivery_config',
    'consumer_feed_manifest',
    'product_visuals',
    'watchdog',
  ]) {
    assert.ok(!SQL.includes(shared), `migration statements must not reference ${shared}`);
  }
  // recall_cases appears only as the FK target and eligibility reads —
  // never as a write target.
  assert.doesNotMatch(SQL, /(insert into|update|delete from)\s+public\.recall_cases/);
});

test('no secret, credential, or key material appears anywhere in the migration', () => {
  assert.doesNotMatch(
    MIGRATION,
    /sb_secret|service_role_key|ghp_[A-Za-z0-9]|github_pat_|password/i,
  );
});

test('the retention interval is the domain constant, set on insert and reset only by an edit', () => {
  const interval = `interval '${SHOPPER_REPORT_RETENTION_MONTHS} months'`;
  // Column default + the insert values + the DO UPDATE reset — exactly three.
  assert.equal(SQL.split(interval).length - 1, 3, 'the 12-month interval must appear three times');
  // The reset lives INSIDE the conditional DO UPDATE, so the WHERE that
  // suppresses identical retries also suppresses retention extension.
  const upsert = SQL.split('on conflict (installation_id, recall_case_id) do update')[1] ?? '';
  const doUpdate = upsert.split('returning')[0];
  assert.ok(
    doUpdate.includes(`expires_at = now() + ${interval}`),
    'the edit path must reset expiry',
  );
  assert.match(doUpdate, /where sr\.state_code is distinct from/, 'the idempotency gate survives');
});

test('the expiry boundary is one rule everywhere: <= now() is expired, > now() is live', () => {
  // Expired (inclusive): the submit pre-delete and the physical cleanup.
  assert.equal(SQL.split('expires_at <= now()').length - 1, 2);
  // Live (exclusive): the owner read and the public count.
  assert.equal(SQL.split('expires_at > now()').length - 1, 2);
  // The owner read and the summary each apply the filter — no state where a
  // row is expired for the aggregate yet still visible to its owner.
  const getBody = SQL.split('get_my_shopper_report')[1]?.split('$$;')[0] ?? '';
  const summaryBody = SQL.split('get_shopper_report_summary')[1]?.split('$$;')[0] ?? '';
  assert.ok(getBody.includes('expires_at > now()'));
  assert.ok(summaryBody.includes('expires_at > now()'));
  // A fresh submission clears the caller's own expired row first, so an
  // expired row can never block the insert path or revive its metadata.
  const submitBody = SQL.split('create or replace function public.submit_shopper_report')[1] ?? '';
  const preDelete = submitBody.split('insert into')[0];
  assert.ok(preDelete.includes('expires_at <= now()'), 'submit must clear the expired row first');
  assert.match(preDelete, /installation_id = p_installation_id/, 'pre-delete is own-row only');
});

test('expiry-aware indexes back the aggregation and the cleanup', () => {
  assert.ok(
    SQL.includes(
      'create index shopper_reports_case_idx on public.shopper_reports (recall_case_id, expires_at)',
    ),
  );
  assert.ok(
    SQL.includes('create index shopper_reports_expiry_idx on public.shopper_reports (expires_at)'),
  );
});

test('the cleanup function is narrow: one delete, expired rows only, no public execute', () => {
  const body = SQL.split(
    'create or replace function public.cleanup_expired_shopper_reports',
  )[1]?.split('$$;')[0];
  assert.ok(body);
  const deletes = body.match(/delete from\s+[a-z_.]+/g) ?? [];
  assert.deepEqual(deletes, ['delete from public.shopper_reports'], 'cleanup deletes one table');
  assert.ok(body.includes('expires_at <= now()'), 'cleanup must be expired-only');
  assert.doesNotMatch(body, /insert|update\s+public|truncate/i, 'cleanup only deletes');
  // Grants: revoked from PUBLIC, service_role only — never anon/authenticated.
  assert.ok(
    SQL.includes('revoke execute on function public.cleanup_expired_shopper_reports() from public'),
  );
  const cleanupGrants = (
    SQL.match(/grant execute on function public\.cleanup_expired_shopper_reports[^;]+/g) ?? []
  ).join('\n');
  assert.ok(cleanupGrants.includes('to service_role'));
  assert.doesNotMatch(cleanupGrants, /anon|authenticated/);
});

test('exactly one daily cron job, idempotently registered, running only the cleanup', () => {
  const schedules = SQL.match(/cron\.schedule\(/g) ?? [];
  assert.equal(schedules.length, 1, 'exactly one schedule in this migration');
  const job = SQL.split('cron.schedule(')[1] ?? '';
  assert.match(job, /'recall-shopper-report-expiry'/, 'the unique job name');
  // Daily cadence: fixed minute and hour, every day.
  assert.match(job, /'\d{1,2} \d{1,2} \* \* \*'/, 'cadence must be once per day');
  assert.ok(
    job.includes('select public.cleanup_expired_shopper_reports();'),
    'job runs cleanup only',
  );
  assert.doesNotMatch(job, /http|net\.|vault|secret/i, 'the job touches nothing external');
  // The watchdog-style unschedule guard makes re-application replace, not
  // duplicate, the job.
  assert.ok(
    SQL.includes(
      "if exists (select 1 from cron.job where jobname = 'recall-shopper-report-expiry') then",
    ),
  );
  assert.ok(SQL.includes("perform cron.unschedule('recall-shopper-report-expiry')"));
});

test('the accepted MVP limitation is recorded honestly — no verified-human claim anywhere', () => {
  // The feature gate still ships OFF (pinned above too — restated here as
  // part of the accepted-limitation contract), and no attestation, account,
  // fingerprinting, IP-storage, or quota mechanism entered the migration.
  assert.match(SQL, /reports_enabled boolean not null default false/);
  // Statements only: the header COMMENTS legitimately name attestation and
  // rate limiting as absent/future — no such mechanism may appear in code.
  for (const forbidden of [
    'attest',
    'fingerprint',
    'ip_address',
    'rate_limit',
    'quota',
    'captcha',
  ]) {
    assert.ok(!SQL.toLowerCase().includes(forbidden), `unexpected mechanism: ${forbidden}`);
  }
  // Honesty pin on the header itself: the migration must not describe the
  // system as Sybil-proof (the phrase may only appear negated) and must
  // not claim verified or unique humans.
  assert.doesNotMatch(MIGRATION, /verified[- ]human|one person one report|sybil-?proof(?! —)/i);
  assert.match(MIGRATION, /NOT Sybil-proof/, 'the limitation must stay stated');
});
