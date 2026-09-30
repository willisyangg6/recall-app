/**
 * The Ready step's personalized recall preview (2026-09-28; image-led deck
 * in the polish pass): which real matches the deck shows, and what each one
 * says.
 *
 * ## One matching layer, one card model
 *
 * There is no onboarding matching algorithm. The preview is the Affects You
 * feed's own layers, called in the Feed's own order: every cached feed item
 * through `evaluatePersonalRelevance`, membership and ordering through
 * `buildAffectsMeSections` (risk, geography, personal signal, recency — the
 * current Affects Me ordering, unchanged by this milestone), and each shown
 * item through `buildHomeCardModel`, the same model the Feed's card draws.
 * The preview shows the CURRENT window (`affects`); the collapsed older
 * tail the Feed keeps behind a disclosure is not "today" and is not counted
 * here.
 *
 * ## The image-led deck (polish pass)
 *
 * From the RANKED matches, the deck keeps only recalls with a usable
 * product image (the shared image-role allocation: `heroImageUrl`), in
 * their ranked order. The first `PREVIEW_MATCH_LIMIT` image-bearing matches
 * are the readable cards; the NEXT image-bearing match, when one exists, is
 * the locked final card — a real recall, rendered frosted, never invented.
 * These are the first image-bearing results in rank order, not necessarily
 * the raw first results, and no user-facing copy calls them "top".
 *
 * ## Honesty at the edges
 *
 * The TRUE match total is carried so the locked strip can say more exist —
 * and only then (`hasLockedMatches` compares against every match, imaged or
 * not: an unshown match is an unshown match). Fewer image-bearing matches
 * simply mean fewer cards; a locked card exists only when a real next
 * image-bearing match does; and when matches exist but none carries an
 * image, the deck is empty while the count and the locked strip still tell
 * the truth (`models: []`, `total > 0`). No cached feed yet is `checking`,
 * a feed that could not be read at all is `unavailable`, and zero matches
 * is `none` — never an invented match and never an endless loader.
 */

import type { UserRecallPreferences } from '@/domain/preferences';
import { buildAffectsMeSections } from '@/lib/affects-me-ranking';
import { matchPositionLabel } from '@/lib/onboarding-copy';
import { buildHomeCardModel, type HomeCardModel } from '@/lib/recall-presentation';
import type { FeedItem } from '@/lib/recall-feed';
import { evaluatePersonalRelevance } from '@/lib/relevance';

/** The most matches the preview ever makes readable. */
export const PREVIEW_MATCH_LIMIT = 3;

/** What the feed has answered, as the Ready route sees it. */
export type ReadyFeedInput =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; items: readonly FeedItem[] };

export type ReadyPreviewState =
  /** The feed has not answered yet: claim nothing, show the quiet check. */
  | { kind: 'checking' }
  /** The feed could not be read at all: say so, never an empty claim. */
  | { kind: 'unavailable' }
  /** The feed answered and nothing currently matches. */
  | { kind: 'none' }
  /**
   * Real current matches: up to the limit of image-bearing cards, the REAL
   * next image-bearing match as the locked card (or null), and the true
   * total of every match, imaged or not.
   */
  | { kind: 'matches'; models: HomeCardModel[]; locked: HomeCardModel | null; total: number };

export function buildReadyPreview(
  feed: ReadyFeedInput,
  prefs: UserRecallPreferences,
  today: string,
): ReadyPreviewState {
  if (feed.status === 'loading') return { kind: 'checking' };
  if (feed.status === 'error') return { kind: 'unavailable' };
  const sections = buildAffectsMeSections(feed.items, (item) =>
    evaluatePersonalRelevance(item, prefs),
  );
  const affects = sections.affects;
  if (affects.length === 0) return { kind: 'none' };
  // The ranked order, narrowed to recalls the deck can SHOW: the shared
  // image-role allocation decided `heroImageUrl`; the deck adds no image
  // logic of its own and never reorders.
  const imaged = affects.filter((item) => item.heroImageUrl !== null);
  const models = imaged
    .slice(0, PREVIEW_MATCH_LIMIT)
    .map((item) => buildHomeCardModel(item, { today, prefs }));
  const next = imaged[PREVIEW_MATCH_LIMIT];
  return {
    kind: 'matches',
    models,
    locked: next === undefined ? null : buildHomeCardModel(next, { today, prefs }),
    total: affects.length,
  };
}

/**
 * More real matches exist than the deck shows — imaged or not. This is what
 * the locked STRIP answers; the locked CARD is `preview.locked`, the real
 * next image-bearing match, which requires one to exist.
 */
export function hasLockedMatches(preview: ReadyPreviewState): boolean {
  return preview.kind === 'matches' && preview.total > preview.models.length;
}

/**
 * The pagination dots: one per READABLE match, never one for the locked
 * sentinel, and none at all for a single match (a lone dot says nothing).
 */
export function previewDotCount(preview: ReadyPreviewState): number {
  if (preview.kind !== 'matches' || preview.models.length < 2) return 0;
  return preview.models.length;
}

/**
 * One card's whole spoken value, on the sample card's pattern plus its
 * position among the readable matches. The locked tail is NOT part of this:
 * a hidden recall contributes nothing to the accessibility tree.
 */
export function matchAccessibilityLabel(
  model: HomeCardModel,
  index: number,
  count: number,
): string {
  const parts = [
    matchPositionLabel(index + 1, count),
    model.risk.accessibilityLabel,
    ...(model.affectsYou ? ['Affects you'] : []),
    model.productName,
    ...(model.reasonLine ? [model.reasonLine] : []),
    model.locationSummary,
    model.brand.text,
  ];
  return `${parts.join('. ')}.`;
}
