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

// ── listSourceRecords pagination (P2e-B pagination hardening) ───────────────

/**
 * A range-aware fake mirroring PostgREST's `.range(from, to)` semantics
 * closely enough to prove the pagination loop's off-by-one and boundary
 * behavior, without a real database. `order` is recorded but not applied —
 * the fixture rows are already in the order the loop must preserve.
 */
function rangeClient(allRows: Record<string, unknown>[]) {
  const requestedRanges: [number, number][] = [];
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let orderedBy: string | null = null;
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        order(column: string) {
          orderedBy = column;
          return builder;
        },
        range(from: number, to: number) {
          requestedRanges.push([from, to]);
          let rows = allRows;
          for (const [column, value] of filters) {
            rows = rows.filter((row) => row[column] === value);
          }
          if (orderedBy) {
            rows = [...rows].sort((a, b) =>
              String(a[orderedBy!]).localeCompare(String(b[orderedBy!])),
            );
          }
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      void table;
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, requestedRanges };
}

/** A minimal valid `source_records` row the fake and the store both accept. */
function fakeSourceRecordRow(n: number): Record<string, unknown> {
  return {
    id: `id-${String(n).padStart(5, '0')}`,
    source_system: 'fsis_api',
    native_id: `native-${n}`,
    recall_case_id: `case-${n}`,
    link_method: 'self',
    normalized: { nativeId: `native-${n}` },
    source_url: `https://example.test/${n}`,
    first_seen_at: '2026-01-01T00:00:00.000Z',
    last_seen_at: '2026-01-01T00:00:00.000Z',
  };
}

test('listSourceRecords returns a population larger than 1,000 rows completely, in order, with no duplicates', async () => {
  const total = 1234; // larger than one page at the OLD 1000 size and the NEW 500 size
  const rows = Array.from({ length: total }, (_, i) => fakeSourceRecordRow(i));
  const { client, requestedRanges } = rangeClient(rows);
  const store = new SupabaseStore(client);

  const result = await store.listSourceRecords('fsis_api');

  assert.equal(result.length, total, 'every row across every page must be returned');
  assert.deepEqual(
    result.map((r) => r.id),
    rows.map((r) => r.id as string),
    'stable id order must be preserved across page boundaries',
  );
  assert.equal(new Set(result.map((r) => r.id)).size, total, 'no row may be duplicated');

  // The page size itself: 500, not 1000 — the narrow reliability correction.
  const pageSizes = requestedRanges.map(([from, to]) => to - from + 1);
  assert.ok(
    pageSizes.every((size) => size === 500),
    `every page request must ask for 500 rows, got: ${pageSizes.join(', ')}`,
  );
  // 1234 rows at 500/page: 3 requests (500, 500, 234), the last strictly
  // shorter than a full page — that shorter page is the loop's own stop
  // condition, so completeness does not depend on knowing the total ahead.
  assert.deepEqual(requestedRanges, [
    [0, 499],
    [500, 999],
    [1000, 1499],
  ]);
});

test('listSourceRecords stops after an exact multiple of the page size with no trailing empty request', async () => {
  const total = 1000; // exactly two 500-row pages
  const rows = Array.from({ length: total }, (_, i) => fakeSourceRecordRow(i));
  const { client, requestedRanges } = rangeClient(rows);
  const store = new SupabaseStore(client);

  const result = await store.listSourceRecords('fsis_api');

  assert.equal(result.length, total);
  // A full final page (500 of 500) is indistinguishable from "more to come"
  // by length alone, so the loop must issue one more request that comes
  // back empty rather than guessing the population ended exactly on a page.
  assert.deepEqual(requestedRanges, [
    [0, 499],
    [500, 999],
    [1000, 1499],
  ]);
});

test('listSourceRecords filters by source system before paginating, not after', async () => {
  const fsis = Array.from({ length: 5 }, (_, i) => fakeSourceRecordRow(i));
  const fda = Array.from({ length: 5 }, (_, i) => ({
    ...fakeSourceRecordRow(100 + i),
    source_system: 'fda_announcement',
  }));
  const { client } = rangeClient([...fsis, ...fda]);
  const store = new SupabaseStore(client);

  const result = await store.listSourceRecords('fsis_api');
  assert.equal(result.length, 5);
  assert.ok(result.every((r) => r.sourceSystem === 'fsis_api'));
});
