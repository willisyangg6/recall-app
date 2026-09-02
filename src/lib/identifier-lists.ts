/**
 * Consumer Projection V2 — the one separator policy for structured identifier
 * lists.
 *
 * Four modules used to split identifier text, each with its own idea of what
 * separates two codes. The disagreements were the defect: prose splitting knew
 * about commas and "and" but not "&", so the Robust Radish sprout notice's
 * `LOT# 223, 226, 230, & 233` produced a fourth "lot code" of `& 233` and
 * rendered as "223, 226, 230, and & 233"; the prose value grammar treated `;`
 * as a terminator, so a semicolon-delimited list lost every identifier after
 * its first.
 *
 * This module owns the policy, and it is field-aware by construction: the
 * functions here are only ever applied to a value the source itself labelled
 * as an identifier or a date. Ordinary prose is never split by them — a global
 * "split on and/&" rule applied to sentences is how symptom names and
 * instructions become product variants.
 *
 * Nothing here rewrites an identifier. Splitting removes only the connectors
 * BETWEEN values; hyphens, letters, leading zeroes, spacing inside a code, and
 * source-supported ranges all survive untouched, because an official
 * identifier is a string a shopper compares character by character.
 */

import { conceptForLabel, type ConsumerConcept } from './consumer-concepts';

/**
 * What separates two identifiers inside one labelled field.
 *
 * Commas, semicolons, ampersands, bullets, newlines, and the words "and"/"or"
 * always separate. A plus sign separates only when the source spaced it as a
 * connector ("223 + 226"), so a code that contains one ("A+B") is never split
 * through the middle.
 */
const IDENTIFIER_SEPARATOR = /\s*(?:,|;|&|•|·|\n|\band\b|\bor\b|(?<=\s)\+|\+(?=\s))\s*|\s{2,}/i;

/** Connector and punctuation residue left on a value by an upstream split. */
const CONNECTOR_RESIDUE_HEAD = /^(?:[\s,;&+•·]+|(?:and|or)\b\s*)+/i;
const CONNECTOR_RESIDUE_TAIL = /(?:[\s,;&+•·]+|\s(?:and|or))+$/i;

/**
 * Strip the seam an upstream split left on a value. `", & 233"` is a comma, a
 * conjunction and a space — none of which a package prints — around the code
 * `233`. Applied to every part this module returns, so a connector can never
 * reach the UI as part of an identifier.
 */
export function stripListConnectors(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(CONNECTOR_RESIDUE_HEAD, '')
    .replace(CONNECTOR_RESIDUE_TAIL, '')
    .trim();
}

/**
 * Split one labelled identifier field into the individual identifiers it
 * states, in the source's own order.
 *
 * Returns `[]` for a field holding nothing; a single-value field returns that
 * one value, cleaned of any seam it arrived with.
 */
export function splitIdentifierList(value: string): string[] {
  return value
    .split(IDENTIFIER_SEPARATOR)
    .map((part) => stripListConnectors(part ?? ''))
    .filter((part) => part !== '');
}

/**
 * A comma directly before a bare year belongs to the date it is part of:
 * splitting "July 11, 2026" there would turn one day into a day and a year.
 * Four digits that continue into a date ("2025.07.12") are a year-first date
 * rather than a bare year, so the comma before them does separate entries.
 */
const DATE_LIST_SEPARATOR = new RegExp(
  [
    String.raw`\s*(?:,(?!\s*\d{4}\b(?![./-]\d))|;|&|•|·|\n|\band\b|\bor\b|(?<=\s)\+|\+(?=\s))\s*`,
    String.raw`\s{2,}`,
    // "2025.07.07 2025.07.12" — one date ending where the next begins.
    String.raw`(?<=\d{2,4})\s+(?=\d{1,2}[/.-]\d)`,
  ].join('|'),
  'i',
);

/**
 * Split a field holding several dates into its parts, without breaking a range.
 *
 * "12/04/19, 12/10/19" is two dates; "7/13/2026 - 8/11/2026" is one range, and
 * splitting on its separator would turn a span into two unrelated days. Only
 * list separators divide — the range separator is left to the date normalizer,
 * and a bounded span ("between X and Y") must not be handed here at all.
 *
 * Returns the whole value unsplit when it holds a single date, so a caller can
 * tell a genuine list from one value that merely contains a comma.
 */
export function splitDateList(value: string): string[] {
  const parts = value
    .split(DATE_LIST_SEPARATOR)
    .map((part) => stripListConnectors(part ?? ''))
    .filter((part) => part !== '');
  return parts.length > 1 ? parts : [value];
}

// ── Field labels the source repeated inside its own values ──────────────────

/** Nouns a source stacks into a field label ("packaging date code"). */
const LABEL_NOUN =
  '(?:lot|batch|case|item|product|package|packaging|production|pack|date|expiration|expiry|upc|sku|bar)';

/**
 * A label heading a value that is supposed to already be past its label:
 * "…with a lot code of 22739 and date code of 17037" splits into `22739` and
 * `date code of 17037`, and the second one renders the source's own heading
 * inside the identifier a shopper is asked to compare.
 *
 * Only a phrase that ENDS in a label noun ("code", "number", "date", "#")
 * qualifies, so a genuine code opening with an ordinary word is never mistaken
 * for a heading.
 */
const EMBEDDED_LABEL = new RegExp(
  String.raw`^(?:(?:a|an|the)\s+)?((?:${LABEL_NOUN}[\s-]){0,2}(?:codes?|numbers?|dates?|#))\s*(?:of\s+|:\s*|#\s*|=\s*|\s+)(?=[A-Za-z0-9])`,
  'i',
);

/**
 * A value whose source label was repeated inside it, split into that label and
 * the identifier it introduces. Returns null when the value carries no such
 * heading.
 */
export function splitEmbeddedFieldLabel(value: string): { label: string; value: string } | null {
  const match = value.match(EMBEDDED_LABEL);
  if (!match) return null;
  const remainder = stripListConnectors(value.slice(match[0].length));
  if (remainder === '') return null;
  return { label: match[1].replace(/\s+/g, ' ').trim(), value: remainder };
}

/**
 * Resolve a list part that repeats a field label inside itself.
 *
 * The label decides: a heading naming the SAME kind of thing is noise around a
 * real identifier and is removed ("lot code 22740" under a Lot label is the
 * code `22740`). A heading naming a DIFFERENT kind is a second labelled
 * statement that the list split tore off its own label, and presenting its
 * value under this field would assert something the source never said — so it
 * is dropped rather than relabelled. The source text itself is preserved on
 * the case either way.
 */
export function resolveEmbeddedLabel(concept: ConsumerConcept, value: string): string | null {
  const split = splitEmbeddedFieldLabel(value);
  if (!split) return value;
  return conceptForLabel(split.label) === concept ? split.value : null;
}

// ── Fragments that are never an identifier ──────────────────────────────────

/** A clock time or time range, in the shapes notices print beside a code. */
const CLOCK_TIME = /\b\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\s*(?:[ap]\.?m\.?)?/i;

/**
 * A telephone number, standing alone or with an extension. Matched against the
 * WHOLE value so a barcode that merely contains a similar digit run is safe.
 */
const PHONE_NUMBER =
  /^(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}$|^1[-.\s]?8(?:00|33|44|55|66|77|88)[-.\s]?\d{3}[-.\s]?\d{4}$/;

/** An extension, which is a phone fragment wherever it appears. */
const PHONE_EXTENSION = /\bext(?:ension)?\.?\s*#?\s*\d{1,6}\b/i;

/**
 * A production TIME the notice prints beside the codes ("…and time stamps
 * between 7:36:38AM to 08:00:48AM"). It is not something printed on a package,
 * and the value grammar truncates it at its own colon — which is how
 * `Use by: time stamp 1` reached the checker.
 */
const TIME_STAMP = /\btime[\s-]?stamps?\b|\btimes?\s+(?:of|between|ranging|stamped)\b/i;

/**
 * True when a value is a clock time, a telephone number, or a phone extension
 * rather than an identifier printed on a package.
 *
 * Deliberately narrow: it names three specific shapes and rejects nothing
 * else, so ordinary alphanumeric and hyphenated lot codes are untouched.
 */
export function isTimeOrPhoneFragment(value: string): boolean {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed === '') return false;
  if (PHONE_EXTENSION.test(trimmed)) return true;
  if (PHONE_NUMBER.test(trimmed)) return true;
  if (TIME_STAMP.test(trimmed)) return true;
  return CLOCK_TIME.test(trimmed);
}

/** A word an identifier does not contain: alphabetic, and not a printed code. */
function isOrdinaryWord(token: string): boolean {
  return /^[A-Za-z]{2,}$/.test(token) && token !== token.toUpperCase();
}

/**
 * Trim a trailing run of ordinary words off an identifier.
 *
 * A list split cuts between identifiers; it does not cut between the last
 * identifier and the sentence that continues past it. El Chilar's "Lot: E-054,
 * EX 0225 and D-181, EX 0624 El Chilar Ground Cinnamon, which tested high in
 * lead" ends its final lot with the product's own name. Dropping the whole
 * part would discard the real marking `EX 0624`; keeping it whole renders a
 * product name inside a code a shopper is asked to compare. The tail goes and
 * the identifier stays.
 *
 * Only a TAIL is trimmed. A value that opens with prose is not an identifier
 * with noise after it — it is a sentence — and is left for the type gate to
 * reject whole.
 *
 * And only a tail that BEGINS in lower case, which is what tells a sentence
 * continuing past an identifier ("615 appears on both the wooden box") from a
 * proper name that may be the value's real content. Whole Foods' own store
 * brand is the number 365, and "365 Whole Foods Market Small Bites Macaroni"
 * trimmed by run length alone yields the lot code `365` — a product name
 * turned into an identifier, which is worse than dropping the value.
 */
export function stripTrailingProse(value: string): string {
  const tokens = value.split(/\s+/);
  let run = 0;
  while (run < tokens.length && isOrdinaryWord(tokens[tokens.length - 1 - run])) run += 1;
  if (run < 3) return value;
  const first = tokens[tokens.length - run];
  if (first !== first.toLowerCase()) return value;
  const kept = stripListConnectors(tokens.slice(0, tokens.length - run).join(' '));
  return kept === '' ? value : kept;
}

/**
 * True when a value carries a run of ordinary lowercase words — the signature
 * of a sentence fragment that a list split carried into an identifier field
 * ("EX 0624 El Chilar Ground Cinnamon", "133 tested positive for L").
 *
 * Three consecutive words, each at least three letters and not written in the
 * all-caps a printed code uses, is the threshold. Verified across the recorded
 * corpus: it catches every prose tail in the rendered code values and rejects
 * no legitimate code.
 */
export function hasProseWordRun(value: string, threshold = 3): boolean {
  let run = 0;
  for (const token of value.split(/\s+/)) {
    if (/^[A-Za-z]{3,}$/.test(token) && token !== token.toUpperCase()) {
      run += 1;
      if (run >= threshold) return true;
    } else {
      run = 0;
    }
  }
  return false;
}
