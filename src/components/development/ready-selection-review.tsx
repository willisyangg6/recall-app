/**
 * Ready selection review (development only, 2026-10-05): the production
 * selection (lib/ready-preview.ts) drawn with the production Ready step over
 * REAL recall records — the bundled baseline — so every priority group can
 * be seen on a simulator without a profile, a network or a production write.
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
import { todayIso } from '@/lib/recall-presentation';
import { buildReadyPreview, type ReadyPreviewState } from '@/lib/ready-preview';

const noop = () => {};

/** Postal codes for the named jurisdictions, from the catalog (no code is typed here). */
function codesFor(...names: string[]): string[] {
  return STATE_CODES_IN_ORDER.filter((code) => names.includes(stateNameForCode(code) ?? ''));
}

/** The one simulation: a stored photo counts as loaded. */
const EVERY_STORED_PHOTO_LOADED = { loaded: () => true };

export function reviewPreview(prefs: UserRecallPreferences): ReadyPreviewState {
  // The baseline's clock, so the review does not drift as the bundled corpus ages.
  const now = new Date(BASELINE_RECORDED_AT);
  return buildReadyPreview(
    { status: 'ready', items: BASELINE_RECALLS, source: 'baseline' },
    prefs,
    todayIso(now),
    now,
    EVERY_STORED_PHOTO_LOADED,
  );
}

export interface ReviewScenario {
  key: string;
  title: string;
  prefs: UserRecallPreferences;
}

/** Real profiles the bundled baseline answers exactly this way (found by search over every single-choice profile and the named pairs). */
export const READY_REVIEW_SCENARIOS: readonly ReviewScenario[] = [
  {
    key: 'three-rated-photo',
    title: 'Three rated recalls with photos',
    prefs: { states: codesFor('California'), allergens: [], retailers: [] },
  },
  {
    key: 'rated-no-photo',
    title: 'A mix requiring rated recalls without photos',
    prefs: { states: [], allergens: ['tree nuts'], retailers: ['kroger'] },
  },
  {
    key: 'pending-fill',
    title: 'A mix requiring Pending recalls',
    prefs: { states: [], allergens: ['soy'], retailers: [] },
  },
  {
    key: 'pending-locked',
    title: 'Pending fills, and a Pending match locked behind',
    prefs: { states: [], allergens: ['milk'], retailers: [] },
  },
  {
    key: 'two-matches',
    title: 'Two genuine matches total',
    prefs: { states: [], allergens: ['tree nuts'], retailers: [] },
  },
  {
    key: 'one-match',
    title: 'One genuine match total',
    prefs: { states: [], allergens: [], retailers: ['costco'] },
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
      preview={reviewPreview(scenario.prefs)}
      onSeePlan={noop}
      onEdit={noop}
      onBack={noop}
    />
  );
}
