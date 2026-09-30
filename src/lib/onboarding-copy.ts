/**
 * The onboarding and notification-education copy (P2B7X.1) — the founder's
 * finalized words, verbatim, as one tested contract. The paywall's copy
 * lives with its state mapping in paywall-screen.ts.
 *
 * Two sentences here say `retailers` (the Retailers step's body and the
 * Preview summary's row label). They are the founder's final copy for this
 * flow and are exempted by exact string from the app-wide "store, never
 * retailer" rule in consumer-copy.test.ts; everywhere else onboarding keeps
 * the existing selector words (`Search stores`, `N stores selected`).
 *
 * No em dashes; short sentences; `Lotly` for the product (DESIGN.md,
 * "Consumer copy").
 */

// ── Screen 1: Welcome ───────────────────────────────────────────────────────

/** The bespoke wordmark is an image; this is its one spoken name. */
export const WORDMARK_LABEL = 'Lotly';
export const WELCOME_HEADLINE = 'A closer look at your groceries.';
export const WELCOME_BODY = 'Food recalls personalized just for you and your household.';
/**
 * The receipt illustration's printed notice, spoken as one image. It is the
 * artwork's own fictional text, word for word, and nothing more: no date,
 * company or category, and no control (the printed bookmark is drawing).
 */
export const WELCOME_ILLUSTRATION_LABEL =
  'Granola Bites. Critical. Possible Salmonella contamination. Nationwide. Marked Affects You.';
/** Directly under the illustration, so it is never taken for a live recall. */
export const WELCOME_EXAMPLE_CAPTION = 'Illustrative example, not a live recall.';
export const WELCOME_TRUST_NOTE = 'Built from FDA and USDA recall notices.';
export const WELCOME_CTA = 'Get started';

// ── Screens 2–3: the problem (2026-09-28) ───────────────────────────────────
//
// Two framing screens between Welcome and the selectors: the scale of
// foodborne illness, then who faces higher stakes. Both cite the CDC and
// nothing else; neither implies that every foodborne illness had a recall,
// or that Lotly could have prevented them.
//
//   Scale:  https://www.cdc.gov/food-safety/about/index.html
//   Stakes: https://www.cdc.gov/food-safety/risk-factors/index.html

/** The one dominant figure, drawn in `display` type. */
export const PROBLEM_SCALE_STAT = '1 in 6';
export const PROBLEM_SCALE_HEADLINE = 'Americans get sick from foodborne illness each year.';
export const PROBLEM_SCALE_BODY = 'That’s about 48 million people.';
/** The stat and the sentence, spoken as one line. */
export const PROBLEM_SCALE_SPOKEN = `${PROBLEM_SCALE_STAT} ${PROBLEM_SCALE_HEADLINE}`;
/**
 * The six-person pictograph, spoken as ONE element (2026-09-28): the
 * visualization is one infographic, never six separate figures.
 */
export const PROBLEM_SCALE_FIGURES_LABEL = 'One out of six people highlighted.';

export const PROBLEM_RISK_HEADLINE = 'Some households face higher stakes.';
/**
 * The polish pass split the CDC sentence in two so the fact is said ONCE:
 * the four groups became the composition's own tiles, and the body carries
 * the claim about them. The factual meaning is the approved 2026-09-28
 * one, unchanged: these members are more likely to become seriously ill.
 */
export const PROBLEM_RISK_BODY =
  'These household members are more likely to become seriously ill from foodborne illness.';
/** The CDC's four higher-risk groups, one tile each. */
export const PROBLEM_RISK_GROUPS: readonly string[] = [
  'Young children',
  'Pregnant people',
  'Adults 65 and older',
  'Weakened immune systems',
];

/** The quiet source note both problem screens carry. */
export const PROBLEM_SOURCE_NOTE = 'Source: CDC';

// ── Screen 2: States ────────────────────────────────────────────────────────

export const STATES_HEADLINE = 'Which states matter to you?';
export const STATES_BODY = 'Choose every state where you or your household buys food.';
/** Why Continue is unavailable with nothing chosen: said, not only greyed. */
export const STATES_REQUIRED_NOTE = 'Choose at least one state to continue.';

// ── Screen 3: Allergens ─────────────────────────────────────────────────────

export const ALLERGENS_HEADLINE = 'Any allergens to watch?';
export const ALLERGENS_BODY =
  'Select any that matter to you or your household. Leave this blank if none.';

// ── Screen 4: Retailers ─────────────────────────────────────────────────────

export const RETAILERS_HEADLINE = 'Where do you shop?';
// `This is optional.` came off in the polish pass: the step stays optional
// (Continue is never disabled), the sentence just no longer says so.
export const RETAILERS_BODY = 'Choose the retailers you want Lotly to watch for in recall notices.';
/** The curated ten's section label: popular, never ranked or "largest". */
export const POPULAR_STORES_LABEL = 'Popular stores';
/**
 * The quiet utility row's count (polish pass): it also covers stores chosen
 * through the search, which the ten visible tiles cannot show.
 */
export function storesCountLabel(count: number): string {
  if (count === 0) return 'No stores selected';
  return count === 1 ? '1 store selected' : `${count} stores selected`;
}
/** The summary's compact clear action. */
export const CLEAR_STORES_LABEL = 'Clear';
/** The search trigger beneath the popular stores: what it says. */
export const SEARCH_ALL_STORES_PLACEHOLDER = 'Not listed? Search all stores';
/** The trigger, spoken, and the search sheet's title. */
export const SEARCH_ALL_STORES_LABEL = 'Search all stores';
export const SEARCH_ALL_STORES_HINT = 'Opens a search of the complete store list.';
/** The sheet's field: its placeholder and its spoken name. */
export const SEARCH_STORES_LABEL = 'Search stores';
export const SEARCH_STORES_HINT = 'Matching stores appear below. Check one to choose it.';
/** The sheet before anything is typed: an instruction, never the whole list. */
export const SEARCH_INSTRUCTION = 'Search the complete store list.';
/** The sheet when a search matches nothing. */
export const NO_STORES_FOUND = 'No stores found.';
/** The sheet's two ways out, which do the same thing. */
export const SEARCH_CLOSE_LABEL = 'Close';
export const SEARCH_DONE_LABEL = 'Done';
export const SEARCH_DISMISS_HINT = 'Closes the search. Your choices are kept.';

/** What a search found, said as it changes: `No stores found.`, `1 store found.`, `7 stores found.` */
export function searchResultsAnnouncement(count: number): string {
  if (count === 0) return NO_STORES_FOUND;
  return count === 1 ? '1 store found.' : `${count} stores found.`;
}

// ── Shared step controls ────────────────────────────────────────────────────

export const CONTINUE_CTA = 'Continue';
export const BACK_LABEL = 'Back';
export const BACK_HINT = 'Returns to the previous step.';
export const CLEAR_SELECTION_LABEL = 'Clear selection';
export const CLEAR_ALLERGENS_HINT = 'Unchecks every allergen.';
export const CLEAR_STATES_HINT = 'Unchecks every state.';
export const CLEAR_STORES_HINT = 'Unchecks every store.';

/** The count line for the allergen step: words, not colour, carry the count. */
export function allergenCountLabel(count: number): string {
  if (count === 0) return 'No allergens selected';
  return count === 1 ? '1 allergen selected' : `${count} allergens selected`;
}

// ── The building interstitial (2026-09-28) ──────────────────────────────────
//
// The captions the one-time "building your watch" screen steps through.
// Each names real deterministic work (reading the saved preferences and
// syncing the recall feed the Ready preview reads); the allergen and store
// captions tell the truth when nothing was selected, and no caption ever
// claims a match was found — the Ready step reports matches only once the
// query has answered.

export function buildingStatesCaption(): string {
  return 'Checking recalls in your selected states';
}
export function buildingAllergensCaption(hasAllergens: boolean): string {
  return hasAllergens ? 'Matching the allergens you watch' : 'Keeping allergen matching broad';
}
export function buildingStoresCaption(hasStores: boolean): string {
  return hasStores ? 'Watching the stores you chose' : 'Scanning recalls across all stores';
}
export const BUILDING_FEED_CAPTION = 'Building your Affects You feed';
export const BUILDING_DONE_CAPTION = 'Your recall watch is ready';
/** The screen's one spoken introduction; the captions are not read one by one. */
export const BUILDING_ACCESSIBILITY_LABEL = 'Building your recall watch';

// ── Screen: Ready (the personalized preview) ────────────────────────────────

export const PREVIEW_HEADLINE = 'Your recall watch is ready.';
export const PREVIEW_BODY = 'Here’s what Lotly found for your household.';
/** The body when nothing (yet) matches: still true before the query answers. */
export const PREVIEW_BODY_EMPTY = 'Lotly will keep checking for recalls that match your household.';
/** The summary card's heading (Option 2, 2026-09-26). */
export const PREVIEW_SUMMARY_TITLE = 'Your preferences are set';
/** Profile's own row names (lib/profile-hub.ts `SUMMARY_LABELS`): the app says store. */
export const PREVIEW_SUMMARY_LABELS = {
  states: 'States',
  allergens: 'Allergens',
  retailers: 'Stores',
} as const;
/** An optional group with nothing chosen keeps its row and says so. */
export const PREVIEW_NONE = 'None';
/** Spoken after each summary row: the drawn check, in words. */
export const PREVIEW_ROW_COMPLETED = 'completed';
/**
 * The Stores row's visible tail once it is compacted (lib/ready-presentation
 * `storeSummaryText`): `Aldi, Costco +4 more`. The row still speaks every name.
 */
export function moreStoresLabel(count: number): string {
  // A no-break space: `+4 more` wraps as one unit, never `+4` / `more`.
  return `+${count}\u00A0more`;
}
// ── The Ready preview: the carousel (2026-09-28) ────────────────────────────

/** The heading over the personalized recall preview. */
export const PREVIEW_MATCH_HEADING = 'See what affects you today';

/** The lime count pill: `1 recall for your watch`, `2 recalls for your watch`. */
export function matchCountLabel(count: number): string {
  return count === 1 ? '1 recall for your watch' : `${count} recalls for your watch`;
}

/** The soft-blue locked strip, shown only when more real matches exist. */
export const PREVIEW_LOCKED_STRIP = 'More matching recalls are locked';
export const PREVIEW_LOCKED_HINT = 'Opens the plan screen.';
/** The locked sentinel card past the third match: no recall content at all. */
export const PREVIEW_LOCKED_CARD_TITLE = 'More matches are locked';
export const PREVIEW_LOCKED_CARD_BODY = 'See your plan to unlock every matching recall.';

/** The honest empty state: no matches right now, and no pretence otherwise. */
export const PREVIEW_EMPTY_TITLE = 'Nothing currently matches your watch.';
/** Also the truthful line under a short preview when no more matches exist. */
export const PREVIEW_MONITORING_NOTE = 'We’ll keep checking as new recalls are announced.';
/** When the recall feed could not be read at all: honest, and not an empty claim. */
export const PREVIEW_UNAVAILABLE_TITLE = 'Lotly couldn’t check for matches right now.';
/** While the first read is still answering: claims nothing either way. */
export const PREVIEW_CHECKING_TITLE = 'Checking for recalls that match your watch…';

/** A preview card's spoken position: `Match 1 of 3`. */
export function matchPositionLabel(index: number, count: number): string {
  return `Match ${index} of ${count}`;
}

/** The Ready step's one primary action: it opens the plan screen. */
export const PREVIEW_CTA = 'See my plan';
export const PREVIEW_CTA_HINT = 'Opens the plan screen.';

export const PREVIEW_EDIT = 'Edit preferences';
export const PREVIEW_EDIT_HINT =
  'Returns to your states, allergens and stores. Your choices are kept.';
export const INDEPENDENCE_NOTE = 'Lotly is independent and is not affiliated with the FDA or USDA.';

// ── Screen 7: Notification education ────────────────────────────────────────

export const EDUCATION_SUCCESS = 'Subscription active';
export const EDUCATION_HEADLINE = 'Get alerts when a recall matches.';
export const EDUCATION_BODY =
  'Turn on notifications so Lotly can tell you when a new recall matches your profile.';
export const EDUCATION_PREVIEW_APP = 'Lotly';
export const EDUCATION_PREVIEW_TITLE = 'Recall matches your profile';
export const EDUCATION_PREVIEW_BODY = 'Gummy Products may contain undeclared peanut.';
export const EDUCATION_PREVIEW_LABEL = 'Notification preview';
export const EDUCATION_CTA = 'Turn on notifications';
/** Spoken after the primary action: it may raise the system prompt. */
export const EDUCATION_CTA_HINT = 'May ask for notification permission, then opens Lotly.';
export const EDUCATION_SECONDARY = 'Not now';
export const EDUCATION_SECONDARY_HINT = 'Opens Lotly without notifications. Nothing is asked.';
export const EDUCATION_REASSURANCE = 'You can change this anytime in Settings.';
export const EDUCATION_BUSY = 'Opening…';

// ── After either education choice, once, on Feed ────────────────────────────

export const PREFERENCES_SET_CONFIRMATION = 'Your preferences are set.';
