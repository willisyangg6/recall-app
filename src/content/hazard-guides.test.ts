/**
 * The reviewed hazard-guide registry (P1B): content integrity and the
 * standardization guarantee.
 *
 * These tests are about the COPY and its governance — that every guide cites
 * an authoritative U.S. government source with a review date, that the copy
 * carries no diagnosis or causation claim, and that the registry cannot
 * silently grow a duplicate key or an unranked entry. How a guide is SELECTED
 * for a notice is pinned in recall-display.test.ts; how it reaches the screen
 * is pinned in recall-presentation.test.ts and the wiring suite.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ALLERGEN_GUIDE_KEY, HAZARD_GUIDES, hazardGuideByKey } from './hazard-guides';

const ALL_TEXT = HAZARD_GUIDES.flatMap((guide) => [
  guide.risk ?? '',
  guide.higherRisk ?? '',
  ...(guide.symptoms ?? []),
]).join('\n');

test('every guide cites an authoritative U.S. government source with a review date', () => {
  for (const guide of HAZARD_GUIDES) {
    assert.ok(
      ['CDC', 'FDA', 'FSIS'].includes(guide.source.organization),
      `${guide.key} cites a non-government source`,
    );
    // Only the citing agency's own domain may back its copy — a consumer
    // health site, aggregator, or search summary can never appear here.
    assert.match(
      guide.source.url,
      /^https:\/\/(www\.)?(cdc|fda|fsis\.usda)\.gov\//,
      `${guide.key} cites a non-government URL`,
    );
    assert.match(
      guide.source.reviewedOn,
      /^\d{4}-\d{2}-\d{2}$/,
      `${guide.key} lacks a review date`,
    );
    assert.ok(guide.version >= 1, `${guide.key} is unversioned`);
  }
});

test('guide keys are unique and display priorities are distinct', () => {
  const keys = HAZARD_GUIDES.map((guide) => guide.key);
  assert.equal(new Set(keys).size, keys.length, 'a guide key is duplicated');
  const priorities = HAZARD_GUIDES.map((guide) => guide.displayPriority);
  // Distinct priorities are what make the display tie-breaker total: two
  // guides sharing one would make the winner depend on registry order again.
  // This is a presentation ordering, not a medical severity scale.
  assert.equal(new Set(priorities).size, priorities.length, 'two guides share a display priority');
  for (const priority of priorities) assert.ok(priority > 0, 'a guide has no display priority');
});

test('every corpus-evidenced named pathogen has a guide', () => {
  // The organisms the recorded FDA + FSIS corpora actually name. A pathogen
  // evidenced in the corpus without a guide is a silent coverage hole.
  for (const key of ['salmonella', 'listeria', 'stec', 'botulism', 'hepatitis-a', 'cyclospora']) {
    const guide = hazardGuideByKey(key as never);
    assert.ok(guide, `no guide for corpus pathogen ${key}`);
    assert.ok(guide.symptoms && guide.symptoms.length > 0, `${key} has no symptom list`);
    assert.ok(guide.match.length > 0, `${key} has no organism matcher`);
  }
});

test('the allergen guide is selected by family, not by organism name', () => {
  const allergen = hazardGuideByKey(ALLERGEN_GUIDE_KEY);
  assert.ok(allergen);
  assert.equal(allergen.match.length, 0, 'the allergen guide carries organism matchers');
  // Its risk sentence names the specific undeclared allergen, so it is
  // supplied by the approved allergen template rather than fixed here. It is
  // the ONLY guide allowed to do that.
  assert.equal(allergen.risk, null);
  assert.equal(
    HAZARD_GUIDES.filter((guide) => guide.risk === null).length,
    1,
    'more than one guide defers its risk sentence',
  );
  for (const guide of HAZARD_GUIDES) {
    if (guide.key === ALLERGEN_GUIDE_KEY) continue;
    assert.ok(guide.risk && guide.risk.trim() !== '', `${guide.key} has no risk statement`);
  }
});

test('no guide diagnoses, promises, or asserts causation', () => {
  // General hazard education only. Nothing may tell a reader what their
  // symptoms mean, claim their illness came from this product, or make a
  // certainty claim the sources do not support.
  assert.doesNotMatch(ALL_TEXT, /\byou (?:have|are infected|were infected|caught|contracted)\b/i);
  assert.doesNotMatch(ALL_TEXT, /\byour symptoms?\b/i);
  assert.doesNotMatch(ALL_TEXT, /\b(?:diagnos|treatment plan|prescrib|cure[sd]?)\b/i);
  assert.doesNotMatch(ALL_TEXT, /\bif you (?:feel|have|ate|experience)\b/i);
  // Causation: a symptom list must never be phrased as this recall's illnesses.
  assert.doesNotMatch(ALL_TEXT, /\bthis recall\b|\breported illnesses\b|\bpeople who ate\b/i);
  // Certainty and severity inflation the sources do not state.
  assert.doesNotMatch(
    ALL_TEXT,
    /\bwill (?:cause|make you|become)\b|\balways causes\b|\bguarantee/i,
  );
  assert.doesNotMatch(ALL_TEXT, /\bdeadly\b|\bfatal\b|\bpoison(?:ous)?\b(?! )/i);
});

test('symptom bullets stay short enough for a mobile detail screen', () => {
  for (const guide of HAZARD_GUIDES) {
    for (const symptom of guide.symptoms ?? []) {
      assert.ok(symptom.length <= 60, `${guide.key} symptom is too long: ${symptom}`);
      // Bullets are labels, not sentences — no trailing period, no prose.
      assert.doesNotMatch(symptom, /\.$/, `${guide.key} symptom reads as a sentence`);
    }
    // The risk statement is one or two concise sentences.
    if (guide.risk) {
      assert.ok(guide.risk.length <= 260, `${guide.key} risk statement is too long`);
      assert.ok((guide.risk.match(/\.\s|\.$/g) ?? []).length <= 3, `${guide.key} risk is too long`);
    }
  }
});

test('the botulism guide states the emergency the source states', () => {
  // CDC calls botulism a medical emergency; a guide that softened that would
  // be the one omission with a real safety cost.
  const botulism = hazardGuideByKey('botulism');
  assert.ok(botulism);
  assert.match(botulism.risk ?? '', /life-threatening|emergency/i);
  // It also wins the display tie-breaker, so a notice naming botulism
  // alongside another supported hazard still shows the botulism guide.
  assert.equal(
    botulism.displayPriority,
    Math.max(...HAZARD_GUIDES.map((guide) => guide.displayPriority)),
  );
});

test('no guide states an onset, incubation, or duration window', () => {
  // The section explains what a hazard is and what it can do. It deliberately
  // does NOT help a reader time their own symptoms against an exposure: an
  // onset or duration window invites self-diagnosis, which this app does not
  // do and is not qualified to support. Removed from every guide, and pinned
  // here so it cannot drift back in.
  assert.doesNotMatch(
    ALL_TEXT,
    /\b\d+\s*(?:to|–|-|and)\s*\d+\s*(?:hours?|days?|weeks?|months?|years?)\b/i,
    'a numeric onset/duration window returned',
  );
  assert.doesNotMatch(
    ALL_TEXT,
    /\b(?:within|after|about|around|usually|typically|approximately)\s+(?:a|an|one|two|\d+)?\s*(?:hours?|days?|weeks?|months?)\b/i,
    'a timing window returned',
  );
  assert.doesNotMatch(
    ALL_TEXT,
    /\b(?:last|lasts|lasting|persist\w*|recover\w*|resolve\w*|begin\w*|start\w*|appear\w*)\b[^.]{0,40}\b(?:hours?|days?|weeks?|months?)\b/i,
    'a duration estimate returned',
  );
  // No bare time units anywhere in consumer-visible guide copy.
  assert.doesNotMatch(ALL_TEXT, /\b(?:hours?|days?|weeks?|months?)\b/i, 'a time unit remains');
  assert.doesNotMatch(ALL_TEXT, /\bincubation\b/i);
});

test('the founder-consolidated guides render one paragraph, not two', () => {
  // Founder visual QA (2026-09-10): allergen, E. coli, Listeria, and
  // Salmonella each fold their higher-risk group INTO the single risk
  // paragraph, so the section goes straight from that paragraph to Common
  // Symptoms with no second paragraph in between. Hepatitis A was
  // deliberately NOT part of this pass and keeps its own separate
  // higher-risk paragraph — this test is scoped to exactly the four guides
  // the founder specified, not the whole registry.
  for (const key of ['undeclared-allergen', 'stec', 'listeria', 'salmonella'] as const) {
    const guide = hazardGuideByKey(key);
    assert.equal(guide?.higherRisk, null, `${key} still carries a second paragraph`);
  }
  // Untouched by this pass: hepatitis A keeps its separate paragraph, and
  // botulism/cyclospora keep their pre-existing absence of one.
  assert.ok(hazardGuideByKey('hepatitis-a')?.higherRisk, 'hepatitis A lost its higher-risk group');
  assert.equal(hazardGuideByKey('botulism')?.higherRisk, null);
  assert.equal(hazardGuideByKey('cyclospora')?.higherRisk, null);
});

test('the higher-risk group is folded into the one risk paragraph where the source names one', () => {
  const listeria = hazardGuideByKey('listeria');
  assert.match(listeria?.risk ?? '', /pregnant/i);
  const stec = hazardGuideByKey('stec');
  assert.match(stec?.risk ?? '', /young children and adults 65/i);
  const salmonella = hazardGuideByKey('salmonella');
  assert.match(salmonella?.risk ?? '', /weakened immune systems/i);
  // Absent, not invented, where the cited page identifies no group — this
  // was true before and is unchanged by the paragraph consolidation.
  assert.doesNotMatch(hazardGuideByKey('botulism')?.risk ?? '', /higher risk|more likely/i);
  assert.doesNotMatch(hazardGuideByKey('cyclospora')?.risk ?? '', /higher risk|more likely/i);
});

test('the allergen guide has no secondary paragraph: only the approved risk template and symptoms', () => {
  const allergen = hazardGuideByKey(ALLERGEN_GUIDE_KEY);
  assert.ok(allergen);
  // The opening sentence still comes from the approved allergen template
  // (named to the specific allergen at selection time) — unaffected here.
  assert.equal(allergen.risk, null);
  assert.equal(allergen.higherRisk, null);
  assert.ok(allergen.symptoms && allergen.symptoms.length > 0, 'allergen symptoms were removed');
});
