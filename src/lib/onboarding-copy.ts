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

// The grocery-atlas States (2026-09-30), founder-approved.
export const STATES_HEADLINE = 'Make it local.';
export const STATES_BODY = 'Choose every state where you or your household buys food.';
/** The one search entry on the step: what it shows, and its spoken name. */
export const STATES_SEARCH_PLACEHOLDER = 'Search states';
export const STATES_SEARCH_HINT = 'Opens the list of states. Check every state you choose.';
/** Beneath the chosen states, always shown. */
export const STATES_HELPER = 'Choose one or more states.';
/** Why Continue is unavailable with nothing chosen: said, not only greyed. */
export const STATES_REQUIRED_NOTE = 'Choose at least one state to continue.';
/** The chooser's title and its field's hint. */
export const STATES_CHOOSER_TITLE = 'Choose states';
export const STATES_FIELD_HINT = 'Filters the states below by name or abbreviation.';
/** What a search found, said as it changes. */
export const NO_STATES_FOUND = 'No state matches that search.';
export function statesFoundAnnouncement(count: number): string {
  if (count === 0) return NO_STATES_FOUND;
  return count === 1 ? '1 state found.' : `${count} states found.`;
}

// ── Screen 3: Allergens ─────────────────────────────────────────────────────

export const ALLERGENS_HEADLINE = 'Any allergens to watch?';
export const ALLERGENS_BODY =
  'Select any that matter to you or your household. Leave this blank if none.';

// ── Screen 4: Stores (the receipt, 2026-09-30) ──────────────────────────────

export const RETAILERS_HEADLINE = 'Your regulars.';
// The step stays optional (Continue is never disabled); the sentence does
// not say so.
export const RETAILERS_BODY = 'Choose the stores where your household buys food.';
/** The receipt's heading over its six quick choices: popular, never ranked or "largest". */
export const POPULAR_STORES_LABEL = 'Popular stores';
/**
 * The count, spoken: it also covers stores chosen through the search, which
 * the six quick choices cannot show.
 */
export function storesCountLabel(count: number): string {
  if (count === 0) return 'No stores selected';
  return count === 1 ? '1 store selected' : `${count} stores selected`;
}
/** The count as the receipt prints it (`2 selected`); spoken as `storesCountLabel`. */
export function storesCountShort(count: number): string {
  return `${count} selected`;
}
/** The count row's compact clear action. */
export const CLEAR_STORES_LABEL = 'Clear';
/** The receipt's search action, as printed and spoken, and the search sheet's title. */
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
export const CLEAR_STORES_HINT = 'Unchecks every store.';

/** The count line for the allergen step: words, not colour, carry the count. */
export function allergenCountLabel(count: number): string {
  if (count === 0) return 'No allergens selected';
  return count === 1 ? '1 allergen selected' : `${count} allergens selected`;
}

// ── Screen: Building (the five-stop watch, 2026-10-02) ─────────────────────
//
// One changing caption under the five-stop rail. Each names the real work of
// its stop (lib/building-watch.ts maps them): `watch` appears only in the
// headline, no caption names a selection, the no-selection variants never
// imply a filter that does not exist, and the count appears only once real
// results answered — the same Affects You total the Ready step shows.

export const BUILDING_HEADLINE = 'Getting your watch ready.';
export const BUILDING_AREA_CAPTION = 'Searching recalls in your area…';
export function buildingAllergensCaption(hasAllergens: boolean): string {
  return hasAllergens ? 'Checking for allergen matches…' : 'Checking recalls across allergens…';
}
export function buildingStoresCaption(hasStores: boolean): string {
  return hasStores ? 'Checking recalls where you shop…' : 'Checking recalls across stores…';
}
/** The Matches stop, in parts; Building sets the whole sentence in one weight (700). */
export function buildingMatchesParts(total: number): {
  before: string;
  number: string;
  after: string;
} {
  if (total === 0) return { before: 'No matching recalls found.', number: '', after: '' };
  return {
    before: 'Found ',
    number: String(total),
    after: total === 1 ? ' recall for you.' : ' recalls for you.',
  };
}
export const BUILDING_FEED_CAPTION = 'Putting your personalized feed together…';
export const BUILDING_DONE_CAPTION = 'Your personalized feed is ready.';
/** Usable results are still unavailable after the slow-load bound. */
export const BUILDING_SLOW_CAPTION = 'Recalls are taking longer than usual to load.';
/** The feed could not be read and there is nothing cached to show. */
export const BUILDING_ERROR_CAPTION = 'Lotly couldn’t reach the recall service.';
export const BUILDING_RETRY = 'Try again';
export const BUILDING_CONTINUE = 'Continue to preview';
/** The rail's spoken name; its value is the current caption and step. */
export const BUILDING_PROGRESS_LABEL = 'Recall check progress';
/** The rail's spoken value: the caption, then how many of the stops are done. */
export function buildingProgressValue(caption: string, done: number, of: number): string {
  return `${caption} ${done} of ${of} done.`;
}

// ── Screen: Ready (the preference board, 2026-09-30) ────────────────────────

export const PREVIEW_HEADLINE = 'You’re all set.';
/** The board's heading: the saved choices, native on the approved board. */
export const PREVIEW_SUMMARY_TITLE = 'Your preferences';
/**
 * Profile's own row names (lib/profile-hub.ts `SUMMARY_LABELS`): the app
 * says store. Drawn on the board in title case, exactly as spoken.
 */
export const PREVIEW_SUMMARY_LABELS = {
  states: 'States',
  allergens: 'Allergens',
  retailers: 'Stores',
} as const;
/** An optional group with nothing chosen keeps its row and says so. */
export const PREVIEW_NONE = 'None';

/** The heading over the personalized recall preview. */
export const PREVIEW_MATCH_HEADING = 'Your recall preview';

/**
 * The count line under it, in three pieces so only the number is
 * emphasised: `We found 21 recalls for you.`, `We found 1 recall for you.`
 * The number is every real match (lib/ready-preview `previewMatchCount`),
 * never the deck's length.
 */
export function matchCountParts(count: number): { before: string; number: string; after: string } {
  return {
    before: 'We found ',
    number: String(count),
    after: count === 1 ? ' recall for you.' : ' recalls for you.',
  };
}

/** The same line as one string. */
export function matchCountLabel(count: number): string {
  const parts = matchCountParts(count);
  return `${parts.before}${parts.number}${parts.after}`;
}

/** The soft-blue locked strip, shown only when more real matches exist. */
export const PREVIEW_LOCKED_STRIP = 'More matching recalls are locked';
export const PREVIEW_LOCKED_HINT = 'Opens the plan screen.';
/** The locked final card: no recall content at all. */
export const PREVIEW_LOCKED_CARD_TITLE = 'More matches are locked';

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
export const PREVIEW_EDIT_HINT = 'Opens your states, allergens and stores on one page.';

// ── Screen: Edit preferences (one page, 2026-09-30) ─────────────────────────

export const EDIT_CANCEL = 'Cancel';
export const EDIT_CANCEL_HINT = 'Closes without saving. Your preferences stay as they were.';
export const EDIT_HEADLINE = 'Edit your preferences';
export const EDIT_BODY = 'Adjust your watch, all in one place.';
/** The three sections, under Profile's row names. */
export const EDIT_SECTION_LABELS = PREVIEW_SUMMARY_LABELS;
/** A section's count: `2 selected`. */
export function editSelectedCount(count: number): string {
  return `${count} selected`;
}
export const EDIT_STATES_HELPER = 'Choose at least one state.';
export const EDIT_OPTIONAL = 'Optional';
export const EDIT_ACTION = 'Edit';
/** Each Edit's spoken name: which chooser it opens. */
export const EDIT_ACTION_LABELS = {
  states: 'Edit states',
  allergens: 'Edit allergens',
  retailers: 'Edit stores',
} as const;
export const EDIT_ADD_ALLERGENS = 'Add allergens';
export const EDIT_CHOOSER_HINT = 'Opens the list. Nothing is saved until Save changes.';
export const EDIT_CAPTION = 'Your recall preview updates when you save.';
export const EDIT_SAVE = 'Save changes';
export const EDIT_SAVE_HINT = 'Saves your changes and returns to your recall preview.';
/** Why Save is unavailable, said to assistive technology on the disabled button. */
export const EDIT_SAVE_NEEDS_STATE = 'Choose at least one state to save.';
/** A failed local save: the page stays, with every change kept. */
export const EDIT_SAVE_FAILED = 'Your changes couldn’t be saved. Try again.';
/** A chip's removal control: `Remove Alabama`. */
export function removeChipLabel(name: string): string {
  return `Remove ${name}`;
}
/** The allergen chooser sheet's title (the States and Stores sheets keep theirs). */
export const ALLERGENS_CHOOSER_TITLE = 'Choose allergens';
export const INDEPENDENCE_NOTE = 'Lotly is independent and is not affiliated with the FDA or USDA.';

// ── Screen 7: Notification education ────────────────────────────────────────

export const EDUCATION_SUCCESS = 'Subscription active';
export const EDUCATION_HEADLINE = 'Let the alerts come to you.';
export const EDUCATION_BODY = 'New recalls and important updates, matched to your preferences.';
/** The label under the phone: what the phone shows is an example, not a sent alert. */
export const EDUCATION_EXAMPLE_LABEL = 'Example notification';
/**
 * The example notification in the phone: the app name, then the title and
 * body the real push formatter (server/push/format.ts) produces for a real
 * recall — FDA, Regal Health Food International (Regal Gourmet Snacks), Milk
 * Chocolate Raisins, undeclared peanuts, 2023-06-08, since completed and
 * terminated by FDA (EDUCATION_EXAMPLE_SOURCE; recorded in
 * src/server/fda/fixtures/qa-corpus.json.gz, and pinned to the formatter's
 * output by src/server/push/product-name.test.ts). Both lines fit the
 * illustrated card whole. Illustrative: never a claim that this alert was
 * sent to this shopper or that they bought the product.
 */
export const EDUCATION_EXAMPLE_APP = 'Lotly';
export const EDUCATION_EXAMPLE_TITLE = 'Recall alert: Milk Chocolate Raisins';
export const EDUCATION_EXAMPLE_BODY = 'Undeclared peanut allergen. Check your package.';
/** The official notice the example is formatted from. */
export const EDUCATION_EXAMPLE_SOURCE =
  'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/regal-health-food-international-issues-allergy-alert-undeclared-peanut-milk-chocolate-covered';
/** The example, spoken once: an example, then exactly what the phone shows. */
export const EDUCATION_EXAMPLE_SPOKEN = `${EDUCATION_EXAMPLE_LABEL}. ${EDUCATION_EXAMPLE_APP}: ${EDUCATION_EXAMPLE_TITLE}. ${EDUCATION_EXAMPLE_BODY}`;
export const EDUCATION_CTA = 'Turn on notifications';
/** Spoken after the primary action: it may raise the system prompt. */
export const EDUCATION_CTA_HINT = 'May ask for notification permission, then opens Lotly.';
export const EDUCATION_SECONDARY = 'Not now';
export const EDUCATION_SECONDARY_HINT = 'Opens Lotly without notifications. Nothing is asked.';
export const EDUCATION_REASSURANCE = 'Recall alerts only. No marketing.';
export const EDUCATION_FOOTNOTE = 'Change this anytime in Settings.';
export const EDUCATION_BUSY = 'Opening…';

// ── After either education choice, once, on Feed ────────────────────────────

export const PREFERENCES_SET_CONFIRMATION = 'Your preferences are set.';
