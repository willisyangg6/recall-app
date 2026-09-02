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
import { companyDisplayName, productSummaryFromTitle } from './consumer-summary';
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
    case 'contents':
      return {
        clause: `because the products contain ${typed.contents.toLowerCase()}`,
        context: null,
        generic: true,
      };
    case 'verbatim':
      return { clause: `because of ${typed.noun.toLowerCase()}`, context: null, generic: true };
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
  october: 'Oct',
  november: 'Nov',
  december: 'Dec',
};

/**
 * Normalize the newest Editor's Note into a short consumer update line, or
 * null when it is housekeeping or cannot be classified reliably (Part 5:
 * never surface raw editorial wording, never invent what was corrected —
 * the full note stays preserved in the source summary).
 */
export function normalizedUpdate(summaryText: string | null): string | null {
  if (!summaryText) return null;
  const match = summaryText.match(/editor[’']?s?\s+note\b[\s:–—-]*([^\n]+)/i);
  if (!match) return null;
  const note = match[1];

  // Housekeeping-only notes are omitted.
  if (/contact information|media contact/i.test(note) && !/product|label|lot|case/i.test(note)) {
    return null;
  }

  let clause: string | null = null;
  if (/additional (affected )?products|expan/i.test(note)) {
    clause = 'additional affected products were added.';
  } else if (/outbreak strain|tested positive|whole genome/i.test(note)) {
    clause = 'laboratory testing linked product samples to the outbreak strain.';
  } else if (
    /label|packag|pieces|item number|case code|production date|lot number|best-by|product list|product information/i.test(
      note,
    )
  ) {
    clause = 'affected product and label details were corrected.';
  }
  if (!clause) return null;

  const date = note.match(/([A-Z][a-z]+)\.?\s+(\d{1,2}),\s+(\d{4})/);
  if (date) {
    const month = MONTH_ABBREVIATIONS[date[1].toLowerCase()] ?? date[1];
    return `Updated ${month} ${Number(date[2])}, ${date[3]}: ${clause}`;
  }
  return `Update: ${clause}`;
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
