/**
 * Development-only duplicate-RecallCase report.
 *
 *   npx tsx scripts/qa-duplicate-cases.ts
 *
 * Read-only: scans the live cases and classifies potentially-duplicate pairs
 * as deterministic (slug-collision + corroborating evidence), review
 * (corroborating evidence without the deterministic identity signal), or
 * distinct. Nothing here merges anything — merging is a separate, explicit
 * step (scripts/reconcile-duplicate-cases.ts), and ambiguous pairs are meant
 * to stay visible in this report rather than be hidden to zero the metric.
 *
 * This report matters most before push notifications exist: a duplicate case
 * would mean a duplicate initial notification for the same real-world recall.
 */

import { createClient } from '@supabase/supabase-js';

import type { CaseProjection } from '../src/domain/recall-types';
import { findDuplicateCandidates, type CaseFingerprint } from '../src/server/duplicates';

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY — this report reads the live DB.');
    process.exit(1);
  }
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pageSize = 1000;
  const fingerprints: CaseFingerprint[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('recall_cases')
      .select('id, projection, merged_into, source_agency')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`recall_cases read failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.merged_into !== null) continue;
      const projection = row.projection as CaseProjection;
      fingerprints.push({
        caseId: row.id as string,
        title: projection.title,
        firm: projection.recallingFirm?.displayName ?? null,
        hazardCategory: projection.hazardCategory,
        publishedAt: projection.publishedAt,
        sourceIds: (projection.sourceIdentifiers ?? []).map((identifier) => identifier.id),
        summaryText: projection.summaryText ?? null,
        agency: (row.source_agency as string | null) ?? projection.sourceAgency,
      });
    }
    if (!data || data.length < pageSize) break;
  }

  const candidates = findDuplicateCandidates(fingerprints);
  const deterministic = candidates.filter((c) => c.verdict === 'deterministic');
  const review = candidates.filter((c) => c.verdict === 'review');
  const expansionPairs = candidates.filter((c) => c.signals.includes('expansion-language'));
  const revisionPairs = candidates.filter((c) => c.signals.includes('revision-language'));
  const slugPairs = candidates.filter((c) => c.signals.includes('slug-collision'));

  console.log(
    `\n${'═'.repeat(72)}\nDuplicate RecallCase candidates — ${fingerprints.length} live cases\n${'═'.repeat(72)}`,
  );
  console.log(`\n  deterministic duplicates: ${deterministic.length}`);
  console.log(`  manual-review candidates: ${review.length}`);
  console.log(`  auto-coalesced by this report: 0 (this report never merges)`);
  console.log(
    `  by lineage signal: slug-collision ${slugPairs.length}, declared-expansion ${expansionPairs.length}, declared-revision ${revisionPairs.length}`,
  );

  const show = (label: string, list: typeof candidates) => {
    if (list.length === 0) return;
    console.log(`\n${label}:`);
    for (const candidate of list) {
      console.log(`\n  · ${candidate.a.title.slice(0, 76)}`);
      console.log(`    ${candidate.b.title.slice(0, 76)}`);
      console.log(`    cases ${candidate.a.caseId} / ${candidate.b.caseId}`);
      console.log(`    published ${candidate.a.publishedAt} / ${candidate.b.publishedAt}`);
      console.log(`    signals: ${candidate.signals.join(', ')}`);
    }
  };
  show('Deterministic (identity signal + corroboration)', deterministic);
  show('Manual review (corroboration without full identity evidence)', review);
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
