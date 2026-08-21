import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFixture } from './fixtures';
import { decodeEntities, deriveHazardCategory, parseFsisRecord, splitRecallNumber } from './parse';

test('parses a normal active recall (017-2026)', () => {
  const record = parseFsisRecord(loadFixture('recall-active-nationwide-017-2026'));
  assert.equal(record.nativeId, '017-2026');
  assert.equal(record.noticeType, 'recall');
  assert.equal(record.lifecycle, 'active');
  assert.equal(record.classification.value, 'class_I');
  assert.equal(record.geography.scope, 'nationwide');
  assert.equal(record.geography.confidence, 'stated');
  assert.equal(record.publishedAt, '2026-08-17');
  assert.ok(record.officialUrl.startsWith('https://www.fsis.usda.gov/'));
  assert.ok(record.productLines.length > 0);
  assert.ok(record.firmDisplayName !== null);
  assert.equal(record.expansionOfNativeId, null);
  assert.equal(record.isRetractionNotice, false);
  // Consumer action boilerplate should be extracted from the summary prose.
  assert.ok(record.consumerAction !== null);
});

test('parses an explicit state list as stated geography (016-2026)', () => {
  const record = parseFsisRecord(loadFixture('recall-active-stated-states-016-2026'));
  assert.deepEqual(record.geography, {
    scope: 'states',
    states: ['California'],
    confidence: 'stated',
    sourceText: 'California',
  });
});

test('normalizes a dirty recall number but preserves the raw form (" 034-2024")', () => {
  const record = parseFsisRecord(loadFixture('recall-closed-dirty-number-034-2024'));
  assert.equal(record.nativeId, '034-2024');
  assert.equal(record.rawNativeId, ' 034-2024');
  assert.equal(record.lifecycle, 'closed');
  assert.deepEqual(record.geography.states, ['Delaware', 'Maryland', 'Pennsylvania']);
});

test('detects an expansion record and its parent (005-2026-EXP)', () => {
  const record = parseFsisRecord(loadFixture('recall-closed-expansion-005-2026-exp'));
  assert.equal(record.nativeId, '005-2026-EXP');
  assert.equal(record.expansionOfNativeId, '005-2026');
  assert.equal(record.lifecycle, 'closed');
});

test('parses a Public Health Alert distinctly (PHA-08082026-01)', () => {
  const record = parseFsisRecord(loadFixture('pha-active-nationwide-pha-08082026-01'));
  assert.equal(record.noticeType, 'public_health_alert');
  assert.equal(record.classification.value, 'not_applicable_pha');
  assert.equal(record.lifecycle, 'active');
  // Empty product list is an explicit "see the official notice", never invented.
  assert.deepEqual(record.productLines, []);
});

test('detects a retraction notice (PHA-04012026-01)', () => {
  const record = parseFsisRecord(loadFixture('pha-retraction-pha-04012026-01'));
  assert.equal(record.isRetractionNotice, true);
  assert.equal(record.lifecycle, 'retracted');
  assert.equal(record.noticeType, 'public_health_alert');
});

test('empty field_states is unknown geography, and entities are decoded (006-2025)', () => {
  const record = parseFsisRecord(loadFixture('recall-closed-unknown-geography-006-2025'));
  assert.equal(record.geography.scope, 'unknown');
  assert.deepEqual(record.geography.states, []);
  // "Fresh &amp; Ready Foods LLC" in the raw feed must decode.
  assert.ok(record.firmRawVariants.includes('Fresh & Ready Foods LLC'));
  // Misbranding + Unreported Allergens → allergen hazard.
  assert.equal(record.hazardCategory, 'allergen');
  assert.equal(record.classification.value, 'class_II');
});

test('splitRecallNumber handles the observed suffix chaos', () => {
  assert.deepEqual(splitRecallNumber('005-2026-EXP'), {
    nativeId: '005-2026-EXP',
    baseId: '005-2026',
  });
  assert.deepEqual(splitRecallNumber(' 034-2024'), { nativeId: '034-2024', baseId: null });
  assert.deepEqual(splitRecallNumber('027-2016 expansion-3'), {
    nativeId: '027-2016 EXPANSION-3',
    baseId: '027-2016',
  });
  assert.deepEqual(splitRecallNumber('014-2015(Original)'), {
    nativeId: '014-2015(ORIGINAL)',
    baseId: '014-2015',
  });
  assert.deepEqual(splitRecallNumber('pha-05132022-01'), {
    nativeId: 'PHA-05132022-01',
    baseId: null,
  });
  // A bare malformed number still yields a usable identity.
  assert.deepEqual(splitRecallNumber('008'), { nativeId: '008', baseId: null });
});

test('hazard mapping is deterministic and never guesses', () => {
  assert.equal(deriveHazardCategory(['Unreported Allergens'], ''), 'allergen');
  assert.equal(
    deriveHazardCategory(
      ['Product Contamination'],
      'may be contaminated with Listeria monocytogenes',
    ),
    'microbial_contamination',
  );
  assert.equal(
    deriveHazardCategory(['Product Contamination'], 'may contain pieces of metal'),
    'foreign_material',
  );
  // Contamination with no identifiable agent stays unknown rather than guessed.
  assert.equal(deriveHazardCategory(['Product Contamination'], 'elevated levels'), 'unknown');
  assert.equal(deriveHazardCategory(['Import Violation'], ''), 'other_regulatory');
  assert.equal(deriveHazardCategory([], ''), 'unknown');
});

test('decodeEntities handles named and numeric entities', () => {
  assert.equal(
    decodeEntities('Fresh &amp; Ready&nbsp;Foods &#8220;Best&#8221;'),
    'Fresh & Ready Foods “Best”',
  );
});
