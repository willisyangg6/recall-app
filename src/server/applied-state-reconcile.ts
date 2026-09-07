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
 *    every field is canonical content; nothing is excluded — except that a
 *    LEGACY-UNVERIFIED record (apply_state IS NULL) compares under the four
 *    founder-accepted legacy-equivalence rules (O3-B4B,
 *    `LEGACY_EQUIVALENCE_CONTRACT`): R1/R2 stored-null `declaresRevision`/
 *    `declaresExpansion` vs derived `false`, R3 stored-null `retailerNames`
 *    vs derived `[]` (both boundaries), R4 a legacy classification lacking
 *    `officialClasses` that resolves identically through officialClassesOf/
 *    consumerRiskTier/classificationStatus. Every rule is legacy-directional
 *    (unknown never equals affirmative evidence), applies to NO other
 *    apply_state, and projection-boundary rules require an all-legacy group.
 *    A legacy marker therefore certifies exact equality OR equality under
 *    these explicitly versioned rules — never consumer-visible,
 *    notification-material, ambiguous, or integrity-relevant drift, and
 *    never a difference merely because current consumers ignore the field.
 *    SETTLEMENT (O3-B4C): an APPLIED record whose marker matches its latest
 *    snapshot compares under the same rules and settles as
 *    `already_applied_equivalent` when only rule-accepted differences
 *    remain — the durable evidence is the marker's snapshot binding plus
 *    deterministic re-derivation under the versioned contract, so no
 *    schema column is needed. Marker inconsistency always wins over
 *    equivalence; pending/degraded stay strict.
 *    For
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

import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { projectCase } from '../domain/projection';
import type { AffectedProduct, Classification, SourceSystem } from '../domain/recall-types';
import { classificationStatus, consumerRiskTier, officialClassesOf } from '../domain/risk-tier';
import type { NormalizedSourceRecord } from '../domain/source-record';
import { enforcementToNormalized, type EnforcementMatchProvenance } from './fda-enforcement/enrich';
import { parseEnforcementRecord, type OpenFdaEnforcementRaw } from './fda-enforcement/parse';
import { parseFdaAnnouncement } from './fda/parse';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';
import { canonicalJson, contentHash } from './pipeline';
import type { ApplyState, CaseGeneratedColumns, RecallStore, SourceRecordRow } from './store/types';

export const PLAN_SCHEMA_VERSION = 'recall-applied-state-plan/2';

/**
 * O3-B4B legacy-equivalence contract version. Every plan records the contract
 * it was compared under, and apply refuses any other version, so plan
 * generation and apply-time validation can never disagree about what
 * "equivalent" meant. Bump on ANY rule change; never reuse a version for
 * different semantics. A plan/1 artifact predates this contract and fails
 * closed on its schema version alone.
 */
export const LEGACY_EQUIVALENCE_CONTRACT = 'legacy-equivalence/1';

const SUPPORTED_SYSTEMS: SourceSystem[] = ['fsis_api', 'fda_announcement', 'openfda_enforcement'];

/**
 * Every record and case ends in exactly one of these. The names refine the
 * O3-B2 baseline vocabulary in two places: `applied_marker_inconsistent`
 * (an O3-era marker contradicting its snapshots — §12) and
 * `case_blocked_by_sibling` / `invalid_case_link` (a record whose own state
 * is fine but whose case cannot be certified) — materially different risks
 * that must not collapse into one bucket. O3-B4B adds
 * `equivalent_legacy_seedable`: a legacy record seedable ONLY under the
 * versioned legacy-equivalence rules, kept distinct from
 * `consistent_legacy_seedable` (exact equality) so a reviewer always sees
 * which entries relied on the contract. O3-B4C adds the settlement mirror
 * `already_applied_equivalent`: an APPLIED record whose marker is sane
 * (matches its latest snapshot) and whose only stored-vs-derived
 * differences are accepted by the active contract — valid settled state,
 * never seedable, never a historical mismatch. A bad marker always takes
 * precedence: equivalence can never rehabilitate `applied_marker_inconsistent`.
 */
export type ReconcileClassification =
  | 'consistent_legacy_seedable'
  | 'equivalent_legacy_seedable'
  | 'already_applied_consistent'
  | 'already_applied_equivalent'
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
  /** Legacy-equivalence rule tags accepted for this record or its case (O3-B4B). */
  equivalencesUsed: string[];
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
  /** Rule tags under which this entry certifies (empty = exact equality). */
  equivalencesUsed: string[];
}

export interface ReconcileSummary {
  recordsExamined: number;
  casesExamined: number;
  snapshotsExamined: number;
  mergedTombstonesSkipped: number;
  seedableCount: number;
  refusedCount: number;
  classificationCounts: Record<string, number>;
  /** Records whose comparison used each equivalence rule (O3-B4C reporting). */
  equivalenceRuleCounts: Record<string, number>;
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
  /** The legacy-equivalence contract version the audit compared under. */
  equivalenceContract: string;
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
    equivalenceContract: plan.equivalenceContract,
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

// ── O3-B4B legacy-equivalence contract (legacy-equivalence/1) ───────────────
//
// Four founder-accepted rules — and NOTHING else — under which an unmarked
// legacy record (apply_state IS NULL) may be judged to faithfully represent
// the current derivation. Every rule is legacy-DIRECTIONAL: the stored side
// must be the pre-era absent/null representation and the derived side must be
// exactly the modern no-evidence default, so unknown can never equal
// affirmative evidence (declares* true, a nonempty retailer list, a new or
// different official class). The rules change no stored data, no ingestion,
// no presentation, and no notification behavior: they are an ephemeral
// comparison projection used only for equality/diff classification. A field
// being ignored by current consumers is NOT grounds for equivalence — only
// these proven representation identities are.

/** R1/R2/R3 at the normalized-record boundary. Returns the rule tag or null. */
export function normalizedLegacyEquivalence(
  field: string,
  stored: unknown,
  derived: unknown,
): string | null {
  const s = stored ?? null;
  const d = derived ?? null;
  if (field === 'declaresRevision' && s === null && d === false) return 'R1';
  if (field === 'declaresExpansion' && s === null && d === false) return 'R2';
  if (field === 'retailerNames' && s === null && Array.isArray(d) && d.length === 0) {
    return 'R3-normalized';
  }
  return null;
}

/**
 * R3/R4 at the case-projection boundary. R4 accepts a legacy classification
 * lacking the newer officialClasses set ONLY when every other classification
 * field is canonically identical AND both shapes resolve to the same
 * semantics through the authoritative domain accessors (officialClassesOf,
 * consumerRiskTier, classificationStatus) — semantic class equality, never a
 * blanket "missing field is acceptable" rule.
 */
export function projectionLegacyEquivalence(
  field: string,
  stored: unknown,
  derived: unknown,
): string | null {
  const s = stored ?? null;
  const d = derived ?? null;
  if (field === 'retailerNames' && s === null && Array.isArray(d) && d.length === 0) {
    return 'R3-projection';
  }
  if (field === 'classification') return classificationLegacyEquivalent(s, d) ? 'R4' : null;
  return null;
}

function classificationLegacyEquivalent(stored: unknown, derived: unknown): boolean {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return false;
  if (typeof derived !== 'object' || derived === null || Array.isArray(derived)) return false;
  const s = stored as Record<string, unknown>;
  const d = derived as Record<string, unknown>;
  // Legacy-directional shape gate: stored must predate the set; derived carries it.
  if ('officialClasses' in s || !('officialClasses' in d)) return false;
  // Every field except the added set must be canonically identical (value,
  // sourceText, and anything else either shape carries).
  const sKeys = Object.keys(s).sort();
  const dKeys = Object.keys(d)
    .filter((key) => key !== 'officialClasses')
    .sort();
  if (canonicalJson(sKeys) !== canonicalJson(dKeys)) return false;
  for (const key of sKeys) {
    if (canonicalJson(s[key] ?? null) !== canonicalJson(d[key] ?? null)) return false;
  }
  const sc = s as unknown as Pick<Classification, 'value' | 'officialClasses'>;
  const dc = d as unknown as Pick<Classification, 'value' | 'officialClasses'>;
  return (
    canonicalJson(officialClassesOf(sc)) === canonicalJson(officialClassesOf(dc)) &&
    consumerRiskTier(sc) === consumerRiskTier(dc) &&
    classificationStatus(sc) === classificationStatus(dc)
  );
}

/**
 * One legacy-aware comparison: residual diffs are real drift; accepted
 * equivalences are recorded by rule tag. `rule = null` compares strictly
 * (every non-legacy record/group). Inputs are never mutated — the walk is a
 * pure, ephemeral comparison projection.
 */
function diffWithLegacyEquivalence(
  stored: unknown,
  derived: unknown,
  prefix: string,
  rule: ((field: string, s: unknown, d: unknown) => string | null) | null,
): { residual: FieldDiff[]; equivalencesUsed: string[] } {
  if (canonicalJson(stored ?? null) === canonicalJson(derived ?? null)) {
    return { residual: [], equivalencesUsed: [] };
  }
  const s = (stored ?? {}) as Record<string, unknown>;
  const d = (derived ?? {}) as Record<string, unknown>;
  const residual: FieldDiff[] = [];
  const used = new Set<string>();
  for (const key of [...new Set([...Object.keys(s), ...Object.keys(d)])].sort()) {
    if (canonicalJson(s[key] ?? null) === canonicalJson(d[key] ?? null)) continue;
    const tag = rule ? rule(key, s[key], d[key]) : null;
    if (tag !== null) used.add(tag);
    else residual.push({ field: `${prefix}${key}`, stored: clip(s[key]), derived: clip(d[key]) });
  }
  return { residual, equivalencesUsed: [...used].sort() };
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
  /** Rule tags accepted at the normalized boundary (equivalence-eligible records only). */
  normalizedEquivalences: string[];
  /** True for an applied/degraded record whose marker matches its latest snapshot. */
  markerSane: boolean;
  normalizedFingerprint: string | null;
}

interface CaseAudit {
  caseId: string;
  contributors: RecordAudit[];
  issues: { classification: ReconcileClassification; reason: string; diffs?: FieldDiff[] }[];
  /** Rule tags accepted at the projection boundary (all-legacy groups only). */
  projectionEquivalences: string[];
  caseLastChangedAt: string | null;
  projectionFingerprint: string | null;
  productsFp: string | null;
  membershipFp: string | null;
  initialEventDedupKey: string;
  initialEventExists: boolean;
}

// ── O3-B3A: bounded reads, retries, and the concurrent-drift fence ──────────

/** Retry-exhausted transient read failure: fail-closed, no plan. */
export class AuditReadExhaustedError extends Error {
  constructor(
    public readonly readName: string,
    cause: unknown,
  ) {
    super(
      `audit read '${readName}' still failing after ${AUDIT_RETRY_ATTEMPTS} attempts: ${clipMessage(cause)}`,
    );
  }
}

/** Material production state changed while the census was being assembled. */
export class ConcurrentAuditDriftError extends Error {
  constructor(
    public readonly driftedRecordIds: string[],
    public readonly driftedCaseIds: string[],
    detail: string,
  ) {
    super(
      `material production state changed during the audit (${detail}) — rerun after the writer finishes. ` +
        `Affected records: ${driftedRecordIds.slice(0, 10).join(', ') || '(membership)'}` +
        `${driftedRecordIds.length > 10 ? ` +${driftedRecordIds.length - 10} more` : ''}; ` +
        `cases: ${driftedCaseIds.slice(0, 10).join(', ') || '(none)'}` +
        `${driftedCaseIds.length > 10 ? ` +${driftedCaseIds.length - 10} more` : ''}`,
    );
  }
}

/**
 * Bounded retry policy for the audit's idempotent reads ONLY (never wraps a
 * mutation — applySeedPlan calls the store directly, at most once per write).
 *
 * 4 total attempts with 500ms·2ⁿ backoff (±25% jitter, 5s cap): the failed
 * production census died to ONE transient `fetch failed` among ~13k
 * sequential requests; with ~100 bounded reads and 4 attempts each, a single
 * blip retries in under a second while a sustained outage still fails the
 * whole audit inside a few minutes. 429-class responses wait at least 2s —
 * the Retry-After substitute, since supabase-js does not expose response
 * headers on errors. Everything not provably transient (permission, schema,
 * validation, ordinary 4xx) is thrown immediately, unretried.
 *
 * LAYERING (deliberate, verified against the installed client): postgrest-js
 * itself retries thrown transport errors and 503/520 responses on
 * GET/HEAD/OPTIONS up to 3 times (1s/2s/4s, honoring Retry-After) before an
 * error ever reaches the store. One store-call "attempt" here therefore
 * already spans up to ~7s of inner retries; this outer policy engages only
 * when a whole inner cycle exhausts — extending tolerance from single-blip
 * (which killed the 2026-09-06 census under the inner layer alone) to
 * sustained ~30-60s outages, still bounded at 16 transport attempts per
 * read. Mutations are excluded at BOTH layers: POST is not an inner
 * retryable method, and no outer wrapper ever touches a mutating call.
 */
export const AUDIT_RETRY_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 5000;
const RATE_LIMIT_MIN_DELAY_MS = 2000;

const TRANSIENT_READ_ERROR =
  /fetch failed|network|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|UND_ERR|timed? ?out|\b(408|429|502|503|504)\b/i;
const RATE_LIMITED = /\b429\b|rate.?limit/i;

export function isTransientReadError(error: unknown): boolean {
  return TRANSIENT_READ_ERROR.test(error instanceof Error ? error.message : String(error));
}

/** Sanitized diagnostic: bounded length, never payload contents or key-bearing URLs. */
function clipMessage(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ');
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}

interface RetryContext {
  sleep: (ms: number) => Promise<void>;
  jitter: () => number;
  warn: (line: string) => void;
}

async function retryRead<T>(name: string, fn: () => Promise<T>, ctx: RetryContext): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientReadError(error)) throw error;
      if (attempt >= AUDIT_RETRY_ATTEMPTS) throw new AuditReadExhaustedError(name, error);
      let delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
      if (RATE_LIMITED.test(error instanceof Error ? error.message : '')) {
        delay = Math.max(delay, RATE_LIMIT_MIN_DELAY_MS);
      }
      const jittered = Math.round(delay * (0.75 + 0.5 * ctx.jitter()));
      ctx.warn(
        `  audit read retry: ${name} attempt ${attempt + 1}/${AUDIT_RETRY_ATTEMPTS} in ${jittered}ms (${clipMessage(error)})`,
      );
      await ctx.sleep(jittered);
    }
  }
}

/** Read every page of one bounded read, retrying exactly the failed page. */
async function readAllPages<T>(
  name: string,
  pageSize: number,
  fetchPage: (from: number, pageSize: number) => Promise<T[]>,
  ctx: RetryContext,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await retryRead(`${name}[${from}]`, () => fetchPage(from, pageSize), ctx);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/** Page/chunk sizes — injectable so tests cross every boundary cheaply. */
export interface AuditPageSizes {
  records: number;
  health: number;
  cases: number;
  caseTokens: number;
  products: number;
  initialEvents: number;
  payloadChunk: number;
}
export const DEFAULT_AUDIT_PAGE_SIZES: AuditPageSizes = {
  records: 500,
  health: 1000,
  cases: 500,
  caseTokens: 1000,
  products: 1000,
  initialEvents: 1000,
  payloadChunk: 50,
};

export interface AuditOptions {
  now?: () => Date;
  gitCommit: string;
  /** Injectable for deterministic retry tests; defaults to real timers/random. */
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
  warn?: (line: string) => void;
  pageSizes?: Partial<AuditPageSizes>;
}

/** The material-evidence fingerprint the drift fence compares (excluded: last_seen_at, fetched_at). */
function fenceRecordKey(row: {
  recallCaseId: string;
  applyState: unknown;
  appliedSnapshotSeq: unknown;
  appliedContentHash: unknown;
  latestSeq: unknown;
  latestHash: unknown;
}): string {
  return canonicalJson([
    row.recallCaseId,
    row.applyState ?? null,
    row.appliedSnapshotSeq ?? null,
    row.appliedContentHash ?? null,
    row.latestSeq ?? null,
    row.latestHash ?? null,
  ]);
}

/**
 * The complete dry-run census. Performs ZERO writes of any kind.
 *
 * Bounded read model (O3-B3A): the request count is proportional to pages
 * and chunks, never to records × attributes —
 *   ceil(N/health) [view: marker + latest-snapshot identity, also the fence
 *   bracket start] + Σ ceil(Nsys/records) [full rows] + ceil(L/payloadChunk)
 *   [latest payloads by globally-unique seq] + ceil(C/cases) [projection +
 *   CAS token + generated columns] + ceil(P/products) + ceil(E/initialEvents)
 *   + fence end (ceil(N/health) + ceil(C/caseTokens)).
 * For production (N=3,523, C=1,920, P=4,810, E≈C): ≈ 4+8+71+4+5+2+4+2 ≈ 100
 * requests, vs ~12,800 in the N+1 shape that failed on 2026-09-06.
 *
 * Consistency fence: the view + case CAS tokens are captured before the
 * census and re-read after it. Under the O3 write contract every material
 * change moves at least one fenced fact (membership, latest snapshot
 * seq/hash, marker state, or case last_changed_at — products/events/
 * projection only ever commit with a last_changed_at move). If any fenced
 * fact changed, the audit throws ConcurrentAuditDriftError and no plan
 * exists; ordinary last_seen_at movement is not read and cannot trip it.
 */
export async function auditAppliedState(
  store: RecallStore,
  options: AuditOptions,
): Promise<ReconcilePlan> {
  const now = options.now ?? (() => new Date());
  const ctx: RetryContext = {
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    jitter: options.jitter ?? Math.random,
    warn: options.warn ?? ((line) => console.warn(line)),
  };
  const ps: AuditPageSizes = { ...DEFAULT_AUDIT_PAGE_SIZES, ...options.pageSizes };

  // ── Fence bracket START + population completeness (one read, two uses) ────
  const healthRows = await readAllPages(
    'health',
    ps.health,
    (from, size) => store.listAppliedStateHealthPage(from, size),
    ctx,
  );
  const healthById = new Map(healthRows.map((row) => [row.id, row]));
  const unsupported = healthRows.filter(
    (row) => !SUPPORTED_SYSTEMS.includes(row.sourceSystem as SourceSystem),
  );

  // ── Full record rows per supported system (paginated) ─────────────────────
  const audits = new Map<string, RecordAudit>();
  let snapshotsExamined = 0;
  for (const system of SUPPORTED_SYSTEMS) {
    const records = await readAllPages(
      `records:${system}`,
      ps.records,
      (from, size) => store.listSourceRecordsPage(system, from, size),
      ctx,
    );
    for (const record of records) {
      audits.set(record.id, {
        record,
        snapshotSeq: null,
        snapshotHash: null,
        findings: [],
        normalizedEquivalences: [],
        markerSane: false,
        normalizedFingerprint: contentHash(record.normalized),
      });
    }
  }

  // ── Latest payloads in bounded chunks (seq is globally unique) ────────────
  const latestSeqByRecord = new Map<string, { seq: number; hash: string }>();
  for (const audit of audits.values()) {
    const health = healthById.get(audit.record.id);
    if (health?.latestSeq != null && health.latestHash != null) {
      latestSeqByRecord.set(audit.record.id, { seq: health.latestSeq, hash: health.latestHash });
    }
  }
  const allSeqs = [...latestSeqByRecord.values()].map((v) => v.seq).sort((a, b) => a - b);
  const payloadBySeq = new Map<number, unknown>();
  for (let i = 0; i < allSeqs.length; i += ps.payloadChunk) {
    const chunk = allSeqs.slice(i, i + ps.payloadChunk);
    const rows = await retryRead(
      `snapshots[${i / ps.payloadChunk}]`,
      () => store.listSnapshotsBySeq(chunk),
      ctx,
    );
    for (const row of rows) payloadBySeq.set(row.seq, row.rawPayload);
  }

  // ── Per-record audit from the bulk data ───────────────────────────────────
  for (const audit of audits.values()) {
    const record = audit.record;
    const latest = latestSeqByRecord.get(record.id);
    if (!latest) {
      audit.findings.push({
        classification: 'missing_snapshot',
        reason: 'no archived snapshot exists for this record',
      });
      continue;
    }
    snapshotsExamined += 1;
    audit.snapshotSeq = latest.seq;
    audit.snapshotHash = latest.hash;
    if (!payloadBySeq.has(latest.seq)) {
      audit.findings.push({
        classification: 'concurrent_or_changed_during_audit',
        reason: `latest snapshot seq ${latest.seq} was reported by the health view but absent from the payload read`,
      });
      continue;
    }
    // O3-era marker sanity (§12) runs FIRST: an applied/degraded marker must
    // point at the LATEST snapshot with its hash, with no required field
    // null — and marker inconsistency takes precedence over equivalence, so
    // eligibility below depends on this verdict.
    const state = record.applyState ?? null;
    if (state === 'applied' || state === 'applied_degraded') {
      if (record.appliedSnapshotSeq == null || record.appliedContentHash == null) {
        audit.findings.push({
          classification: 'applied_marker_inconsistent',
          reason: `apply_state=${state} with null marker fields`,
        });
      } else if (
        record.appliedSnapshotSeq !== latest.seq ||
        record.appliedContentHash !== latest.hash
      ) {
        audit.findings.push({
          classification: 'applied_marker_inconsistent',
          reason: `marker (seq ${record.appliedSnapshotSeq}, hash ${clip(record.appliedContentHash)}) does not match the latest snapshot (seq ${latest.seq})`,
        });
      } else {
        audit.markerSane = true;
      }
    }
    // Equivalence eligibility (O3-B4C): a legacy-unverified record, or an
    // APPLIED record whose marker is proven sane — the settled outcome of
    // the marker apply. `pending`/`applied_degraded` and any record with a
    // bad marker compare strictly; the rules themselves stay legacy-
    // directional over the STORED representation either way.
    const equivalenceEligible = state === null || (state === 'applied' && audit.markerSane);
    const derived = rederiveNormalized(record, payloadBySeq.get(latest.seq));
    if ('error' in derived) {
      audit.findings.push({
        classification: 'snapshot_parse_failure',
        reason: `archived payload does not re-derive: ${derived.error}`,
      });
    } else {
      const cmp = diffWithLegacyEquivalence(
        record.normalized,
        derived.normalized,
        'normalized.',
        equivalenceEligible ? normalizedLegacyEquivalence : null,
      );
      audit.normalizedEquivalences = cmp.equivalencesUsed;
      if (cmp.residual.length > 0) {
        audit.findings.push({
          classification: 'normalized_drift',
          reason: 'stored normalized state disagrees with re-derivation from the archived snapshot',
          diffs: cmp.residual,
        });
      }
    }
  }

  // ── Case pass from bulk reads: no per-case network calls ──────────────────
  const caseRows = await readAllPages(
    'cases',
    ps.cases,
    (from, size) => store.listCaseAuditPage(from, size),
    ctx,
  );
  const caseById = new Map(caseRows.map((row) => [row.id, row]));
  const productsByCase = new Map<string, AffectedProduct[]>();
  for (const entry of await readAllPages(
    'products',
    ps.products,
    (from, size) => store.listCaseProductsPage(from, size),
    ctx,
  )) {
    const list = productsByCase.get(entry.recallCaseId) ?? [];
    list.push(entry.product);
    productsByCase.set(entry.recallCaseId, list);
  }
  const initialEventCaseIds = new Set(
    await readAllPages(
      'initialEvents',
      ps.initialEvents,
      (from, size) => store.listInitialEventCasePage(from, size),
      ctx,
    ),
  );

  const contributorsByCase = new Map<string, RecordAudit[]>();
  for (const audit of audits.values()) {
    const list = contributorsByCase.get(audit.record.recallCaseId) ?? [];
    list.push(audit);
    contributorsByCase.set(audit.record.recallCaseId, list);
  }

  const linkedCaseIds = new Set(healthRows.map((row) => row.recallCaseId));
  let mergedTombstonesSkipped = 0;
  const caseFindings: CaseFinding[] = [];
  for (const row of caseRows) {
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
      projectionEquivalences: [],
      caseLastChangedAt: null,
      projectionFingerprint: null,
      productsFp: null,
      membershipFp: membershipFingerprint(contributors.map((audit) => audit.record)),
      initialEventDedupKey: `initial:${caseId}`,
      initialEventExists: false,
    };
    caseAudits.set(caseId, caseAudit);

    const caseRow = caseById.get(caseId);
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
    // Projection equivalences may relax a group only when EVERY contributor
    // is equivalence-eligible: legacy-unverified, or applied with a sane
    // marker (O3-B4C settlement). A pending, degraded, or marker-
    // inconsistent contributor forces strict comparison — an equivalent
    // sibling can never hide a bad marker or in-flight work.
    const groupEquivalenceEligible = contributors.every((audit) => {
      const state = audit.record.applyState ?? null;
      return state === null || (state === 'applied' && audit.markerSane);
    });
    const projectionCmp = diffWithLegacyEquivalence(
      caseRow.projection,
      recomputed,
      'projection.',
      groupEquivalenceEligible ? projectionLegacyEquivalence : null,
    );
    caseAudit.projectionEquivalences = projectionCmp.equivalencesUsed;
    if (projectionCmp.residual.length > 0) {
      caseAudit.issues.push({
        classification: 'case_projection_drift',
        reason: 'stored projection disagrees with projectCase over the stored contributor records',
        diffs: projectionCmp.residual,
      });
    }

    const expectedGenerated = generatedFromProjection(caseRow.projection);
    if (canonicalJson(caseRow.generated) !== canonicalJson(expectedGenerated)) {
      caseAudit.issues.push({
        classification: 'case_projection_drift',
        reason: 'generated read-model columns disagree with the stored projection',
        diffs: shallowDiff(caseRow.generated, expectedGenerated, 'generated.'),
      });
    }

    const products = productsByCase.get(caseId) ?? [];
    const expectedProducts = (caseRow.projection.affectedProducts ?? []) as AffectedProduct[];
    caseAudit.productsFp = productsFingerprint(products);
    if (caseAudit.productsFp !== productsFingerprint(expectedProducts)) {
      caseAudit.issues.push({
        classification: 'affected_products_drift',
        reason: `stored affected_products rows (${products.length}) disagree with the stored projection's product set (${expectedProducts.length}) — ordering and every field are contractual`,
      });
    }

    caseAudit.initialEventExists = initialEventCaseIds.has(caseId);
    if (!caseAudit.initialEventExists) {
      caseAudit.issues.push({
        classification: 'missing_initial_event',
        reason: `no ledger event with dedup key initial:${caseId} — every founded case requires exactly one (possibly suppressed) initial`,
      });
    }
  }

  // ── Fence bracket END: material state must not have moved ─────────────────
  {
    const healthAfter = await readAllPages(
      'health(fence)',
      ps.health,
      (from, size) => store.listAppliedStateHealthPage(from, size),
      ctx,
    );
    const tokensAfter = await readAllPages(
      'caseTokens(fence)',
      ps.caseTokens,
      (from, size) => store.listCaseTokensPage(from, size),
      ctx,
    );
    const driftedRecords = new Set<string>();
    const driftedCases = new Set<string>();
    const afterById = new Map(healthAfter.map((row) => [row.id, row]));
    for (const before of healthRows) {
      const after = afterById.get(before.id);
      if (!after) driftedRecords.add(before.nativeId);
      else if (fenceRecordKey(after) !== fenceRecordKey(before))
        driftedRecords.add(before.nativeId);
    }
    for (const after of healthAfter) {
      if (!healthById.has(after.id)) driftedRecords.add(after.nativeId);
    }
    const tokenById = new Map(tokensAfter.map((row) => [row.id, row.lastChangedAt]));
    for (const row of caseRows) {
      const after = tokenById.get(row.id);
      if (after === undefined || after !== row.lastChangedAt) driftedCases.add(row.id);
    }
    for (const token of tokensAfter) {
      if (!caseById.has(token.id)) driftedCases.add(token.id);
    }
    if (driftedRecords.size > 0 || driftedCases.size > 0) {
      throw new ConcurrentAuditDriftError(
        [...driftedRecords].sort(),
        [...driftedCases].sort(),
        'membership, snapshot, marker, or case CAS token moved between the fence brackets',
      );
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
      equivalencesUsed: [],
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
      const equivalencesUsed = [
        ...new Set([...audit.normalizedEquivalences, ...caseAudit.projectionEquivalences]),
      ].sort();
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
        classification =
          equivalencesUsed.length > 0 ? 'already_applied_equivalent' : 'already_applied_consistent';
        requiresSeparateReview = false;
      } else if (!caseCertifiable) {
        // Own state clean, case clean, but a sibling blocks certification.
        classification = 'case_blocked_by_sibling';
        requiresSeparateReview = false;
      } else {
        classification =
          equivalencesUsed.length > 0 ? 'equivalent_legacy_seedable' : 'consistent_legacy_seedable';
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
        equivalencesUsed,
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
          equivalencesUsed,
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
  const equivalenceRuleCounts: Record<string, number> = {};
  for (const finding of records) {
    classificationCounts[finding.classification] =
      (classificationCounts[finding.classification] ?? 0) + 1;
    for (const rule of finding.equivalencesUsed) {
      equivalenceRuleCounts[rule] = (equivalenceRuleCounts[rule] ?? 0) + 1;
    }
  }
  if (caseFindings.length > 0) classificationCounts.orphan_case = caseFindings.length;

  const refused = records.filter(
    (r) =>
      !r.seedable &&
      r.classification !== 'already_applied_consistent' &&
      r.classification !== 'already_applied_equivalent',
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
    equivalenceRuleCounts,
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
    equivalenceContract: LEGACY_EQUIVALENCE_CONTRACT,
    gitCommit: options.gitCommit,
    summary,
    records,
    caseFindings,
    seedable,
  };
  return { ...body, auditTimestamp: now().toISOString(), planDigest: planContentDigest(body) };
}

// ── Fail-closed plan output (O3-B3A) ─────────────────────────────────────────

/**
 * Write a reviewed artifact atomically: the JSON lands under a temporary
 * name and is renamed into place only after the full serialization succeeds,
 * so no interruption or thrown error can leave a partial, valid-looking
 * file. An existing destination is refused — a reviewed ledger is immutable.
 */
export function writeJsonFileAtomically(path: string, body: unknown): void {
  if (existsSync(path)) {
    throw new Error(
      `refusing to overwrite ${path} — a reviewed ledger is immutable; pick a new path`,
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup; the tmp name can never satisfy a plan path
    }
    throw error;
  }
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
  if (plan.equivalenceContract !== LEGACY_EQUIVALENCE_CONTRACT) {
    throw new PlanValidationError(
      `plan was compared under equivalence contract ${plan.equivalenceContract ?? '(none)'} but this code applies ${LEGACY_EQUIVALENCE_CONTRACT} — regenerate the plan so generation and apply share one contract`,
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
