import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFixture } from '../server/fsis/fixtures';
import { parseFsisRecord } from '../server/fsis/parse';
import { combineGeography, projectCase, statementReportsIllness } from './projection';
import type { NormalizedSourceRecord } from './source-record';

const parent = () => parseFsisRecord(loadFixture('recall-closed-parent-005-2026'));
const expansion = () => parseFsisRecord(loadFixture('recall-closed-expansion-005-2026-exp'));

test('parent + expansion project to one coherent case', () => {
  const projection = projectCase([parent(), expansion()]);
  // Case identity spans both government records.
  assert.deepEqual(
    projection.sourceIdentifiers.map((s) => s.id),
    ['005-2026', '005-2026-EXP'],
  );
  // Announced when the parent was announced; activity reflects the newest edit.
  assert.equal(projection.publishedAt, '2026-02-19');
  assert.equal(projection.lastPublicActivityAt, '2026-04-15');
  // Both records are closed, so the case is closed — with year-only granularity.
  assert.equal(projection.state, 'closed');
  assert.equal(projection.closedYear, '2026');
  // Products union with per-record provenance. The expansion record's product
  // list is only in an attached PDF (empty field_product_items — verified real
  // behavior), so every structured line here traces to the parent record.
  assert.ok(projection.affectedProducts.length > 0);
  assert.ok(projection.affectedProducts.every((p) => p.sourceNativeId === '005-2026'));
  // Consumer text comes from the newest primary notice (the expansion).
  assert.ok(projection.title.length > 0);
  assert.equal(projection.officialUrl, expansion().officialUrl);
});

test('projection is deterministic regardless of record order', () => {
  const a = projectCase([parent(), expansion()]);
  const b = projectCase([expansion(), parent()]);
  assert.deepEqual(a, b);
});

test('projection of a single record is stable (idempotent re-projection)', () => {
  const record = parseFsisRecord(loadFixture('recall-active-nationwide-017-2026'));
  assert.deepEqual(projectCase([record]), projectCase([record]));
});

function geo(overrides: Partial<NormalizedSourceRecord['geography']>): NormalizedSourceRecord {
  // Only geography matters for combineGeography; reuse a real record as base.
  const base = parseFsisRecord(loadFixture('recall-active-stated-states-016-2026'));
  return { ...base, geography: { ...base.geography, ...overrides } };
}

test('geography precedence: wider stated scope wins; stated beats inferred', () => {
  // states + nationwide → nationwide.
  assert.equal(
    combineGeography([
      geo({ scope: 'states', states: ['California'] }),
      geo({ scope: 'nationwide', states: [] }),
    ]).scope,
    'nationwide',
  );
  // stated states union.
  assert.deepEqual(
    combineGeography([
      geo({ scope: 'states', states: ['California'] }),
      geo({ scope: 'states', states: ['Nevada', 'California'] }),
    ]).states,
    ['California', 'Nevada'],
  );
  // stated beats inferred even when inferred is wider.
  assert.equal(
    combineGeography([
      geo({ scope: 'states', states: ['California'], confidence: 'stated' }),
      geo({ scope: 'nationwide', states: [], confidence: 'inferred' }),
    ]).scope,
    'states',
  );
  // all unknown stays unknown — never defaulted to nationwide.
  assert.equal(combineGeography([geo({ scope: 'unknown', states: [] })]).scope, 'unknown');
});

test('illness statement three-way semantics', () => {
  // Source silent = unknown, not "no illnesses".
  assert.equal(statementReportsIllness(null), false);
  // Explicit none (real FSIS boilerplate wording).
  assert.equal(
    statementReportsIllness(
      'There have been no confirmed reports of adverse reactions due to consumption of these products.',
    ),
    false,
  );
  // Actual reports.
  assert.equal(
    statementReportsIllness('FSIS has received reports of illness associated with this product.'),
    true,
  );
});

test('an expansion-titled record keeps the voice over a re-dated base page', () => {
  // Verified live on Khong Guan: FDA edited the BASE announcement one day
  // after publishing the expansion (removing customer names), re-dating it
  // past the expansion. The expansion's own words are the agency's latest
  // statement of what is recalled, so it stays the consumer voice.
  const base = parseFsisRecord(loadFixture('recall-active-stated-states-016-2026'));
  const original: NormalizedSourceRecord = {
    ...base,
    nativeId: 'khong-guan-issues-recall-glutinous-rice-balls',
    title: 'Khong Guan Corporation Issues Recall of Glutinous Rice Balls',
    summaryText: 'Original announcement, updated to remove customer names.',
    publishedAt: '2026-07-16',
  };
  const expansion: NormalizedSourceRecord = {
    ...base,
    nativeId: 'khong-guan-issues-expanded-recall-glutinous-rice-balls',
    title:
      'Khong Guan Corporation Issues Expanded Recall of Glutinous Rice Balls to Include Black & White Glutinous Rice Balls',
    summaryText: 'Expansion announcement listing both affected products.',
    publishedAt: '2026-07-15',
  };
  const projected = projectCase([original, expansion]);
  assert.equal(projected.title, expansion.title);
  assert.equal(projected.summaryText, expansion.summaryText);
  // The case's announce date stays the earliest record's.
  assert.equal(projected.publishedAt, '2026-07-15');
  // A genuinely newer announcement months later still supersedes.
  const muchLater: NormalizedSourceRecord = {
    ...original,
    nativeId: 'khong-guan-final-update',
    title: 'Khong Guan Corporation Recall Update',
    summaryText: 'Final update.',
    publishedAt: '2026-11-20',
  };
  assert.equal(projectCase([original, expansion, muchLater]).title, muchLater.title);
});
