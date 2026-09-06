/**
 * O3-B3A read-path hardening: the audit's request count is bounded and
 * page-shaped (never N+1), transient read failures retry per-page under one
 * bounded policy, retry exhaustion and concurrent material drift fail closed
 * with no plan, and mutations remain unretried and unreachable from dry-run.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  applySeedPlan,
  auditAppliedState,
  AuditReadExhaustedError,
  AUDIT_RETRY_ATTEMPTS,
  ConcurrentAuditDriftError,
  writeJsonFileAtomically,
  type AuditOptions,
  type ReconcilePlan,
} from './applied-state-reconcile';
import { loadFixture } from './fsis/fixtures';
import type { FsisRawRecord } from './fsis/parse';
import { runFsisIngest } from './pipeline';
import { MemoryStore } from './store/memory-store';
import type { RecallStore } from './store/types';

const NOW = () => new Date('2026-08-21T12:00:00Z');
const GIT = 'commit-under-test';
const BASE = loadFixture('recall-active-nationwide-017-2026');

/** N distinct, fully consistent legacy records via the real pipeline. */
async function legacyPopulation(count: number): Promise<MemoryStore> {
  const store = new MemoryStore();
  const records: FsisRawRecord[] = Array.from({ length: count }, (_, i) => ({
    ...BASE,
    field_recall_number: `${String(100 + i)}-2026`,
    field_title: `${BASE.field_title} (variant ${i})`,
  }));
  await runFsisIngest(
    store,
    { records, fetchedAt: NOW().toISOString(), sourceUrl: 'fixture://fsis' },
    { now: NOW },
  );
  for (const row of store.sourceRecords.values()) {
    delete row.applyState;
    delete row.appliedContentHash;
    delete row.appliedSnapshotSeq;
    delete row.appliedAt;
  }
  return store;
}

/** Small page sizes so every read crosses multiple page boundaries. */
const SMALL_PAGES = {
  records: 7,
  health: 9,
  cases: 5,
  caseTokens: 9,
  products: 11,
  initialEvents: 13,
  payloadChunk: 3,
};

function auditOpts(overrides: Partial<AuditOptions> = {}): AuditOptions {
  return {
    gitCommit: GIT,
    now: NOW,
    sleep: async () => {},
    jitter: () => 0.5,
    warn: () => {},
    pageSizes: SMALL_PAGES,
    ...overrides,
  };
}

/** Wrap the page-read methods with call counters (and optional fault hooks). */
function instrument(store: MemoryStore) {
  const calls: Record<string, number> = {};
  const bump = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const wrapped: RecallStore = Object.create(store);
  wrapped.listAppliedStateHealthPage = (f, s) => (
    bump('health'),
    store.listAppliedStateHealthPage(f, s)
  );
  wrapped.listSourceRecordsPage = (sys, f, s) => (
    bump('records'),
    store.listSourceRecordsPage(sys, f, s)
  );
  wrapped.listCaseAuditPage = (f, s) => (bump('cases'), store.listCaseAuditPage(f, s));
  wrapped.listCaseTokensPage = (f, s) => (bump('caseTokens'), store.listCaseTokensPage(f, s));
  wrapped.listCaseProductsPage = (f, s) => (bump('products'), store.listCaseProductsPage(f, s));
  wrapped.listInitialEventCasePage = (f, s) => (
    bump('initialEvents'),
    store.listInitialEventCasePage(f, s)
  );
  wrapped.listSnapshotsBySeq = (seqs) => (bump('snapshots'), store.listSnapshotsBySeq(seqs));
  // N+1 tripwires: the audit must NEVER touch the per-record/per-case reads.
  for (const banned of [
    'getLatestSnapshotMeta',
    'getLatestSnapshotPayload',
    'getCaseGeneratedColumns',
    'listCaseProducts',
    'hasNotificationEvent',
    'getCase',
    'listSourceRecords',
    'listSourceRecordIdentities',
    'listCases',
  ] as const) {
    (wrapped as unknown as Record<string, unknown>)[banned] = async () => {
      throw new Error(`N+1 regression: audit called ${banned}`);
    };
  }
  return { wrapped, calls };
}

// ── Bounded request shape ────────────────────────────────────────────────────

test('the audit is page-shaped: bounded call count, zero N+1 reads, at production-like scale', async () => {
  const N = 23; // crosses every SMALL_PAGES boundary
  const store = await legacyPopulation(N);
  const { wrapped, calls } = instrument(store);
  const plan = await auditAppliedState(wrapped, auditOpts());

  assert.equal(plan.summary.recordsExamined, N);
  assert.equal(plan.summary.seedableCount, N);
  // Derived bound: pages+chunks only, never records × attributes.
  const pages = (n: number, size: number) => Math.floor(n / size) + 1; // + the short/empty stop page
  assert.equal(calls.health, pages(N, SMALL_PAGES.health) * 2); // census + fence
  assert.equal(calls.caseTokens, pages(N, SMALL_PAGES.caseTokens)); // fence end
  assert.equal(calls.cases, pages(N, SMALL_PAGES.cases));
  assert.equal(calls.snapshots, Math.ceil(N / SMALL_PAGES.payloadChunk));
  // records: 3 systems, each paginated (two are empty → 1 stop page each).
  assert.equal(calls.records, pages(N, SMALL_PAGES.records) + 2);
  const total = Object.values(calls).reduce((a, b) => a + b, 0);
  assert.ok(total < N * 2, `total reads ${total} must stay far below N+1 territory (${N * 5}+)`);
});

test('pagination crosses every boundary with no omission or duplicate', async () => {
  const store = await legacyPopulation(23);
  const plan = await auditAppliedState(store, auditOpts());
  const ids = plan.records.map((r) => r.nativeId);
  assert.equal(ids.length, 23);
  assert.equal(new Set(ids).size, 23);
  // Exact-multiple boundary: population divisible by the page size.
  const store2 = await legacyPopulation(21); // 21 % 7 === 0 for records pages
  const plan2 = await auditAppliedState(store2, auditOpts());
  assert.equal(plan2.summary.recordsExamined, 21);
});

test('different page-read orderings produce identical classifications and digest', async () => {
  const store = await legacyPopulation(12);
  const forward = await auditAppliedState(store, auditOpts());
  // Same rows, different stable order (by nativeId instead of id), same pagination contract.
  const reordered: RecallStore = Object.create(store);
  reordered.listAppliedStateHealthPage = async (from, size) => {
    const all = await store.listAppliedStateHealthPage(0, 10_000);
    return all.sort((a, b) => a.nativeId.localeCompare(b.nativeId)).slice(from, from + size);
  };
  reordered.listSourceRecordsPage = async (sys, from, size) => {
    const all = await store.listSourceRecordsPage(sys, 0, 10_000);
    return all.sort((a, b) => a.nativeId.localeCompare(b.nativeId)).slice(from, from + size);
  };
  reordered.listCaseAuditPage = async (from, size) => {
    const all = await store.listCaseAuditPage(0, 10_000);
    return all.sort((a, b) => b.id.localeCompare(a.id)).slice(from, from + size);
  };
  const backward = await auditAppliedState(reordered, auditOpts());
  assert.equal(forward.planDigest, backward.planDigest);
  assert.deepEqual(forward.records, backward.records);
});

// ── Retry policy ─────────────────────────────────────────────────────────────

test('one transient fetch failure recovers after a bounded retry — and the digest is unchanged', async () => {
  const store = await legacyPopulation(10);
  const clean = await auditAppliedState(store, auditOpts());

  const { wrapped } = instrument(store);
  let failed = false;
  const realHealth = store.listAppliedStateHealthPage.bind(store);
  wrapped.listAppliedStateHealthPage = async (from, size) => {
    if (!failed) {
      failed = true;
      throw new TypeError('fetch failed');
    }
    return realHealth(from, size);
  };
  const sleeps: number[] = [];
  const warns: string[] = [];
  const plan = await auditAppliedState(
    wrapped,
    auditOpts({ sleep: async (ms) => void sleeps.push(ms), warn: (l) => void warns.push(l) }),
  );
  assert.equal(sleeps.length, 1);
  assert.equal(plan.planDigest, clean.planDigest); // retries never change content
  assert.ok(warns[0].includes('health[0]') && warns[0].includes('attempt 2/4'));
});

test('failures on two different pages retry only the failed pages', async () => {
  const store = await legacyPopulation(23);
  const { wrapped, calls } = instrument(store);
  const realRecords = store.listSourceRecordsPage.bind(store);
  const failedOnce = new Set<number>();
  wrapped.listSourceRecordsPage = async (sys, from, size) => {
    calls.records = (calls.records ?? 0) + 1;
    if ((from === 7 || from === 14) && !failedOnce.has(from)) {
      failedOnce.add(from);
      throw new TypeError('fetch failed');
    }
    return realRecords(sys, from, size);
  };
  const plan = await auditAppliedState(wrapped, auditOpts());
  assert.equal(plan.summary.recordsExamined, 23);
  // 23 records at page 7 → pages [0,7,14,21] = 4 + 2 empty systems + 2 retries.
  assert.equal(calls.records, 4 + 2 + 2);
});

test('429 rate limiting waits at least the Retry-After substitute (2s)', async () => {
  const store = await legacyPopulation(5);
  const { wrapped } = instrument(store);
  let failed = false;
  const real = store.listCaseAuditPage.bind(store);
  wrapped.listCaseAuditPage = async (from, size) => {
    if (!failed) {
      failed = true;
      throw new Error('unexpected response: 429 Too Many Requests');
    }
    return real(from, size);
  };
  const sleeps: number[] = [];
  await auditAppliedState(wrapped, auditOpts({ sleep: async (ms) => void sleeps.push(ms) }));
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 2000, `429 delay ${sleeps[0]} must be >= 2000ms`);
});

test('502/503/504 retry bounded, then exhaust with no plan', async () => {
  for (const status of ['502 Bad Gateway', '503 Service Unavailable', '504 Gateway Timeout']) {
    const store = await legacyPopulation(3);
    const { wrapped } = instrument(store);
    let attempts = 0;
    wrapped.listAppliedStateHealthPage = async () => {
      attempts += 1;
      throw new Error(`SupabaseStore.listAppliedStateHealthPage failed: ${status}`);
    };
    await assert.rejects(
      () => auditAppliedState(wrapped, auditOpts()),
      AuditReadExhaustedError,
      status,
    );
    assert.equal(attempts, AUDIT_RETRY_ATTEMPTS, status);
  }
});

test('permission/schema/validation errors are thrown immediately, never retried', async () => {
  for (const message of [
    'permission denied for view source_record_apply_health',
    'relation "source_record_apply_health" does not exist',
    'invalid input syntax for type bigint',
    'JWT expired',
  ]) {
    const store = await legacyPopulation(3);
    const { wrapped } = instrument(store);
    let attempts = 0;
    wrapped.listAppliedStateHealthPage = async () => {
      attempts += 1;
      throw new Error(message);
    };
    await assert.rejects(
      () => auditAppliedState(wrapped, auditOpts()),
      (error: Error) => !(error instanceof AuditReadExhaustedError) && error.message === message,
      message,
    );
    assert.equal(attempts, 1, message);
  }
});

test('retry diagnostics are bounded and payload-free', async () => {
  const store = await legacyPopulation(3);
  const { wrapped } = instrument(store);
  let failed = false;
  const real = store.listSnapshotsBySeq.bind(store);
  const hugeSecret = `fetch failed while reading rawPayload=${'X'.repeat(5000)} apikey=SHOULD_NEVER_APPEAR`;
  wrapped.listSnapshotsBySeq = async (seqs) => {
    if (!failed) {
      failed = true;
      throw new TypeError(hugeSecret);
    }
    return real(seqs);
  };
  const warns: string[] = [];
  await auditAppliedState(wrapped, auditOpts({ warn: (l) => void warns.push(l) }));
  assert.equal(warns.length, 1);
  assert.ok(warns[0].length < 400, `diagnostic too long: ${warns[0].length}`);
  assert.ok(!warns[0].includes('SHOULD_NEVER_APPEAR'));
});

// ── Fail-closed output ───────────────────────────────────────────────────────

test('writeJsonFileAtomically refuses overwrites, leaves no partial file, and cleans its tmp', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'o3b3a-'));
  const target = path.join(dir, 'plan.json');
  writeJsonFileAtomically(target, { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { ok: true });
  assert.throws(() => writeJsonFileAtomically(target, { evil: true }), /refusing to overwrite/);
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { ok: true });
  // Serialization failure: nothing lands, tmp is cleaned.
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const target2 = path.join(dir, 'plan2.json');
  assert.throws(() => writeJsonFileAtomically(target2, cyclic));
  assert.equal(existsSync(target2), false);
  assert.deepEqual(
    readdirSync(dir).filter((f) => f.includes('tmp')),
    [],
  );
});

test('a failure artifact cannot masquerade as a reviewed plan', async () => {
  const store = await legacyPopulation(3);
  const failureArtifact = {
    status: 'read_retries_exhausted',
    error: 'x',
    gitCommit: GIT,
    failedAt: NOW().toISOString(),
  };
  await assert.rejects(
    () =>
      applySeedPlan(store, failureArtifact as unknown as ReconcilePlan, {
        expectedDigest: 'anything',
        currentGitCommit: GIT,
      }),
    /schema/,
  );
});

// ── Concurrent-drift fence ───────────────────────────────────────────────────

/**
 * Mutate the store exactly when the fence's END pass begins: the SECOND
 * time the health read starts from offset 0 (the census read is the first).
 */
function mutateAtFence(store: MemoryStore, mutate: () => void): RecallStore {
  const wrapped: RecallStore = Object.create(store);
  let healthRounds = 0;
  const real = store.listAppliedStateHealthPage.bind(store);
  wrapped.listAppliedStateHealthPage = async (from, size) => {
    if (from === 0) {
      healthRounds += 1;
      if (healthRounds === 2) mutate();
    }
    return real(from, size);
  };
  return wrapped;
}

test('material membership drift invalidates the audit with bounded identifiers', async () => {
  const store = await legacyPopulation(5);
  const wrapped = mutateAtFence(store, () => {
    void store.insertSourceRecord({
      sourceSystem: 'fsis_api',
      nativeId: 'NEW-DURING-AUDIT',
      recallCaseId: [...store.cases.keys()][0],
      linkMethod: 'self',
      normalized: [...store.sourceRecords.values()][0].normalized,
      sourceUrl: 'u',
      firstSeenAt: NOW().toISOString(),
      lastSeenAt: NOW().toISOString(),
      applyState: 'pending',
    });
  });
  await assert.rejects(
    () => auditAppliedState(wrapped, auditOpts()),
    (error: Error) =>
      error instanceof ConcurrentAuditDriftError && /NEW-DURING-AUDIT/.test(error.message),
  );
});

test('material snapshot/marker/case-token drift each invalidate the audit', async () => {
  // Latest snapshot moved (an ingest archived a new version mid-audit).
  {
    const store = await legacyPopulation(5);
    const record = [...store.sourceRecords.values()][0];
    const wrapped = mutateAtFence(store, () => {
      void store.insertSnapshot({
        sourceRecordId: record.id,
        fetchedAt: NOW().toISOString(),
        contentHash: 'moved-mid-audit',
        rawPayload: {},
        sourceUrl: 'u',
      });
    });
    await assert.rejects(() => auditAppliedState(wrapped, auditOpts()), ConcurrentAuditDriftError);
  }
  // Marker state moved (another writer seeded/applied).
  {
    const store = await legacyPopulation(5);
    const record = [...store.sourceRecords.values()][0];
    const wrapped = mutateAtFence(store, () => {
      record.applyState = 'pending';
    });
    await assert.rejects(() => auditAppliedState(wrapped, auditOpts()), ConcurrentAuditDriftError);
  }
  // Case CAS token moved (covers projection/products/events by the O3 contract).
  {
    const store = await legacyPopulation(5);
    const wrapped = mutateAtFence(store, () => {
      [...store.cases.values()][0].lastChangedAt = '2026-08-21T13:00:00.000Z';
    });
    await assert.rejects(() => auditAppliedState(wrapped, auditOpts()), ConcurrentAuditDriftError);
  }
});

test('excluded operational timestamp movement (last_seen_at) does NOT invalidate the audit', async () => {
  const store = await legacyPopulation(5);
  const wrapped = mutateAtFence(store, () => {
    for (const row of store.sourceRecords.values()) {
      row.lastSeenAt = '2026-08-21T12:59:59.000Z'; // an unchanged tick's only touch
    }
  });
  const plan = await auditAppliedState(wrapped, auditOpts());
  assert.equal(plan.summary.seedableCount, 5);
});

// ── Mutation isolation ───────────────────────────────────────────────────────

test('dry-run mode completes even when EVERY mutating store method throws', async () => {
  const store = await legacyPopulation(5);
  const wrapped: RecallStore = Object.create(store);
  for (const method of [
    'seedLegacyAppliedMarker',
    'applyCaseTransition',
    'foundCase',
    'archiveSnapshot',
    'insertSnapshot',
    'insertSourceRecord',
    'insertCase',
    'updateCase',
    'updateSourceRecord',
    'updateSourceRecordNormalized',
    'markSourceRecordApplied',
    'replaceProducts',
    'insertNotificationIfAbsent',
  ] as const) {
    (wrapped as unknown as Record<string, unknown>)[method] = async () => {
      throw new Error(`dry-run reached mutating method ${method}`);
    };
  }
  const plan = await auditAppliedState(wrapped, auditOpts());
  assert.equal(plan.summary.seedableCount, 5);
});

test('apply-mode mutation is at-most-once and never retried, even on transient-looking failure', async () => {
  const store = await legacyPopulation(2);
  const plan = await auditAppliedState(store, auditOpts());
  let seedCalls = 0;
  store.seedLegacyAppliedMarker = async () => {
    seedCalls += 1;
    throw new TypeError('fetch failed'); // transient-LOOKING — must still not retry
  };
  await assert.rejects(
    () =>
      applySeedPlan(store, plan, {
        expectedDigest: plan.planDigest,
        currentGitCommit: GIT,
        now: NOW,
      }),
    /fetch failed/,
  );
  assert.equal(seedCalls, 1);
});
