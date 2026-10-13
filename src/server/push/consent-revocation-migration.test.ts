/**
 * 20261017000000_consent_revocation (age assurance, 2026-10-13): the pins a
 * reader of the SQL alone would want. The behaviour itself — hashing,
 * matching, replay, the missing-key refusal, export and reset — was run
 * against an isolated local stack (docs/recall-push-delivery.md,
 * "Consent revocation").
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
    '20261017000000_consent_revocation.sql',
  ),
  'utf8',
).replace(/--.*$/gm, '');

test('the key is generated on the server into Vault, never written as a literal', () => {
  assert.match(SQL, /vault\.create_secret\(\s*encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/);
  assert.match(
    SQL,
    /where not exists \(select 1 from vault\.secrets where name = 'app_transaction_hmac_key'\)/,
  );
  assert.doesNotMatch(SQL, /'[0-9a-f]{32,}'/i, 'no key material in the file');
});

test('only a keyed hash is stored; the raw Apple id has no column anywhere', () => {
  assert.match(
    SQL,
    /add column app_transaction_hmac text\s+check \(app_transaction_hmac is null or app_transaction_hmac ~ '\^\[0-9a-f\]\{64\}\$'\)/,
  );
  // Columns are only ever created by `add column` or `create table`.
  const columns = [
    ...[...SQL.matchAll(/add column (\w+)/g)].map((m) => m[1]),
    ...[...SQL.matchAll(/create table [\w.]+ \(([^;]*)\);/g)].flatMap((m) =>
      m[1].split(',\n').map((line) => line.trim().split(/\s+/)[0]),
    ),
  ];
  assert.ok(columns.includes('app_transaction_hmac'));
  assert.ok(!columns.some((name) => name === 'app_transaction_id'), columns.join(','));
  assert.match(SQL, /extensions\.hmac\(p_app_transaction_id, v_key, 'sha256'\)/);
  assert.match(SQL, /raise exception 'consent revocation key is not configured'/);
});

test('the receipts table holds no installation id and no Apple identifier', () => {
  const table = SQL.slice(SQL.indexOf('create table public.app_store_notification_receipts'));
  const columns = table.slice(0, table.indexOf(');'));
  assert.doesNotMatch(columns, /installation_id|app_transaction|hmac/);
  assert.match(
    SQL,
    /alter table public\.app_store_notification_receipts enable row level security;/,
  );
});

test('the client may only set or clear its own key; revocation is service_role only', () => {
  assert.match(
    SQL,
    /grant execute on function public\.register_push_subscription_with_revocation_key\(text, text, text, text, bigint, text\)\s+to anon, authenticated;/,
  );
  assert.match(
    SQL,
    /grant execute on function public\.clear_push_revocation_key\(text\) to anon, authenticated;/,
  );
  assert.match(
    SQL,
    /revoke execute on function public\.push_register_subscription\(text, text, text, text, bigint, boolean\)\s+from public, anon, authenticated;/,
  );
  assert.doesNotMatch(SQL, /set_push_revocation_key/);
  assert.match(
    SQL,
    /revoke execute on function public\.apply_consent_revocation\(uuid, text, text, timestamptz, text\)\s+from public, anon, authenticated;/,
  );
  assert.match(
    SQL,
    /grant execute on function public\.apply_consent_revocation\(uuid, text, text, timestamptz, text\)\s+to service_role;/,
  );
  assert.match(
    SQL,
    /revoke execute on function public\.app_transaction_hmac\(text\) from public, anon, authenticated;/,
  );
  assert.doesNotMatch(
    SQL,
    /grant [^;]* on public\.app_store_notification_receipts to (anon|authenticated)/,
  );
});

test('a revocation is recorded before it acts, and a replay acts on nothing', () => {
  const body = SQL.slice(SQL.indexOf('create or replace function public.apply_consent_revocation'));
  const hash = body.indexOf('v_hmac := public.app_transaction_hmac');
  const insert = body.indexOf('insert into public.app_store_notification_receipts');
  const conflict = body.indexOf('on conflict (notification_uuid) do nothing');
  const duplicate = body.indexOf("return jsonb_build_object('duplicate', true");
  const disable = body.indexOf("disabled_reason = 'consent_revoked'");
  assert.ok(
    hash > 0 && hash < insert,
    'hash first: a missing key raises before anything is recorded',
  );
  assert.ok(insert < conflict && conflict < duplicate && duplicate < disable);
  assert.match(body, /if p_notification_type is distinct from 'RESCIND_CONSENT' then/);
  assert.match(body, /where app_transaction_hmac = v_hmac\s+and enabled;/);
});

test('it disables, never deletes; it re-bodies only register_push_subscription', () => {
  assert.doesNotMatch(SQL, /delete from public\.push_subscriptions/);
  const defined = [...SQL.matchAll(/create or replace function (public\.[a-z_]+)/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(defined, [
    'public.app_transaction_hmac',
    'public.push_register_subscription',
    'public.register_push_subscription',
    'public.register_push_subscription_with_revocation_key',
    'public.clear_push_revocation_key',
    'public.apply_consent_revocation',
  ]);
  assert.doesNotMatch(SQL, /function public\.delete_installation_data/);
});

test('no silent revival: the plain registration keeps a revoked row disabled', () => {
  const core = SQL.slice(
    SQL.indexOf('create or replace function public.push_register_subscription'),
    SQL.indexOf('create or replace function public.register_push_subscription('),
  );
  assert.match(
    core,
    /enabled = not \(public\.push_subscriptions\.disabled_reason is not distinct from 'consent_revoked'\s+and not p_allow_consent_renewal\)/,
  );
  const plain = SQL.slice(
    SQL.indexOf('create or replace function public.register_push_subscription('),
    SQL.indexOf('create or replace function public.register_push_subscription_with_revocation_key'),
  );
  assert.match(
    plain,
    /p_installation_id, p_expo_push_token, p_platform, p_app_version, p_sequence, false/,
  );
});

test('the keyed registration is atomic and renews only for the same Apple Account', () => {
  const keyed = SQL.slice(
    SQL.indexOf('create or replace function public.register_push_subscription_with_revocation_key'),
    SQL.indexOf('create or replace function public.clear_push_revocation_key'),
  );
  const hash = keyed.indexOf('v_hmac := public.app_transaction_hmac');
  const guard = keyed.indexOf(
    "if v_reason = 'consent_revoked' and v_stored is distinct from v_hmac",
  );
  const register = keyed.indexOf('v_result := public.push_register_subscription');
  const store = keyed.indexOf('set app_transaction_hmac = v_hmac');
  assert.ok(hash > 0 && hash < guard && guard < register && register < store);
  assert.match(keyed, /if p_app_transaction_id is null/);
});
