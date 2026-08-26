import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Classification, OfficialClass } from './recall-types';
import {
  classificationStatus,
  classSetKey,
  consumerRiskTier,
  officialClassesOf,
  officialClassListText,
  RISK_TIER_RANK,
  type ConsumerRiskTier,
} from './risk-tier';

function classification(classes: OfficialClass[]): Classification {
  return {
    value:
      classes.length === 0
        ? 'not_yet_classified'
        : classes.length === 1
          ? classes[0]
          : 'multiple_classes',
    sourceText: null,
    officialClasses: classes,
  };
}

test('every official class set maps to its required consumer tier', () => {
  const expected: [OfficialClass[], ConsumerRiskTier][] = [
    [['class_I'], 'critical'],
    [['class_I', 'class_II'], 'high'],
    [['class_I', 'class_III'], 'high'],
    [['class_I', 'class_II', 'class_III'], 'high'],
    [['class_II'], 'moderate'],
    [['class_II', 'class_III'], 'low'],
    [['class_III'], 'minimal'],
  ];
  for (const [classes, tier] of expected) {
    assert.equal(consumerRiskTier(classification(classes)), tier, classSetKey(classes));
  }
});

test('pure Class I is Critical but mixed Class I is only High', () => {
  // The agency itself classified those products differently — presenting the
  // whole case as uniformly Critical would state something FDA did not.
  assert.equal(consumerRiskTier(classification(['class_I'])), 'critical');
  assert.equal(consumerRiskTier(classification(['class_I', 'class_III'])), 'high');
});

test('one Class I among many Class III products never averages away', () => {
  assert.equal(consumerRiskTier(classification(['class_I', 'class_III'])), 'high');
  assert.notEqual(consumerRiskTier(classification(['class_I', 'class_III'])), 'minimal');
  assert.notEqual(consumerRiskTier(classification(['class_I', 'class_III'])), 'low');
});

test('pending and unrated are different absences', () => {
  // An FDA recall may still be classified weeks later.
  assert.equal(
    consumerRiskTier({ value: 'not_yet_classified' as const, officialClasses: [] }),
    'pending',
  );
  // A public health alert never receives a class at all.
  assert.equal(
    consumerRiskTier({ value: 'not_applicable_pha' as const, officialClasses: [] }),
    'unrated',
  );
  assert.equal(
    classificationStatus({ value: 'not_yet_classified' as const, officialClasses: [] }),
    'pending',
  );
  assert.equal(
    classificationStatus({ value: 'not_applicable_pha' as const, officialClasses: [] }),
    'not_applicable',
  );
});

test('classification status distinguishes single from mixed', () => {
  assert.equal(classificationStatus(classification(['class_II'])), 'single');
  assert.equal(classificationStatus(classification(['class_II', 'class_III'])), 'mixed');
});

test('projections persisted before the class set derive it from the scalar', () => {
  // No officialClasses key at all — the legacy shape must still read right.
  const legacy: Classification = { value: 'class_II', sourceText: 'Class II' };
  assert.deepEqual(officialClassesOf(legacy), ['class_II']);
  assert.equal(consumerRiskTier(legacy), 'moderate');
  const legacyPending: Classification = { value: 'not_yet_classified', sourceText: null };
  assert.deepEqual(officialClassesOf(legacyPending), []);
  assert.equal(consumerRiskTier(legacyPending), 'pending');
});

test('class sets have a stable severity-ordered identity regardless of input order', () => {
  assert.equal(classSetKey(['class_III', 'class_I']), 'class_I+class_III');
  assert.equal(classSetKey(['class_I', 'class_III']), 'class_I+class_III');
  assert.deepEqual(officialClassesOf(classification(['class_III', 'class_I'])), [
    'class_I',
    'class_III',
  ]);
  assert.equal(classSetKey([]), '');
});

test('official class list reads as the agency wrote it', () => {
  assert.equal(officialClassListText(['class_I']), 'Class I');
  assert.equal(officialClassListText(['class_I', 'class_II']), 'Class I and Class II');
  assert.equal(
    officialClassListText(['class_III', 'class_I', 'class_II']),
    'Class I, Class II, and Class III',
  );
});

test('non-scale states are unranked, never a low severity', () => {
  assert.deepEqual(
    (['critical', 'high', 'moderate', 'low', 'minimal'] as ConsumerRiskTier[]).map(
      (t) => RISK_TIER_RANK[t],
    ),
    [5, 4, 3, 2, 1],
  );
  assert.equal(RISK_TIER_RANK.pending, null);
  assert.equal(RISK_TIER_RANK.unrated, null);
});
