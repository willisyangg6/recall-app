/**
 * Applied-state reconciliation (O3-B2) — the governed census that decides,
 * for every pre-O3 (legacy-unverified) source record, whether its ENTIRE
 * current state provably matches what the canonical pipeline would have
 * produced — and only then permits seeding the four applied-marker fields.
 *
 * This is deliberately NOT a repair. Unlike the P2/P3 hazard repairs (which
 * corrected reviewed, enumerated field values), this operation:
 *
 *   - re-derives current state from ARCHIVED snapshots only (no network);
 *   - REFUSES every historical mismatch — normalized drift, projection
 *     drift, product drift, missing initial events, orphan cases, missing
 *     snapshots, parse failures — and enumerates them for a separately
 *     reviewed, evidence-specific correction;
 *   - writes, in apply mode, ONLY `apply_state`, `applied_content_hash`,
 *     `applied_snapshot_seq`, `applied_at` on records the reviewed plan
 *     proved consistent — never normalized content, projections, products,
 *     timelines, `last_changed_at`, notification events, or snapshots.
 *
 * Dry run is the default and writes nothing. Apply is plan-bound: it takes a
 * reviewed, immutable plan file plus its digest, re-verifies every stated
 * precondition against the live row immediately before each seed, and
 * records a conflict instead of writing whenever ANYTHING moved. It never
 * reinterprets database rows as newly approved.
 *
 * COMPARISON CONTRACT (pinned in applied-state-reconcile.test.ts):
 *  - normalized: full canonical-JSON equality of NormalizedSourceRecord —
 *    every field is canonical content; nothing is excluded. For
 *    `openfda_enforcement` the stored match-provenance block
 *    (`normalized.enforcement.match`: method, matcherVersion, matchedAt,
 *    evidence, eventId) is copied into the re-derivation first — it is audit
 *    history of the original match decision, not re-derivable content.
 *  - projection: full canonical-JSON equality of projectCase(stored
 *    contributor records) vs the stored projection.
 *  - generated columns: equality with the projection-derived expressions
 *    (Postgres guarantees this; the audit still checks, so a definition
 *    drift or bypassed write cannot hide).
 *  - products: ordered field equality on {sourceNativeId, name, rawText,
 *    extractionConfidence} vs the STORED projection's affectedProducts —
 *    ordinal order is contractual.
 *  - excluded everywhere: firstSeenAt/lastSeenAt (operational timestamps),
 *    snapshot fetchedAt, case createdAt, and last_changed_at — the last is
 *    captured separately as the CAS token, never compared as content.
 */

import { projectCase } from '../domain/projection';
import type { AffectedProduct, SourceSystem } from '../domain/recall-types';
import type { NormalizedSourceRecord } from '../domain/source-record';
import { enforcementToNormalized, type EnforcementMatchProvenance } from './fda-enforcement/enrich';
import { parseEnforcementRecord, type OpenFdaEnforcementRaw } from './fda-enforcement/parse';
import { parseFdaAnnouncement } from './fda/parse';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';
import { canonicalJson, contentHash } from './pipeline';
import type { ApplyState, CaseGeneratedColumns, RecallStore, SourceRecordRow } from './store/types';

export const PLAN_SCHEMA_VERSION = 'recall-applied-state-plan/1';

const SUPPORTED_SYSTEMS: SourceSystem[] = ['fsis_api', 'fda_announcement', 'openfda_enforcement'];

/**
 * Every record and case ends in exactly one of these. The names refine the
 * O3-B2 baseline vocabulary in two places: `applied_marker_inconsistent`
 * (an O3-era marker contradicting its snapshots — §12) and
 * `case_blocked_by_sibling` / `invalid_case_link` (a record whose own state
 * is fine but whose case cannot be certified) — materially different risks
 * that must not collapse into one bucket.
 */
export type ReconcileClassification =
  | 'consistent_legacy_seedable'
  | 'already_applied_consistent'
  | 'pending_current_version'
  | 'applied_degraded'
  | 'normalized_drift'
  | 'case_projection_drift'
  | 'affected_products_drift'
  | 'missing_initial_event'
  | 'orphan_case'
  | 'missing_snapshot'
  | 'snapshot_parse_failure'
  | 'unsupported_source_system'
  | 'applied_marker_inconsistent'
  | 'invalid_case_link'
  | 'case_blocked_by_sibling'
  | 'concurrent_or_changed_during_audit'
  | 'multiple_findings';

/** Smallest-useful-field diff entry; values truncated, never full payloads. */
export interface FieldDiff {
  field: string;
  stored: string;
  derived: string;
}

export interface RecordFinding {
  classification: ReconcileClassification;
  sourceSystem: string;
  nativeId: string;
  sourceRecordId: string;
  recallCaseId: string | null;
  snapshotSeq: number | null;
  snapshotHash: string | null;
  applyState: ApplyState | null;
  /** Exact reasons; for multiple_findings, every contributing reason. */
  reasons: string[];
  fieldDiffs: FieldDiff[];
  seedable: boolean;
  consumerVisibleDiff: boolean;
  notificationDiff: boolean;
  requiresSeparateReview: boolean;
}

export interface CaseFinding {
  classification: 'orphan_case';
  recallCaseId: string;
  reasons: string[];
  requiresSeparateReview: true;
}

/** Everything the apply must re-verify before seeding one record. */
export interface SeedablePlanEntry {
  sourceSystem: string;
  nativeId: string;
  sourceRecordId: string;
  recallCaseId: string;
  snapshotSeq: number;
  snapshotHash: string;
  normalizedFingerprint: string;
  caseLastChangedAt: string;
  projectionFingerprint: string;
  productsFingerprint: string;
  membershipFingerprint: string;
  initialEventDedupKey: string;
}

export interface ReconcileSummary {
  recordsExamined: number;
  casesExamined: number;
  snapshotsExamined: number;
  mergedTombstonesSkipped: number;
  seedableCount: number;
  refusedCount: number;
  classificationCounts: Record<string, number>;
  plannedMarkerWrites: number;
  appliedMarkerWrites: number;
  notificationEventsWritten: number;
  deliveriesWritten: number;
  networkRequests: number;
  failures: number;
  populationVerdict:
    | 'fully_consistent'
    | 'seedable_after_review'
    | 'historical_mismatches_present'
    | 'empty_population';
}

export interface ReconcilePlan {
  schemaVersion: string;
  gitCommit: string;
  /** Excluded from the digest so identical audits are digest-identical. */
  auditTimestamp: string;
  summary: ReconcileSummary;
  records: RecordFinding[];
  caseFindings: CaseFinding[];
  seedable: SeedablePlanEntry[];
  planDigest: string;
}

/** The deterministic content digest: everything except timestamp + digest. */
export function planContentDigest(
  plan: Omit<ReconcilePlan, 'planDigest' | 'auditTimestamp'>,
): string {
  return contentHash({
    schemaVersion: plan.schemaVersion,
    gitCommit: plan.gitCommit,
    summary: plan.summary,
    records: plan.records,
    caseFindings: plan.caseFindings,
    seedable: plan.seedable,
  });
}

const TRUNCATE = 120;
const clip = (value: unknown): string => {
  const s = canonicalJson(value ?? null);
  return s.length > TRUNCATE ? `${s.slice(0, TRUNCATE)}…` : s;
};

function shallowDiff(stored: unknown, derived: unknown, prefix: string): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const s = (stored ?? {}) as Record<string, unknown>;
  const d = (derived ?? {}) as Record<string, unknown>;
  for (const key of [...new Set([...Object.keys(s), ...Object.keys(d)])].sort()) {
    if (canonicalJson(s[key] ?? null) !== canonicalJson(d[key] ?? null)) {
      diffs.push({ field: `${prefix}${key}`, stored: clip(s[key]), derived: clip(d[key]) });
    }
  }
  return diffs;
}

/** Re-derive a record's normalized state from its archived payload. */
function rederiveNormalized(
  record: SourceRecordRow,
  payload: unknown,
): { normalized: NormalizedSourceRecord } | { error: string } {
  try {
    switch (record.sourceSystem) {
      case 'fsis_api':
        return { normalized: parseFsisRecord(payload as FsisRawRecord) };
      case 'fda_announcement': {
        const raw = payload as {
          listing?: unknown;
          detailMainHtml?: string | null;
          path?: string;
          rssTitle?: string | null;
        };
        if (!raw || typeof raw.path !== 'string') {
          return { error: 'archived FDA payload lacks the {listing, detailMainHtml, path} shape' };
        }
        return {
          normalized: parseFdaAnnouncement({
            listing: (raw.listing ?? null) as never,
            detailMainHtml: raw.detailMainHtml ?? null,
            path: raw.path,
            rssTitle: raw.rssTitle ?? null,
          }),
        };
      }
      case 'openfda_enforcement': {
        const provenance = (
          record.normalized as { enforcement?: { match?: EnforcementMatchProvenance } }
        ).enforcement?.match;
        if (!provenance) {
          return { error: 'stored enforcement record lacks its match-provenance block' };
        }
        const parsed = parseEnforcementRecord(payload as OpenFdaEnforcementRaw);
        return { normalized: enforcementToNormalized(parsed, provenance) };
      }
      default:
        return { error: `unsupported source system ${record.sourceSystem}` };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function generatedFromProjection(projection: unknown): CaseGeneratedColumns {
  const p = projection as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    sourceAgency: text(p.sourceAgency),
    noticeType: text(p.noticeType),
    state: text(p.state),
    title: text(p.title),
    classificationValue: text((p.classification as Record<string, unknown> | undefined)?.value),
    hazardCategory: text(p.hazardCategory),
    publishedAt: text(p.publishedAt),
    lastPublicActivityAt: text(p.lastPublicActivityAt),
  };
}

function productsFingerprint(products: AffectedProduct[]): string {
  return contentHash(
    products.map((product) => ({
      sourceNativeId: product.sourceNativeId,
      name: product.name,
      rawText: product.rawText,
      extractionConfidence: product.extractionConfidence,
    })),
  );
}

function membershipFingerprint(contributors: SourceRecordRow[]): string {
  return contentHash(
    contributors
      .map((row) => ({
        sourceSystem: row.sourceSystem,
        nativeId: row.nativeId,
        applyState: row.applyState ?? null,
      }))
      .sort((a, b) => a.nativeId.localeCompare(b.nativeId)),
  );
}

interface RecordAudit {
  record: SourceRecordRow;
  snapshotSeq: number | null;
  snapshotHash: string | null;
  /** Record-level findings only (case-level ones attach in the case pass). */
  findings: { classification: ReconcileClassification; reason: string; diffs?: FieldDiff[] }[];
  normalizedFingerprint: string | null;
}

interface CaseAudit {
  caseId: string;
  contributors: RecordAudit[];
  issues: { classification: ReconcileClassification; reason: string; diffs?: FieldDiff[] }[];
  caseLastChangedAt: string | null;
  projectionFingerprint: string | null;
  productsFp: string | null;
  membershipFp: string | null;
  initialEventDedupKey: string;
  initialEventExists: boolean;
}

export interface AuditOptions {
  now?: () => Date;
  gitCommit: string;
}

/** The complete dry-run census. Performs ZERO writes of any kind. */
export async function auditAppliedState(
  store: RecallStore,
  options: AuditOptions,
): Promise<ReconcilePlan> {
  const now = options.now ?? (() => new Date());

  // ── Population completeness: EVERY record, including unknown systems ──────
  const identities = await store.listSourceRecordIdentities();
  const unsupported = identities.filter(
    (identity) => !SUPPORTED_SYSTEMS.includes(identity.sourceSystem as SourceSystem),
  );

  const audits = new Map<string, RecordAudit>();
  let snapshotsExamined = 0;

  for (const system of SUPPORTED_SYSTEMS) {
    for (const record of await store.listSourceRecords(system)) {
      const audit: RecordAudit = {
        record,
        snapshotSeq: null,
        snapshotHash: null,
        findings: [],
        normalizedFingerprint: contentHash(record.normalized),
      };
      audits.set(record.id, audit);

      const meta = await store.getLatestSnapshotMeta(record.id);
      if (!meta) {
        audit.findings.push({
          classification: 'missing_snapshot',
          reason: 'no archived snapshot exists for this record',
        });
      } else {
        snapshotsExamined += 1;
        audit.snapshotSeq = meta.seq;
        audit.snapshotHash = meta.contentHash;
        const payload = await store.getLatestSnapshotPayload(record.id);
        const derived = rederiveNormalized(record, payload);
        if ('error' in derived) {
          audit.findings.push({
            classification: 'snapshot_parse_failure',
            reason: `archived payload does not re-derive: ${derived.error}`,
          });
        } else if (canonicalJson(derived.normalized) !== canonicalJson(record.normalized)) {
          audit.findings.push({
            classification: 'normalized_drift',
            reason:
              'stored normalized state disagrees with re-derivation from the archived snapshot',
            diffs: shallowDiff(record.normalized, derived.normalized, 'normalized.'),
          });
        }
        // O3-era marker sanity (§12): an applied/degraded marker must point
        // at the LATEST snapshot with its hash, with no required field null.
        const state = record.applyState ?? null;
        if (state === 'applied' || state === 'applied_degraded') {
          if (record.appliedSnapshotSeq == null || record.appliedContentHash == null) {
            audit.findings.push({
              classification: 'applied_marker_inconsistent',
              reason: `apply_state=${state} with null marker fields`,
            });
          } else if (
            record.appliedSnapshotSeq !== meta.seq ||
            record.appliedContentHash !== meta.contentHash
          ) {
            audit.findings.push({
              classification: 'applied_marker_inconsistent',
              reason: `marker (seq ${record.appliedSnapshotSeq}, hash ${clip(record.appliedContentHash)}) does not match the latest snapshot (seq ${meta.seq})`,
            });
          }
        }
      }
    }
  }

  // ── Case pass: group contributors, recompute, verify read model ────────────
  const allCases = await store.listCases();
  const caseById = new Map(allCases.map((row) => [row.id, row]));
  const contributorsByCase = new Map<string, RecordAudit[]>();
  for (const audit of audits.values()) {
    const list = contributorsByCase.get(audit.record.recallCaseId) ?? [];
    list.push(audit);
    contributorsByCase.set(audit.record.recallCaseId, list);
  }

  const linkedCaseIds = new Set(identities.map((identity) => identity.recallCaseId));
  let mergedTombstonesSkipped = 0;
  const caseFindings: CaseFinding[] = [];
  for (const row of allCases) {
    if (contributorsByCase.has(row.id) || linkedCaseIds.has(row.id)) continue;
    if ((row.mergedInto ?? null) !== null) {
      mergedTombstonesSkipped += 1; // absorbed tombstone: records re-linked away by design
      continue;
    }
    caseFindings.push({
      classification: 'orphan_case',
      recallCaseId: row.id,
      reasons: [
        `case has zero linked source records and no merged_into tombstone (title: ${clip((row.projection as { title?: string }).title)})`,
      ],
      requiresSeparateReview: true,
    });
  }

  const caseAudits = new Map<string, CaseAudit>();
  for (const [caseId, contributors] of contributorsByCase) {
    const caseAudit: CaseAudit = {
      caseId,
      contributors,
      issues: [],
      caseLastChangedAt: null,
      projectionFingerprint: null,
      productsFp: null,
      membershipFp: membershipFingerprint(contributors.map((audit) => audit.record)),
      initialEventDedupKey: `initial:${caseId}`,
      initialEventExists: false,
    };
    caseAudits.set(caseId, caseAudit);

    const caseRow = caseById.get(caseId) ?? (await store.getCase(caseId));
    if (!caseRow) {
      caseAudit.issues.push({
        classification: 'invalid_case_link',
        reason: `linked case ${caseId} does not exist`,
      });
      continue;
    }
    caseAudit.caseLastChangedAt = caseRow.lastChangedAt;
    caseAudit.projectionFingerprint = contentHash(caseRow.projection);

    const recomputed = projectCase(contributors.map((audit) => audit.record.normalized));
    if (canonicalJson(recomputed) !== canonicalJson(caseRow.projection)) {
      caseAudit.issues.push({
        classification: 'case_projection_drift',
        reason: 'stored projection disagrees with projectCase over the stored contributor records',
        diffs: shallowDiff(caseRow.projection, recomputed, 'projection.'),
      });
    }

    const generated = await store.getCaseGeneratedColumns(caseId);
    const expectedGenerated = generatedFromProjection(caseRow.projection);
    if (generated && canonicalJson(generated) !== canonicalJson(expectedGenerated)) {
      caseAudit.issues.push({
        classification: 'case_projection_drift',
        reason: 'generated read-model columns disagree with the stored projection',
        diffs: shallowDiff(generated, expectedGenerated, 'generated.'),
      });
    }

    const products = await store.listCaseProducts(caseId);
    const expectedProducts = (caseRow.projection.affectedProducts ?? []) as AffectedProduct[];
    caseAudit.productsFp = productsFingerprint(products);
    if (caseAudit.productsFp !== productsFingerprint(expectedProducts)) {
      caseAudit.issues.push({
        classification: 'affected_products_drift',
        reason: `stored affected_products rows (${products.length}) disagree with the stored projection's product set (${expectedProducts.length}) — ordering and every field are contractual`,
      });
    }

    caseAudit.initialEventExists = await store.hasNotificationEvent(caseAudit.initialEventDedupKey);
    if (!caseAudit.initialEventExists) {
      caseAudit.issues.push({
        classification: 'missing_initial_event',
        reason: `no ledger event with dedup key initial:${caseId} — every founded case requires exactly one (possibly suppressed) initial`,
      });
    }
  }

  // ── Classification resolution: exactly one per record ──────────────────────
  const records: RecordFinding[] = [];
  const seedable: SeedablePlanEntry[] = [];

  for (const identity of unsupported) {
    records.push({
      classification: 'unsupported_source_system',
      sourceSystem: identity.sourceSystem,
      nativeId: identity.nativeId,
      sourceRecordId: identity.id,
      recallCaseId: identity.recallCaseId,
      snapshotSeq: null,
      snapshotHash: null,
      applyState: identity.applyState,
      reasons: [`source system ${identity.sourceSystem} is not covered by this audit`],
      fieldDiffs: [],
      seedable: false,
      consumerVisibleDiff: false,
      notificationDiff: false,
      requiresSeparateReview: true,
    });
  }

  for (const caseAudit of caseAudits.values()) {
    // Sibling gate: the case is certifiable only when every contributor is
    // free of record-level findings and is either legacy or consistently
    // applied — a projection computed with an unaudited or inconsistent
    // sibling can certify nothing.
    const blockingSibling = caseAudit.contributors.find(
      (audit) =>
        audit.findings.length > 0 ||
        (audit.record.applyState ?? null) === 'pending' ||
        (audit.record.applyState ?? null) === 'applied_degraded',
    );
    const caseCertifiable = caseAudit.issues.length === 0 && blockingSibling === undefined;

    for (const audit of caseAudit.contributors) {
      const record = audit.record;
      const state = record.applyState ?? null;
      const all = [...audit.findings, ...caseAudit.issues];
      const reasons = all.map((f) => f.reason);
      const fieldDiffs = all.flatMap((f) => f.diffs ?? []);
      const distinct = [...new Set(all.map((f) => f.classification))];
      const consumerVisibleDiff = distinct.some(
        (c) => c === 'case_projection_drift' || c === 'affected_products_drift',
      );
      const notificationDiff = distinct.includes('missing_initial_event');

      let classification: ReconcileClassification;
      let seedableHere = false;
      let requiresSeparateReview = true;

      if (state === 'pending') {
        // Normal ingestion owns the retry; reconciliation must not compete.
        classification = 'pending_current_version';
        requiresSeparateReview = false;
      } else if (state === 'applied_degraded' && audit.findings.length === 0) {
        classification = 'applied_degraded';
        requiresSeparateReview = false;
      } else if (distinct.length > 1) {
        classification = 'multiple_findings';
      } else if (distinct.length === 1) {
        classification = distinct[0];
      } else if (state === 'applied') {
        classification = 'already_applied_consistent';
        requiresSeparateReview = false;
      } else if (!caseCertifiable) {
        // Own state clean, case clean, but a sibling blocks certification.
        classification = 'case_blocked_by_sibling';
        requiresSeparateReview = false;
      } else {
        classification = 'consistent_legacy_seedable';
        seedableHere = true;
        requiresSeparateReview = false;
      }
      // A clean legacy record on an uncertifiable case with case-level
      // issues keeps the case-level classification (set above); a clean
      // legacy record blocked ONLY by a sibling keeps case_blocked_by_sibling.
      if (state === null && distinct.length === 0 && !caseCertifiable && blockingSibling) {
        classification = 'case_blocked_by_sibling';
        reasons.push(
          `sibling ${blockingSibling.record.nativeId} (${blockingSibling.record.applyState ?? blockingSibling.findings[0]?.classification ?? 'inconsistent'}) blocks group certification`,
        );
      }

      records.push({
        classification,
        sourceSystem: record.sourceSystem,
        nativeId: record.nativeId,
        sourceRecordId: record.id,
        recallCaseId: record.recallCaseId,
        snapshotSeq: audit.snapshotSeq,
        snapshotHash: audit.snapshotHash,
        applyState: state,
        reasons,
        fieldDiffs,
        seedable: seedableHere,
        consumerVisibleDiff,
        notificationDiff,
        requiresSeparateReview,
      });

      if (seedableHere && audit.snapshotSeq !== null && audit.snapshotHash !== null) {
        seedable.push({
          sourceSystem: record.sourceSystem,
          nativeId: record.nativeId,
          sourceRecordId: record.id,
          recallCaseId: record.recallCaseId,
          snapshotSeq: audit.snapshotSeq,
          snapshotHash: audit.snapshotHash,
          normalizedFingerprint: audit.normalizedFingerprint!,
          caseLastChangedAt: caseAudit.caseLastChangedAt!,
          projectionFingerprint: caseAudit.projectionFingerprint!,
          productsFingerprint: caseAudit.productsFp!,
          membershipFingerprint: caseAudit.membershipFp!,
          initialEventDedupKey: caseAudit.initialEventDedupKey,
        });
      }
    }
  }

  // ── Deterministic ordering regardless of store pagination order ────────────
  records.sort(
    (a, b) => a.sourceSystem.localeCompare(b.sourceSystem) || a.nativeId.localeCompare(b.nativeId),
  );
  seedable.sort(
    (a, b) => a.sourceSystem.localeCompare(b.sourceSystem) || a.nativeId.localeCompare(b.nativeId),
  );
  caseFindings.sort((a, b) => a.recallCaseId.localeCompare(b.recallCaseId));

  const classificationCounts: Record<string, number> = {};
  for (const finding of records) {
    classificationCounts[finding.classification] =
      (classificationCounts[finding.classification] ?? 0) + 1;
  }
  if (caseFindings.length > 0) classificationCounts.orphan_case = caseFindings.length;

  const refused = records.filter(
    (r) => !r.seedable && r.classification !== 'already_applied_consistent',
  );
  const mismatches = records.some((r) => r.requiresSeparateReview) || caseFindings.length > 0;
  const summary: ReconcileSummary = {
    recordsExamined: records.length,
    casesExamined: caseAudits.size + caseFindings.length,
    snapshotsExamined,
    mergedTombstonesSkipped,
    seedableCount: seedable.length,
    refusedCount: refused.length,
    classificationCounts,
    plannedMarkerWrites: seedable.length,
    appliedMarkerWrites: 0,
    notificationEventsWritten: 0,
    deliveriesWritten: 0,
    networkRequests: 0,
    failures: 0,
    populationVerdict:
      records.length === 0 && caseFindings.length === 0
        ? 'empty_population'
        : mismatches
          ? 'historical_mismatches_present'
          : seedable.length > 0
            ? 'seedable_after_review'
            : 'fully_consistent',
  };

  const body = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    gitCommit: options.gitCommit,
    summary,
    records,
    caseFindings,
    seedable,
  };
  return { ...body, auditTimestamp: now().toISOString(), planDigest: planContentDigest(body) };
}

// ── Plan-bound apply ─────────────────────────────────────────────────────────

export class PlanValidationError extends Error {}

export type SeedOutcome =
  | { outcome: 'seeded'; entry: SeedablePlanEntry }
  | { outcome: 'already_seeded'; entry: SeedablePlanEntry }
  | { outcome: 'conflict'; entry: SeedablePlanEntry; reason: string };

export interface ApplyReport {
  planDigest: string;
  gitCommit: string;
  entriesChecked: number;
  seeded: number;
  alreadySeeded: number;
  conflicts: number;
  groupsRefused: number;
  outcomes: SeedOutcome[];
  notificationEventsWritten: 0;
  deliveriesWritten: 0;
}

export interface ApplyOptions {
  /** The digest the reviewer approved — must equal the plan's own digest. */
  expectedDigest: string;
  /** The CURRENT code commit — must equal the commit the plan was made at. */
  currentGitCommit: string;
  now?: () => Date;
}

/**
 * Seed markers for a reviewed plan's seedable entries. The plan is immutable
 * input: every precondition is re-verified against the live row immediately
 * before each write, any change refuses the seed (recorded as a conflict —
 * a governed outcome, not a command failure), grouped per case so no group
 * seeds against a projection whose membership moved, and NOTHING is ever
 * regenerated or reinterpreted from the database during apply.
 */
export async function applySeedPlan(
  store: RecallStore,
  plan: ReconcilePlan,
  options: ApplyOptions,
): Promise<ApplyReport> {
  const now = options.now ?? (() => new Date());
  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION) {
    throw new PlanValidationError(
      `plan schema ${plan.schemaVersion} is not the supported ${PLAN_SCHEMA_VERSION}`,
    );
  }
  const recomputed = planContentDigest(plan);
  if (recomputed !== plan.planDigest) {
    throw new PlanValidationError(
      'plan content does not match its own digest — the file was altered after review',
    );
  }
  if (options.expectedDigest !== plan.planDigest) {
    throw new PlanValidationError(
      'the confirmed digest does not match the plan — review the plan file and pass its printed digest',
    );
  }
  if (plan.gitCommit !== options.currentGitCommit) {
    throw new PlanValidationError(
      `plan was produced at commit ${plan.gitCommit.slice(0, 12)} but the working tree is at ${options.currentGitCommit.slice(0, 12)} — regenerate and re-review the plan`,
    );
  }

  const outcomes: SeedOutcome[] = [];
  let groupsRefused = 0;

  const groups = new Map<string, SeedablePlanEntry[]>();
  for (const entry of plan.seedable) {
    const list = groups.get(entry.recallCaseId) ?? [];
    list.push(entry);
    groups.set(entry.recallCaseId, list);
  }

  for (const caseId of [...groups.keys()].sort()) {
    const group = groups.get(caseId)!;

    // Group recheck FIRST: no seed happens in a group until every member's
    // preconditions verify, so a partially-inconsistent case can never be
    // partially certified against a projection its siblings no longer match.
    const failures: { entry: SeedablePlanEntry; reason: string }[] = [];
    const already: SeedablePlanEntry[] = [];
    for (const entry of group) {
      const reason = await recheckEntry(store, entry);
      if (reason === 'already_seeded') already.push(entry);
      else if (reason !== null) failures.push({ entry, reason });
    }
    if (failures.length > 0) {
      groupsRefused += 1;
      for (const entry of group) {
        const own = failures.find((f) => f.entry === entry);
        outcomes.push({
          outcome: 'conflict',
          entry,
          reason: own
            ? own.reason
            : `group refused: sibling ${failures[0].entry.nativeId} failed recheck (${failures[0].reason})`,
        });
      }
      continue;
    }

    for (const entry of group) {
      if (already.includes(entry)) {
        outcomes.push({ outcome: 'already_seeded', entry });
        continue;
      }
      const seeded = await store.seedLegacyAppliedMarker({
        sourceRecordId: entry.sourceRecordId,
        contentHash: entry.snapshotHash,
        snapshotSeq: entry.snapshotSeq,
        state: 'applied',
        appliedAt: now().toISOString(),
      });
      outcomes.push(
        seeded
          ? { outcome: 'seeded', entry }
          : {
              outcome: 'conflict',
              entry,
              reason: 'seed predicate missed at write time (row no longer legacy-unverified)',
            },
      );
    }
  }

  return {
    planDigest: plan.planDigest,
    gitCommit: plan.gitCommit,
    entriesChecked: plan.seedable.length,
    seeded: outcomes.filter((o) => o.outcome === 'seeded').length,
    alreadySeeded: outcomes.filter((o) => o.outcome === 'already_seeded').length,
    conflicts: outcomes.filter((o) => o.outcome === 'conflict').length,
    groupsRefused,
    outcomes,
    notificationEventsWritten: 0,
    deliveriesWritten: 0,
  };
}

/** null = all preconditions hold; 'already_seeded' = idempotent rerun. */
async function recheckEntry(
  store: RecallStore,
  entry: SeedablePlanEntry,
): Promise<string | null | 'already_seeded'> {
  const record = await store.getSourceRecordByNativeId(
    entry.sourceSystem as SourceSystem,
    entry.nativeId,
  );
  if (!record || record.id !== entry.sourceRecordId) return 'record identity changed';
  const state = record.applyState ?? null;
  if (state !== null) {
    if (
      state === 'applied' &&
      record.appliedSnapshotSeq === entry.snapshotSeq &&
      record.appliedContentHash === entry.snapshotHash
    ) {
      return 'already_seeded';
    }
    return `record is no longer legacy-unverified (apply_state=${state})`;
  }
  const meta = await store.getLatestSnapshotMeta(record.id);
  if (!meta || meta.seq !== entry.snapshotSeq || meta.contentHash !== entry.snapshotHash) {
    return 'latest snapshot changed since the plan was made';
  }
  if (contentHash(record.normalized) !== entry.normalizedFingerprint) {
    return 'normalized state changed since the plan was made';
  }
  if (record.recallCaseId !== entry.recallCaseId) return 'case link changed';
  const caseRow = await store.getCase(entry.recallCaseId);
  if (!caseRow || caseRow.lastChangedAt !== entry.caseLastChangedAt) {
    return 'case moved (last_changed_at CAS token changed)';
  }
  if (contentHash(caseRow.projection) !== entry.projectionFingerprint) {
    return 'case projection changed since the plan was made';
  }
  const products = await store.listCaseProducts(entry.recallCaseId);
  if (productsFingerprint(products) !== entry.productsFingerprint) {
    return 'affected products changed since the plan was made';
  }
  if (!(await store.hasNotificationEvent(entry.initialEventDedupKey))) {
    return 'required initial event is no longer present';
  }
  const contributors = await store.getSourceRecordsForCase(entry.recallCaseId);
  if (membershipFingerprint(contributors) !== entry.membershipFingerprint) {
    return 'case membership changed since the plan was made';
  }
  return null;
}
