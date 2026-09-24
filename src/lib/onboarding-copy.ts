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

export const WORDMARK = 'Lotly';
export const WELCOME_HEADLINE = 'Food recalls, filtered for you.';
export const WELCOME_BODY =
  'Lotly turns FDA and USDA recall notices into clear alerts based on where you shop and what you avoid.';
export const WELCOME_BENEFITS: readonly string[] = [
  'Personalized to your household',
  'Clear product photos and details',
  'Alerts when a recall matches',
];
export const WELCOME_TRUST_NOTE = 'Built from FDA and USDA recall notices.';
export const WELCOME_CTA = 'Get started';
/** Above the illustrative card on Welcome. */
export const WELCOME_EXAMPLE_LABEL = 'Example';

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
export const RETAILERS_BODY =
  'Choose the retailers you want Lotly to watch for in recall notices. This is optional.';

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

// ── Screen 5: Personalized Preview ──────────────────────────────────────────

export const PREVIEW_HEADLINE = 'Your recall watch is ready.';
export const PREVIEW_BODY = 'Lotly will flag notices that match your profile with Affects You.';
export const PREVIEW_SUMMARY_LABELS = {
  states: 'States',
  allergens: 'Allergens',
  retailers: 'Retailers',
} as const;
/** An optional group with nothing chosen keeps its row and says so. */
export const PREVIEW_NONE = 'None';
export const PREVIEW_EXAMPLE_LABEL = 'Example match';
export const PREVIEW_CTA = 'View plans';
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
