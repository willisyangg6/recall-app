/**
 * "What happened" — a structured, deterministic consumer summary built from
 * source-derived slots (company, product, reason family, pathogen/allergen,
 * notice type, import context), NOT assembled from arbitrary press-release
 * sentences. Every clause is grounded in a structured source field or a
 * verified source-text pattern; nothing is invented.
 *
 * Output shape: one sentence normally, an optional second context sentence
 * (import origin / ineligible-country / recall quantity), and a separately
 * rendered normalized Update line derived from Editor's Notes. The raw
 * source text is never mutated and remains fully preserved in the projection.
 */

import { allergenDisplayPhrase } from '@/domain/hazard';
import { cleanDisplayText } from '@/domain/text';
import {
  companyDisplayName,
  productSummaryFromTitle,
  reasonClauseCasing,
} from './consumer-summary';
import { interpretReason, pluralProductPhrase, type TypedReason } from './recall-reason';

export interface WhatHappenedInput {
  title: string;
  noticeType: string;
  reasonText: string | null;
  hazardCategory: string;
  pathogenOrAllergen: string | null;
  firmDisplayName: string | null;
  summaryText: string | null;
  /** Source-structured product description (FDA provides one; FSIS null). */
  productDescription?: string | null;
  /**
   * The one reliable consumer brand from the shared identity decision
   * (lib/recall-presentation caseIdentity) — the subject of "X recalled Y"
   * when present. The legal firm is only the fallback subject; it is never
   * substituted over a reliable brand merely because it issued the notice.
   */
  consumerBrand?: string | null;
}

export interface WhatHappened {
  /** 1–2 concise sentences. Never empty. */
  text: string;
  /** Normalized meaningful update ("Updated Aug 13, 2026: …"), or null. */
  update: string | null;
  /** Which fallback tier produced the text (benchmark telemetry). */
  source: 'template' | 'generic' | 'title';
}

/** Escape a phrase for use inside a RegExp. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The consumer product phrase for use mid-sentence. Capitalization is kept
 * exactly as the source titled it — a deterministic decapitalizer cannot
 * distinguish brands/proper nouns ("Hy-Vee", "California") from generic food
 * words, and corrupting identity is worse than mid-sentence Title Case.
 * The stripped word "products" is restored when the title used it.
 */
function productPhrase(title: string, productDescription?: string | null): string | null {
  // A source-structured product description beats title parsing (FDA).
  const described = (productDescription ?? '').replace(/[\s.]+$/, '').trim();
  if (described.length >= 3) return described;
  let phrase = productSummaryFromTitle(title);
  if (!phrase) return null;
  // "Notification Report 054-2018 (Ham Products)" → the parenthetical product.
  const report = phrase.match(/^notification report[^(]*\(([^)]+)\)/i);
  if (report) phrase = report[1].trim();
  phrase = phrase
    .replace(/^an?\s+/i, '') // "for A Ready-To-Eat Beef Jerky" reads broken
    .replace(/\s+unfit for human consumption$/i, ''); // clause states this
  if (phrase.length < 3) return null;
  if (
    !/products?$/i.test(phrase) &&
    new RegExp(`${escapeRegex(phrase)}\\s+products`, 'i').test(title)
  ) {
    return `${phrase} products`;
  }
  return phrase;
}

interface ReasonClause {
  /** Clause completing "<frame> …", starting with "because"/"that". */
  clause: string;
  /** Optional second context sentence (already fully formed). */
  context: string | null;
  /** True when source free text (not a structured family) carried the clause. */
  generic?: boolean;
}

/**
 * Render the shared typed reason (lib/recall-reason.ts) as the grammatical
 * "because …" clause. Every family has a fixed template; the gated verbatim
 * family is the only place source wording enters, and only as a noun phrase —
 * an ungrammatical reason drops the clause instead of gluing it on.
 */
function reasonClause(input: WhatHappenedInput, product: string): ReasonClause | null {
  const typed: TypedReason = interpretReason({
    reasonText: input.reasonText,
    hazardCategory: input.hazardCategory,
    pathogenOrAllergen: input.pathogenOrAllergen,
    summaryText: input.summaryText,
    title: input.title,
  });
  // Upstream-ingredient notices: the contamination belongs to the recalled
  // ingredient, so the neutral construction is used for pathogen families.
  const upstream = /\b(containing|made with)\b/i.test(product);

  switch (typed.family) {
    case 'pathogen':
      if (typed.pathogen === null) {
        return { clause: 'because the products may be contaminated', context: null };
      }
      return {
        clause: upstream
          ? `because of possible ${typed.pathogen} contamination`
          : `because the products may be contaminated with ${typed.pathogen}`,
        context: null,
      };
    case 'allergen': {
      // Label vocabulary for consistency ("soybean" → "soy", "eggs" → "egg").
      const allergen = typed.raw ? allergenDisplayPhrase(typed.raw) : null;
      if (!allergen) {
        return { clause: 'because the products may contain an undeclared allergen', context: null };
      }
      const plural = /,| and /.test(allergen);
      return {
        clause: plural
          ? `because the products may contain ${allergen}, allergens that are not declared on the label`
          : `because the products may contain ${allergen}, an allergen that is not declared on the label`,
        context: null,
      };
    }
    case 'foreign_material':
      return {
        clause: typed.material
          ? `because the products may contain pieces of ${typed.material}`
          : 'because the products may contain foreign material',
        context: null,
      };
    case 'chemical':
      return {
        clause: typed.agent
          ? `because the products may be contaminated with ${typed.agent}`
          : 'because the products may be contaminated with a chemical substance',
        context: null,
      };
    case 'inspection':
      return {
        clause: 'because the products were produced without required USDA inspection',
        context: null,
      };
    case 'import':
      if (typed.illegal && typed.country) {
        return {
          clause: `because the products may have been illegally imported from ${typed.country}`,
          context: typed.ineligible
            ? `${typed.country.replace(/^the /, 'The ')} is not eligible to export these products to the United States.`
            : null,
        };
      }
      return {
        clause: 'because the products did not meet U.S. import requirements',
        context: typed.country ? `The products were imported from ${typed.country}.` : null,
      };
    case 'unfit':
      return { clause: 'because the products may be unfit to eat', context: null };
    case 'insanitary':
      return {
        clause: 'because the products were made under insanitary conditions',
        context: null,
      };
    case 'processing':
      return { clause: 'because of a processing defect', context: null };
    case 'mislabeled':
      return {
        clause:
          typed.word === 'mislabeled'
            ? 'because the products were mislabeled'
            : 'because the products were misbranded',
        context: null,
      };
    case 'nutrition':
      return {
        clause: 'because the products do not meet infant formula nutrition requirements',
        context: null,
      };
    case 'unapproved':
      // Recorded Kofinas shape: the ingredient and the disallowed use are the
      // source's own words; the clause only supplies agreement.
      return {
        clause: pluralProductPhrase(product)
          ? `because the products contain ${typed.ingredient}, which is not approved for ${typed.use}`
          : `because it contains ${typed.ingredient} that is not approved for ${typed.use}`,
        context: null,
      };
    // Both free-text families embed the source phrase mid-sentence through the
    // shared sentence-interior casing contract (P3E, lib/consumer-summary):
    // generic source title casing flattens to natural prose while medically
    // meaningful casing ("Cronobacter sakazakii", "vitamin D3") survives.
    case 'contents':
      return {
        clause: `because the products contain ${reasonClauseCasing(typed.contents)}`,
        context: null,
        generic: true,
      };
    case 'verbatim':
      return {
        clause: `because of ${reasonClauseCasing(typed.noun)}`,
        context: null,
        generic: true,
      };
    case 'unknown':
      return null;
  }
}

/**
 * "The recall covers approximately 1,626 pounds of product." /
 * "The recall covers 120 cases." — only from a direct "recalling <N> <unit>"
 * source statement; package sizes and unrelated numbers never qualify.
 */
function quantitySentence(input: WhatHappenedInput): string | null {
  if (input.noticeType !== 'recall') return null;
  const match = input.summaryText?.match(
    /recall(?:ing|ed)? (?:of )?(approximately |about |a total of )?([\d,]+) (pounds|cases|units|packages|bags|boxes|jars|bottles|containers|pouches|cartons)\b/i,
  );
  if (!match) return null;
  const qualifier = match[1]?.toLowerCase() ?? '';
  const suffix = match[3].toLowerCase() === 'pounds' ? ' of product' : '';
  return `The recall covers ${qualifier}${match[2]} ${match[3].toLowerCase()}${suffix}.`;
}

const MONTH_ABBREVIATIONS: Record<string, string> = {
  january: 'Jan',
  february: 'Feb',
  march: 'Mar',
  april: 'Apr',
  may: 'May',
  june: 'Jun',
  july: 'Jul',
  august: 'Aug',
  september: 'Sep',
  // FSIS datelines spell September both ways ("Sept. 1, 2022" and
  // "September 30, 2025"). Both normalize to the app's one month spelling, so
  // this template can never render two spellings of one month (P2B7Q).
  sept: 'Sep',
  october: 'Oct',
  november: 'Nov',
  december: 'Dec',
};

/**
 * The note split into sentences, without breaking on a period that belongs to
 * an abbreviation, an initial, or a month in a dateline ("Oct. 4, 2018").
 *
 * The gates below are sentence-scoped on purpose: a note routinely states one
 * completed change and one future possibility ("…additional products were
 * added. Check back frequently to see if additional products have been
 * added."), and a whole-note regex cannot tell them apart.
 */
function noteSentences(note: string): string[] {
  const ABBREVIATION_TAIL =
    /(?:\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec|Inc|Co|Corp|Ltd|LLC|St|Est|No|Dr|Mr|Mrs|Ms|approx|oz|lb|lbs|fl)|\b[A-Z])\.$/i;
  const sentences: string[] = [];
  const breaks = /[.!?]\s+/g;
  let start = 0;
  let found: RegExpExecArray | null;
  while ((found = breaks.exec(note)) !== null) {
    const head = note.slice(start, found.index + 1);
    if (ABBREVIATION_TAIL.test(head)) continue;
    sentences.push(head.trim());
    start = found.index + found[0].length;
  }
  sentences.push(note.slice(start).trim());
  return sentences.filter((sentence) => sentence !== '');
}

/**
 * The app's one spelling of a month, from however the source wrote it —
 * "February", "Feb.", "Sept." — or null when the word is not a month at all.
 *
 * Null is a gate, not a fallback: a date-shaped string whose month word is
 * not a month ("Lot 5, 2024") must never reach the screen as a date, and the
 * old `?? date[1]` fallback would have rendered it verbatim.
 */
function monthAbbreviation(word: string): string | null {
  const key = word.toLowerCase();
  const exact = MONTH_ABBREVIATIONS[key];
  if (exact !== undefined) return exact;
  const names = Object.keys(MONTH_ABBREVIATIONS);
  const matches = names.filter((name) => name.startsWith(key));
  if (matches.length === 0) return null;
  const spellings = new Set(matches.map((name) => MONTH_ABBREVIATIONS[name]));
  // "Ju" is ambiguous between June and July; "Jun" is not.
  return spellings.size === 1 ? [...spellings][0] : null;
}

/** A month/day/year date as FSIS writes one ("Feb. 9, 2024", "June 1, 2026"). */
const DATE_PATTERN = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})/;

/**
 * THE date this note states as its own, or null.
 *
 * A note is allowed to date itself two ways, and only these two:
 *
 *  1. a LEADING DATELINE — the date opens the note, as FSIS writes it
 *     ("Feb. 9, 2024 – Details of this public health alert were updated…",
 *     ", Oct. 25, 2019: …");
 *  2. a date that is the DIRECT OBJECT of an update verb ("…were updated
 *     April 27, 2022, to expand…", "This release was updated on May 4, 2018").
 *
 * Every other date in a note belongs to something else, and the commonest
 * shape in the live corpus is a reference to the notice BEING expanded:
 * "This release is being reissued as an expansion of the May 16, 2017 public
 * health alert to include additional products." Reading the first date-shaped
 * string anywhere in the note — what this used to do — stamped that recall's
 * ANNOUNCEMENT date onto its update line. Measured over the whole case table
 * that was 21 of 58 dated notes: 20 rendered an "Updated <date>" identical to
 * the recall's own announcement date, and one rendered an update ten days
 * BEFORE the recall existed. An undated `Update:` line is the honest fallback
 * and the app already renders it.
 *
 * The month is also validated against the abbreviation table, so a
 * date-shaped string that is not a date ("Lot 5, 2024") can never reach the
 * screen as one.
 */
function statedUpdateDate(note: string): string | null {
  // FSIS writes the dateline bare ("Feb. 9, 2024 – …"), after a stray comma
  // (", Oct. 25, 2019: …") and parenthesised ("(May 5, 2017): …").
  const dateline = note.replace(/^[\s(,;:\u2013\u2014-]+/, '').match(DATE_PATTERN);
  const leading = dateline !== null && dateline.index === 0 ? dateline : null;
  const governed = note.match(
    new RegExp(
      String.raw`\b(?:updated|revised|corrected|reissued)\b(?:\s+(?:on|as\s+of))?\s+` +
        DATE_PATTERN.source,
      'i',
    ),
  );
  const date = leading ?? governed;
  if (date === null) return null;
  const month = monthAbbreviation(date[1]);
  if (month === null) return null;
  return `${month} ${Number(date[2])}, ${date[3]}`;
}

/**
 * Tokens that must NOT sit between "additional" and "products" for the phrase
 * to be a statement that PRODUCTS were added.
 *
 * "an additional 5,156,076 pounds of raw beef products" adds poundage, and
 * "additional lot numbers depicted on affected products" adds lot numbers —
 * neither adds a product. Blocking quantities and detail nouns is what keeps
 * the clause a claim about products.
 */
const NON_PRODUCT_TOKEN =
  String.raw`[\d,.]+|pounds?|lbs?|ounces?|oz|cases?|units?|packages?|bags?|boxes?|jars?` +
  String.raw`|cartons?|pouches?|containers?|kilograms?|kg|lots?|numbers?|codes?|dates?` +
  String.raw`|labels?|information|poundage|distribution|areas?|states?|retailers?` +
  String.raw`|locations?|schools?|photos?|images?`;

/**
 * "additional Trader Joe's … products", "an additional recalled product".
 *
 * "more" is deliberately NOT an additive quantifier here. It reads as an
 * adverb far more often than as a count — one recorded note says the release
 * was updated "to more accurately characterize the product as ineligible for
 * import", which adds no product at all — and "additional"/"new" carry every
 * genuine product addition in the recorded corpus.
 */
const ADDED_PRODUCTS = new RegExp(
  String.raw`\b(?:additional|new)\s+(?:(?!(?:${NON_PRODUCT_TOKEN})\b)[\w'’®-]+\s+){0,8}(?:products?|items?|varieties)\b` +
    String.raw`|\bproducts?\s+(?:have|has)\s+been\s+(?:added|included|identified)\b` +
    String.raw`|\bexpanded\s+list\s+of\b[^.]{0,60}?\bproducts?\b`,
  'i',
);

/**
 * A sentence that hedges the ADDITION itself — a possibility, not a change.
 *
 * "based on the continuing investigation, additional products may be
 * recalled" and "there may be additional products included in this recall in
 * the near future" state what MIGHT happen. Rendering either as "additional
 * affected products were added" turns a possibility into a completed fact,
 * which is the one thing this module exists to prevent.
 *
 * It is deliberately narrow: it hedges the addition, never the hazard. "an
 * expanded list of products that may be contaminated with Listeria" states a
 * completed expansion and keeps its clause.
 */
const HEDGED_CHANGE =
  /\b(?:products?|items?|they)\b[^.]{0,40}?\b(?:may|could|might|will)\s+(?:\w+\s+){0,2}(?:be\s+)?(?:recalled|added|included|identified)\b|\b(?:may|could|might)\s+be\s+additional\b|\bcheck\s+back\b|\bin\s+the\s+near\s+future\b|\b(?:continue|continues|continuing)\s+to\s+(?:update|investigate)\b|\b(?:if|as)\s+(?:we|FSIS)\s+(?:become|becomes)\s+aware\b/i;

/** A sentence that states a CHANGE was made, rather than describing one. */
const CORRECTION_VERB =
  /\b(?:updated|update|corrected|correct|revised|revise|clarif\w+|added|reflect)\b/i;

/**
 * The affected-product and label details a correction may be ABOUT. A bare
 * "products" is not on this list: "a preliminary list of schools that
 * received products … have been added" corrected no product detail, and the
 * old whole-note keyword test rendered it as though it had.
 */
const PRODUCT_OR_LABEL_DETAIL =
  /\b(?:labels?|packag\w*|product\s+(?:list|information)|lot\s+numbers?|lot\s+codes?|case\s+codes?|item\s+numbers?|production\s+(?:dates?|codes?)|best[-\s]?by|best\s+if\s+used\s+by|use\s+by|sell\s+by|expiration|upc|barcodes?|establishment\s+numbers?|pieces)\b/i;

/**
 * Normalize the newest Editor's Note into a short consumer update line, or
 * null when it is housekeeping or cannot be classified reliably (Part 5:
 * never surface raw editorial wording, never invent what was corrected —
 * the full note stays preserved in the source summary).
 *
 * Every clause must be EARNED by a sentence of the note that states the thing
 * the clause claims, is not negated, and is not a future possibility. A note
 * the gates cannot classify renders nothing: the audit's standing rule is
 * that a generic source update may never become a specific claim about what
 * changed (P2B7Q).
 */
export function normalizedUpdate(summaryText: string | null): string | null {
  if (!summaryText) return null;
  const match = summaryText.match(/editor[\u2019']?s?\s+note\b[\s:\u2013\u2014-]*([^\n]+)/i);
  if (!match) return null;
  const note = match[1];

  // Housekeeping-only notes are omitted.
  if (/contact information|media contact/i.test(note) && !/product|label|lot|case/i.test(note)) {
    return null;
  }

  // Only sentences stating a completed change can carry a clause.
  const stated = noteSentences(note).filter((sentence) => !HEDGED_CHANGE.test(sentence));

  let clause: string | null = null;
  if (stated.some((sentence) => ADDED_PRODUCTS.test(sentence))) {
    clause = 'additional affected products were added.';
  } else if (
    stated.some((sentence) => /outbreak strain|tested positive|whole genome/i.test(sentence))
  ) {
    // "samples", not "product samples": one recorded note's sequenced sample
    // was the upstream INGREDIENT at its own manufacturer, not this notice's
    // product, and the app may not turn a supplier's test into this
    // product's test.
    clause = 'laboratory testing linked samples to the outbreak strain.';
  } else if (
    stated.some(
      (sentence) => CORRECTION_VERB.test(sentence) && PRODUCT_OR_LABEL_DETAIL.test(sentence),
    )
  ) {
    clause = 'affected product and label details were corrected.';
  }
  if (!clause) return null;

  const date = statedUpdateDate(note);
  return date === null ? `Update: ${clause}` : `Updated ${date}: ${clause}`;
}

/**
 * Sentence frame: who did what to which product. The subject of "X recalled Y"
 * is the shared identity decision's consumer brand when one is reliable, and
 * the recalling company only as the fallback — a shopper recognizes the brand
 * on the shelf, not the legal entity behind the notice. The legal firm stays
 * fully preserved in the projection for official traceability. The PHA frame
 * keeps the company: its "from X" clause states official provenance (who made
 * the product), not shelf identity.
 */
function frame(input: WhatHappenedInput, product: string): string {
  const company = companyDisplayName(input.firmDisplayName);
  if (input.noticeType === 'public_health_alert') {
    return company
      ? `A public health alert was issued for ${product} from ${company}`
      : `A public health alert was issued for ${product}`;
  }
  const subject = input.consumerBrand ?? company;
  return subject ? `${subject} recalled ${product}` : `A recall was issued for ${product}`;
}

const MAX_WORDS = 70;

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '').length;
}

export function buildWhatHappened(input: WhatHappenedInput): WhatHappened {
  const update = normalizedUpdate(input.summaryText);
  const product = productPhrase(input.title, input.productDescription);

  // Retraction notices explain the retraction, not the original event.
  if (/\bretracts?\b/i.test(input.title)) {
    let tail =
      input.title
        .match(/due to (.+)$/i)?.[1]
        ?.toLowerCase()
        .replace(/[.\s]+$/, '') ?? null;
    if (tail && !/^(a|an|the|its|new|updated? results)\b/.test(tail) && !/s$/.test(tail)) {
      tail = `${/^[aeiou]/.test(tail) ? 'an' : 'a'} ${tail}`;
    }
    const base = product
      ? `The public health alert for ${product} was retracted`
      : 'This notice was retracted by the agency';
    return {
      text: `${base}${tail ? ` because of ${tail}` : ''}.`,
      update,
      source: 'template',
    };
  }

  if (product) {
    const reason = reasonClause(input, product);
    if (reason) {
      let text = `${frame(input, product)} ${reason.clause}.`;
      const second = reason.context ?? quantitySentence(input);
      if (second && wordCount(text) + wordCount(second) <= MAX_WORDS) {
        text = `${text} ${second}`;
      }
      return {
        text: cleanDisplayText(text),
        update,
        source: reason.generic ? 'generic' : 'template',
      };
    }
    // No renderable reason (unknown family, or a free-text reason the grammar
    // gate rejected): the event is still stateable, and stating it without a
    // reason beats gluing an ungrammatical clause on. The full source reason
    // stays preserved in the projection.
    return {
      text: cleanDisplayText(`${frame(input, product)}.`),
      update,
      source: 'generic',
    };
  }

  // Last resort: the authoritative headline, cleaned — never an empty section.
  return { text: cleanDisplayText(input.title), update, source: 'title' };
}
