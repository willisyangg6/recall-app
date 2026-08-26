/**
 * Enforcement enrichment: attach accepted enforcement matches to their
 * RecallCase and let the existing projection/material-change machinery do
 * the rest.
 *
 * What one accepted match becomes:
 *  1. one source_records row per enforcement record (source_system
 *     'openfda_enforcement', native_id = recall_number, link_method
 *     'enforcement_match'), carrying the match evidence, method, matcher
 *     version, and timestamps inside its normalized payload — the audit
 *     answer to "why does this recall say Class I?";
 *  2. hash-gated source_snapshots preserving the raw openFDA payload
 *     (unchanged payloads snapshot nothing — idempotent re-runs are no-ops);
 *  3. a re-projection of the case (projectCase partitions notice vs
 *     enforcement records, so ONLY classification can change);
 *  4. material-change detection over the projection diff, a timeline entry
 *     dated by FDA's own classification date, and a notification event with
 *     the ledger's dedup + backfill-suppression semantics.
 *
 * A recall_number already linked to a DIFFERENT case is a conflict: it is
 * reported and skipped, never silently re-linked.
 */

import { detectChanges } from '../../domain/material-change';
import { projectCase } from '../../domain/projection';
import type { OfficialClass, TimelineEntry } from '../../domain/recall-types';
import { consumerRiskTier, officialClassesOf, type ConsumerRiskTier } from '../../domain/risk-tier';
import type { NormalizedSourceRecord } from '../../domain/source-record';
import { contentHash } from '../pipeline';
import type { RecallStore } from '../store/types';
import type { AcceptedMatch } from './match';
import { MATCHER_VERSION } from './match';
import type { EnforcementRecord, OpenFdaEnforcementRaw } from './parse';

/** Provenance block stored inside the enforcement record's normalized payload. */
export interface EnforcementMatchProvenance {
  method: string;
  matcherVersion: string;
  matchedAt: string;
  evidence: string[];
  eventId: string;
}

/**
 * Map one enforcement record into the shared record shape. The projection
 * partition guarantees none of the prose here ever reaches a consumer
 * surface — it exists for audit and internal search. Dates: publishedAt is
 * the recall's own initiation date (report_date would misstate when the
 * recall happened); the projection never reads enforcement dates anyway.
 */
export function enforcementToNormalized(
  record: EnforcementRecord,
  provenance: EnforcementMatchProvenance,
): NormalizedSourceRecord & { enforcement: object } {
  return {
    sourceSystem: 'openfda_enforcement',
    sourceAgency: 'FDA',
    nativeId: record.recallNumber,
    rawNativeId: record.recallNumber,
    noticeType: 'recall',
    // Enforcement status is "eventually updated, never timely" (FDA's own
    // disclaimer, contract §3.2/§9) — it never drives consumer lifecycle.
    lifecycle: 'active',
    closedYear: null,
    classification: record.classification,
    expansionOfNativeId: null,
    isRetractionNotice: false,
    retractsNativeIds: [],
    title: `FDA enforcement record ${record.recallNumber}`,
    summaryText: [
      record.productDescription,
      record.codeInfo ?? '',
      record.reasonForRecall ?? '',
    ].join('\n'),
    summaryHtml: null,
    reasonText: record.reasonForRecall,
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
    firmDisplayName: record.recallingFirm,
    firmRawVariants: [],
    brands: [],
    productDescription: record.productDescription,
    retailerNames: [],
    heroImageUrl: null,
    imageUrls: [],
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    productLines: [],
    quantityText: record.productQuantity,
    illnessStatement: null,
    consumerAction: null,
    contactText: null,
    officialUrl:
      'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/enforcement-reports',
    publishedAt:
      record.recallInitiationDate ?? record.reportDate ?? provenance.matchedAt.slice(0, 10),
    lastModifiedAt: null,
    // Structured enforcement facts + the match audit trail, preserved on the
    // record itself so provenance survives without a side table.
    enforcement: {
      eventId: record.eventId,
      recallNumber: record.recallNumber,
      classificationText: record.classificationText,
      status: record.status,
      productQuantity: record.productQuantity,
      distributionPattern: record.distributionPattern,
      voluntaryMandated: record.voluntaryMandated,
      recallInitiationDate: record.recallInitiationDate,
      centerClassificationDate: record.centerClassificationDate,
      reportDate: record.reportDate,
      terminationDate: record.terminationDate,
      match: provenance,
    },
  };
}

export interface EnrichOptions {
  apply: boolean;
  now?: () => Date;
  /** Classification older than this at attach time is history, not news. */
  backfillHorizonDays?: number;
}

export interface CaseEnrichmentOutcome {
  caseId: string;
  recordsLinked: number;
  recordsAlreadyLinked: number;
  snapshotsWritten: number;
  /** recall_numbers already linked to a DIFFERENT case — reported, skipped. */
  conflicts: string[];
  classificationBefore: string;
  classificationAfter: string;
  /** The authoritative class SET after enrichment — [] when still unclassified. */
  officialClassesAfter: OfficialClass[];
  /** Derived consumer tier after enrichment (never persisted, always derived). */
  riskTierAfter: ConsumerRiskTier;
  materialChanges: string[];
  notifications: { ruleId: string; suppressed: string | null }[];
}

/**
 * Attach accepted matches to one case. Dry-run (apply=false) computes the
 * full outcome — including which notifications WOULD be written and whether
 * they would be suppressed — without touching the store.
 */
export async function enrichCaseWithMatches(
  store: RecallStore,
  caseId: string,
  accepted: AcceptedMatch[],
  rawByRecallNumber: Map<string, OpenFdaEnforcementRaw>,
  options: EnrichOptions,
): Promise<CaseEnrichmentOutcome | null> {
  const now = options.now ?? (() => new Date());
  const nowIso = now().toISOString();
  const backfillHorizonDays = options.backfillHorizonDays ?? 30;

  const recallCase = await store.getCase(caseId);
  if (!recallCase) return null;

  const outcome: CaseEnrichmentOutcome = {
    caseId,
    recordsLinked: 0,
    recordsAlreadyLinked: 0,
    snapshotsWritten: 0,
    conflicts: [],
    classificationBefore: recallCase.projection.classification.value,
    classificationAfter: recallCase.projection.classification.value,
    officialClassesAfter: officialClassesOf(recallCase.projection.classification),
    riskTierAfter: consumerRiskTier(recallCase.projection.classification),
    materialChanges: [],
    notifications: [],
  };

  // 1. Link / refresh each matched enforcement record.
  const linkedNormalized: NormalizedSourceRecord[] = [];
  let anyContentChange = false;
  for (const match of accepted) {
    for (const record of match.records) {
      const raw = rawByRecallNumber.get(record.recallNumber);
      const existing = await store.getSourceRecordByNativeId(
        'openfda_enforcement',
        record.recallNumber,
      );
      if (existing && existing.recallCaseId !== caseId) {
        outcome.conflicts.push(record.recallNumber);
        continue;
      }
      const provenance: EnforcementMatchProvenance = {
        method: match.method,
        matcherVersion: MATCHER_VERSION,
        matchedAt:
          (existing?.normalized as { enforcement?: { match?: { matchedAt?: string } } })
            ?.enforcement?.match?.matchedAt ?? nowIso,
        evidence: match.evidence,
        eventId: match.eventId,
      };
      const normalized = enforcementToNormalized(record, provenance);
      linkedNormalized.push(normalized);
      const hash = contentHash(raw ?? record);

      if (!existing) {
        outcome.recordsLinked += 1;
        anyContentChange = true;
        if (options.apply) {
          const inserted = await store.insertSourceRecord({
            sourceSystem: 'openfda_enforcement',
            nativeId: record.recallNumber,
            recallCaseId: caseId,
            linkMethod: 'enforcement_match',
            normalized,
            sourceUrl: normalized.officialUrl,
            firstSeenAt: nowIso,
            lastSeenAt: nowIso,
          });
          await store.insertSnapshot({
            sourceRecordId: inserted.id,
            fetchedAt: nowIso,
            contentHash: hash,
            rawPayload: raw ?? record,
            sourceUrl: normalized.officialUrl,
          });
        }
        outcome.snapshotsWritten += 1;
      } else {
        outcome.recordsAlreadyLinked += 1;
        const latestHash = await store.getLatestSnapshotHash(existing.id);
        if (latestHash !== hash) {
          anyContentChange = true;
          outcome.snapshotsWritten += 1;
          if (options.apply) {
            await store.insertSnapshot({
              sourceRecordId: existing.id,
              fetchedAt: nowIso,
              contentHash: hash,
              rawPayload: raw ?? record,
              sourceUrl: normalized.officialUrl,
            });
            await store.updateSourceRecord(existing.id, { normalized, lastSeenAt: nowIso });
          }
        } else if (options.apply) {
          await store.updateSourceRecord(existing.id, { lastSeenAt: nowIso });
        }
      }
    }
  }
  if (linkedNormalized.length === 0) return outcome;

  // 2. Re-project. In dry-run the store has no enforcement rows yet, so the
  // next projection is computed from current records + the would-be links.
  const current = await store.getSourceRecordsForCase(caseId);
  const currentById = new Map(current.map((r) => [r.nativeId, r.normalized]));
  for (const normalized of linkedNormalized) currentById.set(normalized.nativeId, normalized);
  const next = projectCase([...currentById.values()]);
  outcome.classificationAfter = next.classification.value;
  outcome.officialClassesAfter = officialClassesOf(next.classification);
  outcome.riskTierAfter = consumerRiskTier(next.classification);

  if (JSON.stringify(next) === JSON.stringify(recallCase.projection)) {
    return outcome; // idempotent re-run: linked, unchanged, nothing to say.
  }

  const { material } = detectChanges(recallCase.projection, next);
  outcome.materialChanges = material.map((m) => m.ruleId);

  // FDA's own classification date anchors the timeline — enrichment must
  // never make the recall look newly announced or newly active.
  const classificationDates = accepted
    .flatMap((m) => m.records)
    .map((r) => r.centerClassificationDate ?? r.reportDate)
    .filter((d): d is string => d !== null)
    .sort();
  const occurredAt = classificationDates.at(-1) ?? nowIso.slice(0, 10);
  const classificationAgeMs = now().getTime() - Date.parse(occurredAt);
  const isBackfill = classificationAgeMs > backfillHorizonDays * 24 * 60 * 60 * 1000;

  const timeline: TimelineEntry[] = [...recallCase.timeline];
  for (const change of material) {
    timeline.push({
      occurredAt,
      kind: change.ruleId.startsWith('classification') ? 'classified' : 'source_updated',
      summary: change.summary,
      causedBySnapshotIds: [],
      material: true,
      ruleId: change.ruleId,
    });
  }

  if (options.apply && anyContentChange) {
    await store.updateCase(caseId, {
      projection: next,
      timeline,
      lastChangedAt: nowIso,
    });
  }

  for (const change of material) {
    const suppressed = isBackfill ? ('backfill' as const) : null;
    outcome.notifications.push({ ruleId: change.ruleId, suppressed });
    if (options.apply) {
      await store.insertNotificationIfAbsent({
        recallCaseId: caseId,
        kind: 'material_update',
        triggerRuleId: change.ruleId,
        dedupKey: `mu:${caseId}:${change.ruleId}:${change.fingerprint}`,
        materialChangeRef: change.fingerprint,
        payloadSummary: change.summary,
        suppressed,
        sourceSnapshotIds: [],
        createdAt: nowIso,
      });
    }
  }

  return outcome;
}
