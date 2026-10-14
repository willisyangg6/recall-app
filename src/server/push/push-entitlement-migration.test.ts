/**
 * The alert entitlement migration (20261018000000): what the SQL text must and
 * must not contain. Runtime behavior is mirrored by MemoryPushStore and proved
 * in entitlement-gate.test.ts. A live run of this migration needs an isolated
 * stack (not run here).
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const FILE = '20261018000000_push_entitlement.sql';
const CODE = readFileSync(join(MIGRATIONS, FILE), 'utf8').replace(/--.*$/gm, '');

function body(fn: string): string {
  const start = CODE.indexOf(`create or replace function public.${fn}(`);
  assert.ok(start >= 0, `${fn} is defined`);
  return CODE.slice(start, CODE.indexOf('$$;', start));
}

test('the purchase id and entitlement live on push_subscriptions, and nowhere else in any migration', () => {
  assert.match(CODE, /alter table public\.push_subscriptions\s+add column purchase_id text/);
  assert.match(CODE, /purchase_id is null or purchase_id ~ '\^\[A-Za-z0-9-\]\{16,64\}\$'/);
  assert.match(CODE, /entitlement_status in \('unknown', 'active', 'inactive'\)/);
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'))) {
    const code = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--.*$/gm, '');
    for (const match of code.matchAll(/alter table public\.(\w+)[^;]*\bpurchase_id\b/g)) {
      assert.equal(match[1], 'push_subscriptions', `${file} puts purchase_id on ${match[1]}`);
    }
    assert.doesNotMatch(
      code,
      /create table[^;]*\bpurchase_id\b/,
      `${file} creates a purchase_id table`,
    );
  }
});

test('one trigger clears the id on ANY disable and resets the entitlement when the id changes', () => {
  const guard = body('push_subscription_entitlement_guard');
  assert.match(guard, /if not new\.enabled then\s+new\.purchase_id := null;/);
  assert.match(
    guard,
    /if not new\.enabled or new\.purchase_id is distinct from old\.purchase_id then/,
  );
  for (const field of [
    "entitlement_status := 'unknown'",
    'entitlement_expires_at := null',
    'entitlement_checked_at := null',
    'entitled_since := null',
  ]) {
    assert.ok(guard.includes(`new.${field}`), field);
  }
  assert.match(
    CODE,
    /create trigger push_subscriptions_entitlement_guard\s+before update on public\.push_subscriptions\s+for each row/,
  );
});

test('errors are fixed strings, and no function returns the purchase id', () => {
  for (const match of CODE.matchAll(/raise exception ([^;]+);/g)) {
    assert.match(match[1], /^'[^'|%]*'$/, `raise carries data: ${match[1]}`);
  }
  for (const fn of [
    'push_register_subscription',
    'register_push_subscription',
    'register_push_subscription_with_revocation_key',
  ]) {
    const returned = body(fn).match(/jsonb_build_object\([^;]*/g) ?? [];
    for (const object of returned) assert.doesNotMatch(object, /purchase_id/, fn);
  }
  // The export reads it once, as its last 4 characters.
  const exported = body('export_installation_data');
  assert.equal((exported.match(/purchase_id/g) ?? []).length, 2); // the key name and the column
  assert.match(exported, /'purchase_id_last4', right\(s\.purchase_id, 4\)/);
});

test('the registrations keep their grants; the internal function and the trigger are never callable', () => {
  assert.match(
    CODE,
    /grant execute on function public\.register_push_subscription\(text, text, text, text, bigint, text\)\s+to anon, authenticated, service_role;/,
  );
  assert.match(
    CODE,
    /grant execute on function public\.register_push_subscription_with_revocation_key\(text, text, text, text, bigint, text, text\)\s+to anon, authenticated;/,
  );
  assert.match(
    CODE,
    /revoke execute on function public\.push_register_subscription\(text, text, text, text, bigint, boolean, text\)\s+from public, anon, authenticated;/,
  );
  assert.match(
    CODE,
    /revoke execute on function public\.push_subscription_entitlement_guard\(\) from public, anon, authenticated;/,
  );
  // The old signatures go, so PostgREST never has two candidates to choose from.
  for (const signature of [
    'push_register_subscription(text, text, text, text, bigint, boolean)',
    'register_push_subscription(text, text, text, text, bigint)',
    'register_push_subscription_with_revocation_key(text, text, text, text, bigint, text)',
  ]) {
    assert.ok(CODE.includes(`drop function public.${signature};`), signature);
  }
  // Older clients omit the id: both public parameters default to null.
  assert.match(body('register_push_subscription'), /p_purchase_id text default null/);
  assert.match(
    body('register_push_subscription_with_revocation_key'),
    /p_purchase_id text default null/,
  );
});

test('the consent-revocation guard is carried over unchanged', () => {
  const internal = body('push_register_subscription');
  assert.match(
    internal,
    /disabled_reason is not distinct from 'consent_revoked'\s+and not p_allow_consent_renewal/,
  );
  const keyed = body('register_push_subscription_with_revocation_key');
  assert.match(keyed, /raise exception 'consent revoked for this installation'/);
  assert.match(keyed, /set app_transaction_hmac = v_hmac/);
});

test('every deletion path still removes the whole row (and with it the purchase id)', () => {
  let latest = '';
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const code = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--.*$/gm, '');
    const start = code.indexOf('create or replace function public.delete_installation_data(');
    if (start >= 0) latest = code.slice(start, code.indexOf('$$;', start));
  }
  assert.match(latest, /delete from public\.push_subscriptions/);
  assert.ok(!CODE.includes('function public.delete_installation_data('), 'not re-bodied here');
});
