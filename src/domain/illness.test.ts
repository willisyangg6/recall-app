import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFixture } from '../server/fsis/fixtures';
import { parseFsisRecord } from '../server/fsis/parse';
import { classifyIllnessReport, healthEducationText } from './illness';

test('explicit zero (the dominant FSIS boilerplate) → none_reported', () => {
  // Real record: 017-2026 states no illnesses.
  const summary = parseFsisRecord(loadFixture('recall-active-nationwide-017-2026')).summaryText;
  const report = classifyIllnessReport(summary);
  assert.equal(report.status, 'none_reported');
  assert.match(report.statements[0], /no confirmed reports|no reports|been no/i);
});

test('actual outbreak counts (Boar’s Head 023-2024) → reported, verbatim counts kept', () => {
  const summary = parseFsisRecord(loadFixture('recall-illness-outbreak-023-2024')).summaryText;
  const report = classifyIllnessReport(summary);
  assert.equal(report.status, 'reported');
  const joined = report.statements.join(' ');
  assert.match(joined, /34 sick people/);
  assert.match(joined, /33 hospitalizations/);
  assert.match(joined, /two deaths/);
  // Advice, discovery, and education sentences must NOT be in the statements.
  assert.doesNotMatch(joined, /concerned about illness/i);
  assert.doesNotMatch(joined, /problem was discovered/i);
  assert.doesNotMatch(joined, /can cause/i);
});

test('source silence is unknown — never converted into zero', () => {
  const silent =
    'Acme Foods is recalling frozen beef products. The products were shipped to retail locations. Consumers with questions can contact the company.';
  assert.equal(classifyIllnessReport(silent).status, 'unknown');
  assert.equal(classifyIllnessReport(null).status, 'unknown');
  assert.equal(classifyIllnessReport('').status, 'unknown');
});

test('disease education is not an illness report', () => {
  const education =
    'Consumption of food contaminated with Salmonella can cause salmonellosis, one of the most common bacterial foodborne illnesses. The most common symptoms of salmonellosis are diarrhea, abdominal cramps, and fever. Older adults and persons with weakened immune systems are more likely to develop a severe illness.';
  const report = classifyIllnessReport(education);
  assert.equal(report.status, 'unknown');
  // …but it IS health-risk education.
  assert.match(healthEducationText(education) ?? '', /can cause salmonellosis/);
});

test('discovery-method and healthcare-advice prose are not illness reports', () => {
  assert.equal(
    classifyIllnessReport('The problem was discovered during FSIS surveillance activities.').status,
    'unknown',
  );
  assert.equal(
    classifyIllnessReport('Anyone concerned about an illness should contact a healthcare provider.')
      .status,
    'unknown',
  );
});

test('missing punctuation across a newline boundary cannot merge sentences (parser-artifact shape)', () => {
  // The classic artifact: "…surveillance activities" then a newline with no
  // period, followed by the explicit-zero sentence.
  const text =
    'The problem was discovered during FSIS surveillance activities\nThere have been no confirmed reports of adverse reactions due to consumption of these products.';
  const report = classifyIllnessReport(text);
  assert.equal(report.status, 'none_reported');
  assert.doesNotMatch(report.statements[0], /surveillance/);
});

test('positive reports win over co-present explicit-zero of a different kind', () => {
  const text =
    'Three illnesses have been reported in connection with this product. There have been no confirmed reports of deaths.';
  const report = classifyIllnessReport(text);
  assert.equal(report.status, 'reported');
  assert.match(report.statements[0], /Three illnesses/);
});
