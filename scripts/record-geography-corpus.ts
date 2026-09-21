/**
 * Record the P2B7Q.2 geography evidence corpus — READ-ONLY, writes no
 * production row.
 *
 *   npx tsx scripts/record-geography-corpus.ts
 *
 * Captures, into src/domain/fixtures/geography-evidence-corpus.json, one
 * recorded notice per evidence SHAPE the canonical derivation has to decide —
 * the declared list that continues past its own sentence, the retailer
 * footprint the notice ties to the product and the one it does not, the state
 * health department that ran the sampling, the place inside a company name,
 * the explicitly unaffected state — together with every case on which the feed
 * card and Recall Detail disagreed about location when the milestone opened.
 *
 * The recorded `storedScope`/`storedStates` are historical evidence of the
 * defect and are deliberately NOT what the test asserts: the test derives
 * fresh from the recorded prose and checks the reviewed `expectedStates` and
 * `mustNotInclude`, which are written here from the derivation and then read
 * back sentence by sentence by a human before the fixture is committed.
 *
 * Never hand-edit the fixture; re-record it.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (server-only secrets).
 */

import { writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';

import { evaluateGeographyEvidence, readDistributionProse } from '../src/domain/geography-evidence';
import type { RecallCaseRow } from '../src/server/store/types';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const FIXTURE = 'src/domain/fixtures/geography-evidence-corpus.json';

/**
 * The evidence shapes this corpus must cover, each detected from the notice's
 * own prose. A shape with no live example is recorded as such rather than
 * invented — the fixture states what production actually contains.
 */
const SHAPES: { shape: string; note: string; detect: (text: string) => boolean }[] = [
  {
    shape: 'declared-list-continues-past-its-sentence',
    note: 'A distribution lead-in whose states follow a full stop or a line break.',
    detect: (t) => /\b(?:the following|below)\s+(?:united\s+)?states\b/i.test(t),
  },
  {
    shape: 'distribution-centres-then-retail-states',
    note: 'One sentence names distribution centres, the next names the retail states.',
    detect: (t) => /distribution\s+cent(?:er|re)s?/i.test(t) && /\bsent\s+to\b/i.test(t),
  },
  {
    shape: 'multiple-affirmative-distribution-sentences',
    note: 'Two or more distribution statements that must be unioned, not raced.',
    detect: (t) => readDistributionProse(t).sentences.length >= 3,
  },
  {
    shape: 'explicitly-unaffected-state',
    note: 'The notice names a place and says it is NOT affected.',
    detect: (t) => /\b(?:are|is)\s+not\s+(?:impacted|affected)\b/i.test(t),
  },
  {
    shape: 'exception-clause-inside-an-affirmative-sentence',
    note: '"…distributed to stores in A, B and C, except for stores in …".',
    detect: (t) => /\bdistribut\w+[^.;]{0,120}\bexcept\b/i.test(t),
  },
  {
    shape: 'all-states-except',
    note: '"…in all U.S. states other than Alaska."',
    detect: (t) => /\ball\s+(?:u\.?s\.?\s+)?states\s+(?:other\s+than|except)\b/i.test(t),
  },
  {
    shape: 'nationwide',
    note: 'Explicitly stated nationwide distribution.',
    detect: (t) => /\b(?:distribut\w+|sold|shipped)\b[^;:]{0,60}?\bnationwide\b/i.test(t),
  },
  {
    shape: 'retailer-footprint-tied-to-the-product',
    note: '"distributed to all X store locations" + "X has store locations in …".',
    detect: (t) => /\b(?:has|have)\s+(?:store\s+)?locations?\s+in\b/i.test(t),
  },
  {
    shape: 'retailer-footprint-as-corporate-boilerplate',
    note: '"…currently operates 1,421 stores in …" at the foot of a release.',
    detect: (t) => /\boperates\s+[\d,]+\s+stores\s+in\b/i.test(t),
  },
  {
    shape: 'store-address-list-under-a-sold-at-lead-in',
    note: 'Street addresses that ARE the distribution statement.',
    detect: (t) => /\bsold\s+at\s+the\s+following\s+locations\b/i.test(t),
  },
  {
    shape: 'dateline-or-firm-address-inside-a-distribution-sentence',
    note: "One sentence carries the firm's own place AND the destination states.",
    detect: (t) =>
      /^\(?[A-Z][A-Za-z.' ]{1,28},\s*[A-Z][A-Za-z.]{1,20}\)?[^\n]{0,40}\b(?:is|are)\s+(?:voluntarily\s+)?recalling\b[^\n.;]{0,160}?\b(?:distributed|sold)\b[^\n;:]{0,80}?\b(?:to|at|in)\b/m.test(
        t,
      ),
  },
  {
    shape: 'firm-or-manufacturer-address',
    note: '"<Firm> of <City>, <State>, is recalling …".',
    detect: (t) => /\bof\s+[A-Z][A-Za-z.'\- ]+,\s*[A-Z][A-Za-z.]+,?\s+(?:is|has)\s+/.test(t),
  },
  {
    shape: 'shipping-origin',
    note: '"produced and distributed from farms in <State>".',
    detect: (t) =>
      /\b(?:distribut\w+|shipped)\s+from\s+(?:its\s+|our\s+|the\s+)?(?:farms?|facilit)/i.test(t),
  },
  {
    shape: 'laboratory-or-regulator-location',
    note: '"routine sampling by the <State> Department of Health".',
    detect: (t) =>
      /\bsampling\b[^.;]{0,60}\b[A-Z][a-z]+\s+(?:State\s+)?Department\s+of\s+(?:Agriculture|Health)/.test(
        t,
      ),
  },
  {
    shape: 'news-dateline',
    note: '"LAKELAND, Fla., Oct. 15, 2025 – …" / "Cincinnati, Ohio (October 31, 2025)".',
    detect: (t) => /^[A-Z][A-Za-z .]+,\s*[A-Z][a-z]{1,8}\.?[,)]?\s*(?:\(|[A-Z][a-z]+ \d)/m.test(t),
  },
  {
    shape: 'place-inside-a-company-name',
    note: '"Maryland & Virginia Milk Producers Cooperative Association".',
    detect: (t) =>
      /\b(?:Maryland|Virginia|Texas|Ohio|Georgia|Kansas)\s*&\s*[A-Z][a-z]+\s+[A-Z][a-z]+/.test(t),
  },
  {
    shape: 'illness-or-case-patient-location',
    note: 'Where people fell ill, which is never a distribution statement.',
    detect: (t) =>
      /\b(?:ill|sick|case-patients?|infections?)\b[^.;]{0,80}\bin\s+[A-Z][a-z]+\b/i.test(t),
  },
  {
    shape: 'territories-and-district-of-columbia',
    note: 'Washington D.C. and the U.S. territories.',
    detect: (t) => /\bWashington,?\s+D\.?\s?C\.?|\bPuerto Rico\b|\bGuam\b/.test(t),
  },
  {
    shape: 'genuine-absence-of-distribution-evidence',
    note: 'The notice never says where the product went.',
    detect: (t) => readDistributionProse(t).states.length === 0,
  },
];

/**
 * The nineteen ACTIVE cases on which the feed card and Recall Detail named
 * different states, measured read-only over all 1,931 stored cases on
 * 2026-09-20 — before P2B7Q.2 removed Detail's own reader. They are listed
 * rather than re-detected because the disagreement no longer exists to detect:
 * the two surfaces now read one value by construction, which is the point.
 */
const CARD_DETAIL_DISAGREEMENTS: string[] = [
  '14825b36-4122-442e-a960-e0b10c72bd9e',
  '3327484b-3646-4846-be08-829880e574c3',
  '459233e2-4f39-4a39-a078-0b34b9e22149',
  '4c7d29d6-606f-44e8-a516-27dafdfa6059',
  '7c4fe09d-c1d6-44be-af79-b137ec9f030f',
  '85303552-858d-4aa6-85b8-056e9bb111b4',
  '88560875-1069-4412-9027-b0601c58d548',
  '9212e679-61c6-4e59-a6d9-9c32942ad3b1',
  '9887a06d-6786-4be7-b5f5-baf45b60e69b',
  'a3ae8e2d-4d0f-4406-aff0-e0cfaf83d3b2',
  'b47ccca5-c316-4b22-a4cd-a819c6d74aac',
  'b5c4ce00-3e64-4fe3-aa93-09f5375ba447',
  'beaf2ecb-3c2e-4ce3-aac8-29ad0c4fe86f',
  'd81be694-f665-40ba-9350-af2899e46ae7',
  'dcd7279f-8d6c-4548-b1c1-3ae10ee5527d',
  'e6bfc7e1-0f23-4530-832e-3290e8dae53c',
  'f4f2b8c6-47f2-46a0-aaf8-6d03dc5656a4',
  'f713b2e3-a6c3-4ae7-ab15-b55fecbbc522',
  'fab432cd-6f94-4559-bb26-3b1be6895f0c',
];

/** Cap per shape: enough to prove the rule, not a second copy of the corpus. */
const PER_SHAPE = 2;

function excerpt(text: string): string {
  return text.length > 9000 ? `${text.slice(0, 9000)}\n[…recorded excerpt truncated]` : text;
}

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
  const rows = await store.listCases();

  const shapesOf = (text: string) =>
    SHAPES.filter(({ detect }) => detect(text ?? '')).map(({ shape }) => shape);

  const entry = (row: RecallCaseRow, shape: string, note: string) => {
    const p = row.projection;
    const evidence = evaluateGeographyEvidence({
      title: p.title,
      summaryText: p.summaryText,
      summaryHtml: p.summaryHtml,
      carried: p.geography,
    });
    const prose = readDistributionProse(p.summaryText);
    return {
      recallCaseId: row.id,
      sourceAgency: p.sourceAgency,
      lifecycle: p.state,
      title: p.title,
      shape,
      shapes: shapesOf(p.summaryText),
      note,
      storedScope: p.geography.scope,
      storedStates: p.geography.states,
      expectedScope: evidence.geography.scope,
      expectedStates: evidence.geography.states,
      mustNotInclude: prose.excludedStates,
      admittedSentences: prose.admittedUnits.slice(0, 4),
      summaryText: excerpt(p.summaryText),
    };
  };

  const chosen = new Map<string, ReturnType<typeof entry>>();

  // 1. Every card/Detail disagreement the milestone opened with.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const disagreements: ReturnType<typeof entry>[] = [];
  for (const id of CARD_DETAIL_DISAGREEMENTS) {
    const row = byId.get(id);
    if (!row) {
      console.error(`recorded disagreement ${id} is no longer in the corpus`);
      continue;
    }
    const built = entry(
      row,
      'card-detail-disagreement',
      'The feed card and Recall Detail named different states before P2B7Q.2.',
    );
    disagreements.push(built);
    chosen.set(row.id, built);
  }

  // 2. Shape coverage, deterministic by case id so re-recording is stable.
  // A disagreement case often already IS a shape example — Publix carries the
  // exception clause and the corporate footprint both — so coverage counts
  // what is already recorded before adding anything.
  const missing: string[] = [];
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  for (const { shape, note, detect } of SHAPES) {
    let taken = [...chosen.values()].filter((c) => c.shapes.includes(shape)).length;
    for (const row of ordered) {
      if (taken >= PER_SHAPE) break;
      if (chosen.has(row.id)) continue;
      if (!detect(row.projection.summaryText ?? '')) continue;
      chosen.set(row.id, entry(row, shape, note));
      taken += 1;
    }
    if (taken === 0) missing.push(shape);
  }

  const cases = [...chosen.values()].sort((a, b) => a.recallCaseId.localeCompare(b.recallCaseId));
  const fixture = JSON.stringify(
    {
      _comment: [
        'P2B7Q.2 geography evidence corpus — RECORDED FROM LIVE PRODUCTION, read-only.',
        'One recorded notice per evidence shape the canonical derivation must decide,',
        'plus every active case on which the feed card and Recall Detail disagreed',
        'about location when the milestone opened.',
        'storedScope/storedStates are historical evidence of the defect, never an',
        'input to the assertions: the test derives fresh from the recorded prose.',
        'Never hand-edit: re-record with scripts/record-geography-corpus.ts.',
      ],
      recordedAt: new Date().toISOString().slice(0, 10),
      count: cases.length,
      disagreementCount: disagreements.length,
      shapesWithNoLiveExample: missing,
      cases,
    },
    null,
    2,
  );
  // Written through Prettier, so `npm run check` is clean straight after a
  // re-record rather than needing a second pass over the file.
  const prettierOptions = (await resolveConfig(FIXTURE)) ?? {};
  writeFileSync(FIXTURE, await format(fixture, { ...prettierOptions, parser: 'json' }));
  console.log(
    `Recorded ${cases.length} cases (${disagreements.length} disagreements) to ${FIXTURE}`,
  );
  if (missing.length > 0) console.log('Shapes with NO live example:', missing.join(', '));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
