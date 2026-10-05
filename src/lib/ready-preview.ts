/**
 * The Ready step's recall preview (2026-09-28; one experience over three
 * sources, 2026-10-04): which real recalls the deck shows and what the count
 * counts — the same screen whether the corpus was just downloaded, is the
 * device's cached copy, or is the bundled baseline.
 *
 * ## One matching layer, one card model
 *
 * There is no onboarding matching algorithm. The preview is the Affects You
 * feed's own layers, called in the Feed's own order: every feed item through
 * `evaluatePersonalRelevance`, membership and ordering through
 * `buildAffectsMeSections` (newest first by material activity, then
 * announcement, then id — the one shared feed order since 2026-10-05,
 * inherited here without any change to the deck), and each shown item through
 * `buildHomeCardModel`, the same model the Feed's card draws. The preview
 * shows the CURRENT window (`affects`): recalls that affect the shopper
 * whose last material activity is within the Affects Me recency window. The
 * collapsed older tail the Feed keeps behind a disclosure is not "today"
 * and is not counted here.
 *
 * ## What the count includes and excludes
 *
 * `We found N recalls for you.` counts every current match: a recall whose
 * stated geography names one of the chosen states or is Nationwide (which
 * qualifies for every state, whatever the hazard), or whose geography is
 * unknown but which carries one of the chosen allergen or store signals —
 * less the one allergen-only exclusion the Feed applies. It excludes recalls
 * stated for other states only, unknown-geography recalls with no personal
 * signal, and matches whose material activity is older than the window. It
 * never depends on an image, a product category or a page size, and the
 * Building step reads the same list (`affectsYouMatches`) over the same
 * corpus (`readyCorpus`), so the two screens cannot disagree
 * (`ready-count.test.ts`).
 *
 * ## The corpus (2026-10-04)
 *
 * `readyCorpus` chooses, in order: the feed the shared session answered
 * (a finished sync, or the device's cached corpus, which `useFeed` serves
 * first); else, when the session could not answer at all, the bundled
 * baseline (`lib/baseline-recalls.ts`) — real records under the same rules.
 * The choice is remembered in the process so a screen mounting while the
 * quiet retry is still failing shows the same corpus the last one showed,
 * and it is forgotten the moment a sync succeeds: live results replace the
 * baseline with the genuine corpus and its actual count. The retry itself is
 * the shared feed path (`useFeed`'s mount and foreground revalidation);
 * nothing here asks the network.
 *
 * ## The deck
 *
 * The first `PREVIEW_MATCH_LIMIT` matches in rank order are the readable
 * cards, with or without a product image (a match without one draws the
 * card's own text-led shape, as the Feed does). The next match, when one
 * exists, is the locked final card (a real recall, frosted, never
 * invented), and the locked strip appears only when real matches beyond the
 * readable ones exist. One match is one card, no strip, nothing locked.
 *
 * `none` — the check answered and nothing currently matches — is said
 * plainly with no cards: a defensive state. With a healthy corpus Nationwide
 * recalls make it rare, so an unexpected zero is a data or loading problem
 * to investigate, never something to paper over with a positive count.
 * `checking` claims nothing while the first read is still answering.
 */

import type { UserRecallPreferences } from '@/domain/preferences';
import { buildAffectsMeSections } from '@/lib/affects-me-ranking';
import { BASELINE_RECALLS } from '@/lib/baseline-recalls';
import { matchPositionLabel } from '@/lib/onboarding-copy';
import { buildHomeCardModel, type HomeCardModel } from '@/lib/recall-presentation';
import type { FeedItem } from '@/lib/recall-feed';
import { evaluatePersonalRelevance } from '@/lib/relevance';

/** The most matches the preview ever makes readable. */
export const PREVIEW_MATCH_LIMIT = 3;

/** What the shared feed session has answered, as the hooks report it. */
export type FeedAnswer =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; items: readonly FeedItem[] };

/** Where the corpus Building and Ready work over came from. */
export type CorpusSource = 'feed' | 'baseline';

/** The corpus the Ready step (and the Building step) match against. */
export type ReadyFeedInput =
  { status: 'loading' } | { status: 'ready'; items: readonly FeedItem[]; source?: CorpusSource };

/**
 * Remembered across screens in this process: the session could not answer
 * and the baseline stands in until a sync succeeds.
 */
let baselineActive = false;

/**
 * The one corpus decision (above): the session's answer when it has one,
 * the bundled baseline when it has none. Pure apart from the remembered
 * fallback; `resetReadyCorpusMemory` is for tests.
 */
export function readyCorpus(feed: FeedAnswer): ReadyFeedInput {
  if (feed.status === 'ready') {
    baselineActive = false;
    return { status: 'ready', items: feed.items, source: 'feed' };
  }
  if (feed.status === 'error') baselineActive = true;
  if (baselineActive) return { status: 'ready', items: BASELINE_RECALLS, source: 'baseline' };
  return { status: 'loading' };
}

export function resetReadyCorpusMemory(): void {
  baselineActive = false;
}

export type ReadyPreviewState =
  /** The feed has not answered yet: claim nothing, show the quiet check. */
  | { kind: 'checking' }
  /** The check answered and nothing currently matches: said plainly, no cards. */
  | { kind: 'none'; source: CorpusSource }
  /**
   * Real current matches: up to the limit of readable cards (imaged or not),
   * the REAL next match as the locked card (or null), and the true total.
   */
  | {
      kind: 'matches';
      models: HomeCardModel[];
      locked: HomeCardModel | null;
      total: number;
      source: CorpusSource;
    };

/**
 * Every current match, ranked: the Affects You feed's own current window,
 * through the Feed's own layers. ONE call site for "how many recalls match":
 * the Ready preview's total and the Building step's count are both this
 * list's length, so the two screens can never disagree over one corpus.
 */
export function affectsYouMatches(
  items: readonly FeedItem[],
  prefs: UserRecallPreferences,
  /** The clock the recency window is measured against (tests); the device's by default. */
  now?: Date,
): FeedItem[] {
  return buildAffectsMeSections(items, (item) => evaluatePersonalRelevance(item, prefs), { now })
    .affects;
}

export function buildReadyPreview(
  feed: ReadyFeedInput,
  prefs: UserRecallPreferences,
  today: string,
  now?: Date,
): ReadyPreviewState {
  if (feed.status === 'loading') return { kind: 'checking' };
  const affects = affectsYouMatches(feed.items, prefs, now);
  const source = feed.source ?? 'feed';
  if (affects.length === 0) return { kind: 'none', source };
  // The ranked order, readable up to the limit whether or not a recall has
  // a product image; the deck adds no image logic and never reorders.
  const models = affects
    .slice(0, PREVIEW_MATCH_LIMIT)
    .map((item) => buildHomeCardModel(item, { today, prefs }));
  const next = affects[PREVIEW_MATCH_LIMIT];
  return {
    kind: 'matches',
    models,
    locked: next === undefined ? null : buildHomeCardModel(next, { today, prefs }),
    total: affects.length,
    source,
  };
}

/**
 * More real matches exist than the deck shows. This is what the locked
 * STRIP answers; the locked CARD is `preview.locked`, the real next match.
 */
export function hasLockedMatches(preview: ReadyPreviewState): boolean {
  return preview.kind === 'matches' && preview.total > preview.models.length;
}

/**
 * The count under `Your recall preview`: EVERY real current match — never
 * the deck's length, never a fixed number. Null where there is nothing to
 * count yet (checking) or nothing matched (the empty state says so instead).
 */
export function previewMatchCount(preview: ReadyPreviewState): number | null {
  return preview.kind === 'matches' ? preview.total : null;
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
