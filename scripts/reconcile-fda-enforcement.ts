/**
 * FDA announcement ↔ enforcement reconciliation — explicitly invoked, never
 * scheduled.
 *
 *   npm run reconcile:fda-enforcement                  # DRY RUN (default)
 *   npm run reconcile:fda-enforcement -- --apply       # perform the writes
 *   npm run reconcile:fda-enforcement -- --file <p>    # offline corpus
 *                                                      # (bulk-export JSON)
 *
 * Every run works from the COMPLETE official corpus — by default the openFDA
 * bulk export, one ~5.5 MB download naming the whole dataset, which is both
 * politer and more robust than paging the query API: enforcement records
 * mutate in place, and only a full view catches a reclassification of an
 * already-matched record. Matching is deterministic and evidence-gated
 * (src/server/fda-enforcement/match.ts); enrichment writes only what a match
 * justifies (enrich.ts) and is idempotent, so re-runs converge.
 *
 * Dry-run reports everything an apply would do — matches, evidence,
 * classifications, notifications and their suppression — and writes nothing.
 * Apply requires the 'enforcement_match' link_method migration to be live.
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import type { CaseProjection } from '../src/domain/recall-types';
import {
  classSetKey,
  consumerRiskTier,
  isOfficialClass,
  officialClassesOf,
  type ConsumerRiskTier,
} from '../src/domain/risk-tier';
import { enrichCaseWithMatches } from '../src/server/fda-enforcement/enrich';
import { fetchEnforcementBulkUrl } from '../src/server/fda-enforcement/fetch';
import {
  announcementFactsFor,
  blockByFirm,
  indexByNormalizedFirm,
  matchCase,
  type CaseMatchResult,
} from '../src/server/fda-enforcement/match';
import {
  parseEnforcementRecord,
  type EnforcementRecord,
  type OpenFdaEnforcementRaw,
} from '../src/server/fda-enforcement/parse';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';
import type { SourceRecordRow } from '../src/server/store/types';

/** Most severe first, so the tier distribution always reads in scale order. */
const TIER_ORDER: ConsumerRiskTier[] = [
  'critical',
  'high',
  'moderate',
  'low',
  'minimal',
  'pending',
  'unrated',
];

const apply = process.argv.includes('--apply');
const fileArgIndex = process.argv.indexOf('--file');
const corpusFile = fileArgIndex >= 0 ? process.argv[fileArgIndex + 1] : null;

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function loadCorpus(): Promise<OpenFdaEnforcementRaw[]> {
  if (corpusFile) {
    const bytes = readFileSync(corpusFile);
    const text = corpusFile.endsWith('.gz')
      ? gunzipSync(bytes).toString('utf8')
      : bytes.toString('utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.results;
  }
  const manifest = await fetchEnforcementBulkUrl();
  console.log(
    `  bulk export ${manifest.exportDate} (${manifest.totalRecords} records) — downloading…`,
  );
  const response = await fetch(manifest.url);
  if (!response.ok) throw new Error(`bulk download failed: HTTP ${response.status}`);
  const zipped = Buffer.from(await response.arrayBuffer());
  // The export is a single-file zip; unzip via the OS-independent route.
  const { inflateRawSync } = await import('node:zlib');
  // Minimal zip reading: locate the first local file header and inflate it.
  if (zipped.readUInt32LE(0) !== 0x04034b50) throw new Error('unexpected zip signature');
  const nameLength = zipped.readUInt16LE(26);
  const extraLength = zipped.readUInt16LE(28);
  const method = zipped.readUInt16LE(8);
  const dataStart = 30 + nameLength + extraLength;
  const compressedSize = zipped.readUInt32LE(18);
  const payload = zipped.subarray(dataStart, dataStart + compressedSize);
  const json = method === 0 ? payload : inflateRawSync(payload);
  return JSON.parse(json.toString('utf8')).results;
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createSupabaseServerClient(url, secretKey);
  const store = new SupabaseStore(client);

  console.log(
    `\n${'═'.repeat(72)}\nFDA enforcement reconciliation — ${apply ? 'APPLY' : 'DRY RUN, nothing will be written'}\n${'═'.repeat(72)}\n`,
  );

  // ── Enforcement corpus ─────────────────────────────────────────────────────
  const rawRecords = await loadCorpus();
  const records: EnforcementRecord[] = [];
  const rawByRecallNumber = new Map<string, OpenFdaEnforcementRaw>();
  let quarantined = 0;
  for (const raw of rawRecords) {
    try {
      const record = parseEnforcementRecord(raw);
      records.push(record);
      rawByRecallNumber.set(record.recallNumber, raw);
    } catch {
      quarantined += 1;
    }
  }
  const index = indexByNormalizedFirm(records);
  console.log(`  enforcement records: ${records.length} (${quarantined} quarantined)\n`);

  // ── Live FDA cases + their notice records ─────────────────────────────────
  const pageSize = 200;
  const cases: { id: string; projection: CaseProjection }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('recall_cases')
      .select('id, merged_into, projection')
      .eq('source_agency', 'FDA')
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.merged_into === null)
        cases.push({ id: row.id as string, projection: row.projection as CaseProjection });
    }
    if (!data || data.length < pageSize) break;
  }

  const recordsByCase = new Map<string, SourceRecordRow[]>();
  const noticeRows = await store.listSourceRecords('fda_announcement');
  for (const row of noticeRows) {
    recordsByCase.set(row.recallCaseId, [...(recordsByCase.get(row.recallCaseId) ?? []), row]);
  }

  // ── Match + enrich ─────────────────────────────────────────────────────────
  const summary = {
    casesExamined: 0,
    unmatched: 0,
    candidate: 0,
    ambiguous: 0,
    matched: 0,
    acceptedEvents: 0,
    acceptedRecords: 0,
    conflicts: 0,
    byMethod: new Map<string, number>(),
    classFromMatches: new Map<string, number>(),
    mixedClassCases: 0,
    singleClassCases: 0,
    /** Consumer risk tier every live FDA case would carry after this run. */
    tiers: new Map<ConsumerRiskTier, number>(),
    classSets: new Map<string, number>(),
    mixedExposedAsScalar: 0,
    assignments: 0,
    reclassifications: 0,
    notifications: { delivered: 0, suppressed: 0 },
  };
  const ambiguousExamples: string[] = [];
  const matchedExamples: string[] = [];

  for (const recallCase of cases) {
    const notices = (recordsByCase.get(recallCase.id) ?? []).map((row) => ({
      title: row.normalized.title,
      summaryText: row.normalized.summaryText,
      publishedAt: row.normalized.publishedAt,
      firmDisplayName: row.normalized.firmDisplayName,
    }));
    const facts = announcementFactsFor(recallCase.id, recallCase.projection, notices);
    const result: CaseMatchResult = matchCase(facts, blockByFirm(facts, index));
    summary.casesExamined += 1;
    summary[result.state === 'matched_deterministic' ? 'matched' : result.state] += 1;

    // Every case counts toward the classification-state distribution, matched
    // or not: an unmatched FDA recall is Pending, and that is a real state.
    const tally = (classification: Parameters<typeof consumerRiskTier>[0]) => {
      const set = officialClassesOf(classification);
      const tier = consumerRiskTier(classification);
      summary.tiers.set(tier, (summary.tiers.get(tier) ?? 0) + 1);
      const key = classSetKey(set) || '(none)';
      summary.classSets.set(key, (summary.classSets.get(key) ?? 0) + 1);
      if (set.length === 1) summary.singleClassCases += 1;
      if (set.length > 1) {
        summary.mixedClassCases += 1;
        if (isOfficialClass(classification.value)) summary.mixedExposedAsScalar += 1;
      }
    };

    if (result.state === 'ambiguous' && ambiguousExamples.length < 5) {
      ambiguousExamples.push(
        `${recallCase.projection.title.slice(0, 70)} → events ${result.ambiguous
          .map((e) => e.eventId)
          .join(', ')}`,
      );
    }
    if (result.accepted.length === 0) {
      tally(recallCase.projection.classification);
      continue;
    }

    summary.acceptedEvents += result.accepted.length;
    for (const match of result.accepted) {
      summary.acceptedRecords += match.records.length;
      summary.byMethod.set(match.method, (summary.byMethod.get(match.method) ?? 0) + 1);
      for (const record of match.records) {
        summary.classFromMatches.set(
          record.classificationText,
          (summary.classFromMatches.get(record.classificationText) ?? 0) + 1,
        );
      }
    }
    if (matchedExamples.length < 6) {
      matchedExamples.push(
        `${recallCase.projection.title.slice(0, 64)}\n      → ${result.accepted
          .map(
            (m) =>
              `event ${m.eventId} [${m.method}] ${[...new Set(m.records.map((r) => r.classificationText))].join('+')}`,
          )
          .join('; ')}\n      ${result.accepted[0].evidence.join(' · ')}`,
      );
    }

    const outcome = await enrichCaseWithMatches(
      store,
      recallCase.id,
      result.accepted,
      rawByRecallNumber,
      { apply },
    );
    if (!outcome) continue;
    // The tier comes from the enrichment's own re-projection — the exact
    // classification an apply would persist, derived, never stored.
    tally({
      value: outcome.classificationAfter as CaseProjection['classification']['value'],
      officialClasses: outcome.officialClassesAfter,
    });
    summary.conflicts += outcome.conflicts.length;
    if (outcome.materialChanges.includes('classification_assigned')) summary.assignments += 1;
    if (
      outcome.materialChanges.some(
        (rule) => rule === 'classification_upgraded' || rule === 'classification_downgraded',
      )
    ) {
      summary.reclassifications += 1;
    }
    for (const notification of outcome.notifications) {
      if (notification.suppressed) summary.notifications.suppressed += 1;
      else summary.notifications.delivered += 1;
    }
  }

  console.log(`  FDA cases examined:        ${summary.casesExamined}`);
  console.log(`  matched (deterministic):   ${summary.matched}`);
  console.log(`  ambiguous (preserved):     ${summary.ambiguous}`);
  console.log(`  candidate (insufficient):  ${summary.candidate}`);
  console.log(`  unmatched:                 ${summary.unmatched}`);
  console.log(
    `  accepted events:           ${summary.acceptedEvents} (${summary.acceptedRecords} records)`,
  );
  console.log(
    `  by method:                 ${[...summary.byMethod.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );
  console.log(
    `  classes on matched records: ${[...summary.classFromMatches.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );
  console.log(`  conflicts (skipped):       ${summary.conflicts}`);
  console.log('');
  console.log(`  single official class:     ${summary.singleClassCases}`);
  console.log(`  mixed official classes:    ${summary.mixedClassCases}`);
  console.log(`  mixed shown as one class:  ${summary.mixedExposedAsScalar}  (must be 0)`);
  console.log(
    `  official class sets:       ${[...summary.classSets.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  );
  console.log(
    `  consumer risk tiers:       ${TIER_ORDER.filter((t) => summary.tiers.has(t))
      .map((t) => `${t} ${summary.tiers.get(t)}`)
      .join(', ')}`,
  );
  console.log('');
  console.log(`  classification assignments${apply ? '' : ' (planned)'}:   ${summary.assignments}`);
  console.log(
    `  reclassifications${apply ? '' : ' (planned)'}:            ${summary.reclassifications}`,
  );
  console.log(
    `  notifications${apply ? '' : ' (planned)'}: ${summary.notifications.delivered} deliverable, ${summary.notifications.suppressed} suppressed as backfill`,
  );
  console.log(`  new RecallCases: 0 (enrichment never creates cases)`);

  if (matchedExamples.length > 0) {
    console.log('\n  Representative matches:');
    for (const example of matchedExamples) console.log(`    · ${example}`);
  }
  if (ambiguousExamples.length > 0) {
    console.log('\n  Ambiguous (left for a human, classification stays Not yet assigned):');
    for (const example of ambiguousExamples) console.log(`    · ${example}`);
  }
  console.log(
    apply
      ? '\n  ✓ Applied. Re-run at any time — reconciliation is idempotent.\n'
      : '\n  Dry run complete — nothing was written.\n',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
