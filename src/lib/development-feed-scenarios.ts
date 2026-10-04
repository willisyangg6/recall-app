/**
 * DEVELOPMENT feed scenarios (2026-10-02): what the shared feed session
 * answers on the Simulator, so the Building step's real gates — pending,
 * slow, failed, a zero or single match — can be exercised on purpose. Reached
 * only from use-feed.ts and the Design Preview, both inside `__DEV__`
 * branches that Metro folds out of a release bundle.
 *
 * The real session still does every real request. A scenario only changes
 * what the hooks are HANDED: `slow` holds a sync's answer back, `fail`
 * replaces it with a failure, and the match scenarios hide real current
 * matches for the saved preferences — every other item is the real corpus,
 * and nothing filtered is ever written to the cache (the session commits its
 * real result before this wrapper sees it). The chosen scenario persists
 * under its own development-only key until it is changed, so a relaunch (a
 * first launch with no cache) starts under it; production code never reads
 * that key.
 */

import * as SecureStore from 'expo-secure-store';

import type { UserRecallPreferences } from '@/domain/preferences';
import { loadPreferences } from '@/lib/preferences-store';
import type { FeedSession } from '@/lib/feed-sync';
import type { FeedItem } from '@/lib/recall-feed';
import { affectsYouMatches } from '@/lib/ready-preview';

export type DevelopmentFeedScenarioId =
  'live' | 'slow' | 'fail' | 'zero-matches' | 'one-match' | 'one-match-no-image' | 'two-matches';

export const DEVELOPMENT_FEED_SCENARIOS: readonly {
  id: DevelopmentFeedScenarioId;
  title: string;
  expectation: string;
}[] = [
  { id: 'live', title: 'Live', expectation: 'The real feed, as shipped.' },
  {
    id: 'slow',
    title: 'Slow sync (12 s)',
    expectation:
      'Each sync answers 12 s late. With no cache, Building holds on Area and offers Retry and ' +
      'Continue after 10 s of foreground time; with a cache it finishes from the cache.',
  },
  {
    id: 'fail',
    title: 'Failed sync',
    expectation:
      'Each sync fails. With a valid cache Building finishes from it (offline); with no cache it ' +
      'shows the could-not-reach message with Retry and Continue.',
  },
  {
    id: 'zero-matches',
    title: 'Zero matches',
    expectation: 'The real corpus without its current matches: No matching recalls found.',
  },
  {
    id: 'one-match',
    title: 'One match',
    expectation: 'The real corpus with only its top current match: Found 1 recall for you.',
  },
  {
    id: 'one-match-no-image',
    title: 'One match, no image',
    expectation:
      'The top current match with its product image withheld (display only): one readable ' +
      'text-led card, no locked strip, Found 1 recall for you.',
  },
  {
    id: 'two-matches',
    title: 'Two matches',
    expectation:
      'The real corpus with only its top two current matches: two cards, no locked strip.',
  },
];

/**
 * The QA PROFILE: what the Building step and Ready are SHOWN as the saved
 * choices, display only. `no-selections` keeps the saved states and clears
 * allergens and stores, so the no-selection captions and their real counts
 * can be seen without saving anything: a save would rewrite this device's
 * preferences and their server mirror. `short-summary` and `long-summary`
 * (2026-10-02) replace the choices with fixed real ones, so Ready's board can
 * be checked at its shortest and longest compact values. Never applied to a
 * screen that saves.
 */
export type DevelopmentQaProfileId = 'saved' | 'no-selections' | 'short-summary' | 'long-summary';

export const DEVELOPMENT_QA_PROFILES: readonly {
  id: DevelopmentQaProfileId;
  title: string;
  expectation: string;
}[] = [
  { id: 'saved', title: 'Saved choices', expectation: 'Building and Ready use the saved choices.' },
  {
    id: 'no-selections',
    title: 'QA profile: no allergens, no stores',
    expectation:
      'Display only, never saved: Building and Ready treat the saved states as chosen with no ' +
      'allergens and no stores. Checking recalls across allergens… and across stores…',
  },
  {
    id: 'short-summary',
    title: 'QA profile: short summary',
    expectation:
      'Display only, never saved: Ready’s board shows one short name per row (Iowa, Milk, Aldi).',
  },
  {
    id: 'long-summary',
    title: 'QA profile: long summary',
    expectation:
      'Display only, never saved: Ready’s board shows its longest compact values (Massachusetts, ' +
      'North Carolina +2; Sesame, Crustacean shellfish; Whole Foods Market, Sprouts Farmers ' +
      'Market +1).',
  },
];

/** The QA profiles' fixed choices: real tokens, presented only, never saved. */
const QA_CHOICES: Partial<Record<DevelopmentQaProfileId, UserRecallPreferences>> = {
  'short-summary': { states: ['IA'], allergens: ['milk'], retailers: ['aldi'] },
  'long-summary': {
    states: ['MA', 'NC', 'PA', 'WV'],
    allergens: ['sesame', 'shellfish'],
    retailers: ['whole-foods', 'sprouts', 'pcc'],
  },
};

const SLOW_MS = 12_000;
const FAIL_AFTER_MS = 600;

const SCENARIO_KEY = 'recall.dev-feed-scenario';
const PROFILE_KEY = 'recall.dev-qa-profile';

let current: DevelopmentFeedScenarioId = 'live';
let profile: DevelopmentQaProfileId = 'saved';
/** The persisted choice, read once; every answer waits for it. */
const restored: Promise<void> = Promise.all([
  SecureStore.getItemAsync(SCENARIO_KEY).then((stored) => {
    const known = DEVELOPMENT_FEED_SCENARIOS.find((option) => option.id === stored);
    if (known) current = known.id;
  }),
  SecureStore.getItemAsync(PROFILE_KEY).then((stored) => {
    const known = DEVELOPMENT_QA_PROFILES.find((option) => option.id === stored);
    if (known) profile = known.id;
  }),
])
  .then(() => {})
  .catch(() => {});

export function developmentFeedScenario(): DevelopmentFeedScenarioId {
  return current;
}

export function setDevelopmentFeedScenario(id: DevelopmentFeedScenarioId): void {
  current = id;
  void SecureStore.setItemAsync(SCENARIO_KEY, id).catch(() => {});
}

export function developmentQaProfile(): DevelopmentQaProfileId {
  return profile;
}

export function setDevelopmentQaProfile(id: DevelopmentQaProfileId): void {
  profile = id;
  void SecureStore.setItemAsync(PROFILE_KEY, id).catch(() => {});
}

/** The choices the Building step and Ready are shown under the QA profile. */
export function developmentPreferencesView(prefs: UserRecallPreferences): UserRecallPreferences {
  if (profile === 'no-selections') return { ...prefs, allergens: [], retailers: [] };
  return QA_CHOICES[profile] ?? prefs;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Hide current matches for the saved preferences, per the scenario. */
async function view(items: FeedItem[]): Promise<FeedItem[]> {
  const keepCount =
    current === 'zero-matches'
      ? 0
      : current === 'one-match' || current === 'one-match-no-image'
        ? 1
        : current === 'two-matches'
          ? 2
          : null;
  if (keepCount === null) return items;
  const prefs = developmentPreferencesView(await loadPreferences());
  const matches = affectsYouMatches(items, prefs);
  const keep = new Set(matches.slice(0, keepCount).map((item) => item.id));
  const hidden = new Set(matches.filter((item) => !keep.has(item.id)).map((item) => item.id));
  return items
    .filter((item) => !hidden.has(item.id))
    .map((item) =>
      current === 'one-match-no-image' && keep.has(item.id)
        ? { ...item, heroImageUrl: null }
        : item,
    );
}

/** The session the hooks see in development: the real one, answered per scenario. */
export function wrapDevelopmentFeedSession(session: FeedSession): FeedSession {
  let served: FeedItem[] | null = null;
  // `run` is a thunk: a failing scenario must never reach the real session,
  // or its request would still download and cache the real corpus.
  const answer = async <T extends { items: FeedItem[] }>(run: () => Promise<T>): Promise<T> => {
    await restored;
    if (current === 'fail') {
      await wait(FAIL_AFTER_MS);
      throw new Error('Development scenario: failed sync');
    }
    const outcome = await run();
    if (current === 'slow') await wait(SLOW_MS);
    const items = await view(outcome.items);
    served = items;
    return { ...outcome, items };
  };
  return {
    async getCached() {
      await restored;
      const items = await session.getCached();
      if (items === null) return null;
      const shown = await view(items);
      served ??= shown;
      return shown;
    },
    sync: () => answer(() => session.sync()),
    async syncIfOlderThan(maxAgeMs) {
      await restored;
      if (current === 'fail') return answer(() => session.sync());
      const outcome = await session.syncIfOlderThan(maxAgeMs);
      return outcome === null ? null : answer(() => Promise.resolve(outcome));
    },
    lastSyncedAtMs: () => session.lastSyncedAtMs(),
    served: () => served,
  };
}
