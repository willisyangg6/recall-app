/**
 * Goldens for both risk surfaces. `riskView` is what Home and Recall Detail
 * actually render, so asserting its exact strings here is asserting the
 * screens: Home shows `badgeLabel`, Detail shows `headlineLabel` + `note` at
 * the top and `official` deeper down.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Classification, OfficialClass, SourceAgency } from '@/domain/recall-types';
import type { ConsumerRiskTier } from '@/domain/risk-tier';
import { RISK_FILTER_TIERS } from './feed-filters';
import { riskTierWord, riskView } from './risk-display';

function classificationOf(classes: OfficialClass[]): Classification {
  return {
    value:
      classes.length === 0
        ? 'not_yet_classified'
        : classes.length === 1
          ? classes[0]
          : 'multiple_classes',
    sourceText: classes.length === 1 ? classes[0].replace('class_', 'Class ') : null,
    officialClasses: classes,
  };
}

// Every golden below is a RECALL unless it says otherwise. The notice type is
// explicit because `riskView` requires it (P2B7N): a Public Health Alert is
// the one notice whose risk label is suppressed, and no caller may leave that
// dimension unstated.
function view(classes: OfficialClass[], agency: SourceAgency = 'FDA') {
  return riskView(classificationOf(classes), agency, 'recall');
}

test('A. Class I only — Critical, official Class I', () => {
  const v = view(['class_I']);
  assert.equal(v.tier, 'critical');
  assert.equal(v.badgeLabel, 'CRITICAL');
  assert.equal(v.headlineLabel, 'CRITICAL');
  assert.deepEqual(v.official, {
    heading: 'Official FDA classification',
    text: 'Class I',
    note: null,
  });
});

test('B. Class II only — High, official Class II', () => {
  const v = view(['class_II']);
  assert.equal(v.tier, 'high');
  assert.equal(v.badgeLabel, 'HIGH');
  assert.equal(v.headlineLabel, 'HIGH');
  assert.equal(v.official?.text, 'Class II');
  assert.equal(v.official?.heading, 'Official FDA classification');
});

test('C. Class III only — Low, official Class III, never called safe', () => {
  const v = view(['class_III']);
  assert.equal(v.tier, 'low');
  assert.equal(v.badgeLabel, 'LOW');
  assert.equal(v.headlineLabel, 'LOW');
  assert.equal(v.official?.text, 'Class III');
  assert.match(v.note ?? '', /still an active recall/);
  assert.doesNotMatch(v.note ?? '', /safe/i);
});

test('D. Class I + II — Very High, both classes named, difference explained', () => {
  const v = view(['class_I', 'class_II']);
  assert.equal(v.tier, 'very_high');
  assert.equal(v.badgeLabel, 'VERY HIGH');
  assert.equal(v.headlineLabel, 'VERY HIGH');
  assert.deepEqual(v.official, {
    heading: 'Official FDA classifications',
    text: 'Class I and Class II',
    note: 'FDA assigned different classifications to different affected products.',
  });
});

test('E. Class II + III — Moderate, both classes named', () => {
  const v = view(['class_II', 'class_III']);
  assert.equal(v.tier, 'moderate');
  assert.equal(v.badgeLabel, 'MODERATE');
  assert.equal(v.headlineLabel, 'MODERATE');
  assert.equal(v.official?.text, 'Class II and Class III');
  assert.equal(v.official?.heading, 'Official FDA classifications');
});

test('F. Class I + II + III — Very High, all three classes named', () => {
  const v = view(['class_I', 'class_II', 'class_III']);
  assert.equal(v.tier, 'very_high');
  assert.equal(v.official?.text, 'Class I, Class II, and Class III');
});

test('G. unmatched FDA recall — Pending on both surfaces, explained once', () => {
  const v = view([]);
  assert.equal(v.tier, 'pending');
  // One shared label for both surfaces (P2a, kept): Home badge and Detail
  // headline agree, and the one pending explanation is the top-level note —
  // the old bottom "Not yet assigned" block restated it and is deliberately
  // gone. No " RISK" suffix: an absent classification is not a level of risk.
  assert.equal(v.headlineLabel, 'PENDING');
  assert.equal(v.badgeLabel, 'PENDING');
  assert.equal(v.note, 'The agency assigns a formal recall classification later in its process.');
  assert.equal(v.official, null);
});

test('a public health alert is Unknown, never Pending forever — and badges nothing', () => {
  const classification: Classification = {
    value: 'not_applicable_pha',
    sourceText: null,
    officialClasses: [],
  };
  const v = riskView(classification, 'FSIS', 'public_health_alert');
  // The DOMAIN answer is unchanged and still Unknown: no fabricated class and
  // no invented level. Storage, filtering, sorting and search all read this
  // tier, and P2B7N did not touch any of them.
  assert.equal(v.tier, 'unknown');
  // What changed is only whether that absence is BADGED. A PHA carries its own
  // explicit notice label, so "UNKNOWN" beside "PUBLIC HEALTH ALERT" added no
  // information and read as a parsing failure on a correctly processed alert.
  // Both surfaces lose it from the same one decision — Detail cannot keep a
  // label the cards drop.
  assert.equal(v.headlineLabel, null);
  assert.equal(v.badgeLabel, null);
  // The precise reason is still NOT left unsaid: the official block below the
  // header states that a public health alert never receives a formal
  // classification, exactly as before. Suppressing the badge removed a
  // redundant token, not the explanation.
  assert.deepEqual(v.official, {
    heading: 'Official USDA FSIS classification',
    text: 'Not assigned',
    note: 'Public health alerts do not receive a formal classification.',
  });
  // The suppression is keyed on the NOTICE TYPE, not on the classification
  // value: the identical classification on a recall still badges UNKNOWN, so
  // the exception cannot leak into the rest of the corpus.
  const asRecall = riskView(classification, 'FSIS', 'recall');
  assert.equal(asRecall.tier, 'unknown');
  assert.equal(asRecall.badgeLabel, 'UNKNOWN');
  assert.equal(asRecall.headlineLabel, 'UNKNOWN');
});

test('FSIS classifications map through the same scale, with agency provenance', () => {
  assert.equal(view(['class_I'], 'FSIS').tier, 'critical');
  assert.equal(view(['class_II'], 'FSIS').tier, 'high');
  assert.equal(view(['class_III'], 'FSIS').tier, 'low');
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
    assert.ok(['CRITICAL', 'VERY HIGH', 'HIGH', 'MODERATE', 'LOW'].includes(label), label);
    assert.doesNotMatch(label, /class/i);
  }
  // Pending/Unknown badge their non-scale state, never a rated tier and
  // never a regulatory class.
  assert.equal(view([]).badgeLabel, 'PENDING');
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
  assert.equal(view([]).accessibilityLabel, 'Risk level: Pending');
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

test('the complete label set is exactly seven words, in exactly this casing', () => {
  // The seven consumer risk labels, spelled the one way they are allowed to
  // be spelled. Anything that renders a risk level reads these words from
  // riskTierWord, so this assertion is the whole vocabulary.
  assert.deepEqual(RISK_FILTER_TIERS.map(riskTierWord), [
    'Critical',
    'Very High',
    'High',
    'Moderate',
    'Low',
    'Pending',
    'Unknown',
  ]);
  // The retired vocabulary is gone from the canonical words entirely.
  for (const retired of ['Minimal', 'Not rated', 'Unrated', 'Risk pending']) {
    assert.ok(
      !RISK_FILTER_TIERS.map(riskTierWord).includes(retired),
      `retired label still in the set: ${retired}`,
    );
  }
});

test('every label reaches the badge, the headline and the spoken label intact', () => {
  // Casing is a typographic treatment on the badge and headline only (they
  // shout, as they always have); the spoken label carries the canonical
  // casing verbatim, so a screen reader announces "Very High", never
  // "VERY HIGH" or "very high".
  const cases: [Classification, ConsumerRiskTier][] = [
    [classificationOf(['class_I']), 'critical'],
    [classificationOf(['class_I', 'class_II']), 'very_high'],
    [classificationOf(['class_II']), 'high'],
    [classificationOf(['class_II', 'class_III']), 'moderate'],
    [classificationOf(['class_III']), 'low'],
    [{ value: 'not_yet_classified', sourceText: null, officialClasses: [] }, 'pending'],
    [{ value: 'not_applicable_pha', sourceText: null, officialClasses: [] }, 'unknown'],
  ];
  assert.equal(cases.length, RISK_FILTER_TIERS.length);
  for (const [classification, tier] of cases) {
    const v = riskView(classification, 'FDA', 'recall');
    const word = riskTierWord(tier);
    assert.equal(v.tier, tier);
    assert.equal(v.accessibilityLabel, `Risk level: ${word}`);
    assert.equal(v.badgeLabel, word.toUpperCase());
    // The Detail label is the same canonical word as the feed badge (founder
    // decision, 2026-09-14): no " RISK" suffix on any tier.
    assert.equal(v.headlineLabel, word.toUpperCase());
  }
});

test('no retired risk label survives anywhere riskView can render it', () => {
  const everything: string[] = [];
  for (const classes of [
    ['class_I'],
    ['class_I', 'class_II'],
    ['class_I', 'class_III'],
    ['class_I', 'class_II', 'class_III'],
    ['class_II'],
    ['class_II', 'class_III'],
    ['class_III'],
    [],
  ] as OfficialClass[][]) {
    const v = view(classes);
    everything.push(v.badgeLabel ?? '', v.headlineLabel ?? '', v.accessibilityLabel, v.note ?? '');
  }
  const pha = riskView(
    { value: 'not_applicable_pha', sourceText: null, officialClasses: [] },
    'FSIS',
    'recall',
  );
  everything.push(
    pha.badgeLabel ?? '',
    pha.headlineLabel ?? '',
    pha.accessibilityLabel,
    pha.official?.text ?? '',
  );
  const rendered = everything.join(' | ');
  for (const retired of [/\bMinimal\b/i, /\bNot rated\b/i, /\bUnrated\b/i, /Risk pending/i]) {
    assert.doesNotMatch(rendered, retired);
  }
});

test('every rendered risk label is one of the seven canonical words — on both surfaces', () => {
  // The complete label vocabulary, uppercased the way the badge and the Detail
  // label render it. Nothing else may ever reach a screen: no " RISK" suffix,
  // no "Risk pending", no "Not rated".
  const canonical = ['CRITICAL', 'VERY HIGH', 'HIGH', 'MODERATE', 'LOW', 'PENDING', 'UNKNOWN'];
  const classifications: Classification[] = [
    classificationOf(['class_I']),
    classificationOf(['class_I', 'class_II']),
    classificationOf(['class_I', 'class_III']),
    classificationOf(['class_I', 'class_II', 'class_III']),
    classificationOf(['class_II']),
    classificationOf(['class_II', 'class_III']),
    classificationOf(['class_III']),
    classificationOf([]),
    { value: 'not_applicable_pha', sourceText: null, officialClasses: [] },
    { value: 'multiple_classes', sourceText: null },
  ];
  const seen = new Set<string>();
  for (const classification of classifications) {
    for (const agency of ['FDA', 'FSIS'] as const) {
      const v = riskView(classification, agency, 'recall');
      assert.ok(v.badgeLabel !== null && canonical.includes(v.badgeLabel), `${v.badgeLabel}`);
      assert.ok(
        v.headlineLabel !== null && canonical.includes(v.headlineLabel),
        `${v.headlineLabel}`,
      );
      // One word, both surfaces — the feed and Detail can never disagree.
      assert.equal(v.headlineLabel, v.badgeLabel);
      seen.add(v.badgeLabel);
    }
  }
  // Every one of the seven is reachable, so the vocabulary is complete as
  // well as closed.
  assert.deepEqual([...seen].sort(), [...canonical].sort());

  // The notice type can only SUPPRESS a label, never rewrite one. Over the
  // same classifications read as a Public Health Alert, every label that
  // survives is still one of the seven canonical words and still identical on
  // both surfaces — the PHA exception introduces no eighth word, no "N/A", and
  // no blank-but-present label.
  for (const classification of classifications) {
    for (const agency of ['FDA', 'FSIS'] as const) {
      const v = riskView(classification, agency, 'public_health_alert');
      assert.equal(v.headlineLabel, v.badgeLabel);
      if (v.badgeLabel === null) {
        assert.equal(v.tier, 'unknown');
        continue;
      }
      assert.ok(canonical.includes(v.badgeLabel), `${v.badgeLabel}`);
      // A PHA that ever arrives carrying a real classification keeps it: only
      // the meaningless `unknown` is dropped, so meaningful agency data can
      // never be silently discarded by this rule.
      assert.notEqual(v.tier, 'unknown');
    }
  }
});
