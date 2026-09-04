/**
 * Historical FDA contaminant-category correction (P3B) — an explicit
 * maintenance operation, deliberately outside normal ingestion and
 * deliberately separate from the settled P2e-B repair.
 *
 * WHY IT IS NEEDED. The FDA reason category `Potential Metal or Chemical
 * Contaminant` is disjunctive: one taxonomy heading covering a physical
 * fragment hazard AND a chemical/radiological one. The heading therefore
 * states neither, and only the announcement's own wording can decide. The
 * committed parser decided it with a bare scan for material words anywhere
 * in the announcement, so PACKAGING chose the hazard — the same
 * false-positive shape P2e-B eliminated for FSIS, left open on this one FDA
 * branch. `server/fda/parse.ts` now routes the branch through THE shared
 * evidence owner (`extractForeignMaterialEvidence`, domain/hazard.ts), and
 * this repair brings the historical rows into agreement with it.
 *
 * WHAT THE AUDIT FOUND. A read-only comparison reparsed all 721 archived FDA
 * production snapshots (2026-09-03, 100% snapshot coverage) and found
 * exactly three canonical differences, all active, all in this category, all
 * stored `foreign_material` / null because the only material word in the
 * announcement described the package:
 *
 *   - a talc powder "packaged in plastic bottles" whose announcement states
 *     the product has "the potential to be contaminated with asbestos" →
 *     `chemical_contamination` / `asbestos`;
 *   - two shrimp notices "packaged in a clear plastic tray" / "in clear
 *     plastic bag" whose announcements state contamination with Cesium-137
 *     (Cs-137) → `chemical_contamination` / `Cesium-137`.
 *
 * FDA's taxonomy has no separate mineral or radiological category. Within
 * the closed schema the honest representation of both asbestos and Cs-137 is
 * the chemical category plus the named agent — never a nameless
 * foreign-material line, and never null when the source states one.
 * Asbestos is not chemically a "chemical" in the strict sense; this is the
 * app's existing honest mapping onto its current closed taxonomy, not a
 * scientific classification claim. Introducing a separate mineral or
 * radiological category is explicitly NOT this milestone.
 *
 * WHY IT NEEDS NO NETWORK. Every snapshot preserves the raw payload the
 * record was parsed from (architecture Part 12). This repair re-runs the
 * CANONICAL adapter — `parseFdaAnnouncement`, the exact function ingestion
 * uses, never a repair-only re-implementation — over those archived bytes.
 *
 * WHAT IT TOUCHES. `normalized.hazardCategory` and
 * `normalized.pathogenOrAllergen` on FDA source records, and the same pair
 * inside `projection` on their cases. Nothing else may enter a write
 * payload. It never creates a case, never merges or re-links one, never runs
 * the pipeline or `detectChanges`, never writes a NotificationEvent, never
 * moves a date or `lastChangedAt`, and never touches raw snapshots, hashes,
 * timelines, retailers, geography, products, images or the notification
 * ledger. The generated `recall_cases.hazard_category` column follows the
 * projection JSON on its own and is never written directly.
 *
 * SCOPE. Only FDA announcement records whose ARCHIVED official category is
 * `Potential Metal or Chemical Contaminant`. Every other source system, and
 * every other FDA category, is out of scope and never planned — this repair
 * cannot reach the P2e-B population or any FSIS row.
 *
 * PLAN-THEN-APPLY. Unlike P2e-B's single pass, this repair plans the whole
 * population first and only then writes, so a blocker anywhere (a missing
 * snapshot, a parse failure, an unreviewed category or agent transition, a
 * population that is not the reviewed one) refuses the ENTIRE apply rather
 * than being discovered after some rows were already corrected.
 *
 * Case-level precedence is delegated to `projectCase`, exactly like P2d-B
 * and P2e-B: the corrected case value is what a legitimate full
 * re-projection of the corrected records would produce, so the projection
 * stays a pure function of its records and the next real re-projection
 * recomputes the same answer instead of erasing this one. Multi-source cases
 * are therefore handled by the projection owner, never patched by assumption.
 *
 * Safe to run WHILE scheduled ingestion is running, with no job lease. Every
 * write is compare-and-swap protected: the case write lands only while
 * `last_changed_at` still matches, and the record write only while the row
 * still holds both values the reviewed plan observed. Conflicted rows are
 * SKIPPED and reported — never re-derived on the fly.
 *
 * Idempotent and restartable: every decision is made from current state, so
 * a completed run is a no-op, an interrupted one simply resumes, and the dry
 * run doubles as the post-apply verification report ("would change: 0").
 *
 * HISTORICAL CORRECTION IS NOTIFICATION-SILENT. Whether a future
 * SOURCE-DRIVEN hazard change should notify is a separate policy question
 * and is deliberately not decided here.
 */

import { projectCase } from '../domain/projection';
import type { HazardCategory } from '../domain/recall-types';
import type { NormalizedSourceRecord } from '../domain/source-record';
import { decodeEntities } from '../domain/text';
import { parseFdaAnnouncement, type FdaAnnouncementSource, type FdaListingItem } from './fda/parse';
import type { RecallCaseRow, RecallStore, SourceRecordRow } from './store/types';

/** The one disjunctive FDA reason category this repair governs. */
export const TARGET_FDA_CATEGORY = 'Potential Metal or Chemical Contaminant';

/**
 * The single category correction the P3B audit source-reviewed. A transition
 * absent from this table is refused and reported, whatever the evidence says
 * — the parser decides truth, but only a reviewed transition may be written
 * to historical data.
 */
export const ALLOWED_TRANSITIONS: readonly (readonly [string, HazardCategory])[] = [
  ['foreign_material', 'chemical_contamination'],
];

/**
 * The agent moves the same audit reviewed, written together with the
 * category as one canonical fact. `null → asbestos` is the talc notice — the
 * source directly states "the potential to be contaminated with asbestos",
 * recovered through the canonical evidence-gated chemical-agent extractor
 * (domain/hazard.ts) rather than left null; `null → Cesium-137` is the two
 * radiological shrimp notices. Any other move — including one that would
 * REPLACE a stored agent — is refused, because losing or overwriting a
 * stored agent was never reviewed.
 */
export const ALLOWED_AGENT_TRANSITIONS: readonly (readonly [string | null, string | null])[] = [
  [null, 'asbestos'],
  [null, 'Cesium-137'],
];

/**
 * The reviewed production population: 3 source records. The case count is
 * expected to be 3 as well and is asserted here, but it is SUBJECT TO
 * VERIFICATION by the first production dry run — if the three records turn
 * out to share a case (as one P2e-B pair did), the run reports
 * `needs-review` and refuses rather than guessing, and the constant below is
 * corrected against that reviewed evidence before any apply.
 */
export const APPROVED_RECORD_CORRECTIONS = 3;
export const APPROVED_CASE_CORRECTIONS = 3;

function transitionAllowed(from: string, to: HazardCategory): boolean {
  return ALLOWED_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

function agentTransitionAllowed(from: string | null, to: string | null): boolean {
  return ALLOWED_AGENT_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

export type PopulationVerdict =
  /** Exactly the reviewed population — safe to apply. */
  | 'approved'
  /** Nothing to do: the repair has already been applied (or never applied). */
  | 'settled'
  /** A larger, smaller, or different set — source-review before applying. */
  | 'needs-review';

/**
 * Guard the operational population, so an apply can only ever write the set a
 * human reviewed. Deliberately NOT a list of record ids: category truth comes
 * entirely from the shared evidence rule, and this only checks how many rows
 * the corpus currently yields.
 *
 * An empty set is `settled`, not a failure — that is exactly what the
 * post-apply verification dry run reports, and what a second apply would find.
 */
export function classifyPopulation(records: number, cases: number): PopulationVerdict {
  if (records === 0 && cases === 0) return 'settled';
  if (records === APPROVED_RECORD_CORRECTIONS && cases === APPROVED_CASE_CORRECTIONS) {
    return 'approved';
  }
  return 'needs-review';
}

export type ContaminantRecordOutcome =
  /** Not an FDA announcement in the governed category — never planned. */
  | 'out-of-scope'
  /** Stored values already equal the corrected derivation. */
  | 'unchanged'
  /** An approved category + agent correction — the only writable kind. */
  | 'update'
  /** The category moved along a transition nobody reviewed. */
  | 'refused-transition'
  /** The category move is approved but the agent move is not. */
  | 'refused-agent'
  /** No archived snapshot payload the canonical adapter can read. */
  | 'missing-snapshot'
  /** The archived payload failed the canonical adapter. */
  | 'parse-failed';

export interface ContaminantRecordPlan {
  recordId: string;
  sourceSystem: string;
  nativeId: string;
  recallCaseId: string;
  outcome: ContaminantRecordOutcome;
  /** The archived official reason category, when the snapshot supplies one. */
  archivedCategory: string | null;
  storedHazardCategory: string;
  correctedHazardCategory: string;
  storedPathogenOrAllergen: string | null;
  correctedPathogenOrAllergen: string | null;
  /** Bounded excerpt of the re-parsed official text stating the hazard. */
  evidenceExcerpt: string | null;
  failureReason?: string;
}

export interface ContaminantCasePlan {
  recallCaseId: string;
  sourceAgency: string;
  lifecycle: string;
  active: boolean;
  storedHazardCategory: string;
  storedPathogenOrAllergen: string | null;
  /** `projectCase` over the STORED records — exposes pre-existing drift. */
  recomputedFromStored: { hazardCategory: string; pathogenOrAllergen: string | null };
  /** `projectCase` over the corrected records — the proposed value. */
  correctedHazardCategory: string;
  correctedPathogenOrAllergen: string | null;
  caseWriteNeeded: boolean;
  preexistingProjectionDrift: boolean;
  /** True when more than one source record reaches this case. */
  multiSource: boolean;
  records: ContaminantRecordPlan[];
  recordWrites: ContaminantRecordPlan[];
}

export interface ContaminantRepairReport {
  fdaRecordsExamined: number;
  /** FDA records whose archived category is the governed one. */
  inScopeRecords: number;
  casesExamined: number;
  snapshotCoverage: { present: number; missing: number };
  missingSnapshots: { nativeId: string; recallCaseId: string }[];
  parseFailures: { nativeId: string; reason: string }[];
  /** Normalized rows whose hazard pair would change (writable 'update'). */
  recordWouldChange: number;
  /** Case projections whose hazard pair would change. */
  caseWouldChange: number;
  /** Record-level category "before → after" counts, deterministic key order. */
  transitionCounts: Record<string, number>;
  /** Record-level agent "before → after" counts, deterministic key order. */
  agentTransitionCounts: Record<string, number>;
  /** Refused: the category moved along an unreviewed transition. */
  refusedTransitions: ContaminantRecordPlan[];
  /** Refused: an approved category move with an unreviewed agent move. */
  refusedAgentTransitions: ContaminantRecordPlan[];
  /** Cases whose stored projection already disagrees with stored records. */
  preexistingProjectionDrift: {
    recallCaseId: string;
    stored: { hazardCategory: string; pathogenOrAllergen: string | null };
    recomputed: { hazardCategory: string; pathogenOrAllergen: string | null };
  }[];
  /** Changed cases reached by more than one source record. */
  multiSourceChangedCases: string[];
  /** Every case with any proposed write — the reviewable per-record ledger. */
  ledger: ContaminantCasePlan[];
  affectsMe: {
    activeCasesChanged: number;
    /**
     * Allergen matching is unaffected by construction: this repair never
     * writes the allergen category and never writes an `undeclared …` agent.
     * Counted so the claim is measured, not asserted.
     */
    activeCasesEnteringAllergen: number;
  };
  population: PopulationVerdict;
  /** Why an apply was refused, or null when nothing blocks it. */
  applyBlockedReason: string | null;
  /** Network requests this operation performs. Zero by construction. */
  networkRequests: number;
  sourceRecordWrites: number;
  caseWrites: number;
  /** CAS skips: rows that changed between the plan read and the write. */
  skippedConflicts: { kind: 'record' | 'case'; id: string; nativeId: string | null }[];
  notificationEvents: number;
  newCases: number;
  failures: { recallCaseId: string; reason: string }[];
}

export interface ContaminantRepairOptions {
  apply: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * CLI contract, tested directly: with no flags the command is a dry run, and
 * `--apply` alone is refused — the second deliberate acknowledgment
 * (`--confirm`) must accompany it before a single write is reachable.
 */
export function resolveRepairMode(argv: string[]): { apply: boolean; error: string | null } {
  const wantsApply = argv.includes('--apply');
  const confirmed = argv.includes('--confirm');
  if (wantsApply && !confirmed) {
    return {
      apply: false,
      error:
        '--apply requires the explicit second acknowledgment --confirm ' +
        '(npm run repair:fda-contaminants -- --confirm). Nothing was written.',
    };
  }
  return { apply: wantsApply && confirmed, error: null };
}

/** The archived FDA payload: listing row and/or fetched detail HTML. */
export function asFdaInput(payload: unknown): FdaAnnouncementSource | null {
  if (payload === null || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const listing = (raw.listing ?? null) as FdaListingItem | null;
  const detailMainHtml = typeof raw.detailMainHtml === 'string' ? raw.detailMainHtml : null;
  const path = typeof raw.path === 'string' ? raw.path : (listing?.path ?? null);
  if (path === null || (listing === null && detailMainHtml === null)) return null;
  return {
    listing,
    detailMainHtml,
    path,
    rssTitle: typeof raw.rssTitle === 'string' ? raw.rssTitle : null,
  };
}

/**
 * The archived official reason category, read from the snapshot the record
 * was parsed from — the same field `deriveFdaHazard` keys on. This is how
 * scope is decided: never from a title, product name, source id or native id.
 */
export function archivedCategory(input: FdaAnnouncementSource): string | null {
  const raw = input.listing?.field_recall_reason;
  if (typeof raw !== 'string') return null;
  const category = decodeEntities(raw).trim();
  return category === '' ? null : category;
}

/** Does the archived category place this record inside the governed branch? */
export function inGovernedCategory(category: string | null): boolean {
  return category !== null && new RegExp(TARGET_FDA_CATEGORY, 'i').test(category);
}

/**
 * A short, bounded quote of the official text that states the corrected
 * hazard — review evidence for the ledger, never a full document dump.
 */
export function evidenceExcerpt(
  reparsed: NormalizedSourceRecord,
  agent: string | null,
): string | null {
  const haystack = [reparsed.title, reparsed.reasonText ?? '', reparsed.summaryText]
    .join('\n')
    .replace(/\s+/g, ' ');
  // Anchor on the agent the correction asserts, so the excerpt shows the
  // sentence a reviewer must check. With no agent, anchor on the category's
  // own official vocabulary — the word the source uses for the hazard.
  const anchor = agent ?? 'contaminat';
  const index = haystack.toLowerCase().indexOf(anchor.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - 110);
  const end = Math.min(haystack.length, index + anchor.length + 110);
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end).trim()}${end < haystack.length ? '…' : ''}`;
}

/**
 * Re-derive one record's hazard pair from its archived snapshot. Pure.
 * Everything that is not an FDA announcement in the governed category
 * returns 'out-of-scope' with its stored values echoed back unchanged.
 */
export function planRecord(record: SourceRecordRow, payload: unknown): ContaminantRecordPlan {
  const storedHazardCategory = record.normalized.hazardCategory;
  const storedPathogenOrAllergen = record.normalized.pathogenOrAllergen ?? null;
  const base: ContaminantRecordPlan = {
    recordId: record.id,
    sourceSystem: record.sourceSystem,
    nativeId: record.nativeId,
    recallCaseId: record.recallCaseId,
    outcome: 'out-of-scope',
    archivedCategory: null,
    storedHazardCategory,
    correctedHazardCategory: storedHazardCategory,
    storedPathogenOrAllergen,
    correctedPathogenOrAllergen: storedPathogenOrAllergen,
    evidenceExcerpt: null,
  };

  if (record.sourceSystem !== 'fda_announcement') return base;

  const input = asFdaInput(payload);
  // An FDA record whose snapshot cannot be read is NOT quietly skipped: its
  // category is unknowable, so it could belong to the governed branch. It is
  // reported, and it blocks the apply.
  if (input === null) return { ...base, outcome: 'missing-snapshot' };

  const category = archivedCategory(input);
  if (!inGovernedCategory(category)) return { ...base, archivedCategory: category };

  let reparsed: NormalizedSourceRecord;
  try {
    reparsed = parseFdaAnnouncement(input);
  } catch (error) {
    return {
      ...base,
      archivedCategory: category,
      outcome: 'parse-failed',
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }

  const correctedHazardCategory = reparsed.hazardCategory;
  const correctedPathogenOrAllergen = reparsed.pathogenOrAllergen ?? null;
  const derived: ContaminantRecordPlan = {
    ...base,
    archivedCategory: category,
    correctedHazardCategory,
    correctedPathogenOrAllergen,
    evidenceExcerpt: evidenceExcerpt(reparsed, correctedPathogenOrAllergen),
  };

  const categoryMoved = correctedHazardCategory !== storedHazardCategory;
  const agentMoved = correctedPathogenOrAllergen !== storedPathogenOrAllergen;
  if (!categoryMoved && !agentMoved) return { ...derived, outcome: 'unchanged' };
  // Both refusals keep the DERIVED values in the plan so the ledger shows a
  // reviewer what the parser actually read. They are report-only:
  // `withCorrectedHazard` and the write loop both gate on outcome 'update',
  // so a refused plan can never reach a write payload.
  if (!categoryMoved || !transitionAllowed(storedHazardCategory, correctedHazardCategory)) {
    // Includes the agent-only difference: this repair corrects a category
    // and its agent as ONE fact, so an agent moving alone was never reviewed.
    return { ...derived, outcome: 'refused-transition' };
  }
  if (!agentTransitionAllowed(storedPathogenOrAllergen, correctedPathogenOrAllergen)) {
    return { ...derived, outcome: 'refused-agent' };
  }
  return { ...derived, outcome: 'update' };
}

/** The record as the apply would leave it — the hazard pair, nothing else. */
function withCorrectedHazard(
  record: SourceRecordRow,
  plan: ContaminantRecordPlan,
): NormalizedSourceRecord {
  if (plan.outcome !== 'update') return record.normalized;
  return {
    ...record.normalized,
    hazardCategory: plan.correctedHazardCategory as HazardCategory,
    pathogenOrAllergen: plan.correctedPathogenOrAllergen,
  };
}

function projectedHazard(records: NormalizedSourceRecord[]): {
  hazardCategory: string;
  pathogenOrAllergen: string | null;
} {
  const projection = projectCase(records);
  return {
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen ?? null,
  };
}

/** Plan one case from its records and their snapshot-derived record plans. */
export function planCase(
  recallCase: RecallCaseRow,
  records: SourceRecordRow[],
  recordPlans: ContaminantRecordPlan[],
): ContaminantCasePlan {
  const projection = recallCase.projection;
  const storedHazardCategory = projection.hazardCategory;
  const storedPathogenOrAllergen = projection.pathogenOrAllergen ?? null;
  const recomputedFromStored = projectedHazard(records.map((record) => record.normalized));
  const corrected = projectedHazard(
    records.map((record, index) => withCorrectedHazard(record, recordPlans[index])),
  );
  return {
    recallCaseId: recallCase.id,
    sourceAgency: projection.sourceAgency,
    lifecycle: projection.state,
    active: projection.state === 'active',
    storedHazardCategory,
    storedPathogenOrAllergen,
    recomputedFromStored,
    correctedHazardCategory: corrected.hazardCategory,
    correctedPathogenOrAllergen: corrected.pathogenOrAllergen,
    caseWriteNeeded:
      corrected.hazardCategory !== storedHazardCategory ||
      corrected.pathogenOrAllergen !== storedPathogenOrAllergen,
    preexistingProjectionDrift:
      recomputedFromStored.hazardCategory !== storedHazardCategory ||
      recomputedFromStored.pathogenOrAllergen !== storedPathogenOrAllergen,
    multiSource: records.length > 1,
    records: recordPlans,
    recordWrites: recordPlans.filter((plan) => plan.outcome === 'update'),
  };
}

const tally = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const sortedCounts = (counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));

const show = (value: string | null) => value ?? '(null)';

/**
 * Everything that refuses an apply outright. Returned as a reason string so
 * the CLI can print it and exit for review, or null when nothing blocks.
 */
export function applyBlocker(report: ContaminantRepairReport): string | null {
  if (report.missingSnapshots.length > 0) {
    return `${report.missingSnapshots.length} FDA record(s) have no readable archived snapshot — their official category is unknowable, so they cannot be ruled in or out of scope.`;
  }
  if (report.parseFailures.length > 0) {
    return `${report.parseFailures.length} archived snapshot(s) failed the canonical adapter.`;
  }
  if (report.refusedTransitions.length > 0) {
    return `${report.refusedTransitions.length} record(s) would move along a category transition nobody reviewed.`;
  }
  if (report.refusedAgentTransitions.length > 0) {
    return `${report.refusedAgentTransitions.length} record(s) would move an agent along a transition nobody reviewed.`;
  }
  if (report.failures.length > 0) {
    return `${report.failures.length} case(s) could not be planned.`;
  }
  if (report.population === 'needs-review') {
    return `P3B approved exactly ${APPROVED_RECORD_CORRECTIONS} record and ${APPROVED_CASE_CORRECTIONS} case corrections; this run plans ${report.recordWouldChange} and ${report.caseWouldChange}.`;
  }
  return null;
}

/**
 * Plan the whole governed population from archived snapshots, then — only if
 * nothing blocks and `apply` is set — write the approved fields.
 */
export async function repairFdaContaminants(
  store: RecallStore,
  options: ContaminantRepairOptions,
): Promise<ContaminantRepairReport> {
  const fda = await store.listSourceRecords('fda_announcement');
  const caseRows = new Map((await store.listCases()).map((row) => [row.id, row]));

  const report: ContaminantRepairReport = {
    fdaRecordsExamined: fda.length,
    inScopeRecords: 0,
    casesExamined: 0,
    snapshotCoverage: { present: 0, missing: 0 },
    missingSnapshots: [],
    parseFailures: [],
    recordWouldChange: 0,
    caseWouldChange: 0,
    transitionCounts: {},
    agentTransitionCounts: {},
    refusedTransitions: [],
    refusedAgentTransitions: [],
    preexistingProjectionDrift: [],
    multiSourceChangedCases: [],
    ledger: [],
    affectsMe: { activeCasesChanged: 0, activeCasesEnteringAllergen: 0 },
    population: 'settled',
    applyBlockedReason: null,
    networkRequests: 0,
    sourceRecordWrites: 0,
    caseWrites: 0,
    skippedConflicts: [],
    notificationEvents: 0,
    newCases: 0,
    failures: [],
  };

  // ── Phase 1: plan every FDA record, deciding scope from archived data ─────
  const fdaPlans = new Map<string, ContaminantRecordPlan>();
  const orderedFda = [...fda].sort((a, b) => a.nativeId.localeCompare(b.nativeId));
  let done = 0;
  for (const record of orderedFda) {
    done += 1;
    options.onProgress?.(done, orderedFda.length);
    let payload: unknown = null;
    try {
      payload = await store.getLatestSnapshotPayload(record.id);
    } catch (error) {
      report.failures.push({
        recallCaseId: record.recallCaseId,
        reason: `snapshot read failed for ${record.nativeId}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const plan = planRecord(record, payload);
    fdaPlans.set(record.id, plan);
    if (plan.outcome === 'missing-snapshot') {
      report.snapshotCoverage.missing += 1;
      report.missingSnapshots.push({
        nativeId: plan.nativeId,
        recallCaseId: plan.recallCaseId,
      });
      continue;
    }
    report.snapshotCoverage.present += 1;
    if (plan.outcome === 'out-of-scope') continue;
    report.inScopeRecords += 1;
    if (plan.outcome === 'parse-failed') {
      report.parseFailures.push({
        nativeId: plan.nativeId,
        reason: plan.failureReason ?? 'unknown',
      });
      continue;
    }
    if (plan.outcome === 'refused-transition') {
      report.refusedTransitions.push(plan);
      continue;
    }
    if (plan.outcome === 'refused-agent') {
      report.refusedAgentTransitions.push(plan);
      continue;
    }
    if (plan.outcome !== 'update') continue;
    report.recordWouldChange += 1;
    tally(
      report.transitionCounts,
      `${plan.storedHazardCategory} → ${plan.correctedHazardCategory}`,
    );
    tally(
      report.agentTransitionCounts,
      `${show(plan.storedPathogenOrAllergen)} → ${show(plan.correctedPathogenOrAllergen)}`,
    );
  }

  // ── Phase 2: plan the cases those records reach ──────────────────────────
  // Sibling records (FSIS, enforcement, other FDA announcements) are loaded
  // so `projectCase` sees the whole case, but they are never corrected.
  const touchedCaseIds = [
    ...new Set(
      [...fdaPlans.values()].filter((p) => p.outcome === 'update').map((p) => p.recallCaseId),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const siblings = new Map<string, SourceRecordRow[]>();
  if (touchedCaseIds.length > 0) {
    const wanted = new Set(touchedCaseIds);
    for (const system of ['fsis_api', 'fda_announcement', 'openfda_enforcement'] as const) {
      for (const record of await store.listSourceRecords(system)) {
        if (!wanted.has(record.recallCaseId)) continue;
        siblings.set(record.recallCaseId, [...(siblings.get(record.recallCaseId) ?? []), record]);
      }
    }
  }

  for (const recallCaseId of touchedCaseIds) {
    const recallCase = caseRows.get(recallCaseId);
    if (!recallCase) {
      report.failures.push({ recallCaseId, reason: 'case row not found for its source records' });
      continue;
    }
    const records = (siblings.get(recallCaseId) ?? []).sort((a, b) =>
      a.nativeId.localeCompare(b.nativeId),
    );
    let plan: ContaminantCasePlan;
    try {
      // A sibling with no plan of its own is out of scope by definition and
      // passes through with its stored values.
      plan = planCase(
        recallCase,
        records,
        records.map(
          (record) =>
            fdaPlans.get(record.id) ?? {
              recordId: record.id,
              sourceSystem: record.sourceSystem,
              nativeId: record.nativeId,
              recallCaseId,
              outcome: 'out-of-scope' as const,
              archivedCategory: null,
              storedHazardCategory: record.normalized.hazardCategory,
              correctedHazardCategory: record.normalized.hazardCategory,
              storedPathogenOrAllergen: record.normalized.pathogenOrAllergen ?? null,
              correctedPathogenOrAllergen: record.normalized.pathogenOrAllergen ?? null,
              evidenceExcerpt: null,
            },
        ),
      );
    } catch (error) {
      report.failures.push({
        recallCaseId,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    report.casesExamined += 1;
    report.ledger.push(plan);
    if (plan.preexistingProjectionDrift) {
      report.preexistingProjectionDrift.push({
        recallCaseId,
        stored: {
          hazardCategory: plan.storedHazardCategory,
          pathogenOrAllergen: plan.storedPathogenOrAllergen,
        },
        recomputed: plan.recomputedFromStored,
      });
    }
    if (!plan.caseWriteNeeded) continue;
    report.caseWouldChange += 1;
    if (plan.multiSource) report.multiSourceChangedCases.push(recallCaseId);
    if (plan.active) {
      report.affectsMe.activeCasesChanged += 1;
      if (plan.correctedHazardCategory === 'allergen' && plan.storedHazardCategory !== 'allergen') {
        report.affectsMe.activeCasesEnteringAllergen += 1;
      }
    }
  }

  report.transitionCounts = sortedCounts(report.transitionCounts);
  report.agentTransitionCounts = sortedCounts(report.agentTransitionCounts);
  report.population = classifyPopulation(report.recordWouldChange, report.caseWouldChange);
  report.applyBlockedReason = applyBlocker(report);

  // ── Phase 3: apply, only when the whole reviewed plan is clean ────────────
  if (!options.apply || report.applyBlockedReason !== null) return report;

  for (const plan of report.ledger) {
    for (const recordPlan of plan.recordWrites) {
      const written = await store.updateSourceRecordHazard(
        recordPlan.recordId,
        {
          hazardCategory: recordPlan.correctedHazardCategory as HazardCategory,
          pathogenOrAllergen: recordPlan.correctedPathogenOrAllergen,
        },
        {
          hazardCategory: recordPlan.storedHazardCategory,
          pathogenOrAllergen: recordPlan.storedPathogenOrAllergen,
        },
      );
      if (written) report.sourceRecordWrites += 1;
      else {
        report.skippedConflicts.push({
          kind: 'record',
          id: recordPlan.recordId,
          nativeId: recordPlan.nativeId,
        });
      }
    }
    if (!plan.caseWriteNeeded) continue;
    const recallCase = caseRows.get(plan.recallCaseId)!;
    const written = await store.updateCaseHazard(
      plan.recallCaseId,
      {
        hazardCategory: plan.correctedHazardCategory as HazardCategory,
        pathogenOrAllergen: plan.correctedPathogenOrAllergen,
      },
      recallCase.lastChangedAt,
    );
    if (written) report.caseWrites += 1;
    else report.skippedConflicts.push({ kind: 'case', id: plan.recallCaseId, nativeId: null });
  }

  return report;
}
