/**
 * Consumer Projection V2 — semantic type validation.
 *
 * A source label tells us what a value is *supposed* to be. It does not tell us
 * what the value actually is, and real notices misalign the two constantly: a
 * shifted table column, a merged cell, or a heading that spans the wrong rows
 * is enough to file a net weight under "Use by". The result — `Use by: 58 oz` —
 * is worse than showing nothing, because a shopper reads it, finds no such date
 * on their package, and concludes they are safe.
 *
 * So every value is checked against the KIND of thing its concept promises
 * before it can be rendered. Validation is deliberately asymmetric: it rejects
 * values that are demonstrably the wrong type rather than demanding proof of
 * the right one, so unusual-but-genuine source wording still reaches the
 * consumer. A rejected value is dropped from display only — the authoritative
 * source text stays on the case for provenance.
 */

import type { ConsumerConcept } from './consumer-concepts';
import { normalizeDateValue, normalizeUpc } from './identifiers';

/** A measurement: a number bound to a unit of weight, volume, or count. */
const MEASUREMENT =
  /\d\s*(?:oz|ounces?|fl\.?\s?oz|lbs?|pounds?|g|grams?|kg|mg|ml|l|liters?|litres?|ct|count|pk|packs?|pieces?|qt|quarts?|pt|pints?|gal|gallons?|dozen)\b/i;

/** Month names, the strongest single signal that a value is a date. */
const MONTH_WORD = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\b/i;

/**
 * Numeric date shapes, including partial ones we do not fully normalize —
 * "10/2025" states a month and year, which is a real best-by marking.
 */
const NUMERIC_DATE = /\b\d{1,4}[/.-]\d{1,4}(?:[/.-]\d{2,4})?\b/;

/**
 * A range that trails off in its connector, or opens a bound it never closes.
 * "between November 2028 through" rendered raw is an incomplete promise, and
 * completing it by guessing an endpoint would be worse — but "11-28 thru
 * 12-15" is a complete year-less marking exactly as printed, and stays.
 */
const DANGLING_RANGE_END = /\b(?:between|through|thru|until|to|from|and|or|of|ranging)\s*$/i;
const UNCLOSED_RANGE_START = /^(?:between|ranging|rang(?:e|es|ed)\s+from)\b/i;

/** Prose that belongs to a sentence, not to an identifier field. */
const SENTENCE_PROSE =
  /\b(?:recall(?:s|ed|ing)?|voluntar|announc|because|due to|consumers?|customers?|company|products? containing|distribut|contact|please|should)\b/i;

/**
 * A value a consumer could read as a date.
 *
 * Accepts anything that normalizes, names a month, or carries a numeric date
 * shape — and also short opaque date codes, which are genuine source values a
 * shopper compares character by character. It rejects measurements, because a
 * weight under a date heading is the single most common cross-type failure and
 * is never recoverable as a date.
 */
function isDateLike(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (normalizeDateValue(trimmed).canonical !== undefined) return true;
  // Every printed date or date code carries at least one digit. A value with
  // none is a stray label ("use by") that a parse seam filed under itself.
  if (!/\d/.test(trimmed)) return false;
  // A bound word that survived normalization means the range did NOT parse.
  // An incomplete span — one that ends in its connector, or opens "between"
  // without closing — must never render; a complete year-less span printed
  // exactly as marked ("11-28 thru 12-15") is honest raw source text.
  if (DANGLING_RANGE_END.test(trimmed)) return false;
  if (UNCLOSED_RANGE_START.test(trimmed)) return false;
  // A measurement is not a date, however the source labelled it.
  if (MEASUREMENT.test(trimmed) && !MONTH_WORD.test(trimmed)) return false;
  if (SENTENCE_PROSE.test(trimmed)) return false;
  // Identifiers are short; a clause under a date heading is a parse artifact.
  if (trimmed.split(/\s+/).length > 8) return false;
  if (MONTH_WORD.test(trimmed) || NUMERIC_DATE.test(trimmed)) return true;
  // A long unbroken digit run is a lot number a misaligned column filed under
  // a date heading — no printed date is seven undivided digits.
  if (/^\d{6,}$/.test(trimmed)) return false;
  // A printed date code is what is actually stamped on the package, so it
  // stays — but only when it is code-shaped. Spaces count: real markings read
  // "C 08 05 23" and "09 1724" as often as they read "0325".
  return /^[A-Z0-9][A-Z0-9\s./-]{2,18}$/i.test(trimmed);
}

/** A value a consumer could read as a size: a measurement, or a stated count. */
function isSizeLike(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (SENTENCE_PROSE.test(trimmed)) return false;
  if (trimmed.split(/\s+/).length > 10) return false;
  // A bare calendar date under a size heading is a misaligned column.
  if (normalizeDateValue(trimmed).canonical !== undefined) return false;
  return (
    MEASUREMENT.test(trimmed) ||
    /\b\d+\s*(?:-|\s)?(?:count|ct|pack|pk|bar|bars|piece|pieces|can|cans|bottle|bottles|bag|bags|box|boxes|jar|jars|cup|cups|tub|tubs)\b/i.test(
      trimmed,
    ) ||
    /\b(?:small|medium|large|single|family|bulk|individual|case)\b/i.test(trimmed) ||
    // Some sizes are named rather than measured: "Half Gallon", "Pint".
    /\b(?:half|quarter|whole)?\s*(?:gallon|quart|pint|liter|litre|dozen)s?\b/i.test(trimmed)
  );
}

/**
 * A number a package prints beside its barcode, even when it is not one of the
 * fixed barcode lengths.
 *
 * Retailer-assigned codes are published under an explicit "UPC" heading and
 * printed on the package exactly as written — Publix's `41415-06453`, Zion
 * Market's `8541200408`. Calling those something other than what the source
 * called them, on the grounds that a scanner would not read them, tells the
 * shopper to look for a field their package does not have.
 */
function isPartialBarcode(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\d[\d\s.\u2010-\u2015-]{4,24}$/.test(trimmed)) return false;
  // Ten digits is the floor. Below it the number is a lot code that a mis-read
  // sentence attached to the word "UPC" \u2014 Sun Noodle's `1226183` is its lot,
  // printed three lines from its barcode.
  return trimmed.replace(/\D/g, '').length >= 10;
}

/**
 * A code: short, mostly alphanumeric, and printed on a package.
 *
 * Bounded tightly because a loose rule lets source prose ride into a code
 * field, where it is unusable and looks authoritative: one notice produced
 * `Batch code: LLA519501, LLA519501 under “Best By 31 JAN 2027, and 6 bars`.
 * A quotation mark, an embedded date, or more than a short list of tokens all
 * mean the cell held a sentence rather than a code.
 */
function isCodeLike(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 70) return false;
  if (SENTENCE_PROSE.test(trimmed)) return false;
  if (/["“”]/.test(trimmed)) return false;
  // A list bullet inside a "code" means the cell was a serialized source row,
  // not a code; the row should have been split upstream.
  if (/[•·]/.test(trimmed)) return false;
  if (MONTH_WORD.test(trimmed) && /\d/.test(trimmed)) return false;
  // A count is a size, not a code: "6 bars" under a batch heading is the rest
  // of a sentence the cell packed in beside the real code.
  if (
    /^\d{1,3}\s*(?:bars?|packs?|packages?|count|ct|oz|lbs?|pieces?|bottles?|cans?|bags?|boxes|jars?|cups?|tubs?)$/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  if (trimmed.split(/\s+/).length > 6) return false;
  // An article or a linking verb means the cell held a sentence about the
  // code rather than the code: "11 The lot codes are lasered".
  if (/\b(?:the|are|is|was|were|be)\b/i.test(trimmed)) return false;
  return /[A-Z0-9]/i.test(trimmed);
}

/**
 * Whether a value may be presented under the concept it was routed to.
 *
 * Concepts with no meaningful type constraint (names, descriptions, colors)
 * accept anything the extractor produced — the guard exists for fields where a
 * wrong value actively misleads, not as a general filter.
 */
export function isValidForConcept(concept: ConsumerConcept, value: string): boolean {
  switch (concept) {
    case 'best_by':
    case 'use_by':
    case 'sell_by':
    case 'expiration':
    case 'freeze_by':
    case 'production_date':
      return isDateLike(value);
    case 'package_size':
      return isSizeLike(value);
    // A value the source explicitly published as a UPC stays a UPC. It is
    // shown as the source printed it when it is not a scannable length —
    // relabelling it would send a shopper looking for a field their package
    // does not carry.
    case 'upc':
      return normalizeUpc(value) !== null || isPartialBarcode(value);
    case 'retail_location':
      return /\d/.test(value) && value.trim().length >= 6 && value.trim().length <= 120;
    case 'lot':
    case 'production_code':
    case 'product_code':
    case 'case_code':
    case 'item_number':
    case 'establishment_number':
      return isCodeLike(value);
    case 'identifier_location':
      return isCodeLocation(value);
    default:
      return value.trim() !== '';
  }
}

// ── Code location ───────────────────────────────────────────────────────────

/**
 * A physical surface a code can be printed on. Deliberately a closed list: a
 * location we cannot name is a location we cannot describe honestly.
 */
const SURFACES: [RegExp, string][] = [
  [/\blabel(?:ing|ling)?\b/i, 'label'],
  [/\bpouch\b/i, 'pouch'],
  [/\bcartons?\b/i, 'carton'],
  [/\bboxe?s?\b/i, 'box'],
  [/\bbags?\b/i, 'bag'],
  [/\bjar caps?\b|\bcaps?\b/i, 'jar cap'],
  [/\blids?\b/i, 'lid'],
  [/\bbottles?\b/i, 'bottle'],
  [/\bcans?\b/i, 'can'],
  [/\bcontainers?\b/i, 'container'],
  [/\btubs?\b/i, 'tub'],
  [/\bsleeves?\b/i, 'sleeve'],
  [/\bwrappers?\b/i, 'wrapper'],
  [/\bseals?\b/i, 'seal'],
  [/\bpanels?\b/i, 'panel'],
  [/\bstickers?\b/i, 'sticker'],
  [/\bpackag(?:e|ing)\b/i, 'package'],
];

/** A position on that surface. */
const POSITIONS: [RegExp, string][] = [
  [/\bbottom[\s-]?left\b|\blower[\s-]?left\b/i, 'bottom-left'],
  [/\bbottom[\s-]?right\b|\blower[\s-]?right\b/i, 'bottom-right'],
  [/\btop[\s-]?left\b|\bupper[\s-]?left\b/i, 'top-left'],
  [/\btop[\s-]?right\b|\bupper[\s-]?right\b/i, 'top-right'],
  [/\bbottom\b|\bunderside\b|\bbase\b/i, 'bottom'],
  [/\btop\b/i, 'top'],
  [/\bback\b|\brear\b|\breverse\b/i, 'back'],
  [/\bfront\b/i, 'front'],
  [/\bside\b/i, 'side'],
  [/\bcorner\b/i, 'corner'],
  [/\bend\b/i, 'end'],
  [/\bneck\b/i, 'neck'],
  [/\bshoulder\b/i, 'shoulder'],
];

/** A spatial relationship to something else printed on the package. */
const RELATION =
  /\b(?:directly\s+)?(?:beneath|below|under|above|next to|beside|near|alongside|adjacent to)\s+the\s+([a-z][a-z\s'-]{2,40}?)(?:\s*[.,;)]|$)/i;

/** How the code looks, as distinct from where it is. */
const APPEARANCE: [RegExp, string][] = [
  [/\bblack\s+ink\b|\bprinted\s+in\s+black\b/i, 'Black printed text.'],
  [/\bwhite\s+ink\b|\bprinted\s+in\s+white\b/i, 'White printed text.'],
  [/\bblue\s+ink\b/i, 'Blue printed text.'],
  [/\bred\s+ink\b/i, 'Red printed text.'],
  [/\bink[\s-]?jet(?:ted)?\b/i, 'Ink-jet printed text.'],
  [/\bembossed\b|\bstamped\s+into\b/i, 'Embossed into the packaging.'],
  [/\blaser[\s-]?(?:etched|printed)\b/i, 'Laser-printed text.'],
  [/\bwhite\s+(?:box|field|background)\b/i, 'Printed on a white background.'],
];

/**
 * Wording that proves a phrase is recall narrative rather than a place on a
 * package. Real regression this exists to prevent: NatureBest produced
 * "located in Missouri City, TX and Houston, TX is voluntarily recalling
 * products containing", because a free-text search for "located in…" ran
 * across a company-address sentence.
 */
const NOT_A_LOCATION =
  /\b(?:recall(?:s|ed|ing)?|voluntar|announc|because|distribut|products? containing|company|corporation|inc\b|llc\b|ltd\b|consumers?|customers?|purchase|refund|website|www\.|@|being|are\s+subject)\b/i;

/**
 * A US mailing address or city/state pair — where the FIRM is, never where a
 * code is.
 */
const FIRM_ADDRESS =
  /\b\d{1,6}\s+[A-Z][a-z]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way|Ct|Court)\b|,\s*[A-Z]{2}\s*\d{5}\b|\b[A-Z][a-z]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;

/** A relationship between product versions, which is not a place at all. */
const VARIANT_RELATIONSHIP = /\bsame\s+(?:packaging|package|label|design|artwork)\s+as\b/i;

/**
 * True when a phrase actually describes where a code sits on a package.
 *
 * Requires a nameable surface or position, and rejects anything carrying
 * recall narrative, a firm address, or a cross-reference between product
 * versions. No location is better than a wrong one: a consumer sent to look at
 * "the bottom left corner" of nothing will not find the code and may decide
 * their package is fine.
 */
/**
 * Verbs that introduce a location phrase but are not part of it. Stripping
 * them first matters more than it looks: "**can** be found on the bottom of
 * the ingredient side panel" otherwise matches "can" as the container the code
 * is printed on, and the consumer is told to look at a can that does not exist.
 */
const LOCATION_LEAD_IN =
  /^(?:(?:it|they|these|this|the code|the lot|codes?|numbers?|dates?)\s+)?(?:can|may|will|should)?\s*(?:be\s+)?(?:found|located|printed|stamped|marked|displayed|embossed|placed|shown|listed|identified)\s*/i;

export function isCodeLocation(value: string): boolean {
  const trimmed = stripLeadIn(value);
  if (trimmed.length < 4 || trimmed.length > 120) return false;
  if (trimmed.split(/\s+/).length > 16) return false;
  if (VARIANT_RELATIONSHIP.test(trimmed)) return false;
  if (NOT_A_LOCATION.test(trimmed)) return false;
  if (FIRM_ADDRESS.test(trimmed)) return false;
  const hasSurface = SURFACES.some(([pattern]) => pattern.test(trimmed));
  const hasPosition = POSITIONS.some(([pattern]) => pattern.test(trimmed));
  const hasRelation = RELATION.test(trimmed);
  return hasSurface || hasPosition || hasRelation;
}

/** Where a code is printed, and what it looks like, as separate facts. */
export interface CodeLocation {
  /** Composed consumer sentence: "On the bottom of the package." */
  text: string;
  /** How to recognize the code itself: "Black printed text." */
  appearance: string | null;
  /** The source wording this was derived from. */
  raw: string;
}

/**
 * Compose standardized consumer copy from the semantics of a source phrase,
 * rather than prefixing the fragment and hoping it reads.
 *
 * Concatenation is what produced "Located on at the top of the label". Here the
 * surface, position, and relationship are recognized first, and the sentence is
 * then written from them — so the same physical arrangement always reads the
 * same way, whichever words the notice happened to use.
 */
export function composeCodeLocation(value: string): CodeLocation | null {
  const original = value.replace(/\s+/g, ' ').trim();
  const trimmed = stripLeadIn(value);
  if (!isCodeLocation(value)) return null;

  const surface = SURFACES.find(([pattern]) => pattern.test(trimmed))?.[1] ?? null;
  const positions = POSITIONS.filter(([pattern]) => pattern.test(trimmed)).map(([, name]) => name);
  const relationMatch = trimmed.match(RELATION);
  const appearance = APPEARANCE.find(([pattern]) => pattern.test(original))?.[1] ?? null;

  // "back" plus "bottom-left" is one placement, not two: the specific corner
  // sits on the named face.
  const face = positions.find((p) => p === 'back' || p === 'front');
  const spot = positions.find((p) => p !== 'back' && p !== 'front');

  // English takes "at the top", "on the bottom" — one rule so the same
  // physical placement always reads the same way.
  const preposition = (position: string | undefined) =>
    position === 'top' || position === 'top-left' || position === 'top-right' ? 'at' : 'on';

  let place: string | null = null;
  if (surface && spot) {
    place = face
      ? `${preposition(spot)} the ${spot} of the ${face} of the ${surface}`
      : `${preposition(spot)} the ${spot} of the ${surface}`;
  } else if (surface && face) {
    place = `on the ${face} of the ${surface}`;
  } else if (surface) {
    place = `on the ${surface}`;
  } else if (spot || face) {
    place = `${preposition(spot)} the ${spot ?? face} of the package`;
  }

  const relation = relationMatch
    ? `directly beneath the ${relationMatch[1].replace(/\s+/g, ' ').trim()}`
    : null;
  if (!place && !relation) return null;

  const sentence = [place, relation].filter(Boolean).join(', ');
  const text = `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
  return { text, appearance, raw: original };
}

/** The phrase with its introducing verb removed, whitespace collapsed. */
function stripLeadIn(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LOCATION_LEAD_IN, '')
    .replace(/^(?:on|in|at|to)\s+/i, 'on ')
    .trim();
}
