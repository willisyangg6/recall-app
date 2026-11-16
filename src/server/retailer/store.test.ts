/**
 * The retailer monitor cannot reach the feed or the notification ledger.
 *
 * Three independent pins:
 *  1. the real Supabase store, driven through a full plan + apply against a
 *     recording client, writes only the two private tables and only SELECTs
 *     recall_cases;
 *  2. no retailer module (outside tests) even names a consumer or ledger
 *     table, calls an RPC, or imports the pipeline / push code;
 *  3. the migration keeps both tables private (no client grants, RLS on, no
 *     policies, no foreign key into recall_cases).
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { applyCostcoPlan, planCostcoRun } from './costco-monitor';
import {
  FIXTURE_INDEX_FETCHED_AT,
  fixtureAgencyCases,
  fixtureExtract,
  fixtureSource,
} from './fixtures/costco-fixtures';
import { RETAILER_WRITE_TABLES, SupabaseRetailerNoticeStore } from './store';

interface Call {
  table: string;
  op: string;
}

/** A chainable PostgREST stand-in that records (table, operation) pairs. */
function recordingClient(agencyRows: unknown[]): { client: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  let nextId = 0;
  const builder = (table: string) => {
    let op = 'select';
    let single = false;
    const result = () => {
      if (op === 'select' && table === 'recall_cases') return { data: agencyRows, error: null };
      if (op === 'select') return { data: [], error: null };
      if (single) return { data: { id: `id-${nextId++}` }, error: null };
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const method of ['eq', 'gte', 'order', 'range', 'select']) {
      chain[method] = () => chain;
    }
    for (const write of ['insert', 'update', 'upsert', 'delete']) {
      chain[write] = () => {
        op = write;
        calls.push({ table, op: write });
        return chain;
      };
    }
    chain.single = () => {
      single = true;
      return chain;
    };
    chain.then = (resolve: (value: unknown) => unknown) => resolve(result());
    return chain;
  };
  const client = {
    from: (table: string) => {
      calls.push({ table, op: 'from' });
      return builder(table);
    },
    rpc: () => {
      throw new Error('the retailer store must not call RPCs');
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

test('a full plan + apply writes only the two private retailer tables', async () => {
  // Agency rows shaped exactly as the store's SELECT returns them.
  const agencyRows = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'costco', 'agency-cases.json'), 'utf8'),
  );
  const { client, calls } = recordingClient(agencyRows);
  const store = new SupabaseRetailerNoticeStore(client);
  const plan = await planCostcoRun(
    store,
    fixtureSource(),
    () => new Date(FIXTURE_INDEX_FETCHED_AT),
    fixtureExtract,
  );
  // The recording client does not apply the date filter, so every row comes back.
  assert.equal(plan.agencyCasesConsidered, fixtureAgencyCases().length);
  await applyCostcoPlan(store, plan);

  const writes = calls.filter((call) => call.op !== 'from');
  assert.ok(writes.length > 0);
  for (const write of writes) {
    assert.ok(
      (RETAILER_WRITE_TABLES as readonly string[]).includes(write.table),
      `wrote ${write.table}`,
    );
    assert.equal(write.op, 'upsert');
  }
  const touched = new Set(calls.map((call) => call.table));
  assert.deepEqual([...touched].sort(), [
    'recall_cases',
    'retailer_notice_documents',
    'retailer_notices',
  ]);
  assert.ok(!calls.some((call) => call.table === 'recall_cases' && call.op !== 'from'));
});

const MODULE_DIR = __dirname;
const sources = readdirSync(MODULE_DIR)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => ({
    name,
    // Code only: the doc comments deliberately NAME the tables this module never touches.
    text: readFileSync(join(MODULE_DIR, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));

test('no retailer module names a consumer or ledger table, an RPC, or the pipeline', () => {
  const forbidden = [
    /['"`]notification_events['"`]/,
    /['"`]source_records['"`]/,
    /['"`]source_snapshots['"`]/,
    /['"`]affected_products['"`]\s*\)/, // read only through the recall_cases embed
    /['"`]push_[a-z_]+['"`]/,
    /\.rpc\(/,
    /from ['"]\.\.\/pipeline['"]/,
    /from ['"]\.\.\/push\//,
    /from ['"]\.\.\/store\/supabase-store['"]/,
  ];
  for (const { name, text } of sources) {
    for (const pattern of forbidden)
      assert.doesNotMatch(text, pattern, `${name} matches ${pattern}`);
  }
  // recall_cases is only ever READ: the monitor's agency-case read path, and
  // the approval step confirming an agency case exists before a match.
  const recallCaseUses = sources.flatMap(({ name, text }) =>
    [...text.matchAll(/from\('recall_cases'\)\s*\.(\w+)/g)].map((m) => `${name}:${m[1]}`),
  );
  assert.deepEqual(recallCaseUses.sort(), ['approval-store.ts:select', 'store.ts:select']);
});

const MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'supabase',
    'migrations',
    '20261113000000_retailer_notices.sql',
  ),
  'utf8',
).replace(/^\s*--.*$/gm, '');

test('the migration keeps both tables private', () => {
  for (const table of ['retailer_notices', 'retailer_notice_documents']) {
    assert.match(MIGRATION, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(
      MIGRATION,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`),
    );
  }
  assert.doesNotMatch(MIGRATION, /\bto\s+(?:[\w, ]*\b)?(?:anon|authenticated|public)\b\s*;/i);
  assert.doesNotMatch(MIGRATION, /\bcreate policy\b/i);
  assert.doesNotMatch(MIGRATION, /\bcreate (?:or replace )?view\b/i);
  assert.doesNotMatch(MIGRATION, /references public\.recall_cases/i);
  // Documents are append-only.
  assert.match(
    MIGRATION,
    /grant select, insert on table public\.retailer_notice_documents to service_role;/,
  );
  assert.match(
    MIGRATION,
    /raise exception 'Retailer notice tables are reachable by client roles: %'/,
  );
});

test('the migration touches no existing table', () => {
  const altered = [
    ...MIGRATION.matchAll(
      /\b(?:alter|drop|truncate|update|delete from|insert into)\s+(?:table\s+)?public\.(\w+)/gi,
    ),
  ].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)].sort(), ['retailer_notice_documents', 'retailer_notices']);
});
