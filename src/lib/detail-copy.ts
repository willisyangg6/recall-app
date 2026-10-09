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

// ── The Detail title's disclosure (P2B7V; two lines since 2026-10-07) ───────

/**
 * How many lines of the product name Detail shows before offering the rest.
 *
 * Two, by the approved Recall Detail kit (2026-10-07; P2B7V set four). A
 * handful of live titles are product LISTS the agency wrote as one name — the
 * longest in the active corpus runs 255 characters across a dozen cheeses —
 * and at the top of the screen they push every other fact below the fold.
 * Whether the control appears is MEASURED from the real text layout, never
 * inferred from a character count.
 *
 * It is a CLAMP on the rendering only. The full name is what search matches,
 * what a reader hears, what share copy carries, and what identity and
 * de-duplication use — none of them ever sees this shortened form. (A push
 * title carries its own notification-only short name, built from the full
 * one: server/push/product-name.ts.)
 */
export const DETAIL_TITLE_LINES = 2;

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
export const DETAIL_TITLE_COLLAPSE_HINT = 'Shortens the product name to two lines.';

/**
 * The retailer row's SPOKEN prefix (Recall Detail kit, 2026-10-07). The row
 * shows the store glyph and the names alone — no visible "Retailers:" — and a
 * screen reader still hears what the names are. This is the one place the
 * app-wide "store, never retailer" rule is waived (lib/consumer-copy.test.ts,
 * rule 4): personalization calls the same choice "Retailers".
 */
export const RETAILERS_SPOKEN_PREFIX = 'Retailers:';
