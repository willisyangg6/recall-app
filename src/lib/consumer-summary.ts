/**
 * Deterministic consumer-facing presentation helpers derived from source data.
 *
 * These are display transformations only (architecture Part 4: the canonical
 * projection stays authoritative and untouched). Every function degrades
 * gracefully: when a clean summary cannot be derived, it returns null (or the
 * original text) and the caller falls back to the authoritative source text —
 * an imperfect summary must never hide or alter recall information.
 */

/**
 * FSIS headline grammar, verified across the recorded fixtures:
 *   "<Firm> Recalls <products> Due to <reason>"
 *   "<Firm> Expands Recall for <products> Due to …"
 *   "FSIS Issues Public Health Alert for <products> Due To …"
 *   "FSIS Retracts Public Health Alert for <products> Due to …"
 * The PHA patterns must match first: PHA titles can contain the word
 * "Recalled" in their tail.
 */
const TITLE_PRODUCT_PATTERNS = [
  /\bpublic health alert for\s+(.+)$/i,
  /\bexpands? (?:its )?recall for\s+(.+)$/i,
  /\brecalls?\s+(.+)$/i,
];

/**
 * Reason/qualifier tails that follow the product phrase in FSIS headlines.
 * "containing …" is deliberately NOT a cutter: upstream-ingredient notices
 * ("…Products Containing FDA-Regulated Jalapeños…") must keep the causal
 * ingredient in the consumer summary.
 */
const TITLE_TAIL =
  /\s+(?:due to\b|because\b|that (?:have|has|may|were|was)\b|imported (?:from|without)\b|produced without\b|for possible\b|after\b|linked to\b).*$/i;

/**
 * Upstream-ingredient pattern: "<products> containing <ingredient> that
 * has/have been recalled [due to …]" → keep the relationship, mark the
 * ingredient as recalled (source-stated), drop only the reason tail.
 */
const UPSTREAM_RECALLED =
  /^(.*?\b(?:containing|made with)\s+)(.+?)\s+that\s+(?:have|has|were|was)(?:\s+been)?\s+(?:recalled|subject to a recall)\b.*$/i;

/**
 * Short consumer product phrase from an official headline, e.g.
 * "…Recalls Ready-To-Eat Pickled Goat and Chicken Products Produced Without
 * Benefit of Inspection" → "Ready-To-Eat Pickled Goat and Chicken".
 * Returns null when the headline doesn't follow the known grammar.
 */
export function productSummaryFromTitle(title: string): string | null {
  for (const pattern of TITLE_PRODUCT_PATTERNS) {
    const match = title.match(pattern);
    if (!match) continue;
    let phrase = match[1];
    const upstream = phrase.match(UPSTREAM_RECALLED);
    if (upstream) {
      const already = /^(?:recalled|fda-recalled)\b/i.test(upstream[2]);
      phrase = `${upstream[1]}${already ? '' : 'Recalled '}${upstream[2]}`;
    } else {
      phrase = phrase.replace(TITLE_TAIL, '');
    }
    const summary = phrase
      .replace(/(^|\s+)products?$/i, '')
      .replace(/[\s,.;:]+$/, '')
      .trim();
    if (summary.length >= 3) return summary;
  }
  return null;
}

/**
 * The consumer product name for cards and detail headers. A source-structured
 * product description (FDA's `field_product_description`) beats deterministic
 * title parsing; the official title is the last resort and is always preserved
 * elsewhere.
 */
export function productDisplayName(
  productDescription: string | null | undefined,
  title: string,
): string {
  const described = (productDescription ?? '').replace(/[\s.]+$/, '').trim();
  if (described.length >= 3) return described;
  return productSummaryFromTitle(title) ?? title;
}

/**
 * Brands worth showing separately: those not already readable in the company
 * name or the product name. Null when brands add nothing ("Prince" next to
 * "Prince Bakery" is noise; "HEB" next to "NatureBest Precut & Produce" is
 * information).
 */
export function brandLine(
  brands: string[] | undefined,
  companyName: string | null,
  productName: string,
): string | null {
  const context = `${companyName ?? ''} ${productName}`.toLowerCase();
  const novel = (brands ?? [])
    .map((b) => b.trim())
    .filter((b) => b.length >= 2 && !context.includes(b.toLowerCase()));
  return novel.length > 0 ? novel.join(', ') : null;
}

/** Acronyms/stylizations preserved verbatim when un-shouting all-caps text. */
const KEEP_UPPER = new Set([
  'USDA',
  'FSIS',
  'FDA',
  'CDC',
  'USA',
  'BBQ',
  'IGA',
  'KFC',
  'RTE',
  'NRTE',
  'EST',
  'UPC',
  'PDF',
  'II',
  'III',
  'IV',
  'LLC',
  'INC',
]);

/**
 * Three-consonant English onset clusters — the only way a real word can open
 * with three consonants ("SCHWAN", "SPRITE", "STRAWBERRY").
 */
const LEGAL_ONSETS = new Set([
  'chr',
  'phr',
  'sch',
  'scr',
  'shr',
  'sph',
  'spl',
  'spr',
  'squ',
  'str',
  'thr',
]);

/**
 * A short all-caps token that no English word could begin — three opening
 * consonants forming no legal onset ("LMSI", "JBS"). Such a token is an
 * initialism, not shouting, and un-shouting it corrupts an identity
 * ("Lmsi"). Pronounceable brands ("KROGER", "PHO", "OKRA") never qualify by
 * construction, so nothing ordinary is ever forced upper. "MRS" abbreviates
 * a real word and is exempted explicitly.
 */
function isInitialism(core: string): boolean {
  const letters = core.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3 || letters.length > 5) return false;
  if (letters === 'MRS') return false;
  const head = letters.slice(0, 3).toLowerCase();
  if (!/^[bcdfghjklmnpqrstvwxz]{3}$/.test(head)) return false;
  return !LEGAL_ONSETS.has(head);
}

function humanizeWordPart(part: string): string {
  const core = part.replace(/^[^A-Za-z&]+|[^A-Za-z&]+$/g, '');
  if (KEEP_UPPER.has(core)) return part;
  if (/^[A-Z](\.[A-Z])+\.?$/.test(core)) return part; // dotted acronyms: U.S.
  if (isInitialism(core)) return part; // unpronounceable initialisms: LMSI
  if (core.replace(/[^A-Za-z]/g, '').length <= 1) return part; // "A", "7", "&"
  let out = part.toLowerCase().replace(/[a-z]/, (c) => c.toUpperCase());
  out = out.replace(/^Mc([a-z])/, (_, c: string) => `Mc${c.toUpperCase()}`);
  return out;
}

/**
 * Conservative un-shouting for display: applied ONLY when the whole string is
 * all-caps (no lowercase letters at all — i.e., the source is shouting).
 * Mixed-case brand stylizations pass through untouched, acronyms are kept,
 * and the exact source value is always preserved in the underlying data.
 */
export function humanizeAllCaps(text: string): string {
  if (!/[A-Z]/.test(text) || /[a-z]/.test(text)) return text;
  return text
    .split(' ')
    .map((word) =>
      word
        .split(/([-/])/)
        .map((p) => (p === '-' || p === '/' ? p : humanizeWordPart(p)))
        .join(''),
    )
    .join(' ');
}

/**
 * Mechanical legal suffixes that can be dropped for display without changing
 * identity. Deliberately conservative: ambiguous words like "Company"/"Foods"
 * are never stripped.
 */
const LEGAL_SUFFIX =
  /(?:[,.]?\s+(?:LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|LLP|L\.P\.|LP|PLC|Co\.))+\.?$/i;

/**
 * Most consumer-recognizable company name for display. Prefers a DBA/trade
 * name when the source states one ("Indus Foods, LLC DBA Gangothri Foods" →
 * "Gangothri Foods"), strips mechanical legal suffixes, and un-shouts
 * all-caps legal names ("RED'S ALL NATURAL, LLC." → "Red's All Natural").
 * The authoritative raw/legal name stays in the underlying data untouched.
 */
export function companyDisplayName(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  // The agency is never the recalling company (protects rows normalized
  // before the dirty-title parser fix, where "FSIS" leaked in as the firm).
  if (/^(FSIS|USDA|U\.?S\.?D\.?A\.?)$/i.test(trimmed)) return null;
  const dba = trimmed.match(/\b(?:dba|d\/b\/a|doing business as)\s+(.+)$/i);
  let base = (dba?.[1] ?? trimmed).trim();
  // Establishment aliases joined with "/" ("City Foods, Inc./Bea's Best
  // Corned Beef"): display the primary entity; aliases stay in raw variants.
  const slash = base.split('/');
  if (slash.length > 1 && slash[0].trim().length >= 4) {
    base = slash[0].trim();
  }
  const stripped = base
    .replace(LEGAL_SUFFIX, '')
    // Suffix removal can strand a connective ("Slade Gorton & Co., Inc." →
    // "Slade Gorton &") — drop it with the punctuation.
    .replace(/[\s,&]+$|\s+and$/i, '')
    .trim();
  return humanizeAllCaps(stripped.length >= 3 ? stripped : base);
}

/**
 * The company line for cards/detail. When no company is derivable, a
 * consumer-safe scope statement is used instead of a misleading blank — and a
 * multi-brand scope is claimed only when the source's own title supports it.
 */
export function companyLine(firmDisplayName: string | null, title: string): string {
  const name = companyDisplayName(firmDisplayName);
  if (name) return name;
  return /\b(various|multiple|several)\b/i.test(title)
    ? 'Multiple products and brands'
    : 'Company not specified';
}

export interface ProductIdentifier {
  /** Consumer label: 'Use by', 'Best by', 'Sell by', 'Lot code', 'Case code',
   * 'Establishment number', 'Production date', or the generic 'Look for'.
   * A code is labeled specifically ONLY when the source wording says so;
   * otherwise it stays generic identifying text. */
  label: string;
  /** Verbatim source value (may include dates plus adjacent printed digits). */
  value: string;
}

export interface ProductLineDisplay {
  /** The label name as printed on the product, from the quoted source text. */
  name: string;
  /** Package description preceding the name (e.g. "8-oz. glass jars"). */
  packageText: string | null;
  /** "Check your package" identifiers, in source order. */
  identifiers: ProductIdentifier[];
  /** Where the codes appear ("printed on the side of the plastic tub"). */
  locationText: string | null;
  /** Source prose not consumed by the structured fields — never dropped. */
  residualText: string | null;
}

const QUOTED = /[“"]([^“”"]+)[”"]/g;

/** Quotes that are themselves a date label ("BEST IF USED BY") for the next quote. */
const LABEL_ONLY_QUOTE =
  /^(use[- ]?by|best[- ]?(if[- ]?used[- ]?)?by|best before|sell[- ]?by|freeze[- ]?by|use or freeze by)[\s:.,]*$/i;

function dateLabelFrom(text: string): string {
  if (/^use/i.test(text.trim())) return 'Use by';
  if (/^sell/i.test(text.trim())) return 'Sell by';
  if (/^freeze/i.test(text.trim())) return 'Freeze by';
  return 'Best by';
}

function labelFromGap(gap: string): string | null {
  if (/\blot\s*(codes?|numbers?)?\s*[:#]?\s*$/i.test(gap)) return 'Lot code';
  if (/\bcase\s*codes?\s*[:#]?\s*$/i.test(gap)) return 'Case code';
  if (/\bestablishment\s*(numbers?)?\s*[:#]?\s*$/i.test(gap)) return 'Establishment number';
  if (/\buse[- ]?by\s*(dates?)?\s*(of)?\s*$/i.test(gap)) return 'Use by';
  if (/\bbest[- ]?(if[- ]?used[- ]?)?by\s*(dates?)?\s*(of)?\s*$/i.test(gap)) return 'Best by';
  if (/\bsell[- ]?by\s*(dates?)?\s*(of)?\s*$/i.test(gap)) return 'Sell by';
  if (/\b(production|pack(aging)?)\s*dates?\s*(of)?\s*$/i.test(gap)) return 'Production date';
  if (/\b(item|product)\s*(number|code)s?\s*[:#]?\s*$/i.test(gap)) return 'Item number';
  return null;
}

function labelFromContent(content: string): string | null {
  if (/^use[- ]?by\b/i.test(content)) return 'Use by';
  if (/^best[- ]?(if[- ]?used[- ]?)?by\b/i.test(content) || /^best before\b/i.test(content)) {
    return 'Best by';
  }
  if (/^sell[- ]?by\b/i.test(content)) return 'Sell by';
  if (/^freeze[- ]?by\b/i.test(content)) return 'Freeze by';
  return null;
}

/** Value pattern for unquoted identifiers: runs to " and …", a placement verb, or hard punctuation. */
const UNQUOTED_VALUE =
  '((?:(?!,?\\s+and\\b|\\s+(?:printed|stamped|located|handwritten|written|displayed|embossed)\\b|[.;“”"]).)+)';

/**
 * Real FSIS data sometimes drops or flips a quote mark (`lot code” 0416…`) —
 * labeled patterns therefore tolerate a stray quote before the value.
 */
const STRAY = '[“”"]?\\s*';

const UNQUOTED_PATTERNS: { pattern: RegExp; label: string }[] = [
  {
    pattern: new RegExp(
      `\\b(?:best[- ](?:if[- ]used[- ])?by|best before(?:/[a-zA-Z ]+)?)\\s+dates?\\s+(?:of\\s+)?${STRAY}${UNQUOTED_VALUE}`,
      'i',
    ),
    label: 'Best by',
  },
  {
    pattern: new RegExp(`\\buse[- ]by\\s+dates?\\s+(?:of\\s+)?${STRAY}${UNQUOTED_VALUE}`, 'i'),
    label: 'Use by',
  },
  {
    pattern: new RegExp(`\\bsell[- ]by\\s+dates?\\s+(?:of\\s+)?${STRAY}${UNQUOTED_VALUE}`, 'i'),
    label: 'Sell by',
  },
  {
    pattern: new RegExp(
      `\\blot\\s*(?:codes?|numbers?)\\s*(?:of\\s+)?${STRAY}(?=[A-Za-z0-9])${UNQUOTED_VALUE}`,
      'i',
    ),
    label: 'Lot code',
  },
  {
    pattern: new RegExp(
      `\\bcase\\s*codes?\\s*(?:of\\s+)?${STRAY}(?=[A-Za-z0-9])${UNQUOTED_VALUE}`,
      'i',
    ),
    label: 'Case code',
  },
  {
    pattern: new RegExp(
      `\\bestablishment\\s+numbers?\\s*${STRAY}(?=[A-Za-z0-9])${UNQUOTED_VALUE}`,
      'i',
    ),
    label: 'Establishment number',
  },
  { pattern: /\b(EST\.?\s*\d+[A-Z]?)\b/, label: 'Establishment number' },
];

function cleanPackagePrefix(prefix: string): string | null {
  const cleaned = prefix
    .replace(/^[\s•\-*]+/, '')
    .replace(/\s+containing a plastic bag of\s*$/i, '')
    .replace(/\s+(?:containing|holding|of|labeled|reading)\s*$/i, '')
    .trim();
  return cleaned === '' ? null : cleaned;
}

function cleanValue(value: string): string {
  return value.replace(/^[\s,:]+|[\s,;:]+$/g, '').trim();
}

function cleanResidual(text: string): string | null {
  let out = text.replace(/\s+/g, ' ').trim();
  let previous = '';
  while (previous !== out) {
    previous = out;
    out = out
      .replace(/^(?:[\s,.;:—–-]|with\b|and\b|the\b|a\b|containing\b|of\b)+/i, '')
      .replace(/(?:[\s,;:—–-]|with\b|and\b|the\b|a\b|of\b)+$/i, '')
      .trim();
  }
  return out.replace(/[A-Za-z0-9]/g, '').length === out.length || out.length < 3 ? null : out;
}

/**
 * Structure an FSIS product line into a "check your package" presentation.
 * The quoted first segment is the product's label name; later quoted or
 * pattern-stated segments become labeled identifiers. Returns null when no
 * quoted name exists — the caller must then show the original line verbatim.
 * Unconsumed prose is preserved as residualText (graceful improvement, never
 * destructive parsing; identifying details are safety-critical).
 */
/**
 * FDA product-table lines arrive pre-labeled by the source's own column
 * headers ("<product> | Batch Code/Best Before Date: … | UPC: …" — built by
 * the FDA adapter from the announcement's tables). The labels are the
 * source's words, so they are shown as-is; nothing is relabeled or guessed.
 */
function parseLabeledProductLine(rawText: string): ProductLineDisplay | null {
  if (!rawText.includes(' | ')) return null;
  const segments = rawText.split(' | ').map((s) => s.trim());
  if (segments.length < 2) return null;
  const labeled = segments.map((segment) => {
    const match = segment.match(/^([^:]{2,60}):\s+(.+)$/s);
    return match ? { label: match[1].trim(), value: match[2].trim() } : null;
  });
  // The first unlabeled segment is the product itself; without one, the first
  // labeled product-ish segment serves.
  const nameIndex = labeled.findIndex((l) => l === null);
  const name =
    nameIndex >= 0
      ? segments[nameIndex]
      : (labeled.find((l) => /product|description|brand|flavor|item/i.test(l!.label))?.value ??
        null);
  if (!name || name.length < 2) return null;
  const identifiers = labeled
    .map((l, index) => (l !== null && index !== nameIndex ? l : null))
    .filter((l): l is ProductIdentifier => l !== null && l.value !== name);
  return { name, packageText: null, identifiers, locationText: null, residualText: null };
}

export function parseProductLine(rawText: string): ProductLineDisplay | null {
  const labeled = parseLabeledProductLine(rawText);
  if (labeled) return labeled;
  const quotes = [...rawText.matchAll(QUOTED)];
  if (quotes.length === 0 || quotes[0].index === undefined) return null;
  const name = quotes[0][1].replace(/[\s.,]+$/, '').trim();
  if (name.length < 2) return null;

  const packageText = cleanPackagePrefix(rawText.slice(0, quotes[0].index));
  const restStart = quotes[0].index + quotes[0][0].length;
  let rest = rawText.slice(restStart);

  // Trailing placement phrase ("printed on the side of the plastic tub").
  let locationText: string | null = null;
  const loc = rest.match(
    /\b(?:printed|stamped|located|displayed|found|handwritten|written|embossed)\s+(?:on|in|inside|next to|under|near|at)\b[^“”"]*$/i,
  );
  if (loc && loc.index !== undefined) {
    locationText = cleanValue(loc[0]).replace(/[.\s]+$/, '');
    rest = rest.slice(0, loc.index);
  }

  const identifiers: ProductIdentifier[] = [];
  let residual = rest;

  // Quoted identifiers after the name, with their labeling context.
  const restQuotes = [...rest.matchAll(QUOTED)];
  const cuts: [number, number][] = [];
  for (let i = 0; i < restQuotes.length; i++) {
    const q = restQuotes[i];
    if (q.index === undefined) continue;
    const prev = i === 0 ? 0 : restQuotes[i - 1].index! + restQuotes[i - 1][0].length;
    const gap = rest.slice(prev, q.index);
    const content = cleanValue(q[1]);
    if (content === '') continue;

    // “BEST IF USED BY” date “FEB 10 2027,” — label quote + value quote.
    const next = restQuotes[i + 1];
    if (LABEL_ONLY_QUOTE.test(content) && next && next.index !== undefined) {
      const between = rest.slice(q.index + q[0].length, next.index);
      if (/^[\s,]*dates?\s*(of\s*)?$/i.test(between)) {
        identifiers.push({ label: dateLabelFrom(content), value: cleanValue(next[1]) });
        cuts.push([gap.length <= 45 ? prev : q.index, next.index + next[0].length]);
        i += 1;
        continue;
      }
    }
    const label = labelFromGap(gap) ?? labelFromContent(content) ?? 'Look for';
    identifiers.push({ label, value: content });
    cuts.push([gap.length <= 45 ? prev : q.index, q.index + q[0].length]);
  }
  // Remove consumed spans (right to left) from the residual.
  for (const [start, end] of cuts.reverse()) {
    residual = residual.slice(0, start) + ' ' + residual.slice(end);
  }

  // Unquoted identifiers ("BEST BY dates 9/8/2026 through 11/17/2026",
  // "lot codes LPK1WA046, LPK1WA048", "EST. 12345") from what remains.
  for (const { pattern, label } of UNQUOTED_PATTERNS) {
    const match = residual.match(pattern);
    if (!match || match.index === undefined) continue;
    const value = cleanValue(match[1]);
    if (value.length < 2) continue;
    if (identifiers.some((id) => id.value.includes(value) || value.includes(id.value))) continue;
    identifiers.push({ label, value });
    residual = residual.slice(0, match.index) + ' ' + residual.slice(match.index + match[0].length);
  }

  // Present identifiers in the order the source stated them.
  identifiers.sort((a, b) => {
    const posA = rest.indexOf(a.value);
    const posB = rest.indexOf(b.value);
    return (posA === -1 ? rest.length : posA) - (posB === -1 ? rest.length : posB);
  });

  return {
    name,
    packageText,
    identifiers,
    locationText,
    residualText: cleanResidual(residual),
  };
}

export interface OfficialAttachment {
  url: string;
  label: string;
}

/**
 * Official FSIS PDF attachments (product lists, labels) linked from the
 * notice's own summary HTML. Link extraction only — no PDF parsing. Only
 * fsis.usda.gov-hosted PDFs qualify.
 */
export function extractAttachmentLinks(summaryHtml: string | null): OfficialAttachment[] {
  if (!summaryHtml) return [];
  const out: OfficialAttachment[] = [];
  const seen = new Set<string>();
  for (const match of summaryHtml.matchAll(/href="([^"]+)"/gi)) {
    let url = match[1].replace(/&amp;/g, '&').trim();
    if (url.startsWith('/')) url = `https://www.fsis.usda.gov${url}`;
    url = url.replace(/^http:\/\//, 'https://');
    if (!/^https:\/\/www\.fsis\.usda\.gov\//i.test(url)) continue;
    if (!/\.pdf(?:[?#]|$)/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const label = /distro_list|product[-_ ]?list/i.test(url)
      ? 'Product list (PDF)'
      : /food_label_pdf|label/i.test(url)
        ? 'Product labels (PDF)'
        : 'Official attachment (PDF)';
    out.push({ url, label });
  }
  return out;
}
