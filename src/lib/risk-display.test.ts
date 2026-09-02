/**
 * Goldens for both risk surfaces. `riskView` is what Home and Recall Detail
 * actually render, so asserting its exact strings here is asserting the
 * screens: Home shows `badgeLabel`, Detail shows `headlineLabel` + `note` at
 * the top and `official` deeper down.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Classification, OfficialClass, SourceAgency } from '@/domain/recall-types';
import { riskView } from './risk-display';

function view(classes: OfficialClass[], agency: SourceAgency = 'FDA') {
  const classification: Classification = {
    value:
      classes.length === 0
        ? 'not_yet_classified'
        : classes.length === 1
          ? classes[0]
          : 'multiple_classes',
    sourceText: classes.length === 1 ? classes[0].replace('class_', 'Class ') : null,
    officialClasses: classes,
  };
  return riskView(classification, agency);
}

test('A. Class I only — Critical, official Class I', () => {
  const v = view(['class_I']);
  assert.equal(v.tier, 'critical');
  assert.equal(v.badgeLabel, 'CRITICAL');
  assert.equal(v.headlineLabel, 'CRITICAL RISK');
  assert.deepEqual(v.official, {
    heading: 'Official FDA classification',
    text: 'Class I',
    note: null,
  });
});

test('B. Class II only — Moderate, official Class II', () => {
  const v = view(['class_II']);
  assert.equal(v.tier, 'moderate');
  assert.equal(v.headlineLabel, 'MODERATE RISK');
  assert.equal(v.official?.text, 'Class II');
  assert.equal(v.official?.heading, 'Official FDA classification');
});

test('C. Class III only — Minimal, official Class III, never called safe', () => {
  const v = view(['class_III']);
  assert.equal(v.tier, 'minimal');
  assert.equal(v.headlineLabel, 'MINIMAL RISK');
  assert.equal(v.official?.text, 'Class III');
  assert.match(v.note ?? '', /still an active recall/);
  assert.doesNotMatch(v.note ?? '', /safe/i);
});

test('D. Class I + II — High, both classes named, difference explained', () => {
  const v = view(['class_I', 'class_II']);
  assert.equal(v.tier, 'high');
  assert.equal(v.badgeLabel, 'HIGH');
  assert.equal(v.headlineLabel, 'HIGH RISK');
  assert.deepEqual(v.official, {
    heading: 'Official FDA classifications',
    text: 'Class I and Class II',
    note: 'FDA assigned different classifications to different affected products.',
  });
});

test('E. Class II + III — Low, both classes named', () => {
  const v = view(['class_II', 'class_III']);
  assert.equal(v.tier, 'low');
  assert.equal(v.headlineLabel, 'LOW RISK');
  assert.equal(v.official?.text, 'Class II and Class III');
  assert.equal(v.official?.heading, 'Official FDA classifications');
});

test('F. Class I + II + III — High, all three classes named', () => {
  const v = view(['class_I', 'class_II', 'class_III']);
  assert.equal(v.tier, 'high');
  assert.equal(v.official?.text, 'Class I, Class II, and Class III');
});

test('G. unmatched FDA recall — Risk pending on both surfaces, explained once', () => {
  const v = view([]);
  assert.equal(v.tier, 'pending');
  // One shared label for both surfaces (P2a): Home badge and Detail headline
  // agree, and the one pending explanation is the top-level note — the old
  // bottom "Not yet assigned" block restated it and is deliberately gone.
  assert.equal(v.headlineLabel, 'Risk pending');
  assert.equal(v.badgeLabel, 'Risk pending');
  assert.equal(v.note, 'The agency assigns a formal recall classification later in its process.');
  assert.equal(v.official, null);
});

test('a public health alert is Not rated, never Pending forever', () => {
  const v = riskView(
    { value: 'not_applicable_pha', sourceText: null, officialClasses: [] },
    'FSIS',
  );
  assert.equal(v.tier, 'unrated');
  // No fabricated class: "Not rated" (never Unknown) on both surfaces, and
  // the notice-type label — Public Health Alert — stays a separate concept.
  assert.equal(v.headlineLabel, 'Not rated');
  assert.equal(v.badgeLabel, 'Not rated');
  assert.deepEqual(v.official, {
    heading: 'Official USDA FSIS classification',
    text: 'Not assigned',
    note: 'Public health alerts do not receive a formal classification.',
  });
});

test('FSIS classifications map through the same scale, with agency provenance', () => {
  assert.equal(view(['class_I'], 'FSIS').tier, 'critical');
  assert.equal(view(['class_II'], 'FSIS').tier, 'moderate');
  assert.equal(view(['class_III'], 'FSIS').tier, 'minimal');
  assert.equal(view(['class_I'], 'FSIS').official?.heading, 'Official USDA FSIS classification');
  assert.equal(view(['class_I'], 'FSIS').official?.text, 'Class I');
});

test('Home cards lead with consumer risk and never show a regulatory class', () => {
  for (const classes of [
    ['class_I'],
    ['class_II'],
    ['class_III'],
    ['class_I', 'class_II'],
  ] as OfficialClass[][]) {
    const label = view(classes).badgeLabel ?? '';
    assert.ok(['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'MINIMAL'].includes(label), label);
    assert.doesNotMatch(label, /class/i);
  }
  // Pending/unrated badge their non-scale state, never a rated tier and
  // never a regulatory class.
  assert.equal(view([]).badgeLabel, 'Risk pending');
});

test('risk is never communicated by color alone', () => {
  const tiers: OfficialClass[][] = [
    ['class_I'],
    ['class_I', 'class_II'],
    ['class_II'],
    ['class_II', 'class_III'],
    ['class_III'],
    [],
  ];
  for (const classes of tiers) {
    const v = view(classes);
    // A spoken label always exists, and it names the tier in words.
    assert.match(v.accessibilityLabel, /^Risk level: /);
    assert.ok(v.accessibilityLabel.length > 'Risk level: '.length);
    // Anything rendered as a chip carries visible text.
    if (v.badgeLabel !== null) assert.ok(v.badgeLabel.trim().length > 0);
    if (v.headlineLabel !== null) assert.ok(v.headlineLabel.trim().length > 0);
  }
  assert.equal(view(['class_I']).accessibilityLabel, 'Risk level: Critical');
  assert.equal(view([]).accessibilityLabel, 'Risk level: pending');
});

test('no consumer surface exposes matcher internals', () => {
  const v = view(['class_I', 'class_II']);
  const rendered = [v.badgeLabel, v.headlineLabel, v.note, v.official?.text, v.official?.note]
    .filter((s): s is string => Boolean(s))
    .join(' ');
  for (const forbidden of [
    /event[_ ]?id/i,
    /recall[_ ]?number/i,
    /score/i,
    /confiden/i,
    /match/i,
  ]) {
    assert.doesNotMatch(rendered, forbidden);
  }
});
