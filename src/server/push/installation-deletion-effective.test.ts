/**
 * "Reset app and delete my data" — the EFFECTIVE server definition.
 *
 * delete_installation_data is redefined by `create or replace` whenever a
 * migration adds an installation-keyed table, and each redefinition replaces
 * the whole body. The per-migration pins (installation-deletion.test.ts,
 * shopper-reports-migration.test.ts) each read their own file, so they kept
 * passing when 20261004000000_push_subscription_sequence re-bodied the
 * function from an older text and silently dropped shopper_reports
 * (restored by 20261012000000).
 *
 * These pins read the WHOLE migration chain instead: the definition that
 * production runs is the one in the last migration (by filename order) that
 * defines the function, and it must delete from every table that carries an
 * installation_id column — plus the delivery records reached through the
 * installation's subscriptions. A new installation-keyed table fails here
 * until the reset covers it.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

/** Each migration's statements, comments stripped, in apply (filename) order. */
const CHAIN = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8').replace(/--.*$/gm, ''),
  }));

const DEFINE = 'create or replace function public.delete_installation_data';

function effectiveDefinition(): { name: string; body: string } {
  const defining = CHAIN.filter((migration) => migration.sql.includes(DEFINE));
  const last = defining.at(-1);
  assert.ok(last, 'some migration defines delete_installation_data');
  const body = last.sql.split(DEFINE)[1]?.split('$$;')[0] ?? '';
  assert.ok(body.length > 0);
  return { name: last.name, body };
}

/** Every table created anywhere in the chain with an installation_id column. */
function installationKeyedTables(): string[] {
  const tables = new Set<string>();
  for (const { sql } of CHAIN) {
    for (const match of sql.matchAll(/create table (public\.[a-z_]+) \(([\s\S]*?)\n\);/g)) {
      if (/^\s*installation_id\s+text\b/m.test(match[2] ?? '')) tables.add(match[1] as string);
    }
  }
  return [...tables].sort();
}

test('the installation-keyed tables are the four the reset must cover', () => {
  // A deliberate inventory: adding a table with an installation_id column
  // changes this list, and the next test then demands the reset covers it.
  assert.deepEqual(installationKeyedTables(), [
    'public.installation_preferences',
    'public.push_installation_sequences',
    'public.push_subscriptions',
    'public.shopper_reports',
  ]);
});

test('the effective delete_installation_data deletes from every installation-keyed table', () => {
  const { name, body } = effectiveDefinition();
  const deleted = new Set(
    [...body.matchAll(/delete from\s+(public\.[a-z_]+)/g)].map((match) => match[1] as string),
  );
  for (const table of installationKeyedTables()) {
    assert.ok(deleted.has(table), `${name} must delete from ${table}`);
  }
  // Delivery records carry no installation_id; they are reached through the
  // installation's subscriptions.
  assert.ok(deleted.has('public.notification_deliveries'), `${name} must delete deliveries`);
  assert.deepEqual(
    [...deleted].sort(),
    [...installationKeyedTables(), 'public.notification_deliveries'].sort(),
    'and nothing else',
  );
});

test('the effective definition keeps validation, the worker lock and FK order', () => {
  const { body } = effectiveDefinition();
  assert.ok(body.includes(String.raw`'^[A-Za-z0-9-]{16,64}$'`));
  assert.match(body, /raise exception 'invalid installation id'/);
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = public/);
  const lock = body.indexOf('for update');
  const deliveries = body.indexOf('delete from public.notification_deliveries');
  const subscriptions = body.indexOf('delete from public.push_subscriptions');
  assert.ok(lock > 0 && lock < deliveries, 'the FOR UPDATE lock precedes every delete');
  assert.ok(deliveries < subscriptions, 'deliveries are deleted before their subscriptions');
});
