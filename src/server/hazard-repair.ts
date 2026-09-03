/**
 * Historical hazard-category correction (P2e-B) — an explicit maintenance
 * operation, deliberately outside normal ingestion.
 *
 * Why it is needed: P2e-A audited every record whose stored hazard category
 * disagreed with its official notice and found two shared causes, both now
 * fixed in the canonical parser (server/fsis/parse.ts `deriveHazardCategory`,
 * on the shared evidence owners in domain/hazard.ts):
 *
 *  - FSIS UNDER-REPORTS ALLERGENS IN ITS STRUCTURED REASON. 21 notices whose
 *    body plainly states "contains X, a known allergen, which is not declared
 *    on the product label" carry only "Misbranding"/"Mislabeling", an empty
 *    reason array, or (once) "Product Contamination" over packaging prose.
 *    They were filed as regulatory, unknown, or foreign material — so nothing
 *    could match a user's allergen preference, and one read as "Potential
 *    plastic contamination." because its salad came in plastic bowls.
 *  - ONE RECORD PREDATES ITS PATHOGEN. PHA-07302018-1 was ingested before
 *    Cyclospora entered the canonical pathogen list, and the ingest hash gate
 *    means an unchanged source page is never re-parsed — by design.
 *
 * A production dry run against the corrected parser then surfaced a THIRD,
 * unaudited class: 27 further "Product Contamination" records where the old
 * bare-keyword foreign-material scan and the new evidence-gated extractor
 * disagree with no allergen involved at all — 20 notices stating the hazard
 * only in its generic form ("Due to Possible Foreign Matter Contamination",
 * no material word the old scan could match) and 7 where a packaging word
 * (plastic bowls, glass jars, …) was the old scan's only match, with no
 * contamination construction anywhere in the text. The founder approved
 * these in principle against the same evidence rule already governing
 * 115-2017, so the scope below now covers 49 records / 48 cases, not 22/22.
 *
 * Why it needs no network: every snapshot preserves the raw payload the
 * record was parsed from (architecture Part 12). This repair re-runs the
 * CANONICAL adapters — `parseFsisRecord` / `parseFdaAnnouncement`, the exact
 * functions ingestion uses, never a repair-only re-implementation — over
 * those archived bytes, so a corrected value is byte-identical to what
 * ingestion would produce if the agency page changed today.
 *
 * What it touches: `normalized.hazardCategory` and
 * `normalized.pathogenOrAllergen` on source records, and the same pair inside
 * `projection` on their cases. Nothing else. It never creates a case, never
 * merges or re-links one, never runs the pipeline or material-change
 * detection, never writes a NotificationEvent, never moves a date, and never
 * touches raw snapshots, hashes, timelines, or the notification ledger. The
 * generated `recall_cases.hazard_category` column follows the projection JSON
 * on its own and is never written directly.
 *
 * Scope guardrails, straight from the P2e-A evidence:
 * - a record is writable only when its category moves along an APPROVED
 *   transition (`ALLOWED_TRANSITIONS`); every other move is REPORTED, never
 *   applied ('refused-transition');
 * - an agent-only change on a record whose category is unchanged and is not
 *   allergen is refused ('refused-agent-only') — this is what keeps 083-2016,
 *   whose `other_regulatory` category is correct and whose stored
 *   "undeclared wheat" is truthful though incomplete, byte-identical;
 * - a record with no usable archived snapshot is reported and never guessed
 *   ('missing-snapshot').
 *
 * Case-level precedence is delegated to `projectCase`, exactly like the P2d-B
 * allergen repair: the corrected case value is what a legitimate full
 * re-projection of the corrected records would produce, so the projection
 * stays a pure function of its records and the next real re-projection
 * recomputes the same answer instead of erasing this one.
 *
 * Safe to run WHILE scheduled ingestion is running, with no job lease. Every
 * write is compare-and-swap protected: the case write lands only while
 * `last_changed_at` still matches, and the record write only while the row
 * still holds both values the reviewed dry run observed. Conflicted rows are
 * SKIPPED and reported — never re-derived on the fly, because the apply must
 * write only what the reviewed dry run proposed.
 *
 * Idempotent and resumable: every decision is made from current state, so a
 * completed run is a no-op, an interrupted one simply resumes, and the dry
 * run doubles as the post-apply verification report ("would change: 0").
 */

import { projectCase } from '../domain/projection';
import type { HazardCategory } from '../domain/recall-types';
import type { NormalizedSourceRecord } from '../domain/source-record';
import { parseFdaAnnouncement, type FdaAnnouncementSource, type FdaListingItem } from './fda/parse';
import { parseFsisRecord, type FsisRawRecord } from './fsis/parse';
import type { RecallCaseRow, RecallStore, SourceRecordRow } from './store/types';

/**
 * The category corrections P2e-A source-reviewed and the founder approved.
 * A transition absent from this table is refused and reported, whatever the
 * evidence says — the parser decides truth, but only a reviewed transition
 * may be written to historical data.
 */
export const ALLOWED_TRANSITIONS: readonly (readonly [string, HazardCategory])[] = [
  ['other_regulatory', 'allergen'],
  ['unknown', 'allergen'],
  // Only ever reached through the approved evidence rule: allergen evidence
  // with no pathogen, no chemical agent and no genuine foreign-material
  // contamination evidence (115-2017, whose "plastic" was its packaging).
  ['foreign_material', 'allergen'],
  ['unknown', 'microbial_contamination'],
  // P2e-B (expanded scope): the production dry run surfaced 27 further
  // FSIS "Product Contamination" records where the bare-keyword predecessor
  // and the evidence-gated extractor disagree in the OTHER direction — no
  // allergen involved at all. 20 state the hazard only in its generic form
  // ("Due to Possible Foreign Matter Contamination") with no material word
  // the old scan could match; 7 had a packaging word (plastic bowls, glass
  // jars, …) with no contamination construction, a false positive the old
  // scan could not tell from the real thing.
  ['unknown', 'foreign_material'],
  ['foreign_material', 'unknown'],
];

function transitionAllowed(from: string, to: HazardCategory): boolean {
  return ALLOWED_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

/**
 * What the founder has source-reviewed and approved: 22 allergen/pathogen
 * corrections (P2e-A) plus 27 further foreign-material corrections
 * discovered by the first production dry run and approved in principle
 * against the same evidence rule (P2e-B expanded scope) — 49 records in
 * total. The case count is 48, not 49: one case (007-2020 / 007-2020-EXP)
 * carries two of the 27 records, both moving `unknown -> foreign_material`
 * together, so it is one case correction, not two. Verified directly from
 * the saved production ledger (`.reports/p2e-b-dry-run.json`, 2026-09-02) —
 * every other corrected case is single-source.
 */
export const APPROVED_RECORD_CORRECTIONS = 49;
export const APPROVED_CASE_CORRECTIONS = 48;

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
 * entirely from the shared evidence rules, and this only checks how many of
 * them the corpus currently yields.
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

export type HazardRecordOutcome =
  /** Stored values already equal the corrected derivation. */
  | 'unchanged'
  /** An approved category transition — the only writable kind. */
  | 'update'
  /** The category moved along a transition nobody reviewed. */
  | 'refused-transition'
  /** Only the agent moved, on a record whose category is not allergen. */
  | 'refused-agent-only'
  /** No archived snapshot payload the canonical adapter can read. */
  | 'missing-snapshot'
  /** The archived payload failed the canonical adapter. */
  | 'parse-failed';

export interface HazardRecordPlan {
  recordId: string;
  sourceSystem: string;
  nativeId: string;
  recallCaseId: string;
  outcome: HazardRecordOutcome;
  storedHazardCategory: string;
  correctedHazardCategory: string;
  storedPathogenOrAllergen: string | null;
  correctedPathogenOrAllergen: string | null;
  /** Bounded excerpt of the re-parsed official text stating the hazard. */
  evidenceExcerpt: string | null;
  failureReason?: string;
}

export interface HazardCasePlan {
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
  records: HazardRecordPlan[];
  recordWrites: HazardRecordPlan[];
}

export interface HazardRepairReport {
  recordsExamined: number;
  fsisRecords: number;
  fdaRecords: number;
  /** Enforcement rows pass through untouched (they carry no notice text). */
  enforcementRecords: number;
  casesExamined: number;
  snapshotCoverage: {
    fsis: { present: number; missing: number };
    fda: { present: number; missing: number };
  };
  missingSnapshots: { sourceSystem: string; nativeId: string; recallCaseId: string }[];
  parseFailures: { sourceSystem: string; nativeId: string; reason: string }[];
  /** Normalized rows whose hazard pair would change (writable 'update'). */
  recordWouldChange: number;
  /** Case projections whose hazard pair would change. */
  caseWouldChange: number;
  changesByAgency: {
    fsis: { records: number; cases: number };
    fda: { records: number; cases: number };
  };
  /** Record-level category "before → after" counts, deterministic key order. */
  transitionCounts: Record<string, number>;
  /** Refused: the category moved along an unreviewed transition. */
  refusedTransitions: HazardRecordPlan[];
  /** Refused: agent-only drift on a record whose category is not allergen. */
  refusedAgentOnly: HazardRecordPlan[];
  /** Cases whose stored projection already disagrees with stored records. */
  preexistingProjectionDrift: {
    recallCaseId: string;
    stored: { hazardCategory: string; pathogenOrAllergen: string | null };
    recomputed: { hazardCategory: string; pathogenOrAllergen: string | null };
  }[];
  /** Changed cases reached by more than one source record. */
  multiSourceChangedCases: string[];
  /** Every case with any proposed write — the reviewable per-record ledger. */
  ledger: HazardCasePlan[];
  affectsMe: {
    activeCasesChanged: number;
    /** Active cases entering the allergen category (newly preference-eligible). */
    activeCasesEnteringAllergen: number;
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

export interface HazardRepairOptions {
  apply: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * CLI contract, tested directly: with no flags the command is a dry run, and
 * `--apply` alone is refused — the second deliberate acknowledgment
 * (`--confirm`) must accompany it before a single write is reachable.
 */
export function resolveRepairMode(argv: string[]): {
  apply: boolean;
  error: string | null;
} {
  const wantsApply = argv.includes('--apply');
  const confirmed = argv.includes('--confirm');
  if (wantsApply && !confirmed) {
    return {
      apply: false,
      error:
        '--apply requires the explicit second acknowledgment --confirm ' +
        '(npm run repair:hazards -- --confirm). Nothing was written.',
    };
  }
  return { apply: wantsApply && confirmed, error: null };
}

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
  if (path === null || (listing === null && detailMainHtml === null)) return null;
  return {
    listing,
    detailMainHtml,
    path,
    rssTitle: typeof raw.rssTitle === 'string' ? raw.rssTitle : null,
  };
}

/**
 * A short, bounded quote of the official text that states the corrected
 * hazard — review evidence for the ledger, never a full document dump.
 */
export function evidenceExcerpt(
  reparsed: NormalizedSourceRecord,
  category: HazardCategory,
  agent: string | null,
): string | null {
  const haystack = [reparsed.title, reparsed.reasonText ?? '', reparsed.summaryText]
    .join('\n')
    .replace(/\s+/g, ' ');
  // Anchor on the agent the correction asserts, so the excerpt shows the
  // sentence a reviewer must check. With no agent, anchor on the category's
  // own official vocabulary.
  const anchor =
    agent !== null
      ? agent
          .replace(/^undeclared\s+/i, '')
          .split(/,|\band\b/i)[0]
          .trim()
      : category === 'foreign_material'
        ? 'foreign'
        : null;
  if (anchor === null || anchor === '') return null;
  const index = haystack.toLowerCase().indexOf(anchor.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - 90);
  const end = Math.min(haystack.length, index + anchor.length + 90);
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end).trim()}${end < haystack.length ? '…' : ''}`;
}

/** Re-derive one record's hazard pair from its archived snapshot. Pure. */
export function planRecord(record: SourceRecordRow, payload: unknown): HazardRecordPlan {
  const storedHazardCategory = record.normalized.hazardCategory;
  const storedPathogenOrAllergen = record.normalized.pathogenOrAllergen ?? null;
  const base: HazardRecordPlan = {
    recordId: record.id,
    sourceSystem: record.sourceSystem,
    nativeId: record.nativeId,
    recallCaseId: record.recallCaseId,
    outcome: 'missing-snapshot',
    storedHazardCategory,
    correctedHazardCategory: storedHazardCategory,
    storedPathogenOrAllergen,
    correctedPathogenOrAllergen: storedPathogenOrAllergen,
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

  const correctedHazardCategory = reparsed.hazardCategory;
  const correctedPathogenOrAllergen = reparsed.pathogenOrAllergen ?? null;
  const derived: HazardRecordPlan = {
    ...base,
    correctedHazardCategory,
    correctedPathogenOrAllergen,
    evidenceExcerpt: evidenceExcerpt(
      reparsed,
      correctedHazardCategory,
      correctedPathogenOrAllergen,
    ),
  };

  const categoryMoved = correctedHazardCategory !== storedHazardCategory;
  const agentMoved = correctedPathogenOrAllergen !== storedPathogenOrAllergen;
  if (!categoryMoved && !agentMoved) return { ...derived, outcome: 'unchanged' };
  if (!categoryMoved) {
    // An agent-only difference. Inside the allergen category that is P2d-B's
    // settled business and already applied, so anything left here is drift a
    // human must look at — never a silent write from this repair.
    return {
      ...derived,
      outcome: 'refused-agent-only',
      correctedHazardCategory: storedHazardCategory,
      correctedPathogenOrAllergen: storedPathogenOrAllergen,
    };
  }
  if (!transitionAllowed(storedHazardCategory, correctedHazardCategory)) {
    return {
      ...derived,
      outcome: 'refused-transition',
      correctedPathogenOrAllergen: storedPathogenOrAllergen,
    };
  }
  return { ...derived, outcome: 'update' };
}

/** The record as the apply would leave it — the hazard pair, nothing else. */
function withCorrectedHazard(
  record: SourceRecordRow,
  plan: HazardRecordPlan,
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
  recordPlans: HazardRecordPlan[],
): HazardCasePlan {
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

/**
 * Visit every stored notice record, re-derive its hazard pair from archived
 * official snapshots, and (in apply mode) write only the approved fields.
 */
export async function repairHazards(
  store: RecallStore,
  options: HazardRepairOptions,
): Promise<HazardRepairReport> {
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

  const report: HazardRepairReport = {
    recordsExamined: 0,
    fsisRecords: fsis.length,
    fdaRecords: fda.length,
    enforcementRecords: enforcement.length,
    casesExamined: 0,
    snapshotCoverage: { fsis: { present: 0, missing: 0 }, fda: { present: 0, missing: 0 } },
    missingSnapshots: [],
    parseFailures: [],
    recordWouldChange: 0,
    caseWouldChange: 0,
    changesByAgency: { fsis: { records: 0, cases: 0 }, fda: { records: 0, cases: 0 } },
    transitionCounts: {},
    refusedTransitions: [],
    refusedAgentOnly: [],
    preexistingProjectionDrift: [],
    multiSourceChangedCases: [],
    ledger: [],
    affectsMe: { activeCasesChanged: 0, activeCasesEnteringAllergen: 0 },
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

    let plan: HazardCasePlan;
    const recordPlans: HazardRecordPlan[] = [];
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
      if (recordPlan.outcome === 'refused-transition') {
        report.refusedTransitions.push(recordPlan);
        continue;
      }
      if (recordPlan.outcome === 'refused-agent-only') {
        report.refusedAgentOnly.push(recordPlan);
        continue;
      }
      if (recordPlan.outcome !== 'update') continue;
      report.recordWouldChange += 1;
      report.changesByAgency[agency].records += 1;
      tally(
        report.transitionCounts,
        `${recordPlan.storedHazardCategory} → ${recordPlan.correctedHazardCategory}`,
      );
    }

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

    if (!plan.caseWriteNeeded && plan.recordWrites.length === 0) continue;

    report.ledger.push(plan);
    if (plan.caseWriteNeeded) {
      report.caseWouldChange += 1;
      report.changesByAgency[plan.sourceAgency === 'FDA' ? 'fda' : 'fsis'].cases += 1;
      if (plan.multiSource) report.multiSourceChangedCases.push(recallCaseId);
      if (plan.active) {
        report.affectsMe.activeCasesChanged += 1;
        if (
          plan.correctedHazardCategory === 'allergen' &&
          plan.storedHazardCategory !== 'allergen'
        ) {
          report.affectsMe.activeCasesEnteringAllergen += 1;
        }
      }
    }

    if (!options.apply) continue;

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
    if (plan.caseWriteNeeded) {
      const written = await store.updateCaseHazard(
        recallCaseId,
        {
          hazardCategory: plan.correctedHazardCategory as HazardCategory,
          pathogenOrAllergen: plan.correctedPathogenOrAllergen,
        },
        recallCase.lastChangedAt,
      );
      if (written) report.caseWrites += 1;
      else report.skippedConflicts.push({ kind: 'case', id: recallCaseId, nativeId: null });
    }
  }

  report.transitionCounts = sortedCounts(report.transitionCounts);
  return report;
}
