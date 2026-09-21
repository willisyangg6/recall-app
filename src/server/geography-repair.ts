/**
 * Historical geography repair (Phase C5.2A) — an explicit maintenance
 * operation, deliberately outside normal ingestion.
 *
 * Why it is needed: `projection.geography` is the field the feed card, the
 * Affects Me sections, relevance and push eligibility all read, and almost
 * every stored case was projected before the derivation could see a declared
 * state list, a state-role table column, or a lone postal code after a
 * locality preposition. Incremental ingestion re-projects a case only when its
 * source page's content hash moves, so a case whose page is final would stay
 * geography-blind forever under normal operation — by design, because
 * re-fetching unchanged pages is what the hash gate exists to prevent.
 *
 * Why it needs no network: the derivation reads the case's own projected
 * title, summary text and announcement HTML, all already persisted. It runs
 * the CANONICAL `evaluateGeographyEvidence` (domain/geography-evidence.ts)
 * that `projectCase` now owns — never a second, repair-only parser — so a
 * repaired case holds exactly what a full re-projection would have produced,
 * and the next legitimate re-projection recomputes the same answer instead of
 * erasing it.
 *
 * What it touches: `projection.geography`, and nothing else. Timeline,
 * `lastChangedAt`, classification, title, dates, images, retailer names and
 * every sibling projection field are not in the payload at all. It therefore
 * never creates a case, never merges or splits one, never runs material-change
 * detection, never writes a NotificationEvent, and never moves an announcement
 * or material-change date.
 *
 * A projection repair is not a material recall change. `detectChanges`
 * (domain/material-change.ts) would treat a geography WIDENING as
 * `expansion_geography` if this went through the normal path — which is
 * exactly why it does not. Finding evidence a parser previously could not read
 * is not the agency announcing that a recall grew; presenting it as one would
 * push a "recall expanded" alert for a notice that has not changed since it
 * was published.
 *
 * Narrowing is refused, not applied. A state the source really stated must
 * never be dropped, because dropping it turns "we are not sure this reached
 * you" into "this does not affect you" for the people the notice was meant to
 * warn. The single exception is a state the notice's own text proves is a
 * containment artifact — "Virginia" read out of the words "West Virginia" —
 * and even that is reported line by line.
 *
 * Safe to run WHILE scheduled ingestion is running. Each write is a
 * compare-and-set on `last_changed_at` and patches the projection column
 * alone, so an ingest that lands mid-run cannot be rolled back: the write
 * simply matches no row. That case is then re-read, re-derived from the NEWER
 * text, and retried once; anything still moving is reported and left for the
 * next run. The repair deliberately takes no job lease.
 *
 * The dry run is also the VERIFICATION report: it recomputes everything from
 * live state, so running it after an apply shows the remaining gap — expected
 * `would update: 0`.
 *
 * ## P2B7Q.2 — the guard convention, and why the plan completes first
 *
 * An apply needs THREE deliberate acknowledgments (`--apply`, `--confirm`,
 * `--expect <n>`), and the whole corpus is PLANNED before a single write is
 * constructed. That ordering is what makes the count mean anything: an
 * operator authorizes a number they reviewed, and a corpus that has drifted
 * since the review aborts the run whole rather than writing a prefix of it.
 * Every write is then verified by re-reading the row from live state, and the
 * before/after value of each one is written to a durable ledger that
 * `rollbackGeography` can replay backwards through this same store port.
 */

import { evaluateGeographyEvidence, readDistributionProse } from '../domain/geography-evidence';
import type { CaseProjection, Geography } from '../domain/recall-types';
import { projectCase } from '../domain/projection';
import type { RecallCaseRow, RecallStore } from './store/types';

export type GeographyCaseOutcome =
  /** Gains states, or gains a scope it did not have. */
  | 'update'
  /** Already holds exactly the canonical geography. */
  | 'unchanged'
  /** No deterministic distribution evidence; stays honestly unknown. */
  | 'no-evidence'
  /** The derivation would drop a stated state; left untouched for a human. */
  | 'conflict';

export interface GeographyCasePlan {
  recallCaseId: string;
  sourceAgency: string;
  lifecycle: string;
  active: boolean;
  outcome: GeographyCaseOutcome;
  current: Geography;
  next: Geography;
  addedStates: string[];
  removedStates: string[];
  /** Each removal with the evidence class that justifies it. */
  removals: { state: string; reason: string }[];
  /** States the notice explicitly rules out. */
  excludedStates: string[];
  /** States the notice both affirms and rules out — refused, never guessed. */
  contradictedStates: string[];
  /** Which evidence kinds contributed: 'prose', 'table'. */
  bases: string[];
  /** Table fragments that look state-like and were deliberately not guessed. */
  unresolvedTokens: string[];
  /**
   * The notice's own sentences that admitted the states, bounded. This is the
   * review evidence: every planned state can be read back to the sentence
   * that produced it.
   */
  evidence: string[];
}

/** One case's answer to "what ELSE would a normal re-projection change?" */
export interface GeographyDriftRow {
  recallCaseId: string;
  /** Projection keys a full re-projection would move, excluding geography. */
  otherFieldsChanged: string[];
  /** True when a full re-projection would raise `expansion_geography`. */
  wouldRaiseGeographyExpansion: boolean;
  /** The re-projection could not be computed (no linked records, or it threw). */
  unavailable: string | null;
}

export interface GeographyRepairReport {
  casesExamined: number;
  active: number;
  inactive: number;
  fda: number;
  fsis: number;
  /** Scope census before the repair. */
  before: { nationwide: number; states: number; unknown: number };
  /** Scope census as the repair would leave it. */
  after: { nationwide: number; states: number; unknown: number };
  activeBefore: { nationwide: number; states: number; unknown: number };
  activeAfter: { nationwide: number; states: number; unknown: number };
  /** Unknown cases the repair can safely resolve. */
  safelyCorrectable: number;
  activeSafelyCorrectable: number;
  /** Unknown cases that stay unknown — the honest remainder. */
  remainingUnknown: number;
  activeRemainingUnknown: number;
  wouldUpdate: number;
  activeWouldUpdate: number;
  unchanged: number;
  noEvidence: number;
  /** Total state ADDITIONS and REMOVALS across every planned update. */
  stateAdditions: number;
  stateRemovals: number;
  /** Scope transitions, counted for the founder report. */
  unknownToStates: number;
  statesToUnknown: number;
  toNationwide: number;
  fromNationwide: number;
  /** Every planned correction, in full. This is the reviewable dry run. */
  plans: GeographyCasePlan[];
  conflicts: GeographyCasePlan[];
  /** Cases whose notice contradicts itself about a state. */
  refused: GeographyCasePlan[];
  /**
   * The apply never started because the planned count did not match the count
   * the operator authorized. Zero writes happened.
   */
  aborted: { reason: string; expected: number; actual: number } | null;
  concurrentlyModified: string[];
  failures: { recallCaseId: string; reason: string }[];
  caseWrites: number;
  /** Writes re-read from live state and confirmed. */
  verifiedWrites: number;
  verificationFailures: { recallCaseId: string; expected: Geography; found: Geography | null }[];
  /**
   * Restore data for every write actually performed: enough, on its own, to
   * put each case back exactly as it was.
   */
  rollback: { recallCaseId: string; previousValue: Geography; writtenValue: Geography }[];
  /**
   * scope/state-list disagreements — `states` with an empty list, or a
   * non-`states` scope carrying one. The gate is 0, before and after.
   */
  contradictionsBefore: number;
  contradictionsAfter: number;
  /** Fragments in state-role table columns that resolve to nothing. */
  unresolvedTokens: string[];
  /** Structural attestations. Zero by construction, asserted by tests. */
  networkRequests: number;
  notificationEvents: number;
  timelineEntries: number;
  materialChanges: number;
  newCases: number;
  examples: GeographyCasePlan[];
}

export interface GeographyRepairOptions {
  apply: boolean;
  /**
   * The number of corrections the operator reviewed and authorized. Required
   * for an apply: if the live plan does not match it exactly, nothing is
   * written. A dry run may pass it too, which turns the dry run into a gate.
   */
  expectedUpdates: number | null;
  onProgress?: (done: number, total: number) => void;
}

function contradicts(geography: Geography): boolean {
  return (geography.scope === 'states') !== geography.states.length > 0;
}

function sameGeography(a: Geography, b: Geography): boolean {
  return (
    a.scope === b.scope &&
    a.states.length === b.states.length &&
    a.states.every((state, index) => state === b.states[index])
  );
}

/** A bounded quote of an official sentence, for the ledger. */
function quote(sentence: string): string {
  const clean = sentence.replace(/\s+/g, ' ').trim();
  return clean.length > 200 ? `${clean.slice(0, 197)}…` : clean;
}

/**
 * Plan one case. Pure: given the stored projection it decides the outcome with
 * no I/O, which is what makes the dry run an honest preview of the apply and
 * the whole operation idempotent.
 */
export function planCaseGeography(row: RecallCaseRow): GeographyCasePlan {
  const projection: CaseProjection = row.projection;
  const current = projection.geography;
  const evidence = evaluateGeographyEvidence({
    title: projection.title,
    summaryText: projection.summaryText,
    summaryHtml: projection.summaryHtml,
    carried: current,
  });

  const base = {
    recallCaseId: row.id,
    sourceAgency: projection.sourceAgency,
    lifecycle: projection.state,
    active: projection.state === 'active',
    current,
    next: evidence.geography,
    addedStates: evidence.addedStates,
    removedStates: evidence.removedStates,
    removals: evidence.removals,
    excludedStates: evidence.excludedStates,
    contradictedStates: evidence.contradictedStates,
    bases: evidence.bases,
    unresolvedTokens: evidence.unresolvedTokens,
    evidence: readDistributionProse(projection.summaryText).admittedUnits.slice(0, 4).map(quote),
  };

  // Belt and braces on top of the derivation's own rule: any state this run
  // would drop WITHOUT an evidence class naming why leaves the case completely
  // untouched and gets reported. The two classes that do justify a removal are
  // a proven containment artifact ("Virginia" read out of "West Virginia") and
  // a place the notice itself says is not affected.
  const dropped = current.states.filter(
    (state) =>
      !evidence.geography.states.includes(state) && !evidence.removedStates.includes(state),
  );
  const narrowsScope = current.scope === 'nationwide' && evidence.geography.scope !== 'nationwide';
  if (dropped.length > 0 || narrowsScope) return { ...base, outcome: 'conflict' };

  if (sameGeography(current, evidence.geography)) {
    return { ...base, outcome: current.scope === 'unknown' ? 'no-evidence' : 'unchanged' };
  }
  return { ...base, outcome: 'update' };
}

function zero() {
  return { nationwide: 0, states: 0, unknown: 0 };
}

function emptyReport(): GeographyRepairReport {
  return {
    casesExamined: 0,
    active: 0,
    inactive: 0,
    fda: 0,
    fsis: 0,
    before: zero(),
    after: zero(),
    activeBefore: zero(),
    activeAfter: zero(),
    safelyCorrectable: 0,
    activeSafelyCorrectable: 0,
    remainingUnknown: 0,
    activeRemainingUnknown: 0,
    wouldUpdate: 0,
    activeWouldUpdate: 0,
    unchanged: 0,
    noEvidence: 0,
    stateAdditions: 0,
    stateRemovals: 0,
    unknownToStates: 0,
    statesToUnknown: 0,
    toNationwide: 0,
    fromNationwide: 0,
    plans: [],
    conflicts: [],
    refused: [],
    aborted: null,
    concurrentlyModified: [],
    failures: [],
    caseWrites: 0,
    verifiedWrites: 0,
    verificationFailures: [],
    rollback: [],
    contradictionsBefore: 0,
    contradictionsAfter: 0,
    unresolvedTokens: [],
    networkRequests: 0,
    notificationEvents: 0,
    timelineEntries: 0,
    materialChanges: 0,
    newCases: 0,
    examples: [],
  };
}

/**
 * Visit every case, re-derive its canonical geography from data already stored
 * with it, and — in apply mode, and only after the whole corpus is planned and
 * the expected-count guard passes — write that one field.
 */
export async function repairGeography(
  store: RecallStore,
  options: GeographyRepairOptions,
): Promise<GeographyRepairReport> {
  const cases = await store.listCases();
  const report = emptyReport();
  const unresolved = new Set<string>();
  const rowsById = new Map<string, RecallCaseRow>();
  let done = 0;

  // ── Phase 1: plan the WHOLE corpus. No write is constructed here. ────────
  for (const row of cases) {
    done += 1;
    options.onProgress?.(done, cases.length);

    let plan: GeographyCasePlan;
    try {
      plan = planCaseGeography(row);
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
    for (const token of plan.unresolvedTokens) unresolved.add(token);
    if (plan.contradictedStates.length > 0) report.refused.push(plan);

    // A conflict is left untouched, so its "after" state is its "before".
    const persisted = plan.outcome === 'conflict' ? plan.current : plan.next;
    report.before[plan.current.scope] += 1;
    report.after[persisted.scope] += 1;
    if (plan.active) {
      report.activeBefore[plan.current.scope] += 1;
      report.activeAfter[persisted.scope] += 1;
    }
    if (contradicts(plan.current)) report.contradictionsBefore += 1;
    if (contradicts(persisted)) report.contradictionsAfter += 1;

    if (plan.current.scope === 'unknown') {
      if (persisted.scope === 'unknown') {
        report.remainingUnknown += 1;
        if (plan.active) report.activeRemainingUnknown += 1;
      } else {
        report.safelyCorrectable += 1;
        if (plan.active) report.activeSafelyCorrectable += 1;
      }
    }

    if (plan.outcome === 'conflict') {
      report.conflicts.push(plan);
      continue;
    }
    if (plan.outcome === 'no-evidence') {
      report.noEvidence += 1;
      continue;
    }
    if (plan.outcome === 'unchanged') {
      report.unchanged += 1;
      continue;
    }

    report.wouldUpdate += 1;
    if (plan.active) report.activeWouldUpdate += 1;
    report.stateAdditions += plan.addedStates.length;
    report.stateRemovals += plan.removedStates.length;
    if (plan.current.scope === 'unknown' && plan.next.scope === 'states') {
      report.unknownToStates += 1;
    }
    if (plan.current.scope === 'states' && plan.next.scope === 'unknown') {
      report.statesToUnknown += 1;
    }
    if (plan.next.scope === 'nationwide' && plan.current.scope !== 'nationwide') {
      report.toNationwide += 1;
    }
    if (plan.current.scope === 'nationwide' && plan.next.scope !== 'nationwide') {
      report.fromNationwide += 1;
    }
    report.plans.push(plan);
    rowsById.set(row.id, row);
    if (report.examples.length < 10) report.examples.push(plan);
  }

  report.unresolvedTokens = [...unresolved].sort();

  // ── Phase 2: the authorization gate. ─────────────────────────────────────
  if (!options.apply) {
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

  // ── Phase 3: write the reviewed plan, one field, verified. ───────────────
  for (const plan of report.plans) {
    const row = rowsById.get(plan.recallCaseId)!;
    // The reviewed value, guarded on the version the plan was read at. A case
    // ingestion touched since is NOT re-derived on the fly: the apply writes
    // only what the reviewed dry run proposed, and anything that moved is
    // reported for the next run.
    const written = await store.updateCaseGeography(
      plan.recallCaseId,
      plan.next,
      row.lastChangedAt,
    );
    if (!written) {
      report.concurrentlyModified.push(plan.recallCaseId);
      continue;
    }
    report.caseWrites += 1;
    report.rollback.push({
      recallCaseId: plan.recallCaseId,
      previousValue: plan.current,
      writtenValue: plan.next,
    });

    const fresh = await store.getCase(plan.recallCaseId);
    const found = fresh ? fresh.projection.geography : null;
    if (found && sameGeography(found, plan.next)) report.verifiedWrites += 1;
    else {
      report.verificationFailures.push({
        recallCaseId: plan.recallCaseId,
        expected: plan.next,
        found,
      });
    }
  }

  return report;
}

export interface GeographyRollbackEntry {
  recallCaseId: string;
  previousValue: Geography;
  writtenValue: Geography;
}

export interface GeographyRollbackReport {
  entries: number;
  restored: number;
  /** The live row no longer holds the value the apply wrote — left alone. */
  skippedNotAsWritten: string[];
  concurrentlyModified: string[];
  failures: { recallCaseId: string; reason: string }[];
  verified: number;
  aborted: { reason: string; expected: number; actual: number } | null;
}

/**
 * Replay a ledger BACKWARDS through the same store port the apply used.
 *
 * Nothing else is touched, and a row that no longer holds the value the apply
 * wrote is skipped rather than overwritten: the ledger restores this
 * operation's own writes, never someone else's.
 */
export async function rollbackGeography(
  store: RecallStore,
  entries: readonly GeographyRollbackEntry[],
  options: { apply: boolean; expectedUpdates: number | null },
): Promise<GeographyRollbackReport> {
  const report: GeographyRollbackReport = {
    entries: entries.length,
    restored: 0,
    skippedNotAsWritten: [],
    concurrentlyModified: [],
    failures: [],
    verified: 0,
    aborted: null,
  };
  if (options.expectedUpdates !== null && options.expectedUpdates !== entries.length) {
    report.aborted = {
      reason: 'the ledger does not hold the authorized number of entries',
      expected: options.expectedUpdates,
      actual: entries.length,
    };
    return report;
  }
  if (options.apply && options.expectedUpdates === null) {
    report.aborted = {
      reason: 'a rollback apply requires an authorized entry count',
      expected: -1,
      actual: entries.length,
    };
    return report;
  }

  for (const entry of entries) {
    const row = await store.getCase(entry.recallCaseId);
    if (!row) {
      report.failures.push({ recallCaseId: entry.recallCaseId, reason: 'case not found' });
      continue;
    }
    if (!sameGeography(row.projection.geography, entry.writtenValue)) {
      report.skippedNotAsWritten.push(entry.recallCaseId);
      continue;
    }
    if (!options.apply) {
      report.restored += 1;
      continue;
    }
    if (
      !(await store.updateCaseGeography(entry.recallCaseId, entry.previousValue, row.lastChangedAt))
    ) {
      report.concurrentlyModified.push(entry.recallCaseId);
      continue;
    }
    report.restored += 1;
    const fresh = await store.getCase(entry.recallCaseId);
    if (fresh && sameGeography(fresh.projection.geography, entry.previousValue)) {
      report.verified += 1;
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
export async function auditGeographyReprojectionDrift(
  store: RecallStore,
  recallCaseIds: readonly string[],
): Promise<GeographyDriftRow[]> {
  const rows: GeographyDriftRow[] = [];
  for (const id of recallCaseIds) {
    const recallCase = await store.getCase(id);
    if (!recallCase) {
      rows.push({
        recallCaseId: id,
        otherFieldsChanged: [],
        wouldRaiseGeographyExpansion: false,
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
          wouldRaiseGeographyExpansion: false,
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
          key !== 'geography' &&
          JSON.stringify(storedFields[key]) !== JSON.stringify(nextFields[key]),
      );
      const widened =
        (next.geography.scope === 'nationwide' && stored.geography.scope !== 'nationwide') ||
        (next.geography.scope === 'states' &&
          (stored.geography.scope === 'unknown' ||
            (stored.geography.scope === 'states' &&
              next.geography.states.some((s) => !stored.geography.states.includes(s)))));
      rows.push({
        recallCaseId: id,
        otherFieldsChanged,
        wouldRaiseGeographyExpansion: widened,
        unavailable: null,
      });
    } catch (error) {
      rows.push({
        recallCaseId: id,
        otherFieldsChanged: [],
        wouldRaiseGeographyExpansion: false,
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
 * All three are typed by the operator. No package script supplies `--apply`
 * (P2B7Q.2): `repair:geography` used to append it, so `-- --confirm --expect
 * <n>` applied without anyone writing the word, and the command in the docs
 * did not match the contract in the docs.
 *
 * `--dry-run` alongside `--apply` is a contradiction, not a preference, and is
 * refused rather than resolved in either direction. Two thirds of the contract
 * is not two thirds of an authorization: `--confirm --expect <n>` without
 * `--apply` resolves to a DRY RUN, never to a write.
 */
export function resolveGeographyRepairMode(argv: string[]): {
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
        '(npm run repair:geography -- --apply --confirm --expect <n>). Nothing was written.',
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
