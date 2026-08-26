/**
 * Historical retailer-evidence repair (Phase C3.1) — an explicit maintenance
 * operation, deliberately outside normal ingestion.
 *
 * Why it is needed: `projection.retailerNames` became the field retailer
 * personalization matches on, but almost every stored case was projected
 * before it existed (census: 4 of 1,911 carried any retailer at all, while
 * 254 have derivable verb-gated evidence). Incremental ingestion re-projects
 * a case only when its source page's content hash moves, so those cases would
 * stay retailer-blind forever under normal operation — by design, because
 * re-fetching unchanged pages is what the hash gate exists to prevent.
 *
 * Why it needs no network: the derivation reads the case's own projected
 * title and summary text, which are already persisted. It runs the CANONICAL
 * `deriveRetailerNames` (domain/retailer-evidence.ts) that `projectCase` now
 * owns — never a second, backfill-only parser — so a repaired case holds
 * exactly what a full re-projection would have produced, and the next
 * legitimate re-projection recomputes the same answer instead of erasing it.
 *
 * What it touches: `projection.retailerNames`, and nothing else. It writes
 * through the minimum-state `updateCase` shape the FDA hero-image backfill
 * established — timeline and lastChangedAt carried through byte-identical —
 * so it deliberately bypasses the pipeline's re-projection path. It therefore
 * never creates a case, never merges or splits one, never runs
 * material-change detection, never writes a NotificationEvent, never moves an
 * announcement or material-change date, and never touches identity, lineage,
 * classification, geography, package data, or visuals.
 *
 * A projection repair is not a material recall change: `detectChanges`
 * (domain/material-change.ts) does not diff `retailerNames` under any rule, so
 * a retailer-only difference is structurally incapable of producing a
 * notification even if it went through the normal path. This command does not
 * go through it either.
 *
 * Conflicts are reported, never resolved: if a case carries a stored retailer
 * the hardened contract now rejects, the case is left completely untouched
 * and listed for a human. Deleting stored evidence is not a repair.
 *
 * Safe to run WHILE scheduled ingestion is running, which matters because the
 * FDA and FSIS jobs tick every 30 minutes and this run takes minutes. Each
 * write is a compare-and-set on `last_changed_at` (the value every real
 * projection write moves) and patches the projection column alone, so an
 * ingest that lands mid-run cannot be rolled back: the write simply matches
 * no row. That case is then re-read, re-derived from the NEWER text, and
 * retried once; anything still moving is reported and left for the next run.
 * The backfill deliberately takes no job lease — blocking the agency feeds
 * for the length of a maintenance pass, and stranding them if it crashed,
 * would be a worse failure than skipping a handful of cases.
 *
 * The dry run is also the VERIFICATION report: it recomputes everything from
 * live state, so running it after an apply shows the remaining gap — expected
 * `would update: 0`.
 */

import { evaluateRetailerEvidence } from '../domain/retailer-evidence';
import { canonicalRetailerIds } from '../domain/retailer-catalog';
import type { CaseProjection } from '../domain/recall-types';
import type { RecallCaseRow, RecallStore } from './store/types';

/** What the repair decided about one case. */
export type RetailerCaseOutcome =
  /** Gains or corrects retailer evidence. */
  | 'update'
  /** Already holds exactly the canonical evidence. */
  | 'unchanged'
  /** The source states no retailer relationship — most cases. */
  | 'no-evidence'
  /** Stored evidence the hardened contract rejects; left for a human. */
  | 'conflict';

export interface RetailerCasePlan {
  recallCaseId: string;
  sourceAgency: string;
  lifecycle: string;
  active: boolean;
  outcome: RetailerCaseOutcome;
  current: string[];
  next: string[];
  /** Stored names the contract rejects — populated only for conflicts. */
  rejectedCarried: string[];
}

export interface RetailerBackfillReport {
  casesExamined: number;
  active: number;
  inactive: number;
  fda: number;
  fsis: number;
  /** Cases that already carried at least one retailer name. */
  currentlyBearing: number;
  /** Cases with derivable verb-gated evidence after the repair. */
  safelyDerivable: number;
  activeSafelyDerivable: number;
  wouldUpdate: number;
  /** Of the planned updates, how many touch a case that already had names. */
  updatesOverExisting: number;
  unchanged: number;
  noEvidence: number;
  conflicts: RetailerCasePlan[];
  /**
   * Cases scheduled ingestion wrote while this run was in progress. Their
   * newer data was left untouched; a later run picks them up.
   */
  concurrentlyModified: string[];
  failures: { recallCaseId: string; reason: string }[];
  /** Active cases gaining at least one retailer they did not have. */
  activeGainingRetailers: number;
  catalogMatchableBefore: number;
  catalogMatchableAfter: number;
  activeCatalogMatchableBefore: number;
  activeCatalogMatchableAfter: number;
  /** Distinct source-grounded strings that would be persisted. */
  distinctRetailerStrings: number;
  resolvedThroughCatalog: number;
  intentionallyUnresolved: number;
  /** Network requests this operation performs. Zero by construction. */
  networkRequests: number;
  caseWrites: number;
  notificationEvents: number;
  newCases: number;
  examples: RetailerCasePlan[];
}

export interface RetailerBackfillOptions {
  apply: boolean;
  /** Progress reporting; the script prints, tests stay silent. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Plan one case. Pure: given the stored projection it decides the outcome
 * with no I/O, which is what makes the dry run an honest preview of the
 * apply and the whole operation idempotent.
 */
export function planCaseRetailers(row: RecallCaseRow): RetailerCasePlan {
  const projection: CaseProjection = row.projection;
  const current = projection.retailerNames ?? [];
  const { names, rejectedCarried } = evaluateRetailerEvidence({
    title: projection.title,
    summaryText: projection.summaryText,
    carried: current,
    geography: projection.geography,
  });

  const base = {
    recallCaseId: row.id,
    sourceAgency: projection.sourceAgency,
    lifecycle: projection.state,
    active: projection.state === 'active',
    current: [...current],
    next: names,
    rejectedCarried,
  };

  // Stored evidence the contract rejects is never silently deleted: the case
  // is left exactly as it is and reported.
  if (rejectedCarried.length > 0) return { ...base, outcome: 'conflict' };
  if (sameNames(current, names)) {
    return { ...base, outcome: names.length === 0 ? 'no-evidence' : 'unchanged' };
  }
  return { ...base, outcome: 'update' };
}

/** Order matters (source order is preserved), so compare as sequences. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

/**
 * Visit every case, re-derive its canonical retailer evidence from data
 * already stored with it, and (in apply mode) write only that one field.
 *
 * Idempotent and resumable: every decision is made from current state, so a
 * completed run is a no-op and an interrupted one simply resumes.
 */
export async function backfillRetailerNames(
  store: RecallStore,
  options: RetailerBackfillOptions,
): Promise<RetailerBackfillReport> {
  const cases = await store.listCases();

  const report: RetailerBackfillReport = {
    casesExamined: 0,
    active: 0,
    inactive: 0,
    fda: 0,
    fsis: 0,
    currentlyBearing: 0,
    safelyDerivable: 0,
    activeSafelyDerivable: 0,
    wouldUpdate: 0,
    updatesOverExisting: 0,
    unchanged: 0,
    noEvidence: 0,
    conflicts: [],
    concurrentlyModified: [],
    failures: [],
    activeGainingRetailers: 0,
    catalogMatchableBefore: 0,
    catalogMatchableAfter: 0,
    activeCatalogMatchableBefore: 0,
    activeCatalogMatchableAfter: 0,
    distinctRetailerStrings: 0,
    resolvedThroughCatalog: 0,
    intentionallyUnresolved: 0,
    networkRequests: 0,
    caseWrites: 0,
    notificationEvents: 0,
    newCases: 0,
    examples: [],
  };

  const distinct = new Set<string>();
  let done = 0;

  for (const row of cases) {
    done += 1;
    options.onProgress?.(done, cases.length);

    let plan: RetailerCasePlan;
    try {
      plan = planCaseRetailers(row);
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

    if (plan.current.length > 0) report.currentlyBearing += 1;
    if (plan.next.length > 0) {
      report.safelyDerivable += 1;
      if (plan.active) report.activeSafelyDerivable += 1;
    }
    for (const name of plan.next) distinct.add(name.trim().toLowerCase());

    const matchableBefore = canonicalRetailerIds(plan.current).length > 0;
    // A conflict is left untouched, so its "after" state is its "before".
    const persisted = plan.outcome === 'conflict' ? plan.current : plan.next;
    const matchableAfter = canonicalRetailerIds(persisted).length > 0;
    if (matchableBefore) {
      report.catalogMatchableBefore += 1;
      if (plan.active) report.activeCatalogMatchableBefore += 1;
    }
    if (matchableAfter) {
      report.catalogMatchableAfter += 1;
      if (plan.active) report.activeCatalogMatchableAfter += 1;
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
    if (plan.current.length > 0) report.updatesOverExisting += 1;
    if (plan.active && plan.next.length > plan.current.length) {
      report.activeGainingRetailers += 1;
    }
    if (report.examples.length < 8) report.examples.push(plan);

    if (!options.apply) continue;

    // Minimum required projection state: one field, written only while the
    // row still reads as it did when this run loaded it. Timeline and
    // lastChangedAt are not in the payload at all — a maintenance repair is
    // not public activity and must not reorder or re-date anything.
    if (await store.updateCaseRetailerNames(row.id, plan.next, row.lastChangedAt)) {
      report.caseWrites += 1;
      continue;
    }

    // Scheduled ingestion wrote this case while the run was in progress. The
    // newer data stands; re-derive from it and try once more, because the
    // fresher text may well state a different retailer.
    const fresh = await store.getCase(row.id);
    if (!fresh) {
      report.failures.push({ recallCaseId: row.id, reason: 'case disappeared during backfill' });
      continue;
    }
    const replan = planCaseRetailers(fresh);
    if (replan.outcome !== 'update') {
      // The newer projection already carries the right names, states no
      // retailer, or now conflicts — either way there is nothing to write.
      report.concurrentlyModified.push(row.id);
      continue;
    }
    if (await store.updateCaseRetailerNames(fresh.id, replan.next, fresh.lastChangedAt)) {
      report.caseWrites += 1;
      continue;
    }
    // Still moving. Report it and leave it for the next run rather than
    // racing the scheduler indefinitely.
    report.concurrentlyModified.push(row.id);
  }

  report.distinctRetailerStrings = distinct.size;
  report.resolvedThroughCatalog = [...distinct].filter(
    (name) => canonicalRetailerIds([name]).length > 0,
  ).length;
  report.intentionallyUnresolved = distinct.size - report.resolvedThroughCatalog;

  return report;
}
