/**
 * Stale illness-flag correction (P2B7L) — an explicit maintenance operation,
 * deliberately outside normal ingestion.
 *
 * Why it is needed: P2B7K replaced four rival readers of illness prose with
 * one shared contract (`domain/illness-status.ts`), and re-pointed
 * `projection.reportsIllness` at it — from `statementReportsIllness` over the
 * EXTRACTED `illnessStatement`, which is empty for the FSIS outbreak notices
 * that plainly report illnesses, to `statusReportsIllness(deriveIllnessStatus(
 * summaryText))` over the notice's own prose. Recall Detail derives fresh on
 * every render, so the screen corrected itself the moment P2B7K shipped. The
 * STORED flag did not: incremental ingestion re-projects a case only when its
 * source page's content hash moves, so a case whose page is final would carry
 * its pre-P2B7K answer forever under normal operation — by design, because
 * re-fetching unchanged pages is what the hash gate exists to prevent.
 *
 * Why it needs no network and no snapshot: `projectCase` derives the flag from
 * `newest.summaryText`, and it persists that same string as
 * `projection.summaryText` (domain/projection.ts). The classifier's input is
 * therefore already stored beside its output, and re-deriving from it is
 * byte-identical to what a full re-projection would compute. This runs the
 * CANONICAL `deriveIllnessStatus` / `statusReportsIllness` — the exact pair
 * `projectCase` and Recall Detail both call, never a repair-only regex — so a
 * corrected case holds what the next legitimate re-projection will recompute
 * instead of erasing it.
 *
 * What it touches: `projection.reportsIllness`, and nothing else. Timeline,
 * `lastChangedAt`, classification, title, dates, images, geography, retailer
 * names and every sibling projection field are not in the payload at all. It
 * never creates a case, never merges or splits one, never runs the pipeline,
 * never runs material-change detection, never writes a NotificationEvent, and
 * never moves an announcement or material-change date.
 *
 * WHY IT MAY NOT GO THROUGH THE PIPELINE. This is the one corrected field
 * `detectChanges` actually diffs: `!prev.reportsIllness && next.reportsIllness`
 * raises `health_impact`, whose ledgered copy is "The notice now reports
 * illnesses or adverse reactions." Every stale `false` — 23 of them at the
 * P2B7K audit, all real outbreak counts the old regex could not read — would
 * be announced through a normal re-projection as an illness development that
 * just happened, for a notice that has not changed since it was published.
 * Push is inactive, so nothing would reach a lock screen today; but the
 * notification ledger is the durable record of what the app believes it told
 * people, and filling it with events no agency generated is not a thing an
 * inactive transport makes safe. The narrow port exists so the flag can be
 * corrected without material-change detection being reached at all.
 *
 * What a full re-projection would ALSO change is not knowable from this
 * module and is deliberately not guessed: `auditReprojectionDrift` answers it
 * read-only, per case, from the case's own source records.
 *
 * Refused rather than guessed:
 * - a case whose `summaryText` is absent or blank has no prose to classify.
 *   Deriving `false` from silence would be arithmetically correct (`unknown`
 *   is not a report) and evidentially empty, so it is reported as
 *   'no-evidence' and left untouched.
 * - a case whose stored projection carries no boolean flag at all is reported
 *   as 'missing-flag'. That is a shape this repair did not audit, and writing
 *   a first value into it is a different operation from correcting one.
 *
 * Safe to run WHILE scheduled ingestion is running, with no job lease. Each
 * write is a compare-and-set on `last_changed_at` and patches the projection
 * column alone, so an ingest that lands mid-run cannot be rolled back: the
 * write simply matches no row, and that case is reported rather than retried
 * against stale evidence.
 *
 * Idempotent and resumable: every decision is made from current state, so a
 * completed run is a no-op, an interrupted one simply resumes, and the dry run
 * doubles as the post-apply verification report ("would change: 0").
 */

import { deriveIllnessStatus, statusReportsIllness } from '../domain/illness-status';
import type { IllnessStatusKind } from '../domain/illness-status';
import { projectCase } from '../domain/projection';
import type { CaseProjection } from '../domain/recall-types';
import type { RecallCaseRow, RecallStore } from './store/types';

export type IllnessFlagOutcome =
  /** Stored flag disagrees with the shared classifier: correctable. */
  | 'update'
  /** Stored flag already equals what the shared classifier derives. */
  | 'unchanged'
  /** No prose to classify — left untouched and reported. */
  | 'no-evidence'
  /** Stored projection carries no boolean flag — out of scope, reported. */
  | 'missing-flag';

export type IllnessFlagDirection = 'true->false' | 'false->true';

export interface IllnessFlagCasePlan {
  recallCaseId: string;
  sourceAgency: string;
  lifecycle: string;
  active: boolean;
  outcome: IllnessFlagOutcome;
  /** null only when the stored projection carries no boolean flag. */
  storedValue: boolean | null;
  /** What the shared classifier derives from the stored `summaryText`. */
  derivedValue: boolean;
  direction: IllnessFlagDirection | null;
  /** The classifier's own state — the reason the derived value is what it is. */
  statusKind: IllnessStatusKind;
  illnesses: number | null;
  approximate: boolean;
  /**
   * The verbatim source sentences the classifier read, bounded. Review
   * evidence for the ledger; empty for `unknown`, which is what makes a
   * `true -> false` correction over silence visible as such.
   */
  evidence: string[];
}

/** One case's answer to "what ELSE would a normal re-projection change?" */
export interface ReprojectionDriftRow {
  recallCaseId: string;
  /** Projection keys a full re-projection would move, excluding the flag. */
  otherFieldsChanged: string[];
  /**
   * True when a full re-projection would raise `health_impact` for this case
   * — i.e. the stored flag is false and the recomputed one is true.
   */
  wouldRaiseHealthImpact: boolean;
  /** The re-projection could not be computed (no linked records, or it threw). */
  unavailable: string | null;
}

export interface IllnessRepairReport {
  casesExamined: number;
  active: number;
  inactive: number;
  fda: number;
  fsis: number;
  /** Planned corrections, by direction. */
  wouldUpdate: number;
  trueToFalse: number;
  falseToTrue: number;
  activeWouldUpdate: number;
  activeTrueToFalse: number;
  activeFalseToTrue: number;
  unchanged: number;
  noEvidence: number;
  missingFlag: number;
  /** Every planned correction, in full. This is the reviewable dry run. */
  plans: IllnessFlagCasePlan[];
  /** Cases refused rather than guessed, in full. */
  refused: IllnessFlagCasePlan[];
  /**
   * The apply never started because the planned count did not match the
   * count the operator authorized. Zero writes happened.
   */
  aborted: { reason: string; expected: number; actual: number } | null;
  caseWrites: number;
  /** Writes that lost the compare-and-set to concurrent ingestion. */
  concurrentlyModified: string[];
  failures: { recallCaseId: string; reason: string }[];
  /**
   * Post-apply verification: cases re-read after the write whose stored flag
   * now equals the planned value, and any that do not.
   */
  verifiedWrites: number;
  verificationFailures: { recallCaseId: string; expected: boolean; found: boolean | null }[];
  /**
   * Restore data for every write actually performed: enough, on its own, to
   * put each case back exactly as it was. Written to the durable ledger.
   */
  rollback: { recallCaseId: string; previousValue: boolean; writtenValue: boolean }[];
  /** Structural attestations. Zero by construction, asserted by tests. */
  networkRequests: number;
  notificationEvents: number;
  timelineEntries: number;
  materialChanges: number;
  newCases: number;
}

export interface IllnessRepairOptions {
  apply: boolean;
  /**
   * The number of corrections the operator reviewed and authorized. Required
   * for an apply: if the live plan does not match it exactly, nothing is
   * written. A dry run may pass it too, which turns the dry run into a gate.
   */
  expectedUpdates: number | null;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Plan one case. Pure: given the stored row it decides the outcome with no
 * I/O, which is what makes the dry run an honest preview of the apply and the
 * whole operation idempotent.
 */
export function planIllnessFlag(row: RecallCaseRow): IllnessFlagCasePlan {
  const projection: CaseProjection = row.projection;
  const summaryText = typeof projection.summaryText === 'string' ? projection.summaryText : '';
  const status = deriveIllnessStatus(summaryText);
  const derivedValue = statusReportsIllness(status);
  const storedValue =
    typeof projection.reportsIllness === 'boolean' ? projection.reportsIllness : null;

  const base = {
    recallCaseId: row.id,
    sourceAgency: projection.sourceAgency,
    lifecycle: projection.state,
    active: projection.state === 'active',
    storedValue,
    derivedValue,
    statusKind: status.kind,
    illnesses: status.illnesses,
    approximate: status.approximate,
    evidence: status.statements.slice(0, 3),
    direction: null as IllnessFlagDirection | null,
  };

  if (storedValue === null) return { ...base, outcome: 'missing-flag' };
  if (summaryText.trim() === '') return { ...base, outcome: 'no-evidence' };
  if (storedValue === derivedValue) return { ...base, outcome: 'unchanged' };
  return {
    ...base,
    outcome: 'update',
    direction: storedValue ? 'true->false' : 'false->true',
  };
}

function emptyReport(): IllnessRepairReport {
  return {
    casesExamined: 0,
    active: 0,
    inactive: 0,
    fda: 0,
    fsis: 0,
    wouldUpdate: 0,
    trueToFalse: 0,
    falseToTrue: 0,
    activeWouldUpdate: 0,
    activeTrueToFalse: 0,
    activeFalseToTrue: 0,
    unchanged: 0,
    noEvidence: 0,
    missingFlag: 0,
    plans: [],
    refused: [],
    aborted: null,
    caseWrites: 0,
    concurrentlyModified: [],
    failures: [],
    verifiedWrites: 0,
    verificationFailures: [],
    rollback: [],
    networkRequests: 0,
    notificationEvents: 0,
    timelineEntries: 0,
    materialChanges: 0,
    newCases: 0,
  };
}

/**
 * Visit every case, re-derive its illness flag from data already stored with
 * it, and (in apply mode, and only after the expected-count guard passes)
 * write that one field.
 *
 * Planning completes for the WHOLE corpus before any write happens. That is
 * what lets the expected-count guard mean something: an operator authorizes a
 * reviewed number of corrections, and a corpus that has drifted since the
 * review aborts the run whole rather than writing a prefix of it.
 */
export async function repairIllnessFlags(
  store: RecallStore,
  options: IllnessRepairOptions,
): Promise<IllnessRepairReport> {
  const cases = await store.listCases();
  const report = emptyReport();

  const rowsById = new Map<string, RecallCaseRow>();
  let done = 0;

  for (const row of cases) {
    done += 1;
    options.onProgress?.(done, cases.length);

    let plan: IllnessFlagCasePlan;
    try {
      plan = planIllnessFlag(row);
    } catch (error) {
      report.failures.push({
        recallCaseId: row.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    report.casesExamined += 1;
    if (plan.active) report.active += 1;
    else report.inactive += 1;
    if (plan.sourceAgency === 'FDA') report.fda += 1;
    else report.fsis += 1;

    switch (plan.outcome) {
      case 'unchanged':
        report.unchanged += 1;
        continue;
      case 'no-evidence':
        report.noEvidence += 1;
        report.refused.push(plan);
        continue;
      case 'missing-flag':
        report.missingFlag += 1;
        report.refused.push(plan);
        continue;
      case 'update':
        break;
    }

    report.wouldUpdate += 1;
    if (plan.direction === 'true->false') report.trueToFalse += 1;
    else report.falseToTrue += 1;
    if (plan.active) {
      report.activeWouldUpdate += 1;
      if (plan.direction === 'true->false') report.activeTrueToFalse += 1;
      else report.activeFalseToTrue += 1;
    }
    report.plans.push(plan);
    rowsById.set(row.id, row);
  }

  if (!options.apply) {
    // A dry run may still be gated, so a mismatch is reported the same way and
    // the caller can exit nonzero on it. Nothing was going to be written.
    if (options.expectedUpdates !== null && options.expectedUpdates !== report.wouldUpdate) {
      report.aborted = {
        reason: 'planned corrections do not match the authorized count',
        expected: options.expectedUpdates,
        actual: report.wouldUpdate,
      };
    }
    return report;
  }

  if (options.expectedUpdates === null || options.expectedUpdates !== report.wouldUpdate) {
    report.aborted = {
      reason:
        options.expectedUpdates === null
          ? 'apply requires an authorized correction count'
          : 'the live corpus drifted from the reviewed dry run',
      expected: options.expectedUpdates ?? -1,
      actual: report.wouldUpdate,
    };
    return report;
  }

  for (const plan of report.plans) {
    const row = rowsById.get(plan.recallCaseId)!;
    // The reviewed value, guarded on the version the plan was read at. A case
    // ingestion touched since is NOT re-derived on the fly: the apply writes
    // only what the reviewed dry run proposed, and anything that moved is
    // reported for the next run.
    const written = await store.updateCaseReportsIllness(
      plan.recallCaseId,
      plan.derivedValue,
      row.lastChangedAt,
    );
    if (!written) {
      report.concurrentlyModified.push(plan.recallCaseId);
      continue;
    }
    report.caseWrites += 1;
    report.rollback.push({
      recallCaseId: plan.recallCaseId,
      previousValue: plan.storedValue!,
      writtenValue: plan.derivedValue,
    });

    // Verify from live state rather than from the fact that the write
    // returned true.
    const fresh = await store.getCase(plan.recallCaseId);
    const found =
      fresh && typeof fresh.projection.reportsIllness === 'boolean'
        ? fresh.projection.reportsIllness
        : null;
    if (found === plan.derivedValue) report.verifiedWrites += 1;
    else {
      report.verificationFailures.push({
        recallCaseId: plan.recallCaseId,
        expected: plan.derivedValue,
        found,
      });
    }
  }

  return report;
}

/**
 * Read-only: what ELSE would a normal, full re-projection of these cases
 * change?
 *
 * The repair itself never needs this — it writes one key. It exists because
 * "just re-project the affected cases" is the obvious alternative, and the
 * only honest way to reject it is to measure it. Runs `projectCase` over each
 * case's linked source records exactly as the pipeline would, and diffs the
 * result against the stored projection.
 *
 * Writes nothing, and detects nothing: `detectChanges` is not called here
 * either, so not even a material change is constructed in memory.
 */
export async function auditReprojectionDrift(
  store: RecallStore,
  recallCaseIds: readonly string[],
): Promise<ReprojectionDriftRow[]> {
  const rows: ReprojectionDriftRow[] = [];
  for (const id of recallCaseIds) {
    const recallCase = await store.getCase(id);
    if (!recallCase) {
      rows.push({
        recallCaseId: id,
        otherFieldsChanged: [],
        wouldRaiseHealthImpact: false,
        unavailable: 'case not found',
      });
      continue;
    }
    try {
      const records = await store.getSourceRecordsForCase(id);
      if (records.length === 0) {
        rows.push({
          recallCaseId: id,
          otherFieldsChanged: [],
          wouldRaiseHealthImpact: false,
          unavailable: 'no linked source records',
        });
        continue;
      }
      const next = projectCase(records.map((r) => r.normalized));
      const stored = recallCase.projection;
      const storedFields = stored as unknown as Record<string, unknown>;
      const nextFields = next as unknown as Record<string, unknown>;
      const keys = [...new Set([...Object.keys(stored), ...Object.keys(next)])].sort();
      const otherFieldsChanged = keys.filter(
        (key) =>
          key !== 'reportsIllness' &&
          JSON.stringify(storedFields[key]) !== JSON.stringify(nextFields[key]),
      );
      rows.push({
        recallCaseId: id,
        otherFieldsChanged,
        wouldRaiseHealthImpact: stored.reportsIllness === false && next.reportsIllness === true,
        unavailable: null,
      });
    } catch (error) {
      rows.push({
        recallCaseId: id,
        otherFieldsChanged: [],
        wouldRaiseHealthImpact: false,
        unavailable: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return rows;
}

/**
 * CLI contract, tested directly.
 *
 * With no flags the command is a dry run. An apply needs THREE deliberate
 * acknowledgments, and is refused without all of them:
 *
 *   --apply            the intent
 *   --confirm          the second acknowledgment (the repair:* house rule)
 *   --expect <n>       the reviewed correction count, matched exactly
 *
 * `--dry-run` alongside `--apply` is a contradiction, not a preference, and is
 * refused rather than resolved in either direction.
 */
export function resolveIllnessRepairMode(argv: string[]): {
  apply: boolean;
  expectedUpdates: number | null;
  error: string | null;
} {
  const refuse = (error: string) => ({ apply: false, expectedUpdates: null, error });

  const wantsApply = argv.includes('--apply');
  const wantsDryRun = argv.includes('--dry-run');
  const confirmed = argv.includes('--confirm');

  if (wantsApply && wantsDryRun) {
    return refuse('--apply and --dry-run contradict each other. Nothing was written.');
  }

  let expectedUpdates: number | null = null;
  const expectIndex = argv.indexOf('--expect');
  if (expectIndex >= 0) {
    const raw = argv[expectIndex + 1];
    if (raw === undefined || raw.startsWith('--')) {
      return refuse('--expect requires the reviewed correction count. Nothing was written.');
    }
    if (!/^\d+$/.test(raw)) {
      return refuse(`--expect must be a non-negative integer, got "${raw}". Nothing was written.`);
    }
    expectedUpdates = Number(raw);
  }

  if (wantsApply && !confirmed) {
    return refuse(
      '--apply requires the explicit second acknowledgment --confirm ' +
        '(npm run repair:illness-flags -- --confirm --expect <n>). Nothing was written.',
    );
  }
  if (wantsApply && expectedUpdates === null) {
    return refuse(
      '--apply requires --expect <n>, the correction count from the reviewed dry run. ' +
        'Nothing was written.',
    );
  }

  return { apply: wantsApply && confirmed, expectedUpdates, error: null };
}
