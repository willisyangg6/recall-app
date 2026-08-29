/**
 * C8 pins on the ingest pipeline's read shape: the per-record path of a
 * changed run must consult the narrow identity slice, and reach for a full
 * source-record row ONLY where the expansion evidence guard genuinely reads
 * the normalized payload. Behavior itself (cases, snapshots, notifications)
 * is pinned by pipeline.test.ts and must not change — this file asserts the
 * reads, not new semantics.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFixture } from './fsis/fixtures';
import { runFsisIngest } from './pipeline';
import { MemoryStore } from './store/memory-store';
import type { RecallStore } from './store/types';

const NOW = () => new Date('2026-08-21T12:00:00Z');

function countingStore(): { store: RecallStore; counts: Record<string, number> } {
  const store = new MemoryStore();
  const counts: Record<string, number> = { full: 0, link: 0 };
  const wrapped: RecallStore = Object.create(store);
  wrapped.getSourceRecordByNativeId = (system, nativeId) => {
    counts.full += 1;
    return store.getSourceRecordByNativeId(system, nativeId);
  };
  wrapped.getSourceRecordLinkByNativeId = (system, nativeId) => {
    counts.link += 1;
    return store.getSourceRecordLinkByNativeId(system, nativeId);
  };
  return { store: wrapped, counts };
}

test('re-ingesting an unchanged feed reads identity slices only, never full source rows', async () => {
  const { store, counts } = countingStore();
  const records = [
    loadFixture('recall-active-nationwide-017-2026'),
    loadFixture('recall-active-stated-states-016-2026'),
    loadFixture('pha-active-nationwide-pha-08082026-01'),
  ];
  const input = {
    records,
    fetchedAt: NOW().toISOString(),
    sourceUrl: 'https://www.fsis.usda.gov/fsis/api/recall/v/1?field_translation_language=en',
  };
  await runFsisIngest(store, input, { now: NOW });

  counts.full = 0;
  counts.link = 0;
  const summary = await runFsisIngest(store, input, { now: NOW });

  // The unchanged-record path — the read every feed item pays on a changed
  // run — is exactly one narrow lookup per record and zero full-row reads.
  assert.equal(summary.unchanged, 3);
  assert.equal(counts.link, 3);
  assert.equal(counts.full, 0);
});

test('an expansion record still reads its parent in full for the evidence guard', async () => {
  const { store, counts } = countingStore();
  const base = {
    fetchedAt: NOW().toISOString(),
    sourceUrl: 'https://www.fsis.usda.gov/fsis/api/recall/v/1?field_translation_language=en',
  };
  await runFsisIngest(
    store,
    { ...base, records: [loadFixture('recall-closed-parent-005-2026')] },
    { now: NOW },
  );

  counts.full = 0;
  const summary = await runFsisIngest(
    store,
    {
      ...base,
      records: [
        loadFixture('recall-closed-parent-005-2026'),
        loadFixture('recall-closed-expansion-005-2026-exp'),
      ],
    },
    { now: NOW },
  );

  // The expansion's parent lookup needs `normalized` (the guard reads it);
  // that full read survives — narrowing it would break the evidence gate.
  assert.equal(summary.newCases + summary.changedCases >= 1, true);
  assert.ok(counts.full >= 1, 'the expansion parent lookup keeps the full row');
});
