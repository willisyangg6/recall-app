/**
 * Which live records the bundled baseline carries (2026-10-06): exactly the
 * records the app would COUNT at recording time, so an offline install counts
 * by the same rules as a downloaded corpus. Pure, shared by the recorder
 * (`scripts/record-baseline-recalls.ts`) and its tests — the recorder never
 * re-implements eligibility.
 *
 * A record is carried when its material activity is within the 60-day window
 * at `recordedAt`, or an agency confirms it is still open then
 * (`confirmedOpen`, lib/open-evidence.ts). Each record keeps its own
 * `fdaOngoingAsOf`, so on the device the evidence expires on the same 21-day
 * clock as live evidence: the baseline can never keep counting a recall past
 * the moment a live corpus would stop.
 */

import { materialActivityAt } from '@/domain/material-activity';

import { tierForActivityDate } from './feed-relevance';
import { confirmedOpen } from './open-evidence';
import type { FeedItem } from './recall-feed';

export const BASELINE_RULE =
  'every active, unmerged consumer-feed case whose material activity is within the window, ' +
  'or that an agency confirms is still open, at recordedAt';

/**
 * The recorder refuses FDA evidence older than this: a release must never ship
 * evidence already most of the way to its 21-day device expiry.
 */
export const BASELINE_MAX_EVIDENCE_AGE_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export function baselineIncludes(item: FeedItem, recordedAt: Date): boolean {
  return (
    item.state === 'active' &&
    (tierForActivityDate(materialActivityAt(item.publishedAt, item.timeline), recordedAt) ===
      'recent' ||
      confirmedOpen(item, recordedAt))
  );
}

/** The newest FDA evidence date in a corpus, or null when none carries any. */
export function newestEvidenceDate(items: readonly FeedItem[]): string | null {
  let newest: string | null = null;
  for (const item of items) {
    if (item.fdaOngoingAsOf !== null && (newest === null || item.fdaOngoingAsOf > newest)) {
      newest = item.fdaOngoingAsOf;
    }
  }
  return newest;
}

/**
 * Why the recorder must refuse this live corpus, or null. No evidence at all
 * means the open-evidence sync has not populated the feed yet (a baseline
 * recorded then would silently drop every confirmed-open recall); stale
 * evidence means the weekly sync has stopped.
 */
export function baselineRecordingRefusal(
  items: readonly FeedItem[],
  recordedAt: Date,
): string | null {
  const newest = newestEvidenceDate(items);
  if (newest === null) {
    return (
      'the live feed carries no FDA open evidence (fda_ongoing_as_of): the open-evidence sync has ' +
      'not populated it yet, and a baseline recorded now would omit every confirmed-open recall'
    );
  }
  const ageDays = (recordedAt.getTime() - Date.parse(`${newest}T00:00:00Z`)) / DAY_MS;
  if (ageDays > BASELINE_MAX_EVIDENCE_AGE_DAYS) {
    return (
      `the newest FDA open evidence is from ${newest}, ${Math.floor(ageDays)} days old ` +
      `(limit ${BASELINE_MAX_EVIDENCE_AGE_DAYS}): the weekly enforcement sync has stopped`
    );
  }
  return null;
}
