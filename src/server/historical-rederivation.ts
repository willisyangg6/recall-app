/**
 * Governed historical re-derivation (O3-B5) — the wave-based repair of the
 * legacy population that the O3-B4 reconciliation could not certify: records
 * whose stored normalized/projection state predates today's parsers and
 * projectors with GENUINE content differences (never R1–R4 serialization
 * equivalence, which reconciliation already settles).
 *
 * Founder-approved contract (O3-B5A):
 *  - re-derive ONLY from the already-archived authoritative snapshot;
 *  - update only explicitly planned fields; whole case groups own the repair;
 *  - Policy B: zero notification events, ever; material corrections append
 *    one deterministic `corrected` timeline entry stating the app corrected
 *    its own reading of the original notice;
 *  - allergen-evidence-loss records (the FSIS 083-2016 shape: stored
 *    pathogen/allergen evidence the current parser would erase) are HELD as
 *    a governed exception — reported, never appliable;
 *  - dry-run first, immutable digest-bound plans, one wave per plan.
 *
 * TRANSACTION MODEL — precise, not aspirational: the repair of one case
 * group is a TWO-STEP sequence, not a single database transaction.
 *   Step 1  guarded `updateSourceRecordNormalized` per drifting contributor
 *           (consumer-INVISIBLE: nothing consumer-facing reads normalized
 *           rows directly).
 *   Step 2  ONE `apply_case_transition` RPC per group — projection, products,
 *           timeline, (empty) events, EVERY contributor's marker, and the
 *           case CAS commit or roll back TOGETHER; this step alone is
 *           database-atomic.
 * A crash anywhere between the steps leaves consumers untouched and the
 * group visibly unfinished (markers still NULL, projection unchanged) — the
 * settlement audit reports it and a rerun with the SAME plan converges:
 * every contributor must sit at its planned pre- OR post-repair normalized
 * fingerprint (a third state refuses the group), already-post contributors
 * are skipped, and the transition fires only when all contributors are at
 * post-state. Mutations are never retried; the silent-drop defect cannot
 * recur because no ingest gate consults normalized equality.
 */

import { projectCase } from '../domain/projection';
import { detectChanges, fingerprint } from '../domain/material-change';
import type {
  AffectedProduct,
  CaseProjection,
  SourceSystem,
  TimelineEntry,
} from '../domain/recall-types';
import { consumerRiskTier } from '../domain/risk-tier';
import type { NormalizedSourceRecord } from '../domain/source-record';
import { rederiveNormalized, writeJsonFileAtomically } from './applied-state-reconcile';
import { canonicalJson, contentHash } from './pipeline';
import type { RecallStore, SourceRecordRow } from './store/types';

export { writeJsonFileAtomically };

export const REDERIVATION_PLAN_SCHEMA = 'recall-rederivation-plan/1';

/**
 * The derivation contract names the parser/projector generation the plan was
 * derived under. Together with the Git-commit binding it guarantees plan
 * generation and apply share one notion of "current derivation" — bump it on
 * ANY parser/projector change that should invalidate outstanding plans.
 */
export const DERIVATION_CONTRACT = 'historical-rederivation/1';

const SUPPORTED_SYSTEMS: SourceSystem[] = ['fsis_api', 'fda_announcement', 'openfda_enforcement'];

/** Stable, descriptive wave identifiers (founder-approved rollout order). */
export type RederivationWave =
  'inert_refresh' | 'visible_corrections' | 'virginia_false_positive' | 'material_corrections';
export const APPLIABLE_WAVES: RederivationWave[] = [
  'inert_refresh',
  'visible_corrections',
  'virginia_false_positive',
  'material_corrections',
];

export type GroupClassification =
  | RederivationWave
  | 'governed_exception'
  | 'group_contains_non_legacy'
  | 'snapshot_parse_failure'
  | 'no_action_needed';

export interface PlanRecordEntry {
  sourceSystem: string;
  nativeId: string;
  sourceRecordId: string;
  recallCaseId: string;
  snapshotSeq: number;
  snapshotHash: string;
  /** contentHash of the CURRENT stored normalized state at plan time. */
  preNormalizedFingerprint: string;
  /** contentHash of the re-derived normalized state — the only allowed target. */
  postNormalizedFingerprint: string;
  needsNormalizedWrite: boolean;
}

export interface PlanCaseEntry {
  recallCaseId: string;
  wave: GroupClassification;
  memberRecordIds: string[];
  membershipFingerprint: string;
  /** CAS token at plan time — the transition refuses if the case moved. */
  caseLastChangedAt: string;
  preProjectionFingerprint: string;
  /** The EXACT planned post-repair projection (the transition's payload). */
  postProjection: CaseProjection;
  postProjectionFingerprint: string;
  preProductsFingerprint: string;
  postProductsFingerprint: string;
  timelineAction: 'corrected' | 'none';
  /** Deterministic repair fingerprint for the corrected entry (dedup). */
  correctedFingerprint: string | null;
  notificationEvents: [];
  expectedMarkers: { sourceRecordId: string; snapshotSeq: number; snapshotHash: string }[];
  initialEventDedupKey: string;
  consumerImpact: string[];
  changedCategories: string[];
  boundedFieldDiffs: { field: string; stored: string; derived: string }[];
  refusalReason: string | null;
}

export interface RederivationSummary {
  recordsExamined: number;
  groupsExamined: number;
  waveCounts: Record<string, { groups: number; records: number }>;
  plannedNormalizedWrites: number;
  plannedTimelineEntries: number;
  notificationEventsPlanned: 0;
  outOfScopeRecords: number;
}

export interface RederivationPlan {
  schemaVersion: string;
  derivationContract: string;
  gitCommit: string;
  /** Excluded from the digest (deliberately nondeterministic). */
  generatedAt: string;
  /** 'census' plans report everything and can NEVER be applied. */
  wave: RederivationWave | 'census';
  summary: RederivationSummary;
  records: PlanRecordEntry[];
  cases: PlanCaseEntry[];
  planDigest: string;
}

export function rederivationPlanDigest(
  plan: Omit<RederivationPlan, 'planDigest' | 'generatedAt'>,
): string {
  return contentHash({
    schemaVersion: plan.schemaVersion,
    derivationContract: plan.derivationContract,
    gitCommit: plan.gitCommit,
    wave: plan.wave,
    summary: plan.summary,
    records: plan.records,
    cases: plan.cases,
  });
}

export class RederivationPlanError extends Error {}

const TRUNCATE = 120;
const clip = (value: unknown): string => {
  const s = canonicalJson(value ?? null);
  return s.length > TRUNCATE ? `${s.slice(0, TRUNCATE)}…` : s;
};

/** Bounded retry for the plan builder's idempotent page reads ONLY. */
const READ_ATTEMPTS = 4;
async function retryRead<T>(name: string, read: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (attempt < READ_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }
  throw new RederivationPlanError(
    `plan read '${name}' failed after ${READ_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message.slice(0, 200) : String(lastError)
    }`,
  );
}

function membershipFingerprint(rows: SourceRecordRow[]): string {
  return contentHash(
    rows
      .map((row) => ({
        sourceSystem: row.sourceSystem,
        nativeId: row.nativeId,
        applyState: row.applyState ?? null,
      }))
      .sort((a, b) => a.nativeId.localeCompare(b.nativeId)),
  );
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

const eq = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

/** Content-aware consumer-surface axes (O3-B5A census logic, null ≡ []). */
function consumerImpactAxes(stored: CaseProjection, target: CaseProjection): string[] {
  const out: string[] = [];
  const s = stored as unknown as Record<string, unknown>;
  const t = target as unknown as Record<string, unknown>;
  if (s.state !== t.state) out.push('state');
  if (s.title !== t.title) out.push('title');
  if ((s.reasonText ?? null) !== (t.reasonText ?? null)) out.push('reasonText');
  if (s.hazardCategory !== t.hazardCategory) out.push('hazardCategory');
  if ((s.pathogenOrAllergen ?? null) !== (t.pathogenOrAllergen ?? null))
    out.push('pathogenOrAllergen');
  if (consumerRiskTier(stored.classification) !== consumerRiskTier(target.classification))
    out.push('riskTier');
  const sGeo = stored.geography;
  const tGeo = target.geography;
  if (
    !eq([...(sGeo?.states ?? [])].sort(), [...(tGeo?.states ?? [])].sort()) ||
    sGeo?.scope !== tGeo?.scope
  )
    out.push('geographyMatching');
  if (
    !eq(
      [...((s.retailerNames as string[] | undefined) ?? [])].sort(),
      [...((t.retailerNames as string[] | undefined) ?? [])].sort(),
    )
  )
    out.push('retailerContent');
  if (!eq(s.productCategories ?? null, t.productCategories ?? null)) out.push('categories');
  if (!eq(s.affectedProducts ?? [], t.affectedProducts ?? [])) out.push('products');
  if (((s.summaryText as string) ?? '') !== ((t.summaryText as string) ?? ''))
    out.push('summaryText');
  if ((s.consumerAction ?? null) !== (t.consumerAction ?? null)) out.push('consumerAction');
  if ((s.quantityText ?? null) !== (t.quantityText ?? null)) out.push('quantityText');
  if (!eq(s.recallingFirm ?? null, t.recallingFirm ?? null)) out.push('recallingFirm');
  if (!eq(s.brands ?? [], t.brands ?? [])) out.push('brands');
  if ((s.heroImageUrl ?? null) !== (t.heroImageUrl ?? null)) out.push('heroImage');
  if ((s.productDescription ?? null) !== (t.productDescription ?? null))
    out.push('productDescription');
  return out;
}

/** Publication/ordering fields the repair must NEVER change (pinned by test). */
function assertPublicDatesUnchanged(stored: CaseProjection, target: CaseProjection): boolean {
  const s = stored as unknown as Record<string, unknown>;
  const t = target as unknown as Record<string, unknown>;
  return (
    (s.publishedAt ?? null) === (t.publishedAt ?? null) &&
    (s.lastPublicActivityAt ?? null) === (t.lastPublicActivityAt ?? null)
  );
}

function shallowDiffs(
  stored: unknown,
  derived: unknown,
  prefix: string,
): { field: string; stored: string; derived: string }[] {
  const s = (stored ?? {}) as Record<string, unknown>;
  const d = (derived ?? {}) as Record<string, unknown>;
  const out: { field: string; stored: string; derived: string }[] = [];
  for (const key of [...new Set([...Object.keys(s), ...Object.keys(d)])].sort()) {
    if (!eq(s[key], d[key]))
      out.push({ field: `${prefix}${key}`, stored: clip(s[key]), derived: clip(d[key]) });
  }
  return out;
}

/**
 * The governed-exception rule (the FSIS 083-2016 shape, generalized rather
 * than hardcoded): current derivation would ERASE stored pathogen/allergen
 * evidence that the archived official text supports. Such a group is held —
 * reported on every dry run, never appliable — until a parser-specific
 * milestone can re-derive without losing the evidence.
 */
function losesAllergenEvidence(
  stored: NormalizedSourceRecord,
  derived: NormalizedSourceRecord,
): boolean {
  const s = (stored as unknown as Record<string, unknown>).pathogenOrAllergen ?? null;
  const d = (derived as unknown as Record<string, unknown>).pathogenOrAllergen ?? null;
  return s !== null && d === null;
}

export interface BuildOptions {
  gitCommit: string;
  wave?: RederivationWave | 'census';
  now?: () => Date;
  pageSizes?: Partial<{ records: number; health: number; cases: number; products: number }>;
}

export async function buildRederivationPlan(
  store: RecallStore,
  options: BuildOptions,
): Promise<RederivationPlan> {
  const now = options.now ?? (() => new Date());
  const requestedWave = options.wave ?? 'census';
  const ps = {
    records: options.pageSizes?.records ?? 500,
    health: options.pageSizes?.health ?? 1000,
    cases: options.pageSizes?.cases ?? 500,
    products: options.pageSizes?.products ?? 1000,
  };

  // ── Bounded reads (idempotent, retried) ───────────────────────────────────
  const healthRows: Awaited<ReturnType<RecallStore['listAppliedStateHealthPage']>> = [];
  for (let from = 0; ; from += ps.health) {
    const page = await retryRead(`health[${from}]`, () =>
      store.listAppliedStateHealthPage(from, ps.health),
    );
    healthRows.push(...page);
    if (page.length < ps.health) break;
  }
  const records = new Map<string, SourceRecordRow>();
  for (const system of SUPPORTED_SYSTEMS) {
    for (let from = 0; ; from += ps.records) {
      const page = await retryRead(`records:${system}[${from}]`, () =>
        store.listSourceRecordsPage(system, from, ps.records),
      );
      for (const row of page) records.set(row.id, row);
      if (page.length < ps.records) break;
    }
  }
  const latestByRecord = new Map<string, { seq: number; hash: string }>();
  for (const row of healthRows) {
    if (row.latestSeq != null && row.latestHash != null) {
      latestByRecord.set(row.id, { seq: row.latestSeq, hash: row.latestHash });
    }
  }
  const caseRows = new Map<
    string,
    { projection: CaseProjection; lastChangedAt: string; mergedInto: string | null }
  >();
  for (let from = 0; ; from += ps.cases) {
    const page = await retryRead(`cases[${from}]`, () => store.listCaseAuditPage(from, ps.cases));
    for (const row of page)
      caseRows.set(row.id, {
        projection: row.projection,
        lastChangedAt: row.lastChangedAt,
        mergedInto: row.mergedInto,
      });
    if (page.length < ps.cases) break;
  }
  const productsByCase = new Map<string, AffectedProduct[]>();
  for (let from = 0; ; from += ps.products) {
    const page = await retryRead(`products[${from}]`, () =>
      store.listCaseProductsPage(from, ps.products),
    );
    for (const entry of page) {
      const list = productsByCase.get(entry.recallCaseId) ?? [];
      list.push(entry.product);
      productsByCase.set(entry.recallCaseId, list);
    }
    if (page.length < ps.products) break;
  }
  const initialEventCases = new Set<string>();
  for (let from = 0; ; from += ps.products) {
    const page = await retryRead(`initialEvents[${from}]`, () =>
      store.listInitialEventCasePage(from, ps.products),
    );
    for (const id of page) initialEventCases.add(id);
    if (page.length < ps.products) break;
  }

  // ── Scope: whole case groups whose EVERY contributor is legacy-null ───────
  const byCase = new Map<string, SourceRecordRow[]>();
  for (const row of records.values()) {
    const list = byCase.get(row.recallCaseId) ?? [];
    list.push(row);
    byCase.set(row.recallCaseId, list);
  }
  const orderIndex = new Map(SUPPORTED_SYSTEMS.map((s, i) => [s, i]));
  const legacyGroups = [...byCase.entries()]
    .filter(([, rows]) => rows.some((r) => (r.applyState ?? null) === null))
    .sort((a, b) => a[0].localeCompare(b[0]));
  let outOfScopeRecords = 0;
  for (const row of records.values()) if ((row.applyState ?? null) !== null) outOfScopeRecords++;

  // Payloads for all legacy contributors, in bounded chunks by unique seq.
  const neededSeqs: number[] = [];
  for (const [, rows] of legacyGroups) {
    if (!rows.every((r) => (r.applyState ?? null) === null)) continue;
    for (const r of rows) {
      const latest = latestByRecord.get(r.id);
      if (latest) neededSeqs.push(latest.seq);
    }
  }
  neededSeqs.sort((a, b) => a - b);
  const payloadBySeq = new Map<number, unknown>();
  for (let i = 0; i < neededSeqs.length; i += 50) {
    const chunk = neededSeqs.slice(i, i + 50);
    const rows = await retryRead(`snapshots[${i / 50}]`, () => store.listSnapshotsBySeq(chunk));
    for (const row of rows) payloadBySeq.set(row.seq, row.rawPayload);
  }

  // ── Classify every group and build the plan ───────────────────────────────
  const planRecords: PlanRecordEntry[] = [];
  const planCases: PlanCaseEntry[] = [];
  const waveCounts: Record<string, { groups: number; records: number }> = {};
  let plannedNormalizedWrites = 0;
  let plannedTimelineEntries = 0;

  for (const [caseId, rows] of legacyGroups) {
    const caseRow = caseRows.get(caseId);
    const contributors = [...rows].sort(
      (a, b) =>
        (orderIndex.get(a.sourceSystem) ?? 9) - (orderIndex.get(b.sourceSystem) ?? 9) ||
        a.id.localeCompare(b.id),
    );
    const entry: PlanCaseEntry = {
      recallCaseId: caseId,
      wave: 'no_action_needed',
      memberRecordIds: contributors.map((r) => r.id),
      membershipFingerprint: membershipFingerprint(contributors),
      caseLastChangedAt: caseRow?.lastChangedAt ?? '',
      preProjectionFingerprint: caseRow ? contentHash(caseRow.projection) : '',
      postProjection: caseRow?.projection as CaseProjection,
      postProjectionFingerprint: '',
      preProductsFingerprint: productsFingerprint(productsByCase.get(caseId) ?? []),
      postProductsFingerprint: '',
      timelineAction: 'none',
      correctedFingerprint: null,
      notificationEvents: [],
      expectedMarkers: [],
      initialEventDedupKey: `initial:${caseId}`,
      consumerImpact: [],
      changedCategories: [],
      boundedFieldDiffs: [],
      refusalReason: null,
    };

    if (!contributors.every((r) => (r.applyState ?? null) === null)) {
      entry.wave = 'group_contains_non_legacy';
      entry.refusalReason = 'a contributor is not legacy-unverified — outside O3-B5 scope';
      planCases.push(entry);
      continue;
    }
    if (!caseRow || caseRow.mergedInto !== null) {
      entry.wave = 'group_contains_non_legacy';
      entry.refusalReason = 'case missing or merged tombstone';
      planCases.push(entry);
      continue;
    }

    // Re-derive every contributor from its archived snapshot.
    const derivedByRecord = new Map<string, NormalizedSourceRecord>();
    let parseFailure: string | null = null;
    let heldForAllergenLoss: string | null = null;
    for (const r of contributors) {
      const latest = latestByRecord.get(r.id);
      const payload = latest ? payloadBySeq.get(latest.seq) : undefined;
      if (!latest || payload === undefined) {
        parseFailure = `no archived payload for ${r.nativeId}`;
        break;
      }
      const derived = rederiveNormalized(r, payload);
      if ('error' in derived) {
        parseFailure = `${r.nativeId}: ${derived.error}`;
        break;
      }
      derivedByRecord.set(r.id, derived.normalized);
      if (losesAllergenEvidence(r.normalized, derived.normalized)) {
        heldForAllergenLoss = r.nativeId;
      }
    }
    if (parseFailure) {
      entry.wave = 'snapshot_parse_failure';
      entry.refusalReason = parseFailure;
      planCases.push(entry);
      continue;
    }

    const targetProjection = projectCase(
      contributors.map((r) => derivedByRecord.get(r.id)!),
    ) as CaseProjection;
    const targetProducts = (targetProjection.affectedProducts ?? []) as AffectedProduct[];
    const axes = consumerImpactAxes(caseRow.projection, targetProjection);
    const material = detectChanges(caseRow.projection, targetProjection).material;
    const normalizedChanged = contributors.some(
      (r) => contentHash(r.normalized) !== contentHash(derivedByRecord.get(r.id)!),
    );
    const projectionChanged = contentHash(caseRow.projection) !== contentHash(targetProjection);

    if (heldForAllergenLoss) {
      entry.wave = 'governed_exception';
      entry.refusalReason =
        `current derivation would erase stored pathogen/allergen evidence on ${heldForAllergenLoss} ` +
        `that the archived official text supports (cross-contamination statement) — held pending a ` +
        `parser milestone that extracts it; the stored evidence is retained`;
    } else if (!normalizedChanged && !projectionChanged) {
      entry.wave = 'no_action_needed';
      entry.refusalReason = 'stored state already equals current derivation (reconciliation scope)';
    } else if (!assertPublicDatesUnchanged(caseRow.projection, targetProjection)) {
      // Publication dates moving means this is NOT a pure historical repair.
      entry.wave = 'group_contains_non_legacy';
      entry.refusalReason =
        'derivation would move publishedAt/lastPublicActivityAt — refused (never a historical repair)';
    } else if (material.length > 0) {
      entry.wave = 'material_corrections';
    } else if (
      axes.length > 0 &&
      axes.every((a) => a === 'geographyMatching') &&
      (caseRow.projection.geography?.states ?? []).length >
        (targetProjection.geography?.states ?? []).length &&
      (targetProjection.geography?.states ?? []).every((s) =>
        (caseRow.projection.geography?.states ?? []).includes(s),
      ) &&
      caseRow.projection.geography?.scope === targetProjection.geography?.scope
    ) {
      entry.wave = 'virginia_false_positive';
    } else if (axes.length > 0) {
      entry.wave = 'visible_corrections';
    } else {
      entry.wave = 'inert_refresh';
    }

    if (entry.wave === 'material_corrections') {
      entry.timelineAction = 'corrected';
      plannedTimelineEntries += 1;
    }
    entry.postProjection = targetProjection;
    entry.postProjectionFingerprint = contentHash(targetProjection);
    entry.postProductsFingerprint = productsFingerprint(targetProducts);
    entry.consumerImpact = axes;
    entry.changedCategories = [
      ...new Set([
        ...axes,
        ...(normalizedChanged ? ['normalized'] : []),
        ...(projectionChanged ? ['projection'] : []),
      ]),
    ].sort();
    entry.boundedFieldDiffs = shallowDiffs(caseRow.projection, targetProjection, 'projection.');
    const seqs = contributors.map((r) => latestByRecord.get(r.id)!.seq).sort((a, b) => a - b);
    entry.correctedFingerprint =
      entry.timelineAction === 'corrected'
        ? fingerprint(`repair:${caseId}:${DERIVATION_CONTRACT}:${seqs.join(',')}`)
        : null;
    entry.expectedMarkers = contributors.map((r) => ({
      sourceRecordId: r.id,
      snapshotSeq: latestByRecord.get(r.id)!.seq,
      snapshotHash: latestByRecord.get(r.id)!.hash,
    }));
    planCases.push(entry);

    for (const r of contributors) {
      const latest = latestByRecord.get(r.id)!;
      const post = contentHash(derivedByRecord.get(r.id)!);
      const pre = contentHash(r.normalized);
      planRecords.push({
        sourceSystem: r.sourceSystem,
        nativeId: r.nativeId,
        sourceRecordId: r.id,
        recallCaseId: caseId,
        snapshotSeq: latest.seq,
        snapshotHash: latest.hash,
        preNormalizedFingerprint: pre,
        postNormalizedFingerprint: post,
        needsNormalizedWrite:
          pre !== post && APPLIABLE_WAVES.includes(entry.wave as RederivationWave),
      });
      if (pre !== post && APPLIABLE_WAVES.includes(entry.wave as RederivationWave)) {
        plannedNormalizedWrites += 1;
      }
    }
  }

  // ── Wave filter (a plan for one wave never authorizes another) ────────────
  const keptCases =
    requestedWave === 'census'
      ? planCases
      : planCases.filter((c) => c.wave === requestedWave || c.wave === 'governed_exception');
  const keptCaseIds = new Set(keptCases.map((c) => c.recallCaseId));
  const keptRecords = planRecords.filter((r) => keptCaseIds.has(r.recallCaseId));

  keptRecords.sort(
    (a, b) => a.sourceSystem.localeCompare(b.sourceSystem) || a.nativeId.localeCompare(b.nativeId),
  );
  keptCases.sort((a, b) => a.recallCaseId.localeCompare(b.recallCaseId));
  for (const c of keptCases) {
    if (requestedWave !== 'census' && c.wave === 'governed_exception') continue;
    const bucket = (waveCounts[c.wave] ??= { groups: 0, records: 0 });
    bucket.groups += 1;
    bucket.records += c.memberRecordIds.length;
  }
  for (const c of planCases) {
    if (requestedWave !== 'census' && !keptCaseIds.has(c.recallCaseId)) continue;
    if (requestedWave !== 'census' && c.wave === 'governed_exception') {
      const bucket = (waveCounts.governed_exception ??= { groups: 0, records: 0 });
      bucket.groups += 1;
      bucket.records += c.memberRecordIds.length;
    }
  }

  const body = {
    schemaVersion: REDERIVATION_PLAN_SCHEMA,
    derivationContract: DERIVATION_CONTRACT,
    gitCommit: options.gitCommit,
    wave: requestedWave,
    summary: {
      recordsExamined: keptRecords.length,
      groupsExamined: keptCases.length,
      waveCounts,
      plannedNormalizedWrites:
        requestedWave === 'census'
          ? plannedNormalizedWrites
          : keptRecords.filter((r) => r.needsNormalizedWrite).length,
      plannedTimelineEntries:
        requestedWave === 'census'
          ? plannedTimelineEntries
          : keptCases.filter((c) => c.timelineAction === 'corrected').length,
      notificationEventsPlanned: 0 as const,
      outOfScopeRecords,
    },
    records: keptRecords,
    cases: keptCases,
  };
  return {
    ...body,
    generatedAt: now().toISOString(),
    planDigest: rederivationPlanDigest(body),
  };
}

// ── Apply ────────────────────────────────────────────────────────────────────

export interface ApplyRederivationOptions {
  expectedDigest: string;
  currentGitCommit: string;
  wave: RederivationWave;
  now?: () => Date;
}

export type GroupOutcome =
  | {
      outcome: 'repaired';
      recallCaseId: string;
      normalizedWrites: number;
      timelineInserted: boolean;
    }
  | { outcome: 'already_completed'; recallCaseId: string }
  | { outcome: 'held_governed_exception'; recallCaseId: string; reason: string }
  | { outcome: 'refused'; recallCaseId: string; reason: string; partialNormalizedWrites: number };

export interface RederivationApplyReport {
  planDigest: string;
  gitCommit: string;
  wave: RederivationWave;
  groupsChecked: number;
  repaired: number;
  alreadyCompleted: number;
  refused: number;
  heldGovernedExceptions: number;
  normalizedWrites: number;
  timelineEntriesInserted: number;
  notificationEventsWritten: 0;
  deliveriesWritten: 0;
  outcomes: GroupOutcome[];
}

export async function applyRederivationPlan(
  store: RecallStore,
  plan: RederivationPlan,
  options: ApplyRederivationOptions,
): Promise<RederivationApplyReport> {
  const now = options.now ?? (() => new Date());
  if (plan.schemaVersion !== REDERIVATION_PLAN_SCHEMA) {
    throw new RederivationPlanError(
      `plan schema ${plan.schemaVersion} is not the supported ${REDERIVATION_PLAN_SCHEMA}`,
    );
  }
  if (plan.derivationContract !== DERIVATION_CONTRACT) {
    throw new RederivationPlanError(
      `plan derivation contract ${plan.derivationContract} is not the supported ${DERIVATION_CONTRACT} — regenerate the plan`,
    );
  }
  if (rederivationPlanDigest(plan) !== plan.planDigest) {
    throw new RederivationPlanError('plan content does not match its own digest — file altered');
  }
  if (options.expectedDigest !== plan.planDigest) {
    throw new RederivationPlanError('confirmed digest does not match the plan');
  }
  if (plan.gitCommit !== options.currentGitCommit) {
    throw new RederivationPlanError(
      `plan was generated at commit ${plan.gitCommit.slice(0, 12)} but the tree is at ${options.currentGitCommit.slice(0, 12)}`,
    );
  }
  if (plan.wave === 'census') {
    throw new RederivationPlanError(
      'a census plan can never be applied — generate a wave-bound plan',
    );
  }
  if (plan.wave !== options.wave) {
    throw new RederivationPlanError(
      `plan is bound to wave '${plan.wave}' but '${options.wave}' was requested — one wave per plan, always`,
    );
  }

  const recordsByCase = new Map<string, PlanRecordEntry[]>();
  for (const r of plan.records) {
    const list = recordsByCase.get(r.recallCaseId) ?? [];
    list.push(r);
    recordsByCase.set(r.recallCaseId, list);
  }

  const outcomes: GroupOutcome[] = [];
  let normalizedWrites = 0;
  let timelineEntriesInserted = 0;

  for (const caseEntry of [...plan.cases].sort((a, b) =>
    a.recallCaseId.localeCompare(b.recallCaseId),
  )) {
    if (caseEntry.wave === 'governed_exception') {
      outcomes.push({
        outcome: 'held_governed_exception',
        recallCaseId: caseEntry.recallCaseId,
        reason: caseEntry.refusalReason ?? 'governed exception',
      });
      continue;
    }
    if (caseEntry.wave !== plan.wave) {
      outcomes.push({
        outcome: 'refused',
        recallCaseId: caseEntry.recallCaseId,
        reason: `group wave ${caseEntry.wave} does not match the plan wave`,
        partialNormalizedWrites: 0,
      });
      continue;
    }
    const members = recordsByCase.get(caseEntry.recallCaseId) ?? [];
    const refuse = (reason: string, partial = 0) => {
      outcomes.push({
        outcome: 'refused',
        recallCaseId: caseEntry.recallCaseId,
        reason,
        partialNormalizedWrites: partial,
      });
    };

    // ── Group recheck (reads only; any surprise refuses before any write) ──
    const liveMembers = new Map<string, SourceRecordRow>();
    let recheckFailure: string | null = null;
    for (const m of members) {
      const row = await store.getSourceRecordByNativeId(m.sourceSystem as SourceSystem, m.nativeId);
      if (!row || row.id !== m.sourceRecordId) {
        recheckFailure = `${m.nativeId}: record identity changed`;
        break;
      }
      liveMembers.set(m.sourceRecordId, row);
      const meta = await store.getLatestSnapshotMeta(row.id);
      if (!meta || meta.seq !== m.snapshotSeq || meta.contentHash !== m.snapshotHash) {
        recheckFailure = `${m.nativeId}: latest snapshot changed since the plan`;
        break;
      }
    }
    if (recheckFailure) {
      refuse(recheckFailure);
      continue;
    }
    const liveRows = [...liveMembers.values()];
    if (membershipFingerprint(liveRows) !== caseEntry.membershipFingerprint) {
      // Membership fingerprint covers applyState: distinguish full completion.
      const allMarked = members.every((m) => {
        const row = liveMembers.get(m.sourceRecordId)!;
        return (
          row.applyState === 'applied' &&
          row.appliedSnapshotSeq === m.snapshotSeq &&
          row.appliedContentHash === m.snapshotHash
        );
      });
      const caseRow = await store.getCase(caseEntry.recallCaseId);
      if (
        allMarked &&
        caseRow &&
        contentHash(caseRow.projection) === caseEntry.postProjectionFingerprint
      ) {
        outcomes.push({ outcome: 'already_completed', recallCaseId: caseEntry.recallCaseId });
        continue;
      }
      refuse('group membership or marker state changed since the plan');
      continue;
    }
    // Normalized states must each be at the planned pre- or post-state.
    let mixedFailure: string | null = null;
    const pendingWrites: PlanRecordEntry[] = [];
    for (const m of members) {
      const row = liveMembers.get(m.sourceRecordId)!;
      const fp = contentHash(row.normalized);
      if (fp === m.postNormalizedFingerprint) continue;
      if (fp === m.preNormalizedFingerprint) {
        if (m.needsNormalizedWrite) pendingWrites.push(m);
        continue;
      }
      mixedFailure = `${m.nativeId}: normalized state matches neither the planned pre- nor post-repair fingerprint`;
      break;
    }
    if (mixedFailure) {
      refuse(mixedFailure);
      continue;
    }
    const caseRow = await store.getCase(caseEntry.recallCaseId);
    if (!caseRow) {
      refuse('case no longer exists');
      continue;
    }
    if (caseRow.lastChangedAt !== caseEntry.caseLastChangedAt) {
      refuse('case moved (last_changed_at CAS token changed since the plan)');
      continue;
    }
    if (contentHash(caseRow.projection) !== caseEntry.preProjectionFingerprint) {
      refuse('case projection changed since the plan');
      continue;
    }
    const currentProducts = await store.listCaseProducts(caseEntry.recallCaseId);
    if (productsFingerprint(currentProducts) !== caseEntry.preProductsFingerprint) {
      refuse('affected products changed since the plan');
      continue;
    }
    if (!(await store.hasNotificationEvent(caseEntry.initialEventDedupKey))) {
      refuse('required initial event is missing');
      continue;
    }

    // ── Derive targets fresh from the archived snapshots; verify the plan ──
    const seqs = members.map((m) => m.snapshotSeq).sort((a, b) => a - b);
    const payloads = await store.listSnapshotsBySeq(seqs);
    const payloadBySeq = new Map(payloads.map((p) => [p.seq, p.rawPayload]));
    const derivedByRecord = new Map<string, NormalizedSourceRecord>();
    let derivationFailure: string | null = null;
    for (const m of members) {
      const row = liveMembers.get(m.sourceRecordId)!;
      const payload = payloadBySeq.get(m.snapshotSeq);
      const derived =
        payload === undefined
          ? ({ error: 'payload missing' } as const)
          : rederiveNormalized(row, payload);
      if ('error' in derived) {
        derivationFailure = `${m.nativeId}: ${derived.error}`;
        break;
      }
      if (contentHash(derived.normalized) !== m.postNormalizedFingerprint) {
        derivationFailure = `${m.nativeId}: re-derivation no longer matches the planned post-repair fingerprint (derivation contract drift)`;
        break;
      }
      derivedByRecord.set(m.sourceRecordId, derived.normalized);
    }
    if (derivationFailure) {
      refuse(derivationFailure);
      continue;
    }

    // ── Step 1: guarded normalized writes (consumer-invisible) ─────────────
    let partial = 0;
    let writeFailure: string | null = null;
    for (const m of pendingWrites) {
      const ok = await store.updateSourceRecordNormalized(
        m.sourceRecordId,
        derivedByRecord.get(m.sourceRecordId)!,
        now().toISOString(),
        m.snapshotSeq,
      );
      if (!ok) {
        writeFailure = `${m.nativeId}: guarded normalized write matched no row`;
        break;
      }
      partial += 1;
      normalizedWrites += 1;
    }
    if (writeFailure) {
      // Honest recoverable state: earlier contributors are normalized; the
      // projection and every marker are untouched. A rerun converges.
      refuse(writeFailure, partial);
      continue;
    }

    // ── Step 2: ONE atomic transition for the whole group ──────────────────
    const timeline: TimelineEntry[] = [...caseRow.timeline];
    let timelineInserted = false;
    if (
      caseEntry.timelineAction === 'corrected' &&
      !timeline.some((t) => t.repair?.fingerprint === caseEntry.correctedFingerprint)
    ) {
      timeline.push({
        occurredAt: now().toISOString(),
        kind: 'corrected',
        summary:
          'The app corrected its reading of the original official notice — this is not a new agency update.',
        causedBySnapshotIds: members.map((m) => `seq-${m.snapshotSeq}`),
        material: false,
        repair: {
          fingerprint: caseEntry.correctedFingerprint!,
          derivationContract: DERIVATION_CONTRACT,
          wave: plan.wave,
          changedCategories: caseEntry.changedCategories,
          consumerVisible: caseEntry.consumerImpact.length > 0,
          notificationEventCreated: false,
        },
      });
      timelineInserted = true;
    }
    const result = await store.applyCaseTransition({
      recallCaseId: caseEntry.recallCaseId,
      expectedLastChangedAt: caseEntry.caseLastChangedAt,
      projection: caseEntry.postProjection,
      timeline,
      lastChangedAt: now().toISOString(),
      products: (caseEntry.postProjection.affectedProducts ?? []) as AffectedProduct[],
      events: [],
      markers: caseEntry.expectedMarkers.map((m) => ({
        sourceRecordId: m.sourceRecordId,
        contentHash: m.snapshotHash,
        snapshotSeq: m.snapshotSeq,
        state: 'applied' as const,
        appliedAt: now().toISOString(),
      })),
    });
    if (result.status !== 'applied') {
      refuse(
        'case transition CAS conflict — normalized preparation kept, rerun converges',
        partial,
      );
      continue;
    }
    if (timelineInserted) timelineEntriesInserted += 1;
    outcomes.push({
      outcome: 'repaired',
      recallCaseId: caseEntry.recallCaseId,
      normalizedWrites: partial,
      timelineInserted,
    });
  }

  return {
    planDigest: plan.planDigest,
    gitCommit: plan.gitCommit,
    wave: options.wave,
    groupsChecked: plan.cases.length,
    repaired: outcomes.filter((o) => o.outcome === 'repaired').length,
    alreadyCompleted: outcomes.filter((o) => o.outcome === 'already_completed').length,
    refused: outcomes.filter((o) => o.outcome === 'refused').length,
    heldGovernedExceptions: outcomes.filter((o) => o.outcome === 'held_governed_exception').length,
    normalizedWrites,
    timelineEntriesInserted,
    notificationEventsWritten: 0,
    deliveriesWritten: 0,
    outcomes,
  };
}
