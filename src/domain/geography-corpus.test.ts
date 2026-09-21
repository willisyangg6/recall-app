/**
 * P2B7Q.2: the canonical geography contract, proved against the REAL notices.
 *
 * `fixtures/geography-evidence-corpus.json` holds one recorded announcement
 * per evidence shape the derivation has to decide, plus all nineteen active
 * cases on which the feed card and Recall Detail named different states when
 * the milestone opened. Every entry carries its verbatim `summaryText`.
 *
 * These tests derive FRESH from the recorded prose. The stored
 * `storedScope`/`storedStates` are historical evidence of the defect, never an
 * input to an assertion — which is what makes this a regression corpus rather
 * than a snapshot of whatever the code happens to do.
 *
 * Two properties are pinned together, and neither is enough alone:
 *
 *   1. every state the notice AFFIRMS is admitted — a missing state turns
 *      "we are not sure this reached you" into "this does not affect you";
 *   2. every place the notice merely MENTIONS is refused — a state health
 *      department, a dateline, a company name, a place the notice says is not
 *      affected.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { evaluateGeographyEvidence, readDistributionProse } from './geography-evidence';
import type { Geography } from './recall-types';
import { statesInText } from './us-geography';

interface CorpusCase {
  recallCaseId: string;
  sourceAgency: string;
  lifecycle: string;
  title: string;
  shape: string;
  shapes: string[];
  note: string;
  storedScope: Geography['scope'];
  storedStates: string[];
  expectedScope: Geography['scope'];
  expectedStates: string[];
  mustNotInclude: string[];
  admittedSentences: string[];
  summaryText: string;
}

const CORPUS: {
  count: number;
  disagreementCount: number;
  shapesWithNoLiveExample: string[];
  cases: CorpusCase[];
} = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'geography-evidence-corpus.json'), 'utf8'),
);

const label = (c: CorpusCase) => `${c.recallCaseId.slice(0, 8)} ${c.title.slice(0, 56)}`;

/** Derive as `projectCase` does, from the case's own carried geography. */
function derive(c: CorpusCase) {
  return evaluateGeographyEvidence({
    title: c.title,
    summaryText: c.summaryText,
    summaryHtml: null,
    carried: {
      scope: c.storedScope,
      states: c.storedStates,
      confidence: 'inferred',
      sourceText: null,
    },
  });
}

test('the recorded corpus covers every evidence shape and the whole disagreement population', () => {
  assert.equal(CORPUS.cases.length, CORPUS.count);
  assert.equal(CORPUS.disagreementCount, 19, 'the population measured read-only on 2026-09-20');
  assert.deepEqual(CORPUS.shapesWithNoLiveExample, [], 'every shape has a real example');
  assert.equal(
    new Set(CORPUS.cases.map((c) => c.recallCaseId)).size,
    CORPUS.count,
    'no duplicates',
  );
  for (const c of CORPUS.cases) {
    assert.ok(c.summaryText.trim().length > 0, `${label(c)} has recorded prose`);
  }
});

test('every state the notice affirms is admitted', () => {
  for (const c of CORPUS.cases) {
    const derived = derive(c);
    assert.deepEqual(
      derived.geography.states,
      c.expectedStates,
      `${label(c)} [${c.shape}] — reviewed states: ${c.expectedStates.join(', ') || '(none)'}`,
    );
    assert.equal(derived.geography.scope, c.expectedScope, label(c));
  }
});

test('every place the notice rules out stays out', () => {
  let asserted = 0;
  for (const c of CORPUS.cases) {
    if (c.mustNotInclude.length === 0) continue;
    const derived = derive(c);
    for (const state of c.mustNotInclude) {
      assert.ok(
        !derived.geography.states.includes(state),
        `${label(c)} must not claim ${state}: the notice says it is not affected`,
      );
      asserted += 1;
    }
  }
  assert.ok(asserted > 0, 'the corpus records at least one explicitly unaffected place');
});

test('a state the notice both affirms and rules out is refused, never guessed', () => {
  // Nothing in the live corpus contradicts itself, so the rule is proved on
  // the contract rather than on a case that does not exist.
  const evidence = evaluateGeographyEvidence({
    title: 'A Firm Recalls A Product',
    summaryText:
      'The product was distributed to retail stores in California, Nevada and Arizona.\n' +
      'Stores in Nevada are not impacted by this recall.',
    summaryHtml: null,
    carried: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
  });
  assert.deepEqual(evidence.geography.states, ['Arizona', 'California']);
  assert.deepEqual(evidence.contradictedStates, ['Nevada']);
  assert.deepEqual(evidence.excludedStates, ['Nevada']);
});

test('a scope is never widened into nationwide by the length of its state list', () => {
  const forty = Array.from({ length: 40 }, (_, i) => `State${i}`);
  const evidence = evaluateGeographyEvidence({
    title: 'A Firm Recalls A Product',
    summaryText: 'The product was distributed to retail stores in Texas and California.',
    summaryHtml: null,
    carried: { scope: 'states', states: forty, confidence: 'inferred', sourceText: null },
  });
  assert.equal(evidence.geography.scope, 'states');
  assert.notEqual(evidence.geography.scope, 'nationwide');
});

test('absence never becomes presence: a silent notice stays unknown', () => {
  const silent = CORPUS.cases.filter(
    (c) => c.expectedScope === 'unknown' && c.storedScope === 'unknown',
  );
  assert.ok(silent.length > 0, 'the corpus records a genuinely silent notice');
  for (const c of silent) {
    const derived = derive(c);
    assert.equal(derived.geography.scope, 'unknown', label(c));
    assert.deepEqual(derived.geography.states, [], label(c));
  }
});

test('a carried nationwide scope is never second-guessed', () => {
  const nationwide = CORPUS.cases.filter((c) => c.storedScope === 'nationwide');
  assert.ok(nationwide.length > 0, 'the corpus records a nationwide case');
  for (const c of nationwide) {
    const derived = derive(c);
    assert.equal(derived.geography.scope, 'nationwide', label(c));
    assert.deepEqual(derived.removedStates, [], label(c));
  }
});

test('the derivation is idempotent: re-deriving its own answer changes nothing', () => {
  for (const c of CORPUS.cases) {
    const once = derive(c).geography;
    const twice = evaluateGeographyEvidence({
      title: c.title,
      summaryText: c.summaryText,
      summaryHtml: null,
      carried: once,
    }).geography;
    assert.deepEqual(twice.states, once.states, label(c));
    assert.equal(twice.scope, once.scope, label(c));
  }
});

test('every admitted state can be quoted back to the sentence that admitted it', () => {
  for (const c of CORPUS.cases) {
    if (c.storedScope === 'nationwide') continue;
    const prose = readDistributionProse(c.summaryText);
    // Provenance must be COMPLETE: reading the admitted units alone has to
    // reproduce every admitted state, so a repair ledger and a founder report
    // can always quote the sentence a state came from.
    const fromUnits = statesInText(prose.admittedUnits.join('\n'));
    for (const state of prose.states) {
      assert.ok(
        fromUnits.includes(state),
        `${label(c)} admitted ${state} with no sentence to show for it`,
      );
    }
  }
});
