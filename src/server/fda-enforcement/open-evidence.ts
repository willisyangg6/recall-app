/**
 * FDA open evidence (2026-10-06): the one fact that lets Affects You count an
 * FDA recall older than the 60-day window — the openFDA export date of the
 * last COMPLETE export in which an enforcement record linked to (and owned
 * by) the case had status `Ongoing`. Stored in `recall_cases.fda_ongoing_as_of`;
 * the client counts it while it is at most 21 days old (src/lib/open-evidence.ts).
 *
 * Pure: everything here is a function of the persisted production links, the
 * export, and the values already stored. No matching happens here. The links
 * are the matcher's ACCEPTED, persisted `openfda_enforcement` source records
 * (code identity: a shared UPC; name identity: the sole qualifying event by
 * product name) — the same links that already decide the classification
 * shoppers see. Ambiguous, candidate and unmatched cases have no link, so they
 * can never gain evidence; a recall number owned by a different case (an
 * unmerged duplicate pair) contributes only to its owner.
 *
 * Status semantics (openFDA `status`):
 *   - `Ongoing` (and the documented, never-observed `On-Going`) confirms open.
 *   - `Completed`, `Terminated`, `Pending`, empty or anything else does not.
 *   - A case is open when ANY owned linked record is Ongoing: FDA terminates
 *     per product, and a product still under recall is the reading a shopper
 *     needs.
 *
 * Absence is only evidence when the export is proven complete
 * (`validateExportCompleteness`). A record present in the raw export that
 * failed to parse is NOT absence: its owning case is skipped and keeps its
 * stored value, so a parse failure can never clear valid evidence.
 */

/** openFDA statuses that confirm a recall is still open. Exact after trim. */
export const ONGOING_STATUSES: ReadonlySet<string> = new Set(['Ongoing', 'On-Going']);

export function isOngoingStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && ONGOING_STATUSES.has(status.trim());
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ExportCompleteness = { complete: true } | { complete: false; reason: string };

export interface ExportCompletenessInput {
  /** Raw records in the downloaded export, BEFORE parsing. */
  rawCount: number;
  /** The export manifest's own `total_records`. */
  manifestTotal: number;
  /** The previous run's manifest total, when one is recorded. */
  previousTotal: number | null;
  /** The export's own date stamp (`YYYY-MM-DD`). */
  exportDate: string | null;
}

/**
 * The gate every open-evidence write passes first. A partial download, an
 * empty export, an implausibly small one (the job's existing SOURCE FAILURE
 * rule: under half the previous total), or one with no date can never clear
 * or advance anything — the stored values simply stand.
 */
export function validateExportCompleteness(input: ExportCompletenessInput): ExportCompleteness {
  if (input.exportDate === null || !ISO_DATE.test(input.exportDate)) {
    return { complete: false, reason: 'export date unknown' };
  }
  if (input.manifestTotal <= 0 || input.rawCount <= 0) {
    return { complete: false, reason: 'export is empty' };
  }
  if (input.rawCount !== input.manifestTotal) {
    return {
      complete: false,
      reason: `export has ${input.rawCount} records but its manifest names ${input.manifestTotal}`,
    };
  }
  if (input.previousTotal !== null && input.manifestTotal < Math.ceil(input.previousTotal / 2)) {
    return {
      complete: false,
      reason: `export of ${input.manifestTotal} records is implausibly small (previously ${input.previousTotal})`,
    };
  }
  return { complete: true };
}

/** One persisted link: an accepted enforcement record and the case that owns it. */
export interface EnforcementLink {
  recallNumber: string;
  caseId: string;
}

/** One FDA case the plan covers, with its stored value. */
export interface OpenEvidenceCase {
  id: string;
  mergedInto: string | null;
  fdaOngoingAsOf: string | null;
}

export interface OpenEvidenceWrite {
  caseId: string;
  before: string | null;
  after: string | null;
}

export interface OpenEvidenceStats {
  casesExamined: number;
  /** null → date: newly confirmed open. */
  gained: number;
  /** date → null: no longer confirmed open. */
  lost: number;
  /** older date → this export's date: still open, evidence refreshed. */
  advanced: number;
  unchanged: number;
  /** Cases skipped because an owned record was present but unparseable. */
  skippedUnparsed: number;
  /** Cases now carrying evidence after the plan applies. */
  confirmedOpen: number;
}

export interface OpenEvidencePlan {
  exportDate: string;
  writes: OpenEvidenceWrite[];
  stats: OpenEvidenceStats;
}

export interface PlanOpenEvidenceInput {
  /** Every FDA case (merged ones are skipped here, never written). */
  cases: readonly OpenEvidenceCase[];
  /** Every persisted `openfda_enforcement` link. */
  links: readonly EnforcementLink[];
  /** Parsed export: recall number → status. */
  statusByRecallNumber: ReadonlyMap<string, string | null>;
  /** Recall numbers present in the raw export whose record failed to parse. */
  unparsedRecallNumbers: ReadonlySet<string>;
  /** The complete export's date. Callers validate completeness first. */
  exportDate: string;
}

/**
 * The value one case should carry for this export: the export date when any
 * owned linked record is Ongoing in it, else null. `'skip'` when an owned
 * record is present but unparseable — the case keeps its stored value.
 */
export function desiredFdaOngoingAsOf(
  ownedRecallNumbers: readonly string[],
  statusByRecallNumber: ReadonlyMap<string, string | null>,
  unparsedRecallNumbers: ReadonlySet<string>,
  exportDate: string,
): string | null | 'skip' {
  if (ownedRecallNumbers.some((n) => isOngoingStatus(statusByRecallNumber.get(n)))) {
    return exportDate;
  }
  if (ownedRecallNumbers.some((n) => unparsedRecallNumbers.has(n))) return 'skip';
  return null;
}

/** The full plan: only cases whose desired value differs become writes. */
export function planOpenEvidence(input: PlanOpenEvidenceInput): OpenEvidencePlan {
  const owned = new Map<string, string[]>();
  for (const link of input.links) {
    owned.set(link.caseId, [...(owned.get(link.caseId) ?? []), link.recallNumber]);
  }
  const stats: OpenEvidenceStats = {
    casesExamined: 0,
    gained: 0,
    lost: 0,
    advanced: 0,
    unchanged: 0,
    skippedUnparsed: 0,
    confirmedOpen: 0,
  };
  const writes: OpenEvidenceWrite[] = [];
  // Sorted by id so the plan (and a printed dry run) is deterministic
  // whatever order the store returned cases in.
  const cases = [...input.cases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const recallCase of cases) {
    if (recallCase.mergedInto !== null) continue;
    stats.casesExamined += 1;
    const before = recallCase.fdaOngoingAsOf;
    const desired = desiredFdaOngoingAsOf(
      owned.get(recallCase.id) ?? [],
      input.statusByRecallNumber,
      input.unparsedRecallNumbers,
      input.exportDate,
    );
    if (desired === 'skip') {
      stats.skippedUnparsed += 1;
      if (before !== null) stats.confirmedOpen += 1;
      continue;
    }
    if (desired !== null) stats.confirmedOpen += 1;
    if (desired === before) {
      stats.unchanged += 1;
      continue;
    }
    if (before === null) stats.gained += 1;
    else if (desired === null) stats.lost += 1;
    else stats.advanced += 1;
    writes.push({ caseId: recallCase.id, before, after: desired });
  }
  return { exportDate: input.exportDate, writes, stats };
}

/**
 * The clear plan (rollback): every case carrying evidence goes to null. Same
 * write shape, so the same authorization and apply path cover it.
 */
export function planClearOpenEvidence(cases: readonly OpenEvidenceCase[]): OpenEvidenceWrite[] {
  return [...cases]
    .filter((c) => c.fdaOngoingAsOf !== null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => ({ caseId: c.id, before: c.fdaOngoingAsOf, after: null }));
}

// ── Operations: evidence age (ops:health) ───────────────────────────────────

/**
 * Operations warn this early — one week before devices stop counting the
 * evidence (the client's 21-day expiry, lib/open-evidence.ts). A warning, not
 * UNHEALTHY: the enforcement job's own run health is reported separately, and
 * the consumer outcome of stale evidence is fail-closed (recalls move to
 * Older notices; nothing is hidden).
 */
export const OPEN_EVIDENCE_WARN_DAYS = 14;

export interface OpenEvidenceAgeReport {
  status: 'healthy' | 'STALE EVIDENCE' | 'no evidence';
  /** Cases carrying a value. */
  count: number;
  newest: string | null;
  /** Values older than the warning threshold. */
  olderThanWarn: number;
  /** Values devices no longer count. */
  expiredOnDevices: number;
  notes: string[];
}

export function summarizeOpenEvidenceAge(
  values: readonly (string | null)[],
  nowMs: number,
  deviceExpiryDays: number,
): OpenEvidenceAgeReport {
  const dated = values.filter((value): value is string => value !== null);
  const age = (date: string) => (nowMs - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
  const newest = dated.length > 0 ? [...dated].sort().at(-1)! : null;
  const olderThanWarn = dated.filter((date) => age(date) > OPEN_EVIDENCE_WARN_DAYS).length;
  const expiredOnDevices = dated.filter((date) => age(date) > deviceExpiryDays).length;
  const notes: string[] = [];
  let status: OpenEvidenceAgeReport['status'] = 'healthy';
  if (newest === null) {
    status = 'no evidence';
    notes.push(
      'no case carries FDA open evidence — the sync has not populated it, or nothing is Ongoing',
    );
  } else if (age(newest) > OPEN_EVIDENCE_WARN_DAYS) {
    status = 'STALE EVIDENCE';
    notes.push(
      `newest evidence is ${Math.floor(age(newest))}d old (warn ${OPEN_EVIDENCE_WARN_DAYS}d, devices stop counting at ${deviceExpiryDays}d) — the weekly open-evidence sync has stopped`,
    );
  }
  if (expiredOnDevices > 0) {
    notes.push(
      `${expiredOnDevices} value(s) past ${deviceExpiryDays}d: devices already count those recalls as Older notices`,
    );
  }
  return { status, count: dated.length, newest, olderThanWarn, expiredOnDevices, notes };
}
