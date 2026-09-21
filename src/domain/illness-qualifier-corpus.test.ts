/**
 * P2B7L: the qualified-none correction, proved against the REAL notices.
 *
 * `fixtures/illness-qualifier-corpus.json` holds every stored case whose
 * official notice carries a "no other / additional / further … illness"
 * qualifier, recorded read-only from production with its verbatim
 * `summaryText`. All 28 classified as `reported_unspecified` under P2B7K and
 * announced "Illnesses reported" on Recall Detail; none of them states an
 * illness anywhere else in the notice.
 *
 * These tests derive FRESH from the recorded prose — the stored
 * `kindBeforeP2B7L` and `storedReportsIllness` fields are historical evidence
 * of the defect, never an input to the assertions. Two properties are pinned
 * together, and they are what make the fix a correction rather than a
 * suppression:
 *
 *   1. no case in this corpus announces an illness any more;
 *   2. a case here would still announce one if its own prose established one —
 *      proved by mutation, sentence by sentence.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  deriveIllnessStatus,
  illnessNoticeCopy,
  narrativeWithoutIllness,
  statusReportsIllness,
} from './illness-status';
import { statementReportsIllness } from './projection';

interface CorpusCase {
  recallCaseId: string;
  sourceAgency: string;
  lifecycle: string;
  consumerHidden: boolean;
  title: string;
  storedReportsIllness: boolean;
  kindBeforeP2B7L: string;
  qualifierSentence: string | null;
  summaryText: string;
}

const CORPUS: { count: number; cases: CorpusCase[] } = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'illness-qualifier-corpus.json'), 'utf8'),
);

const label = (c: CorpusCase) => `${c.recallCaseId.slice(0, 8)} ${c.title.slice(0, 60)}`;

test('the recorded corpus is the whole qualified-none population, not a sample', () => {
  assert.equal(CORPUS.cases.length, CORPUS.count);
  assert.equal(CORPUS.count, 28, 'the population measured read-only on 2026-09-18');
  assert.equal(new Set(CORPUS.cases.map((c) => c.recallCaseId)).size, 28, 'no duplicates');
  for (const c of CORPUS.cases) {
    assert.ok(c.summaryText.trim().length > 0, `${label(c)} has recorded prose`);
    assert.ok(c.qualifierSentence, `${label(c)} recorded the sentence that misled P2B7K`);
  }
});

test('P2B7K announced an illness on every one of them — the defect, on record', () => {
  // If this ever stops being true the fixture has been re-recorded against an
  // already-corrected corpus, and the tests below would prove nothing.
  for (const c of CORPUS.cases) {
    assert.equal(c.kindBeforeP2B7L, 'reported_unspecified', label(c));
  }
});

test('no case in the corpus announces an illness under the corrected contract', () => {
  for (const c of CORPUS.cases) {
    const status = deriveIllnessStatus(c.summaryText);
    assert.equal(status.kind, 'unknown', label(c));
    assert.equal(illnessNoticeCopy(status), null, `${label(c)} renders no notice at all`);
  }
});

test('and none is turned into a false "No illnesses reported" either', () => {
  // The opposite failure: claiming a zero the notice never stated.
  for (const c of CORPUS.cases) {
    assert.notEqual(deriveIllnessStatus(c.summaryText).kind, 'explicit_none', label(c));
  }
});

test('the corrected flag is false for all 28, and it corrects 23 stored values up-front', () => {
  let contradictsStored = 0;
  for (const c of CORPUS.cases) {
    assert.equal(statusReportsIllness(deriveIllnessStatus(c.summaryText)), false, label(c));
    if (c.storedReportsIllness) contradictsStored += 1;
  }
  // 23 carried a stored `false` that P2B7K would have repaired UP to true;
  // after the correction they are already right and need no write at all.
  // The other 5 carry a stored `true` that is now stale in the other
  // direction — they become true -> false corrections.
  assert.equal(CORPUS.cases.filter((c) => !c.storedReportsIllness).length, 23);
  assert.equal(contradictsStored, 5);
});

test('MUTATION: adding a real illness statement makes each case report again', () => {
  // The correction must be inert-qualifier-shaped, not blanket suppression of
  // any notice containing the word "illness". Every case in the corpus, given
  // one sentence that genuinely establishes an illness, must announce it.
  for (const c of CORPUS.cases) {
    const withCount = deriveIllnessStatus(
      `${c.summaryText} There have been 7 illnesses reported in connection with these products.`,
    );
    assert.equal(withCount.kind, 'reported_count', `${label(c)} + a count`);
    assert.equal(withCount.illnesses, 7, label(c));

    const withAssertion = deriveIllnessStatus(
      `${c.summaryText} Illnesses have been reported in connection with these products.`,
    );
    assert.equal(withAssertion.kind, 'reported_unspecified', `${label(c)} + an assertion`);
    assert.equal(statusReportsIllness(withAssertion), true, label(c));
  }
});

test('MUTATION: adding an explicit illness denial makes each case deny again', () => {
  for (const c of CORPUS.cases) {
    const status = deriveIllnessStatus(
      `${c.summaryText} There have been no reports of illness associated with this product.`,
    );
    assert.equal(status.kind, 'explicit_none', label(c));
    assert.equal(illnessNoticeCopy(status)!.lines[0], 'No illnesses reported', label(c));
  }
});

test('MUTATION: removing the qualifier sentence changes nothing — it carried no fact', () => {
  // The decisive evidence for the founder decision: these notices establish
  // exactly as much illness status without the sentence as with it, which is
  // none. A notice whose qualifier really did point back at a stated illness
  // would differ here.
  for (const c of CORPUS.cases) {
    const without = c.summaryText
      .split(/(?<=\.)\s+/)
      .filter((sentence) => !/\bno\s+(?:other|additional|further)\b/i.test(sentence))
      .join(' ');
    assert.equal(
      deriveIllnessStatus(without).kind,
      deriveIllnessStatus(c.summaryText).kind,
      label(c),
    );
  }
});

test('the qualifier sentence survives in What Happened — it is still source text', () => {
  // Inert for the status, never deleted from the narrative: the sentence backs
  // no status, so `narrativeWithoutIllness` has nothing it may drop.
  for (const c of CORPUS.cases) {
    const status = deriveIllnessStatus(c.summaryText);
    assert.equal(narrativeWithoutIllness(c.summaryText, status), c.summaryText, label(c));
  }
});

test('PARITY: Detail, the projection flag and the repair plan read the same answer', () => {
  // One semantic system. `statementReportsIllness` is what `projectCase` calls,
  // `deriveIllnessStatus` is what Recall Detail and the repair both call; a
  // disagreement between them is the defect P2B7K removed, and this is what
  // keeps it removed.
  for (const c of CORPUS.cases) {
    const status = deriveIllnessStatus(c.summaryText);
    const detailShowsIllness = illnessNoticeCopy(status)?.tone === 'reported';
    const projectionFlag = statementReportsIllness(c.summaryText);
    const repairPlanValue = statusReportsIllness(status);

    assert.equal(projectionFlag, repairPlanValue, `${label(c)} projection vs repair`);
    assert.equal(detailShowsIllness, repairPlanValue, `${label(c)} Detail vs flag`);
    assert.equal(projectionFlag, false, label(c));
  }
});

test('PARITY holds under mutation too, not just on the quiet path', () => {
  for (const c of CORPUS.cases) {
    for (const suffix of [
      ' There have been 7 illnesses reported in connection with these products.',
      ' Illnesses have been reported in connection with these products.',
      ' There have been no reports of illness associated with this product.',
      '',
    ]) {
      const text = `${c.summaryText}${suffix}`;
      const status = deriveIllnessStatus(text);
      assert.equal(
        statementReportsIllness(text),
        statusReportsIllness(status),
        `${label(c)}${suffix.slice(0, 40)}`,
      );
    }
  }
});
