/**
 * Historical allergen-agent correction (P2d-B) — an explicit maintenance
 * operation, deliberately outside normal ingestion.
 *
 * Why it is needed: P2d-A taught the one canonical extractor
 * (domain/hazard.ts) the official allergen-evidence constructions FSIS and
 * FDA actually publish, but `normalized.pathogenOrAllergen` and
 * `projection.pathogenOrAllergen` were computed with the old extractor, and
 * the ingest hash gate means an unchanged source page is never re-parsed —
 * by design. Personalization reads the canonical slot, so a stored miss
 * ("null" for the Steak Burrito PHA whose notice plainly names egg) can never
 * match a user's allergen preference until the stored value is corrected.
 *
 * Why it needs no network: every snapshot preserves the raw payload the
 * record was parsed from (architecture Part 12). This repair re-runs the
 * CANONICAL adapters — `parseFsisRecord` / `parseFdaAnnouncement`, the exact
 * functions ingestion uses, never a repair-only re-implementation — over
 * those archived bytes, so a corrected value is byte-identical to what
 * ingestion would produce if the agency page changed today.
 *
 * What it touches: `normalized.pathogenOrAllergen` on source records and
 * `projection.pathogenOrAllergen` on their cases. Nothing else. It never
 * creates a case, never merges or re-links one, never runs material-change
 * detection (`detectChanges` has no hazard rule anyway), never writes a
 * NotificationEvent, never moves a date, and never touches raw snapshots,
 * hashes, timelines, or the notification ledger.
 *
 * Scope guardrails, straight from the P2d-A evidence:
 * - only records whose stored AND re-derived hazard category is `allergen`
 *   are ever written ('update'); a value difference anywhere else is
 *   REPORTED, never applied ('out-of-scope-change');
 * - a re-parse that moves the hazard category itself is refused and reported
 *   ('category-conflict');
 * - a record with no usable archived snapshot is reported and never guessed
 *   ('missing-snapshot').
 *
 * Case-level precedence is delegated to `projectCase`, exactly like the FDA
 * image backfill: the corrected case value is what a legitimate full
 * re-projection of the corrected records would produce, so the projection
 * stays a pure function of its records and the next real re-projection
 * recomputes the same answer instead of erasing this one.
 *
 * Safe to run WHILE scheduled ingestion is running, with no job lease. Every
 * write is compare-and-swap protected: the case write lands only while
 * `last_changed_at` still matches, and the record write lands only while the
 * row still holds the exact value the reviewed dry-run observed. Conflicted
 * rows are SKIPPED and reported — never re-derived on the fly, because the
 * apply must write only what the reviewed dry-run proposed.
 *
 * Idempotent and resumable: every decision is made from current state, so a
 * completed run is a no-op, an interrupted one simply resumes, and the dry
 * run doubles as the post-apply verification report ("would update: 0").
 */

import { classifyAllergenOnly } from '../domain/allergen-only';
import { normalizedAllergenTokens } from '../domain/hazard';
import { projectCase } from '../domain/projection';
import type { HazardCategory } from '../domain/recall-types';
import type { NormalizedSourceRecord } from '../domain/source-record';
import { parseFdaAnnouncement, type FdaAnnouncementSource, type FdaListingItem } from './fda/parse';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';
import type { RecallCaseRow, RecallStore, SourceRecordRow } from './store/types';
import {
  resolveCountGate,
  type CountGateAbort,
  type MutationCommandForm,
} from './repair-authorization';

export type AllergenRecordOutcome =
  /** Stored normalized value already equals the corrected derivation. */
  | 'unchanged'
  /** Allergen-category record whose value differs — the only writable kind. */
  | 'update'
  /** Value differs but the record is not allergen-category; reported only. */
  | 'out-of-scope-change'
  /** Re-parse moved the hazard category itself; refused and reported. */
  | 'category-conflict'
  /** No archived snapshot payload the canonical adapter can read. */
  | 'missing-snapshot'
  /** The archived payload failed the canonical adapter. */
  | 'parse-failed';

export interface AllergenRecordPlan {
  recordId: string;
  sourceSystem: string;
  nativeId: string;
  recallCaseId: string;
  outcome: AllergenRecordOutcome;
  /** `normalized.pathogenOrAllergen` as currently stored. */
  storedValue: string | null;
  /** The canonical re-derivation from the archived snapshot. */
  correctedValue: string | null;
  storedHazardCategory: string;
  correctedHazardCategory: HazardCategory | null;
  /** Bounded excerpt of the re-parsed official text naming the agent. */
  evidenceExcerpt: string | null;
  failureReason?: string;
}

export interface AllergenCasePlan {
  recallCaseId: string;
  sourceAgency: string;
  lifecycle: string;
  active: boolean;
  hazardCategory: string;
  /** `projection.pathogenOrAllergen` as currently stored. */
  currentProjectionValue: string | null;
  /** `projectCase` over the STORED records — exposes pre-existing drift. */
  recomputedFromStored: string | null;
  /** `projectCase` over the corrected records — the proposed value. */
  correctedProjectionValue: string | null;
  caseWriteNeeded: boolean;
  /** Stored projection already disagrees with its own stored records. */
  preexistingProjectionDrift: boolean;
  /** True when more than one source record reaches this case. */
  multiSource: boolean;
  records: AllergenRecordPlan[];
  recordWrites: AllergenRecordPlan[];
  tokensBefore: string[];
  tokensAfter: string[];
  allergenOnlyBefore: string;
  allergenOnlyAfter: string;
}

export interface AllergenRepairReport {
  recordsExamined: number;
  fsisRecords: number;
  fdaRecords: number;
  /** Enforcement rows pass through untouched (their agent is always null). */
  enforcementRecords: number;
  casesExamined: number;
  snapshotCoverage: {
    fsis: { present: number; missing: number };
    fda: { present: number; missing: number };
  };
  missingSnapshots: { sourceSystem: string; nativeId: string; recallCaseId: string }[];
  parseFailures: { sourceSystem: string; nativeId: string; reason: string }[];
  /** Normalized rows whose value would change (writable 'update' only). */
  recordWouldChange: number;
  /** Case projections whose value would change. */
  caseWouldChange: number;
  changesByAgency: {
    fsis: { records: number; cases: number };
    fda: { records: number; cases: number };
  };
  /** Record-level "before → after" counts, deterministic key order. */
  beforeAfter: Record<string, number>;
  /** Canonical family/pathogen tokens across corrected record values. */
  familyCounts: Record<string, number>;
  /** Refused: the re-parse moved the hazard category itself. */
  categoryConflicts: AllergenRecordPlan[];
  /** Refused: a value change on a non-allergen-category record. */
  changesOutsideAllergenCategory: AllergenRecordPlan[];
  /** Subset of the above where the stored category is microbial — gate: 0. */
  pathogenValueChanges: AllergenRecordPlan[];
  /** Cases whose stored projection already disagrees with stored records. */
  preexistingProjectionDrift: {
    recallCaseId: string;
    stored: string | null;
    recomputed: string | null;
  }[];
  /** Changed cases reached by more than one source record. */
  multiSourceChangedCases: string[];
  /** Every case with any proposed write — the reviewable per-record ledger. */
  ledger: AllergenCasePlan[];
  /**
   * The number an operator authorizes with `--expect <n>`: cases carrying any
   * proposed write. It is `ledger.length`, named so the CLI, the report and
   * the gate cannot drift apart.
   */
  plannedChanges: number;
  /** Set when the live corpus is not what was authorized. Zero writes follow. */
  aborted: CountGateAbort | null;
  affectsMe: {
    activeCasesChanged: number;
    /** Canonical allergen tokens active changed cases gain, tallied. */
    tokensGained: Record<string, number>;
    /** Active allergen-only cases moving unidentified → identified. */
    unidentifiedToIdentified: number;
  };
  /** Network requests this operation performs. Zero by construction. */
  networkRequests: number;
  sourceRecordWrites: number;
  caseWrites: number;
  /** CAS skips: rows that changed between the dry-run read and the write. */
  skippedConflicts: { kind: 'record' | 'case'; id: string; nativeId: string | null }[];
  notificationEvents: number;
  newCases: number;
  failures: { recallCaseId: string; reason: string }[];
}

export interface AllergenRepairOptions {
  apply: boolean;
  /**
   * The reviewed `--expect <n>`. Required for an apply (the CLI refuses
   * before this is reached without it) and optional for a dry run, which
   * reports a mismatch so the count can be rehearsed.
   */
  expectedUpdates: number | null;
  onProgress?: (done: number, total: number) => void;
}

/**
 * The command form this repair prints everywhere — CLI help, refusals, the
 * dry-run closing line, the README and the runbook all render from this one
 * value, so they cannot disagree about what an operator must type.
 */
export const ALLERGEN_REPAIR_COMMAND: MutationCommandForm = { script: 'repair:allergens' };

/** The archived FSIS payload is the raw API record itself. */
function asFsisInput(payload: unknown): FsisRawRecord | null {
  if (payload === null || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  return typeof raw.field_recall_number === 'string' ? (payload as FsisRawRecord) : null;
}

/** The archived FDA payload: listing row and/or fetched detail HTML. */
function asFdaInput(payload: unknown): FdaAnnouncementSource | null {
  if (payload === null || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const listing = (raw.listing ?? null) as FdaListingItem | null;
  const detailMainHtml = typeof raw.detailMainHtml === 'string' ? raw.detailMainHtml : null;
  const path = typeof raw.path === 'string' ? raw.path : (listing?.path ?? null);
  // Unlike the image backfill, the listing alone is usable: the hazard is
  // derived from the listing's category and reason description plus whatever
  // text the snapshot preserved.
  if (path === null || (listing === null && detailMainHtml === null)) return null;
  return {
    listing,
    detailMainHtml,
    path,
    rssTitle: typeof raw.rssTitle === 'string' ? raw.rssTitle : null,
  };
}

/**
 * A short, bounded quote of the official text around the extracted agent —
 * review evidence for the ledger, never a full document dump.
 */
export function evidenceExcerpt(
  reparsed: NormalizedSourceRecord,
  correctedValue: string | null,
): string | null {
  if (correctedValue === null) return null;
  const haystack = [reparsed.title, reparsed.reasonText ?? '', reparsed.summaryText]
    .join('\n')
    .replace(/\s+/g, ' ');
  const firstAgent = correctedValue
    .replace(/^undeclared\s+/i, '')
    .split(/,|\band\b/i)[0]
    .trim();
  if (firstAgent === '') return null;
  const index = haystack.toLowerCase().indexOf(firstAgent.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - 90);
  const end = Math.min(haystack.length, index + firstAgent.length + 90);
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end).trim()}${end < haystack.length ? '…' : ''}`;
}

/** Re-derive one record's agent from its archived snapshot. Pure given the payload. */
export function planRecord(record: SourceRecordRow, payload: unknown): AllergenRecordPlan {
  const storedValue = record.normalized.pathogenOrAllergen ?? null;
  const base: AllergenRecordPlan = {
    recordId: record.id,
    sourceSystem: record.sourceSystem,
    nativeId: record.nativeId,
    recallCaseId: record.recallCaseId,
    outcome: 'missing-snapshot',
    storedValue,
    correctedValue: storedValue,
    storedHazardCategory: record.normalized.hazardCategory,
    correctedHazardCategory: null,
    evidenceExcerpt: null,
  };

  let reparsed: NormalizedSourceRecord;
  try {
    if (record.sourceSystem === 'fsis_api') {
      const input = asFsisInput(payload);
      if (input === null) return base;
      reparsed = parseFsisRecord(input);
    } else if (record.sourceSystem === 'fda_announcement') {
      const input = asFdaInput(payload);
      if (input === null) return base;
      reparsed = parseFdaAnnouncement(input);
    } else {
      return base; // enforcement rows carry no re-parseable notice payload
    }
  } catch (error) {
    return {
      ...base,
      outcome: 'parse-failed',
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }

  const correctedValue = reparsed.pathogenOrAllergen ?? null;
  const withDerivation = {
    ...base,
    correctedValue,
    correctedHazardCategory: reparsed.hazardCategory,
    evidenceExcerpt: evidenceExcerpt(reparsed, correctedValue),
  };
  if (reparsed.hazardCategory !== record.normalized.hazardCategory) {
    // The repair's write set is the agent alone; a category move means this
    // record needs human review, not a partial write.
    return { ...withDerivation, outcome: 'category-conflict', correctedValue: storedValue };
  }
  if (correctedValue === storedValue) return { ...withDerivation, outcome: 'unchanged' };
  if (record.normalized.hazardCategory !== 'allergen') {
    return { ...withDerivation, outcome: 'out-of-scope-change' };
  }
  return { ...withDerivation, outcome: 'update' };
}

/** The record as the apply would leave it — one field, nothing else. */
function withCorrectedAgent(
  record: SourceRecordRow,
  plan: AllergenRecordPlan,
): NormalizedSourceRecord {
  if (plan.outcome !== 'update') return record.normalized;
  return { ...record.normalized, pathogenOrAllergen: plan.correctedValue };
}

function projectedAgent(records: NormalizedSourceRecord[]): string | null {
  return projectCase(records).pathogenOrAllergen ?? null;
}

/** Plan one case from its records and their snapshot-derived record plans. */
export function planCase(
  recallCase: RecallCaseRow,
  records: SourceRecordRow[],
  recordPlans: AllergenRecordPlan[],
): AllergenCasePlan {
  const projection = recallCase.projection;
  const currentProjectionValue = projection.pathogenOrAllergen ?? null;
  const recomputedFromStored = projectedAgent(records.map((record) => record.normalized));
  const correctedProjectionValue = projectedAgent(
    records.map((record, index) => withCorrectedAgent(record, recordPlans[index])),
  );
  const verdict = (value: string | null) =>
    classifyAllergenOnly({
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: value,
      reasonText: projection.reasonText,
    }).kind;
  return {
    recallCaseId: recallCase.id,
    sourceAgency: projection.sourceAgency,
    lifecycle: projection.state,
    active: projection.state === 'active',
    hazardCategory: projection.hazardCategory,
    currentProjectionValue,
    recomputedFromStored,
    correctedProjectionValue,
    caseWriteNeeded: correctedProjectionValue !== currentProjectionValue,
    preexistingProjectionDrift: recomputedFromStored !== currentProjectionValue,
    multiSource: records.length > 1,
    records: recordPlans,
    recordWrites: recordPlans.filter((plan) => plan.outcome === 'update'),
    tokensBefore: normalizedAllergenTokens(currentProjectionValue),
    tokensAfter: normalizedAllergenTokens(correctedProjectionValue),
    allergenOnlyBefore: verdict(currentProjectionValue),
    allergenOnlyAfter: verdict(correctedProjectionValue),
  };
}

const tally = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const sortedCounts = (counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Visit every stored notice record, re-derive its hazard agent from archived
 * official snapshots, and (in apply mode) write only the two allowed fields.
 */
export async function repairAllergens(
  store: RecallStore,
  options: AllergenRepairOptions,
): Promise<AllergenRepairReport> {
  const fsis = await store.listSourceRecords('fsis_api');
  const fda = await store.listSourceRecords('fda_announcement');
  const enforcement = await store.listSourceRecords('openfda_enforcement');
  const caseRows = new Map((await store.listCases()).map((row) => [row.id, row]));

  const byCase = new Map<string, SourceRecordRow[]>();
  for (const record of [...fsis, ...fda, ...enforcement]) {
    byCase.set(record.recallCaseId, [...(byCase.get(record.recallCaseId) ?? []), record]);
  }
  // Deterministic order, so two dry runs over the same data print one report.
  const orderedCases = [...byCase.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [, records] of orderedCases) {
    records.sort((a, b) => a.nativeId.localeCompare(b.nativeId));
  }

  const report: AllergenRepairReport = {
    recordsExamined: 0,
    fsisRecords: fsis.length,
    fdaRecords: fda.length,
    enforcementRecords: enforcement.length,
    casesExamined: 0,
    snapshotCoverage: {
      fsis: { present: 0, missing: 0 },
      fda: { present: 0, missing: 0 },
    },
    missingSnapshots: [],
    parseFailures: [],
    recordWouldChange: 0,
    caseWouldChange: 0,
    changesByAgency: { fsis: { records: 0, cases: 0 }, fda: { records: 0, cases: 0 } },
    beforeAfter: {},
    familyCounts: {},
    categoryConflicts: [],
    changesOutsideAllergenCategory: [],
    pathogenValueChanges: [],
    preexistingProjectionDrift: [],
    multiSourceChangedCases: [],
    ledger: [],
    plannedChanges: 0,
    aborted: null,
    affectsMe: { activeCasesChanged: 0, tokensGained: {}, unidentifiedToIdentified: 0 },
    networkRequests: 0,
    sourceRecordWrites: 0,
    caseWrites: 0,
    skippedConflicts: [],
    notificationEvents: 0,
    newCases: 0,
    failures: [],
  };

  let done = 0;
  for (const [recallCaseId, records] of orderedCases) {
    done += 1;
    options.onProgress?.(done, orderedCases.length);

    const recallCase = caseRows.get(recallCaseId);
    if (!recallCase) {
      report.failures.push({ recallCaseId, reason: 'case row not found for its source records' });
      continue;
    }

    let plan: AllergenCasePlan;
    const recordPlans: AllergenRecordPlan[] = [];
    try {
      for (const record of records) {
        const isNotice =
          record.sourceSystem === 'fsis_api' || record.sourceSystem === 'fda_announcement';
        const payload = isNotice ? await store.getLatestSnapshotPayload(record.id) : null;
        recordPlans.push(planRecord(record, payload));
      }
      plan = planCase(recallCase, records, recordPlans);
    } catch (error) {
      report.failures.push({
        recallCaseId,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    report.casesExamined += 1;
    for (const recordPlan of recordPlans) {
      const agency =
        recordPlan.sourceSystem === 'fsis_api'
          ? 'fsis'
          : recordPlan.sourceSystem === 'fda_announcement'
            ? 'fda'
            : null;
      if (agency === null) continue; // enforcement pass-through
      report.recordsExamined += 1;
      const coverage = report.snapshotCoverage[agency];
      if (recordPlan.outcome === 'missing-snapshot') {
        coverage.missing += 1;
        report.missingSnapshots.push({
          sourceSystem: recordPlan.sourceSystem,
          nativeId: recordPlan.nativeId,
          recallCaseId,
        });
        continue;
      }
      coverage.present += 1;
      if (recordPlan.outcome === 'parse-failed') {
        report.parseFailures.push({
          sourceSystem: recordPlan.sourceSystem,
          nativeId: recordPlan.nativeId,
          reason: recordPlan.failureReason ?? 'unknown',
        });
        continue;
      }
      if (recordPlan.outcome === 'category-conflict') {
        report.categoryConflicts.push(recordPlan);
        continue;
      }
      if (recordPlan.outcome === 'out-of-scope-change') {
        report.changesOutsideAllergenCategory.push(recordPlan);
        if (recordPlan.storedHazardCategory === 'microbial_contamination') {
          report.pathogenValueChanges.push(recordPlan);
        }
        continue;
      }
      if (recordPlan.outcome !== 'update') continue;
      report.recordWouldChange += 1;
      report.changesByAgency[agency].records += 1;
      tally(
        report.beforeAfter,
        `${recordPlan.storedValue ?? '(null)'} → ${recordPlan.correctedValue ?? '(null)'}`,
      );
      const tokens = normalizedAllergenTokens(recordPlan.correctedValue);
      if (tokens.length === 0 && recordPlan.correctedValue !== null) {
        tally(report.familyCounts, `(verbatim) ${recordPlan.correctedValue}`);
      }
      for (const token of tokens) tally(report.familyCounts, token);
    }

    if (plan.preexistingProjectionDrift) {
      report.preexistingProjectionDrift.push({
        recallCaseId,
        stored: plan.currentProjectionValue,
        recomputed: plan.recomputedFromStored,
      });
    }

    if (!plan.caseWriteNeeded && plan.recordWrites.length === 0) continue;

    report.ledger.push(plan);
    if (plan.caseWriteNeeded) {
      report.caseWouldChange += 1;
      report.changesByAgency[plan.sourceAgency === 'FDA' ? 'fda' : 'fsis'].cases += 1;
      if (plan.multiSource) report.multiSourceChangedCases.push(recallCaseId);
      if (plan.active) {
        report.affectsMe.activeCasesChanged += 1;
        for (const token of plan.tokensAfter) {
          if (!plan.tokensBefore.includes(token)) tally(report.affectsMe.tokensGained, token);
        }
        if (plan.allergenOnlyBefore === 'unidentified' && plan.allergenOnlyAfter === 'identified') {
          report.affectsMe.unidentifiedToIdentified += 1;
        }
      }
    }
  }

  // ── PLANNING IS COMPLETE. The whole corpus has been examined and not one
  // row has been written yet, so the count below is the count the operator
  // authorized against — and a corpus that moved since the reviewed dry run
  // costs zero writes rather than a partial, unreviewed one.
  report.plannedChanges = report.ledger.length;
  report.aborted = resolveCountGate(options, report.plannedChanges);
  if (report.aborted !== null || !options.apply) {
    report.beforeAfter = sortedCounts(report.beforeAfter);
    report.familyCounts = sortedCounts(report.familyCounts);
    report.affectsMe.tokensGained = sortedCounts(report.affectsMe.tokensGained);
    return report;
  }

  // ── WRITE PHASE. Exactly the writes the reviewed plan proposed, each still
  // guarded on the value/version it was planned from, in the same order and
  // with the same two-field scope as before this gate existed.
  for (const plan of report.ledger) {
    for (const recordPlan of plan.recordWrites) {
      const written = await store.updateSourceRecordPathogenOrAllergen(
        recordPlan.recordId,
        recordPlan.correctedValue,
        recordPlan.storedValue,
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
    if (plan.caseWriteNeeded) {
      const recallCase = caseRows.get(plan.recallCaseId)!;
      const written = await store.updateCasePathogenOrAllergen(
        plan.recallCaseId,
        plan.correctedProjectionValue,
        recallCase.lastChangedAt,
      );
      if (written) report.caseWrites += 1;
      else report.skippedConflicts.push({ kind: 'case', id: plan.recallCaseId, nativeId: null });
    }
  }

  report.beforeAfter = sortedCounts(report.beforeAfter);
  report.familyCounts = sortedCounts(report.familyCounts);
  report.affectsMe.tokensGained = sortedCounts(report.affectsMe.tokensGained);
  return report;
}
