/**
 * Recall Detail's screen-state copy (P2B2) — the loading, not-found and
 * load-failure sentences, the retracted-notice sentence, and the spoken hint
 * on an external link — as one small tested contract, so the screen and the
 * development gallery render the same words and a test can pin them.
 *
 * Pure data: no logic, no imports. Every recall fact on the Detail screen
 * still comes from the presentation contract (lib/recall-presentation.ts);
 * nothing here describes a recall.
 */

export interface DetailStateCopy {
  title: string;
  body: string;
}

export const DETAIL_LOADING: DetailStateCopy = {
  title: 'Loading…',
  body: 'Fetching this recall.',
};

export const DETAIL_MISSING: DetailStateCopy = {
  title: 'Recall not found',
  body: 'This recall could not be found.',
};

/** The load-failure title; its body is the error's own message. */
export const DETAIL_ERROR_TITLE = 'Could not load this recall';

/** The body when the failure carries no message of its own. */
export const DETAIL_ERROR_FALLBACK =
  'Lotly couldn’t load this recall. Check your connection and try again.';

/** The retracted-notice callout, from the model's own agency label. */
export function retractedNotice(agencyLabel: string): string {
  return `${agencyLabel} has retracted this notice.`;
}

/** Spoken after an external link's label, so the leave is never a surprise. */
export const EXTERNAL_LINK_HINT = 'Opens in your browser.';

// ── The Detail title's four-line disclosure (P2B7V) ─────────────────────────

/**
 * How many lines of the product name Detail shows before offering the rest.
 *
 * Four, by founder decision. A handful of live titles are product LISTS the
 * agency wrote as one name — the longest in the active corpus runs 255
 * characters across a dozen cheeses — and at the top of the screen they push
 * every other fact below the fold. Four lines is enough to identify almost
 * every recall and short enough that the rest of the screen stays visible.
 *
 * It is a CLAMP on the rendering only. The full name is what search matches,
 * what a reader hears, what share and push copy carry, and what identity and
 * de-duplication use — none of them ever sees the shortened form.
 */
export const DETAIL_TITLE_LINES = 4;

/**
 * The title disclosure's two words. It is deliberately quiet: this reveals
 * the rest of a name, and it must never read as the screen's primary action.
 * The state is carried by the word itself, not by colour alone, so the
 * control survives greyscale and announces its own state.
 */
export const DETAIL_TITLE_EXPAND_LABEL = 'Show full title';
export const DETAIL_TITLE_COLLAPSE_LABEL = 'Show less';
/** Spoken with the control, so its effect is clear before it is pressed. */
export const DETAIL_TITLE_EXPAND_HINT = 'Shows the rest of the product name.';
export const DETAIL_TITLE_COLLAPSE_HINT = 'Shortens the product name to four lines.';
