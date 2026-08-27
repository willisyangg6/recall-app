/**
 * Consumer feed relevance — deliberately separate from source lifecycle.
 *
 * FSIS keeps Public Health Alerts agency-active for years (live evidence:
 * 167 of 178 active cases are PHAs, back to 2014 — FSIS has no closure
 * mechanism for them). "Active" is the truthful lifecycle state and stays
 * untouched; where an item belongs in the consumer feed is a display tier:
 *
 *   - `recent`       — meaningful source-published activity within 60 days.
 *   - `older_active` — still active per the agency, but old news; shown in a
 *                       clearly separated, collapsed-by-default section so it
 *                       never competes visually with new announcements.
 *
 * Old notices are never terminated, hidden, or relabeled based on age.
 */

import type { FeedItem } from './recall-feed';

export type FeedTier = 'recent' | 'older_active';

/** Display default from architecture Part 2.3 — tune with real usage. */
export const RECENT_WINDOW_DAYS = 60;

/**
 * The 60-day boundary itself, applied to whichever activity date the caller
 * considers authoritative. All Recalls uses `lastPublicActivityAt` (below);
 * "Affects me" uses material activity (lib/affects-me-ranking.ts), so the two
 * views share one window definition and can never drift apart on it.
 */
export function tierForActivityDate(activityDate: string, now: Date = new Date()): FeedTier {
  const activity = new Date(`${activityDate.slice(0, 10)}T00:00:00Z`).getTime();
  const ageMs = now.getTime() - activity;
  return ageMs <= RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000 ? 'recent' : 'older_active';
}

export function feedTier(
  item: Pick<FeedItem, 'lastPublicActivityAt'>,
  now: Date = new Date(),
): FeedTier {
  return tierForActivityDate(item.lastPublicActivityAt, now);
}

export interface FeedSections {
  /** Newest-activity-first — the primary Home experience. */
  recent: FeedItem[];
  /** Announcement-date order: honest ages, oldest news last. */
  olderActive: FeedItem[];
}

/**
 * All Recalls display order for the recent tier: newest public activity first.
 *
 * This is the order the server used to sort by (`last_public_activity_at desc,
 * published_at desc`) and is unchanged as product behavior. It moved to the
 * client in C5.1 because the feed is now paged by case id — the server can no
 * longer be the one to order it — and because the old server order was not
 * actually total: 230 of 882 active cases share their (activity, published)
 * pair with another case, and PostgREST guarantees nothing about how tied rows
 * fall. The `id` tie-break settles exactly those ties and nothing else, so the
 * list stops being able to reshuffle between refreshes.
 */
function compareRecentFirst(a: FeedItem, b: FeedItem): number {
  return (
    b.lastPublicActivityAt.localeCompare(a.lastPublicActivityAt) ||
    b.publishedAt.localeCompare(a.publishedAt) ||
    a.id.localeCompare(b.id)
  );
}

export function buildFeedSections(items: FeedItem[], now: Date = new Date()): FeedSections {
  const recent: FeedItem[] = [];
  const olderActive: FeedItem[] = [];
  for (const item of items) {
    (feedTier(item, now) === 'recent' ? recent : olderActive).push(item);
  }
  recent.sort(compareRecentFirst);
  olderActive.sort(
    (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id),
  );
  return { recent, olderActive };
}
