/**
 * Privacy requests migration (20261016000000): what the SQL text may and may
 * not contain. The runtime proof (single use, expiry, guessing, isolation,
 * the count gate) is privacy-requests-live.test.ts on an isolated stack.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { EXPORT_FIELDS } from '../../lib/privacy-requests';

const SQL = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'supabase',
    'migrations',
    '20261016000000_privacy_requests.sql',
  ),
  'utf8',
);
/** Statements only: the header explains the design in prose that names things. */
const CODE = SQL.replace(/--.*$/gm, '');

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

/**
 * The CURRENT definition of a function: the last migration (in apply order)
 * that defines it. The export is re-bodied by later migrations (the alert
 * entitlement gate, 20261018000000), and what ships is the latest body.
 */
function latestBody(fn: string): string {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files.reverse()) {
    const code = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--.*$/gm, '');
    const start = code.indexOf(`create or replace function public.${fn}(`);
    if (start >= 0) return code.slice(start, code.indexOf('$$;', start));
  }
  throw new Error(`${fn} is not defined by any migration`);
}

function body(fn: string): string {
  const start = CODE.indexOf(`create or replace function public.${fn}(`);
  assert.ok(start >= 0, `${fn} is defined`);
  return CODE.slice(start, CODE.indexOf('$$;', start));
}

function grantees(signature: string): string[] {
  const match = new RegExp(
    String.raw`grant execute on function public\.${signature.replace(/[()]/g, (c) => `\\${c}`)}\s+to ([^;]+);`,
  ).exec(CODE);
  assert.ok(match, `${signature} is granted`);
  return match[1].split(',').map((role) => role.trim());
}

test('the table stores the code hash, never the code', () => {
  const table = CODE.slice(CODE.indexOf('create table public.installation_request_codes'));
  const columns = table.slice(0, table.indexOf('\n);'));
  assert.match(columns, /code_hash text primary key check \(code_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.ok(!/^\s*code\s+text/m.test(columns), 'no plain code column');
  assert.match(columns, /purpose text not null check \(purpose in \('access', 'delete'\)\)/);
  assert.match(columns, /check \(expires_at = created_at \+ interval '14 days'\)/);
  // The insert hashes the code; the plain code is only in the response.
  assert.match(
    body('create_privacy_request_code'),
    /encode\(sha256\(convert_to\(v_code, 'UTF8'\)\), 'hex'\)/,
  );
});

test('no client role can read the table or test a code', () => {
  assert.match(CODE, /alter table public\.installation_request_codes enable row level security;/);
  assert.ok(
    !/grant [^;]* on public\.installation_request_codes to [^;]*(anon|authenticated)/.test(CODE),
  );
  for (const signature of [
    'lookup_privacy_request(text)',
    'redeem_privacy_request(text, integer)',
    'installation_data_row_counts(text)',
    'purge_spent_request_codes()',
  ]) {
    assert.deepEqual(grantees(signature), ['service_role'], signature);
    assert.match(
      CODE,
      new RegExp(
        `revoke execute on function public\\.${signature.replace(/[()]/g, (c) => `\\${c}`)} from public;`,
      ),
    );
  }
  // The app's two: the installation's own read, and creating its own code.
  assert.deepEqual(grantees('export_installation_data(text)'), [
    'anon',
    'authenticated',
    'service_role',
  ]);
  assert.deepEqual(grantees('create_privacy_request_code(text, text)'), [
    'anon',
    'authenticated',
    'service_role',
  ]);
});

test('redemption is single use and consumes nothing when it refuses', () => {
  const redeem = body('redeem_privacy_request');
  const lock = redeem.indexOf('pg_advisory_xact_lock');
  const rowLock = redeem.indexOf('for update');
  const gate = redeem.indexOf("'count_changed'");
  const consume = redeem.indexOf('set used_at = now()');
  assert.ok(lock > 0 && lock < rowLock, 'the installation lock precedes the code row lock');
  assert.ok(rowLock < gate && gate < consume, 'the count gate returns before anything is written');
  assert.match(redeem, /and c\.used_at is null\s+and c\.expires_at > now\(\)\s+for update/);
  assert.match(
    redeem,
    /where code_hash = p_code_hash\s+and used_at is null\s+and expires_at > now\(\);/,
  );
  // Deletion goes through the one shared function.
  assert.match(redeem, /perform public\.delete_installation_data\(v_installation_id\);/);
});

test('creation takes the same installation lock first and keeps at most three live codes', () => {
  const create = body('create_privacy_request_code');
  assert.ok(
    create.indexOf("pg_advisory_xact_lock(hashtextextended('installation:'") <
      create.indexOf('delete from public.installation_request_codes'),
  );
  assert.match(create, /offset 2/);
  assert.match(create, /extensions\.gen_random_bytes\(12\)/);
  assert.match(create, /get_byte\(v_bytes, v_index\) & 31/);
});

test('errors are fixed strings: no code, hash, id or contents can reach a log', () => {
  for (const match of CODE.matchAll(/raise exception ([^;]+);/g)) {
    assert.match(match[1], /^'[^'|%]*'$/, `raise carries data: ${match[1]}`);
  }
});

test('the export is an explicit list of approved fields, identical to EXPORT_FIELDS', () => {
  const exported = latestBody('export_installation_data');
  // No whole-row export: a column added by a later migration (an age or
  // consent-revocation key, a hash) must never flow out automatically.
  assert.ok(!/to_jsonb\([a-z]+\)\s*-\s*'/.test(exported), 'no to_jsonb(row) - … subtraction');
  assert.ok(!/jsonb_agg\(\s*to_jsonb/.test(exported), 'no jsonb_agg(to_jsonb(row))');
  assert.ok(!/row_to_json|\.\*/.test(exported), 'no row_to_json or select *');
  // Reading a named key out of to_jsonb(row) is allowed only for the
  // approved consent fields (they arrive with a separate migration).
  for (const match of exported.matchAll(/to_jsonb\(p\) -> '([a-z_]+)'/g)) {
    assert.ok(match[1].startsWith('allergen_consent_'), `unapproved by-name read: ${match[1]}`);
  }

  // Each group's keys, in order, read from the SQL.
  const groupKeys = (group: string): string[] => {
    const start = exported.indexOf(`'${group}', `);
    assert.ok(start >= 0, `group ${group} is exported`);
    const open = exported.indexOf('jsonb_build_object(', start);
    let depth = 0;
    let end = open;
    for (let index = open; index < exported.length; index += 1) {
      if (exported[index] === '(') depth += 1;
      if (exported[index] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    const inner = exported.slice(open + 'jsonb_build_object('.length, end);
    // Top-level keys only: a key sits at the start of a line inside the object.
    return [...inner.matchAll(/^\s*'([a-z0-9_]+)',/gm)].map((m) => m[1]);
  };
  for (const [group, fields] of Object.entries(EXPORT_FIELDS)) {
    assert.deepEqual(groupKeys(group), [...fields], `${group} fields`);
  }

  // What is left out on purpose never appears as an exported key.
  for (const never of [
    'installation_id',
    'expo_push_token',
    'purchase_id',
    'app_transaction_hmac',
    'code_hash',
    'user_id',
    'version',
    'id',
  ]) {
    for (const fields of Object.values(EXPORT_FIELDS)) {
      assert.ok(!(fields as readonly string[]).includes(never), `${never} is not exported`);
    }
  }
});

test('the export masks the push token and the operator never sees the whole id', () => {
  const exported = latestBody('export_installation_data');
  // The purchase id unlocks the subscription in RevenueCat's SDK: last 4 only.
  assert.match(exported, /'purchase_id_last4', right\(s\.purchase_id, 4\)/);
  assert.equal((exported.match(/s\.purchase_id\b/g) ?? []).length, 1);
  assert.match(exported, /'push_token', '…' \|\| right\(rtrim\(s\.expo_push_token, '\]'\), 4\)/);
  assert.match(exported, /ExponentPushToken\[…\]/);
  assert.match(exported, /\bstable\b/);
  assert.match(
    body('lookup_privacy_request'),
    /'installation_hint', left\(v_row\.installation_id, 4\)/,
  );
  assert.ok(!/'installation_id',/.test(body('lookup_privacy_request')));
});

test('spent codes are cleaned up daily, 30 days after use or expiry', () => {
  assert.match(
    body('purge_spent_request_codes'),
    /where coalesce\(used_at, expires_at\) < now\(\) - interval '30 days'/,
  );
  assert.match(CODE, /cron\.schedule\(\s*'recall-request-code-cleanup'/);
});
