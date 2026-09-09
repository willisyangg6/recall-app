/**
 * Enforcement read-timeout coverage.
 *
 * The 2026-09-08 enforcement run (#15) failed after 117.6s with PostgreSQL 57014
 * `canceling statement due to statement timeout`, wrote nothing, and correctly
 * did not advance completedExportDate. The recorded error text was BARE — no
 * `SupabaseStore.` prefix — which identifies the seam: every store read prefixes
 * its operation name via SupabaseStore.fail(), so the only enforcement read that
 * can produce a bare PostgREST message is the direct paged `recall_cases`
 * projection read in reconcile.ts. These tests cover that read and the second
 * direct read beside it (push_delivery_config), and pin the rule that nothing in
 * the apply path retries a write.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { MemoryStore } from '../store/memory-store';
import { reconcileFdaEnforcement } from './reconcile';

const NO_WAIT = { sleep: async () => {}, jitter: () => 0.5 };
const POLICY = { attempts: 4, baseDelayMs: 1, maxDelayMs: 2, rateLimitMinDelayMs: 1 };

const pg = (code: string, message: string) => ({ code, message, details: null, hint: null });

interface Plan {
  /** Failures to inject before the first successful page read. */
  casePageFailures: unknown[];
  pushFailures?: unknown[];
}

/** A fake PostgREST client whose two read surfaces can be made to fail. */
function fakeClient(plan: Plan) {
  const counts = { casePages: 0, push: 0 };
  const caseQueue = [...plan.casePageFailures];
  const pushQueue = [...(plan.pushFailures ?? [])];
  const client = {
    from(table: string) {
      if (table === 'push_delivery_config') {
        return {
          select: () => ({
            maybeSingle: async () => {
              counts.push += 1;
              const failure = pushQueue.shift();
              if (failure) return { data: null, error: failure };
              return { data: { push_enabled_at: null }, error: null };
            },
          }),
        };
      }
      // recall_cases
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              range: async () => {
                counts.casePages += 1;
                const failure = caseQueue.shift();
                if (failure) return { data: null, error: failure };
                return { data: [], error: null };
              },
            }),
          }),
        }),
      };
    },
  };
  return { client: client as never, counts };
}

const EMPTY_CORPUS = { records: [], exportDate: '2026-09-08', totalRecords: 0 };

async function run(plan: Plan) {
  const fake = fakeClient(plan);
  const stats = await reconcileFdaEnforcement(fake.client, new MemoryStore(), {
    apply: false,
    corpus: EMPTY_CORPUS,
    retryPolicy: POLICY,
    retryHooks: NO_WAIT,
  });
  return { stats, counts: fake.counts };
}

test('the 57014 statement timeout on the case-page read is retried, and the run completes', async () => {
  const { stats, counts } = await run({
    casePageFailures: [pg('57014', 'canceling statement due to statement timeout')],
  });
  assert.equal(counts.casePages, 2);
  assert.equal(stats.casesExamined, 0);
});

test('a bare statement-timeout message with no SQLSTATE is still retried', async () => {
  // Exactly the production text, which carried no code through the boundary.
  const { counts } = await run({
    casePageFailures: [{ message: 'canceling statement due to statement timeout' }],
  });
  assert.equal(counts.casePages, 2);
});

test('an HTML 502 gateway page on the case-page read is retried', async () => {
  const { counts } = await run({
    casePageFailures: [
      { message: '<html><head><title>502 Bad Gateway</title></head></html>' },
      { message: 'TypeError: fetch failed' },
    ],
  });
  assert.equal(counts.casePages, 3);
});

test('the case-page read exhausts cleanly at the bound, with no partial result', async () => {
  const failures = Array.from({ length: 9 }, () =>
    pg('57014', 'canceling statement due to statement timeout'),
  );
  await assert.rejects(
    () => run({ casePageFailures: failures }),
    (error: unknown) =>
      error instanceof Error &&
      /enforcement\.recall_cases\[0\]' still failing after 4 attempt\(s\)/.test(error.message),
  );
});

test('a schema error on the case-page read fails on the first attempt, unretried', async () => {
  const fake = fakeClient({
    casePageFailures: [pg('42703', 'column recall_cases.projection does not exist')],
  });
  await assert.rejects(() =>
    reconcileFdaEnforcement(fake.client, new MemoryStore(), {
      apply: false,
      corpus: EMPTY_CORPUS,
      retryPolicy: POLICY,
      retryHooks: NO_WAIT,
    }),
  );
  assert.equal(fake.counts.casePages, 1);
});

test('the push_delivery_config read is covered by the same bounded policy', async () => {
  const { counts } = await run({
    casePageFailures: [],
    pushFailures: [pg('57014', 'canceling statement due to statement timeout')],
  });
  assert.equal(counts.push, 2);
});

test('a missing push_delivery_config table is still tolerated, not retried', async () => {
  const { counts, stats } = await run({
    casePageFailures: [],
    pushFailures: [{ message: 'relation "push_delivery_config" does not exist' }],
  });
  assert.equal(counts.push, 1);
  assert.deepEqual(stats.classificationChanges, []);
});

test('COVERAGE: every store read in the enforcement path is in the retry allowlist', async () => {
  // Static, not sampled: an empty corpus never enters the per-case loop, so a
  // dynamic probe would under-report. This scans the real source of both
  // enforcement modules for every `store.<method>(` call and checks the
  // read-shaped ones against the production allowlist — so a future read added
  // to the loop fails here unless it is covered.
  const { RETRYABLE_READ_METHODS } = await import('../store/read-retry');
  const sources = ['enrich.ts', 'reconcile.ts'].map((file) =>
    readFileSync(path.join(import.meta.dirname, file), 'utf8'),
  );
  const called = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/\bstore\.([a-zA-Z_][a-zA-Z0-9_]*)\(/g)) {
      called.add(match[1]);
    }
  }
  // Guard against a parser that silently finds nothing.
  assert.ok(called.has('applyCaseTransition'), 'parser did not find the known write');
  assert.ok(called.has('listSourceRecords'), 'parser did not find the known read');

  const reads = [...called].filter((name) => /^(get|list|has|count)/.test(name)).sort();
  assert.ok(reads.length >= 3, `expected several reads, found ${reads.join(', ')}`);
  for (const name of reads) {
    assert.ok(
      RETRYABLE_READ_METHODS.has(name),
      `enforcement calls store.${name}() but it is NOT in the retry allowlist`,
    );
  }

  // And the writes it performs are deliberately NOT covered.
  const writes = [...called].filter((name) => !/^(get|list|has|count)/.test(name));
  for (const name of writes) {
    assert.ok(
      !RETRYABLE_READ_METHODS.has(name),
      `enforcement write store.${name}() must never be retried`,
    );
  }
});

test('a dry run performs no write at all, retried or otherwise', async () => {
  const store = new MemoryStore();
  const mutations: string[] = [];
  const guard = new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof value === 'function' &&
        typeof property === 'string' &&
        /^(insert|update|apply|archive|replace|mark|seed|found|create|finish|annotate|acquire|release)/.test(
          property,
        )
      ) {
        return (...args: unknown[]) => {
          mutations.push(property);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
  const fake = fakeClient({ casePageFailures: [] });
  await reconcileFdaEnforcement(fake.client, guard, {
    apply: false,
    corpus: EMPTY_CORPUS,
    retryPolicy: POLICY,
    retryHooks: NO_WAIT,
  });
  assert.deepEqual(mutations, []);
});
