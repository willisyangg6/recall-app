/**
 * Allergen consent (20261014000000) — pinned against the EFFECTIVE
 * definitions: the last migration (by filename) that defines each function.
 * A future re-body of apply_installation_preferences or either
 * set_installation_preferences that drops the consent rule fails here (the
 * same lesson as installation-deletion-effective.test.ts). Behavior was run
 * on an isolated local stack; see docs/recall-personalization.md.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { ALLERGEN_CONSENT_VERSIONS } from '@/lib/allergen-consent';

const DIR = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const CHAIN = readdirSync(DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(DIR, name), 'utf8').replace(/--.*$/gm, '') }));

/** The last definition whose signature starts with `head`, and its body. */
function effective(head: string): { name: string; body: string } {
  let found: { name: string; body: string } | null = null;
  for (const { name, sql } of CHAIN) {
    let from = 0;
    for (;;) {
      const at = sql.indexOf(head, from);
      if (at < 0) break;
      const end = sql.indexOf('$$;', sql.indexOf('$$', at) + 2);
      found = { name, body: sql.slice(at, end) };
      from = end;
    }
  }
  assert.ok(found, `${head} is defined`);
  return found;
}

const APPLY = 'create or replace function public.apply_installation_preferences(';
const PLURAL =
  'create or replace function public.set_installation_preferences(\n  p_installation_id text,\n  p_state_codes text[]';
const LEGACY =
  'create or replace function public.set_installation_preferences(\n  p_installation_id text,\n  p_state_code text,';

test('the effective apply_installation_preferences stores no allergens without a consent version', () => {
  const { name, body } = effective(APPLY);
  assert.match(body, /p_allergen_consent text/, `${name} takes the consent`);
  assert.match(body, /if v_consent is null then\s*v_allergens := '\{\}';/);
  // Exactly the client's accepted disclosures: the long sheet and the compact prompt.
  const listed = /not in \(([^)]*)\)/.exec(
    body.slice(body.indexOf('p_allergen_consent is not null')),
  );
  assert.ok(listed, 'only known consent versions are stored');
  assert.deepEqual(
    listed[1].split(',').map((v) => v.trim().replace(/'/g, '')),
    [...ALLERGEN_CONSENT_VERSIONS],
  );
  assert.match(body, /raise exception 'invalid allergen consent'/);
  // The no-op check includes consent, so a consent change is never swallowed.
  assert.match(body, /allergen_consent_version is not distinct from v_consent/);
  assert.match(body, /allergen_consent_version = excluded\.allergen_consent_version/);
});

test('the plural RPC defaults consent to null and the legacy RPC always sends null', () => {
  const plural = effective(PLURAL);
  assert.match(plural.body, /p_allergen_consent text default null/);
  assert.match(plural.body, /p_allergen_consent_decided_at timestamptz default null/);
  assert.match(
    plural.body,
    /p_retailer_ids,\s*p_allergen_consent,\s*p_allergen_consent_decided_at\s*\)/,
  );
  const legacy = effective(LEGACY);
  assert.match(legacy.body, /p_retailer_ids,\s*null,\s*null\s*\)/);
});

test('the old 4-argument plural and apply signatures are dropped, so PostgREST has one candidate', () => {
  const migration = CHAIN.find((m) => m.name.startsWith('20261014000000'));
  assert.ok(migration);
  assert.match(
    migration.sql,
    /drop function if exists public\.set_installation_preferences\(text, text\[\], text\[\], text\[\]\);/,
  );
  assert.match(
    migration.sql,
    /drop function if exists public\.apply_installation_preferences\(text, text\[\], text\[\], text\[\]\);/,
  );
  assert.match(
    migration.sql,
    /grant execute on function public\.set_installation_preferences\(text, text\[\], text\[\], text\[\], text, timestamptz\)\s*to anon, authenticated, service_role/,
  );
  assert.match(
    migration.sql,
    /grant execute on function public\.apply_installation_preferences\(text, text\[\], text\[\], text\[\], text, timestamptz\) to service_role/,
  );
  // No existing production allergens are cleared by this migration.
  assert.doesNotMatch(migration.sql, /update public\.installation_preferences/);
});

test('decision ordering: a stale, tied or untimed write cannot reverse a newer consent decision', () => {
  const { body } = effective(APPLY);
  // The row is locked before the decision is compared.
  assert.match(body, /where installation_id = p_installation_id\s*for update;/);
  // Untimed (older builds): keep the stored decision and allergens.
  const untimed = body.slice(
    body.indexOf('if v_decided is null then'),
    body.indexOf('elsif v_decided <'),
  );
  assert.match(untimed, /v_consent := v_existing\.allergen_consent_version;/);
  assert.match(untimed, /v_allergens := v_existing\.allergens;/);
  // Older, or a grant tied with a stored withdrawal, is stale.
  assert.match(body, /elsif v_decided < v_existing\.allergen_consent_decided_at/);
  assert.match(
    body,
    /v_decided = v_existing\.allergen_consent_decided_at\s*and v_consent is not null\s*and v_existing\.allergen_consent_version is null/,
  );
  // A stale write that would change the decision is REFUSED, never silently
  // ignored, so no client is told a decision was stored when it was not.
  const stale = body.slice(body.indexOf('elsif v_decided <'));
  assert.match(
    stale,
    /if v_consent is distinct from v_existing\.allergen_consent_version then\s*raise exception 'stale allergen consent decision';/,
  );
  assert.match(stale, /v_allergens := v_existing\.allergens;/);
  assert.match(body, /allergen_consent_decided_at = excluded\.allergen_consent_decided_at/);
});
