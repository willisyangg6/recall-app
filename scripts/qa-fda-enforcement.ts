/**
 * FDA enforcement QA — read-only, writes nothing anywhere.
 *
 *   npm run qa:fda-enforcement                # corpus from the bulk export
 *   npm run qa:fda-enforcement -- --file <p>  # corpus from a local file
 *
 * Reports the enforcement-source health (§ ingest QA), the announcement ↔
 * enforcement match distribution over the live FDA cases (§ match QA), and
 * the classification outcomes of accepted matches (§ classification QA).
 */

import { readFileSync } from 'node:fs';
import { gunzipSync, inflateRawSync } from 'node:zlib';

import { upcDigitsIn } from '../src/server/duplicates';
import type {
  CaseProjection,
  Classification,
  ClassificationValue,
  OfficialClass,
} from '../src/domain/recall-types';
import {
  classSetKey,
  consumerRiskTier,
  isOfficialClass,
  officialClassesOf,
  type ConsumerRiskTier,
} from '../src/domain/risk-tier';
import { fetchEnforcementBulkUrl } from '../src/server/fda-enforcement/fetch';
import {
  announcementFactsFor,
  blockByFirm,
  indexByNormalizedFirm,
  matchCase,
} from '../src/server/fda-enforcement/match';
import {
  parseEnforcementRecord,
  type EnforcementRecord,
  type OpenFdaEnforcementRaw,
} from '../src/server/fda-enforcement/parse';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const fileArgIndex = process.argv.indexOf('--file');
const corpusFile = fileArgIndex >= 0 ? process.argv[fileArgIndex + 1] : null;

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
  const response = await fetch(manifest.url);
  if (!response.ok) throw new Error(`bulk download failed: HTTP ${response.status}`);
  const zipped = Buffer.from(await response.arrayBuffer());
  if (zipped.readUInt32LE(0) !== 0x04034b50) throw new Error('unexpected zip signature');
  const nameLength = zipped.readUInt16LE(26);
  const extraLength = zipped.readUInt16LE(28);
  const method = zipped.readUInt16LE(8);
  const dataStart = 30 + nameLength + extraLength;
  const compressedSize = zipped.readUInt32LE(18);
  const payload = zipped.subarray(
    dataStart,
    compressedSize > 0 ? dataStart + compressedSize : undefined,
  );
  const json = method === 0 ? payload : inflateRawSync(payload);
  return JSON.parse(json.toString('utf8')).results;
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY — this report reads the live DB.');
    process.exit(1);
  }
  const client = createSupabaseServerClient(url, secretKey);
  const store = new SupabaseStore(client);

  // ── Enforcement source QA ──────────────────────────────────────────────────
  const rawRecords = await loadCorpus();
  const records: EnforcementRecord[] = [];
  let quarantined = 0;
  const seenIdentities = new Set<string>();
  let duplicateIdentities = 0;
  for (const raw of rawRecords) {
    try {
      const record = parseEnforcementRecord(raw);
      if (seenIdentities.has(record.recallNumber)) duplicateIdentities += 1;
      seenIdentities.add(record.recallNumber);
      records.push(record);
    } catch {
      quarantined += 1;
    }
  }
  const events = new Set(records.map((r) => r.eventId));
  const byClass = new Map<string, number>();
  let withCodes = 0;
  let withUpcLike = 0;
  let withQuantity = 0;
  let withTermination = 0;
  let missingEventId = 0;
  const reportDates = records
    .map((r) => r.reportDate)
    .filter(Boolean)
    .sort();
  const initDates = records
    .map((r) => r.recallInitiationDate)
    .filter(Boolean)
    .sort();
  for (const record of records) {
    byClass.set(record.classificationText, (byClass.get(record.classificationText) ?? 0) + 1);
    if (record.codeInfo) withCodes += 1;
    if (upcDigitsIn(`${record.productDescription}\n${record.codeInfo ?? ''}`).size > 0)
      withUpcLike += 1;
    if (record.productQuantity) withQuantity += 1;
    if (record.terminationDate || record.status === 'Terminated') withTermination += 1;
    if (!record.eventId) missingEventId += 1;
  }

  console.log(`\n${'═'.repeat(72)}\nFDA enforcement QA — read-only\n${'═'.repeat(72)}\n`);
  console.log('  ENFORCEMENT SOURCE');
  console.log(`    records fetched:        ${rawRecords.length}`);
  console.log(`    parsed:                 ${records.length}  quarantined: ${quarantined}`);
  console.log(
    `    unique recall_numbers:  ${seenIdentities.size}  duplicates: ${duplicateIdentities}`,
  );
  console.log(
    `    unique event_ids:       ${events.size}  records missing event_id: ${missingEventId}`,
  );
  console.log(
    `    classifications:        ${[...byClass.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );
  console.log(`    with code_info:         ${withCodes}`);
  console.log(`    with UPC-like digits:   ${withUpcLike}`);
  console.log(`    with quantity:          ${withQuantity}`);
  console.log(`    terminated/with date:   ${withTermination}`);
  console.log(`    report_date range:      ${reportDates[0]} … ${reportDates.at(-1)}`);
  console.log(`    initiation range:       ${initDates[0]} … ${initDates.at(-1)}`);

  // ── Match QA over live FDA cases ───────────────────────────────────────────
  const index = indexByNormalizedFirm(records);
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
  const noticeRows = await store.listSourceRecords('fda_announcement');
  const recordsByCase = new Map<string, typeof noticeRows>();
  for (const row of noticeRows) {
    recordsByCase.set(row.recallCaseId, [...(recordsByCase.get(row.recallCaseId) ?? []), row]);
  }

  const states = { unmatched: 0, candidate: 0, ambiguous: 0, matched_deterministic: 0 };
  let zeroCandidates = 0;
  let acceptedEvents = 0;
  const classCounts = new Map<string, number>();
  let mixedClassCases = 0;
  let matchedRecordsMissingClass = 0;
  let provenanceComplete = 0;
  const matchedEventIds = new Set<string>();
  // Classification-state QA: the class set is the authoritative fact, the
  // consumer tier is derived from it, and a mixed case must never be
  // reachable through a scalar that names one class.
  const classSets = new Map<string, number>();
  const tiers = new Map<ConsumerRiskTier, number>();
  let singleClassCases = 0;
  let unclassifiedCases = 0;
  let unmappedClassSets = 0;
  let mixedExposedAsScalar = 0;

  for (const recallCase of cases) {
    const notices = (recordsByCase.get(recallCase.id) ?? []).map((row) => ({
      title: row.normalized.title,
      summaryText: row.normalized.summaryText,
      publishedAt: row.normalized.publishedAt,
      firmDisplayName: row.normalized.firmDisplayName,
    }));
    const facts = announcementFactsFor(recallCase.id, recallCase.projection, notices);
    const blocked = blockByFirm(facts, index);
    if (blocked.length === 0) zeroCandidates += 1;
    const result = matchCase(facts, blocked);
    states[result.state] += 1;
    acceptedEvents += result.accepted.length;
    const classes = new Set<string>();
    const classValues = new Set<ClassificationValue>();
    for (const match of result.accepted) {
      matchedEventIds.add(match.eventId);
      if (match.evidence.length > 0 && match.records.length > 0) provenanceComplete += 1;
      for (const record of match.records) {
        classes.add(record.classificationText);
        classValues.add(record.classification.value);
        classCounts.set(
          record.classificationText,
          (classCounts.get(record.classificationText) ?? 0) + 1,
        );
        if (record.classification.value === 'not_yet_classified') matchedRecordsMissingClass += 1;
      }
    }
    if (classes.size > 1) mixedClassCases += 1;

    // What the case's classification WOULD be after this reconciliation —
    // computed exactly as projectCase combines it, and written nowhere.
    const official = [...classValues].filter(isOfficialClass);
    // Anything an accepted match contributed that is not one of the three
    // official classes cannot be mapped to a tier — must be 0.
    unmappedClassSets += classValues.size - official.length;
    const projected: Classification =
      official.length === 0
        ? recallCase.projection.classification
        : {
            value: official.length === 1 ? official[0] : 'multiple_classes',
            sourceText: null,
            officialClasses: official,
          };
    const set = officialClassesOf(projected);
    const key = classSetKey(set) || '(none)';
    classSets.set(key, (classSets.get(key) ?? 0) + 1);
    const tier = consumerRiskTier(projected);
    tiers.set(tier, (tiers.get(tier) ?? 0) + 1);
    if (set.length === 1) singleClassCases += 1;
    if (set.length === 0) unclassifiedCases += 1;
    if (set.length > 1 && isOfficialClass(projected.value)) mixedExposedAsScalar += 1;
  }

  console.log('\n  MATCH QA (live FDA cases)');
  console.log(`    cases examined:            ${cases.length}`);
  console.log(`    zero-candidate cases:      ${zeroCandidates}`);
  console.log(`    matched (deterministic):   ${states.matched_deterministic}`);
  console.log(`    ambiguous (preserved):     ${states.ambiguous}`);
  console.log(`    candidate (insufficient):  ${states.candidate}`);
  console.log(`    unmatched:                 ${states.unmatched}`);
  console.log(
    `    accepted events:           ${acceptedEvents} across ${matchedEventIds.size} distinct event_ids`,
  );

  console.log('\n  CLASSIFICATION QA (accepted matches only)');
  console.log(
    `    matched record classes:    ${[...classCounts.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || '(none)'}`,
  );
  console.log(`    mixed-class cases:         ${mixedClassCases}`);
  console.log(`    matched records missing an official class: ${matchedRecordsMissingClass}`);
  console.log(
    `    matches with full evidence provenance:     ${provenanceComplete}/${acceptedEvents}`,
  );

  console.log('\n  CLASSIFICATION STATE (what these matches would make of every FDA case)');
  console.log(`    no classification (pending/unrated): ${unclassifiedCases}`);
  console.log(`    single official class:               ${singleClassCases}`);
  console.log(`    mixed official classes:              ${mixedClassCases}`);
  console.log(
    `    distinct official class sets:        ${[...classSets.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  );
  console.log(
    `    consumer risk tiers:                 ${TIER_ORDER.filter((t) => tiers.has(t))
      .map((t) => `${t} ${tiers.get(t)}`)
      .join(', ')}`,
  );
  console.log(`    invalid / unmapped class sets:       ${unmappedClassSets}  (must be 0)`);
  console.log(`    mixed exposed as a scalar class:     ${mixedExposedAsScalar}  (must be 0)`);
  console.log('\n  This report is read-only: no writes were performed.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
