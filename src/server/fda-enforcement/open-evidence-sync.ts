/**
 * The open-evidence sync (2026-10-06): the ONE writer of
 * `recall_cases.fda_ongoing_as_of`, shared by the scheduled enforcement job
 * (after reconciliation) and the manual CLI (`npm run open-evidence:sync`).
 *
 *   validate the export → read cases + persisted links → plan → apply
 *
 * What a write touches: that one column, on that one row, compare-and-set on
 * the value the plan read. Never `projection`, `timeline`, `last_changed_at`,
 * affected products, source records, snapshots or the notification ledger —
 * so a status change cannot re-date a recall, move it in a newest-first feed,
 * or send a push. The manifest token moves (the column is part of it), so
 * devices re-download exactly the changed rows.
 *
 * Failure behavior: an incomplete export writes nothing; a failed write stops
 * the run and reports how far it got. Every planned value is a pure function
 * of the export and the links, so the next complete run converges.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { retryTransientRead } from '../transient-retry';
import {
  planClearOpenEvidence,
  planOpenEvidence,
  validateExportCompleteness,
  type EnforcementLink,
  type OpenEvidenceCase,
  type OpenEvidenceStats,
  type OpenEvidenceWrite,
} from './open-evidence';
import { parseEnforcementRecord, type OpenFdaEnforcementRaw } from './parse';

/** The three operations the sync needs — deliberately not part of RecallStore. */
export interface OpenEvidenceStore {
  /**
   * Every FDA case with its stored value. `columnPresent` is false when the
   * column does not exist yet (before the migration): values then read null
   * and the sync refuses to apply.
   */
  listFdaCases(): Promise<{ cases: OpenEvidenceCase[]; columnPresent: boolean }>;
  /** Every persisted `openfda_enforcement` link (recall number → owning case). */
  listEnforcementLinks(): Promise<EnforcementLink[]>;
  /**
   * Set one case's value, compare-and-set on `before`. Returns false when the
   * stored value was no longer `before` (a concurrent writer) — nothing written.
   */
  setFdaOngoingAsOf(caseId: string, before: string | null, after: string | null): Promise<boolean>;
}

export interface OpenEvidenceCorpus {
  records: readonly OpenFdaEnforcementRaw[];
  exportDate: string | null;
  totalRecords: number;
}

export interface OpenEvidenceSyncOptions {
  apply: boolean;
  /** Previous run's manifest total (the job's SOURCE FAILURE guard); null when none. */
  previousTotal: number | null;
  /** Rollback: plan every stored value to null instead of syncing. */
  clear?: boolean;
}

export type OpenEvidenceSyncResult =
  | { status: 'skipped'; reason: string; exportDate: string | null }
  | {
      status: 'planned' | 'applied';
      mode: 'sync' | 'clear';
      exportDate: string | null;
      columnPresent: boolean;
      stats: OpenEvidenceStats | null;
      writes: OpenEvidenceWrite[];
      /** Rows actually changed (apply only). */
      applied: number;
      /** Compare-and-set misses: a value moved under the run (apply only). */
      conflicts: number;
    };

/** Recall numbers in the raw export whose record did not parse. */
export function unparsedRecallNumbers(records: readonly OpenFdaEnforcementRaw[]): {
  statusByRecallNumber: Map<string, string | null>;
  unparsed: Set<string>;
} {
  const statusByRecallNumber = new Map<string, string | null>();
  const unparsed = new Set<string>();
  for (const raw of records) {
    try {
      const record = parseEnforcementRecord(raw);
      statusByRecallNumber.set(record.recallNumber, record.status);
    } catch {
      const number = typeof raw.recall_number === 'string' ? raw.recall_number.trim() : '';
      if (number !== '') unparsed.add(number);
    }
  }
  return { statusByRecallNumber, unparsed };
}

export async function runOpenEvidenceSync(
  store: OpenEvidenceStore,
  corpus: OpenEvidenceCorpus,
  options: OpenEvidenceSyncOptions,
): Promise<OpenEvidenceSyncResult> {
  const { cases, columnPresent } = await store.listFdaCases();
  if (options.apply && !columnPresent) {
    throw new Error(
      'recall_cases.fda_ongoing_as_of does not exist — apply the migration before an open-evidence apply.',
    );
  }

  let writes: OpenEvidenceWrite[];
  let stats: OpenEvidenceStats | null = null;
  if (options.clear) {
    writes = planClearOpenEvidence(cases);
  } else {
    const completeness = validateExportCompleteness({
      rawCount: corpus.records.length,
      manifestTotal: corpus.totalRecords,
      previousTotal: options.previousTotal,
      exportDate: corpus.exportDate,
    });
    if (!completeness.complete) {
      return { status: 'skipped', reason: completeness.reason, exportDate: corpus.exportDate };
    }
    const { statusByRecallNumber, unparsed } = unparsedRecallNumbers(corpus.records);
    const plan = planOpenEvidence({
      cases,
      links: await store.listEnforcementLinks(),
      statusByRecallNumber,
      unparsedRecallNumbers: unparsed,
      exportDate: corpus.exportDate!,
    });
    writes = plan.writes;
    stats = plan.stats;
  }

  const base = {
    mode: options.clear ? ('clear' as const) : ('sync' as const),
    exportDate: corpus.exportDate,
    columnPresent,
    stats,
    writes,
  };
  if (!options.apply) return { status: 'planned', ...base, applied: 0, conflicts: 0 };

  let applied = 0;
  let conflicts = 0;
  for (const write of writes) {
    if (await store.setFdaOngoingAsOf(write.caseId, write.before, write.after)) applied += 1;
    else conflicts += 1;
  }
  return { status: 'applied', ...base, applied, conflicts };
}

/** One printable line per stats object — for the CLI and job logs. */
export function describeOpenEvidence(result: OpenEvidenceSyncResult): string {
  if (result.status === 'skipped') {
    return `open evidence: SKIPPED (${result.reason}) — stored values unchanged`;
  }
  const head =
    result.mode === 'clear'
      ? `open evidence (clear): ${result.writes.length} value(s) to null`
      : `open evidence for export ${result.exportDate}: ${result.stats!.confirmedOpen} confirmed open; ` +
        `${result.stats!.gained} gained, ${result.stats!.lost} lost, ${result.stats!.advanced} advanced, ` +
        `${result.stats!.unchanged} unchanged, ${result.stats!.skippedUnparsed} skipped (unparsed) ` +
        `over ${result.stats!.casesExamined} FDA case(s)`;
  const tail =
    result.status === 'applied'
      ? ` — APPLIED ${result.applied} write(s), ${result.conflicts} conflict(s)`
      : ` — ${result.writes.length} planned write(s), nothing written` +
        (result.columnPresent ? '' : ' (column not yet migrated; stored values read as null)');
  return head + tail;
}

/** JSON-friendly metrics for job_runs. */
export function openEvidenceMetrics(result: OpenEvidenceSyncResult): Record<string, unknown> {
  if (result.status === 'skipped') return { skipped: result.reason };
  return {
    mode: result.mode,
    exportDate: result.exportDate,
    ...(result.stats ?? {}),
    plannedWrites: result.writes.length,
    applied: result.applied,
    conflicts: result.conflicts,
  };
}

// ── Supabase implementation ─────────────────────────────────────────────────

const PAGE = 500;
const MISSING_COLUMN = /fda_ongoing_as_of/;

function readError(operation: string, error: { message: string; code?: string | null }): Error {
  return Object.assign(new Error(`${operation} read failed: ${error.message}`), {
    code: error.code ?? null,
  });
}

export class SupabaseOpenEvidenceStore implements OpenEvidenceStore {
  constructor(private readonly client: SupabaseClient) {}

  async listFdaCases(): Promise<{ cases: OpenEvidenceCase[]; columnPresent: boolean }> {
    const cases: OpenEvidenceCase[] = [];
    let columnPresent = true;
    let from = 0;
    for (;;) {
      const rows = await retryTransientRead(`open_evidence.recall_cases[${from}]`, async () => {
        const result = await this.client
          .from('recall_cases')
          .select(columnPresent ? 'id, merged_into, fda_ongoing_as_of' : 'id, merged_into')
          .eq('source_agency', 'FDA')
          .order('id')
          .range(from, from + PAGE - 1);
        // Before the migration the column does not exist: say so, never retry.
        if (result.error && columnPresent && MISSING_COLUMN.test(result.error.message)) return null;
        if (result.error) throw readError('recall_cases', result.error);
        return result.data as unknown as {
          id: string;
          merged_into: string | null;
          fda_ongoing_as_of?: string | null;
        }[];
      });
      if (rows === null) {
        columnPresent = false; // re-read the same page without the column
        continue;
      }
      for (const row of rows) {
        cases.push({
          id: row.id,
          mergedInto: row.merged_into,
          fdaOngoingAsOf: row.fda_ongoing_as_of ?? null,
        });
      }
      if (rows.length < PAGE) return { cases, columnPresent };
      from += PAGE;
    }
  }

  async listEnforcementLinks(): Promise<EnforcementLink[]> {
    const links: EnforcementLink[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = await retryTransientRead(`open_evidence.source_records[${from}]`, async () => {
        const result = await this.client
          .from('source_records')
          .select('native_id, recall_case_id')
          .eq('source_system', 'openfda_enforcement')
          .order('id')
          .range(from, from + PAGE - 1);
        if (result.error) throw readError('source_records', result.error);
        return result.data as { native_id: string; recall_case_id: string }[];
      });
      for (const row of rows)
        links.push({ recallNumber: row.native_id, caseId: row.recall_case_id });
      if (rows.length < PAGE) return links;
    }
  }

  async setFdaOngoingAsOf(
    caseId: string,
    before: string | null,
    after: string | null,
  ): Promise<boolean> {
    // A mutation: never retried. Compare-and-set on the planned `before`.
    const update = this.client
      .from('recall_cases')
      .update({ fda_ongoing_as_of: after })
      .eq('id', caseId);
    const guarded =
      before === null
        ? update.is('fda_ongoing_as_of', null)
        : update.eq('fda_ongoing_as_of', before);
    const { data, error } = await guarded.select('id');
    if (error) throw new Error(`recall_cases.fda_ongoing_as_of update failed: ${error.message}`);
    return (data ?? []).length === 1;
  }
}

// ── In-memory implementation (tests) ────────────────────────────────────────

export class MemoryOpenEvidenceStore implements OpenEvidenceStore {
  /** Every write the store accepted, in order — tests assert on it. */
  readonly writeLog: OpenEvidenceWrite[] = [];

  constructor(
    private readonly cases: Map<string, OpenEvidenceCase>,
    private readonly links: EnforcementLink[],
    private readonly options: { columnPresent?: boolean; failOnWrite?: number } = {},
  ) {}

  async listFdaCases(): Promise<{ cases: OpenEvidenceCase[]; columnPresent: boolean }> {
    const columnPresent = this.options.columnPresent ?? true;
    return {
      cases: [...this.cases.values()].map((c) => ({
        ...c,
        fdaOngoingAsOf: columnPresent ? c.fdaOngoingAsOf : null,
      })),
      columnPresent,
    };
  }

  async listEnforcementLinks(): Promise<EnforcementLink[]> {
    return [...this.links];
  }

  async setFdaOngoingAsOf(
    caseId: string,
    before: string | null,
    after: string | null,
  ): Promise<boolean> {
    if (
      this.options.failOnWrite !== undefined &&
      this.writeLog.length >= this.options.failOnWrite
    ) {
      throw new Error('simulated write failure');
    }
    const current = this.cases.get(caseId);
    if (!current || current.fdaOngoingAsOf !== before) return false;
    this.cases.set(caseId, { ...current, fdaOngoingAsOf: after });
    this.writeLog.push({ caseId, before, after });
    return true;
  }

  value(caseId: string): string | null {
    return this.cases.get(caseId)?.fdaOngoingAsOf ?? null;
  }
}
