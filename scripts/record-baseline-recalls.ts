/**
 * Record the bundled baseline recall corpus (2026-10-04) — READ-ONLY.
 *
 *   npx tsx scripts/record-baseline-recalls.ts               # write the baseline
 *   npx tsx scripts/record-baseline-recalls.ts --measure     # report sizes, write nothing
 *   npx tsx scripts/record-baseline-recalls.ts --out <path>  # write elsewhere (validation)
 *
 * The Ready step and the Building step must show a shopper's genuine matches
 * even on a fresh install with no network: there is no cached corpus yet, so
 * the app carries one. This script reads the PUBLIC consumer feed through the
 * app's own client loader (the same anon-readable rows the Feed loads) and
 * writes `src/content/baseline-recalls.json`: every active, unmerged case the
 * app would COUNT at recording time — MATERIAL activity within the Affects Me
 * recency window, or confirmed still open by its agency (2026-10-06; the rule
 * is `lib/baseline-selection.ts`, shared with the tests, never re-implemented
 * here) — with each case's detail rows (projection, timeline, affected
 * products) so Recall Detail can render one when the live service cannot
 * answer. Each row keeps its FDA open-evidence date, so the device expires it
 * on the same 21-day clock as live evidence. `summaryHtml` is dropped (Detail
 * renders from `summaryText`); nothing else is edited.
 *
 * It refuses — writing nothing — when the live feed carries no FDA open
 * evidence (the sync has not populated it) or only evidence older than 10
 * days (the weekly sync has stopped).
 *
 * The selection is a RULE over the live corpus, never a hand-picked set, and
 * it is recorded with its date so the client can reason about its age. Re-run
 * before a release; the Ready contract explains why the baseline ages out
 * ([docs/recall-onboarding-and-paywall.md] §6.4).
 *
 * Reads only: public GET requests under the publishable key. Nothing is
 * written anywhere but the one JSON file in the working tree.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MEASURE = process.argv.includes('--measure');
const outIndex = process.argv.indexOf('--out');
const OUT =
  outIndex >= 0 && process.argv[outIndex + 1]
    ? process.argv[outIndex + 1]
    : join(process.cwd(), 'src', 'content', 'baseline-recalls.json');

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  // The client loader reads EXPO_PUBLIC_* at module load, so import after.
  const feed = await import('../src/lib/recall-feed');
  const { RECENT_WINDOW_DAYS: RECENT_ACTIVITY_DAYS } = await import('../src/lib/feed-relevance');
  const { BASELINE_RULE, baselineIncludes, baselineRecordingRefusal, newestEvidenceDate } =
    await import('../src/lib/baseline-selection');
  const { fsisConfirmedOpen } = await import('../src/lib/open-evidence');
  if (!feed.isFeedConfigured()) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
    process.exit(1);
  }

  const recordedAt = new Date();
  const items = await feed.fetchCurrentFeed();
  const refusal = baselineRecordingRefusal(items, recordedAt);
  if (refusal) {
    console.error(`Refusing to record the baseline: ${refusal}. Nothing was written.`);
    process.exit(1);
  }
  const recent = items
    .filter((item) => baselineIncludes(item, recordedAt))
    .sort((a, b) => a.id.localeCompare(b.id));

  const scopes = { nationwide: 0, states: 0, unknown: 0 };
  for (const item of recent) scopes[item.geography.scope] += 1;
  const fdaEvidence = recent.filter((item) => item.fdaOngoingAsOf !== null).length;
  const fsisActive = recent.filter((item) => fsisConfirmedOpen(item)).length;
  console.log(
    `active ${items.length}; counted (${RECENT_ACTIVITY_DAYS} d window or confirmed open) ${recent.length}: ` +
      `nationwide ${scopes.nationwide}, states ${scopes.states}, unknown ${scopes.unknown}; ` +
      `${fdaEvidence} with FDA evidence (newest ${newestEvidenceDate(items)}), ${fsisActive} FSIS active recalls`,
  );

  const cases = [];
  for (const item of recent) {
    const detail = await feed.fetchCaseDetail(item.id);
    if (!detail) continue;
    const { summaryHtml: _dropped, ...projection } = detail.projection;
    cases.push({
      item,
      detail: {
        id: detail.id,
        projection: { ...projection, summaryHtml: null },
        timeline: detail.timeline,
        affectedProducts: detail.affectedProducts,
        visuals: [],
      },
    });
  }
  const document = {
    recordedAt: recordedAt.toISOString(),
    recentActivityDays: RECENT_ACTIVITY_DAYS,
    rule: BASELINE_RULE,
    openEvidenceExportDate: newestEvidenceDate(items),
    cases,
  };
  const text = JSON.stringify(document);
  console.log(`cases ${cases.length}; JSON ${Math.round(text.length / 1024)} KB`);
  if (MEASURE) {
    const kb = (value: unknown) => Math.round(JSON.stringify(value).length / 1024);
    console.log(
      `  items ${kb(cases.map((c) => c.item))} KB; projections ${kb(cases.map((c) => c.detail.projection))} KB ` +
        `(summaryText ${kb(cases.map((c) => c.detail.projection.summaryText))} KB); timelines ${kb(cases.map((c) => c.detail.timeline))} KB; ` +
        `products ${kb(cases.map((c) => c.detail.affectedProducts))} KB (rawText ${kb(cases.map((c) => c.detail.affectedProducts.map((p) => p.rawText)))} KB)`,
    );
  }
  if (MEASURE) return;
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}`);
}

void main();
