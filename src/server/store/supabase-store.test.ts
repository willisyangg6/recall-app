/**
 * C8 pins on the SupabaseStore's high-frequency reads: the ingest hot path's
 * per-record lookup must select the identity slice only — the whole point of
 * the optimization is the column list, so the column list is what the test
 * asserts, against a recording fake of the supabase-js query builder.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseStore } from './supabase-store';

interface RecordedQuery {
  table: string;
  select: string;
  filters: [string, string, unknown][];
}

/** Minimal thenable query builder that records what production would send. */
function recordingClient(result: unknown) {
  const queries: RecordedQuery[] = [];
  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, select: '', filters: [] };
      queries.push(query);
      const builder = {
        select(columns: string) {
          query.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push(['eq', column, value]);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        async maybeSingle() {
          return { data: result, error: null };
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

test('getSourceRecordLinkByNativeId selects the identity slice only — never normalized', async () => {
  const { client, queries } = recordingClient({ id: 'rec-1', recall_case_id: 'case-1' });
  const store = new SupabaseStore(client);

  const link = await store.getSourceRecordLinkByNativeId('fda_announcement', 'fda-123');

  assert.deepEqual(link, { id: 'rec-1', recallCaseId: 'case-1' });
  assert.equal(queries.length, 1);
  assert.equal(queries[0].table, 'source_records');
  // The exact column list is the optimization: a changed ingest run issues
  // this query once per feed item (~700–1,200 times), and `normalized`
  // (summaryHtml included, ~19 KB on FDA rows) must never ride along.
  assert.equal(queries[0].select, 'id, recall_case_id');
  assert.deepEqual(queries[0].filters, [
    ['eq', 'source_system', 'fda_announcement'],
    ['eq', 'native_id', 'fda-123'],
  ]);
});

test('getSourceRecordLinkByNativeId returns null for an unknown record', async () => {
  const { client } = recordingClient(null);
  const store = new SupabaseStore(client);
  assert.equal(await store.getSourceRecordLinkByNativeId('fsis_api', 'nope'), null);
});

test('getLatestSnapshotHash stays a single-column read', async () => {
  const { client, queries } = recordingClient({ content_hash: 'abc' });
  const store = new SupabaseStore(client);
  assert.equal(await store.getLatestSnapshotHash('rec-1'), 'abc');
  assert.equal(queries[0].table, 'source_snapshots');
  assert.equal(queries[0].select, 'content_hash');
});
