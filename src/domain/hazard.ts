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

/** Named chemical contaminants observed in official recall notices. */
export const CHEMICAL_AGENTS = ['lead', 'cadmium', 'arsenic', 'mercury', 'Cesium-137'];

export function extractPathogen(text: string): string | null {
  for (const pathogen of PATHOGENS) {
    if (new RegExp(`\\b${pathogen.replace(/[.]/g, '\\.')}\\b`, 'i').test(text)) return pathogen;
  }
  return null;
}

export function extractChemicalAgent(text: string): string | null {
  return CHEMICAL_AGENTS.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(text)) ?? null;
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
