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

/** Pathogen first, then "undeclared <allergen>" when the source states it. */
export function extractPathogenOrAllergen(text: string): string | null {
  const pathogen = extractPathogen(text);
  if (pathogen) return pathogen;
  const allergen = ALLERGENS.find((a) => new RegExp(`undeclared[^.]{0,60}\\b${a}`, 'i').test(text));
  if (allergen) return `undeclared ${allergen}`;
  return null;
}

/**
 * Canonical allergen relevance tokens for future personalization (founder
 * decision: allergen preferences become a major filtering signal). Maps the
 * source vocabulary ("soybean", "eggs", "tree nuts", specific nuts) onto one
 * stable token per allergen family. The authoritative source wording stays in
 * `pathogenOrAllergen`/reason text — these tokens exist only for matching.
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
