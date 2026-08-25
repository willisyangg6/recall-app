/**
 * Shared deterministic text utilities for source-derived consumer fields.
 *
 * FSIS summaries are stripped HTML in which newlines mark hard breaks that
 * often lack terminal punctuation ("…surveillance activities\nThere have
 * been…"). Every consumer of sentence structure must treat newlines as
 * sentence boundaries or it will join unrelated sentences into artifacts.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  deg: '°',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html.replace(/<(br|\/p|\/li|\/h[1-6])[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * Real FSIS summaries sometimes glue two sentences with no period at all
 * (verified live: "…discovered during FSIS surveillance activities There have
 * been no confirmed reports…"). These are the observed boilerplate sentence
 * openers that get glued; splitting before them is conservative because a
 * capitalized "There have been…"/"Anyone concerned…" after a lowercase word
 * is a sentence start in this corpus.
 */
const GLUED_BOUNDARY = /(?<=[a-z])\s+(?=(?:There (?:have|has) been|Anyone concerned about)\b)/;

/**
 * A period that ends an abbreviation, not a sentence. Splitting after "Inc."
 * broke "Product was distributed by Primavera Nueva Inc. in California and
 * Nevada" into two fragments, and the half carrying the states no longer
 * contained a distribution verb — so the recall's geography was lost. The
 * same applies to the "Eugene, Ore. establishment" state abbreviations FSIS
 * uses in every notice.
 */
const ABBREVIATION_PERIOD =
  /(?<!\b(?:Inc|Corp|Co|Ltd|LLC|L\.L\.C|LLP|No|Nos|vs|etc|Mr|Mrs|Ms|Dr|St|Ave|Blvd|U\.S|U\.S\.A|D\.C|Ala|Ariz|Ark|Calif|Colo|Conn|Del|Fla|Ga|Ill|Ind|Kan|Ky|La|Mass|Md|Mich|Minn|Miss|Mo|Mont|Neb|Nev|Okla|Ore|Pa|Tenn|Tex|Va|Vt|Wash|Wis|Wyo)\.)/;

const SENTENCE_BOUNDARY = new RegExp(`(?<=[.!?])${ABBREVIATION_PERIOD.source}\\s+`);

/** Split into sentences: newlines are hard boundaries, then punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((chunk) => chunk.split(SENTENCE_BOUNDARY))
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
  /urged not to|should not (consume|eat|use|serve|sell|distribute)|do not (consume|eat|use|serve|sell)|should be (thrown away|discarded|destroyed)|thrown away or returned|return(ed)? (it|them|these|the (affected )?(product|item)s?)? ?to (the(ir)?|your) place of purchase|urged to (destroy|discard|dispose)|should (either )?(destroy|discard|dispose of|throw)/i;
