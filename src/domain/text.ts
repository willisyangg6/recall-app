/**
 * Shared deterministic text utilities for source-derived consumer fields.
 *
 * FSIS summaries are stripped HTML in which newlines mark hard breaks that
 * often lack terminal punctuation ("…surveillance activities\nThere have
 * been…"). Every consumer of sentence structure must treat newlines as
 * sentence boundaries or it will join unrelated sentences into artifacts.
 */

/**
 * Real FSIS summaries sometimes glue two sentences with no period at all
 * (verified live: "…discovered during FSIS surveillance activities There have
 * been no confirmed reports…"). These are the observed boilerplate sentence
 * openers that get glued; splitting before them is conservative because a
 * capitalized "There have been…"/"Anyone concerned…" after a lowercase word
 * is a sentence start in this corpus.
 */
const GLUED_BOUNDARY = /(?<=[a-z])\s+(?=(?:There (?:have|has) been|Anyone concerned about)\b)/;

/** Split into sentences: newlines are hard boundaries, then punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((chunk) => chunk.split(/(?<=[.!?])\s+/))
    .flatMap((chunk) => chunk.split(GLUED_BOUNDARY))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Append a period when a sentence lacks terminal punctuation. */
export function ensureSentence(sentence: string): string {
  const trimmed = sentence.trim();
  if (trimmed === '') return trimmed;
  return /[.!?"”')\]]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Join sentences with guaranteed separation and punctuation. */
export function joinSentences(sentences: string[]): string {
  return sentences
    .map(ensureSentence)
    .filter((s) => s !== '')
    .join(' ');
}

/**
 * Conservative display cleanup: collapse whitespace, drop space before
 * punctuation, deduplicate accidental double periods. Never rewrites words.
 */
export function cleanDisplayText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\.{2,}/g, '.')
    .trim();
}

/**
 * Consumer-instruction sentence detector (shared by the parser's extraction
 * and display-layer standardization).
 */
export const CONSUMER_ACTION_PATTERN =
  /urged not to|should not (consume|eat|use|serve)|do not (consume|eat|use|serve)|should be (thrown away|discarded|destroyed)|thrown away or returned|return(ed)? to the place of purchase|urged to (destroy|discard|dispose)/i;
