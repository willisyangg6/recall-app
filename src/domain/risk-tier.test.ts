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

/**
 * THE mapping contract, stated once as data. Every supported class set is
 * here — including all three mixed sets that contain Class I, which are the
 * ones a "pick the worst class" shortcut would get wrong.
 */
const MAPPING: [OfficialClass[], ConsumerRiskTier][] = [
  [['class_I'], 'critical'],
  [['class_I', 'class_II'], 'very_high'],
  [['class_I', 'class_III'], 'very_high'],
  [['class_I', 'class_II', 'class_III'], 'very_high'],
  [['class_II'], 'high'],
  [['class_II', 'class_III'], 'moderate'],
  [['class_III'], 'low'],
];

test('every official class set maps to its required consumer tier', () => {
  for (const [classes, tier] of MAPPING) {
    assert.equal(consumerRiskTier(classification(classes)), tier, classSetKey(classes));
  }
});

test('the mapping covers every reachable class set exactly once', () => {
  // All seven non-empty subsets of {I, II, III}. A set missing from MAPPING
  // would otherwise sit untested behind whatever the implementation happened
  // to return.
  const all: OfficialClass[] = ['class_I', 'class_II', 'class_III'];
  const subsets = [1, 2, 3, 4, 5, 6, 7].map((mask) => all.filter((_, i) => mask & (1 << i)));
  assert.equal(subsets.length, MAPPING.length);
  assert.deepEqual(
    subsets.map(classSetKey).sort(),
    MAPPING.map(([classes]) => classSetKey(classes)).sort(),
  );
});

test('pure Class I is Critical; any mixed set containing Class I is Very High', () => {
  // The agency itself classified those products differently — presenting the
  // whole case as uniformly Critical would state something FDA did not, and
  // dropping it to the Class II tier would hide that a Class I product is in
  // the set.
  assert.equal(consumerRiskTier(classification(['class_I'])), 'critical');
  for (const mixed of MAPPING.filter(
    ([classes]) => classes.includes('class_I') && classes.length > 1,
  )) {
    assert.equal(consumerRiskTier(classification(mixed[0])), 'very_high', classSetKey(mixed[0]));
  }
});

test('one Class I among many Class III products never averages away', () => {
  const tier = consumerRiskTier(classification(['class_I', 'class_III']));
  assert.equal(tier, 'very_high');
  for (const softer of ['high', 'moderate', 'low'] as ConsumerRiskTier[]) {
    assert.notEqual(tier, softer);
  }
});

test('Pending and Unknown are different absences and are never merged', () => {
  // An FDA recall may still be classified weeks later — an answer is coming.
  assert.equal(
    consumerRiskTier({ value: 'not_yet_classified' as const, officialClasses: [] }),
    'pending',
  );
  // A public health alert never receives a class at all, so nothing is
  // pending for it. Detail explains that absence directly beneath the label.
  assert.equal(
    consumerRiskTier({ value: 'not_applicable_pha' as const, officialClasses: [] }),
    'unknown',
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

test('an undeterminable classification is Unknown, never silently Pending', () => {
  // A legacy `multiple_classes` scalar persisted before officialClasses
  // existed: the case demonstrably HAS classes, but which ones is
  // unrecoverable here. Calling that Pending would promise an answer that is
  // not on its way.
  const legacyMixed: Classification = { value: 'multiple_classes', sourceText: null };
  assert.deepEqual(officialClassesOf(legacyMixed), []);
  assert.equal(consumerRiskTier(legacyMixed), 'unknown');
  // Only `not_yet_classified` may read as Pending.
  assert.equal(consumerRiskTier({ value: 'not_yet_classified' }), 'pending');
});

test('classification status distinguishes single from mixed', () => {
  assert.equal(classificationStatus(classification(['class_II'])), 'single');
  assert.equal(classificationStatus(classification(['class_II', 'class_III'])), 'mixed');
});

test('projections persisted before the class set derive it from the scalar', () => {
  // No officialClasses key at all — the legacy shape must still read right.
  const legacy: Classification = { value: 'class_II', sourceText: 'Class II' };
  assert.deepEqual(officialClassesOf(legacy), ['class_II']);
  assert.equal(consumerRiskTier(legacy), 'high');
  const legacyPending: Classification = { value: 'not_yet_classified', sourceText: null };
  assert.deepEqual(officialClassesOf(legacyPending), []);
  assert.equal(consumerRiskTier(legacyPending), 'pending');
});

test('deriving a tier mutates no stored classification value or class set', () => {
  // The label change is presentation only: the official Class I/II/III values
  // and the class set a case carries are the source truth, and reading a tier
  // from them must leave both untouched.
  for (const [classes] of MAPPING) {
    const stored = classification(classes);
    const before = JSON.stringify(stored);
    consumerRiskTier(stored);
    classificationStatus(stored);
    officialClassesOf(stored);
    assert.equal(JSON.stringify(stored), before, classSetKey(classes));
    // And the mixed scalar still refuses to name one class.
    if (classes.length > 1) assert.equal(stored.value, 'multiple_classes');
  }
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
    (['critical', 'very_high', 'high', 'moderate', 'low'] as ConsumerRiskTier[]).map(
      (t) => RISK_TIER_RANK[t],
    ),
    [5, 4, 3, 2, 1],
  );
  assert.equal(RISK_TIER_RANK.pending, null);
  assert.equal(RISK_TIER_RANK.unknown, null);
});
