/**
 * C9 frozen-policy guards: an ordinary FSIS label render is detail-screen
 * evidence and must NEVER automatically become a card hero.
 *
 * The promotion paths C9 briefly introduced (pipeline enrichment, the
 * labels job's same-tick hero fill, the blanket repair command) are gone;
 * these tests keep them gone. Also pinned here: the failure-ledger
 * dispositions for the eight recorded failures, and the semantics of the
 * RESERVED narrow-write infrastructure (`updateCaseHeroImage`,
 * `listCaseVisuals`) that C9.1's professional hero sourcing will inherit.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadFixture } from './fsis/fixtures';
import type { LabelFailureState } from './fsis/label-sync';
import { auditFailureUrl } from './imagery-audit';
import { canonicalJson, runFsisIngest } from './pipeline';
import { MemoryStore } from './store/memory-store';
import type { CaseVisualRow } from './store/types';

const NOW = () => new Date('2026-08-21T12:00:00Z');
const PREFIX = 'https://project.supabase.co/storage/v1/object/public/product-visuals/';

function input(records: unknown[]) {
  return {
    records: records as Parameters<typeof runFsisIngest>[1]['records'],
    fetchedAt: NOW().toISOString(),
    sourceUrl: 'https://www.fsis.usda.gov/fsis/api/recall/v/1?field_translation_language=en',
  };
}

function visualFor(recallCaseId: string, overrides: Partial<CaseVisualRow> = {}): CaseVisualRow {
  return {
    recallCaseId,
    sourceUrl: 'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2026-08/labels.pdf',
    sourceSha256: 'a'.repeat(64),
    page: 1,
    url: `${PREFIX}fsis-labels/${'a'.repeat(20)}/p1.webp`,
    role: 'package_label',
    width: 1024,
    height: 1325,
    contentHash: 'c'.repeat(64),
    ...overrides,
  };
}

/** A store with one real FSIS case and its rendered label page. */
async function seededStore(): Promise<{ store: MemoryStore; caseId: string }> {
  const store = new MemoryStore();
  await runFsisIngest(store, input([loadFixture('recall-active-nationwide-017-2026')]), {
    now: NOW,
  });
  const caseId = [...store.cases.keys()][0];
  store.visuals.push(visualFor(caseId));
  return { store, caseId };
}

/** The eight live ledger entries, verbatim (2026-08-29). */
const LEDGER: LabelFailureState[] = [
  {
    sourceUrl:
      'https://www.fsis.usda.gov//www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-08/030-2021-labels.pdf',
    attempts: 3,
    lastAttemptAt: '2026-08-28T21:05:01.625+00:00',
    lastError: 'HTTP 404',
  },
  {
    sourceUrl:
      'https://www.fsis.usda.gov//www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-12/pha-12182021-02-labels.pdf',
    attempts: 3,
    lastAttemptAt: '2026-08-28T21:05:16.536+00:00',
    lastError: 'HTTP 404',
  },
  {
    sourceUrl:
      'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2022-03/Recall%20008-2022%20labels.pdf',
    attempts: 3,
    lastAttemptAt: '2026-08-28T21:05:14.092+00:00',
    lastError: 'over size cap (51735491 bytes)',
  },
  {
    sourceUrl:
      'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2022-07/recall-021-2022-labels.pdf',
    attempts: 3,
    lastAttemptAt: '2026-08-28T21:05:12.551+00:00',
    lastError: 'over size cap (24539180 bytes)',
  },
  {
    sourceUrl:
      'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2023-10/Recall%20047-2023_food%20label.pdf',
    attempts: 3,
    lastAttemptAt: '2026-08-28T21:05:09.344+00:00',
    lastError: 'HTTP 404',
  },
  {
    sourceUrl:
      'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2023-12/recall-labels-060-2023_0.pdf',
    attempts: 3,
    lastAttemptAt: '2026-08-28T21:05:03.81+00:00',
    lastError: 'over size cap (21009038 bytes)',
  },
  {
    sourceUrl:
      'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2024-10/Recall-028-2024-Labels.pdf',
    attempts: 3,
    lastAttemptAt: '2026-08-28T21:05:05.529+00:00',
    lastError: 'over size cap (47963135 bytes)',
  },
  {
    sourceUrl:
      'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2025-01/recall-004-2025-labels.pdf',
    attempts: 3,
    lastAttemptAt: '2026-08-28T21:05:10.748+00:00',
    lastError: 'over size cap (22804037 bytes)',
  },
];

test('an ordinary FSIS label render never becomes heroImageUrl at ingest', async () => {
  const { store, caseId } = await seededStore();
  assert.equal(
    store.cases.get(caseId)!.projection.heroImageUrl,
    null,
    'an FSIS case with rendered label pages stays heroless on the feed',
  );
});

test('re-projection cannot assign a label-sheet card hero — and leaves the renders as detail evidence', async () => {
  const { store, caseId } = await seededStore();
  const visualsBefore = canonicalJson(store.visuals);

  // The source record genuinely changes, so the pipeline re-fetches,
  // re-hashes, and re-projects the case for real — with a rendered label
  // page sitting right there in product_visuals.
  const changed = {
    ...loadFixture('recall-active-nationwide-017-2026'),
    field_last_mod_date: '2026-08-22',
  };
  await runFsisIngest(store, input([changed]), { now: () => new Date('2026-08-22T12:00:00Z') });

  assert.equal(
    store.cases.get(caseId)!.projection.heroImageUrl,
    null,
    're-projection must not promote a label render to the card hero',
  );
  assert.equal(
    canonicalJson(store.visuals),
    visualsBefore,
    'the renders remain untouched evidence',
  );
});

test('an existing FDA hero passes through re-projection byte-identical', async () => {
  const { store, caseId } = await seededStore();
  // A second linked record carries an official photograph (the FDA shape —
  // heroImageUrl lives on the normalized record, where the parser put it).
  const fsisRecord = [...store.sourceRecords.values()].find((r) => r.recallCaseId === caseId)!;
  await store.insertSourceRecord({
    sourceSystem: 'fda_announcement',
    nativeId: 'companion-announcement',
    recallCaseId: caseId,
    linkMethod: 'self',
    normalized: {
      ...fsisRecord.normalized,
      nativeId: 'companion-announcement',
      rawNativeId: 'companion-announcement',
      sourceSystem: 'fda_announcement',
      heroImageUrl: 'https://www.fda.gov/files/Official%20Photo.jpg',
    },
    sourceUrl: 'https://www.fda.gov/announcement',
    firstSeenAt: NOW().toISOString(),
    lastSeenAt: NOW().toISOString(),
  });

  // The FSIS record genuinely changes → the pipeline re-projects the case
  // over BOTH records, with a label render also sitting in product_visuals.
  const changed = {
    ...loadFixture('recall-active-nationwide-017-2026'),
    field_last_mod_date: '2026-08-23',
  };
  await runFsisIngest(store, input([changed]), { now: () => new Date('2026-08-23T12:00:00Z') });
  assert.equal(
    store.cases.get(caseId)!.projection.heroImageUrl,
    'https://www.fda.gov/files/Official%20Photo.jpg',
    'the record-derived agency photograph is exactly what projectCase keeps — never the render',
  );
});

test('the labels sync has no path to a case: its storage port cannot touch heroes', () => {
  // Structural guard: the LabelSyncStore port exposes label/failure/page
  // operations only. If a hero hook or case accessor is ever reintroduced,
  // this membership list breaks and the frozen policy gets re-litigated
  // deliberately, not by accident.
  const labelSync = readFileSync(join(__dirname, 'fsis', 'label-sync.ts'), 'utf8');
  assert.doesNotMatch(labelSync, /applyHero|hero-fill|heroImageUrl|updateCase/i);
  const labelsJob = readFileSync(join(__dirname, 'jobs', 'labels-job.ts'), 'utf8');
  assert.doesNotMatch(labelsJob, /applyHero|hero-fill|heroImageUrl|RecallStore/i);
});

test('no blanket hero-repair command exists', () => {
  const packageJson = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  for (const name of Object.keys(packageJson.scripts)) {
    assert.doesNotMatch(name, /repair:imagery/, 'the hero-promotion repair must stay removed');
  }
  const pipeline = readFileSync(join(__dirname, 'pipeline.ts'), 'utf8');
  assert.doesNotMatch(pipeline, /listCaseVisuals|hero-selection|enrichHero/);
});

test('all eight ledger entries disposition correctly: 2 repaired, 5 within the new cap, 1 still failing', () => {
  const dispositions = LEDGER.map(auditFailureUrl);
  const byKind = (kind: string) => dispositions.filter((d) => d.disposition === kind);
  assert.equal(byKind('repaired-url').length, 2);
  assert.equal(byKind('within-new-size-cap').length, 5);
  assert.equal(byKind('still-failing').length, 1);
  assert.equal(
    byKind('still-failing')[0].sourceUrl,
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2023-10/Recall%20047-2023_food%20label.pdf',
  );
  for (const repaired of byKind('repaired-url')) {
    assert.doesNotMatch(repaired.normalizedUrl!, /gov\/\//);
  }
});

test('reserved infrastructure: updateCaseHeroImage is a narrow image-only compare-and-set', async () => {
  const { store, caseId } = await seededStore();
  const before = store.cases.get(caseId)!;
  const timelineBefore = canonicalJson(before.timeline);
  const lastChangedBefore = before.lastChangedAt;
  const notificationsBefore = store.notifications.size;

  // A stale expectation loses — concurrent ingestion can never be rolled back.
  assert.equal(await store.updateCaseHeroImage(caseId, 'https://x.test/h.jpg', 'stale'), false);
  assert.equal(store.cases.get(caseId)!.projection.heroImageUrl, null);

  // The current expectation wins and moves ONLY the hero field.
  assert.equal(
    await store.updateCaseHeroImage(caseId, 'https://x.test/h.jpg', lastChangedBefore),
    true,
  );
  const after = store.cases.get(caseId)!;
  assert.equal(after.projection.heroImageUrl, 'https://x.test/h.jpg');
  assert.equal(canonicalJson(after.timeline), timelineBefore, 'timeline byte-identical');
  assert.equal(after.lastChangedAt, lastChangedBefore, 'lastChangedAt untouched');
  assert.equal(store.notifications.size, notificationsBefore, 'no NotificationEvent');
  const { heroImageUrl: _a, ...restAfter } = after.projection;
  const { heroImageUrl: _b, ...restBefore } = before.projection;
  assert.equal(canonicalJson(restAfter), canonicalJson(restBefore));
});

test('reserved infrastructure: listCaseVisuals returns the case renders in stable order', async () => {
  const { store, caseId } = await seededStore();
  store.visuals.push(
    visualFor(caseId, { page: 2, url: `${PREFIX}fsis-labels/${'a'.repeat(20)}/p2.webp` }),
  );
  store.visuals.reverse();
  const visuals = await store.listCaseVisuals(caseId);
  assert.deepEqual(
    visuals.map((visual) => visual.page),
    [1, 2],
    'stable (page, source_url) order regardless of insertion order',
  );
});
