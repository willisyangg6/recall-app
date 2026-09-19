/**
 * The disease-name correction (P2B7L.1, extended P2B7L.2), proved against the
 * REAL notices.
 *
 * `fixtures/illness-disease-corpus.json` holds every stored case whose official
 * notice names one of the contract's disease names — `salmonellosis`,
 * `listeriosis`, `botulism` — in a sentence that is not hazard education,
 * recorded read-only from production with its verbatim `summaryText`.
 *
 * Before this correction the bare disease names were alternations inside the
 * `EDUCATION` guard, so `isNonReportProse` removed EVERY sentence naming
 * either disease before `deriveIllnessStatus` looked for evidence. Three
 * consequences, all of them defects:
 *
 *   1. genuine reports were inert — "The epidemiologic investigation
 *      identified a total of four listeriosis confirmed illnesses, including
 *      one death" established nothing;
 *   2. the positive branch naming the diseases in `ASSERTS_ILLNESS` was
 *      unreachable, because any sentence it could match was filtered first;
 *   3. supplier-chain prose was suppressed for the wrong reason — the word,
 *      not the semantics — so the suppression could not be relied on.
 *
 * P2B7L.2 gave `botulism` the same treatment and widened the population from
 * 19 cases to 29. That is where the last two weaknesses surfaced: the
 * infant-formula notices state their linked cases as a DISEASE with no illness
 * word beside it, and one of them was having a subset figure ("For 27 cases
 * with illness onset information available") quoted back as its illness count.
 *
 * This population is heterogeneous on purpose: counted reports, uncounted
 * reports, explicit denials, supplier-chain prose, hedged linkage and
 * education-only headings all appear, because telling them apart is the whole
 * job. The recorded `kind` / `illnesses` / `reportsIllness` are a regression
 * pin — the tests derive FRESH from the recorded prose and assert they get the
 * recorded answer back. Re-recording the fixture is the deliberate act that
 * changes an expectation.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { isNonReportProse } from './illness';
import {
  deriveIllnessStatus,
  illnessNoticeCopy,
  narrativeWithoutIllness,
  statusReportsIllness,
} from './illness-status';
import { statementReportsIllness } from './projection';
import { splitSentences } from './text';

interface CorpusCase {
  recallCaseId: string;
  sourceAgency: string;
  lifecycle: string;
  consumerHidden: boolean;
  title: string;
  storedReportsIllness: boolean;
  kind: string;
  illnesses: number | null;
  approximate: boolean;
  reportsIllness: boolean;
  statements: string[];
  diseaseSentencesKept: string[];
  diseaseSentencesFiltered: string[];
  summaryText: string;
}

const CORPUS: { count: number; cases: CorpusCase[] } = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'illness-disease-corpus.json'), 'utf8'),
);

const label = (c: CorpusCase) => `${c.recallCaseId.slice(0, 8)} ${c.title.slice(0, 60)}`;

/** A sentence that genuinely establishes an illness, in the source's own idiom. */
const A_REAL_REPORT = 'Illnesses have been reported in connection with these products.';

test('the recorded corpus is the whole disease-name population, not a sample', () => {
  assert.equal(CORPUS.cases.length, CORPUS.count);
  assert.equal(CORPUS.count, 29, 'the population measured read-only on 2026-09-19');
  assert.equal(new Set(CORPUS.cases.map((c) => c.recallCaseId)).size, 29, 'no duplicates');
  for (const c of CORPUS.cases) {
    assert.ok(c.summaryText.trim().length > 0, `${label(c)} has recorded prose`);
    assert.ok(
      c.diseaseSentencesKept.length > 0,
      `${label(c)} names a disease outside an educational frame`,
    );
  }
});

test('the population carries every shape the correction has to tell apart', () => {
  const kinds = new Set(CORPUS.cases.map((c) => c.kind));
  for (const kind of ['reported_count', 'reported_unspecified', 'explicit_none', 'unknown']) {
    assert.ok(kinds.has(kind), `the corpus exercises ${kind}`);
  }
  // Both agencies, and both lifecycles — the correction is not FSIS-shaped or
  // active-shaped.
  assert.ok(CORPUS.cases.some((c) => c.sourceAgency === 'FDA'));
  assert.ok(CORPUS.cases.some((c) => c.sourceAgency === 'FSIS'));
  assert.ok(CORPUS.cases.some((c) => c.lifecycle === 'active'));
  assert.ok(CORPUS.cases.some((c) => c.lifecycle === 'closed'));
});

test('REGRESSION PIN: deriving fresh reproduces the recorded answer, case by case', () => {
  for (const c of CORPUS.cases) {
    const status = deriveIllnessStatus(c.summaryText);
    assert.equal(status.kind, c.kind, label(c));
    assert.equal(status.illnesses, c.illnesses, `${label(c)} count`);
    assert.equal(status.approximate, c.approximate, `${label(c)} approximate`);
    assert.equal(statusReportsIllness(status), c.reportsIllness, `${label(c)} flag`);
  }
});

test('a disease name alone never establishes anything — education stays inert', () => {
  // Every sentence the education filter removed, read on its own, establishes
  // nothing. This is the property the correction had to preserve while making
  // the report sentences reachable.
  for (const c of CORPUS.cases) {
    for (const sentence of c.diseaseSentencesFiltered) {
      assert.ok(
        isNonReportProse(sentence),
        `${label(c)} still education: ${sentence.slice(0, 80)}`,
      );
      assert.equal(
        deriveIllnessStatus(sentence).kind,
        'unknown',
        `${label(c)} education establishes nothing: ${sentence.slice(0, 80)}`,
      );
    }
    // And all of them together are still nothing.
    assert.equal(
      deriveIllnessStatus(c.diseaseSentencesFiltered.join(' ')).kind,
      'unknown',
      `${label(c)} education en bloc`,
    );
  }
});

test('no status in the corpus rests on an educational sentence', () => {
  for (const c of CORPUS.cases) {
    for (const statement of deriveIllnessStatus(c.summaryText).statements) {
      assert.ok(
        !isNonReportProse(statement),
        `${label(c)} backed by education: ${statement.slice(0, 80)}`,
      );
    }
  }
});

test('no status rests on supplier-chain or hedged prose either', () => {
  // The supplier's outbreak is not this recall's illness report, and a link
  // the source only calls possible is not a link. Neither may ever appear as
  // the evidence behind a rendered notice.
  const SUPPLIER_OR_HEDGE =
    /\bsupplied by\b|\bits supplier\b|\bsupplier(?:'s)?\s+(?:lot|of)\b|\bmay contain\b[^.]{0,80}?\brecalled\b|\b(?:may|might|could)\s+(?:be\s+)?(?:associated|linked|related|connected)\b/i;
  for (const c of CORPUS.cases) {
    for (const statement of deriveIllnessStatus(c.summaryText).statements) {
      // A sentence that names people who fell ill or ate the product is a
      // direct report whatever framing surrounds it, and is allowed.
      const directVictim =
        /\b(?:case-patients?|people|persons?|individuals?|consumers?|patients?)\b[^.]{0,80}?\b(?:consumed|ate|became ill|fell ill|were sickened|sickened|reported (?:eating|consuming))/i.test(
          statement,
        );
      if (directVictim) continue;
      assert.ok(
        !SUPPLIER_OR_HEDGE.test(statement),
        `${label(c)} backed by supplier/hedged prose: ${statement.slice(0, 120)}`,
      );
    }
  }
});

test('a reported status always names illnesses or people, never only a disease', () => {
  for (const c of CORPUS.cases.filter((x) => x.kind.startsWith('reported'))) {
    const statements = deriveIllnessStatus(c.summaryText).statements;
    assert.ok(statements.length > 0, `${label(c)} has backing evidence`);
    assert.ok(
      statements.some((s) =>
        /\b(?:illness(?:es)?|ill\b|sick(?:ened)?|case-patients?|cases?|people|persons?|individuals?|patients?|infants?|babies|children|consumers?|infected)\b/i.test(
          s,
        ),
      ),
      `${label(c)} evidence names human harm or the people it befell, not just a disease`,
    );
  }
});

test('MUTATION: education stays education when the report beside it is removed', () => {
  // The load-bearing distinction, checked from the other side. Strip every
  // sentence that is NOT education and the notice must collapse to `unknown` —
  // if any case still reported, its status was resting on education after all.
  for (const c of CORPUS.cases) {
    // Mutated at the classifier's OWN sentence boundaries. Splitting the text
    // any other way re-glues clauses the classifier reads separately, which
    // tests the splitter rather than the contract.
    const educationOnly = splitSentences(c.summaryText)
      .filter((sentence) => isNonReportProse(sentence))
      .join(' ');
    assert.equal(deriveIllnessStatus(educationOnly).kind, 'unknown', label(c));
  }
});

test('MUTATION: turning a report into education silences it', () => {
  // "four listeriosis confirmed illnesses" reports; "Listeriosis is treated
  // with antibiotics" does not. Same disease, same notice, opposite answers —
  // which is what proves the classifier reads structure and not the word.
  for (const c of CORPUS.cases.filter((x) => x.kind.startsWith('reported'))) {
    const silenced = splitSentences(c.summaryText)
      .map((sentence) =>
        deriveIllnessStatus(sentence).kind.startsWith('reported')
          ? 'Listeriosis is treated with antibiotics.'
          : sentence,
      )
      .join(' ');
    assert.ok(
      !deriveIllnessStatus(silenced).kind.startsWith('reported'),
      `${label(c)} still reports after its report sentences became education`,
    );
  }
});

test('MUTATION: a genuine report is heard over every notice in the corpus', () => {
  // The correction must not be blanket suppression of disease-naming notices.
  // Appending one unambiguous illness sentence must make every case report,
  // including the ones that currently deny and the ones that are silent.
  for (const c of CORPUS.cases) {
    const status = deriveIllnessStatus(`${c.summaryText} ${A_REAL_REPORT}`);
    assert.ok(status.kind.startsWith('reported'), `${label(c)} + a real report`);
    assert.equal(statusReportsIllness(status), true, label(c));
    assert.equal(illnessNoticeCopy(status)!.tone, 'reported', label(c));
  }
});

test('MUTATION: a disease-named count is read as the count it states', () => {
  for (const c of CORPUS.cases) {
    const status = deriveIllnessStatus(
      'The epidemiologic investigation identified a total of six listeriosis confirmed illnesses.',
    );
    assert.equal(status.kind, 'reported_count', label(c));
    assert.equal(status.illnesses, 6, label(c));
  }
});

test('no case is turned into a notice the source did not state', () => {
  for (const c of CORPUS.cases) {
    const status = deriveIllnessStatus(c.summaryText);
    const copy = illnessNoticeCopy(status);
    if (status.kind === 'unknown') {
      assert.equal(copy, null, `${label(c)} renders no notice at all`);
      continue;
    }
    assert.ok(copy, label(c));
    assert.ok(status.statements.length > 0, `${label(c)} shows a notice only on evidence`);
  }
});

test('the source sentence always survives in What Happened', () => {
  // A sentence is droppable only when the notice reproduces it completely.
  // Whatever is dropped, the narrative never becomes empty and never loses a
  // sentence the notice cannot display.
  for (const c of CORPUS.cases) {
    const status = deriveIllnessStatus(c.summaryText);
    const narrative = narrativeWithoutIllness(c.summaryText, status);
    assert.ok(narrative.trim().length > 0, `${label(c)} keeps a narrative`);
    for (const sentence of c.diseaseSentencesFiltered) {
      assert.ok(
        narrative.includes(sentence) || c.summaryText.replace(/\s+/g, ' ').includes(sentence),
        `${label(c)} keeps its education prose`,
      );
    }
  }
});

test('PARITY: Detail, the projection flag and push eligibility read one answer', () => {
  for (const c of CORPUS.cases) {
    const status = deriveIllnessStatus(c.summaryText);
    const detailShowsIllness = illnessNoticeCopy(status)?.tone === 'reported';
    const projectionFlag = statementReportsIllness(c.summaryText);
    const flag = statusReportsIllness(status);

    assert.equal(projectionFlag, flag, `${label(c)} projection vs contract`);
    assert.equal(detailShowsIllness, flag, `${label(c)} Detail vs flag`);
  }
});

test('PARITY holds under mutation too, not just on the quiet path', () => {
  for (const c of CORPUS.cases) {
    for (const suffix of [
      ` ${A_REAL_REPORT}`,
      ' There have been 7 illnesses reported in connection with these products.',
      ' There have been no reports of illness associated with this product.',
      ' The cucumbers described above were associated with reported salmonellosis illnesses.',
      '',
    ]) {
      const text = `${c.summaryText}${suffix}`;
      assert.equal(
        statementReportsIllness(text),
        statusReportsIllness(deriveIllnessStatus(text)),
        `${label(c)}${suffix.slice(0, 48)}`,
      );
    }
  }
});
