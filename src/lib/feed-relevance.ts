/**
 * Consumer feed relevance — deliberately separate from source lifecycle.
 *
 * FSIS keeps Public Health Alerts agency-active for years (live evidence:
 * 167 of 178 active cases are PHAs, back to 2014 — FSIS has no closure
 * mechanism for them). "Active" is the truthful lifecycle state and stays
 * untouched; where an item belongs in the consumer feed is a display tier:
 *
 *   - `recent`       — a material (authoritative) event within 60 days.
 *   - `older_active` — still active per the agency, but old news; shown in a
 *                       clearly separated, collapsed-by-default section so it
 *                       never competes visually with new announcements.
 *
 * Old notices are never terminated, hidden, or relabeled based on age.
 *
 * ## One date (2026-10-05, founder decision)
 *
 * Both the window and the order read MATERIAL activity
 * (domain/material-activity.ts): the announcement, or the latest timeline
 * entry the pipeline marked material. Until 2026-10-05 All recalls used
 * `lastPublicActivityAt` for both, which moves on an agency wording edit; a
 * recall could then sit at the top of All recalls, or re-enter Recent
 * activity, on nothing a shopper would call news. It also made the two feeds
 * disagree: an enforcement-dated classification can postdate
 * `lastPublicActivityAt` (live, 2026-10-05: 232 of 911 active cases), so a
 * recall could be "Older" in All recalls and current in Affects me at once.
 * One date ends both.
 */

import { materialActivityAt } from '@/domain/material-activity';
import type { FeedItem } from './recall-feed';
import { sortNewestFirst } from './recency-order';

export type FeedTier = 'recent' | 'older_active';

/** Display default from architecture Part 2.3 — tune with real usage. */
export const RECENT_WINDOW_DAYS = 60;

/**
 * The 60-day boundary itself, applied to a `YYYY-MM-DD` activity date. Both
 * feeds call it with material activity, so they can never drift apart on it.
 */
export function tierForActivityDate(activityDate: string, now: Date = new Date()): FeedTier {
  const activity = new Date(`${activityDate.slice(0, 10)}T00:00:00Z`).getTime();
  const ageMs = now.getTime() - activity;
  return ageMs <= RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000 ? 'recent' : 'older_active';
}

export function feedTier(
  item: Pick<FeedItem, 'publishedAt' | 'timeline'>,
  now: Date = new Date(),
): FeedTier {
  return tierForActivityDate(materialActivityAt(item.publishedAt, item.timeline), now);
}

export interface FeedSections {
  /** Newest material activity first — the primary Home experience. */
  recent: FeedItem[];
  /** The same order: honest ages, oldest news last. */
  olderActive: FeedItem[];
}

/**
 * All Recalls: split by the material window, each section in the one shared
 * order (`lib/recency-order.ts`). The server never orders the feed — it is
 * paged by immutable case id (lib/feed-pagination.ts) — and the old server
 * order was not total: 230 of 882 active cases shared their date pair with
 * another case. The id tie-break settles exactly those ties and nothing else,
 * so the list cannot reshuffle between refreshes.
 */
export function buildFeedSections(items: FeedItem[], now: Date = new Date()): FeedSections {
  const recent: FeedItem[] = [];
  const olderActive: FeedItem[] = [];
  for (const item of items) {
    (feedTier(item, now) === 'recent' ? recent : olderActive).push(item);
  }
  return { recent: sortNewestFirst(recent), olderActive: sortNewestFirst(olderActive) };
}
