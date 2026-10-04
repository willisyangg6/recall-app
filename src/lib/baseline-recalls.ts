/**
 * The bundled baseline recall corpus (2026-10-04): real, verified recall
 * records the app carries so a shopper's genuine matches can be computed
 * before any corpus has been downloaded — a fresh install with no network.
 *
 * ## What it is
 *
 * `content/baseline-recalls.json` is written by
 * `scripts/record-baseline-recalls.ts` from the PUBLIC consumer feed, by one
 * rule: every active, unmerged case whose material activity falls within the
 * Affects Me recency window at recording time, with each case's detail rows
 * so Recall Detail can render one when the live service cannot answer.
 * Nothing is hand-picked, edited or invented: dates, hazards, locations and
 * identities are the agencies' own, and the records go through the SAME
 * matching, lifecycle and recency rules as a downloaded corpus
 * (`lib/ready-preview.ts` `readyCorpus`). Affects You is computed, never
 * stored.
 *
 * ## How it ages
 *
 * The recency window is measured against the device's clock, so a baseline
 * recorded on `recordedAt` holds fewer current matches each day and none
 * once it is older than the window. That is the truthful outcome — a count
 * is never inflated to hide it — and the reason the script is re-run before
 * each release (`npm run record:baseline`). `baselineAgeDays` lets QA and
 * tests say how old the shipped baseline is.
 */

import baseline from '@/content/baseline-recalls.json';
import { RECENT_WINDOW_DAYS } from '@/lib/feed-relevance';
import type { CaseDetail, FeedItem } from '@/lib/recall-feed';

interface BaselineCase {
  item: FeedItem;
  detail: CaseDetail;
}

interface BaselineDocument {
  recordedAt: string;
  recentActivityDays: number;
  rule: string;
  cases: BaselineCase[];
}

const document = baseline as unknown as BaselineDocument;

/** When the baseline was recorded from the live feed (ISO). */
export const BASELINE_RECORDED_AT: string = document.recordedAt;

/** The baseline as feed rows: what Building and Ready match against offline. */
export const BASELINE_RECALLS: readonly FeedItem[] = document.cases.map((entry) => entry.item);

const DETAILS = new Map(document.cases.map((entry) => [entry.detail.id, entry.detail]));

/**
 * The bundled detail for one baseline recall, or null. Recall Detail falls
 * back to it when the live row cannot be fetched or no longer exists, so a
 * card shown from the baseline always opens.
 */
export function baselineCaseDetail(id: string): CaseDetail | null {
  return DETAILS.get(id) ?? null;
}

/** Whole days since the baseline was recorded, by the given clock. */
export function baselineAgeDays(now: Date = new Date()): number {
  return Math.floor((now.getTime() - Date.parse(BASELINE_RECORDED_AT)) / 86_400_000);
}

/**
 * Release validation (`npm run qa:launch-readiness`): the shipped baseline
 * must still fall inside the recency window, or a fresh install offline would
 * meet an empty preview. Returns the failures, empty when the baseline is
 * current. A hard gate, not a warning.
 */
export function baselineReadinessFailures(now: Date = new Date()): string[] {
  const age = baselineAgeDays(now);
  if (age <= RECENT_WINDOW_DAYS) return [];
  return [
    `The bundled baseline recall corpus is ${age} days old (recorded ${BASELINE_RECORDED_AT.slice(0, 10)}), ` +
      `past the ${RECENT_WINDOW_DAYS}-day recency window: a fresh install offline would show no matches. ` +
      'Re-record it with `npm run record:baseline` (read-only).',
  ];
}
