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
  body: 'Fetching current safety notices.',
};

/** The error state's title; its body is the session's own message. */
export const FEED_ERROR_TITLE = 'Could not load recalls';

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
  body: 'Nothing right now affects your state or matches your allergens and stores. Check All recalls for the national picture.',
};

export const FEED_EMPTY_CORPUS: FeedStateCopy = {
  title: 'No current recalls loaded',
  body: 'Run the FSIS or FDA ingest against your backend, then pull to refresh.',
};

/** The feed on screen is complete but could not be refreshed just now. */
export const FEED_STALE_NOTICE =
  'Showing the last complete update — couldn’t refresh just now. Pull down to try again.';

/** Why the Older active notices section is collapsed by default. */
export const OLDER_NOTICES_EXPLANATION =
  'Still listed as active by the issuing agency, but announced more than 60 days ago.';

/**
 * The invitation to personalize. The screen is Feed, never Home (DESIGN.md,
 * "Naming"); the earlier wording said "Home" and was corrected here.
 */
export const PERSONALIZE_CTA = {
  title: 'Personalize Recall',
  body: 'Choose your state, allergens, and stores — Feed will show what affects you.',
  compactBody: 'Choose your state to see which recalls affect your area.',
} as const;
