/**
 * The Feed's state copy (P2B1) — the loading, error, empty and notice
 * sentences — as one small tested contract, so the screen and the
 * development gallery render the same words and a test can pin them.
 *
 * Pure data: no logic, no imports. Which state the Feed is in, and when, is
 * decided by the screen from the feed session and the user's controls
 * exactly as before; only the words moved here.
 */

export interface FeedStateCopy {
  title: string;
  body: string;
}

export const FEED_NOT_CONFIGURED: FeedStateCopy = {
  title: 'Backend not configured',
  body:
    'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env (see README), ' +
    'then restart the dev server.',
};

export const FEED_LOADING: FeedStateCopy = {
  title: 'Loading recalls…',
  body: 'Getting the latest recalls.',
};

/** The error state's title; its body is the session's own message. */
export const FEED_ERROR_TITLE = 'Could not load recalls';

/**
 * The body under that title, and the only load-failure sentence a shopper
 * reads on the Feed or on Saved. The cause (an HTTP status, a stalled page,
 * a missing manifest) is a developer fact and goes to the console alone.
 */
export const FEED_LOAD_FAILURE =
  'Lotly couldn’t reach the recall service. Check your connection and pull down to try again.';

export const FEED_EMPTY_SEARCH: FeedStateCopy = {
  title: 'No matching recalls',
  body: 'Nothing matches this search. Check the spelling, or clear the search and filters to see everything.',
};

export const FEED_EMPTY_FILTERS: FeedStateCopy = {
  title: 'No matching recalls',
  body: 'No current recalls match these filters. Clear all to see the complete feed.',
};

export const FEED_EMPTY_PERSONALIZED: FeedStateCopy = {
  title: 'No current recalls match your preferences',
  body: 'Nothing current matches your state, allergens, or stores. Switch to All to see every current recall.',
};

export const FEED_EMPTY_CORPUS: FeedStateCopy = {
  title: 'No recalls loaded yet',
  body: 'Pull down to refresh.',
};

/** The feed on screen is complete but could not be refreshed just now. */
export const FEED_STALE_NOTICE =
  'Showing the last complete update. Lotly couldn’t refresh just now. Pull down to try again.';

/** Why the Older active notices section is collapsed by default. */
export const OLDER_NOTICES_EXPLANATION =
  'Still listed as active by the issuing agency, with no announcement or update in the last 60 days.';

/**
 * The invitation to personalize. The screen is Feed, never Home (DESIGN.md,
 * "Naming"); the earlier wording said "Home" and was corrected here.
 */
export const PERSONALIZE_CTA = {
  title: 'Set up personalization',
  body: 'Choose your state, allergens, and stores to see matching recalls in Affects me.',
  compactBody: 'Choose your state to see which recalls affect your area.',
} as const;
