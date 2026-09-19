/**
 * Record the P2B7L.1 disease-name corpus — READ-ONLY, writes no production row.
 *
 *   npx tsx scripts/record-illness-disease-corpus.ts
 *
 * Captures every stored case whose official notice names `salmonellosis` or
 * `listeriosis` in a sentence that is NOT hazard education, into
 * src/domain/fixtures/illness-disease-corpus.json, with each notice's verbatim
 * `summaryText`.
 *
 * This is the population the P2B7L.1 correction governs. Before it, the
 * `EDUCATION` guard matched the bare disease names, so EVERY sentence naming
 * either disease was inert — the FSIS epidemiologic findings ("a total of four
 * listeriosis confirmed illnesses, including one death") and the FDA outbreak
 * links ("The recalled peaches have been linked to an outbreak of Listeriosis
 * that has resulted in eleven illnesses") along with the genuine education.
 * The positive branch that named the diseases was unreachable for the same
 * reason.
 *
 * The population is heterogeneous by design — genuine counted reports,
 * supplier-chain prose, hedged linkage, explicit denials and education-only
 * headings all appear — because the distinction the corrected classifier has
 * to draw is exactly between them. `kind`, `illnesses` and `reportsIllness`
 * are recorded as a regression pin: the test derives fresh and asserts it gets
 * the recorded answer back.
 *
 * Never hand-edit the fixture; re-record it. Re-recording is the deliberate
 * act that changes an expectation.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import { writeFileSync } from 'node:fs';

import { deriveIllnessStatus, statusReportsIllness } from '../src/domain/illness-status';
import { isNonReportProse } from '../src/domain/illness';
import { splitSentences } from '../src/domain/text';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const FIXTURE = 'src/domain/fixtures/illness-disease-corpus.json';

/** The two disease names that were bare alternations in `EDUCATION`. */
const DISEASE = /\b(?:salmonellosis|listeriosis)\b/i;

const flatten = (sentence: string) => sentence.replace(/\s+/g, ' ').trim();

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const store = new SupabaseStore(createSupabaseServerClient(url, secretKey));

  const cases = await store.listCases();
  const recorded = [];
  for (const row of cases) {
    const projection = row.projection;
    const summaryText = projection.summaryText ?? '';
    if (!DISEASE.test(summaryText)) continue;

    const diseaseSentences = splitSentences(summaryText).filter((s) => DISEASE.test(s));
    const kept = diseaseSentences.filter((s) => !isNonReportProse(s));
    // A notice whose every disease sentence is education is not what this
    // correction is about — it was inert before and stays inert.
    if (kept.length === 0) continue;

    const status = deriveIllnessStatus(summaryText);
    recorded.push({
      recallCaseId: row.id,
      sourceAgency: projection.sourceAgency,
      lifecycle: projection.state,
      consumerHidden: Boolean(row.mergedInto),
      nativeId: (projection.sourceIdentifiers ?? []).map((s) => s.id).join(','),
      title: projection.title,
      publishedAt: projection.publishedAt,
      storedReportsIllness: projection.reportsIllness,
      kind: status.kind,
      illnesses: status.illnesses,
      approximate: status.approximate,
      reportsIllness: statusReportsIllness(status),
      statements: status.statements.map(flatten),
      diseaseSentencesKept: kept.map(flatten),
      diseaseSentencesFiltered: diseaseSentences.filter(isNonReportProse).map(flatten),
      summaryText,
    });
  }
  recorded.sort((a, b) => a.recallCaseId.localeCompare(b.recallCaseId));

  writeFileSync(
    FIXTURE,
    JSON.stringify(
      {
        _comment: [
          'P2B7L.1 disease-name corpus — RECORDED FROM LIVE PRODUCTION, read-only, 2026-09-18.',
          "Every stored case naming 'salmonellosis' or 'listeriosis' in a sentence that is NOT",
          'hazard education. Before P2B7L.1 the bare disease names sat in the EDUCATION guard, so',
          'every sentence naming either disease was inert and the positive branch that named them',
          'was unreachable; 8 cases classified differently as a result.',
          'kind / illnesses / reportsIllness are a regression pin: the test derives fresh from',
          'summaryText and asserts it gets these back.',
          'Never hand-edit: re-record with scripts/record-illness-disease-corpus.ts.',
        ],
        recordedAt: new Date().toISOString().slice(0, 10),
        count: recorded.length,
        cases: recorded,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Recorded ${recorded.length} cases to ${FIXTURE}. No production row was written.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
