/**
 * Record the bundled baseline recall corpus (2026-10-04) — READ-ONLY.
 *
 *   npx tsx scripts/record-baseline-recalls.ts            # write the baseline
 *   npx tsx scripts/record-baseline-recalls.ts --measure  # report sizes, write nothing
 *
 * The Ready step and the Building step must show a shopper's genuine matches
 * even on a fresh install with no network: there is no cached corpus yet, so
 * the app carries one. This script reads the PUBLIC consumer feed through the
 * app's own client loader (the same anon-readable rows the Feed loads) and
 * writes `src/content/baseline-recalls.json`: every active, unmerged case
 * whose MATERIAL activity falls within the Affects Me recency window at
 * recording time (`RECENT_ACTIVITY_DAYS`), with each case's detail rows
 * (projection, timeline, affected products) so Recall Detail can render one
 * when the live service cannot answer. `summaryHtml` is dropped (Detail
 * renders from `summaryText`); nothing else is edited.
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
const OUT = join(process.cwd(), 'src', 'content', 'baseline-recalls.json');

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
  const { materialActivityAt } = await import('../src/domain/material-activity');
  const { RECENT_WINDOW_DAYS: RECENT_ACTIVITY_DAYS } = await import('../src/lib/feed-relevance');
  if (!feed.isFeedConfigured()) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
    process.exit(1);
  }

  const recordedAt = new Date();
  const items = await feed.fetchCurrentFeed();
  const windowMs = RECENT_ACTIVITY_DAYS * 86_400_000;
  const recent = items
    .filter(
      (item) =>
        recordedAt.getTime() - Date.parse(materialActivityAt(item.publishedAt, item.timeline)) <=
        windowMs,
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  const scopes = { nationwide: 0, states: 0, unknown: 0 };
  for (const item of recent) scopes[item.geography.scope] += 1;
  console.log(
    `active ${items.length}; recent (${RECENT_ACTIVITY_DAYS} d) ${recent.length}: ` +
      `nationwide ${scopes.nationwide}, states ${scopes.states}, unknown ${scopes.unknown}`,
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
    rule: 'every active, unmerged consumer-feed case whose material activity is within the window at recordedAt',
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
