/**
 * Migration pins for Data API role least privilege — the repo's standing
 * migration-security pattern (consumer-manifest.test.ts, watchdog
 * contract.test.ts): the SQL is read as text, comments are stripped so a
 * commented-out line can never satisfy a pin, and the load-bearing
 * statements are asserted exactly.
 *
 * The platform's default ACL for relations `postgres` creates in `public`
 * gave anon and authenticated TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on
 * every relation. TRUNCATE is not subject to RLS. The migration removes all
 * four, existing and default, and touches nothing else. The last two tests
 * hold every migration — including future ones — to the same surface.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const MIGRATION_FILE = '20261010000000_data_api_role_least_privilege.sql';

/** Comment lines removed: a pin must match live SQL, never prose. */
function stripComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, '');
}

const SQL = stripComments(readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8'));

/** The relations the app reads with the publishable key, and nothing else. */
const FEED_RELATIONS = [
  'affected_products',
  'consumer_feed_manifest',
  'product_visuals',
  'recall_cases',
];

test('revokes the four privileges from the Data API roles on every relation in public', () => {
  assert.match(
    SQL,
    /revoke truncate, references, trigger, maintain\s+on all tables in schema public\s+from anon, authenticated;/,
  );
});

test('and from the default ACL, so a new table is not created with them', () => {
  assert.match(
    SQL,
    /alter default privileges for role postgres in schema public\s+revoke truncate, references, trigger, maintain on tables\s+from anon, authenticated;/,
  );
});

test('touches nothing else: no grants, no read/write/execute revokes, no service_role, no RLS', () => {
  assert.doesNotMatch(SQL, /^\s*grant\b/im);
  assert.doesNotMatch(SQL, /default privileges[^;]*\bgrant\b/i);
  const revoked = [...SQL.matchAll(/\brevoke\s+([^;]*?)\s+on\b/gi)].map((m) => m[1]);
  assert.deepEqual(revoked, [
    'truncate, references, trigger, maintain',
    'truncate, references, trigger, maintain',
  ]);
  assert.doesNotMatch(SQL, /service_role/);
  assert.doesNotMatch(SQL, /\b(create|alter|drop) policy\b/i);
  assert.doesNotMatch(SQL, /row level security/i);
  assert.doesNotMatch(SQL, /^\s*(drop|delete|truncate|update|insert)\b/im);
});

test('relies on the per-file migration transaction rather than managing its own', () => {
  // A COMMIT inside the file would end the CLI's transaction early and let
  // the revokes survive a failed assertion.
  assert.doesNotMatch(SQL, /^\s*(begin|commit|rollback)\s*;/im);
});

test('fails closed on a leftover privilege, a leftover default, or a lost feed read', () => {
  assert.match(SQL, /raise exception 'Data API roles still hold: %'/);
  assert.match(SQL, /raise exception 'Default ACL still grants Data API roles: %'/);
  assert.match(SQL, /raise exception 'Deliberate SELECT grant lost: %'/);
  // Views, materialized views, partitions and foreign tables count, not just tables.
  assert.match(SQL, /c\.relkind in \('r', 'v', 'm', 'p', 'f'\)/);
  for (const relation of FEED_RELATIONS) {
    assert.match(SQL, new RegExp(`\\('${relation}'\\)`), `${relation} read is not asserted`);
  }
});

/** Every GRANT statement in every migration, comments stripped. */
function allGrantStatements(): { file: string; statement: string }[] {
  const grants: { file: string; statement: string }[] = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql'))) {
    const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    for (const raw of sql.split(';')) {
      const statement = raw.replace(/\s+/g, ' ').trim().toLowerCase();
      if (/^(grant|alter default privileges)\b/.test(statement) && /\bgrant\b/.test(statement)) {
        grants.push({ file, statement });
      }
    }
  }
  return grants;
}

const toDataApiRole = (statement: string) =>
  /\bto\b.*\b(anon|authenticated|public)\b/.test(statement.slice(statement.lastIndexOf(' to ')));

test('no migration grants the Data API roles TRUNCATE, REFERENCES, TRIGGER, MAINTAIN or ALL', () => {
  const offenders = allGrantStatements().filter(({ statement }) => {
    const privileges = statement.match(/\bgrant\b(.*?)\bon\b/)?.[1] ?? '';
    return (
      toDataApiRole(statement) && /\b(all|truncate|references|trigger|maintain)\b/.test(privileges)
    );
  });
  assert.deepEqual(offenders, []);
});

test('the only table privilege the Data API roles hold is SELECT on the feed relations', () => {
  const granted = new Set<string>();
  for (const { statement } of allGrantStatements()) {
    if (!toDataApiRole(statement) || /\bon (function|schema|sequence)\b/.test(statement)) continue;
    const match = statement.match(/^grant (.+?) on (?:table )?(.+?) to /);
    assert.ok(match, `unparsed grant: ${statement}`);
    for (const privilege of match[1].split(',').map((p) => p.trim())) {
      for (const relation of match[2].split(',').map((r) => r.trim().replace(/^public\./, ''))) {
        granted.add(`${privilege} ${relation}`);
      }
    }
  }
  assert.deepEqual(
    [...granted].sort(),
    FEED_RELATIONS.map((relation) => `select ${relation}`),
    'a new anon-readable relation is a change to the client surface: update this list deliberately',
  );
});
