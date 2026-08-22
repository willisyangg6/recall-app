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

import { cleanDisplayText } from '@/domain/text';
import { companyDisplayName, productSummaryFromTitle } from './consumer-summary';

export interface WhatHappenedInput {
  title: string;
  noticeType: string;
  reasonText: string | null;
  hazardCategory: string;
  pathogenOrAllergen: string | null;
  firmDisplayName: string | null;
  summaryText: string | null;
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
function productPhrase(title: string): string | null {
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

const FOREIGN_MATERIALS = ['metal', 'plastic', 'glass', 'wood', 'rubber', 'bone fragments'];

/**
 * "imported from <Country>" as the source states it (title or summary).
 * The lead-in matches any casing; the country itself must be capitalized —
 * no /i flag so the capture never grabs arbitrary lowercase prose.
 */
function importedFromCountry(title: string, summaryText: string | null): string | null {
  const match = `${title}\n${summaryText ?? ''}`.match(
    /\b[Ii]mported [Ff]rom (the\s+[A-Z][A-Za-z’' .-]{2,40}?|[A-Z][A-Za-z’' .-]{2,40}?)(?=,|\.|;| without| that| and| into| due|\n)/,
  );
  return match ? match[1].trim() : null;
}

interface ReasonClause {
  /** Clause completing "<frame> …", starting with "because"/"that". */
  clause: string;
  /** Optional second context sentence (already fully formed). */
  context: string | null;
}

/** Deterministic reason templates for the FSIS structured reason families. */
function reasonClause(input: WhatHappenedInput): ReasonClause | null {
  const reasons = (input.reasonText ?? '').toLowerCase();
  const summary = input.summaryText ?? '';
  const pathogen =
    input.pathogenOrAllergen && !/^undeclared/i.test(input.pathogenOrAllergen)
      ? input.pathogenOrAllergen
      : null;
  const allergen = input.pathogenOrAllergen?.match(/^undeclared\s+(.+)$/i)?.[1] ?? null;
  const upstream = /\b(containing|made with)\b/i.test(productPhrase(input.title) ?? '');

  // Contamination (pathogen or foreign material).
  if (reasons.includes('product contamination')) {
    if (pathogen) {
      return {
        // Upstream-ingredient notices: the contamination belongs to the
        // recalled ingredient, so use the neutral construction.
        clause: upstream
          ? `because of possible ${pathogen} contamination`
          : `because the products may be contaminated with ${pathogen}`,
        context: null,
      };
    }
    if (input.hazardCategory === 'foreign_material') {
      const material = FOREIGN_MATERIALS.find((m) => new RegExp(`\\b${m}\\b`, 'i').test(summary));
      return {
        clause: material
          ? `because the products may contain pieces of ${material}`
          : `because the products may contain foreign material`,
        context: null,
      };
    }
    return { clause: 'because the products may be contaminated', context: null };
  }

  // Undeclared allergen (leads even when combined with misbranding).
  if (reasons.includes('unreported allergens')) {
    return {
      clause: allergen
        ? `because the products may contain ${allergen}, an allergen that is not declared on the label`
        : 'because the products may contain an undeclared allergen',
      context: null,
    };
  }

  if (reasons.includes('produced without benefit of inspection')) {
    return {
      clause: 'because the products were produced without required USDA inspection',
      context: null,
    };
  }

  if (reasons.includes('import violation')) {
    const country = importedFromCountry(input.title, input.summaryText);
    const illegal = /illegally imported/i.test(summary);
    if (illegal && country) {
      return {
        clause: `because the products may have been illegally imported from ${country}`,
        context: /ineligible to export/i.test(summary)
          ? `${country.replace(/^the /, 'The ')} is not eligible to export these products to the United States.`
          : null,
      };
    }
    return {
      clause: 'because the products did not meet U.S. import requirements',
      context: country ? `The products were imported from ${country}.` : null,
    };
  }

  if (reasons.includes('unfit for human consumption')) {
    return { clause: 'because the products may be unfit to eat', context: null };
  }
  if (reasons.includes('insanitary conditions')) {
    return { clause: 'because the products were made under insanitary conditions', context: null };
  }
  if (reasons.includes('processing defect')) {
    return { clause: 'because of a processing defect', context: null };
  }
  if (reasons.includes('mislabeling')) {
    return { clause: 'because the products were mislabeled', context: null };
  }
  if (reasons.includes('misbranding')) {
    return { clause: 'because the products were misbranded', context: null };
  }
  return null;
}

/** "The recall covers approximately 1,626 pounds of product." when stated. */
function quantitySentence(input: WhatHappenedInput): string | null {
  if (input.noticeType !== 'recall') return null;
  const match = input.summaryText?.match(
    /recall(?:ing|ed)? (?:of )?approximately ([\d,]+) pounds/i,
  );
  return match ? `The recall covers approximately ${match[1]} pounds of product.` : null;
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

/** Sentence frame: who did what to which product. */
function frame(input: WhatHappenedInput, product: string): string {
  const company = companyDisplayName(input.firmDisplayName);
  if (input.noticeType === 'public_health_alert') {
    return company
      ? `A public health alert was issued for ${product} from ${company}`
      : `A public health alert was issued for ${product}`;
  }
  return company ? `${company} recalled ${product}` : `A recall was issued for ${product}`;
}

const MAX_WORDS = 70;

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '').length;
}

export function buildWhatHappened(input: WhatHappenedInput): WhatHappened {
  const update = normalizedUpdate(input.summaryText);
  const product = productPhrase(input.title);

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
    const reason = reasonClause(input);
    if (reason) {
      let text = `${frame(input, product)} ${reason.clause}.`;
      const second = reason.context ?? quantitySentence(input);
      if (second && wordCount(text) + wordCount(second) <= MAX_WORDS) {
        text = `${text} ${second}`;
      }
      return { text: cleanDisplayText(text), update, source: 'template' };
    }
    // Generic product frame: reason family unknown but the event is stateable.
    const reasonSuffix = input.reasonText ? ` because of ${input.reasonText.toLowerCase()}` : '';
    return {
      text: cleanDisplayText(`${frame(input, product)}${reasonSuffix}.`),
      update,
      source: 'generic',
    };
  }

  // Last resort: the authoritative headline, cleaned — never an empty section.
  return { text: cleanDisplayText(input.title), update, source: 'title' };
}
