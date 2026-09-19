/**
 * Record the P2B7L regression corpus — READ-ONLY, writes no production row.
 *
 *   npx tsx scripts/record-illness-qualifier-corpus.ts
 *
 * Captures every stored case whose official notice carries a qualified none —
 * "no other / additional / further … illness" — into
 * src/domain/fixtures/illness-qualifier-corpus.json, with each notice's
 * verbatim `summaryText`.
 *
 * This is the shape at the centre of the P2B7L founder decision: FSIS closure
 * boilerplate that P2B7K read as PROOF an illness occurred. The fixture pins
 * the real population so the corrected classifier is regression-tested against
 * the sources themselves rather than against invented sentences.
 *
 * Never hand-edit the fixture; re-record it. The recorded `kindBeforeP2B7L`
 * and `storedReportsIllness` fields are historical evidence of the defect and
 * are deliberately NOT re-derived by the test — the test derives fresh and
 * asserts the corrected answer.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import { writeFileSync } from 'node:fs';

import { deriveIllnessStatus } from '../src/domain/illness-status';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const FIXTURE = 'src/domain/fixtures/illness-qualifier-corpus.json';

/** Kept in step with QUALIFIED_NONE_ILLNESS in src/domain/illness-status.ts. */
const QUALIFIER =
  /\bno\s+(?:other|additional|further)\b[^.]{0,60}?\b(?:illness(?:es)?|sick|case-patients?)\b/i;

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
    if (!QUALIFIER.test(summaryText)) continue;
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
      kindBeforeP2B7L: status.kind,
      qualifierSentence: (status.statements[0] ?? '').replace(/\s+/g, ' ') || null,
      summaryText,
    });
  }
  recorded.sort((a, b) => a.recallCaseId.localeCompare(b.recallCaseId));

  writeFileSync(
    FIXTURE,
    JSON.stringify(
      {
        _comment: [
          'P2B7L regression corpus — RECORDED FROM LIVE PRODUCTION, read-only, 2026-09-18.',
          "Every stored case whose official notice carries a 'no other/additional/further ... illness'",
          'qualifier. All 28 classified as reported_unspecified under P2B7K and showed',
          "'Illnesses reported' on Recall Detail; none states an illness anywhere else.",
          'The founder decision (P2B7L) makes a qualified none inert, so every entry here must',
          "classify as 'unknown' unless its own prose independently establishes an illness.",
          'Never hand-edit: re-record with scripts/record-illness-qualifier-corpus.ts.',
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
