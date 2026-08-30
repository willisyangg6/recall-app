/**
 * Migration pins for product-visual provenance (C9) — the repo's standing
 * migration-security pattern (consumer-manifest.test.ts, watchdog
 * contract.test.ts): the SQL is read as text, comments are stripped so a
 * commented-out line can never satisfy a pin, and the load-bearing
 * statements are asserted exactly. The migration must stay additive:
 * every existing row survives with its current meaning, and the RLS
 * surface of product_visuals is not touched in any direction.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(__dirname, '..', '..');
const MIGRATION = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20260906000000_product_visual_provenance.sql'),
  'utf8',
);
/** Comment lines removed: a pin must match live SQL, never prose. */
const SQL = MIGRATION.replace(/^\s*--.*$/gm, '');

test('purely additive: only ALTER TABLE ADD COLUMN / ADD CONSTRAINT, nothing destructive', () => {
  assert.match(SQL, /alter table public\.product_visuals/);
  assert.doesNotMatch(SQL, /\bdrop\b/i);
  assert.doesNotMatch(SQL, /\bdelete\b/i);
  assert.doesNotMatch(SQL, /\btruncate\b/i);
  assert.doesNotMatch(SQL, /\bupdate\b/i);
  assert.doesNotMatch(SQL, /alter column/i);
  assert.doesNotMatch(SQL, /create table/i);
});

test('existing rows keep their meaning: defaults state what current rows are', () => {
  assert.match(SQL, /add column provider text not null default 'fsis_label_pdf'/);
  assert.match(SQL, /add column confidence text not null default 'official_source'/);
});

test('the provider and confidence vocabularies are closed sets', () => {
  assert.match(SQL, /provider in \('fsis_label_pdf', 'fda_announcement', 'catalog_exact_gtin'\)/);
  assert.match(SQL, /confidence in \('official_source', 'exact_gtin_match'\)/);
});

test('a stored GTIN must be structurally a GTIN — no free-text identifiers', () => {
  assert.match(SQL, /gtin is null or gtin ~ '\^\(\\d\{8\}\|\\d\{12\}\|\\d\{13\}\|\\d\{14\}\)\$'/);
});

test('a catalog image cannot exist without its exact identifier', () => {
  assert.match(SQL, /check \(provider <> 'catalog_exact_gtin' or gtin is not null\)/);
});

test('RLS is untouched in both directions: no policies, grants, or role changes', () => {
  assert.doesNotMatch(SQL, /create policy/i);
  assert.doesNotMatch(SQL, /alter policy/i);
  assert.doesNotMatch(SQL, /drop policy/i);
  assert.doesNotMatch(SQL, /\bgrant\b/i);
  assert.doesNotMatch(SQL, /\brevoke\b/i);
  assert.doesNotMatch(SQL, /row level security/i);
  assert.doesNotMatch(SQL, /security definer/i);
});

test('scope containment: no table beyond product_visuals appears', () => {
  for (const forbidden of [
    'recall_cases',
    'source_records',
    'source_snapshots',
    'affected_products',
    'notification_events',
    'push_subscriptions',
    'installation_preferences',
    'ingest_runs',
    'job_leases',
    'product_visual_failures',
    'storage.objects',
    'storage.buckets',
  ]) {
    assert.ok(!SQL.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});
