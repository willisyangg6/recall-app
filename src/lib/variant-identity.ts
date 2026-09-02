/**
 * The closed consumer variant-identity contract.
 *
 * A variant name is the identity of a distinct affected product — a flavor, a
 * size-specific product, a format, a package/count version. It is NEVER a
 * date, a place, a code, a field label, or a serialized source row. The
 * previous pass closed the FIELD vocabulary; this closes the IDENTITY
 * vocabulary, because real regressions produced variant cards named
 * "Best by 12/14/2026" (a date list read as products), "California" (a
 * distribution list read as products), and "Case item code : 8 1000156076 5"
 * (a property row read as a product).
 *
 * Source parsers may extract broadly; this validator gates narrowly at the
 * consumer projection boundary. A row whose facts are valid but whose name is
 * not does not become a variant — its facts attach to the parent product
 * scope instead, so nothing the source stated is lost. Ambiguity resolves by
 * widening scope, never by inventing an identity.
 */

import { isUsCityName, normalizeStateToken } from '@/domain/us-geography';
import { conceptForLabel } from './consumer-concepts';

/** Why a candidate name cannot be a consumer-facing variant identity. */
export type VariantIdentityRejection =
  | 'date'
  | 'geography'
  | 'code'
  | 'field-label'
  | 'raw-source-row'
  | 'symptom'
  | 'prose'
  | 'document-reference'
  | 'origin-statement'
  | 'measurement-statement';

/** A calendar-date token in any of the shapes announcements print. */
const DATE_TOKEN =
  /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{2,4})?\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{2,4}\b|\b(?:19|20)\d{2}\b/gi;

/**
 * Field labels that appear at the head of a serialized row or a label+value
 * string. Matches the approved package vocabulary AND the known unapproved
 * source labels — either way, a label is not a product.
 */
const FIELD_LABEL_HEAD =
  /^["“]?(?:best[- ](?:if[- ]used[- ])?b(?:y|efore)|use[- ]by|sell[- ]by|freeze[- ]by|expir\w*|lot(?:\s*(?:code|number|#))?|batch(?:\s*(?:code|number|#))?|upc(?:\s+item)?(?:\s*code)?|bar\s*code|item\s+(?:name|number|code)|case(?:\s+item)?\s*code|product\s+code|date\s+code|sku|est\.?\s*(?:no|number)|establishment)\b/i;

/**
 * Recall narrative rather than a product identity.
 *
 * Real regression this exists to prevent: FDA closes many announcements with
 * "Consumers should take the following actions:" over a bulleted list, and the
 * list reader — which correctly treats a declared bullet list as structural
 * evidence — turned SunFed's five instructions into five affected-version
 * cards, the first reading "Check to see if you have recalled whole fresh
 * American cucumbers (photo below)".
 *
 * No product is named for what a shopper should DO with it, so this wording
 * can only be narrative. Matched anywhere in the candidate, because the
 * instruction's verb is as often mid-sentence as at its head.
 */
const RECALL_NARRATIVE =
  /\b(?:recall(?:s|ed|ing)?|consumers?|customers?|should\s+(?:not\s+)?(?:be|consume|check|contact|discard|dispose|return|throw|stop)|please|urged|advised|dispose|discard|throw\s+(?:it|them|away)|check\s+to\s+see|if\s+you\b|anyone\s+with|do\s+not\s+(?:eat|consume|use)|place\s+of\s+purchase|refund)\b/i;

/**
 * A pointer at one of the notice's own attachments, not a thing on a shelf.
 *
 * FSIS hands off its product list through a bracketed link run — 040-2016
 * reads "The following products are subject to recall: [View Labels(PDF only)
 * Labels A , Labels B , Labels C ]" — and split on its commas that run
 * produced affected-version cards named "Labels B" and "Labels C ]". The whole
 * candidate must be the reference: a document word plus at most an enumerator
 * and the bracket it was torn out of, so "Label Rouge Chicken" and "Picture
 * Sweet Corn" are untouched.
 */
const DOCUMENT_REFERENCE =
  /^[\[(]?\s*(?:view\s+|see\s+)?(?:labels?|images?|photos?|pictures?|figures?|exhibits?|attachments?|appendix|appendices|pdfs?|documents?)\s*(?:no\.?|#)?\s*(?:[A-Za-z]|\d{1,3})?\s*(?:\(pdf(?:\s+only)?\))?\s*[\]).,;]*$/i;

/**
 * Symptoms, as the agencies' own hazard paragraphs name them.
 *
 * A symptom list read as a product list produces cards named "Nausea" and
 * "Abdominal cramps" beside real food. The vocabulary is closed and matched
 * against the WHOLE candidate, never as a substring, so a genuine product that
 * happens to contain one of these words (Fever-Tree tonic) is untouched.
 */
const SYMPTOM_NAMES = new Set(
  [
    'nausea',
    'vomiting',
    'diarrhea',
    'bloody diarrhea',
    'abdominal pain',
    'abdominal cramps',
    'abdominal cramping',
    'stomach cramps',
    'fever',
    'high fever',
    'chills',
    'headache',
    'severe headache',
    'stiffness',
    'muscle aches',
    'myalgia',
    'fatigue',
    'dizziness',
    'blurred vision',
    'double vision',
    'drooping eyelids',
    'slurred speech',
    'difficulty swallowing',
    'difficulty breathing',
    'dry mouth',
    'muscle weakness',
    'weakness',
    'jaundice',
    'dehydration',
    'hives',
    'swelling',
    'anaphylaxis',
    'shortness of breath',
    'loss of appetite',
    'sore throat',
  ].map((name) => name.toLowerCase()),
);

/**
 * Directional-region geography ("Southern California", "Northern Nevada",
 * "Upstate New York"). The remainder must itself be a known place for the
 * whole phrase to read as geography — "Southern Comfort" is not a region.
 */
const DIRECTIONAL_PREFIX =
  /^(?:southern|northern|eastern|western|central|northeastern|northwestern|southeastern|southwestern|upstate|downstate|greater|metro)\s+(.+)$/i;

/** True when a phrase names a US region, state, or city — geography, not a product. */
export function isGeographicName(name: string): boolean {
  const trimmed = name.trim();
  if (normalizeStateToken(trimmed) !== null) return true;
  if (isUsCityName(trimmed)) return true;
  const directional = trimmed.match(DIRECTIONAL_PREFIX);
  if (directional && isGeographicName(directional[1])) return true;
  // A conjunction of places is still geography ("Ann Arbor and Brighton",
  // "California Nevada" from a mis-split table cell).
  const parts = trimmed.split(/\s+and\s+|\s*,\s*/);
  if (parts.length > 1 && parts.every((part) => part === '' || isGeographicName(part))) return true;
  const spaced = trimmed.split(/\s+/);
  if (spaced.length > 1 && spaced.every((part) => normalizeStateToken(part) !== null)) return true;
  return false;
}

/**
 * A candidate that is ONLY a package measurement — one number with a real
 * unit and nothing else ("62.4-oz", "8 oz", "5 lb", "750 mL", "12-pack").
 *
 * Conservative and unit-aware by construction: the whole string must be the
 * measurement, so a product name that merely contains numbers ("7-Eleven
 * Wrap"), a numeric brand ("365"), a UPC ("0 41415 06453 1"), a lot code
 * with decimal-looking punctuation ("2457744.2"), a date ("07/08/26"), an
 * establishment number ("EST. 19979"), and a full product name that ends
 * with a size ("Cream Cheese Spread 7 oz") can never match.
 */
const MEASUREMENT_ONLY =
  /^\(?\d+(?:[.,]\d+)?\s*-?\s*(?:fl\.?\s?oz|oz|ounces?|lbs?|pounds?|grams?|g|kg|mg|ml|l|liters?|litres?|ct|count|pks?|packs?)\b\.?\)?$/i;

/**
 * True when the entire candidate variant name is a package measurement.
 *
 * Such a value is package-SIZE evidence, never a consumer product name: the
 * presentation contract renders it in the Package Size slot of its card and
 * never as Product (docs/recall-feed-usability.md). Exposed from this module
 * because "what kind of thing may a version name be" is exactly the identity
 * contract's question — there is one recognizer, not one per screen.
 */
export function measurementOnlyName(name: string): boolean {
  return MEASUREMENT_ONLY.test(name.replace(/\s+/g, ' ').trim());
}

/**
 * The closed packaging vocabulary: container nouns, package materials, and the
 * few joiners that connect them. A candidate is packaging-only when EVERY word
 * belongs to this vocabulary and at least one is a container noun — so
 * "Cardboard boxes", "Plastic bags", and "Aluminum pan with plastic overwrap"
 * match, while any candidate carrying a single product word ("7-Eleven Wrap",
 * "Cup Noodles", "Boxed Water") cannot.
 */
const PACKAGING_CONTAINER =
  /^(?:box(?:es)?|bags?|jars?|cartons?|cases?|trays?|tubs?|bottles?|cans?|pouch(?:es)?|packages?|packets?|packs?|containers?|cups?|sleeves?|wrappers?|wraps?|overwraps?|clamshells?|pails?|buckets?|sacks?|crates?|pans?|lids?|tubes?|liners?)$/i;

const PACKAGING_MODIFIER =
  /^(?:cardboard|plastic|glass|aluminum|aluminium|foil|paper|paperboard|styrofoam|foam|metal|tin|cellophane|shrink|vacuum|clear|corrugated|sealed|resealable|rigid|flexible|laminated|film|with|and|or|in|of|the|a|an)$/i;

/**
 * True when the entire candidate variant name describes only a package — a
 * container and/or its material — with no product identity in it.
 *
 * Such a value is PACKAGING evidence, never a consumer product name: the
 * presentation contract renders it in the Packaging slot of its row and never
 * as Product. The whole-candidate rule is what keeps genuine product names
 * containing packaging words ("Boxed Water", "Cup Noodles", "7-Eleven Wrap")
 * untouched — one non-packaging word disqualifies the match.
 */
/**
 * True when any word of the text is a container noun from the closed
 * packaging vocabulary ("plastic bag with designed header card" — "bag").
 * Weaker than `packagingOnlyName` on purpose: it recognizes that a phrase is
 * ABOUT a package without requiring every word to be packaging vocabulary.
 */
export function containsPackagingContainer(text: string): boolean {
  return text
    .replace(/[\s,]+/g, ' ')
    .trim()
    .split(' ')
    .some((word) => PACKAGING_CONTAINER.test(word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')));
}

export function packagingOnlyName(name: string): boolean {
  const words = name
    .replace(/[\s,]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
  if (words.length === 0) return false;
  let containers = 0;
  for (const word of words) {
    const core = word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    if (core === '') return false;
    if (PACKAGING_CONTAINER.test(core)) {
      containers += 1;
      continue;
    }
    if (!PACKAGING_MODIFIER.test(core)) return false;
  }
  return containers > 0;
}

// ── Trailing measurement lists ──────────────────────────────────────────────

/**
 * One package measurement token, with an optional parenthesized metric
 * equivalent the source printed beside it ("4 oz. (113 g)").
 */
const MEASUREMENT_TOKEN = String.raw`\d+(?:[.,]\d+)?\s*-?\s*(?:fl\.?\s?oz|oz|ounces?|lbs?|pounds?|grams?|g|kg|mg|ml|liters?|litres?|l|ct|count|pks?|packs?)\b\.?(?:\s*\(\s*\d+(?:[.,]\d+)?\s*(?:fl\.?\s?oz|oz|ounces?|lbs?|pounds?|grams?|g|kg|mg|ml|l)\s*\.?\s*\))?`;

/**
 * A trailing run of one or more package measurements at the end of a product
 * name: "… 7 oz", "… 500 ml, 250 ml, and 100 ml", "…, 4 oz. (113 g)".
 */
const TRAILING_MEASUREMENT_LIST = new RegExp(
  String.raw`[\s,;:–—-]*\(?(${MEASUREMENT_TOKEN}(?:\s*(?:,\s*(?:and\s+)?|,?\s+and\s+|\s*&\s*)${MEASUREMENT_TOKEN})*)\)?\.?$`,
  'i',
);

export interface TrailingMeasurements {
  /** The name with the trailing measurement run removed. */
  base: string;
  /** Each removed measurement, in source order (paired metric kept attached). */
  measurements: string[];
}

/**
 * Split a trailing package measurement — or a comma/and-joined list of them —
 * off the end of a product name. Returns null unless a meaningful name
 * remains, so a measurement-only value ("62.4-oz") is never torn apart and a
 * numeric brand ("365") can never match. This says nothing about whether the
 * split SHOULD be displayed: the presentation contract strips a title only
 * when every removed measurement is preserved in supported package evidence.
 */
export function splitTrailingMeasurements(name: string): TrailingMeasurements | null {
  const match = name.match(TRAILING_MEASUREMENT_LIST);
  if (!match || match.index === undefined) return null;
  const base = name
    .slice(0, match.index)
    .replace(/[\s,;:–—-]+$/, '')
    .trim();
  if (base.length < 3 || !/[A-Za-z]/.test(base)) return null;
  const measurements = match[1]
    .split(/\s*(?:,\s*(?:and\s+)?|,?\s+and\s+|\s*&\s*)\s*/i)
    .map((token) => token.replace(/\s+/g, ' ').trim())
    .filter((token) => token !== '');
  if (measurements.length === 0) return null;
  return { base, measurements };
}

/** Case/spacing/punctuation-insensitive containment key for measurement text. */
export function measurementKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Caption contradiction (shared policy) ───────────────────────────────────

/** The closed exact identity of one affected package, for caption-evidence
 * decisions. Extra fields on a caller's richer row shape are fine. */
export interface PackageIdentity {
  name: string | null;
  /** The row's own Package Size value when it states exactly one. */
  size: string | null;
  /** The row's own Barcode (UPC) value, when the source states one. */
  upc: string | null;
}

/** Measurement tokens inside a caption ("…, Front Label, 10 oz.") — compared
 * by exact key equality, so "10 oz" can never claim a "10.5 oz" caption. */
const CAPTION_SIZE_TOKEN =
  /\d[\d.,/]*\s*-?\s*(?:fl\.?\s*oz|oz|ounces?|lbs?|pounds?|grams?|g|kg|mg|ml|liters?|litres?|ct|count|bars?|packs?|pks?|pieces?)\b\.?/gi;

export function captionSizeKeys(text: string): Set<string> {
  return new Set([...text.matchAll(CAPTION_SIZE_TOKEN)].map((match) => measurementKey(match[0])));
}

/** Barcode-length digit strings inside a value ("UPC 021130 13224 9" →
 * "021130132249"), spacing and separators removed. */
const DIGIT_RUN = /\d[\d\s -]{9,22}\d/g;

function barcodeKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const match of text.matchAll(DIGIT_RUN)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 11 && digits.length <= 14) keys.add(digits);
  }
  return keys;
}

/**
 * The ONE caption-contradiction policy, shared by the projection's photo
 * attachment and the display image-role allocator so the two layers can never
 * disagree about what an official caption rules out.
 *
 * A caption that states its OWN identifiers can prove an image is NOT this
 * package's version: a caption naming a different barcode, or package sizes
 * with none the package states, depicts a sibling. Barcodes are read from
 * every identity value — sources sometimes state a UPC inside the size cell
 * ("12 oz UPC 711535517733"), and it is no less the package's identity for
 * being there. Silence never contradicts: a caption with no barcode and no
 * size vetoes nothing.
 */
export function captionContradictsPackage(caption: string, pkg: PackageIdentity): boolean {
  const packageCodes = barcodeKeys([pkg.name, pkg.size, pkg.upc].filter(Boolean).join(' '));
  const captionCodes = barcodeKeys(caption);
  if (
    packageCodes.size > 0 &&
    captionCodes.size > 0 &&
    ![...captionCodes].some((code) => packageCodes.has(code))
  ) {
    return true;
  }
  if (pkg.size) {
    const packageSizes = captionSizeKeys(pkg.size);
    const captionSizes = captionSizeKeys(caption);
    if (
      packageSizes.size > 0 &&
      captionSizes.size > 0 &&
      ![...captionSizes].some((size) => packageSizes.has(size))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The reason a candidate variant name is invalid, or null when it is a
 * legitimate product identity. Deliberately asymmetric: it rejects names that
 * are demonstrably the wrong KIND of thing rather than demanding proof of the
 * right one, so unusual-but-genuine product names still render.
 *
 * A measurement-only name (`measurementOnlyName`) is deliberately NOT a
 * rejection here: rejection widens the row's facts to recall scope and drops
 * the card, but a size-distinguished version is a real affected package whose
 * card should survive with the measurement in its Package Size field. The
 * demotion happens in the presentation contract, which owns what renders as
 * "Product".
 */
export function variantIdentityRejection(name: string): VariantIdentityRejection | null {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 2) return 'raw-source-row';

  // A serialized source row: a list bullet inside the name, several
  // label:value pairs, or unbounded length.
  if (/[•·]/.test(trimmed)) return 'raw-source-row';
  if (trimmed.length > 90) return 'raw-source-row';

  // A field label heading the string — with or without a value after it —
  // is a source column, not a product ("Item name : Birch Benders",
  // "Lot code : 5 265", "Best by 12/14/2026").
  if (FIELD_LABEL_HEAD.test(trimmed)) return 'field-label';
  // "Label: value" text whose label routes to a known concept is a serialized
  // row even when the label is not in the head list.
  const labelled = trimmed.match(/^([A-Za-z][A-Za-z /()#-]{1,30}?)\s*:\s*\S/);
  if (labelled) {
    const concept = conceptForLabel(labelled[1]);
    if (concept !== 'unknown' && concept !== 'variant') return 'field-label';
  }

  // Geography can never be a product identity.
  if (isGeographicName(trimmed)) return 'geography';

  // A reference to one of the notice's own attachments is not a product.
  if (DOCUMENT_REFERENCE.test(trimmed)) return 'document-reference';

  // A symptom the hazard paragraph named is not a product.
  if (SYMPTOM_NAMES.has(trimmed.toLowerCase().replace(/[.,;:]+$/, ''))) return 'symptom';

  // Recall narrative — an instruction to the shopper, not a thing on a shelf.
  if (RECALL_NARRATIVE.test(trimmed)) return 'prose';

  // A country-of-origin statement is label metadata, never a product
  // identity ("Product of Korea" — recorded Sun Hong, where a package
  // description's comma list flattened into prose variants). Whole-candidate
  // and anchored: genuine names merely CONTAINING these words ("Korean Rice
  // Cakes", "Dairy Products Assortment") are untouched.
  if (/^products?\s+of\s+(?:the\s+)?[A-Z][A-Za-z .]*$/i.test(trimmed)) {
    return 'origin-statement';
  }

  // A net-weight statement is package-size evidence stated as a sentence
  // fragment, not a product ("Net weight 7.05 oz/200g"). It may become
  // Package Size only through a path that proves which row it belongs to
  // (a labeled fact, a table cell, or the demotion of a size-distinguished
  // version); a free-floating heading is rejected rather than guessed onto a
  // row. "Weight Watchers…" survives: the digit requirement keeps brand
  // names starting with these words out.
  if (/^net\s+(?:wt\.?|weight)\b/i.test(trimmed)) return 'measurement-statement';
  if (/^(?:wt\.?|weight)\s*:?\s*\d/i.test(trimmed)) return 'measurement-statement';

  // A name dominated by dates: strip every date token, and if no product
  // wording survives, the "name" was a date. "December Fudge Cake" keeps
  // "Fudge Cake" and stays a product. Only names actually CARRYING a date
  // token qualify — a bare code is classified below, not here.
  const hasDateToken = new RegExp(DATE_TOKEN.source, 'i').test(trimmed);
  const withoutDates = trimmed
    .replace(DATE_TOKEN, ' ')
    .replace(/[\s\d/.,:–—-]+/g, ' ')
    .trim();
  if (
    hasDateToken &&
    (withoutDates === '' || /^(?:and|or|to|through|between|from)$/i.test(withoutDates))
  ) {
    return 'date';
  }

  // A barcode or numeric code: digits dominate and no product words exist.
  const compact = trimmed.replace(/[\s-]/g, '');
  const digits = compact.replace(/\D/g, '');
  if (digits.length >= 6 && digits.length / compact.length >= 0.7) return 'code';
  if (/^\d[\d\s-]{5,}$/.test(trimmed)) return 'code';

  return null;
}
