/**
 * The document screen's own copy and rules (P2B6B) — the words the shared
 * document renderer says that no document says for itself, as one small
 * tested leaf: the navigator title beside a document's own title, the
 * not-found state, the spoken hints on the two kinds of link, and the reset
 * section's heading and progress word.
 *
 * Everything a document CLAIMS still lives in the registry (src/content);
 * nothing here describes how Lotly works.
 */

import { profileGroupFor } from '@/content';
import type { TrustDocument } from '@/content/document-model';
import { EXTERNAL_LINK_HINT } from '@/lib/detail-copy';

/**
 * One consistent treatment for the two titles a document has: the
 * navigator's bar names the Profile group the document was opened from
 * (`Privacy & Data`, `About & Safety`, `Legal`) and the page names the
 * document in full (`Privacy & Data Controls`), so the reader sees where
 * they are and what they are reading, and never the same words twice. A
 * document outside every group — none exists today — falls back to `About`,
 * the root stack's own default for this route.
 */
export const DEFAULT_NAVIGATOR_TITLE = 'About';

export function navigatorTitle(doc: TrustDocument): string {
  return profileGroupFor(doc.slug)?.title ?? DEFAULT_NAVIGATOR_TITLE;
}

/** An unknown slug renders an honest not-found state, as Recall Detail does. */
export const DOCUMENT_NOT_FOUND = {
  title: 'Not found',
  body: 'This page could not be found.',
} as const;

/** Spoken after a document link's label: the same words as Profile's rows. */
export const DOCUMENT_LINK_HINT = 'Opens the document.';

/** Spoken after an external link's label: the same words as Recall Detail's links. */
export const DOCUMENT_EXTERNAL_LINK_HINT = EXTERNAL_LINK_HINT;

/**
 * The heading over the one destructive control (a content section heading,
 * so it sits in the document's own hierarchy) and the button's progress
 * word while a run is in flight. The action label, the dialog and the
 * outcome sentences stay in `installation-reset.ts`, the contract the
 * Privacy & Data Controls document also reads.
 */
export const RESET_HEADING = 'Delete my data';

export const RESET_BUSY_LABEL = 'Deleting…';
