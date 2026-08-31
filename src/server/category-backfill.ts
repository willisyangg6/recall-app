/**
 * Historical product-category enrichment (Phase C10A) — an explicit
 * maintenance operation, deliberately outside normal ingestion.
 *
 * Why it is needed: `projection.productCategories` is derived inside
 * `projectCase`, and incremental ingestion re-projects a case only when its
 * source page's content hash moves. Every case stored before C10A therefore
 * carries no categories at all and would stay that way forever under normal
 * operation — by design, because re-fetching unchanged pages is what the hash
 * gate exists to prevent.
 *
 * Why it needs no network: the derivation reads the case's own projected
 * title, product description and affected-product names, all already
 * persisted. It runs the CANONICAL `deriveProductCategories`
 * (domain/projection.ts) that `projectCase` now owns — never a second,
 * backfill-only classifier — so an enriched case holds exactly what a full
 * re-projection would have produced, and the next legitimate re-projection
 * recomputes the same answer instead of erasing it.
 *
 * What it touches: `projection.productCategories`, and nothing else. It
 * writes through the minimum-state CAS shape the FDA hero-image and retailer
 * backfills established — timeline and lastChangedAt carried through
 * byte-identical — so it deliberately bypasses the pipeline's re-projection
 * path. It therefore never creates a case, never merges or splits one, never
 * runs material-change detection, never writes a NotificationEvent, and never
 * touches identity, lineage, classification, geography, package data, or
 * visuals.
 *
 * A category enrichment is not a material recall change: `detectChanges`
 * (domain/material-change.ts) does not diff `productCategories` under any
 * rule, so a category-only difference is structurally incapable of producing
 * a notification even if it went through the normal path. This command does
 * not go through it either.
 *
 * Safe to run WHILE scheduled ingestion is running, which matters because the
 * agency jobs tick every 30 minutes and this run takes minutes. Each write is
 * a compare-and-set on `last_changed_at` (the value every real projection
 * write moves) and patches the projection column alone, so an ingest that
 * lands mid-run cannot be rolled back: the write simply matches no row. That
 * case is then re-read, re-derived from the NEWER text, and retried once;
 * anything still moving is reported and left for the next run. The backfill
 * deliberately takes no job lease — blocking the agency feeds for the length
 * of a maintenance pass would be a worse failure than skipping a few cases.
 *
 * The dry run is also the VERIFICATION report: it recomputes everything from
 * live state, so running it after an apply shows the remaining gap — expected
 * `would update: 0`.
 */

import { FOOD_CATEGORY_IDS, type FoodCategoryId } from '../domain/food-category';
import { deriveProductCategories, readProductCategories } from '../domain/projection';
import type { CaseProjection } from '../domain/recall-types';
import type { RecallCaseRow, RecallStore } from './store/types';

/** What the enrichment decided about one case. */
export type CategoryCaseOutcome =
  /** Gains categories it does not have, or corrects stale ones. */
  | 'update'
  /** Already holds exactly the canonical categories. */
  | 'unchanged';

export interface CategoryCasePlan {
  recallCaseId: string;
  sourceAgency: string;
  lifecycle: string;
  active: boolean;
  outcome: CategoryCaseOutcome;
  /** null when the projection predates the field entirely. */
  current: FoodCategoryId[] | null;
  next: FoodCategoryId[];
}

export interface CategoryBackfillReport {
  casesExamined: number;
  active: number;
  inactive: number;
  fda: number;
  fsis: number;
  /** Cases that already carried a derived category list. */
  currentlyBearing: number;
  wouldUpdate: number;
  /** Of the planned updates, how many overwrite an existing (stale) list. */
  updatesOverExisting: number;
  unchanged: number;
  /** Distribution the corpus would hold after the run, all cases and active. */
  distribution: Record<string, number>;
  activeDistribution: Record<string, number>;
  multiCategory: number;
  activeMultiCategory: number;
  otherOnly: number;
  activeOtherOnly: number;
  /**
   * Cases scheduled ingestion wrote while this run was in progress. Their
   * newer data was left untouched; a later run picks them up.
   */
  concurrentlyModified: string[];
  failures: { recallCaseId: string; reason: string }[];
  /** Network requests this operation performs. Zero by construction. */
  networkRequests: number;
  caseWrites: number;
  notificationEvents: number;
  newCases: number;
  timelineWrites: number;
  examples: CategoryCasePlan[];
}

export interface CategoryBackfillOptions {
  apply: boolean;
  /** Progress reporting; the script prints, tests stay silent. */
  onProgress?: (done: number, total: number) => void;
}

function sameCategories(a: readonly string[] | null, b: readonly string[]): boolean {
  return a !== null && a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Plan one case. Pure: given the stored projection it decides the outcome with
 * no I/O, which is what makes the dry run an honest preview of the apply and
 * the whole operation idempotent.
 */
export function planCaseCategories(row: RecallCaseRow): CategoryCasePlan {
  const projection: CaseProjection = row.projection;
  const current = readProductCategories(projection);
  const next = deriveProductCategories({
    sourceAgency: projection.sourceAgency,
    title: projection.title,
    productDescription: projection.productDescription ?? null,
    affectedProducts: projection.affectedProducts ?? [],
    // C10A.1: the canonical derivation reads one bounded span of the
    // announcement. Passing it here is what keeps an enriched case identical
    // to what a full re-projection would have produced — omitting it would
    // make the backfill a second, weaker classifier.
    summaryText: projection.summaryText ?? null,
  });

  return {
    recallCaseId: row.id,
    sourceAgency: projection.sourceAgency,
    lifecycle: projection.state,
    active: projection.state === 'active',
    outcome: sameCategories(current, next) ? 'unchanged' : 'update',
    current,
    next,
  };
}

/**
 * Visit every case in bounded pages, re-derive its canonical categories from
 * data already stored with it, and (in apply mode) write only that one field.
 *
 * Idempotent and resumable: every decision is made from current state, so a
 * completed run is a no-op and an interrupted one simply resumes.
 */
export async function backfillProductCategories(
  store: RecallStore,
  options: CategoryBackfillOptions,
): Promise<CategoryBackfillReport> {
  // `listCases` pages at 500 internally — PostgREST caps unbounded selects and
  // a case row carries its whole projection.
  const cases = await store.listCases();

  const emptyDistribution = (): Record<string, number> =>
    Object.fromEntries(FOOD_CATEGORY_IDS.map((id) => [id, 0]));

  const report: CategoryBackfillReport = {
    casesExamined: 0,
    active: 0,
    inactive: 0,
    fda: 0,
    fsis: 0,
    currentlyBearing: 0,
    wouldUpdate: 0,
    updatesOverExisting: 0,
    unchanged: 0,
    distribution: emptyDistribution(),
    activeDistribution: emptyDistribution(),
    multiCategory: 0,
    activeMultiCategory: 0,
    otherOnly: 0,
    activeOtherOnly: 0,
    concurrentlyModified: [],
    failures: [],
    networkRequests: 0,
    caseWrites: 0,
    notificationEvents: 0,
    newCases: 0,
    timelineWrites: 0,
    examples: [],
  };

  let done = 0;
  for (const row of cases) {
    done += 1;
    options.onProgress?.(done, cases.length);

    let plan: CategoryCasePlan;
    try {
      plan = planCaseCategories(row);
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
    if (plan.current !== null) report.currentlyBearing += 1;

    for (const id of plan.next) {
      report.distribution[id] += 1;
      if (plan.active) report.activeDistribution[id] += 1;
    }
    if (plan.next.length > 1) {
      report.multiCategory += 1;
      if (plan.active) report.activeMultiCategory += 1;
    }
    if (plan.next.length === 1 && plan.next[0] === 'other') {
      report.otherOnly += 1;
      if (plan.active) report.activeOtherOnly += 1;
    }

    if (plan.outcome === 'unchanged') {
      report.unchanged += 1;
      continue;
    }

    report.wouldUpdate += 1;
    if (plan.current !== null) report.updatesOverExisting += 1;
    if (report.examples.length < 8) report.examples.push(plan);

    if (!options.apply) continue;

    // Minimum required projection state: one field, written only while the row
    // still reads as it did when this run loaded it. Timeline and
    // lastChangedAt are not in the payload at all — a maintenance enrichment
    // is not public activity and must not reorder or re-date anything.
    if (await store.updateCaseProductCategories(row.id, plan.next, row.lastChangedAt)) {
      report.caseWrites += 1;
      continue;
    }

    // Scheduled ingestion wrote this case while the run was in progress. The
    // newer data stands; re-derive from it and try once more, because the
    // fresher text may well name a different product.
    const fresh = await store.getCase(row.id);
    if (!fresh) {
      report.failures.push({ recallCaseId: row.id, reason: 'case disappeared during backfill' });
      continue;
    }
    const replan = planCaseCategories(fresh);
    if (replan.outcome !== 'update') {
      // The newer projection already carries the right categories — a normal
      // re-projection got there first, which is the system working.
      report.concurrentlyModified.push(row.id);
      continue;
    }
    if (await store.updateCaseProductCategories(fresh.id, replan.next, fresh.lastChangedAt)) {
      report.caseWrites += 1;
      continue;
    }
    // Still moving. Report it and leave it for the next run rather than racing
    // the scheduler indefinitely.
    report.concurrentlyModified.push(row.id);
  }

  return report;
}
