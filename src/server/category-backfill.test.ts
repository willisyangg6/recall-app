/**
 * Historical product-category enrichment (C10A).
 *
 * The operation's whole safety argument is what it CANNOT do: no case, no
 * notification, no timeline entry, no re-dating, no network, and no write at
 * all against a row that moved underneath it. Each of those is a test here,
 * because a maintenance command that quietly did any of them would look
 * exactly like a successful run.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { backfillProductCategories, planCaseCategories } from './category-backfill';
import { MemoryStore } from './store/memory-store';
import { projectCase } from '../domain/projection';
import type { CaseProjection, NoticeType, SourceAgency } from '../domain/recall-types';
import type { NormalizedSourceRecord } from '../domain/source-record';
import type { RecallCaseRow } from './store/types';

function record(overrides: Partial<NormalizedSourceRecord> = {}): NormalizedSourceRecord {
  return {
    sourceSystem: 'fda_announcement',
    sourceAgency: 'FDA' as SourceAgency,
    noticeType: 'recall' as NoticeType,
    nativeId: 'example',
    rawNativeId: 'example',
    officialUrl: 'https://www.fda.gov/example',
    title: 'Example Firm Recalls Chocolate Chip Cookies',
    summaryText: 'Example Firm is recalling cookies.',
    summaryHtml: null,
    reasonText: 'Undeclared shellfish',
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'shellfish',
    firmDisplayName: 'Example Firm',
    firmRawVariants: ['Example Firm'],
    brands: [],
    productDescription: 'Chocolate Chip Cookies',
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'unknown', states: [], confidence: 'stated', sourceText: null },
    productLines: [],
    quantityText: null,
    illnessStatement: null,
    consumerAction: null,
    contactText: null,
    lifecycle: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    publishedAt: '2026-08-01',
    lastModifiedAt: '2026-08-01',
    isRetractionNotice: false,
    ...overrides,
  } as NormalizedSourceRecord;
}

/** A stored case as it existed BEFORE C10A: no productCategories key at all. */
function legacyProjection(overrides: Partial<NormalizedSourceRecord> = {}): CaseProjection {
  const projection = { ...projectCase([record(overrides)]) };
  delete (projection as { productCategories?: unknown }).productCategories;
  return projection as CaseProjection;
}

async function storeWith(projections: CaseProjection[]): Promise<{
  store: MemoryStore;
  rows: RecallCaseRow[];
}> {
  const store = new MemoryStore();
  const rows: RecallCaseRow[] = [];
  for (const projection of projections) {
    rows.push(
      await store.insertCase({
        projection,
        timeline: [
          {
            occurredAt: '2026-08-01',
            kind: 'published',
            summary: 'Announced.',
            causedBySnapshotIds: [],
            material: true,
          },
        ],
        createdAt: '2026-08-01T00:00:00.000Z',
        lastChangedAt: '2026-08-01T00:00:00.000Z',
      }),
    );
  }
  return { store, rows };
}

// ── Planning ────────────────────────────────────────────────────────────────

test('a legacy case is planned for update; an enriched one is unchanged', async () => {
  const legacy = legacyProjection();
  const enriched = projectCase([record()]);
  const { rows } = await storeWith([legacy, enriched]);
  assert.equal(planCaseCategories(rows[0]).outcome, 'update');
  assert.equal(planCaseCategories(rows[0]).current, null);
  assert.deepEqual(planCaseCategories(rows[0]).next, ['bakery_grains']);
  assert.equal(planCaseCategories(rows[1]).outcome, 'unchanged');
});

test('a stale stored list is planned for correction', async () => {
  const stale: CaseProjection = { ...projectCase([record()]), productCategories: ['seafood'] };
  const { rows } = await storeWith([stale]);
  const plan = planCaseCategories(rows[0]);
  assert.equal(plan.outcome, 'update');
  assert.deepEqual(plan.current, ['seafood']);
  assert.deepEqual(plan.next, ['bakery_grains']);
});

// ── The dry run is an honest preview and writes nothing ─────────────────────

test('the dry run writes nothing and reports the same plan the apply performs', async () => {
  const { store } = await storeWith([legacyProjection(), legacyProjection()]);
  const dry = await backfillProductCategories(store, { apply: false });
  assert.equal(dry.wouldUpdate, 2);
  assert.equal(dry.caseWrites, 0);
  for (const row of await store.listCases()) {
    assert.equal(row.projection.productCategories, undefined);
  }
  const applied = await backfillProductCategories(store, { apply: true });
  assert.equal(applied.wouldUpdate, 2);
  assert.equal(applied.caseWrites, 2);
});

test('the apply writes exactly one field and nothing else moves', async () => {
  const { store, rows } = await storeWith([legacyProjection()]);
  const before = rows[0];
  await backfillProductCategories(store, { apply: true });
  const after = (await store.getCase(before.id))!;

  assert.deepEqual(after.projection.productCategories, ['bakery_grains']);
  assert.equal(after.lastChangedAt, before.lastChangedAt);
  assert.equal(after.createdAt, before.createdAt);
  assert.deepEqual(after.timeline, before.timeline);
  // Every other projection field is byte-identical.
  const strip = (p: CaseProjection) => {
    const copy = { ...p };
    delete (copy as { productCategories?: unknown }).productCategories;
    return JSON.stringify(copy);
  };
  assert.equal(strip(after.projection), strip(before.projection));
});

test('the run creates no case, no notification and no ingest run', async () => {
  const { store } = await storeWith([legacyProjection(), legacyProjection()]);
  const casesBefore = (await store.listCases()).length;
  const report = await backfillProductCategories(store, { apply: true });
  assert.equal((await store.listCases()).length, casesBefore);
  assert.equal(report.newCases, 0);
  assert.equal(report.notificationEvents, 0);
  assert.equal(report.timelineWrites, 0);
  assert.equal(report.networkRequests, 0);
});

test('re-running after an apply plans zero updates', async () => {
  const { store } = await storeWith([legacyProjection(), legacyProjection()]);
  await backfillProductCategories(store, { apply: true });
  const second = await backfillProductCategories(store, { apply: false });
  assert.equal(second.wouldUpdate, 0);
  assert.equal(second.unchanged, 2);
  const third = await backfillProductCategories(store, { apply: true });
  assert.equal(third.caseWrites, 0);
});

// ── Concurrency: compare-and-set against lastChangedAt ──────────────────────

test('a case that moved mid-run is re-read, re-derived and retried once', async () => {
  const { store, rows } = await storeWith([legacyProjection()]);
  const id = rows[0].id;
  let firstAttempt = true;
  const original = store.updateCaseProductCategories.bind(store);
  // Simulate scheduled ingestion landing between the read and the write: the
  // first CAS fails, and the row now carries NEWER text naming a fish product.
  store.updateCaseProductCategories = async (caseId, categories, expected) => {
    if (firstAttempt) {
      firstAttempt = false;
      const row = (await store.getCase(caseId))!;
      row.projection = { ...row.projection, productDescription: 'Canned tuna' };
      row.lastChangedAt = '2026-08-02T00:00:00.000Z';
      return false;
    }
    return original(caseId, categories, expected);
  };

  const report = await backfillProductCategories(store, { apply: true });
  assert.equal(report.caseWrites, 1);
  assert.deepEqual(report.concurrentlyModified, []);
  // The retry used the NEWER text, not the text the run started with.
  assert.deepEqual((await store.getCase(id))!.projection.productCategories, ['seafood']);
});

test('a case still moving after the retry is reported, never overwritten', async () => {
  const { store, rows } = await storeWith([legacyProjection()]);
  const id = rows[0].id;
  store.updateCaseProductCategories = async () => false;

  const report = await backfillProductCategories(store, { apply: true });
  assert.equal(report.caseWrites, 0);
  assert.deepEqual(report.concurrentlyModified, [id]);
  // The row was left exactly as it was.
  assert.equal((await store.getCase(id))!.projection.productCategories, undefined);
});

test('a concurrent re-projection that already got it right is not fought', async () => {
  const { store, rows } = await storeWith([legacyProjection()]);
  const id = rows[0].id;
  store.updateCaseProductCategories = async (caseId) => {
    const row = (await store.getCase(caseId))!;
    row.projection = { ...row.projection, productCategories: ['bakery_grains'] };
    row.lastChangedAt = '2026-08-02T00:00:00.000Z';
    return false;
  };

  const report = await backfillProductCategories(store, { apply: true });
  assert.equal(report.caseWrites, 0);
  assert.deepEqual(report.concurrentlyModified, [id]);
  assert.deepEqual((await store.getCase(id))!.projection.productCategories, ['bakery_grains']);
});

test('a CAS write against a stale lastChangedAt is refused by the store itself', async () => {
  const { store, rows } = await storeWith([legacyProjection()]);
  const accepted = await store.updateCaseProductCategories(
    rows[0].id,
    ['seafood'],
    'not-the-current-value',
  );
  assert.equal(accepted, false);
  assert.equal((await store.getCase(rows[0].id))!.projection.productCategories, undefined);
});

// ── Reporting ───────────────────────────────────────────────────────────────

test('the report counts distribution, multi-category and other-only cases', async () => {
  const { store } = await storeWith([
    legacyProjection(),
    legacyProjection({ productDescription: 'Metal Cookware Items' }),
    legacyProjection({ productDescription: 'Frozen Waffle and Turkey Sausage Products' }),
  ]);
  const report = await backfillProductCategories(store, { apply: false });
  assert.equal(report.casesExamined, 3);
  assert.equal(report.otherOnly, 1);
  assert.equal(report.multiCategory, 1);
  assert.equal(report.distribution.bakery_grains, 2);
  assert.equal(report.distribution.meat_poultry, 1);
  assert.equal(report.distribution.other, 1);
});

// ── C10A.1: a mixed corpus, and the announcement the derivation reads ────────

/**
 * The realistic state at apply time: scheduled ingestion has re-projected SOME
 * cases (so they already carry categories), others predate the field entirely,
 * and a third group carries a list an older classifier wrote. One run must
 * tell the three apart and plan writes for exactly two of them.
 */
test('a mixed corpus separates missing, unchanged and changed in one run', async () => {
  const missing = legacyProjection({ nativeId: 'missing' });
  const unchanged = projectCase([record({ nativeId: 'unchanged' })]);
  const stale = {
    ...projectCase([record({ nativeId: 'stale' })]),
    productCategories: ['seafood' as const],
  };
  const { store } = await storeWith([missing, unchanged, stale]);

  const report = await backfillProductCategories(store, { apply: false });
  assert.equal(report.casesExamined, 3);
  assert.equal(report.currentlyBearing, 2);
  assert.equal(report.unchanged, 1);
  assert.equal(report.wouldUpdate, 2);
  assert.equal(report.updatesOverExisting, 1);
  assert.equal(report.caseWrites, 0);

  const applied = await backfillProductCategories(store, { apply: true });
  assert.equal(applied.caseWrites, 2);
  assert.equal(applied.timelineWrites, 0);
  assert.equal(applied.notificationEvents, 0);
  assert.equal(applied.newCases, 0);

  // Idempotent: a hypothetical rerun plans nothing.
  const rerun = await backfillProductCategories(store, { apply: false });
  assert.equal(rerun.wouldUpdate, 0);
  assert.equal(rerun.unchanged, 3);
});

test('the backfill re-derives through the announcement, like every other caller', async () => {
  // A jurisdiction-only title whose announcement names the dish. If the
  // backfill dropped `summaryText` it would become a second, weaker
  // classifier and would write a different answer than a re-projection.
  const jurisdiction = record({
    sourceSystem: 'fsis_api',
    sourceAgency: 'FSIS',
    nativeId: 'jurisdiction-only',
    officialUrl: 'https://www.fsis.usda.gov/example',
    title: 'A Firm Recalls Poultry Products Due to Possible Contamination',
    productDescription: null,
    summaryText:
      'WASHINGTON, Jan. 2, 2026 - A Firm is recalling poultry products that may be ' +
      'contaminated with Listeria monocytogenes.\nThe ready-to-eat curry chicken salad ' +
      'items were produced on Dec. 1, 2025.',
  });
  const projection = { ...projectCase([jurisdiction]) };
  assert.deepEqual(projection.productCategories, ['prepared_foods']);

  delete (projection as { productCategories?: unknown }).productCategories;
  const { store, rows } = await storeWith([projection as CaseProjection]);
  const plan = planCaseCategories(rows[0]);
  assert.deepEqual(plan.next, ['prepared_foods']);
  assert.equal(plan.outcome, 'update');

  await backfillProductCategories(store, { apply: true });
  const after = await store.getCase(rows[0].id);
  assert.deepEqual(after?.projection.productCategories, ['prepared_foods']);
  // …and a full re-projection agrees, which is what makes the write durable.
  assert.deepEqual(projectCase([jurisdiction]).productCategories, ['prepared_foods']);
});
