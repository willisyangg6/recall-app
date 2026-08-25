/**
 * Reconcile deterministic duplicate RecallCases into one case each.
 *
 *   npx tsx scripts/reconcile-duplicate-cases.ts            # dry run (default)
 *   npx tsx scripts/reconcile-duplicate-cases.ts --apply    # perform the merges
 *
 * Only pairs the duplicate detector classifies as DETERMINISTIC (an FDA
 * slug-collision identity signal plus corroborating firm/hazard/title
 * evidence) are ever merged; review-level candidates are printed and left
 * alone. For each pair, the case founded by the BASE announcement survives:
 *
 *   1. the collision record's source_records row is re-linked to the
 *      surviving case (link_method 'expansion_prefix'),
 *   2. the surviving case is re-projected from both records and its timeline
 *      gains a non-material reconciliation entry,
 *   3. the absorbed case is marked merged_into = survivor — its row,
 *      projection, timeline, snapshots, and notification ledger are all
 *      preserved, and RLS hides it from the consumer feed.
 *
 * Nothing is deleted and no notification events are written (a reconciliation
 * is bookkeeping, not news), so the ledger invariants — exactly one initial
 * per case, no replay — are untouched. Rollback = re-link the source record,
 * null out merged_into, and re-project each case from its own records.
 */

import { createClient } from '@supabase/supabase-js';

import { projectCase } from '../src/domain/projection';
import type { CaseProjection, TimelineEntry } from '../src/domain/recall-types';
import type { NormalizedSourceRecord } from '../src/domain/source-record';
import {
  findDuplicateCandidates,
  isExpansionOfSameEvent,
  isSameRecallEvent,
  type CaseFingerprint,
} from '../src/server/duplicates';

const apply = process.argv.includes('--apply');

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
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Fingerprint the live cases.
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

  const deterministic = findDuplicateCandidates(fingerprints).filter(
    (candidate) => candidate.verdict === 'deterministic',
  );
  console.log(
    `${deterministic.length} deterministic duplicate pair(s)${apply ? '' : ' — DRY RUN, nothing will be written'}`,
  );

  for (const pair of deterministic) {
    // Survivor selection: for a slug collision the base (non-suffixed)
    // announcement's case survives; for a declared-expansion pair the case
    // founded FIRST survives — the expansion joins the recall it expanded.
    // Either way the merged projection is identical (it is re-derived from
    // ALL linked records), so this only decides which case id and ledger
    // persist.
    const aIsSuffix = pair.a.sourceIds.some((id) =>
      pair.b.sourceIds.some((other) => id.startsWith(`${other}-`)),
    );
    const bIsSuffix = pair.b.sourceIds.some((id) =>
      pair.a.sourceIds.some((other) => id.startsWith(`${other}-`)),
    );
    const absorbed = aIsSuffix
      ? pair.a
      : bIsSuffix
        ? pair.b
        : pair.a.publishedAt > pair.b.publishedAt
          ? pair.a
          : pair.b;
    const survivor = absorbed === pair.a ? pair.b : pair.a;

    // Re-verify against the full normalized records, not just projections.
    // A pair qualifies through EITHER lineage mechanism, in either direction:
    // a slug-collision re-publication (isSameRecallEvent) or a declared
    // expansion (isExpansionOfSameEvent).
    const records = await client
      .from('source_records')
      .select('id, native_id, recall_case_id, normalized')
      .in('recall_case_id', [survivor.caseId, absorbed.caseId]);
    if (records.error) throw new Error(records.error.message);
    const survivorRecords = records.data.filter((r) => r.recall_case_id === survivor.caseId);
    const absorbedRecords = records.data.filter((r) => r.recall_case_id === absorbed.caseId);
    const sameEvent = (a: NormalizedSourceRecord, b: NormalizedSourceRecord) =>
      isSameRecallEvent(a, b) ||
      isSameRecallEvent(b, a) ||
      isExpansionOfSameEvent(a, b) ||
      isExpansionOfSameEvent(b, a);
    const verified = absorbedRecords.every((child) =>
      survivorRecords.some((parent) =>
        sameEvent(
          child.normalized as NormalizedSourceRecord,
          parent.normalized as NormalizedSourceRecord,
        ),
      ),
    );
    if (!verified || absorbedRecords.length === 0 || survivorRecords.length === 0) {
      console.log(
        `  ✗ SKIPPED (record-level evidence gate failed): ${absorbed.title.slice(0, 70)}`,
      );
      continue;
    }

    console.log(`\n  Merge: ${absorbed.caseId}  →  ${survivor.caseId}`);
    console.log(`    absorbed: ${absorbed.title.slice(0, 90)}`);
    console.log(`    survivor: ${survivor.title.slice(0, 90)}`);
    console.log(`    signals:  ${pair.signals.join(', ')}`);
    if (!apply) continue;

    const nowIso = new Date().toISOString();

    // 1. Re-link the absorbed case's source records to the survivor.
    for (const record of absorbedRecords) {
      const { error } = await client
        .from('source_records')
        .update({ recall_case_id: survivor.caseId, link_method: 'expansion_prefix' })
        .eq('id', record.id);
      if (error) throw new Error(`re-link failed: ${error.message}`);
    }

    // 2. Re-project the survivor from all its records.
    const merged = await client
      .from('source_records')
      .select('normalized')
      .eq('recall_case_id', survivor.caseId);
    if (merged.error) throw new Error(merged.error.message);
    const projection = projectCase(
      merged.data.map((row) => row.normalized as NormalizedSourceRecord),
    );
    const survivorCase = await client
      .from('recall_cases')
      .select('timeline')
      .eq('id', survivor.caseId)
      .single();
    if (survivorCase.error) throw new Error(survivorCase.error.message);
    const timeline: TimelineEntry[] = [
      ...(survivorCase.data.timeline as TimelineEntry[]),
      {
        occurredAt: projection.lastPublicActivityAt,
        kind: 'source_updated',
        summary: `Reconciled duplicate source announcement ${absorbedRecords[0].native_id} into this recall.`,
        causedBySnapshotIds: [],
        material: false,
      },
    ];
    const updated = await client
      .from('recall_cases')
      .update({ projection, timeline, last_changed_at: nowIso })
      .eq('id', survivor.caseId);
    if (updated.error) throw new Error(updated.error.message);

    // Rebuild the affected_products read model for the survivor.
    const cleared = await client
      .from('affected_products')
      .delete()
      .eq('recall_case_id', survivor.caseId);
    if (cleared.error) throw new Error(cleared.error.message);
    if (projection.affectedProducts.length > 0) {
      const inserted = await client.from('affected_products').insert(
        projection.affectedProducts.map((product, ordinal) => ({
          recall_case_id: survivor.caseId,
          ordinal,
          source_native_id: product.sourceNativeId,
          name: product.name,
          raw_text: product.rawText,
          extraction_confidence: product.extractionConfidence,
        })),
      );
      if (inserted.error) throw new Error(inserted.error.message);
    }

    // 3. Hide the absorbed case from the feed; everything else is preserved.
    const hidden = await client
      .from('recall_cases')
      .update({ merged_into: survivor.caseId, last_changed_at: nowIso })
      .eq('id', absorbed.caseId);
    if (hidden.error) throw new Error(hidden.error.message);

    // The absorbed case's affected_products would otherwise linger in the
    // read model; they are represented on the survivor now.
    const absorbedProducts = await client
      .from('affected_products')
      .delete()
      .eq('recall_case_id', absorbed.caseId);
    if (absorbedProducts.error) throw new Error(absorbedProducts.error.message);

    console.log('    ✓ merged (absorbed case preserved with merged_into set)');
  }
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
