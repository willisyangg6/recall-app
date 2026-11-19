/**
 * The retailer notice review queue (docs/recall-retailer-notices.md, "Review
 * queue"): what an operator must act on, kept apart from what the monitors
 * merely COLLECTED. Collecting a letter publishes nothing; a notice reaches
 * shoppers only through an approval that consumer_retailer_notices() still
 * honours. Pure, so the classification is tested; ops:health prints it.
 *
 * The visibility test here is the RPC's own, condition for condition
 * (20261118000000 consumer_retailer_notices): live approval, no confirmed
 * agency match, approval hash = current letter hash, and the monitor still
 * classes it a standalone food recall read from text with a stated date.
 */

import { RETAILER_BACKFILL_HORIZON_DAYS } from './notice-events';

export interface QueueNotice {
  id: string;
  publisher: string;
  nativeId: string;
  indexTitle: string;
  decision: 'new_candidate' | 'link_candidate' | 'review' | 'excluded';
  noticeKind: string;
  foodStatus: string;
  documentExtraction: string;
  statedNoticeDate: string | null;
  documentContentHash: string;
  firstSeenAt: string;
}

export interface QueueApproval {
  noticeId: string;
  documentContentHash: string;
  withdrawnAt: string | null;
  agencyCaseId: string | null;
}

export type QueueBucket =
  /** Shoppers see it now. */
  | 'published'
  /** A standalone food recall nobody has approved: approve or leave. */
  | 'needs_approval'
  /** Approved, but the retailer revised the letter: hidden until re-approved. */
  | 'revised_letter'
  /** Approved, but the monitor now sees an agency case: confirm the match or withdraw. */
  | 'agency_match_to_confirm'
  /** The monitor could not decide (ambiguous match, unclear letter): a human decides. */
  | 'needs_decision';

export interface QueueItem {
  bucket: QueueBucket;
  publisher: string;
  nativeId: string;
  title: string;
  statedNoticeDate: string | null;
  firstSeenAt: string;
  /**
   * Approving it now would alert matching shoppers (the letter is inside the
   * 30-day backfill horizon); false = approval publishes it with no alert.
   */
  wouldAlert: boolean;
}

export interface ReviewQueue {
  /** Notices the monitors have stored (collected), whatever their state. */
  collected: number;
  items: QueueItem[];
  counts: Record<QueueBucket, number>;
}

function standaloneFoodRecall(notice: QueueNotice): boolean {
  return (
    notice.decision === 'new_candidate' &&
    notice.noticeKind === 'recall' &&
    notice.foodStatus === 'food' &&
    notice.documentExtraction === 'text' &&
    notice.statedNoticeDate !== null
  );
}

function withinBackfillHorizon(statedNoticeDate: string | null, now: Date): boolean {
  if (statedNoticeDate === null) return false;
  const age = now.getTime() - Date.parse(`${statedNoticeDate.slice(0, 10)}T00:00:00Z`);
  return age <= RETAILER_BACKFILL_HORIZON_DAYS * 86_400_000;
}

export function summarizeRetailerReviewQueue(
  notices: readonly QueueNotice[],
  approvals: readonly QueueApproval[],
  now: Date,
): ReviewQueue {
  const live = new Map<string, QueueApproval>();
  const everApproved = new Set<string>();
  for (const approval of approvals) {
    everApproved.add(approval.noticeId);
    if (approval.withdrawnAt === null) live.set(approval.noticeId, approval);
  }
  const items: QueueItem[] = [];
  for (const notice of notices) {
    const approval = live.get(notice.id) ?? null;
    let bucket: QueueBucket | null = null;
    if (approval !== null && approval.agencyCaseId === null) {
      if (approval.documentContentHash !== notice.documentContentHash) bucket = 'revised_letter';
      else if (standaloneFoodRecall(notice)) bucket = 'published';
      else if (notice.decision === 'link_candidate' || notice.decision === 'review') {
        bucket = 'agency_match_to_confirm';
      } else bucket = 'needs_decision'; // approved, but no longer a publishable letter
    } else if (approval === null && !everApproved.has(notice.id)) {
      // A withdrawn approval is a decision already made: never re-queued.
      if (standaloneFoodRecall(notice)) bucket = 'needs_approval';
      else if (notice.decision === 'review') bucket = 'needs_decision';
    }
    if (bucket === null) continue;
    items.push({
      bucket,
      publisher: notice.publisher,
      nativeId: notice.nativeId,
      title: notice.indexTitle.slice(0, 120),
      statedNoticeDate: notice.statedNoticeDate,
      firstSeenAt: notice.firstSeenAt,
      wouldAlert: withinBackfillHorizon(notice.statedNoticeDate, now),
    });
  }
  // Newest letters first: they are the ones that would still alert.
  items.sort((a, b) =>
    (b.statedNoticeDate ?? b.firstSeenAt).localeCompare(a.statedNoticeDate ?? a.firstSeenAt),
  );
  const counts: Record<QueueBucket, number> = {
    published: 0,
    needs_approval: 0,
    revised_letter: 0,
    agency_match_to_confirm: 0,
    needs_decision: 0,
  };
  for (const item of items) counts[item.bucket] += 1;
  return { collected: notices.length, items, counts };
}

/** Plain-language lines for ops:health. Collection is never called publication. */
export function formatRetailerReviewQueue(queue: ReviewQueue, maxPerBucket = 8): string[] {
  const lines = [
    `  collected (stored, private):  ${queue.collected}`,
    `  published (shoppers see it):  ${queue.counts.published}`,
    `  ACTION needed:                ${
      queue.counts.needs_approval +
      queue.counts.revised_letter +
      queue.counts.agency_match_to_confirm +
      queue.counts.needs_decision
    }`,
  ];
  const sections: [QueueBucket, string][] = [
    ['revised_letter', 'revised letter, hidden until re-approved'],
    ['agency_match_to_confirm', 'approved, now matches an agency case: confirm or withdraw'],
    ['needs_approval', 'standalone food recall, not approved (not published)'],
    ['needs_decision', 'monitor could not decide: review'],
  ];
  for (const [bucket, label] of sections) {
    const rows = queue.items.filter((item) => item.bucket === bucket);
    if (rows.length === 0) continue;
    const alerting = rows.filter((row) => row.wouldAlert).length;
    lines.push(
      `  ${label}: ${rows.length}` +
        (bucket === 'needs_approval' ? ` (${alerting} would alert if approved now)` : ''),
    );
    for (const row of rows.slice(0, maxPerBucket)) {
      lines.push(
        `    · ${row.publisher} ${row.nativeId} ${row.statedNoticeDate ?? 'undated'}` +
          `${row.wouldAlert ? ' [alerts]' : ''}: ${row.title}`,
      );
    }
    if (rows.length > maxPerBucket) lines.push(`    · … ${rows.length - maxPerBucket} more`);
  }
  return lines;
}
