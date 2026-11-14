import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyCostcoPlan, planCostcoRun } from './costco-monitor';
import {
  FIXTURE_IDS,
  FIXTURE_INDEX_FETCHED_AT,
  fixtureAgencyCases,
  fixtureExtract,
  fixtureSource,
} from './fixtures/costco-fixtures';
import { MemoryRetailerNoticeStore } from './store';
import type { RetailerNoticeRow } from './types';

const agencyCases = fixtureAgencyCases();
const at = (iso: string) => () => new Date(iso);
const firstRun = at(FIXTURE_INDEX_FETCHED_AT);

async function plannedRows(store = new MemoryRetailerNoticeStore(agencyCases)) {
  const plan = await planCostcoRun(store, fixtureSource(), firstRun, fixtureExtract);
  return { plan, rows: new Map(plan.planned.map((item) => [item.row.nativeId, item.row])) };
}

test('the three requested fixtures: create, link, exclude', async () => {
  const { rows } = await plannedRows();

  const whipped = rows.get(FIXTURE_IDS.whippedCream)!;
  assert.equal(whipped.decision, 'new_candidate');
  assert.deepEqual(whipped.decisionReasons, ['no_agency_match']);
  assert.equal(whipped.linkCaseId, null);

  const tractor = rows.get(FIXTURE_IDS.tractorWheels)!;
  assert.equal(tractor.decision, 'link_candidate');
  assert.equal(tractor.linkCaseId, '38c00154-9077-4bf9-b0d3-a4d46a5e8f2b');
  assert.equal(tractor.agencyLagDays, 2); // Costco 10-31, FDA 11-02
  assert.deepEqual(tractor.decisionReasons, [
    'single_agency_match',
    'retailer_notice_dated_before_agency',
    'package_claim_unverified',
  ]);

  const ladders = rows.get(FIXTURE_IDS.ladders)!;
  assert.equal(ladders.decision, 'excluded');
  assert.deepEqual(ladders.decisionReasons, ['non_food']);
});

test('Tractor Wheels keeps the conflicting package size as unverified evidence only', async () => {
  const { rows } = await plannedRows();
  const tractor = rows.get(FIXTURE_IDS.tractorWheels)!;
  assert.deepEqual(tractor.packageClaims, [
    {
      text: '#1977696 Once Upon a Farm Organic Tractor Wheels Soft-baked Bars, 67oz, 20-count',
      sizeTokens: ['67oz', '20-count'],
      verifiedInAgencyNotice: false,
      // FDA prints a 20 count (13.4 oz); it never prints 67 oz.
      unverifiedSizeTokens: ['67oz'],
    },
  ]);
  assert.deepEqual(tractor.retailerItemNumbers, ['1977696']);
  assert.deepEqual(tractor.upcs, []);
});

test('scanned, undated and conflicting notices stay in review', async () => {
  const { rows } = await plannedRows();
  const review = (id: string) => rows.get(id)!;
  assert.equal(review(FIXTURE_IDS.punahele).decision, 'review');
  assert.deepEqual(review(FIXTURE_IDS.punahele).decisionReasons, ['scanned_document']);
  assert.equal(review(FIXTURE_IDS.meatloaf).decision, 'review');
  assert.deepEqual(review(FIXTURE_IDS.meatloaf).decisionReasons, ['undated']);
  for (const id of [FIXTURE_IDS.yakitori, FIXTURE_IDS.shoyuRamen]) {
    assert.equal(review(id).decision, 'review');
    assert.deepEqual(review(id).decisionReasons, [
      'single_agency_match',
      'codes_not_in_agency_notice',
    ]);
    assert.equal(review(id).linkCaseId, null); // a conflict never links
    assert.deepEqual(review(id).candidateCaseIds, ['9c9edbd7-1597-4200-b5e5-74d8f7ab5746']);
  }
});

test('every notice on the recorded index has a pinned decision', async () => {
  const { rows } = await plannedRows();
  const tally: Record<string, string[]> = {};
  for (const row of rows.values()) (tally[row.decision] ??= []).push(row.nativeId);
  assert.deepEqual(
    Object.fromEntries(Object.entries(tally).map(([decision, ids]) => [decision, ids.length])),
    { excluded: 12, new_candidate: 3, link_candidate: 2, review: 4 },
  );
  assert.deepEqual(
    tally.new_candidate.sort(),
    [FIXTURE_IDS.whippedCream, FIXTURE_IDS.madeleines, FIXTURE_IDS.caesar].sort(),
  );
  assert.deepEqual(
    tally.link_candidate.sort(),
    [FIXTURE_IDS.tractorWheels, FIXTURE_IDS.motorCity].sort(),
  );
  // Quality notices are separated from recalls, not dropped silently.
  assert.deepEqual(rows.get(FIXTURE_IDS.turkishDelight)!.decisionReasons, [
    'quality_notice_not_recall',
  ]);
  assert.deepEqual(rows.get(FIXTURE_IDS.desertWillow)!.decisionReasons, ['non_food']);
});

test('stated notice dates and measured discovery times are separate fields', async () => {
  const { rows } = await plannedRows();
  const whipped = rows.get(FIXTURE_IDS.whippedCream)!;
  assert.equal(whipped.statedNoticeDate, '2026-11-07');
  assert.equal(whipped.firstSeenAt, FIXTURE_INDEX_FETCHED_AT);
  assert.equal(whipped.lastSeenOnIndexAt, FIXTURE_INDEX_FETCHED_AT);
});

test('a repeated run creates no duplicates and only advances last-seen', async () => {
  const store = new MemoryRetailerNoticeStore(agencyCases);
  const first = await planCostcoRun(store, fixtureSource(), firstRun, fixtureExtract);
  assert.deepEqual(
    [
      first.planned.filter((p) => p.change === 'insert').length,
      first.planned.filter((p) => p.document).length,
    ],
    [21, 21],
  );
  await applyCostcoPlan(store, first);
  const snapshot = new Map(
    [...store.notices].map(([key, value]) => [key, structuredClone(value.row)]),
  );

  const later = '2026-11-13T23:51:00.000Z';
  const second = await planCostcoRun(store, fixtureSource(), at(later), fixtureExtract);
  assert.deepEqual(
    second.planned.map((p) => p.change),
    Array(21).fill('touch'),
  );
  assert.equal(second.planned.filter((p) => p.document).length, 0);
  await applyCostcoPlan(store, second);

  assert.equal(store.notices.size, 21);
  assert.equal(store.documents.length, 21);
  for (const [key, { row }] of store.notices) {
    const before = snapshot.get(key)!;
    assert.equal(row.firstSeenAt, FIXTURE_INDEX_FETCHED_AT); // never moved
    assert.equal(row.decidedAt, before.decidedAt); // decision unchanged → not re-dated
    assert.equal(row.lastSeenOnIndexAt, later);
    const strip = ({ lastSeenOnIndexAt: _l, ...rest }: RetailerNoticeRow) => rest;
    assert.deepEqual(strip(row), strip(before));
  }
});

test('rows read back with reordered jsonb keys still compare as unchanged', async () => {
  // Postgres jsonb returns object keys in its own order (found on the
  // isolated stack: every rerun planned 21 "updates" until keys were sorted).
  const store = new MemoryRetailerNoticeStore(agencyCases);
  await applyCostcoPlan(
    store,
    await planCostcoRun(store, fixtureSource(), firstRun, fixtureExtract),
  );
  const reversed = <T extends object>(value: T): T =>
    Object.fromEntries(Object.entries(value).reverse()) as T;
  for (const stored of store.notices.values()) {
    stored.row.evidence = reversed(stored.row.evidence);
    stored.row.packageClaims = stored.row.packageClaims.map(reversed);
    stored.row.stateClaims = stored.row.stateClaims.map(reversed);
  }
  const rerun = await planCostcoRun(
    store,
    fixtureSource(),
    at('2026-11-14T00:00:00Z'),
    fixtureExtract,
  );
  assert.deepEqual(new Set(rerun.planned.map((item) => item.change)), new Set(['touch']));
});

test('a notice that leaves the index keeps its row exactly as it was', async () => {
  const store = new MemoryRetailerNoticeStore(agencyCases);
  await applyCostcoPlan(
    store,
    await planCostcoRun(store, fixtureSource(), firstRun, fixtureExtract),
  );
  const departed: RetailerNoticeRow = {
    ...structuredClone(store.notices.get(`costco:${FIXTURE_IDS.whippedCream}`)!.row),
    nativeId: 'bltdeparted00000000',
  };
  await store.upsertNotice(departed);

  const plan = await planCostcoRun(
    store,
    fixtureSource(),
    at('2026-11-14T00:00:00Z'),
    fixtureExtract,
  );
  assert.deepEqual(plan.notOnIndex, ['bltdeparted00000000']);
  assert.ok(!plan.planned.some((item) => item.row.nativeId === 'bltdeparted00000000'));
  await applyCostcoPlan(store, plan);
  assert.deepEqual(store.notices.get('costco:bltdeparted00000000')!.row, departed);
});

test('a document that fails to fetch writes nothing for that notice', async () => {
  const store = new MemoryRetailerNoticeStore(agencyCases);
  const plan = await planCostcoRun(
    store,
    fixtureSource({ failIds: [FIXTURE_IDS.whippedCream] }),
    firstRun,
    fixtureExtract,
  );
  assert.deepEqual(
    plan.failures.map((failure) => failure.nativeId),
    [FIXTURE_IDS.whippedCream],
  );
  await applyCostcoPlan(store, plan);
  assert.equal(store.notices.has(`costco:${FIXTURE_IDS.whippedCream}`), false);
  assert.equal(store.notices.size, 20);
});

test('an index that parses to nothing fails the run instead of reading as withdrawn', async () => {
  const store = new MemoryRetailerNoticeStore(agencyCases);
  const source = { ...fixtureSource(), fetchIndexHtml: async () => '<html>Access Denied</html>' };
  await assert.rejects(planCostcoRun(store, source, firstRun, fixtureExtract), /zero notices/);
  assert.equal(store.notices.size, 0);
});

test('planning alone writes nothing', async () => {
  const store = new MemoryRetailerNoticeStore(agencyCases);
  const plan = await planCostcoRun(store, fixtureSource(), firstRun, fixtureExtract);
  assert.equal(plan.plannedWrites, 42);
  assert.equal(store.notices.size, 0);
  assert.equal(store.documents.length, 0);
});
