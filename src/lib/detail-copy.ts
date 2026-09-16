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
