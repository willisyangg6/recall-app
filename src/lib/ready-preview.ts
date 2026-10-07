/**
 * The Ready step's recall preview (2026-09-28; one experience over three
 * sources, 2026-10-04; priority-group selection, 2026-10-05): which real
 * recalls the deck shows and what the count counts — the same screen whether
 * the corpus was just downloaded, is the device's cached copy, or is the
 * bundled baseline.
 *
 * ## One matching layer, one card model
 *
 * There is no onboarding matching algorithm. The preview is the Affects You
 * feed's own layers, called in the Feed's own order: every feed item through
 * `evaluatePersonalRelevance`, membership and ordering through
 * `buildAffectsMeSections` (newest first by material activity, then
 * announcement, then id — the one shared feed order since 2026-10-05), and
 * each shown item through `buildHomeCardModel`, the same model the Feed's
 * card draws. The preview shows the COUNTED list (`affects`): recalls that
 * affect the shopper whose last material activity is within the Affects Me
 * recency window, or that an agency confirms are still open (2026-10-06,
 * `lib/open-evidence.ts`). The Feed's collapsed Older notices — matches no
 * agency currently confirms are open — are not counted here.
 *
 * ## What the count includes and excludes
 *
 * `We found N recalls for you.` counts every current match: a recall whose
 * stated geography names one of the chosen states or is Nationwide (which
 * qualifies for every state, whatever the hazard), or whose geography is
 * unknown but which carries one of the chosen allergen or store signals —
 * less the one allergen-only exclusion the Feed applies — when its material
 * activity is within the window OR its agency confirms it is still open: an
 * FSIS recall FSIS still lists as active, or an FDA recall with an accepted
 * linked product FDA lists as Ongoing (evidence at most 21 days old). It
 * excludes recalls stated for other states only, unknown-geography recalls
 * with no personal signal, and older matches with no such confirmation (FSIS
 * alerts, FDA recalls whose products are Completed or Terminated, unlinked FDA
 * recalls). The clock is the screen's calendar clock, so the count moves with
 * the date even when no sync lands. It
 * never depends on an image, a product category or a page size, and the
 * Building step reads the same list (`affectsYouMatches`) over the same
 * corpus (`readyCorpus`), so the two screens cannot disagree
 * (`ready-count.test.ts`).
 *
 * ## Which matches are readable (founder decision, 2026-10-05)
 *
 * The deck fills three readable cards whenever three genuine matches exist,
 * chosen by priority group, the shared newest-first order inside each group:
 *
 *   1  a confirmed risk label and a photo that LOADED
 *   2  a confirmed risk label and no photo
 *   3  Pending and a photo that loaded
 *   4  Pending and no photo
 *   5  Unknown — a public health alert, or a recall whose classification is
 *      unrecoverable — kept after the four named groups, never relabeled
 *
 * "Loaded" is a verdict the screen supplies (`PhotoKnowledge`): the photo
 * was prefetched within the probe's bounds (lib/photo-probe.ts). A stored
 * URL that has not loaded, failed, or timed out counts as no photo, so a
 * recall with a broken image is still a readable text-led card in the right
 * group rather than a blank one. With no knowledge at all, nothing counts
 * as loaded. Fewer than three matches show every match; the real next match
 * beyond the readable ones is the locked final page, when one remains. The
 * count never depends on any of this.
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
 * `none` — the check answered and nothing currently matches — is said
 * plainly with no cards: a defensive state. With a healthy corpus Nationwide
 * recalls make it rare, so an unexpected zero is a data or loading problem
 * to investigate, never something to paper over with a positive count.
 * `checking` claims nothing while the first read, or the first photo
 * probes, are still answering.
 */

import type { UserRecallPreferences } from '@/domain/preferences';
import { consumerRiskTier } from '@/domain/risk-tier';
import { buildAffectsMeSections } from '@/lib/affects-me-ranking';
import { BASELINE_RECALLS } from '@/lib/baseline-recalls';
import { matchPositionLabel } from '@/lib/onboarding-copy';
import { buildHomeCardModel, type HomeCardModel } from '@/lib/recall-presentation';
import type { FeedItem } from '@/lib/recall-feed';
import { evaluatePersonalRelevance } from '@/lib/relevance';

/** The most matches the preview ever makes readable. */
export const PREVIEW_MATCH_LIMIT = 3;

/**
 * How many candidate photos a screen probes for one deck: the readable three
 * plus a reserve, so a few failures still fill the deck from the photo groups
 * without probing every match a broad profile has. Candidates past the limit
 * count as no photo for that build.
 */
export const PHOTO_PROBE_LIMIT = 6;

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
  /** The feed, or the first photo probes, have not answered yet: claim nothing, show the quiet check. */
  | { kind: 'checking' }
  /** The check answered and nothing currently matches: said plainly, no cards. */
  | { kind: 'none'; source: CorpusSource }
  /**
   * Real current matches: up to the limit of readable cards, the REAL next
   * match as the locked card (or null), and the true total.
   */
  | {
      kind: 'matches';
      models: HomeCardModel[];
      locked: HomeCardModel | null;
      total: number;
      source: CorpusSource;
    };

/**
 * Every counted match, ranked: the Affects You feed's own main list (in the
 * window, or confirmed open), through the Feed's own layers. ONE call site for "how many recalls match":
 * the Ready preview's total and the Building step's count are both this
 * list's length, so the two screens can never disagree over one corpus.
 */
export function affectsYouMatches(
  items: readonly FeedItem[],
  prefs: UserRecallPreferences,
  /** The clock the window and evidence expiry are measured against; the device's by default. */
  now?: Date,
): FeedItem[] {
  return buildAffectsMeSections(items, (item) => evaluatePersonalRelevance(item, prefs), { now })
    .affects;
}

/** The founder's four groups, and the fifth their list does not name. */
export type PriorityGroup = 1 | 2 | 3 | 4 | 5;

/** What the screen knows about photos: a URL is loaded only when its probe said so. */
export interface PhotoKnowledge {
  loaded: (url: string) => boolean;
}

/** Nothing has loaded: the knowledge a screen has before its probes answer. */
export const NO_PHOTO_KNOWLEDGE: PhotoKnowledge = { loaded: () => false };

/**
 * A recall's group. The two absences are tested by name, separately: Pending
 * is a label that is coming, Unknown is one that is not — neither is ever
 * folded into the other or into a rated tier.
 */
export function priorityGroup(
  item: Pick<FeedItem, 'classification' | 'heroImageUrl'>,
  photos: PhotoKnowledge,
): PriorityGroup {
  const tier = consumerRiskTier(item.classification);
  const photo = item.heroImageUrl !== null && photos.loaded(item.heroImageUrl);
  if (tier === 'pending') return photo ? 3 : 4;
  if (tier === 'unknown') return 5;
  return photo ? 1 : 2;
}

export interface ReadySelection {
  /** The readable cards: the first three by group, every match when fewer exist. */
  readable: FeedItem[];
  /** The next genuine match in that same order, or null when none remains. */
  locked: FeedItem | null;
}

/**
 * The selection over an already-matched, already-ordered list. A stable sort
 * by group keeps the shared newest-first order inside each group. It reads
 * the matches and never filters them: the total is theirs, untouched.
 */
export function selectReadyMatches(
  matches: readonly FeedItem[],
  photos: PhotoKnowledge,
): ReadySelection {
  const ordered = [...matches].sort((a, b) => priorityGroup(a, photos) - priorityGroup(b, photos));
  return {
    readable: ordered.slice(0, PREVIEW_MATCH_LIMIT),
    locked: ordered[PREVIEW_MATCH_LIMIT] ?? null,
  };
}

/**
 * The photos a screen should probe for this corpus and these preferences:
 * the stored URLs of the matches that could be readable if their photo
 * loads, in the order the groups would place them (rated before Pending,
 * newest first inside each), capped at `PHOTO_PROBE_LIMIT`. Unknown
 * recalls carry no photo today and are never probed.
 */
export function photoCandidates(
  items: readonly FeedItem[],
  prefs: UserRecallPreferences,
  now?: Date,
): string[] {
  const optimistic: PhotoKnowledge = { loaded: () => true };
  const urls: string[] = [];
  for (const item of [...affectsYouMatches(items, prefs, now)].sort(
    (a, b) => priorityGroup(a, optimistic) - priorityGroup(b, optimistic),
  )) {
    if (item.heroImageUrl === null) continue;
    if (priorityGroup(item, optimistic) === 5) continue;
    if (!urls.includes(item.heroImageUrl)) urls.push(item.heroImageUrl);
    if (urls.length >= PHOTO_PROBE_LIMIT) break;
  }
  return urls;
}

export function buildReadyPreview(
  feed: ReadyFeedInput,
  prefs: UserRecallPreferences,
  today: string,
  now?: Date,
  photos: PhotoKnowledge = NO_PHOTO_KNOWLEDGE,
): ReadyPreviewState {
  if (feed.status === 'loading') return { kind: 'checking' };
  const affects = affectsYouMatches(feed.items, prefs, now);
  const source = feed.source ?? 'feed';
  if (affects.length === 0) return { kind: 'none', source };
  const selection = selectReadyMatches(affects, photos);
  return {
    kind: 'matches',
    models: selection.readable.map((item) => buildHomeCardModel(item, { today, prefs })),
    locked:
      selection.locked === null ? null : buildHomeCardModel(selection.locked, { today, prefs }),
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
