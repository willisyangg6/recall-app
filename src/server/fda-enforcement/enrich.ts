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
 *
 * Crash safety (O3-B1): enrichment commits through the same
 * apply_case_transition contract as announcement ingestion — the case
 * update, its timeline, its products, its classification events, and the
 * applied markers of every enforcement record in the transition are ONE
 * transaction. The pre-O3 failure modes are structurally gone: an event can
 * no longer describe a case version that was never stored (E2), and a retry
 * whose recomputed projection already equals the stored case can no longer
 * permanently lose the event (E3) — equality now PROVES the event committed
 * with the case, so the retry only finishes the pending markers.
 */

import { detectChanges } from '../../domain/material-change';
import { projectCase } from '../../domain/projection';
import type {
  MaterialChangeRuleId,
  OfficialClass,
  TimelineEntry,
  TimelineKind,
} from '../../domain/recall-types';
import { consumerRiskTier, officialClassesOf, type ConsumerRiskTier } from '../../domain/risk-tier';
import type { NormalizedSourceRecord } from '../../domain/source-record';
import { contentHash } from '../pipeline';
import type { AppliedMarker, NotificationEventInput, RecallStore } from '../store/types';
import type { AcceptedMatch } from './match';
import { MATCHER_VERSION } from './match';
import type { EnforcementRecord, OpenFdaEnforcementRaw } from './parse';

/**
 * The two classification-change material rules this preview covers — the
 * exact set `reconcileFdaEnforcement` already counts as `assignments` +
 * `reclassifications` (see reconcile.ts). `classification_changed` (a
 * mixed-set transition with no defined direction) is deliberately NOT
 * counted there today, so it is excluded here too: the preview's total must
 * match the pre-existing aggregate by construction, not introduce a third
 * category the rest of the system doesn't already recognize.
 */
const CLASSIFICATION_CHANGE_RULE_IDS: ReadonlySet<MaterialChangeRuleId> = new Set([
  'classification_assigned',
  'classification_upgraded',
  'classification_downgraded',
]);

/** Caps on founder-review text — evidence and recall numbers are already
 * short, but a case with many accepted matches must not grow unbounded. */
const PREVIEW_RECALL_NUMBER_SAMPLE = 10;
const PREVIEW_EVIDENCE_SAMPLE = 12;

export type ClassificationChangeKind = 'first_assignment' | 'reclassification';

/**
 * One proposed classification assignment/change, captured at the exact point
 * `detectChanges` decides it is material — the same decision that produces
 * the timeline entry and the NotificationEvent below. Bounded and
 * payload-free: no raw enforcement descriptions, addresses, or credentials.
 */
export interface ClassificationChangePreviewEntry {
  caseId: string;
  /** The case's own FDA announcement recall number, when one is linked — a
   * stable, officially-searchable identifier distinct from the internal
   * caseId. */
  announcementRecallNumber: string | null;
  title: string;
  classificationBefore: string;
  officialClassesAfter: OfficialClass[];
  riskTierAfter: ConsumerRiskTier;
  changeKind: ClassificationChangeKind;
  ruleId: MaterialChangeRuleId;
  acceptedEventIds: string[];
  enforcementRecallNumberCount: number;
  enforcementRecallNumbersSample: string[];
  matchMethods: AcceptedMatch['method'][];
  /** Bounded human-readable evidence lines — the audit answer to "why this class?". */
  evidence: string[];
  mixedClass: boolean;
  timelineKind: TimelineKind;
  fingerprint: string;
  dedupKey: string;
  /** True only if a ledger event with this exact dedup key is already stored
   * (read-only check; see RecallStore.hasNotificationEvent). Given the
   * atomic case-transition contract, a change that reaches this preview has
   * never been committed, so this is expected to always be false — surfaced
   * explicitly rather than assumed. */
  eventAlreadyExists: boolean;
  suppressed: 'backfill' | null;
}

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
  /** Every proposed classification assignment/change this case would write —
   * a strict subset of materialChanges, detailed enough for founder review. */
  classificationChanges: ClassificationChangePreviewEntry[];
  /**
   * The case CAS lost to a concurrent writer on every retry: the records
   * stay pending and the next scheduled run converges. Reported, never
   * silent — a caller must not read the planned materialChanges as applied.
   */
  casExhausted?: boolean;
}

/** Case CAS attempts before the enrichment leaves the records pending. */
const CASE_CAS_ATTEMPTS = 3;

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
    classificationChanges: [],
  };

  // Aggregated, bounded match evidence — identical for every classification
  // change this case could produce this run, so it is computed once from the
  // function's own `accepted` argument rather than re-derived per change.
  const acceptedEventIds = [...new Set(accepted.map((match) => match.eventId))];
  const enforcementRecallNumbers = accepted.flatMap((match) =>
    match.records.map((record) => record.recallNumber),
  );
  const matchMethods = [...new Set(accepted.map((match) => match.method))];
  const evidenceSample = accepted
    .flatMap((match) => match.evidence)
    .slice(0, PREVIEW_EVIDENCE_SAMPLE);

  // 1. Link / refresh each matched enforcement record. New and changed
  // records become PENDING versions whose applied markers ride the atomic
  // case transition below; a crash anywhere between here and that
  // transition leaves them pending and the next daily run converges.
  const linkedNormalized: NormalizedSourceRecord[] = [];
  const markers: AppliedMarker[] = [];
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
        outcome.snapshotsWritten += 1;
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
            applyState: 'pending',
          });
          const archived = await store.archiveSnapshot({
            sourceRecordId: inserted.id,
            fetchedAt: nowIso,
            contentHash: hash,
            rawPayload: raw ?? record,
            sourceUrl: normalized.officialUrl,
          });
          if (archived.status !== 'stale') {
            markers.push({
              sourceRecordId: inserted.id,
              contentHash: hash,
              snapshotSeq: archived.snapshotSeq,
              state: 'applied',
              appliedAt: nowIso,
            });
          }
        }
        continue;
      }

      outcome.recordsAlreadyLinked += 1;
      const meta = await store.getLatestSnapshotMeta(existing.id);
      const sameAsLatest = meta !== null && meta.contentHash === hash;
      // legacy_unverified (NULL marker) keeps its pre-O3 behavior on
      // unchanged content; it graduates when the payload actually changes
      // or through the O3-B2 reconciliation.
      const isLegacy = existing.applyState == null;
      const fullyApplied =
        sameAsLatest &&
        existing.applyState === 'applied' &&
        existing.appliedSnapshotSeq === meta?.seq &&
        existing.appliedContentHash === hash;
      if (sameAsLatest && (isLegacy || fullyApplied)) {
        if (options.apply) await store.updateSourceRecord(existing.id, { lastSeenAt: nowIso });
        continue;
      }

      // Changed payload (new snapshot) or a pending re-apply of the current
      // one (no duplicate snapshot).
      if (!sameAsLatest) outcome.snapshotsWritten += 1;
      if (options.apply) {
        let snapshotSeq: number;
        if (meta !== null && sameAsLatest) {
          snapshotSeq = meta.seq;
        } else {
          const archived = await store.archiveSnapshot({
            sourceRecordId: existing.id,
            fetchedAt: nowIso,
            contentHash: hash,
            rawPayload: raw ?? record,
            sourceUrl: normalized.officialUrl,
          });
          if (archived.status === 'stale') continue; // a newer fetch owns this record
          snapshotSeq = archived.snapshotSeq;
        }
        const wrote = await store.updateSourceRecordNormalized(
          existing.id,
          normalized,
          nowIso,
          snapshotSeq,
        );
        if (!wrote) continue; // monotonic guard: a newer version already applied
        markers.push({
          sourceRecordId: existing.id,
          contentHash: hash,
          snapshotSeq,
          state: 'applied',
          appliedAt: nowIso,
        });
      }
    }
  }
  if (linkedNormalized.length === 0) return outcome;

  // 2. Re-project and commit ONE atomic transition (case + products +
  // events + markers). The CAS re-reads and recomputes on conflict, so a
  // concurrent announcement ingest can never be blindly overwritten — and
  // vice versa. In dry-run the store has no enforcement rows yet, so the
  // next projection is computed from current records + the would-be links.
  for (let attempt = 0; attempt < CASE_CAS_ATTEMPTS; attempt++) {
    const freshCase = attempt === 0 ? recallCase : await store.getCase(caseId);
    if (!freshCase) return outcome;
    const current = await store.getSourceRecordsForCase(caseId);
    const announcementRecallNumber =
      current.find((r) => r.sourceSystem === 'fda_announcement')?.nativeId ?? null;
    const currentById = new Map(current.map((r) => [r.nativeId, r.normalized]));
    for (const normalized of linkedNormalized) currentById.set(normalized.nativeId, normalized);
    const next = projectCase([...currentById.values()]);
    outcome.classificationAfter = next.classification.value;
    outcome.officialClassesAfter = officialClassesOf(next.classification);
    outcome.riskTierAfter = consumerRiskTier(next.classification);

    if (JSON.stringify(next) === JSON.stringify(freshCase.projection)) {
      // Nothing consumer-visible left to write. Under the atomic contract
      // this PROVES any required event already committed with the case
      // (equality can no longer mask a lost event — the E3 fix), so the
      // retry only finishes the pending markers.
      if (options.apply) {
        for (const marker of markers) await store.markSourceRecordApplied(marker);
      }
      return outcome;
    }

    const { material } = detectChanges(freshCase.projection, next);
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

    const timeline: TimelineEntry[] = [...freshCase.timeline];
    const events: NotificationEventInput[] = [];
    outcome.notifications = [];
    outcome.classificationChanges = [];
    for (const change of material) {
      const timelineKind: TimelineKind = change.ruleId.startsWith('classification')
        ? 'classified'
        : 'source_updated';
      timeline.push({
        occurredAt,
        kind: timelineKind,
        summary: change.summary,
        causedBySnapshotIds: [],
        material: true,
        ruleId: change.ruleId,
      });
      const suppressed = isBackfill ? ('backfill' as const) : null;
      outcome.notifications.push({ ruleId: change.ruleId, suppressed });
      const dedupKey = `mu:${caseId}:${change.ruleId}:${change.fingerprint}`;
      events.push({
        recallCaseId: caseId,
        kind: 'material_update',
        triggerRuleId: change.ruleId,
        dedupKey,
        materialChangeRef: change.fingerprint,
        payloadSummary: change.summary,
        suppressed,
        sourceSnapshotIds: [],
        createdAt: nowIso,
      });

      // The founder-review preview: a strict subset of the timeline/event
      // writes above, at the same decision point, never a second detector.
      if (CLASSIFICATION_CHANGE_RULE_IDS.has(change.ruleId)) {
        outcome.classificationChanges.push({
          caseId,
          announcementRecallNumber,
          title: next.title,
          classificationBefore: freshCase.projection.classification.value,
          officialClassesAfter: outcome.officialClassesAfter,
          riskTierAfter: outcome.riskTierAfter,
          changeKind:
            change.ruleId === 'classification_assigned' ? 'first_assignment' : 'reclassification',
          ruleId: change.ruleId,
          acceptedEventIds,
          enforcementRecallNumberCount: enforcementRecallNumbers.length,
          enforcementRecallNumbersSample: enforcementRecallNumbers.slice(
            0,
            PREVIEW_RECALL_NUMBER_SAMPLE,
          ),
          matchMethods,
          evidence: evidenceSample,
          mixedClass: outcome.officialClassesAfter.length > 1,
          timelineKind,
          fingerprint: change.fingerprint,
          dedupKey,
          eventAlreadyExists: await store.hasNotificationEvent(dedupKey),
          suppressed,
        });
      }
    }

    if (!options.apply) return outcome;

    const result = await store.applyCaseTransition({
      recallCaseId: caseId,
      expectedLastChangedAt: freshCase.lastChangedAt,
      projection: next,
      timeline,
      lastChangedAt: nowIso,
      products: next.affectedProducts,
      events,
      markers,
    });
    if (result.status === 'applied') return outcome;
    // 'conflict': a concurrent writer moved the case — re-read, recompute.
  }
  // The records stay pending; the next scheduled run converges.
  outcome.casExhausted = true;
  console.warn(
    `  case ${caseId}: enrichment lost the case CAS ${CASE_CAS_ATTEMPTS} times — left pending for the next run.`,
  );
  return outcome;
}
