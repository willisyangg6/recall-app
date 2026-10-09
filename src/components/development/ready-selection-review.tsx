/**
 * Ready selection review (development only, 2026-10-05): the production
 * selection (lib/ready-preview.ts) drawn with the production Ready step over
 * REAL recall records, so every priority group can be seen on a simulator
 * without a profile, a network or a production write.
 *
 * Two corpora, each read at its own recording time:
 * - the bundled baseline (what the app ships), for the decks it produces
 *   today: rated recalls with photos, two matches, one match;
 * - the HISTORICAL baseline of 2026-10-04 (lib/historical-baseline.ts,
 *   development and tests only), for the fallback decks the current one no
 *   longer produces — rated recalls without photos and Pending recalls
 *   filling the deck — because its confirmed-open recalls, mostly rated with
 *   photos, now come first for every realistic profile. Each historical
 *   scenario says so in its title.
 *
 * What is simulated, and only this: photo knowledge. The review tells the
 * selection that every stored photo LOADED (`loaded: () => true`), because a
 * static screen cannot probe. The real route probes
 * (hooks/use-ready-preview.ts); a photo that fails there demotes its recall
 * to the no-photo group, which these samples cannot show. Everything else —
 * matching, the count, the groups, the locked page, the card model, the
 * board, the deck, the strip and See my plan — is the shipped code.
 *
 * Shown full-screen by the hub (`lotly://design-preview?review=<n>`), not
 * inside its gallery: the Ready step reveals its page only once its hidden
 * board measurement settles, and that measurement does not settle inside the
 * hub's scrolling gallery (the hub's own Ready samples stay blank there too).
 * Reached only through the hub's `__DEV__` import; folds out of a release.
 */

import {
  STATE_CODES_IN_ORDER,
  stateNameForCode,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { PreviewStep } from '@/components/onboarding/preview-step';
import { BASELINE_RECALLS, BASELINE_RECORDED_AT } from '@/lib/baseline-recalls';
import {
  HISTORICAL_BASELINE_RECALLS,
  HISTORICAL_BASELINE_RECORDED_AT,
} from '@/lib/historical-baseline';
import type { FeedItem } from '@/lib/recall-feed';
import { todayIso } from '@/lib/recall-presentation';
import { buildReadyPreview, type ReadyPreviewState } from '@/lib/ready-preview';

const noop = () => {};

/** Postal codes for the named jurisdictions, from the catalog (no code is typed here). */
function codesFor(...names: string[]): string[] {
  return STATE_CODES_IN_ORDER.filter((code) => names.includes(stateNameForCode(code) ?? ''));
}

/** The one simulation: a stored photo counts as loaded. */
const EVERY_STORED_PHOTO_LOADED = { loaded: () => true };

/** Which recorded corpus a scenario reads. */
export type ReviewCorpus = 'current' | 'historical';

const CORPORA: Record<ReviewCorpus, { items: readonly FeedItem[]; recordedAt: string }> = {
  current: { items: BASELINE_RECALLS, recordedAt: BASELINE_RECORDED_AT },
  historical: { items: HISTORICAL_BASELINE_RECALLS, recordedAt: HISTORICAL_BASELINE_RECORDED_AT },
};

export function reviewPreview(
  prefs: UserRecallPreferences,
  corpus: ReviewCorpus = 'current',
): ReadyPreviewState {
  // The corpus's own clock, so the review does not drift as a recording ages.
  const { items, recordedAt } = CORPORA[corpus];
  const now = new Date(recordedAt);
  return buildReadyPreview(
    { status: 'ready', items, source: 'baseline' },
    prefs,
    todayIso(now),
    now,
    EVERY_STORED_PHOTO_LOADED,
  );
}

export interface ReviewScenario {
  key: string;
  title: string;
  corpus: ReviewCorpus;
  prefs: UserRecallPreferences;
}

/**
 * Real profiles and what each corpus answers for them, found by search over
 * every single-choice profile and the named pairs. The historical decks are
 * the ones pinned by the historical-baseline scenarios in
 * lib/ready-preview.test.ts. `?review=<n>` is 1-based in this order.
 */
export const READY_REVIEW_SCENARIOS: readonly ReviewScenario[] = [
  {
    key: 'three-rated-photo',
    title: 'Three rated recalls with photos, and a rated match locked behind',
    corpus: 'current',
    prefs: { states: codesFor('California'), allergens: [], retailers: [] },
  },
  {
    key: 'two-matches',
    title: 'Two genuine matches total',
    corpus: 'current',
    prefs: { states: [], allergens: ['shellfish'], retailers: [] },
  },
  {
    key: 'one-match',
    title: 'One genuine match total',
    corpus: 'current',
    prefs: { states: [], allergens: [], retailers: ['costco'] },
  },
  {
    key: 'historical-rated-no-photo-locked',
    title: 'Historical (2026-10-04): three rated with photos, a rated match without a photo locked',
    corpus: 'historical',
    prefs: { states: codesFor('California'), allergens: [], retailers: [] },
  },
  {
    key: 'historical-rated-no-photo',
    title: 'Historical (2026-10-04): rated recalls without photos fill the deck',
    corpus: 'historical',
    prefs: { states: [], allergens: ['tree nuts'], retailers: ['kroger'] },
  },
  {
    key: 'historical-pending-fill',
    title: 'Historical (2026-10-04): Pending recalls fill the deck',
    corpus: 'historical',
    prefs: { states: [], allergens: ['soy'], retailers: [] },
  },
  {
    key: 'historical-pending-locked',
    title: 'Historical (2026-10-04): Pending fills, and a Pending match locked behind',
    corpus: 'historical',
    prefs: { states: [], allergens: ['milk'], retailers: [] },
  },
];

/**
 * One scenario, full-screen, exactly as the production Ready step draws it.
 * Back, Edit and See my plan are wired to nothing: this screen never reads
 * or writes preferences, the onboarding record or the store.
 */
export function ReadyReviewScreen({ index }: { index: number }) {
  const scenario =
    READY_REVIEW_SCENARIOS[Math.min(Math.max(index, 0), READY_REVIEW_SCENARIOS.length - 1)];
  return (
    <PreviewStep
      prefs={scenario.prefs}
      preview={reviewPreview(scenario.prefs, scenario.corpus)}
      onSeePlan={noop}
      onEdit={noop}
      onBack={noop}
    />
  );
}
