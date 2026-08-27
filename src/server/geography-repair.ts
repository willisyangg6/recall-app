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
 */

import { evaluateGeographyEvidence } from '../domain/geography-evidence';
import type { CaseProjection, Geography } from '../domain/recall-types';
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
  /** Which evidence kinds contributed: 'prose', 'table'. */
  bases: string[];
  /** Table fragments that look state-like and were deliberately not guessed. */
  unresolvedTokens: string[];
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
  conflicts: GeographyCasePlan[];
  concurrentlyModified: string[];
  failures: { recallCaseId: string; reason: string }[];
  /**
   * scope/state-list disagreements — `states` with an empty list, or a
   * non-`states` scope carrying one. The gate is 0, before and after.
   */
  contradictionsBefore: number;
  contradictionsAfter: number;
  /** Fragments in state-role table columns that resolve to nothing. */
  unresolvedTokens: string[];
  /** Network requests this operation performs. Zero by construction. */
  networkRequests: number;
  caseWrites: number;
  notificationEvents: number;
  newCases: number;
  examples: GeographyCasePlan[];
}

export interface GeographyRepairOptions {
  apply: boolean;
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
    bases: evidence.bases,
    unresolvedTokens: evidence.unresolvedTokens,
  };

  // Belt and braces on top of the derivation's own widening rule: any state
  // this run would drop for a reason other than a proven containment artifact
  // leaves the case completely untouched and gets reported.
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

/**
 * Visit every case, re-derive its canonical geography from data already stored
 * with it, and (in apply mode) write only that one field.
 *
 * Idempotent and resumable: every decision is made from current state, so a
 * completed run is a no-op and an interrupted one simply resumes.
 */
export async function repairGeography(
  store: RecallStore,
  options: GeographyRepairOptions,
): Promise<GeographyRepairReport> {
  const cases = await store.listCases();
  const zero = () => ({ nationwide: 0, states: 0, unknown: 0 });
  const report: GeographyRepairReport = {
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
    conflicts: [],
    concurrentlyModified: [],
    failures: [],
    contradictionsBefore: 0,
    contradictionsAfter: 0,
    unresolvedTokens: [],
    networkRequests: 0,
    caseWrites: 0,
    notificationEvents: 0,
    newCases: 0,
    examples: [],
  };

  const unresolved = new Set<string>();
  let done = 0;

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
    if (report.examples.length < 10) report.examples.push(plan);

    if (!options.apply) continue;

    if (await store.updateCaseGeography(row.id, plan.next, row.lastChangedAt)) {
      report.caseWrites += 1;
      continue;
    }

    // Scheduled ingestion wrote this case while the run was in progress. The
    // newer data stands; re-derive from it and try once more, because the
    // fresher text may well state a different geography.
    const fresh = await store.getCase(row.id);
    if (!fresh) {
      report.failures.push({ recallCaseId: row.id, reason: 'case disappeared during repair' });
      continue;
    }
    const replan = planCaseGeography(fresh);
    if (replan.outcome !== 'update') {
      report.concurrentlyModified.push(row.id);
      continue;
    }
    if (await store.updateCaseGeography(fresh.id, replan.next, fresh.lastChangedAt)) {
      report.caseWrites += 1;
      continue;
    }
    // Still moving. Report it and leave it for the next run rather than
    // racing the scheduler indefinitely.
    report.concurrentlyModified.push(row.id);
  }

  report.unresolvedTokens = [...unresolved].sort();
  return report;
}
