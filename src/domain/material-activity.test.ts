import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasMaterialUpdate, materialActivityAt } from './material-activity';
import type { TimelineEntry } from './recall-types';

function entry(
  overrides: Partial<TimelineEntry> & Pick<TimelineEntry, 'occurredAt'>,
): TimelineEntry {
  return {
    kind: 'source_updated',
    summary: 'Test entry.',
    causedBySnapshotIds: [],
    material: false,
    ...overrides,
  };
}

/** The founding entry the pipeline writes for every new case. */
const PUBLISHED = entry({
  occurredAt: '2026-02-03',
  kind: 'published',
  summary: 'Recall published by FSIS.',
});

test('with nothing but the announcement, material activity IS the announcement', () => {
  assert.equal(materialActivityAt('2026-02-03', [PUBLISHED]), '2026-02-03');
  assert.equal(hasMaterialUpdate('2026-02-03', [PUBLISHED]), false);
});

test('an empty or missing timeline falls back to the announcement date', () => {
  assert.equal(materialActivityAt('2026-02-03', []), '2026-02-03');
  assert.equal(materialActivityAt('2026-02-03', null), '2026-02-03');
  assert.equal(materialActivityAt('2026-02-03', undefined), '2026-02-03');
});

test('a material expansion advances material activity', () => {
  const timeline = [
    PUBLISHED,
    entry({
      occurredAt: '2026-08-04',
      kind: 'expanded',
      material: true,
      ruleId: 'expansion_products',
    }),
  ];
  assert.equal(materialActivityAt('2026-02-03', timeline), '2026-08-04');
  assert.equal(hasMaterialUpdate('2026-02-03', timeline), true);
});

test('an official classification advances material activity', () => {
  const timeline = [
    PUBLISHED,
    entry({
      occurredAt: '2026-08-12',
      kind: 'classified',
      material: true,
      ruleId: 'classification_assigned',
    }),
  ];
  assert.equal(materialActivityAt('2026-02-03', timeline), '2026-08-12');
});

test('a classification DOWNGRADE is still material activity — any authoritative change counts', () => {
  const timeline = [
    PUBLISHED,
    entry({
      occurredAt: '2026-08-20',
      kind: 'classified',
      material: true,
      ruleId: 'classification_downgraded',
    }),
  ];
  assert.equal(materialActivityAt('2026-02-03', timeline), '2026-08-20');
});

test('bookkeeping source updates never advance material activity', () => {
  const timeline = [
    PUBLISHED,
    entry({
      occurredAt: '2026-08-25',
      kind: 'source_updated',
      summary: 'Source record updated (no consumer-relevant change).',
      material: false,
    }),
  ];
  assert.equal(materialActivityAt('2026-02-03', timeline), '2026-02-03');
  assert.equal(hasMaterialUpdate('2026-02-03', timeline), false);
});

test('agency closure does not advance material activity', () => {
  const timeline = [
    PUBLISHED,
    entry({
      occurredAt: '2026-08-25',
      kind: 'closed',
      summary: 'Recall closed by the agency.',
      material: false,
    }),
  ];
  assert.equal(materialActivityAt('2026-02-03', timeline), '2026-02-03');
});

test('the newest material entry wins regardless of timeline order', () => {
  const later = entry({ occurredAt: '2026-08-04', kind: 'expanded', material: true });
  const earlier = entry({ occurredAt: '2026-04-01', kind: 'classified', material: true });
  assert.equal(materialActivityAt('2026-02-03', [PUBLISHED, later, earlier]), '2026-08-04');
  assert.equal(materialActivityAt('2026-02-03', [PUBLISHED, earlier, later]), '2026-08-04');
});

test('a material entry can never pull activity BEFORE the announcement', () => {
  const timeline = [PUBLISHED, entry({ occurredAt: '2025-01-01', material: true })];
  assert.equal(materialActivityAt('2026-02-03', timeline), '2026-02-03');
});

test('dates are compared at day precision, whatever the source supplies', () => {
  const timeline = [
    entry({ occurredAt: '2026-08-04T18:30:00+00:00', kind: 'expanded', material: true }),
  ];
  assert.equal(materialActivityAt('2026-02-03T00:00:00+00:00', timeline), '2026-08-04');
});
