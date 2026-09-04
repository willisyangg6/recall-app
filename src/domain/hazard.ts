/**
 * Deterministic extraction of the specific hazard agent a notice names
 * (architecture Part 4 `pathogenOrAllergen`: "specific agent when stated").
 * Shared by the FSIS and FDA adapters. Fixed keyword lists only — an agent is
 * reported when the source text names it, never inferred.
 */

export const PATHOGENS = [
  'Listeria monocytogenes',
  'Listeria',
  'Salmonella',
  'E. coli O157:H7',
  'E. coli',
  'Clostridium botulinum',
  'Campylobacter',
  'Cyclospora',
  'Hepatitis A',
  'Norovirus',
];

export const ALLERGENS = [
  'milk',
  'egg',
  'fish',
  'shellfish',
  'tree nut',
  'peanut',
  'wheat',
  'soy',
  'sesame',
  'gluten',
];

/**
 * Named chemical contaminants observed in official recall notices, matched
 * anywhere the exact word appears — no evidence gate. Historical, permissive
 * matching that predates the evidence-gated agents below; left unchanged.
 */
export const CHEMICAL_AGENTS = ['lead', 'cadmium', 'arsenic', 'mercury', 'Cesium-137'];

/**
 * Substances recognized only inside a bounded contamination construction —
 * never a bare keyword scan, because a facility/educational/negated mention
 * of the substance is not evidence that the recalled product contains it
 * (P3B: "Asbestos is a naturally occurring mineral..." is generic scientific
 * background in the same announcement that states the real hazard one
 * sentence earlier; a bare scan cannot tell the two apart). Asbestos is the
 * first member — add future evidence-gated agents here rather than growing a
 * second implementation.
 */
const EVIDENCE_GATED_CHEMICAL_AGENTS = ['asbestos'];

/** Is this substance stated as the contaminant (not mentioned in passing)? */
function chemicalAgentStatedAsContaminant(text: string, agent: string): boolean {
  return [
    // "contaminated with asbestos", "may be contaminated by ... asbestos" —
    // the official Dynarex construction ("potential to be contaminated with
    // asbestos") is this pattern; the modal/aux words before "contaminated"
    // don't matter, only what follows it.
    new RegExp(`\\bcontaminat(?:ed|ion)\\s+(?:with|by)\\s+(?:\\w+[\\s,]+){0,3}${agent}\\b`, 'i'),
    // "asbestos contamination", "potential asbestos contamination" — forward
    // gap; "or"/"and" end it, so a disjunctive label ("asbestos or lead
    // contamination") states neither on its own.
    new RegExp(`\\b${agent}\\s+(?:(?!(?:or|and)\\b)\\w+\\s+){0,2}contamin`, 'i'),
  ].some((pattern) => pattern.test(text));
}

function evidenceGatedChemicalAgent(text: string): string | null {
  return (
    EVIDENCE_GATED_CHEMICAL_AGENTS.find((agent) => chemicalAgentStatedAsContaminant(text, agent)) ??
    null
  );
}

export function extractPathogen(text: string): string | null {
  for (const pathogen of PATHOGENS) {
    if (new RegExp(`\\b${pathogen.replace(/[.]/g, '\\.')}\\b`, 'i').test(text)) return pathogen;
  }
  return null;
}

export function extractChemicalAgent(text: string): string | null {
  return (
    CHEMICAL_AGENTS.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(text)) ??
    evidenceGatedChemicalAgent(text)
  );
}

/**
 * Canonical allergen relevance tokens for personalization (founder decision:
 * allergen preferences are a major filtering signal). Maps the source
 * vocabulary ("soybean", "eggs", "tree nuts", specific nuts, "shrimp") onto
 * one stable token per allergen family. The authoritative source wording
 * stays in `pathogenOrAllergen`/reason text — these tokens exist only for
 * matching.
 */
const ALLERGEN_TOKEN_MAP: Record<string, string> = {
  milk: 'milk',
  dairy: 'milk',
  egg: 'egg',
  eggs: 'egg',
  peanut: 'peanut',
  peanuts: 'peanut',
  soy: 'soy',
  soybean: 'soy',
  soybeans: 'soy',
  wheat: 'wheat',
  gluten: 'gluten',
  sesame: 'sesame',
  fish: 'fish',
  shellfish: 'shellfish',
  // FDA files shrimp recalls under its "Crustacean Shellfish" category
  // (verified: Tai Foong, Kettle Cuisine, Lee K of NY) — same family token.
  shrimp: 'shellfish',
  'crustacean shellfish': 'shellfish',
  'tree nut': 'tree nuts',
  'tree nuts': 'tree nuts',
  almond: 'tree nuts',
  almonds: 'tree nuts',
  cashew: 'tree nuts',
  cashews: 'tree nuts',
  pistachio: 'tree nuts',
  pistachios: 'tree nuts',
  hazelnut: 'tree nuts',
  hazelnuts: 'tree nuts',
  walnut: 'tree nuts',
  walnuts: 'tree nuts',
  pecan: 'tree nuts',
  pecans: 'tree nuts',
  sulfite: 'sulfites',
  sulfites: 'sulfites',
};

/** The stable family token for one source allergen word, or null if unsupported. */
export function allergenFamilyToken(sourceWord: string): string | null {
  return ALLERGEN_TOKEN_MAP[sourceWord.trim().toLowerCase()] ?? null;
}

// ── Allergen evidence extraction ─────────────────────────────────────────────
//
// Evidence-gated: an allergen is extracted only from a bounded official reason
// construction that states it as the problem —
//   A. "undeclared <allergen list>"        ("undeclared milk, wheat, and soy",
//      "an undeclared allergen, specifically peanut residue")
//   B. "<contains> <allergen list>, (a) known allergen(s)"
//      ("The product contains egg, a known allergen, which is not declared")
//   C. "does not declare <allergen list>"  ("the label does not declare soy")
// Never from ingredient lists, precautionary copy, negated statements
// ("contains no milk"), facility/allergen-control prose, or generic allergen
// boilerplate with no named allergen. Only the closed vocabulary above is ever
// collected — an unsupported word ends the list and is never guessed into it.

/** Vocabulary words recognized in evidence constructions, longest first. */
const ALLERGEN_EVIDENCE_WORDS = Object.keys(ALLERGEN_TOKEN_MAP).sort((a, b) => b.length - a.length);

/**
 * Words allowed to bridge the trigger and the named allergens inside one
 * evidence construction ("undeclared allergen, specifically peanut residue").
 */
const LIST_GLUE = new Set(['allergen', 'allergens', 'specifically']);
const LIST_CONNECTORS = new Set([',', '(', ')', 'and', 'or', 'and/or', '&']);

/** Word/punctuation tokens of a bounded phrase, in order. */
function listTokens(phrase: string): string[] {
  return phrase.toLowerCase().match(/[a-z]+(?:\/[a-z]+)?|[,()&]/g) ?? [];
}

/**
 * Two vocabulary words are grammatical aliases of one allergen when they are
 * the same word, or singular/plural forms ("peanut"/"peanuts", "tree nut"/
 * "tree nuts") of the same canonical family. Distinct source words that
 * merely SHARE a family ("almonds" and "walnuts", "shrimp" and "shellfish")
 * are deliberately not aliases: the source named them separately, and family
 * grouping stays downstream in `normalizedAllergenTokens`/display.
 */
function sameAllergenAlias(a: string, b: string): boolean {
  if (a === b) return true;
  if (`${a}s` !== b && `${b}s` !== a) return false;
  const family = ALLERGEN_TOKEN_MAP[a];
  return family !== undefined && family === ALLERGEN_TOKEN_MAP[b];
}

function collectWord(word: string, collected: string[]): void {
  if (!collected.some((existing) => sameAllergenAlias(existing, word))) collected.push(word);
}

/**
 * Walk tokens collecting vocabulary words (with two-token lookahead for
 * "crustacean shellfish" / "tree nuts") until a word that is neither
 * vocabulary, connector, nor glue ends the list. "including" bridges only an
 * explicitly allergen-governed list ("undeclared allergens, including eggs,
 * milk, and wheat" — verified against archived production notice 111-2015);
 * without the allergen governor it ends the run, so an ordinary ingredient
 * enumeration ("undeclared ingredients, including …") is never interpreted.
 */
function collectAllergenRun(tokens: string[], collected: string[]): void {
  let allergenGoverned = false;
  for (let i = 0; i < tokens.length; i++) {
    const pair = i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : null;
    if (pair && ALLERGEN_EVIDENCE_WORDS.includes(pair)) {
      collectWord(pair, collected);
      i++;
      continue;
    }
    if (ALLERGEN_EVIDENCE_WORDS.includes(tokens[i])) {
      collectWord(tokens[i], collected);
      continue;
    }
    if (tokens[i] === 'allergen' || tokens[i] === 'allergens') {
      allergenGoverned = true;
      continue;
    }
    if (tokens[i] === 'including') {
      if (allergenGoverned) continue;
      return;
    }
    if (LIST_CONNECTORS.has(tokens[i]) || LIST_GLUE.has(tokens[i])) continue;
    return;
  }
}

/** As `collectAllergenRun`, but walking backward from the end of the phrase. */
function collectAllergenRunBackward(tokens: string[], collected: string[]): void {
  const found: string[] = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const pair = i > 0 ? `${tokens[i - 1]} ${tokens[i]}` : null;
    if (pair && ALLERGEN_EVIDENCE_WORDS.includes(pair)) {
      found.push(pair);
      i--;
      continue;
    }
    if (ALLERGEN_EVIDENCE_WORDS.includes(tokens[i])) {
      found.push(tokens[i]);
      continue;
    }
    if (LIST_CONNECTORS.has(tokens[i]) || LIST_GLUE.has(tokens[i])) continue;
    // A negated list is not evidence ("contains no milk, a known allergen").
    if (['no', 'not', 'without'].includes(tokens[i])) found.length = 0;
    break;
  }
  for (const word of found.reverse()) collectWord(word, collected);
}

/**
 * Allergens the text states as the reason for the notice, as lowercased
 * source words in order of first appearance. Deduplicated by grammatical
 * alias (`sameAllergenAlias`), so "undeclared peanut" plus "contains
 * peanuts, known allergens" yields one peanut entry — while distinct words
 * sharing a family ("almonds and walnuts") are all preserved; family
 * normalization stays downstream in `normalizedAllergenTokens`/display.
 */
export function extractAllergenEvidence(text: string): string[] {
  const collected: string[] = [];

  // A. "undeclared <list>" — bounded to the sentence; a negation immediately
  // before the trigger disqualifies it.
  for (const match of text.matchAll(/\bundeclared\s+([^.;\n]{1,100})/gi)) {
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    if (/\b(?:no|not|without)\s+$/i.test(before)) continue;
    collectAllergenRun(listTokens(match[1]), collected);
  }

  // B. "… contains <list>, (a) known allergen(s)" — the FSIS reason
  // apposition. The phrase must carry a containment/declaration verb, so a
  // bare mention ("consumers allergic to milk, a known allergen") or
  // allergen-control prose ("facility that also processes peanuts") is never
  // evidence.
  for (const match of text.matchAll(/([^.;\n]{2,160}),\s*(?:an?\s+)?known\s+allergens?\b/gi)) {
    let phrase = match[1];
    while (/\([^)]*\)\s*$/.test(phrase)) phrase = phrase.replace(/\s*\([^)]*\)\s*$/, '');
    if (!/\b(?:contains?|contained|containing)\b/i.test(phrase)) continue;
    if (/\b(?:facilit|equipment|processes|processed\s+(?:in|on)|shared)/i.test(phrase)) continue;
    collectAllergenRunBackward(listTokens(phrase), collected);
  }

  // C. "does not declare <list>" — labeling-failure statement.
  for (const match of text.matchAll(/\bdoes\s+not\s+declare\s+([^.;\n]{1,100})/gi)) {
    collectAllergenRun(listTokens(match[1]), collected);
  }

  return collected;
}

/**
 * Does the text state an undeclared allergen as the reason for the notice?
 * The evidence owner is `extractAllergenEvidence` above and nowhere else —
 * category derivation asks this question rather than growing a second
 * allergen vocabulary of its own.
 */
export function statesUndeclaredAllergen(text: string): boolean {
  return extractAllergenEvidence(text).length > 0;
}

// ── Foreign-material evidence extraction ─────────────────────────────────────
//
// THE foreign-material evidence owner (P2e-B). Evidence-gated on exactly the
// same principle as the allergen extractor above: a material word counts only
// inside a bounded official construction that states it as the CONTAMINANT.
//
// A material word describing the PACKAGE is never evidence. Verified against
// archived FSIS notices where the packaging and the real contaminant disagree:
// PHA-10092020-01 is a glass contamination whose products are "10-oz. plastic
// bowl package[s]", and 115-2017 is an undeclared-anchovy recall whose
// products are "9.75-oz. plastic bowls". A bare keyword scan reported
// "plastic" for both. Nothing here enumerates packaging words — the rule is
// the inverse and cannot be outrun by an unlisted container noun: absent a
// stated contamination construction, a material word simply is not evidence.
//
// The constructions, all observed verbatim in the recorded corpus:
//   A. "foreign material" / "foreign matter" / "extraneous material(s)"
//      ("Due to Possible Foreign Matter Contamination" — the FSIS title form)
//   B. "… material, specifically <material>"          (names the contaminant)
//   C. "pieces/fragments/shards of <material>"
//   D. "<material> pieces/fragments/shards"
//   E. "contaminated with <material>", "<material> contamination"
//   F. "<material> found in …", "found <material> in …"
//   G. "may contain <material>"   (modal + finite verb, never "containing")

/** Materials observed named as contaminants in official notices. */
export const FOREIGN_MATERIALS = ['metal', 'plastic', 'glass', 'wood', 'rubber', 'bone'];

/** The shapes a foreign object is stated in. Fixed list, never inferred. */
const FRAGMENT_NOUNS =
  'pieces?|fragments?|shards?|shavings?|slivers?|particles?|chips?|bits?|chunks?|' +
  'splinters?|flakes?|specks?|strands?|filaments?';

/** The agency's generic wording for a foreign-material hazard. */
const GENERIC_FOREIGN_MATERIAL =
  /\b(?:foreign|extraneous)\s+(?:material|matter|object|substance|contaminant|bod(?:y|ies))s?\b/i;

/** Is this material named as the contaminant (not as the packaging)? */
function materialStatedAsContaminant(text: string, material: string): boolean {
  const m = material.replace(/[.]/g, '\\.');
  return [
    // C. "pieces of glass", "fragments of hard plastic"
    new RegExp(`\\b(?:${FRAGMENT_NOUNS})\\s+of\\s+(?:\\w+\\s+){0,2}${m}\\b`, 'i'),
    // D. "glass pieces", "metal fragments"
    new RegExp(`\\b${m}\\s+(?:${FRAGMENT_NOUNS})\\b`, 'i'),
    // E. "contaminated with glass" / "the glass contamination"
    new RegExp(`\\bcontaminat(?:ed|ion)\\s+(?:with|by)\\s+(?:\\w+[\\s,]+){0,3}${m}\\b`, 'i'),
    // The gap carries the agency's own qualifiers ("a possible plastic
    // foreign contaminant") without reaching the next clause. "or"/"and" end
    // it: FDA's reason TAXONOMY is disjunctive ("Potential Metal or Chemical
    // Contaminant"), and a category naming two possibilities states neither.
    new RegExp(`\\b${m}\\s+(?:(?!(?:or|and)\\b)\\w+\\s+){0,2}contamin`, 'i'),
    // F. "glass found in product". Bounded to the discovery construction so
    // an ordinary product word cannot reach a nearby "found" ("bone-in
    // chicken … found at retail").
    new RegExp(`\\b${m}\\b[^.]{0,15}\\bfound\\s+in\\b`, 'i'),
    new RegExp(`\\bfound\\s+(?:\\w+\\s+){0,2}${m}\\b`, 'i'),
    // G. "the salad dressing may contain hard plastic" — the hazard is stated
    // with a modal + the FINITE verb. FSIS product listings use the
    // participle instead ("packages containing a plastic bag"), so package
    // contents can never be read as a contaminant.
    new RegExp(`\\b(?:may|might|could|possibly)\\s+contains?\\s+(?:\\w+\\s+){0,2}${m}\\b`, 'i'),
    // B. "extraneous materials, specifically clear flexible and hard plastic"
    new RegExp(
      `${GENERIC_FOREIGN_MATERIAL.source}[^.]{0,40}?\\bspecifically\\b[^.]{0,60}?\\b${m}\\b`,
      'i',
    ),
  ].some((pattern) => pattern.test(text));
}

export interface ForeignMaterialEvidence {
  /** The notice states a foreign-material hazard. */
  stated: boolean;
  /**
   * The specific material named as the contaminant, or null when the notice
   * states the hazard only in its generic form. Ordered by first appearance
   * in the text, so a notice naming several reports the one it leads with.
   */
  material: string | null;
}

/**
 * The foreign-material hazard a notice states, if any. Deterministic and
 * derivable at any layer: the FSIS category parser and the consumer reason
 * line both call this, so a screen can never name a material the category
 * derivation did not accept as evidence.
 */
export function extractForeignMaterialEvidence(text: string): ForeignMaterialEvidence {
  const named = FOREIGN_MATERIALS.filter((material) =>
    materialStatedAsContaminant(text, material),
  ).sort((a, b) => {
    const at = text.toLowerCase().indexOf(a);
    const bt = text.toLowerCase().indexOf(b);
    return (at < 0 ? Number.MAX_SAFE_INTEGER : at) - (bt < 0 ? Number.MAX_SAFE_INTEGER : bt);
  });
  if (named.length > 0) return { stated: true, material: named[0] };
  return { stated: GENERIC_FOREIGN_MATERIAL.test(text), material: null };
}

/**
 * The canonical multi-allergen list wording ("a", "a and b", "a, b, and c") —
 * the exact shape `normalizedAllergenTokens` and the display layers parse.
 */
export function formatAllergenList(words: string[]): string {
  return words.join(words.length === 2 ? ' and ' : ', ').replace(/, ([a-z ]+)$/, ', and $1');
}

/** Pathogen first, then the allergens the source states as the reason. */
export function extractPathogenOrAllergen(text: string): string | null {
  const pathogen = extractPathogen(text);
  if (pathogen) return pathogen;
  const allergens = extractAllergenEvidence(text);
  if (allergens.length > 0) return `undeclared ${formatAllergenList(allergens)}`;
  return null;
}

/**
 * Normalized allergen tokens from a `pathogenOrAllergen` value
 * ("undeclared milk and sesame" → ["milk", "sesame"]). Empty when the value
 * is not an undeclared-allergen statement. Deterministic — derivable at any
 * layer without re-ingestion.
 */
export function normalizedAllergenTokens(pathogenOrAllergen: string | null): string[] {
  const match = pathogenOrAllergen?.match(/^undeclared\s+(.+)$/i);
  if (!match) return [];
  const tokens = new Set<string>();
  for (const part of match[1].split(/,|\band\/or\b|\band\b|\bor\b/i)) {
    const key = part
      .trim()
      .toLowerCase()
      .replace(/[.\s]+$/, '');
    if (key === '') continue;
    const mapped = ALLERGEN_TOKEN_MAP[key];
    if (mapped) tokens.add(mapped);
  }
  return [...tokens].sort();
}

/** Consumer display name for an allergen source word ("soybean" → "soy"). */
export function allergenDisplayName(sourceWord: string): string {
  const key = sourceWord.trim().toLowerCase();
  return ALLERGEN_TOKEN_MAP[key] ?? key;
}

/**
 * Normalize an allergen phrase from source vocabulary to label vocabulary
 * ("soybean" → "soy", "eggs" → "egg"), preserving multi-allergen structure
 * ("milk and sesame" stays "milk and sesame").
 */
export function allergenDisplayPhrase(phrase: string): string {
  // Deduped: "cashews, pistachios and/or hazelnut" is one family — tree nuts.
  const names = [
    ...new Set(
      phrase
        .split(/,|\band\/or\b|\band\b|\bor\b/i)
        .map((n) => n.trim())
        .filter((n) => n !== '')
        .map((n) => allergenDisplayName(n)),
    ),
  ];
  if (names.length === 0) return phrase.trim();
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
