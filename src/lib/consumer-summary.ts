/**
 * Deterministic consumer-facing presentation helpers derived from source data.
 *
 * These are display transformations only (architecture Part 4: the canonical
 * projection stays authoritative and untouched). Every function degrades
 * gracefully: when a clean summary cannot be derived, it returns null (or the
 * original text) and the caller falls back to the authoritative source text —
 * an imperfect summary must never hide or alter recall information.
 */

import { CHEMICAL_AGENTS, PATHOGENS } from '@/domain/hazard';

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

// ── Display capitalization (P3D, re-based by P2B7M) ─────────────────────────
//
// Two idempotent display transforms. `capitalizeLeadingWord` stays
// defect-gated over its whole value (labels, brand and company names, package
// row names): any uppercase or digit in the first word is intentional
// identity and the value is left alone. `headlineCaseShopperTitle` is the
// shopper-facing TITLE contract and decides PER SEGMENT — the P2B7M fix for
// partially sentence-cased titles, whose capitalized opening words used to
// convince a whole-string gate that the entire title was intentional.
//
// Both are strictly additive on capitals, so stylized identities survive by
// construction: "a2", "iHerb", "biQ-FEL", "4Earth", acronyms, scientific
// notation, and codes are never rewritten. Display-only — canonical stored
// text, search keys, and identity are never modified.

/**
 * Conventional abbreviated units, preserved verbatim in headline mode
 * ("16 oz.", "5 kg"). Deliberately narrow: spelled-out unit nouns ("quart",
 * "pounds") are ordinary headline words and are NOT listed here. Digit-bearing
 * tokens ("4-lb.,", "8-oz") never reach this check — they are preserved first.
 *
 * P2B7G: the litre family's meaningful mixed casing ("mL", "L") and the
 * piece-count "pc" join the set, and a unit may sit against punctuation the
 * corpus actually writes around sizes — "(2.5 oz)", "40 g," — so surrounding
 * brackets and trailing punctuation no longer disqualify the token.
 */
const UNIT_ABBREVIATION = /^[([]*(?:oz|lbs?|g|kg|mg|ml|mL|l|L|ct|pk|pc|qt|pt|gal|fl|ea)[.,;:)\]]*$/;

/**
 * A scientific genus abbreviation opening — "e." in "e. coli", and the
 * already-corrected "E." too, so a rendered value is a fixed point of the
 * title contract rather than shouting its species epithet on a second pass.
 */
const SCIENTIFIC_MARKER = /^\p{L}\.$/u;

/**
 * Conventionally lowercase Latin abbreviations. They read as ordinary words
 * to the segment rules below ("e.g." is letters, no digit, no unit) and would
 * otherwise be shouted into "E.g.".
 */
const LOWERCASE_ABBREVIATION = new Set(['e.g.', 'i.e.', 'etc.', 'e.g', 'i.e', 'etc', 'w']);

/**
 * Words headline style leaves lowercase when they sit INSIDE a title: the
 * articles, the coordinating conjunctions, the short prepositions, and the
 * romance-language name particles the corpus actually writes ("Pico de
 * Gallo", "Raiz de Tejocote" — capitalizing those corrupts a proper name).
 *
 * Deliberately narrow. Longer function words ("containing", "without",
 * "such", "including") are ordinary headline words and capitalize, which is
 * both standard style and the safe direction: a missed lowercase reads as
 * house style, a wrongly-lowercased product noun reads as a bug. The romance
 * ARTICLES ("la", "el", "los") are deliberately absent — they are usually
 * capitalized inside Spanish product names ("Tacos Los Amigos").
 */
const MINOR_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'nor',
  'but',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'for',
  'from',
  'with',
  'as',
  'de',
  'del',
  'da',
  'di',
  'du',
  'van',
  'von',
]);

/**
 * Organism genera whose binomial casing is restored in reason clauses and
 * protected in shopper titles: the genus is capitalized and the species
 * epithet stays lowercase ("Cronobacter sakazakii", "Bacillus cereus",
 * "Talaromyces penicillium"). Display-only vocabulary: extraction,
 * classification, and canonical data never read this list.
 */
const ORGANISM_GENUS_CASING = ['Cronobacter', 'Bacillus', 'Talaromyces'];

/**
 * Genus names whose binomial the shared hazard vocabulary records, plus the
 * organism genera the reason-clause casing already restores. A lowercase word
 * directly after one of these is a species epithet ("Listeria monocytogenes",
 * "Cronobacter sakazakii") and must stay lowercase — capitalizing it corrupts
 * a taxonomic name. Deliberately excludes genera the corpus writes before
 * ordinary English words ("Salmonella contamination").
 */
const BINOMIAL_GENUS = new Set(
  PATHOGENS.filter((name) => /^\p{Lu}\p{Ll}+ \p{Ll}+$/u.test(name))
    .map((name) => name.split(' ')[0])
    .concat(ORGANISM_GENUS_CASING),
);

/** "(Scomberomorus" — a parenthetical opening with a capitalized Latin genus. */
const PARENTHESIZED_GENUS = /^[(\[]\p{Lu}\p{Ll}+$/u;

/** "cavalla)" — the lowercase species epithet closing that parenthetical. */
const PARENTHESIZED_EPITHET = /^\p{Ll}+[)\]][.,;:]?$/u;

/**
 * Punctuation that opens an independently titled clause, so a minor word
 * directly after it capitalizes ("Cheese: The Aged Variety"). A COMMA is
 * deliberately excluded: commas in these titles separate the items of a
 * product enumeration, and "…, and BBQ Riblet" must keep its lowercase "and".
 * A full stop is excluded too — it ends abbreviations and sizes far more
 * often than clauses here ("16 oz. of cheese").
 */
const CLAUSE_OPENER = /[:\u2013\u2014]$/;

const ANY_UPPER = /\p{Lu}/u;
const ANY_LOWER = /\p{Ll}/u;

/** The segment with its surrounding punctuation stripped ("(dips," → "dips"). */
function segmentCore(segment: string): string {
  return segment.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * A SEGMENT the title contract preserves as notation — the unit of protection
 * is the hyphen/slash segment, not the whole token, so "mg/mL)" protects both
 * halves while "ready-to-eat" still titles each half.
 *
 * Preserved: digit-bearing segments (codes, lot numbers, dates, measurements,
 * "90"), the abbreviated units ("oz.", "mL"), and the conventionally
 * lowercase Latin abbreviations.
 */
function isProtectedNotation(segment: string): boolean {
  if (/\p{Nd}/u.test(segment)) return true;
  if (UNIT_ABBREVIATION.test(segment)) return true;
  const core = segmentCore(segment).toLowerCase();
  return LOWERCASE_ABBREVIATION.has(core) || LOWERCASE_ABBREVIATION.has(segment.toLowerCase());
}

/**
 * A fragment carrying too little evidence to call it a word — a stray
 * one-letter hyphen/slash segment ("e-cigarette", "w/") or bare punctuation.
 * Checked AFTER the minor-word rule, so a standalone leading article ("a
 * frozen pizza") still capitalizes as the title's first word.
 */
function isShortFragment(segment: string): boolean {
  return segmentCore(segment).replace(/[^\p{L}]/gu, '').length < 2;
}

/**
 * THE shopper-facing title-capitalization contract (P2B7M), replacing the
 * P3D/P2B7G whole-string defect gate that let partially sentence-cased titles
 * escape: "All purpose flour, bread mix, flat bread pizza mix" and "Whole
 * Nutrition Infant formula 24 oz cans and 0.6 oz packets" both carried
 * capitalized opening words, and the old gate read that as proof the whole
 * headline was intentionally cased.
 *
 * The decision is now made PER SEGMENT, never over the whole string, so an
 * already-capitalized opening phrase cannot shield a lowercase tail:
 *
 *  - A segment carrying any UPPERCASE letter is intentional identity and is
 *    returned verbatim. This is what protects "biQ-FEL", "iHerb", "VidaSlim",
 *    "FDA", "O157:H7", "D3" and "mL" — and it makes the contract strictly
 *    ADDITIVE: it only ever adds a capital to an ordinary lowercase word, and
 *    never removes one the source or un-shouting produced.
 *  - A preserved segment (see `isPreservedSegment`) is returned verbatim.
 *  - A minor word stays lowercase unless it opens the title or an
 *    independently titled clause.
 *  - Every other lowercase segment is capitalized on its first letter, so
 *    apostrophes capitalize only the lead ("red's" → "Red's") and hyphenated
 *    compounds title each ordinary half ("ready-to-eat" → "Ready-to-Eat",
 *    "non-dairy" → "Non-Dairy").
 *  - The word after a scientific genus marker keeps its lowercase species
 *    name ("e. coli" → "E. coli", never "E. Coli").
 *
 * Idempotent by construction: every segment this function capitalizes then
 * carries an uppercase letter, which the first rule returns verbatim; minor
 * words and preserved segments are fixed points of their own rules.
 */
export function headlineCaseShopperTitle(text: string): string {
  let atClauseStart = true;
  let afterScientificMarker = false;
  let afterGenus = false;
  let afterParenthesizedGenus = false;
  return text
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s*$/.test(token)) return token;
      const wasAfterMarker = afterScientificMarker;
      const wasAfterGenus = afterGenus;
      const wasAfterParenthesizedGenus = afterParenthesizedGenus;
      afterScientificMarker = SCIENTIFIC_MARKER.test(token);
      afterGenus = BINOMIAL_GENUS.has(segmentCore(token));
      afterParenthesizedGenus = PARENTHESIZED_GENUS.test(token);
      const startsClause = atClauseStart;
      atClauseStart = CLAUSE_OPENER.test(token);
      if (afterScientificMarker) return token.toUpperCase(); // "e." → "E."
      if (wasAfterMarker) return token; // "coli" keeps its species name
      // A species epithet directly after a known genus ("Listeria
      // monocytogenes") or closing a parenthesized binomial ("(Scomberomorus
      // cavalla)") keeps its lowercase: binomial nomenclature, not a defect.
      if (wasAfterGenus && /^\p{Ll}+[).,;:]?$/u.test(token)) return token;
      if (wasAfterParenthesizedGenus && PARENTHESIZED_EPITHET.test(token)) return token;
      let leading = true;
      return token
        .split(/([-/])/)
        .map((segment) => {
          if (segment === '-' || segment === '/') return segment;
          const opensToken = leading;
          if (segment !== '') leading = false;
          if (segment === '' || ANY_UPPER.test(segment) || !ANY_LOWER.test(segment)) return segment;
          if (isProtectedNotation(segment)) return segment;
          const opensTitleOrClause = startsClause && opensToken;
          if (MINOR_WORDS.has(segmentCore(segment).toLowerCase())) {
            return opensTitleOrClause
              ? segment.replace(/\p{Ll}/u, (c) => c.toUpperCase())
              : segment;
          }
          if (isShortFragment(segment)) return segment;
          return segment.replace(/\p{Ll}/u, (c) => c.toUpperCase());
        })
        .join('');
    })
    .join('');
}

/**
 * Leading-word capitalization for labels and generated sentences (P3D):
 * capitalizes the first word ONLY when that word is entirely lowercase and
 * digit-free ("dynacare" → "Dynacare"; "dynacare recalled Baby Powder…" →
 * "Dynacare recalled…"). The rest of the value is never rebuilt. A first
 * token carrying a digit or any uppercase is intentional identity and leaves
 * the whole value untouched ("a2", "iHerb", "4Earth"). Idempotent: the
 * transformed value opens with an uppercase letter. NOT `sentenceCaseValue`
 * (lib/identifiers.ts): that helper's first-word scan stops at a digit and
 * would corrupt "a2" into "A2".
 */
export function capitalizeLeadingWord(text: string): string {
  if (!/^\p{Ll}[\p{Ll}'’]*(?=$|[^\p{L}\p{N}])/u.test(text)) return text;
  return text.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
}

// ── Shopper-title normalization (P2B7G) ─────────────────────────────────────

/**
 * A quantity jammed against its abbreviated unit inside one token — the
 * "500mL" class the sources actually write ("5oz Cups", "40g,", "(2.5oz)",
 * "19.8oz", "1lb.", "6pc"). The closed unit set is the casing the corpus
 * jams: the lowercase abbreviations plus the litre convention "mL".
 * Deliberately excluded: bare "l"/"L" ("2L" is intentional packaging
 * shorthand), and every uppercase form — "6OZ" inside an all-caps value is
 * un-shouting's business, never spacing's. The quantity must not follow a
 * letter, digit, or dot, so model identifiers ("A100L"), decimals mid-match
 * ("2.5oz" splits once, before the 2), and dates ("15.09.2027") never split;
 * the unit must end the token ("months", "gal" vs "g" — the longest
 * alternative that reaches a boundary wins).
 */
const JAMMED_QUANTITY_UNIT =
  /(?<![\p{L}\p{Nd}.])(\p{Nd}+(?:\.\p{Nd}+)?)(gal|lbs?|oz|kg|mg|ml|mL|ct|pk|pc|qt|pt|g)(?![\p{L}\p{Nd}])/gu;

/**
 * Insert the conventional space between a quantity and its abbreviated unit
 * ("500mL" → "500 mL", "(2.5oz)" → "(2.5 oz)"). Spacing only: no unit is
 * recased, reordered, converted, or invented, and a value with no jammed
 * quantity+unit token is returned byte-identical. Idempotent — the inserted
 * space breaks the digit-unit adjacency the pattern requires.
 */
export function normalizeUnitSpacing(text: string): string {
  return text.replace(JAMMED_QUANTITY_UNIT, '$1 $2');
}

/**
 * THE shopper-title normalization pipeline (P3D, extended by P2B7G, and
 * re-based on the P2B7M per-segment contract): space a jammed quantity+unit
 * boundary (`normalizeUnitSpacing`), un-shout an ALL-CAPS source value
 * (`humanizeAllCaps`), apply the shopper-title capitalization contract
 * (`headlineCaseShopperTitle`), and open a lowercase leading article with a
 * capital (`capitalizeLeadingWord` — which now only ever confirms what the
 * contract already did, and is kept because the brand/company/row-name slots
 * call it on their own).
 *
 * Each stage is idempotent and no later stage recreates an earlier stage's
 * precondition, so the composition is idempotent. The composition is also
 * ADDITIVE on capitals: no stage removes an uppercase letter the source
 * carried, so it can never decapitalize an intentional identity.
 *
 * EVERY shopper-facing surface flows through THIS function — Feed and Saved
 * cards and Recall Detail via `cleanProductName`, share and accessibility
 * copy from the same model field, and push copy via the push formatter — so a
 * card, the screen it opens, and the notification that opened it can never
 * disagree about a name.
 */
export function displayProductTitle(text: string): string {
  return capitalizeLeadingWord(
    headlineCaseShopperTitle(humanizeAllCaps(normalizeUnitSpacing(text))),
  );
}

// ── Reason-clause sentence-interior casing (P3E) ────────────────────────────
//
// The What Happened free-text reason clauses ("because of <phrase>", "because
// the products contain <phrase>") embed a source phrase mid-sentence. Source
// phrases arrive title-cased ("Undeclared Sildenafil", "Potential Foodborne
// Illness – Lead contamination"), and preserving that casing wholesale would
// shout generic title case mid-sentence — but flattening the WHOLE phrase
// (the pre-P3E behavior) destroyed casing that carries meaning: the recorded
// corpus rendered "cronobacter sakazakii" on infant formula, "bacillus
// cereus", and "vitamin d3". The contract: normalize the phrase to ordinary
// sentence-interior lowercase, then restore only evidence-backed semantic
// spans.

/**
 * Genus names of organisms the recorded corpus states in free-text reasons
 * while the structured pathogen slot is empty (they are not in domain/hazard
 * PATHOGENS — which is exactly why those notices reach the free-text clauses
 * at all). Binomial nomenclature is the casing authority: the genus is
 * capitalized and the species epithet stays lowercase, giving back the exact
 * source-supported spans "Cronobacter sakazakii", "Bacillus cereus", and
 * "Talaromyces penicillium". The consumer health-risk copy
 * (lib/recall-display.ts) already names Cronobacter and Bacillus cereus with
 * this casing. Display-only vocabulary: extraction, classification, and
 * canonical data never read this list.
 */
// (declared above the shopper-title contract, which shares this vocabulary)

/**
 * Canonical spans restored after sentence-interior lowercasing, as
 * [lowercase-matching pattern, canonical casing]. The shared hazard
 * vocabularies are the first authority (PATHOGENS: "Listeria monocytogenes",
 * "E. coli O157:H7"; CHEMICAL_AGENTS: "Cesium-137"); entries whose canonical
 * form is entirely lowercase ("lead", "arsenic") need no restoring and are
 * filtered out — for those, the vocabulary itself affirms mid-sentence
 * lowercase. Each pattern matches only lowercase text, so an already-restored
 * span cannot match again and the transform is idempotent by construction.
 */
const SEMANTIC_SPAN_CASING: [RegExp, string][] = [
  ...PATHOGENS,
  ...CHEMICAL_AGENTS,
  ...ORGANISM_GENUS_CASING,
]
  .filter((term) => term !== term.toLowerCase())
  .map((term): [RegExp, string] => [
    new RegExp(`\\b${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'),
    term,
  ]);

/**
 * Vitamin designations: the letter (with optional number) is the meaningful
 * part and stays uppercase mid-sentence ("vitamin D", "vitamin D3") while the
 * word "vitamin" is ordinary prose. Structural, not a vitamin table — the
 * designation must directly follow the word "vitamin(s)", so a code-like
 * token anywhere else ("model d3") is never rewritten.
 */
const VITAMIN_DESIGNATION = /\b(vitamins?) ([a-z])(\d*)(?![\p{L}\p{N}])/gu;

/**
 * Sentence-interior casing for a source reason phrase embedded mid-sentence
 * in a generated What Happened clause (P3E): lowercase the phrase as ordinary
 * prose, then restore the semantic spans above. Generic source title casing
 * ("Undeclared Sildenafil", "Product Safety") flattens to natural prose;
 * medically meaningful casing ("Cronobacter sakazakii", "vitamin D3")
 * survives. Casing-only (never adds, drops, or reorders a character),
 * deterministic, and idempotent; the canonical reason text is never modified.
 */
export function reasonClauseCasing(phrase: string): string {
  let out = phrase.toLowerCase();
  for (const [pattern, canonical] of SEMANTIC_SPAN_CASING) {
    out = out.replace(pattern, canonical);
  }
  return out.replace(
    VITAMIN_DESIGNATION,
    (_, word: string, letter: string, digits: string) => `${word} ${letter.toUpperCase()}${digits}`,
  );
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
 * "Gangothri Foods"), strips mechanical legal suffixes, un-shouts all-caps
 * legal names ("RED'S ALL NATURAL, LLC." → "Red's All Natural"), and opens a
 * defectively lowercase name with a capital ("dynacare" → "Dynacare", P3D).
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
  return capitalizeLeadingWord(humanizeAllCaps(stripped.length >= 3 ? stripped : base));
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
