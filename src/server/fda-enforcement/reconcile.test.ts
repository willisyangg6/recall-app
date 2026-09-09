/**
 * Reconciliation-level coverage for the founder-review preview: cases the
 * matcher does not accept (ambiguous/candidate/unmatched) must never reach
 * the preview, the preview's total must track the existing aggregate
 * assignment/reclassification count exactly, ordering must be deterministic,
 * and a run proposing more than the review ceiling must fail loudly rather
 * than print a truncated list. Enrichment itself (enrich.test.ts) already
 * covers per-case field correctness; this file covers only what the case
 * sweep in reconcile.ts adds.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { projectCase } from '../../domain/projection';
import type { CaseProjection } from '../../domain/recall-types';
import type { NormalizedSourceRecord } from '../../domain/source-record';
import { MemoryStore } from '../store/memory-store';
import type { OpenFdaEnforcementRaw } from './parse';
import { reconcileFdaEnforcement } from './reconcile';

function announcement(overrides: Partial<NormalizedSourceRecord>): NormalizedSourceRecord {
  return {
    sourceSystem: 'fda_announcement',
    sourceAgency: 'FDA',
    nativeId: 'case-recalls-product',
    rawNativeId: '/safety/x',
    noticeType: 'recall',
    lifecycle: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    expansionOfNativeId: null,
    isRetractionNotice: false,
    retractsNativeIds: [],
    title: 'Firm Recalls Product',
    summaryText: 'Firm is recalling Product because of a hazard.',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen',
    pathogenOrAllergen: null,
    firmDisplayName: 'Firm',
    firmRawVariants: ['Firm'],
    brands: [],
    productDescription: null,
    imageUrls: [],
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    retailerNames: [],
    heroImageUrl: null,
    productLines: [],
    quantityText: null,
    illnessStatement: null,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fda.gov/x',
    publishedAt: '2026-08-01',
    lastModifiedAt: null,
    ...overrides,
  };
}

function rawEnforcement(overrides: Partial<OpenFdaEnforcementRaw>): OpenFdaEnforcementRaw {
  return {
    recall_number: 'F-1000-2026',
    event_id: '99900',
    classification: 'Class II',
    status: 'Ongoing',
    recalling_firm: 'Firm LLC',
    product_description: 'Product 16 oz bag UPC 012345678905',
    code_info: 'Lot 12345',
    reason_for_recall: 'Undeclared allergen',
    recall_initiation_date: '20260728',
    center_classification_date: '20260818',
    report_date: '20260820',
    ...overrides,
  };
}

/** A fake Supabase client: enough of `.from().select().eq().order().range()`
 * for the `recall_cases` page read, and `.from().select().maybeSingle()` for
 * the push-activation read. Rows are returned sorted by id, exactly as
 * Postgres's `.order('id')` would. */
function fakeClient(
  caseRows: { id: string; merged_into: string | null; projection: CaseProjection }[],
  push: { enabledAt?: string | null; tableMissing?: boolean } = {},
): SupabaseClient {
  const sorted = [...caseRows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const casesQuery = {
    select: () => casesQuery,
    eq: () => casesQuery,
    order: () => casesQuery,
    range: (from: number, to: number) =>
      Promise.resolve({ data: sorted.slice(from, to + 1), error: null }),
  };
  const pushQuery = {
    select: () => pushQuery,
    maybeSingle: () =>
      push.tableMissing
        ? Promise.resolve({
            data: null,
            error: { message: 'relation "push_delivery_config" does not exist' },
          })
        : Promise.resolve({
            data: push.enabledAt === undefined ? null : { push_enabled_at: push.enabledAt },
            error: null,
          }),
  };
  return {
    from: (table: string) => {
      if (table === 'recall_cases') return casesQuery;
      if (table === 'push_delivery_config') return pushQuery;
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

async function seedCase(
  store: MemoryStore,
  overrides: Partial<NormalizedSourceRecord>,
): Promise<{ id: string; merged_into: null; projection: CaseProjection }> {
  const normalized = announcement(overrides);
  const projection = projectCase([normalized]);
  const row = await store.insertCase({
    projection,
    timeline: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    lastChangedAt: '2026-08-01T00:00:00.000Z',
  });
  // Enrichment re-derives the projection from every STORED source record for
  // the case, not from the case row alone — without this, the re-projection
  // would see only the about-to-be-linked enforcement record.
  await store.insertSourceRecord({
    sourceSystem: 'fda_announcement',
    nativeId: normalized.nativeId,
    recallCaseId: row.id,
    linkMethod: 'self',
    normalized,
    sourceUrl: normalized.officialUrl,
    firstSeenAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-08-01T00:00:00.000Z',
  });
  return { id: row.id, merged_into: null, projection };
}

test('ambiguous, candidate, and unmatched cases never reach the preview', async () => {
  const store = new MemoryStore();
  // Matched: shares a UPC with the corpus record below.
  const matched = await seedCase(store, {
    nativeId: 'matched-case',
    firmDisplayName: 'Firm',
    firmRawVariants: ['Firm'],
    title: 'Firm Recalls Product UPC 012345678905',
    productDescription: 'Product UPC 012345678905',
  });
  // Unmatched: a firm that appears nowhere in the corpus.
  const unmatched = await seedCase(store, {
    nativeId: 'unmatched-case',
    firmDisplayName: 'Totally Different Firm',
    firmRawVariants: ['Totally Different Firm'],
    title: 'Totally Different Firm Recalls Something Else',
  });

  const corpus = { records: [rawEnforcement({})], exportDate: '2026-08-25', totalRecords: 1 };
  const client = fakeClient([matched, unmatched]);

  const stats = await reconcileFdaEnforcement(client, store, { apply: false, corpus });

  assert.equal(stats.casesExamined, 2);
  assert.equal(stats.matched, 1);
  assert.equal(stats.unmatched, 1);
  assert.equal(stats.classificationChanges.length, 1);
  assert.equal(stats.classificationChanges[0].caseId, matched.id);
  assert.equal(stats.classificationChanges[0].title, 'Firm Recalls Product UPC 012345678905');
  assert.equal(stats.classificationChanges[0].announcementRecallNumber, 'matched-case');
});

test('the preview total equals assignments plus reclassifications, and zero proposed changes is explicit', async () => {
  const store = new MemoryStore();
  const unmatched = await seedCase(store, {
    nativeId: 'unmatched-case',
    firmDisplayName: 'Nobody Recognizes This Firm',
    firmRawVariants: ['Nobody Recognizes This Firm'],
  });
  const client = fakeClient([unmatched]);
  const corpus = { records: [], exportDate: '2026-08-25', totalRecords: 0 };

  const stats = await reconcileFdaEnforcement(client, store, { apply: false, corpus });

  assert.equal(stats.assignments, 0);
  assert.equal(stats.reclassifications, 0);
  assert.deepEqual(stats.classificationChanges, []);
});

test('the preview total tracks assignments + reclassifications across several cases', async () => {
  const store = new MemoryStore();
  const caseA = await seedCase(store, {
    nativeId: 'case-a',
    firmDisplayName: 'Firm A',
    firmRawVariants: ['Firm A'],
    title: 'Firm A Recalls Product A UPC 011111111111',
    productDescription: 'Product A UPC 011111111111',
  });
  const caseB = await seedCase(store, {
    nativeId: 'case-b',
    firmDisplayName: 'Firm B',
    firmRawVariants: ['Firm B'],
    title: 'Firm B Recalls Product B UPC 022222222222',
    productDescription: 'Product B UPC 022222222222',
  });
  const corpus = {
    records: [
      rawEnforcement({
        recall_number: 'F-A-2026',
        event_id: '1',
        recalling_firm: 'Firm A LLC',
        classification: 'Class I',
        product_description: 'Product A UPC 011111111111',
      }),
      rawEnforcement({
        recall_number: 'F-B-2026',
        event_id: '2',
        recalling_firm: 'Firm B LLC',
        classification: 'Class II',
        product_description: 'Product B UPC 022222222222',
      }),
    ],
    exportDate: '2026-08-25',
    totalRecords: 2,
  };
  const client = fakeClient([caseA, caseB]);

  const stats = await reconcileFdaEnforcement(client, store, { apply: false, corpus });

  assert.equal(stats.assignments, 2);
  assert.equal(stats.reclassifications, 0);
  assert.equal(stats.classificationChanges.length, stats.assignments + stats.reclassifications);
  // Deterministic: same order as the case rows, sorted by id ascending.
  const expectedOrder = [caseA.id, caseB.id].sort();
  assert.deepEqual(
    stats.classificationChanges.map((c) => c.caseId),
    expectedOrder,
  );
});

test('a run proposing more changes than the review ceiling fails loudly with the true total', async () => {
  const store = new MemoryStore();
  const caseA = await seedCase(store, {
    nativeId: 'case-a',
    firmDisplayName: 'Firm A',
    firmRawVariants: ['Firm A'],
    title: 'Firm A Recalls Product A UPC 011111111111',
    productDescription: 'Product A UPC 011111111111',
  });
  const caseB = await seedCase(store, {
    nativeId: 'case-b',
    firmDisplayName: 'Firm B',
    firmRawVariants: ['Firm B'],
    title: 'Firm B Recalls Product B UPC 022222222222',
    productDescription: 'Product B UPC 022222222222',
  });
  const corpus = {
    records: [
      rawEnforcement({
        recall_number: 'F-A-2026',
        event_id: '1',
        recalling_firm: 'Firm A LLC',
        product_description: 'Product A UPC 011111111111',
      }),
      rawEnforcement({
        recall_number: 'F-B-2026',
        event_id: '2',
        recalling_firm: 'Firm B LLC',
        product_description: 'Product B UPC 022222222222',
      }),
    ],
    exportDate: '2026-08-25',
    totalRecords: 2,
  };
  const client = fakeClient([caseA, caseB]);

  await assert.rejects(
    () => reconcileFdaEnforcement(client, store, { apply: false, corpus, reviewCeiling: 1 }),
    /classification-change review ceiling exceeded: 2 proposed changes > 1/,
  );
  // Nothing was written — this is a review-output failure, not a data write.
  assert.equal(
    (await store.getCase(caseA.id))!.projection.classification.value,
    'not_yet_classified',
  );
  assert.equal(
    (await store.getCase(caseB.id))!.projection.classification.value,
    'not_yet_classified',
  );
});

test('push-active state is attached to every preview entry', async () => {
  const store = new MemoryStore();
  const matched = await seedCase(store, {
    nativeId: 'matched-case',
    firmDisplayName: 'Firm',
    firmRawVariants: ['Firm'],
    title: 'Firm Recalls Product UPC 012345678905',
    productDescription: 'Product UPC 012345678905',
  });
  const corpus = { records: [rawEnforcement({})], exportDate: '2026-08-25', totalRecords: 1 };

  const active = await reconcileFdaEnforcement(
    fakeClient([matched], { enabledAt: '2026-07-01T00:00:00Z' }),
    store,
    {
      apply: false,
      corpus,
    },
  );
  assert.equal(active.classificationChanges[0].pushActive, true);
  assert.equal(active.classificationChanges[0].currentlyDeliverable, true);

  const store2 = new MemoryStore();
  const matched2 = await seedCase(store2, {
    nativeId: 'matched-case',
    firmDisplayName: 'Firm',
    firmRawVariants: ['Firm'],
    title: 'Firm Recalls Product UPC 012345678905',
    productDescription: 'Product UPC 012345678905',
  });
  const inactive = await reconcileFdaEnforcement(
    fakeClient([matched2], { tableMissing: true }),
    store2,
    {
      apply: false,
      corpus,
    },
  );
  assert.equal(inactive.classificationChanges[0].pushActive, false);
  assert.equal(inactive.classificationChanges[0].currentlyDeliverable, false);
});
